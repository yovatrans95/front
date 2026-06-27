/**
 * planning.js — Yovatrans Planning
 */
'use strict';

const DAYS_FR = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

// ─── État global ─────────────────────────────────────────────────────────────
let state = {
  viewStart:    getToday(),
  nbDays:       7,
  editMode:     false,
  chauffeurs:   [],
  plannings:    [],
  vehicules:    [],
  clientsList:  [],
  searchQuery:  '',
  // Filtres multi-sélection : on stocke les valeurs MASQUÉES (décochées).
  // Set vide = tout affiché. Une valeur présente = masquée.
  hiddenStatut:       new Set(),
  hiddenType:         new Set(),
  hiddenPeriode:      new Set(),
  hiddenClient:       new Set(), // clés normalisées (normalizeClientKey)
  hiddenClientSource: new Set(),
  modalMode:    'create',
  currentChauffeurId: null,
  currentDate:  null,
  currentTourId: null,
  regieSepare:  false, // régie en mode départ/arrivée par tour (vs groupée)
  drag: { tourId: null, fromChauffeurId: null, fromDate: null, fromIdx: null },
};

// ─── Utilitaires date ─────────────────────────────────────────────────────────
function getToday() {
  const d = new Date(); d.setHours(0,0,0,0); return d;
}
function getMonday(d) {
  const date = new Date(d);
  const diff = date.getDay() === 0 ? -6 : 1 - date.getDay();
  date.setDate(date.getDate() + diff);
  date.setHours(0,0,0,0);
  return date;
}
function addDays(date, n) {
  const d = new Date(date); d.setDate(d.getDate() + n); return d;
}
function toISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth()+1).padStart(2,'0');
  const dd = String(date.getDate()).padStart(2,'0');
  return `${y}-${m}-${dd}`;
}
function formatDateFR(date) {
  return date.toLocaleDateString('fr-FR', { day:'2-digit', month:'short' });
}
function isToday(date) {
  const t = new Date();
  return date.getFullYear()===t.getFullYear() && date.getMonth()===t.getMonth() && date.getDate()===t.getDate();
}
function isWeekend(date) { return date.getDay()===0 || date.getDay()===6; }
function getViewDays() {
  return Array.from({ length: state.nbDays }, (_,i) => addDays(state.viewStart, i));
}

// ─── API ──────────────────────────────────────────────────────────────────────
function getToken() { return localStorage.getItem('token') || ''; }
function authHeaders() {
  return { 'Content-Type':'application/json', 'Authorization':`Bearer ${getToken()}` };
}
async function planningFetch(url, options={}) {
  const res = await fetch(`${API_BASE}${url}`, {
    ...options, headers: { ...authHeaders(), ...(options.headers||{}) }
  });
  if (!res.ok) {
    const err = await res.json().catch(()=>({ message: res.statusText }));
    throw new Error(err.message || 'Erreur API');
  }
  return res.json();
}
async function loadChauffeurs()            { return planningFetch('/drivers?statut=actif&limit=200'); }
async function loadVehicules()             { return planningFetch('/vehicles'); }
async function loadPlannings(s, e)         { return planningFetch(`/planning?startDate=${s}&endDate=${e}`); }
async function loadClients()               { return planningFetch('/planning/clients/list'); }
async function createTour(cId, date, data) { return planningFetch(`/planning/${cId}/${date}/tours`, { method:'POST', body:JSON.stringify(data) }); }
async function updateTour(cId, date, tId, data) { return planningFetch(`/planning/${cId}/${date}/tours/${tId}`, { method:'PATCH', body:JSON.stringify(data) }); }
async function deleteTour(cId, date, tId) { return planningFetch(`/planning/${cId}/${date}/tours/${tId}`, { method:'DELETE' }); }

// Route spéciale : déplacer un tour (DELETE src + POST dst)
async function moveTour(fromChauffeurId, fromDate, tourId, toChauffeurId, toDate) {
  // Récupère le tour source depuis le state local
  const srcPlanning = getPlanningForCell(fromChauffeurId, fromDate);
  if (!srcPlanning) throw new Error('Planning source introuvable');
  const tour = srcPlanning.tours.find(t => String(t._id) === String(tourId));
  if (!tour) throw new Error('Tour introuvable');

  // Créer dans la destination (sans _id, sans createdBy/updatedBy — le backend les injecte)
  const { _id, createdBy, updatedBy, createdAt, updatedAt, __v, ...tourData } = tour;

  // Tour déplacé vers un AUTRE chauffeur : il prend l'immat de ce chauffeur
  // (ses tours du jour, sinon son camion habituel) au lieu de garder celle de
  // l'ancien chauffeur. Si le receveur n'a aucune immat connue, on garde
  // l'immat d'origine. NB : à calculer AVANT le delete (le state local sert de source).
  if (String(toChauffeurId) !== String(fromChauffeurId)) {
    const immatReceveur = detectImmatForChauffeur(toChauffeurId, toDate);
    if (immatReceveur) tourData.immatCamion = immatReceveur;
  }

  // Supprimer de la source
  await deleteTour(fromChauffeurId, fromDate, tourId);

  await createTour(toChauffeurId, toDate, tourData);
}

// Dupliquer : crée une copie d'un tour dans la même cellule (même chauffeur, même date)
async function duplicateTour(tour, chauffeurId, dateISO) {
  // On retire les champs propres à l'instance (id, audit, version) avant POST
  const { _id, createdBy, updatedBy, createdAt, updatedAt, __v, ...data } = tour;
  try {
    await createTour(chauffeurId, dateISO, data);
    await loadView(true); // duplication enregistrée en arrière-plan, sans spinner
  } catch (e) {
    notify('Erreur duplication : ' + e.message, 'error');
  }
}

// Réordonner : déplace un tour d'index fromIdx vers toIdx dans la même cellule
async function reorderTour(chauffeurId, date, fromIdx, toIdx) {
  const planning = getPlanningForCell(chauffeurId, date);
  if (!planning) return;
  const tours = [...planning.tours];
  const [moved] = tours.splice(fromIdx, 1);
  tours.splice(toIdx, 0, moved);
  // Mise à jour locale immédiate pour fluidité
  planning.tours = tours;
  renderGrid();

  // Sauvegarde côté backend (route dédiée /reorder qui réordonne le tableau)
  try {
    await planningFetch(`/planning/${chauffeurId}/${date}/reorder`, {
      method: 'PATCH',
      body: JSON.stringify({ ordre: tours.map(t => t._id) })
    });
  } catch(e) {
    notify('Erreur sauvegarde de l\'ordre : ' + e.message, 'error');
    await loadView(); // resync depuis le backend pour revenir à un état cohérent
  }
}

// ─── Auto-scroll pendant le drag ──────────────────────────────────────────────
// Quand on drag près d'un bord de l'écran, on scrolle automatiquement le
// conteneur du planning (ou la fenêtre) pour permettre de déposer dans une
// zone hors écran. Plus on s'approche du bord, plus c'est rapide.
let _autoScrollAnimId = null;
let _autoScrollSpeed  = { x: 0, y: 0 };
const AUTO_SCROLL_EDGE = 90;   // px depuis le bord pour déclencher
const AUTO_SCROLL_MAX  = 18;   // vitesse max par frame (px)

function _autoScrollDragOverHandler(e) {
  const x = e.clientX, y = e.clientY;
  // Pendant un drag, des événements arrivent parfois avec clientX/Y = 0 — ignorés
  if (x === 0 && y === 0) { _autoScrollSpeed = { x: 0, y: 0 }; return; }
  const w = window.innerWidth, h = window.innerHeight;

  let sy = 0, sx = 0;
  if (y < AUTO_SCROLL_EDGE) {
    sy = -Math.ceil(((AUTO_SCROLL_EDGE - y) / AUTO_SCROLL_EDGE) * AUTO_SCROLL_MAX);
  } else if (y > h - AUTO_SCROLL_EDGE) {
    sy = Math.ceil(((y - (h - AUTO_SCROLL_EDGE)) / AUTO_SCROLL_EDGE) * AUTO_SCROLL_MAX);
  }
  if (x < AUTO_SCROLL_EDGE) {
    sx = -Math.ceil(((AUTO_SCROLL_EDGE - x) / AUTO_SCROLL_EDGE) * AUTO_SCROLL_MAX);
  } else if (x > w - AUTO_SCROLL_EDGE) {
    sx = Math.ceil(((x - (w - AUTO_SCROLL_EDGE)) / AUTO_SCROLL_EDGE) * AUTO_SCROLL_MAX);
  }
  _autoScrollSpeed = { x: sx, y: sy };
}

