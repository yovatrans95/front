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
  filterStatut: '',
  filterType:   '',
  filterClient: '',
  modalMode:    'create',
  currentChauffeurId: null,
  currentDate:  null,
  currentTourId: null,
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

  // Supprimer de la source
  await deleteTour(fromChauffeurId, fromDate, tourId);

  // Créer dans la destination (sans _id, sans createdBy/updatedBy — le backend les injecte)
  const { _id, createdBy, updatedBy, createdAt, updatedAt, __v, ...tourData } = tour;
  await createTour(toChauffeurId, toDate, tourData);
}

// Dupliquer : crée une copie d'un tour dans la même cellule (même chauffeur, même date)
async function duplicateTour(tour, chauffeurId, dateISO) {
  // On retire les champs propres à l'instance (id, audit, version) avant POST
  const { _id, createdBy, updatedBy, createdAt, updatedAt, __v, ...data } = tour;
  showLoader();
  try {
    await createTour(chauffeurId, dateISO, data);
    await loadView();
  } catch (e) {
    notify('Erreur duplication : ' + e.message, 'error');
  } finally {
    hideLoader();
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
  // Sync backend : PATCH ordre (le backend doit supporter un champ "ordre" ou on recrée)
  // Approche simple : on envoie un PATCH avec le champ ordre sur chaque tour modifié
  // Si votre backend ne supporte pas encore l'ordre, cette ligne est un no-op silencieux
  try {
    await planningFetch(`/planning/${chauffeurId}/${date}/reorder`, {
      method: 'PATCH',
      body: JSON.stringify({ ordre: tours.map(t => t._id) })
    });
  } catch(e) {
    // Silencieux si la route n'existe pas encore — l'ordre est quand même en mémoire
    console.warn('Route /reorder non disponible, ordre local uniquement :', e.message);
  }
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
  document.getElementById('fieldsLieux').style.display = type === 'tour' ? '' : 'none';
  document.getElementById('fieldChantier').style.display = type === 'regie' ? '' : 'none';
}

// ─── Grille ───────────────────────────────────────────────────────────────────
function getPlanningForCell(chauffeurId, dateISO) {
  return state.plannings.find(p =>
    String(p.chauffeurId?._id || p.chauffeurId) === String(chauffeurId) && p.date === dateISO
  );
}
function filterTours(tours) {
  return tours.filter(t => {
    if (state.filterStatut && t.statut !== state.filterStatut) return false;
    if (state.filterType   && t.type   !== state.filterType)   return false;
    if (state.filterClient && t.client !== state.filterClient) return false;
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
  if (tour.type === 'tour') {
    if (tour.source)       lieuHtml += `<div class="tc-lieu">${tour.source}</div>`;
    if (tour.destination)  lieuHtml += `<div class="tc-lieu tc-lieu-dest">${tour.destination}</div>`;
  } else {
    if (tour.lieuChantier) lieuHtml += `<div class="tc-lieu">${tour.lieuChantier}</div>`;
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
        showLoader();
        try {
          await moveTour(fromChauffeurId, fromDate, tourId, chId, dateISO);
          await loadView();
        } catch(err) {
          notify('Erreur déplacement : ' + err.message, 'error');
        } finally {
          hideLoader();
          state.drag = { tourId:null, fromChauffeurId:null, fromDate:null, fromIdx:null };
        }
      });

      const list = document.createElement('div');
      list.className = 'tour-list';
      tours.forEach((tour, idx) => list.appendChild(renderTourCard(tour, chId, dateISO, idx, tours.length)));

      const addBtn = document.createElement('button');
      addBtn.className = 'add-tour-btn';
      addBtn.textContent = '+ Ajouter';
      addBtn.addEventListener('click', () => openModal('create', chId, dateISO, null));

      cell.appendChild(list);
      cell.appendChild(addBtn);
      if (!rowVisible) cell.style.display = 'none';
      grid.appendChild(cell);
    });
  });
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
async function loadView() {
  showLoader();
  try {
    const days = getViewDays();
    state.plannings = await loadPlannings(toISO(days[0]), toISO(days[days.length-1]));
    renderGrid();
    updateWeekLabel();
  } catch(e) {
    notify('Erreur chargement : ' + e.message, 'error');
  } finally {
    hideLoader();
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
    document.getElementById('fChantier').value      = tour.lieuChantier  || '';
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
    document.getElementById('fImmat').value         = '';
    document.getElementById('fPeriode').value = 'journee';
    document.querySelectorAll('input[name="heurePeriode"]').forEach(r => { r.checked = r.value === 'journee'; });
    document.getElementById('fSource').value        = '';
    document.getElementById('fDestination').value   = '';
    document.getElementById('fChantier').value      = '';
    document.getElementById('fRefTransport').value  = '';
    document.getElementById('fNotes').value         = '';
    document.getElementById('modalMeta').style.display = 'none';
  }

  updateModalFields();
  setTimeout(() => document.getElementById('fClient')?.focus(), 80);
  document.getElementById('tourModal').style.display = 'flex';
}