function startDragAutoScroll() {
  _autoScrollSpeed = { x: 0, y: 0 };
  document.addEventListener('dragover', _autoScrollDragOverHandler, true);
  if (_autoScrollAnimId) return;

  const container = document.querySelector('.planning-scroll-container');
  const tick = () => {
    const { x, y } = _autoScrollSpeed;
    if (x !== 0 || y !== 0) {
      let scrolledContainer = false;
      if (container) {
        const beforeL = container.scrollLeft, beforeT = container.scrollTop;
        container.scrollLeft += x;
        container.scrollTop  += y;
        if (container.scrollLeft !== beforeL || container.scrollTop !== beforeT) {
          scrolledContainer = true;
        }
      }
      // Si le conteneur n'a plus de marge à scroller, on tente la fenêtre
      if (!scrolledContainer) window.scrollBy(x, y);
    }
    _autoScrollAnimId = requestAnimationFrame(tick);
  };
  _autoScrollAnimId = requestAnimationFrame(tick);
}

function stopDragAutoScroll() {
  document.removeEventListener('dragover', _autoScrollDragOverHandler, true);
  if (_autoScrollAnimId) {
    cancelAnimationFrame(_autoScrollAnimId);
    _autoScrollAnimId = null;
  }
  _autoScrollSpeed = { x: 0, y: 0 };
}

// ─── Loader ───────────────────────────────────────────────────────────────────
function showLoader() { document.getElementById('loaderOverlay').style.display = 'flex'; }
function hideLoader() { document.getElementById('loaderOverlay').style.display = 'none'; }

// ─── Notifications (toasts) ──────────────────────────────────────────────────
// notify(message, type) — type ∈ 'error' | 'success' | 'warning' | 'info'
// Slide-in en haut à droite, auto-dismiss, fermeture manuelle possible.
function notify(message, type) {
  type = type || 'info';

  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const ICONS = {
    error:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    info:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  };

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${ICONS[type] || ICONS.info}</span>
    <span class="toast-message"></span>
    <button class="toast-close" type="button" aria-label="Fermer">&times;</button>
  `;
  // textContent pour éviter toute injection HTML depuis un message d'erreur backend
  toast.querySelector('.toast-message').textContent = String(message);

  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));

  let dismissed = false;
  const close = () => {
    if (dismissed) return;
    dismissed = true;
    toast.classList.remove('show');
    toast.classList.add('hide');
    setTimeout(() => toast.remove(), 260);
  };
  toast.querySelector('.toast-close').addEventListener('click', close);

  const duration = (type === 'error' || type === 'warning') ? 5000 : 3500;
  setTimeout(close, duration);
}
window.notify = notify;

// ─── Confirmation (modal chic) ───────────────────────────────────────────────
// confirmDialog(message, { title, okLabel, cancelLabel, danger }) -> Promise<bool>
function confirmDialog(message, options) {
  options = options || {};
  const title       = options.title       || 'Confirmation';
  const okLabel     = options.okLabel     || 'Confirmer';
  const cancelLabel = options.cancelLabel || 'Annuler';
  const danger      = !!options.danger;

  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-modal" role="dialog" aria-modal="true">
        <div class="confirm-icon ${danger ? 'is-danger' : 'is-info'}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            ${danger
              ? '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'
              : '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>'}
          </svg>
        </div>
        <h3 class="confirm-title"></h3>
        <p class="confirm-message"></p>
        <div class="confirm-actions">
          <button type="button" class="btn btn-ghost confirm-cancel"></button>
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'} confirm-ok"></button>
        </div>
      </div>
    `;
    overlay.querySelector('.confirm-title').textContent   = title;
    overlay.querySelector('.confirm-message').textContent = String(message);
    overlay.querySelector('.confirm-cancel').textContent  = cancelLabel;
    overlay.querySelector('.confirm-ok').textContent      = okLabel;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));

    const cleanup = (result) => {
      overlay.classList.remove('show');
      setTimeout(() => overlay.remove(), 200);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') cleanup(false);
      if (e.key === 'Enter')  cleanup(true);
    };
    document.addEventListener('keydown', onKey);

    overlay.querySelector('.confirm-cancel').addEventListener('click', () => cleanup(false));
    overlay.querySelector('.confirm-ok').addEventListener('click',     () => cleanup(true));
    overlay.addEventListener('click', e => { if (e.target === overlay) cleanup(false); });

    setTimeout(() => overlay.querySelector('.confirm-ok').focus(), 50);
  });
}
window.confirmDialog = confirmDialog;

// ─── Datalists ────────────────────────────────────────────────────────────────
function buildImmatDatalist() {
  const dl = document.getElementById('immatSuggestions');
  if (!dl) return;
  dl.innerHTML = '';
  state.vehicules.forEach(v => {
    if (!v.immatriculation) return;
    const opt = document.createElement('option');
    opt.value = v.immatriculation;
    opt.label = [v.marque, v.modele].filter(Boolean).join(' ');
    dl.appendChild(opt);
  });
}

// ─── Champs dynamiques Tour / Régie ──────────────────────────────────────────
function updateModalFields() {
  const type = document.querySelector('input[name="tourType"]:checked')?.value;
  const isRegie = type === 'regie';
  const separe  = isRegie && state.regieSepare;

  // La ligne des lieux reste affichée (elle porte le bouton bascule).
  document.getElementById('fieldsLieux').style.display = '';
  // Régie groupée (par défaut) : Départ/Arrivée généraux pour toute la régie.
  // Régie séparée : un Départ/Arrivée par tour -> on retire les lieux groupés.
  document.getElementById('grpSource').style.display      = separe ? 'none' : '';
  document.getElementById('grpDestination').style.display = separe ? 'none' : '';
  // Petit bouton bascule groupée <-> séparée : visible uniquement en régie
  const btnSep = document.getElementById('btnSeparerRegie');
  btnSep.style.display = isRegie ? '' : 'none';
  btnSep.textContent   = separe ? 'Grouper' : 'Séparer';
  btnSep.title         = separe
    ? 'Régie groupée : un départ/arrivée commun à toute la régie'
    : 'Séparer la régie : un départ/arrivée par tour';
  // Nombre de tours : toujours en régie
  document.getElementById('fieldNombreTours').style.display = isRegie ? '' : 'none';
  // Détail départ/arrivée par tour : seulement si régie séparée
  document.getElementById('fieldRegieTours').style.display = separe ? '' : 'none';
  if (separe) syncRegieTourFields();
  // Libellés des lieux adaptés au type (départ/arrivée en régie)
  document.getElementById('lblSource').textContent      = isRegie ? 'Départ' : 'Source (chargement)';
  document.getElementById('lblDestination').textContent = isRegie ? 'Arrivée' : 'Destination (déchargement)';
}

// Bascule entre régie groupée et régie séparée (départ/arrivée par tour).
function toggleRegieSepare() {
  state.regieSepare = !state.regieSepare;
  if (state.regieSepare) {
    const n = Math.max(1, parseInt(document.getElementById('fNombreTours').value, 10) || 0);
    document.getElementById('fNombreTours').value = n;
    // Pré-remplissage intelligent : si aucun détail par tour n'est saisi, on
    // repart du Départ/Arrivée général (la plupart des régies répètent le même
    // tour) — l'utilisateur n'a plus qu'à ajuster les tours différents.
    let seed = readRegieTourFields();
    if (!seed.some(r => r.chargement || r.dechargement)) {
      const dep = document.getElementById('fSource').value.trim();
      const arr = document.getElementById('fDestination').value.trim();
      seed = Array.from({ length: n }, () => ({ chargement: dep, dechargement: arr }));
    }
    updateModalFields();
    syncRegieTourFields(seed);
    return;
  }
  updateModalFields();
}

// Ajoute un tour vide à la fin (bouton « Ajouter un tour »).
function addRegieTour() {
  const data = readRegieTourFields();
  data.push({ chargement: '', dechargement: '' });
  document.getElementById('fNombreTours').value = data.length;
  syncRegieTourFields(data);
}

// Supprime le tour idx (et met à jour le nombre).
function removeRegieTour(idx) {
  const data = readRegieTourFields();
  data.splice(idx, 1);
  document.getElementById('fNombreTours').value = data.length;
  syncRegieTourFields(data);
}

// Génère un emplacement chargement/déchargement par tour de régie, piloté par le
// nombre saisi dans #fNombreTours. Les valeurs déjà saisies (ou chargées depuis
// un tour existant) sont conservées quand on ajuste le nombre.
function syncRegieTourFields(seed) {
  const list = document.getElementById('regieToursList');
  if (!list) return;
  const count = Math.max(0, parseInt(document.getElementById('fNombreTours').value, 10) || 0);

  // On part des valeurs actuellement à l'écran, complétées par d'éventuelles
  // valeurs initiales (seed) lors de l'ouverture du modal.
  const current = readRegieTourFields();
  const data = seed || current;

  let html = '';
  for (let i = 0; i < count; i++) {
    const row = data[i] || {};
    html +=
      '<div class="form-row regie-tour-row">' +
        '<div class="regie-tour-head">' +
          '<span class="regie-tour-title">Tour ' + (i + 1) + '</span>' +
          '<span class="regie-tour-actions">' +
            '<button type="button" class="regie-dup-btn" data-idx="' + i + '" title="Ajouter un tour identique">Dupliquer</button>' +
            '<button type="button" class="regie-del-btn" data-idx="' + i + '" title="Supprimer ce tour" aria-label="Supprimer">&times;</button>' +
          '</span>' +
        '</div>' +
        '<div class="regie-tour-fields">' +
          '<div class="form-group">' +
            '<label>Départ</label>' +
            '<input type="text" class="regie-chargement" placeholder="Lieu de départ" value="' + escapeAttr(row.chargement || '') + '" />' +
          '</div>' +
          '<div class="form-group">' +
            '<label>Arrivée</label>' +
            '<input type="text" class="regie-dechargement" placeholder="Lieu d\'arrivée" value="' + escapeAttr(row.dechargement || '') + '" />' +
          '</div>' +
        '</div>' +
      '</div>';
  }
  list.innerHTML = html;
}

// Ajoute un tour identique juste après le tour idx (et incrémente le nombre).
// La plupart des régies répètent le même tour : on en remplit un puis on duplique.
function duplicateRegieTour(idx) {
  const data = readRegieTourFields();
  const src = data[idx];
  if (!src) return;
  data.splice(idx + 1, 0, { chargement: src.chargement, dechargement: src.dechargement });
  document.getElementById('fNombreTours').value = data.length;
  syncRegieTourFields(data);
}

// Lit les emplacements départ/arrivée actuellement affichés.
function readRegieTourFields() {
  const rows = document.querySelectorAll('#regieToursList .regie-tour-row');
  return Array.from(rows).map(r => ({
    chargement:   (r.querySelector('.regie-chargement')?.value   || '').trim(),
    dechargement: (r.querySelector('.regie-dechargement')?.value || '').trim()
  }));
}