function closeModal() {
  document.getElementById('tourModal').style.display = 'none';
}

function getFormData() {
  const type = document.querySelector('input[name="tourType"]:checked').value;
  const statut = document.getElementById('fStatut').value || state.currentTourStatut || 'planifie';
  return {
    type,
    statut,
    clientSource:  'manuel', // Le modal ne sert que pour la saisie manuelle (l'import PDF Mauffrey a son propre panneau)
    client:        document.getElementById('fClient').value.trim(),
    immatCamion:   document.getElementById('fImmat').value.trim(),
    heurePeriode:  document.getElementById('fPeriode').value,
    source:        type === 'tour' ? document.getElementById('fSource').value.trim()      : '',
    destination:   type === 'tour' ? document.getElementById('fDestination').value.trim() : '',
    lieuChantier:  type === 'regie'? document.getElementById('fChantier').value.trim()    : '',
    refTransport:  document.getElementById('fRefTransport').value.trim() || null,
    notes:         document.getElementById('fNotes').value.trim(),
  };
}

async function handleSave() {
  const data = getFormData();
  if (!data.client)     { notify('Le client est requis.', 'warning'); return; }
  if (!data.immatCamion) { notify("L'immatriculation est requise.", 'warning'); return; }

  showLoader();
  try {
    if (state.modalMode === 'create') {
      await createTour(state.currentChauffeurId, state.currentDate, data);
    } else {
      await updateTour(state.currentChauffeurId, state.currentDate, state.currentTourId, data);
    }
    closeModal();
    await loadView();
    // Toute sauvegarde depuis le modal est manuelle -> rafraîchir la liste clients/datalist
    state.clientsList = await loadClients();
    populateClientFilter();
  } catch(e) {
    notify('Erreur : ' + e.message, 'error');
  } finally {
    hideLoader();
  }
}

async function handleDelete() {
  const ok = await confirmDialog('Cette action est irréversible.', { title: 'Supprimer ce tour ?', okLabel: 'Supprimer', danger: true });
  if (!ok) return;
  showLoader();
  try {
    await deleteTour(state.currentChauffeurId, state.currentDate, state.currentTourId);
    closeModal();
    await loadView();
  } catch(e) {
    notify('Erreur : ' + e.message, 'error');
  } finally {
    hideLoader();
  }
}

// ─── Filtres ──────────────────────────────────────────────────────────────────
function populateClientFilter() {
  const sel = document.getElementById('filterClient');
  const cur = sel.value;
  sel.innerHTML = '<option value="">Tous les clients</option>';
  state.clientsList.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c; opt.textContent = c;
    sel.appendChild(opt);
  });
  sel.value = cur;
  const dl = document.getElementById('clientSuggestions');
  if (!dl) return;
  dl.innerHTML = '';
  state.clientsList.forEach(c => {
    const opt = document.createElement('option'); opt.value = c; dl.appendChild(opt);
  });
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
  document.getElementById('searchInput').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.searchQuery = e.target.value.trim(); renderGrid(); }, 300);
  });

  document.getElementById('filterStatut').addEventListener('change', e => { state.filterStatut = e.target.value; renderGrid(); });
  document.getElementById('filterType').addEventListener('change',   e => { state.filterType   = e.target.value; renderGrid(); });
  document.getElementById('filterClient').addEventListener('change', e => { state.filterClient  = e.target.value; renderGrid(); });

  // Champs dynamiques Tour/Régie
  document.querySelectorAll('input[name="tourType"]').forEach(r =>
    r.addEventListener('change', updateModalFields)
  );

  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('modalCancel').addEventListener('click', closeModal);
  document.getElementById('modalSave').addEventListener('click', handleSave);
  document.getElementById('modalDelete').addEventListener('click', handleDelete);
  document.getElementById('tourModal').addEventListener('click', e => {
    if (e.target === document.getElementById('tourModal')) closeModal();
  });

  init();
});