function escapeAttr(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── Affectation camion à toute la journée ───────────────────────────────────
// Retourne une Map : immat -> { chauffeurName, periode } des camions utilisés
// par d'autres chauffeurs ce jour-là.
// On considère un camion "occupé" pour (chauffeurId, dateISO, periode) si un AUTRE
// chauffeur l'utilise sur la même date et la même période (jour/nuit).
// Si periode === null on considère toutes les périodes confondues.
function getOccupiedVehiclesForDate(dateISO, excludeChauffeurId, periode) {
  const occupied = new Map();
  state.plannings.forEach(p => {
    if (p.date !== dateISO) return;
    const chId = String(p.chauffeurId?._id || p.chauffeurId);
    if (chId === String(excludeChauffeurId)) return;
    const ch = state.chauffeurs.find(c => String(c._id) === chId);
    const chauffeurName = ch ? `${ch.prenom} ${ch.nom}` : '—';
    p.tours.forEach(t => {
      if (!t.immatCamion) return;
      if (periode && t.heurePeriode && t.heurePeriode !== periode) return;
      // Premier conflit gagne (un camion n'a qu'un occupant à signaler)
      if (!occupied.has(t.immatCamion)) {
        occupied.set(t.immatCamion, { chauffeurName, periode: t.heurePeriode || 'journee' });
      }
    });
  });
  return occupied;
}

// ── Détection automatique de l'immat d'un chauffeur ──────────────────────────
// Utilisée à l'ouverture du modal "Nouveau tour" pour pré-remplir le camion :
//  1) ses autres tours du MÊME JOUR qui ont déjà une immat (la plus utilisée) ;
//  2) sinon, son immat la plus récente dans la fenêtre chargée — mais uniquement
//     si ce camion n'est pas déjà affecté à un autre chauffeur ce jour-là.
// Renvoie '' si rien de fiable (l'utilisateur choisit alors comme avant).
function detectImmatForChauffeur(chauffeurId, dateISO) {
  const chId = String(chauffeurId);
  const mine = state.plannings.filter(p => String(p.chauffeurId?._id || p.chauffeurId) === chId);

  // 1) Tours du même jour : son camion du jour est déjà connu.
  const today = mine.find(p => p.date === dateISO);
  if (today) {
    const counts = new Map();
    (today.tours || []).forEach(t => {
      if (t.immatCamion) counts.set(t.immatCamion, (counts.get(t.immatCamion) || 0) + 1);
    });
    let best = '';
    let bestN = 0;
    counts.forEach((n, immat) => { if (n > bestN) { best = immat; bestN = n; } });
    if (best) return best;
  }

  // 2) Son camion habituel : l'immat la plus récente sur les autres jours chargés.
  const recent = mine
    .filter(p => p.date !== dateISO && (p.tours || []).some(t => t.immatCamion))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  for (const p of recent) {
    const withImmat = [...(p.tours || [])].reverse().find(t => t.immatCamion);
    if (!withImmat) continue;
    const occupied = getOccupiedVehiclesForDate(dateISO, chauffeurId, null);
    // Son camion habituel est pris par un autre chauffeur ce jour-là : ne rien
    // suggérer plutôt que suggérer un conflit.
    return occupied.has(withImmat.immatCamion) ? '' : withImmat.immatCamion;
  }
  return '';
}

// Période "dominante" des tours du jour : si tous nuit -> 'nuit', sinon 'journee'
function getDominantPeriode(tours) {
  if (!tours.length) return 'journee';
  const allNight = tours.every(t => t.heurePeriode === 'nuit');
  return allNight ? 'nuit' : 'journee';
}

// ── Helper partagé : construit la liste libre/occupé dans un conteneur ─────
// ctx = { dateISO, excludeChauffeurId, periode, currentImmat }
// onSelect(immat) : callback appelé au clic d'un camion libre
function _buildVehicleList(listEl, ctx, onSelect) {
  listEl.innerHTML = '';
  const occupied = getOccupiedVehiclesForDate(ctx.dateISO, ctx.excludeChauffeurId, ctx.periode);

  const sorted = [...state.vehicules]
    .filter(v => v.immatriculation)
    .sort((a, b) => {
      const aOcc = occupied.has(a.immatriculation);
      const bOcc = occupied.has(b.immatriculation);
      if (aOcc !== bOcc) return aOcc ? 1 : -1;
      return a.immatriculation.localeCompare(b.immatriculation);
    });

  if (sorted.length === 0) {
    listEl.innerHTML = '<div class="atp-empty">Aucun véhicule enregistré.</div>';
    return;
  }

  let freeShown = false, occupiedShown = false;
  sorted.forEach(v => {
    const immat = v.immatriculation;
    const isOccupied = occupied.has(immat);
    const isCurrent = ctx.currentImmat && immat === ctx.currentImmat;

    if (!isOccupied && !freeShown) {
      const h = document.createElement('div');
      h.className = 'atp-section-label';
      h.textContent = 'Disponibles';
      listEl.appendChild(h);
      freeShown = true;
    }
    if (isOccupied && !occupiedShown) {
      const h = document.createElement('div');
      h.className = 'atp-section-label atp-section-label-muted';
      h.textContent = 'Déjà affectés à un autre chauffeur';
      listEl.appendChild(h);
      occupiedShown = true;
    }

    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'atp-item'
      + (isOccupied ? ' is-occupied' : '')
      + (isCurrent ? ' is-current' : '');
    const subLabel = [v.marque, v.modele].filter(Boolean).join(' ');
    const occInfo = isOccupied
      ? `<span class="atp-item-occ">→ ${occupied.get(immat).chauffeurName} (${occupied.get(immat).periode === 'nuit' ? 'nuit' : 'jour'})</span>`
      : '';
    item.innerHTML = `
      <span class="atp-item-immat">${immat}</span>
      ${subLabel ? `<span class="atp-item-sub">${subLabel}</span>` : ''}
      ${occInfo}
    `;
    // Tous les camions sont sélectionnables, même ceux déjà affectés à un autre chauffeur
    item.addEventListener('click', e => {
      e.stopPropagation();
      onSelect(immat);
    });
    listEl.appendChild(item);
  });
}

async function assignVehicleToDay(chauffeurId, dateISO, immat) {
  const planning = getPlanningForCell(chauffeurId, dateISO);
  if (!planning || !planning.tours.length) {
    notify('Aucune tournée à modifier sur cette journée.', 'warning');
    return;
  }
  // Tours à mettre à jour (on ne touche pas ceux qui ont déjà la bonne immat)
  const toUpdate = planning.tours.filter(t => t.immatCamion !== immat);
  if (!toUpdate.length) {
    notify('Toutes les tournées utilisent déjà ce camion.', 'info');
    return;
  }
  // Confirmation si écrasement d'immats différentes
  const willOverwrite = toUpdate.filter(t => t.immatCamion && t.immatCamion !== immat);
  if (willOverwrite.length > 0) {
    const ok = await confirmDialog(
      `${willOverwrite.length} tournée(s) ont déjà un camion différent. Les remplacer par ${immat} ?`,
      { title: 'Remplacer le camion ?', okLabel: 'Remplacer', danger: false }
    );
    if (!ok) return;
  }

  try {
    await Promise.all(
      toUpdate.map(t => updateTour(chauffeurId, dateISO, t._id, { ...t, immatCamion: immat }))
    );
    notify(`Camion ${immat} appliqué à ${toUpdate.length} tournée(s).`, 'success');
    await loadView(true); // affectation enregistrée en arrière-plan, sans spinner
  } catch (e) {
    notify('Erreur affectation : ' + e.message, 'error');
    await loadView(true);
  }
}

// ── Popover "Affecter un camion à la journée" (depuis la cellule) ──────────
let _openAssignPopover = null;
function closeAssignVehiclePopover() {
  if (_openAssignPopover) {
    _openAssignPopover.remove();
    _openAssignPopover = null;
    document.removeEventListener('click', _outsideAssignClick, true);
    document.removeEventListener('keydown', _escAssignClick, true);
  }
}
function _outsideAssignClick(e) {
  if (_openAssignPopover && !_openAssignPopover.contains(e.target)) {
    closeAssignVehiclePopover();
  }
}
function _escAssignClick(e) {
  if (e.key === 'Escape') closeAssignVehiclePopover();
}

function openAssignVehiclePopover(anchorBtn, chauffeurId, dateISO) {
  closeAssignVehiclePopover();
  closeImmatPicker();

  const planning = getPlanningForCell(chauffeurId, dateISO);
  const tours = planning?.tours || [];
  if (!tours.length) {
    notify('Ajoute au moins une tournée avant d\'affecter un camion.', 'warning');
    return;
  }
  const periode = getDominantPeriode(tours);

  const pop = document.createElement('div');
  pop.className = 'assign-truck-popover';
  pop.innerHTML = `
    <div class="atp-header">
      <span class="atp-title">Affecter un camion à la journée</span>
      <button type="button" class="atp-close" aria-label="Fermer">&times;</button>
    </div>
    <div class="atp-sub">${tours.length} tournée(s) · période ${periode === 'nuit' ? 'NUIT' : 'JOUR'}</div>
    <div class="atp-list"></div>
  `;

  _buildVehicleList(
    pop.querySelector('.atp-list'),
    { dateISO, excludeChauffeurId: chauffeurId, periode, currentImmat: null },
    async (immat) => {
      closeAssignVehiclePopover();
      await assignVehicleToDay(chauffeurId, dateISO, immat);
    }
  );

  pop.querySelector('.atp-close').addEventListener('click', closeAssignVehiclePopover);
  pop.addEventListener('click', e => e.stopPropagation());

  document.body.appendChild(pop);
  const rect = anchorBtn.getBoundingClientRect();
  const popW = pop.offsetWidth;
  const popH = pop.offsetHeight;
  let left = rect.left + window.scrollX;
  let top  = rect.bottom + window.scrollY + 6;
  if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;
  if (rect.bottom + popH + 6 > window.innerHeight) {
    top = rect.top + window.scrollY - popH - 6;
  }
  pop.style.left = `${Math.max(8, left)}px`;
  pop.style.top  = `${Math.max(8, top)}px`;

  _openAssignPopover = pop;
  setTimeout(() => {
    document.addEventListener('click', _outsideAssignClick, true);
    document.addEventListener('keydown', _escAssignClick, true);
  }, 0);
}

// ── Picker d'immat dans le modal (création/édition d'un tour) ──────────────
let _openImmatPicker = null;
function closeImmatPicker() {
  if (_openImmatPicker) {
    _openImmatPicker.remove();
    _openImmatPicker = null;
    document.removeEventListener('click', _outsideImmatClick, true);
    document.removeEventListener('keydown', _escImmatClick, true);
  }
}
function _outsideImmatClick(e) {
  if (_openImmatPicker && !_openImmatPicker.contains(e.target)) {
    // Ne pas fermer si on clique sur le trigger ou l'input lui-même
    const trigger = document.getElementById('fImmatPickerBtn');
    const input   = document.getElementById('fImmat');
    if (trigger && trigger.contains(e.target)) return;
    if (input && input === e.target) return;
    closeImmatPicker();
  }
}
function _escImmatClick(e) {
  if (e.key === 'Escape') closeImmatPicker();
}

function refreshImmatPickerIfOpen() {
  if (!_openImmatPicker) return;
  const dateISO = state.currentDate;
  const chauffeurId = state.currentChauffeurId;
  const periode = document.getElementById('fPeriode').value || 'journee';
  const currentImmat = (document.getElementById('fImmat').value || '').trim();
  const listEl = _openImmatPicker.querySelector('.atp-list');
  const subEl  = _openImmatPicker.querySelector('.atp-sub');
  if (subEl) subEl.textContent = `Période ${periode === 'nuit' ? 'NUIT' : 'JOUR'}`;
  _buildVehicleList(
    listEl,
    { dateISO, excludeChauffeurId: chauffeurId, periode, currentImmat },
    (immat) => {
      document.getElementById('fImmat').value = immat;
      closeImmatPicker();
    }
  );
}

function openImmatPicker(anchorEl) {
  closeImmatPicker();
  closeAssignVehiclePopover();

  const dateISO = state.currentDate;
  const chauffeurId = state.currentChauffeurId;
  if (!dateISO || !chauffeurId) return;
  const periode = document.getElementById('fPeriode').value || 'journee';
  const currentImmat = (document.getElementById('fImmat').value || '').trim();

  const pop = document.createElement('div');
  pop.className = 'assign-truck-popover immat-picker-popover';
  pop.innerHTML = `
    <div class="atp-header">
      <span class="atp-title">Choisir un camion</span>
      <button type="button" class="atp-close" aria-label="Fermer">&times;</button>
    </div>
    <div class="atp-sub">Période ${periode === 'nuit' ? 'NUIT' : 'JOUR'}</div>
    <div class="atp-list"></div>
  `;

  _buildVehicleList(
    pop.querySelector('.atp-list'),
    { dateISO, excludeChauffeurId: chauffeurId, periode, currentImmat },
    (immat) => {
      document.getElementById('fImmat').value = immat;
      closeImmatPicker();
    }
  );

  pop.querySelector('.atp-close').addEventListener('click', closeImmatPicker);
  pop.addEventListener('click', e => e.stopPropagation());

  document.body.appendChild(pop);
  const rect = anchorEl.getBoundingClientRect();
  // largeur min = celle de l'input
  const inputEl = document.getElementById('fImmat');
  if (inputEl) {
    const minW = inputEl.getBoundingClientRect().width;
    if (minW > 280) pop.style.width = `${Math.min(minW, 360)}px`;
  }
  const popW = pop.offsetWidth;
  const popH = pop.offsetHeight;
  let left = rect.left + window.scrollX;
  let top  = rect.bottom + window.scrollY + 4;
  if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;
  if (rect.bottom + popH + 4 > window.innerHeight) {
    top = rect.top + window.scrollY - popH - 4;
  }
  pop.style.left = `${Math.max(8, left)}px`;
  pop.style.top  = `${Math.max(8, top)}px`;

  _openImmatPicker = pop;
  setTimeout(() => {
    document.addEventListener('click', _outsideImmatClick, true);
    document.addEventListener('keydown', _escImmatClick, true);
  }, 0);
}

// Greffe (une seule fois) le bouton chevron à droite de #fImmat
function ensureImmatPickerButton() {
  const input = document.getElementById('fImmat');
  if (!input) return;

  // On désactive le datalist natif (il chevauche la popover et n'a pas l'info "déjà affecté")
  if (input.hasAttribute('list')) input.removeAttribute('list');
  input.setAttribute('autocomplete', 'off');

  if (document.getElementById('fImmatPickerBtn')) return; // déjà greffé

  // Wrapper combobox autour de l'input
  const wrapper = document.createElement('div');
  wrapper.className = 'immat-combobox';
  input.parentNode.insertBefore(wrapper, input);
  wrapper.appendChild(input);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'fImmatPickerBtn';
  btn.className = 'immat-combobox-trigger';
  btn.title = 'Voir les camions disponibles';
  btn.setAttribute('aria-label', 'Ouvrir la liste des camions');
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M10 17h4V5H2v12h3"/>
      <path d="M20 17h2v-3.34a4 4 0 0 0-1.17-2.83L19 9h-5"/>
      <path d="M14 17h1"/>
      <circle cx="7.5" cy="17.5" r="2.5"/>
      <circle cx="17.5" cy="17.5" r="2.5"/>
    </svg>
  `;
  btn.addEventListener('click', e => {
    e.stopPropagation();
    if (_openImmatPicker) closeImmatPicker();
    else openImmatPicker(wrapper);
  });
  wrapper.appendChild(btn);
}

// ─── Grille ───────────────────────────────────────────────────────────────────
function getPlanningForCell(chauffeurId, dateISO) {
  return state.plannings.find(p =>
    String(p.chauffeurId?._id || p.chauffeurId) === String(chauffeurId) && p.date === dateISO
  );
}
function filterTours(tours) {
  return tours.filter(t => {
    if (state.hiddenStatut.has(t.statut || 'planifie')) return false;
    if (state.hiddenType.has(t.type)) return false;
    if (state.hiddenPeriode.has(t.heurePeriode || 'journee')) return false;
    if (state.hiddenClient.has(normalizeClientKey(t.client))) return false;
    if (state.hiddenClientSource.has(t.clientSource || 'manuel')) return false;
    return true;
  });
}
function matchesSearch(chauffeur, planningDay) {
  if (!state.searchQuery) return true;
  const q = state.searchQuery.toLowerCase();
  if (`${chauffeur.nom} ${chauffeur.prenom}`.toLowerCase().includes(q)) return true;
  if (!planningDay) return false;
  return planningDay.tours.some(t =>
    (t.client||'').toLowerCase().includes(q) ||
    (t.immatCamion||'').toLowerCase().includes(q) ||
    (t.source||'').toLowerCase().includes(q) ||
    (t.destination||'').toLowerCase().includes(q) ||
    (t.lieuChantier||'').toLowerCase().includes(q)
  );
}
function filterChauffeursWithSearch() {
  if (!state.searchQuery) return state.chauffeurs;
  const q = state.searchQuery.toLowerCase();
  return state.chauffeurs.filter(ch => {
    if (`${ch.nom} ${ch.prenom}`.toLowerCase().includes(q)) return true;
    return getViewDays().some(day => {
      const p = getPlanningForCell(ch._id, toISO(day));
      return p && p.tours.some(t =>
        (t.client||'').toLowerCase().includes(q) ||
        (t.immatCamion||'').toLowerCase().includes(q)
      );
    });
  });
}

function renderTourCard(tour, chauffeurId, dateISO, idx, total) {
  const card = document.createElement('div');
  card.className = `tour-card ${tour.statut}`;
  card.dataset.tourId = tour._id;
  card.dataset.idx    = String(idx);

  // ── Drag : gère à la fois le réordonnement intra-cellule et le déplacement inter-cellule
  card.draggable = true;
  card.addEventListener('dragstart', e => {
    state.drag = { tourId: tour._id, fromChauffeurId: chauffeurId, fromDate: dateISO, fromIdx: idx };
    e.dataTransfer.effectAllowed = 'move';
    // Petit délai pour que le fantôme s'affiche avant d'appliquer la classe
    requestAnimationFrame(() => card.classList.add('dragging'));
  });
  card.addEventListener('dragend', () => card.classList.remove('dragging'));

  // ── Drag over sur une autre CARTE dans la même cellule -> réordonnement visuel
  card.addEventListener('dragover', e => {
    const dragging = state.drag;
    if (!dragging.tourId) return;
    // Même cellule ?
    if (dragging.fromChauffeurId !== chauffeurId || dragging.fromDate !== dateISO) return;
    e.preventDefault();
    e.stopPropagation(); // empêche la cellule de capter l'event
    card.classList.add('drag-over-card');
  });
  card.addEventListener('dragleave', () => card.classList.remove('drag-over-card'));
  card.addEventListener('drop', async e => {
    card.classList.remove('drag-over-card');
    const dragging = state.drag;
    if (!dragging.tourId) return;
    if (dragging.fromChauffeurId !== chauffeurId || dragging.fromDate !== dateISO) return;
    e.preventDefault();
    e.stopPropagation();
    const toIdx = idx;
    const fromIdx = dragging.fromIdx;
    if (fromIdx === toIdx) return;
    state.drag = { tourId:null, fromChauffeurId:null, fromDate:null, fromIdx:null };
    await reorderTour(chauffeurId, dateISO, fromIdx, toIdx);
  });

  const typeLabel    = tour.type === 'tour' ? 'Tour' : 'Régie';
  const periodeLabel = tour.heurePeriode === 'nuit' ? 'NUIT' : 'JOUR';
  const periodeClass = tour.heurePeriode === 'nuit' ? 'tc-badge-nuit' : 'tc-badge-jour';
  const ref = tour.refTransport ? `<div class="tc-ref">${tour.refTransport}</div>` : '';

  let lieuHtml = '';
  if (tour.source)       lieuHtml += `<div class="tc-lieu">${tour.source}</div>`;
  if (tour.destination)  lieuHtml += `<div class="tc-lieu tc-lieu-dest">${tour.destination}</div>`;
  if (tour.type === 'regie' && tour.nombreTours) {
    lieuHtml += `<div class="tc-lieu tc-lieu-tours">${tour.nombreTours} tour${tour.nombreTours > 1 ? 's' : ''} effectué${tour.nombreTours > 1 ? 's' : ''}</div>`;
  }
  if (tour.type === 'regie' && Array.isArray(tour.regieTours) && tour.regieTours.length) {
    tour.regieTours.forEach((rt, i) => {
      if (!rt.chargement && !rt.dechargement) return;
      lieuHtml += `<div class="tc-lieu tc-lieu-regie">T${i + 1} : ${escapeAttr(rt.chargement || '—')} » ${escapeAttr(rt.dechargement || '—')}</div>`;
    });
  }

  card.innerHTML = `
    <div class="tc-top">
      <span class="tc-type">${typeLabel}</span>
      <span class="tc-badge ${periodeClass}">${periodeLabel}</span>
    </div>
    <div class="tc-client">${tour.client || '—'}</div>
    <div class="tc-immat">${tour.immatCamion || ''}</div>
    ${lieuHtml}
    ${ref}
  `;

  // Bouton "dupliquer" — visible au hover en mode édition
  const dupBtn = document.createElement('button');
  dupBtn.type = 'button';
  dupBtn.className = 'tc-duplicate-btn';
  dupBtn.title = 'Dupliquer ce tour';
  dupBtn.setAttribute('aria-label', 'Dupliquer');
  dupBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  dupBtn.addEventListener('mousedown', e => e.stopPropagation()); // pas de drag depuis le bouton
  dupBtn.addEventListener('click', async e => {
    e.stopPropagation(); // ne pas ouvrir le modal d'édition
    await duplicateTour(tour, chauffeurId, dateISO);
  });
  card.appendChild(dupBtn);

  card.addEventListener('click', e => {
    e.stopPropagation();
    openModal('edit', chauffeurId, dateISO, tour);
  });

  return card;
}

function renderGrid() {
  const grid = document.getElementById('planningGrid');
  const days  = getViewDays();
  let visibleToursCount = 0;

  grid.style.gridTemplateColumns = `var(--col-chauffeur) repeat(${days.length}, minmax(var(--cell-min-w), 1fr))`;
  grid.dataset.days = days.length;
  grid.innerHTML = '';

  // En-tête
  const corner = document.createElement('div');
  corner.className = 'grid-corner';
  corner.textContent = 'Chauffeur';
  grid.appendChild(corner);

  days.forEach(day => {
    const th = document.createElement('div');
    th.className = 'grid-day-header' + (isToday(day) ? ' today' : '');
    const numEl = document.createElement('div');
    numEl.className = 'day-num';
    numEl.textContent = day.getDate();
    th.innerHTML = `<div class="day-name">${DAYS_FR[day.getDay()]}</div>`;
    th.appendChild(numEl);
    grid.appendChild(th);
  });

  // Lignes
  filterChauffeursWithSearch().forEach(ch => {
    const chId = ch._id;
    const rowVisible = state.searchQuery
      ? days.some(day => matchesSearch(ch, getPlanningForCell(chId, toISO(day))))
      : true;

    // Cellule chauffeur
    const chCell = document.createElement('div');
    chCell.className = 'chauffeur-cell';
    const initials = `${(ch.prenom||'?')[0]}${(ch.nom||'?')[0]}`.toUpperCase();
    chCell.innerHTML = `
      <div class="chauffeur-avatar">${initials}</div>
      <span class="chauffeur-name">${ch.prenom} ${ch.nom}</span>
    `;
    if (!rowVisible) chCell.style.display = 'none';
    grid.appendChild(chCell);

    // Cellules jours
    days.forEach(day => {
      const dateISO  = toISO(day);
      const planning = getPlanningForCell(chId, dateISO);
      const tours    = planning ? filterTours(planning.tours) : [];
      if (rowVisible) visibleToursCount += tours.length;

      const cell = document.createElement('div');
      cell.className = 'day-cell' + (isWeekend(day) ? ' weekend' : '');
      cell.dataset.chauffeurId = chId;
      cell.dataset.date        = dateISO;

      // Drop target
      cell.addEventListener('dragover', e => {
  e.preventDefault();
  e.dataTransfer.dropEffect = window.draggedImportTour ? 'copy' : 'move';  // <- adapter selon l'origine
  cell.classList.add('drop-target');
});
      cell.addEventListener('dragleave', () => cell.classList.remove('drop-target'));
      cell.addEventListener('drop', async e => {
        cell.classList.remove('drop-target');

        // ── Drop depuis le panneau import PDF ──
        // On le traite DIRECTEMENT ici pour éviter les conflits de propagation.
        if (window.draggedImportTour) {
          e.preventDefault();
          e.stopPropagation();
          if (typeof window.handleImportDropToCell === 'function') {
            await window.handleImportDropToCell(chId, dateISO);
          } else {
            notify('Erreur import : module non chargé. Vérifie que planning-import.js est inclus après planning.js.', 'error');
          }
          return;
        }

        e.preventDefault();

        // ── Déplacement inter-cellule normal ──
        const { tourId, fromChauffeurId, fromDate } = state.drag;
        if (!tourId) return;
        if (fromChauffeurId === chId && fromDate === dateISO) return;
        try {
          await moveTour(fromChauffeurId, fromDate, tourId, chId, dateISO);
          await loadView(true); // déplacement enregistré en arrière-plan, sans spinner
        } catch(err) {
          notify('Erreur déplacement : ' + err.message, 'error');
          await loadView(true);
        } finally {
          state.drag = { tourId:null, fromChauffeurId:null, fromDate:null, fromIdx:null };
        }
      });

      const list = document.createElement('div');
      list.className = 'tour-list';
      tours.forEach((tour, idx) => list.appendChild(renderTourCard(tour, chId, dateISO, idx, tours.length)));

      // Bouton "Affecter camion à la journée" — visible en mode édition si ≥1 tournée
      let assignBtn = null;
      if (tours.length > 0) {
        assignBtn = document.createElement('button');
        assignBtn.className = 'assign-truck-btn';
        assignBtn.title = 'Affecter un camion à toutes les tournées du jour';
        assignBtn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M10 17h4V5H2v12h3"/>
            <path d="M20 17h2v-3.34a4 4 0 0 0-1.17-2.83L19 9h-5"/>
            <path d="M14 17h1"/>
            <circle cx="7.5" cy="17.5" r="2.5"/>
            <circle cx="17.5" cy="17.5" r="2.5"/>
          </svg>
          <span>Affecter camion</span>
        `;
        assignBtn.addEventListener('click', e => {
          e.stopPropagation();
          openAssignVehiclePopover(assignBtn, chId, dateISO);
        });
      }

      const addBtn = document.createElement('button');
      addBtn.className = 'add-tour-btn';
      addBtn.textContent = '+ Ajouter';
      addBtn.addEventListener('click', () => openModal('create', chId, dateISO, null));

      cell.appendChild(list);
      if (assignBtn) cell.appendChild(assignBtn);
      cell.appendChild(addBtn);
      if (!rowVisible) cell.style.display = 'none';
      grid.appendChild(cell);
    });
  });

  updateFilterUI(visibleToursCount);
}

// ─── Label semaine ────────────────────────────────────────────────────────────
function updateWeekLabel() {
  const days  = getViewDays();
  const start = days[0];
  const end   = days[days.length-1];
  document.getElementById('weekLabel').textContent = state.nbDays === 1
    ? start.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' })
    : `${formatDateFR(start)} – ${formatDateFR(end)} ${end.getFullYear()}`;
}

// ─── Chargement ───────────────────────────────────────────────────────────────
// silent = true : rafraîchissement en arrière-plan, sans spinner bloquant
// (utilisé après une action ; le chargement initial / la navigation gardent le loader).
async function loadView(silent = false) {
  if (!silent) showLoader();
  try {
    const days = getViewDays();
    state.plannings = await loadPlannings(toISO(days[0]), toISO(days[days.length-1]));
    renderGrid();
    updateWeekLabel();
  } catch(e) {
    notify('Erreur chargement : ' + e.message, 'error');
  } finally {
    if (!silent) hideLoader();
  }
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function navigatePrev()  { state.viewStart = addDays(state.viewStart, -state.nbDays); loadView(); }
function navigateNext()  { state.viewStart = addDays(state.viewStart,  state.nbDays); loadView(); }
function navigateToday() {
  state.viewStart = state.nbDays === 7 ? getMonday(new Date()) : getToday();
  loadView();
}
function setNbDays(n) {
  state.nbDays = n;
  if (n === 7) state.viewStart = getMonday(state.viewStart);
  document.querySelectorAll('.view-range-btn').forEach(btn =>
    btn.classList.toggle('active', Number(btn.dataset.days) === n)
  );
  loadView();
}

// ─── Modal ────────────────────────────────────────────────────────────────────
function openModal(mode, chauffeurId, dateISO, tour) {
  state.modalMode          = mode;
  state.currentChauffeurId = chauffeurId;
  state.currentDate        = dateISO;
  state.currentTourId      = tour?._id || null;

  const ch = state.chauffeurs.find(c => String(c._id) === String(chauffeurId));
  const dateDisplay = new Date(dateISO+'T00:00:00').toLocaleDateString('fr-FR',
    { weekday:'long', day:'numeric', month:'long' });

  document.getElementById('modalTitle').textContent = mode === 'create'
    ? `Nouveau tour — ${ch ? ch.prenom+' '+ch.nom : ''}, ${dateDisplay}`
    : `Modifier — ${ch ? ch.prenom+' '+ch.nom : ''}, ${dateDisplay}`;

  document.getElementById('modalDelete').style.display = mode === 'edit' ? 'inline-flex' : 'none';

  // Afficher/masquer le bloc statut selon le mode
  const statutBlock = document.getElementById('statutBlock');
  if (statutBlock) statutBlock.style.display = mode === 'edit' ? '' : 'none';

  if (mode === 'edit' && tour) {
    state.currentTourStatut = tour.statut || 'planifie';
    document.querySelector(`input[name="tourType"][value="${tour.type}"]`).checked = true;
    document.getElementById('fStatut').value        = tour.statut        || 'planifie';
    document.getElementById('fClient').value        = tour.client        || '';
    document.getElementById('fImmat').value         = tour.immatCamion   || '';
    document.getElementById('fPeriode').value = tour.heurePeriode || 'journee';
    document.querySelectorAll('input[name="heurePeriode"]').forEach(r => { r.checked = r.value === (tour.heurePeriode || 'journee'); });
    document.getElementById('fSource').value        = tour.source        || '';
    document.getElementById('fDestination').value   = tour.destination   || '';
    document.getElementById('fNombreTours').value   = tour.nombreTours   ?? 0;
    state._regieToursSeed = Array.isArray(tour.regieTours) ? tour.regieTours : [];
    // Régie séparée si on a déjà du détail par tour enregistré.
    state.regieSepare = state._regieToursSeed.length > 0;
    document.getElementById('fRefTransport').value  = tour.refTransport  || '';
    document.getElementById('fNotes').value         = tour.notes         || '';
    document.getElementById('modalMeta').style.display = 'block';
    document.getElementById('modalMetaText').textContent =
      `Créé par ${tour.createdBy} · Modifié par ${tour.updatedBy}`;
  } else {
    state.currentTourStatut = 'planifie';
    document.querySelector('input[name="tourType"][value="tour"]').checked = true;
    document.getElementById('fStatut').value        = 'planifie';
    document.getElementById('fClient').value        = '';
    // Immat pré-remplie depuis les autres tours du chauffeur (jour, sinon récents).
    document.getElementById('fImmat').value         = detectImmatForChauffeur(chauffeurId, dateISO);
    document.getElementById('fPeriode').value = 'journee';
    document.querySelectorAll('input[name="heurePeriode"]').forEach(r => { r.checked = r.value === 'journee'; });
    document.getElementById('fSource').value        = '';
    document.getElementById('fDestination').value   = '';
    document.getElementById('fNombreTours').value   = 0;
    state._regieToursSeed = [];
    state.regieSepare = false;
    document.getElementById('fRefTransport').value  = '';
    document.getElementById('fNotes').value         = '';
    document.getElementById('modalMeta').style.display = 'none';
  }

  updateModalFields();
  syncRegieTourFields(state._regieToursSeed || []);
  ensureImmatPickerButton();
  setTimeout(() => document.getElementById('fClient')?.focus(), 80);
  document.getElementById('tourModal').style.display = 'flex';
}

function closeModal() {
  closeImmatPicker();
  document.getElementById('tourModal').style.display = 'none';
}

// Si le client saisi correspond (insensible casse/accents/espaces) à un client
// déjà existant dans state.clientsList, on réutilise sa forme exacte.
// Évite de créer "MAUFFREY" en double quand "Mauffrey" existe déjà.
function canonicalizeClientName(name) {
  const raw = String(name || '').trim();
  if (!raw) return raw;
  const key = normalizeClientKey(raw);
  if (!key) return raw;
  const existing = (state.clientsList || []).find(c => normalizeClientKey(c) === key);
  return existing || raw;
}

function getFormData() {
  const type = document.querySelector('input[name="tourType"]:checked').value;
  const statut = document.getElementById('fStatut').value || state.currentTourStatut || 'planifie';
  return {
    type,
    statut,
    clientSource:  'manuel', // Le modal ne sert que pour la saisie manuelle (l'import PDF Mauffrey a son propre panneau)
    client:        canonicalizeClientName(document.getElementById('fClient').value),
    immatCamion:   document.getElementById('fImmat').value.trim(),
    heurePeriode:  document.getElementById('fPeriode').value,
    source:        document.getElementById('fSource').value.trim(),
    destination:   document.getElementById('fDestination').value.trim(),
    nombreTours:   type === 'regie'? Math.max(0, parseInt(document.getElementById('fNombreTours').value, 10) || 0) : 0,
    // Détail par tour seulement si la régie est en mode séparé (sinon vide).
    regieTours:    (type === 'regie' && state.regieSepare) ? readRegieTourFields() : [],
    refTransport:  document.getElementById('fRefTransport').value.trim() || null,
    notes:         document.getElementById('fNotes').value.trim(),
  };
}

async function handleSave() {
  const data = getFormData();
  if (!data.client)     { notify('Le client est requis.', 'warning'); return; }

  // On capture le contexte puis on ferme le modal tout de suite : l'enregistrement
  // part en arrière-plan, l'utilisateur ne patiente devant aucun spinner.
  const mode        = state.modalMode;
  const chauffeurId = state.currentChauffeurId;
  const date        = state.currentDate;
  const tourId      = state.currentTourId;
  closeModal();

  try {
    if (mode === 'create') {
      await createTour(chauffeurId, date, data);
    } else {
      await updateTour(chauffeurId, date, tourId, data);
    }
    await loadView(true); // rafraîchit la grille sans spinner
    // Toute sauvegarde depuis le modal est manuelle -> rafraîchir la liste clients/datalist
    state.clientsList = await loadClients();
    populateClientFilter();
  } catch(e) {
    notify('Erreur : ' + e.message, 'error');
    await loadView(true); // resync silencieux pour revenir à un état cohérent
  }
}

async function handleDelete() {
  const ok = await confirmDialog('Cette action est irréversible.', { title: 'Supprimer ce tour ?', okLabel: 'Supprimer', danger: true });
  if (!ok) return;

  const chauffeurId = state.currentChauffeurId;
  const date        = state.currentDate;
  const tourId      = state.currentTourId;
  closeModal();

  try {
    await deleteTour(chauffeurId, date, tourId);
    await loadView(true);
  } catch(e) {
    notify('Erreur : ' + e.message, 'error');
    await loadView(true);
  }
}

// ─── Normalisation client (dédup casse / accents / espaces) ──────────────────
// "Mauffrey", "MAUFFREY", "  mauffrey ", "Mauffréy" -> tous la même clé.
function normalizeClientKey(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Choisit la forme d'affichage la plus "naturelle" parmi des variantes :
// "Mauffrey" (mixte) > "mauffrey" (tout minuscule) > "MAUFFREY" (tout majuscule).
function pickBestDisplayName(names) {
  const score = (s) => {
    const hasLower = /[a-zà-ÿ]/.test(s);
    const hasUpper = /[A-ZÀ-Ý]/.test(s);
    if (hasLower && hasUpper) return 3; // mixte (Title Case, Mauffrey)
    if (hasLower) return 2;             // tout minuscule
    if (hasUpper) return 1;             // tout majuscule (MAUFFREY)
    return 0;
  };
  return names.slice().sort((a, b) => score(b) - score(a))[0];
}

// Dédoublonne une liste de noms de clients (insensible casse/accents/espaces).
// Renvoie un tableau trié alphabétiquement, avec pour chaque clé la meilleure forme d'affichage.
function dedupeClientList(list) {
  const byKey = new Map(); // key -> [variantes vues]
  (list || []).forEach(c => {
    const name = String(c || '').trim();
    if (!name) return;
    const key = normalizeClientKey(name);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(name);
  });
  const out = [];
  byKey.forEach(variants => out.push(pickBestDisplayName(variants)));
  out.sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));
  return out;
}

// ─── Filtres multi-sélection ───────────────────────────────────────────────────
// Chaque filtre est un menu déroulant avec des cases à cocher. On stocke dans le
// state le Set des valeurs MASQUÉES (décochées) ; tout coché = tout affiché.
const FILTER_DEFS = {
  statut: {
    label: 'Statut',
    hiddenKey: 'hiddenStatut',
    options: () => [
      ['planifie', 'Planifié'], ['annule', 'Annulé'], ['chute', 'Chute'],
      ['debord', 'Débord'], ['passage_vide', 'Passage à vide'], ['effectue', 'Effectué'],
    ],
  },
  type: {
    label: 'Type',
    hiddenKey: 'hiddenType',
    options: () => [['tour', 'Tour'], ['regie', 'Régie']],
  },
  periode: {
    label: 'Période',
    hiddenKey: 'hiddenPeriode',
    options: () => [['journee', 'Journée'], ['nuit', 'Nuit']],
  },
  client: {
    label: 'Client',
    hiddenKey: 'hiddenClient',
    // value = clé normalisée, label = forme d'affichage
    options: () => dedupeClientList(state.clientsList).map(c => [normalizeClientKey(c), c]),
  },
  source: {
    label: 'Source',
    hiddenKey: 'hiddenClientSource',
    options: () => [['mauffrey', 'Mauffrey'], ['manuel', 'Manuel']],
  },
};

// (Re)construit le bouton + le panneau d'un filtre dans son conteneur.
function renderMultiFilter(key) {
  const def = FILTER_DEFS[key];
  const container = document.querySelector(`.filter-multi[data-filter="${key}"]`);
  if (!container || !def) return;

  const options  = def.options();
  const hidden   = state[def.hiddenKey];
  const selected = options.filter(([v]) => !hidden.has(v)).length;
  const total    = options.length;
  const allShown = selected === total;

  container.innerHTML = '';

  // Bouton d'ouverture
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'filter-multi-btn' + (allShown ? '' : ' is-active');
  btn.setAttribute('aria-expanded', 'false');
  const lbl = document.createElement('span');
  lbl.className = 'fm-label';
  lbl.textContent = def.label;
  btn.appendChild(lbl);
  if (!allShown) {
    const badge = document.createElement('span');
    badge.className = 'fm-badge';
    badge.textContent = `${selected}/${total}`;
    btn.appendChild(badge);
  }
  btn.insertAdjacentHTML('beforeend',
    '<svg class="fm-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>');
  container.appendChild(btn);

  // Panneau
  const panel = document.createElement('div');
  panel.className = 'filter-multi-panel';
  panel.hidden = true;

  const actions = document.createElement('div');
  actions.className = 'fm-panel-actions';
  const btnAll  = document.createElement('button');
  btnAll.type = 'button'; btnAll.className = 'fm-action'; btnAll.textContent = 'Tout';
  const btnNone = document.createElement('button');
  btnNone.type = 'button'; btnNone.className = 'fm-action'; btnNone.textContent = 'Aucun';
  actions.append(btnAll, btnNone);
  panel.appendChild(actions);

  const list = document.createElement('div');
  list.className = 'fm-options';
  if (options.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'fm-empty';
    empty.textContent = 'Aucune option';
    list.appendChild(empty);
  }
  options.forEach(([value, label]) => {
    const row = document.createElement('label');
    row.className = 'fm-option';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !hidden.has(value);
    cb.addEventListener('change', () => {
      if (cb.checked) hidden.delete(value); else hidden.add(value);
      renderGrid();
      refreshMultiFilterButton(key); // maj badge/surlignage sans fermer le panneau
    });
    const span = document.createElement('span');
    span.textContent = label;
    row.append(cb, span);
    list.appendChild(row);
  });
  panel.appendChild(list);
  container.appendChild(panel);

  // Actions Tout / Aucun
  btnAll.addEventListener('click', () => {
    hidden.clear();
    list.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = true; });
    renderGrid();
    refreshMultiFilterButton(key);
  });
  btnNone.addEventListener('click', () => {
    options.forEach(([v]) => hidden.add(v));
    list.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = false; });
    renderGrid();
    refreshMultiFilterButton(key);
  });

  // Ouverture / fermeture
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = !panel.hidden;
    closeAllFilterPanels();
    if (!isOpen) {
      panel.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      container.classList.add('open');
    }
  });
  panel.addEventListener('click', e => e.stopPropagation());
}

// Met à jour le badge + surlignage du bouton d'un filtre (panneau laissé ouvert).
function refreshMultiFilterButton(key) {
  const def = FILTER_DEFS[key];
  const container = document.querySelector(`.filter-multi[data-filter="${key}"]`);
  if (!container || !def) return;
  const options  = def.options();
  const hidden   = state[def.hiddenKey];
  const selected = options.filter(([v]) => !hidden.has(v)).length;
  const total    = options.length;
  const allShown = selected === total;
  const btn = container.querySelector('.filter-multi-btn');
  if (!btn) return;
  btn.classList.toggle('is-active', !allShown);
  let badge = btn.querySelector('.fm-badge');
  if (allShown) {
    badge?.remove();
  } else {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'fm-badge';
      btn.querySelector('.fm-label').insertAdjacentElement('afterend', badge);
    }
    badge.textContent = `${selected}/${total}`;
  }
}

function closeAllFilterPanels() {
  document.querySelectorAll('.filter-multi').forEach(c => {
    const panel = c.querySelector('.filter-multi-panel');
    if (panel) panel.hidden = true;
    c.classList.remove('open');
    c.querySelector('.filter-multi-btn')?.setAttribute('aria-expanded', 'false');
  });
}

function buildAllFilters() {
  Object.keys(FILTER_DEFS).forEach(renderMultiFilter);
}

// Reconstruit le filtre Client (liste dynamique) + la datalist du modal de saisie.
function populateClientFilter() {
  renderMultiFilter('client');
  const dl = document.getElementById('clientSuggestions');
  if (!dl) return;
  dl.innerHTML = '';
  dedupeClientList(state.clientsList).forEach(c => {
    const opt = document.createElement('option'); opt.value = c; dl.appendChild(opt);
  });
}

// Met à jour le compteur de tournées affichées.
function updateFilterUI(visibleCount) {
  const anyHidden = ['hiddenStatut', 'hiddenType', 'hiddenPeriode', 'hiddenClient', 'hiddenClientSource']
    .some(k => state[k].size > 0);
  const anyActive = anyHidden || !!state.searchQuery;
  const countEl = document.getElementById('filterCount');
  if (countEl) {
    countEl.textContent = (anyActive && typeof visibleCount === 'number')
      ? `${visibleCount} tournée${visibleCount > 1 ? 's' : ''} affichée${visibleCount > 1 ? 's' : ''}`
      : '';
  }
}

// Réinitialise tous les filtres (hors recherche, qui a son propre bouton ✕).
function resetFilters() {
  ['hiddenStatut', 'hiddenType', 'hiddenPeriode', 'hiddenClient', 'hiddenClientSource']
    .forEach(k => state[k].clear());
  buildAllFilters();
  renderGrid();
}

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  showLoader();
  try {
    const [chauffeursData, clients, vehiculesData] = await Promise.all([
      loadChauffeurs(), loadClients(), loadVehicules()
    ]);
    state.chauffeurs  = Array.isArray(chauffeursData) ? chauffeursData : (chauffeursData.drivers||[]);
    state.clientsList = clients;
    state.vehicules   = Array.isArray(vehiculesData)  ? vehiculesData  : (vehiculesData.vehicles||[]);
    populateClientFilter();
    buildImmatDatalist();
    await loadView();
  } catch(e) {
    console.error(e);
    notify('Erreur chargement initial : ' + e.message, 'error');
  } finally {
    hideLoader();
  }
}

// Fonctions exposées pour planning-import.js
window.createTour = createTour;
window.loadView = loadView;
window.showLoader = showLoader;
window.hideLoader = hideLoader;

// ─── Event listeners ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  if (typeof requireAuth === 'function') {
    const ok = await requireAuth();
    if (!ok) return;
  }

  document.getElementById('btnPrev').addEventListener('click', navigatePrev);
  document.getElementById('btnNext').addEventListener('click', navigateNext);
  document.getElementById('btnToday').addEventListener('click', navigateToday);

  document.querySelectorAll('.view-range-btn').forEach(btn =>
    btn.addEventListener('click', () => setNbDays(Number(btn.dataset.days)))
  );

  document.getElementById('editToggle').addEventListener('change', e => {
    state.editMode = e.target.checked;
    document.body.classList.toggle('edit-mode', state.editMode);
    renderGrid();
  });

  let searchTimer;
  const searchInput = document.getElementById('searchInput');
  const searchClear = document.getElementById('searchClear');
  searchInput.addEventListener('input', e => {
    const val = e.target.value;
    if (searchClear) searchClear.style.display = val ? '' : 'none';
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.searchQuery = val.trim(); renderGrid(); }, 300);
  });
  searchClear?.addEventListener('click', () => {
    searchInput.value = '';
    searchClear.style.display = 'none';
    state.searchQuery = '';
    renderGrid();
    searchInput.focus();
  });

  // Construction initiale des filtres multi-sélection (statut, type, période, source).
  // Le filtre Client est (re)construit par populateClientFilter() une fois les clients chargés.
  buildAllFilters();
  document.getElementById('btnResetFilters').addEventListener('click', resetFilters);
  // Fermer les panneaux de filtre au clic en dehors
  document.addEventListener('click', () => closeAllFilterPanels());

  // Champs dynamiques Tour/Régie
  document.querySelectorAll('input[name="tourType"]').forEach(r =>
    r.addEventListener('change', updateModalFields)
  );

  // Régie : ajuster le nombre d'emplacements départ/arrivée
  document.getElementById('fNombreTours').addEventListener('input', () => {
    if (state.regieSepare) syncRegieTourFields();
  });
  // Régie : bascule groupée <-> séparée
  document.getElementById('btnSeparerRegie').addEventListener('click', toggleRegieSepare);
  // Régie : ajouter un tour (bouton sous la liste)
  document.getElementById('addRegieTourBtn')?.addEventListener('click', addRegieTour);
  // Régie : dupliquer / supprimer un tour (délégation : la liste est régénérée)
  document.getElementById('regieToursList').addEventListener('click', e => {
    const dup = e.target.closest('.regie-dup-btn');
    if (dup) { duplicateRegieTour(parseInt(dup.dataset.idx, 10)); return; }
    const del = e.target.closest('.regie-del-btn');
    if (del) removeRegieTour(parseInt(del.dataset.idx, 10));
  });

  // Si la popover camion est ouverte et qu'on change la période -> on rafraîchit la liste libre/occupé
  document.querySelectorAll('input[name="heurePeriode"]').forEach(r =>
    r.addEventListener('change', refreshImmatPickerIfOpen)
  );

  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('modalCancel').addEventListener('click', closeModal);
  document.getElementById('modalSave').addEventListener('click', handleSave);
  document.getElementById('modalDelete').addEventListener('click', handleDelete);
  document.getElementById('tourModal').addEventListener('click', e => {
    if (e.target === document.getElementById('tourModal')) closeModal();
  });

  // Auto-scroll pendant les opérations drag (tournée déplacée près d'un bord d'écran)
  document.addEventListener('dragstart', startDragAutoScroll, true);
  document.addEventListener('dragend',   stopDragAutoScroll,  true);
  document.addEventListener('drop',      stopDragAutoScroll,  true);

  init();
});
