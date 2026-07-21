/**
 * planning-print.js — Yovatrans Planning
 * ─────────────────────────────────────────────────────────────────────────────
 * Génération des feuilles de tournée chauffeur en PDF (1 chauffeur / page).
 *
 * Dépendances (à charger AVANT ce script dans planning.html) :
 *   - jsPDF      : window.jspdf.jsPDF
 *   - autotable  : enregistré automatiquement sur jsPDF.prototype
 *
 * Dépend aussi de planning.js (utilise state, getPlanningForCell, notify, …).
 * ─────────────────────────────────────────────────────────────────────────────
 */
'use strict';

(function () {
  // ─── Configuration ───────────────────────────────────────────────────────────
  // Pour afficher ton vrai logo sur chaque feuille, remplis `logoUrl` :
  //   - soit avec une dataURL base64 :  'data:image/png;base64,iVBORw0KG...'
  //   - soit avec une URL accessible :  '/img/logo-yovatrans.png' (même origine)
  // Tant que c'est null, un placeholder neutre est dessiné à la place.
  const CONFIG = {
    logoUrl:      "img/yov.png",
    logoSize:     28,    // taille du logo en mm (essaie 24 à 36 selon ton image)
    brandName:    'YOVATRANS',
    brandTagline: 'Transport & logistique',
  };

  // ─── Constantes ──────────────────────────────────────────────────────────────
  const STATUT_LABELS = {
    planifie:     'Planifié',
    annule:       'Annulé',
    chute:        'Chute',
    debord:       'Débord',
    passage_vide: 'Passage à vide',
    effectue:     'Effectué',
  };

  // Libellés courts (utilisés dans la colonne Statut du PDF, où la largeur est limitée)
  const STATUT_LABELS_SHORT = {
    planifie:     'Planifié',
    annule:       'Annulé',
    chute:        'Chute',
    debord:       'Débord',
    passage_vide: 'Pass. vide',
    effectue:     'Effectué',
  };

  // Couleur du texte par statut (cellule colorée dans le tableau)
  const STATUT_PDF_COLOR = {
    planifie:     [29, 78, 216],    // bleu
    effectue:     [21, 128, 61],    // vert
    annule:       [120, 113, 108],  // gris
    chute:        [194, 65, 12],    // orange foncé
    debord:       [185, 28, 28],    // rouge
    passage_vide: [126, 34, 206],   // violet
  };

  const DAYS_FULL_FR = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];

  // Charge une URL d'image et la renvoie en dataURL base64 (pour jsPDF.addImage)
  // Renvoie null si l'image n'a pas pu être chargée (image manquante, CORS, etc).
  function loadImageAsDataURL(url) {
    return new Promise(resolve => {
      if (!url) return resolve(null);
      if (typeof url === 'string' && url.startsWith('data:')) return resolve(url);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          canvas.getContext('2d').drawImage(img, 0, 0);
          resolve(canvas.toDataURL('image/png'));
        } catch (e) { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  // ─── Nettoyage texte (lignes Mauffrey mal extraites + flèches unicode) ──────
  // L'import PDF Mauffrey produit parfois du texte lettre-par-lettre :
  //   "R é s i d u  B r o y a g e · V E O L I A"
  // jsPDF en helvetica (WinAnsi) ne sait pas non plus rendre → (U+2192) etc.
  // Cette fonction recolle les lettres isolées et normalise les caractères.
  function cleanText(s) {
    if (s == null) return '';
    let t = String(s);

    // Flèches unicode -> »  (WinAnsi compatible)
    t = t.replace(/[\u2190-\u21FF]/g, '»');
    // Guillemets courbes -> droits
    t = t.replace(/[\u2018\u2019\u201A\u201B]/g, "'");
    t = t.replace(/[\u201C\u201D\u201E\u201F]/g, '"');
    // Tirets longs -> tiret simple
    t = t.replace(/[\u2013\u2014]/g, '-');

    // Recoller les lignes "L e t t r e" (ligne par ligne pour préserver les \n)
    t = t.split('\n').map(fixLineSpacing).join('\n');

    // Espaces multiples -> simple, trim
    t = t.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim();
    return t;
  }

  // Heuristique : si une ligne est majoritairement composée de "mots" d'1 caractère,
  // on les concatène tous puis on ré-insère des espaces aux frontières détectables :
  //   - minuscule → majuscule  ("BroyageAutomobile" → "Broyage Automobile")
  //   - séquence MAJ + MajMin   ("VEOLIAClaye"     → "VEOLIA Claye")
  //   - chiffre ↔ lettre        ("730Dugny"        → "730 Dugny")
  //   - autour du · (séparateur Mauffrey)
  function fixLineSpacing(line) {
    const tokens = line.split(' ').filter(Boolean);
    if (tokens.length < 4) return line;
    const singles = tokens.filter(tk => tk.length === 1).length;
    // Seuil : >55% des tokens sont des caractères isolés
    if (singles / tokens.length < 0.55) return line;

    let s = tokens.join('');
    // Frontières mot probables (min/maj inclut les accents)
    s = s.replace(/([a-zà-ÿ])([A-ZÀ-Ý])/g, '$1 $2');
    s = s.replace(/([A-ZÀ-Ý]{2,})([A-ZÀ-Ý][a-zà-ÿ])/g, '$1 $2');
    s = s.replace(/([a-zA-ZÀ-ÿ])(\d)/g, '$1 $2');
    s = s.replace(/(\d)([a-zA-ZÀ-ÿ])/g, '$1 $2');
    // Espace autour des séparateurs / ponctuations collées
    s = s.replace(/([a-zA-Z0-9À-ÿ])\(/g, '$1 (');
    s = s.replace(/\)([a-zA-Z0-9À-ÿ])/g, ') $1');
    s = s.replace(/·/g, ' · ');
    return s.replace(/\s+/g, ' ').trim();
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────
  function formatDateLongFR(dateISO) {
    const d = new Date(dateISO + 'T00:00:00');
    return d.toLocaleDateString('fr-FR', {
      weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
    });
  }

  function formatDateShortFR(dateISO) {
    const d = new Date(dateISO + 'T00:00:00');
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function formatNowFR() {
    return new Date().toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  // Filtres additionnels (type tour/régie, période jour/nuit) partagés par le
  // panneau d'export. null = pas de filtre. Réglés avant chaque génération/liste.
  let exportFilter = { types: null, periodes: null };
  function passesExtra(t) {
    if (exportFilter.types && exportFilter.types.length && !exportFilter.types.includes(t.type)) return false;
    if (exportFilter.periodes && exportFilter.periodes.length && !exportFilter.periodes.includes(t.heurePeriode || 'journee')) return false;
    return true;
  }

  // Renvoie tous les chauffeurs ayant au moins une tournée à la date donnée
  // dont le statut est dans `statuts` (tableau, ex: ['planifie','effectue']).
  // Si statuts est absent ou vide, on retombe sur ['planifie'] (comportement historique).
  function getChauffeursAvecTournees(dateISO, statuts) {
    const allowed = (Array.isArray(statuts) && statuts.length) ? statuts : ['planifie'];
    const chs = [];
    state.chauffeurs.forEach(ch => {
      const planning = (typeof getPlanningForCell === 'function')
        ? getPlanningForCell(ch._id, dateISO)
        : state.plannings.find(p =>
            String(p.chauffeurId?._id || p.chauffeurId) === String(ch._id)
            && p.date === dateISO
          );
      if (!planning || !planning.tours) return;
      const tours = planning.tours.filter(t => allowed.includes(t.statut) && passesExtra(t));
      if (tours.length > 0) {
        chs.push({ chauffeur: ch, tours: tours });
      }
    });
    // Tri alphabétique nom puis prénom
    chs.sort((a, b) =>
      (a.chauffeur.nom || '').localeCompare(b.chauffeur.nom || '') ||
      (a.chauffeur.prenom || '').localeCompare(b.chauffeur.prenom || '')
    );
    return chs;
  }

  // Normalise un nom de client pour dédoublonner les variantes de casse / accents / espaces.
  // "Mauffrey", "MAUFFREY", "  mauffrey ", "Mauffréy" -> tous la même clé.
  // Le nom *affiché* reste celui rencontré en premier (on ne change pas la mise en forme).
  function normalizeClientKey(name) {
    return String(name || '')
      .normalize('NFD')                 // décompose les accents
      .replace(/[\u0300-\u036f]/g, '')  // supprime les diacritiques
      .replace(/\s+/g, ' ')             // espaces multiples -> simple
      .trim()
      .toLowerCase();
  }

  // Renvoie les clients ayant au moins une tournée à la date donnée dont le statut
  // est dans `statuts`. Chaque tour est annoté avec son chauffeur (champ `_chauffeur`)
  // afin que la page PDF "par client" puisse afficher qui a fait la tournée.
  // Les variantes de casse/accents/espaces sur le même client sont fusionnées.
  function getClientsAvecTournees(dateISO, statuts) {
    const allowed = (Array.isArray(statuts) && statuts.length) ? statuts : ['planifie'];
    // clé normalisée -> { client (affichage), key, tours: [{...tour, _chauffeur}] }
    const byKey = new Map();
    state.chauffeurs.forEach(ch => {
      const planning = (typeof getPlanningForCell === 'function')
        ? getPlanningForCell(ch._id, dateISO)
        : state.plannings.find(p =>
            String(p.chauffeurId?._id || p.chauffeurId) === String(ch._id)
            && p.date === dateISO
          );
      if (!planning || !planning.tours) return;
      planning.tours.forEach(t => {
        if (!allowed.includes(t.statut) || !passesExtra(t)) return;
        const rawName = (t.client || '').trim() || '(Sans client)';
        const key     = normalizeClientKey(rawName) || '(sans client)';
        if (!byKey.has(key)) {
          byKey.set(key, { client: rawName, key, tours: [] });
        }
        byKey.get(key).tours.push(Object.assign({}, t, { _chauffeur: ch }));
      });
    });
    const arr = Array.from(byKey.values());
    arr.sort((a, b) => a.client.localeCompare(b.client));
    // Pour chaque client, on trie les tours par nom de chauffeur pour la lisibilité
    arr.forEach(grp => {
      grp.tours.sort((a, b) => {
        const an = `${a._chauffeur.nom || ''} ${a._chauffeur.prenom || ''}`;
        const bn = `${b._chauffeur.nom || ''} ${b._chauffeur.prenom || ''}`;
        return an.localeCompare(bn);
      });
    });
    return arr;
  }

  // Heure de prise de poste déduite des tournées : la plus petite heureDebut
  // renseignée parmi les tournées non annulées (même logique que la popup WhatsApp).
  function getHeurePriseFromTours(tours) {
    const heures = (tours || [])
      .filter(t => t.statut !== 'annule' && t.heureDebut)
      .map(t => t.heureDebut)
      .sort();
    return heures[0] || '';
  }

  // Camion "principal" de la journée = immat la plus représentée
  function getCamionPrincipal(tours) {
    const count = {};
    tours.forEach(t => {
      if (t.immatCamion) count[t.immatCamion] = (count[t.immatCamion] || 0) + 1;
    });
    const entries = Object.entries(count);
    if (!entries.length) return '—';
    entries.sort((a, b) => b[1] - a[1]);
    // Si plusieurs camions différents, on liste les immat uniques
    if (entries.length === 1) return entries[0][0];
    return entries.map(e => e[0]).join(' / ');
  }

  // ─── Panneau latéral d'export (PDF feuille de tournée OU Excel) ───────────────
  function buildPrintModal() {
    document.getElementById('printSheetModal')?.remove();

    const defaultDateISO = state.currentDate
      || (state.viewStart ? toISO(state.viewStart) : toISO(new Date()));
    const days = (typeof getViewDays === 'function') ? getViewDays() : [];
    const defFrom = days.length ? toISO(days[0]) : defaultDateISO;
    const defTo   = days.length ? toISO(days[days.length - 1]) : defaultDateISO;

    const lbl = 'font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--text-muted); font-weight:600; margin-bottom:8px; display:block;';
    const chip = 'display:inline-flex; align-items:center; gap:6px; padding:5px 10px; border:1px solid var(--border); border-radius:6px; background:var(--bg); cursor:pointer; font-size:12.5px;';

    const overlay = document.createElement('div');
    overlay.className = 'export-drawer-overlay';
    overlay.id = 'printSheetModal';
    overlay.innerHTML = `
      <div class="export-drawer" role="dialog" aria-label="Exporter le planning">
        <div class="export-drawer-head">
          <h2 class="modal-title" style="margin:0;">Exporter le planning</h2>
          <button class="modal-close" id="printModalClose">&times;</button>
        </div>

        <div class="export-drawer-body">

          <!-- Format -->
          <div style="margin-bottom:18px;">
            <label style="${lbl}">Format</label>
            <div class="export-format-toggle">
              <label><input type="radio" name="exportFormat" value="pdf" checked /> <span>Feuille de tournée (PDF)</span></label>
              <label><input type="radio" name="exportFormat" value="excel" /> <span>Excel (.xlsx)</span></label>
            </div>
          </div>

          <!-- Période : 1 date (PDF) ou plage (Excel) -->
          <div id="exportDatePdf" style="margin-bottom:18px;">
            <label style="${lbl}">Date</label>
            <input type="date" id="printDate" value="${defaultDateISO}" style="font-size:15px; font-weight:600;" />
          </div>
          <div id="exportDateExcel" style="margin-bottom:18px; display:none;">
            <label style="${lbl}">Période</label>
            <div style="display:flex; gap:10px; align-items:center;">
              <input type="date" id="exportFrom" value="${defFrom}" style="font-size:14px;" />
              <span style="color:var(--text-muted); font-size:13px;">au</span>
              <input type="date" id="exportTo" value="${defTo}" style="font-size:14px;" />
            </div>
          </div>

          <!-- Statuts -->
          <div style="margin-bottom:16px;">
            <label style="${lbl}">Statuts à inclure</label>
            <div id="printStatutsList" style="display:flex; flex-wrap:wrap; gap:6px 10px;">
              ${Object.entries(STATUT_LABELS).map(([key, label]) => `
                <label style="${chip}">
                  <input type="checkbox" data-statut="${key}" ${key === 'planifie' ? 'checked' : ''}
                         style="width:14px; height:14px; cursor:pointer; accent-color: var(--text);" />
                  ${label}
                </label>`).join('')}
            </div>
          </div>

          <!-- Type + Période (jour/nuit) -->
          <div style="display:flex; gap:24px; flex-wrap:wrap; margin-bottom:16px;">
            <div>
              <label style="${lbl}">Type</label>
              <div id="exportTypeList" style="display:flex; gap:8px;">
                <label style="${chip}"><input type="checkbox" data-type="tour" checked style="width:14px;height:14px;accent-color:var(--text);" /> Tour</label>
                <label style="${chip}"><input type="checkbox" data-type="regie" checked style="width:14px;height:14px;accent-color:var(--text);" /> Régie</label>
              </div>
            </div>
            <div>
              <label style="${lbl}">Période</label>
              <div id="exportPeriodeList" style="display:flex; gap:8px;">
                <label style="${chip}"><input type="checkbox" data-periode="journee" checked style="width:14px;height:14px;accent-color:var(--text);" /> Jour</label>
                <label style="${chip}"><input type="checkbox" data-periode="nuit" checked style="width:14px;height:14px;accent-color:var(--text);" /> Nuit</label>
              </div>
            </div>
          </div>

          <!-- Regroupement (PDF uniquement) -->
          <div id="exportGroupSection" style="margin-bottom:16px;">
            <label style="${lbl}">Regroupement / filtre</label>
            <div style="display:flex; gap:18px;">
              <label style="display:inline-flex; align-items:center; gap:6px; cursor:pointer; font-size:13px;">
                <input type="radio" name="printGroupMode" value="chauffeur" checked style="width:15px; height:15px; accent-color: var(--text);" /> Chauffeur
              </label>
              <label style="display:inline-flex; align-items:center; gap:6px; cursor:pointer; font-size:13px;">
                <input type="radio" name="printGroupMode" value="client" style="width:15px; height:15px; accent-color: var(--text);" /> Client
              </label>
            </div>
          </div>

          <!-- Sélection (PDF uniquement) -->
          <div id="exportSelectionSection" style="margin-bottom:6px;">
            <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:8px;">
              <label style="font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--text-muted); font-weight:600; margin:0;">
                <span id="printListLabel">Chauffeurs</span> <span id="printChauffeurCount" style="color:var(--text-subtle); font-weight:500;"></span>
              </label>
              <div style="display:flex; gap:4px;">
                <button type="button" id="printSelectAll" style="padding:3px 9px; font-size:11px; background:transparent; border:1px solid var(--border); border-radius:5px; color:var(--text-muted); cursor:pointer; font-family:inherit;">Tout cocher</button>
                <button type="button" id="printSelectNone" style="padding:3px 9px; font-size:11px; background:transparent; border:1px solid var(--border); border-radius:5px; color:var(--text-muted); cursor:pointer; font-family:inherit;">Tout décocher</button>
              </div>
            </div>
            <div id="printChauffeurList" style="max-height: 280px; overflow-y: auto; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg);">
              <div style="text-align:center; color:var(--text-muted); padding:24px; font-size:13px;">Chargement…</div>
            </div>
          </div>

        </div>

        <div class="export-drawer-foot">
          <button class="btn btn-ghost"   id="printModalCancel">Annuler</button>
          <button class="btn btn-primary" id="printModalGenerate">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px; margin-right:6px;">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            <span id="printGenerateLabel">Télécharger le PDF</span>
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));

    // ── Listeners ─────────────────────────────────────────────────────────────
    const close = () => { overlay.classList.remove('open'); setTimeout(() => overlay.remove(), 200); };
    document.getElementById('printModalClose').addEventListener('click', close);
    document.getElementById('printModalCancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    // Bascule format -> affiche le bon sélecteur de date + relibelle le bouton
    function applyFormat() {
      const fmt = getSelectedFormat();
      document.getElementById('exportDatePdf').style.display   = fmt === 'pdf' ? '' : 'none';
      document.getElementById('exportDateExcel').style.display = fmt === 'excel' ? '' : 'none';
      // Le regroupement/sélection chauffeur·client ne concerne que le PDF.
      // L'Excel exporte tout selon date + statuts + type + période.
      document.getElementById('exportGroupSection').style.display     = fmt === 'pdf' ? '' : 'none';
      document.getElementById('exportSelectionSection').style.display = fmt === 'pdf' ? '' : 'none';
      document.getElementById('printGenerateLabel').textContent = fmt === 'excel' ? 'Télécharger l\'Excel' : 'Télécharger le PDF';
      if (fmt === 'pdf') refreshList();
    }
    document.querySelectorAll('input[name="exportFormat"]').forEach(r => r.addEventListener('change', applyFormat));

    ['printDate', 'exportFrom', 'exportTo'].forEach(id =>
      document.getElementById(id)?.addEventListener('change', () => refreshList()));
    document.querySelectorAll('#printStatutsList input, #exportTypeList input, #exportPeriodeList input, input[name="printGroupMode"]')
      .forEach(cb => cb.addEventListener('change', () => refreshList()));

    document.getElementById('printSelectAll').addEventListener('click', () =>
      document.querySelectorAll('#printChauffeurList input[type="checkbox"]').forEach(cb => cb.checked = true));
    document.getElementById('printSelectNone').addEventListener('click', () =>
      document.querySelectorAll('#printChauffeurList input[type="checkbox"]').forEach(cb => cb.checked = false));

    document.getElementById('printModalGenerate').addEventListener('click', async () => {
      const fmt = getSelectedFormat();
      const statuts = getSelectedStatuts();
      if (!statuts.length) { notify('Sélectionne au moins un statut.', 'warning'); return; }

      syncExportFilter();
      try {
        if (typeof showLoader === 'function') showLoader();
        if (fmt === 'excel') {
          // Excel : pas de regroupement chauffeur/client — on exporte tout ce
          // qui passe les filtres date + statuts + type + période.
          const fromISO = document.getElementById('exportFrom').value;
          const toISO   = document.getElementById('exportTo').value;
          if (!fromISO || !toISO) { notify('Choisis une période.', 'warning'); return; }
          if (typeof window.ensurePlanningsRange === 'function') await window.ensurePlanningsRange(fromISO, toISO);
          await window.exportPlanningExcel({
            fromISO, toISO, statuts,
            types: getSelectedTypes(), periodes: getSelectedPeriodes()
          });
        } else {
          const dateISO = document.getElementById('printDate').value;
          if (!dateISO) { notify('Choisis une date.', 'warning'); return; }
          const mode = getSelectedGroupMode();
          const checked = Array.from(document.querySelectorAll('#printChauffeurList input[type="checkbox"]:checked')).map(cb => cb.dataset.itemId);
          if (!checked.length) { notify(mode === 'client' ? 'Sélectionne au moins un client.' : 'Sélectionne au moins un chauffeur.', 'warning'); return; }
          await ensurePlanningsLoadedFor(dateISO);
          await generatePDF(dateISO, checked, statuts, mode);
        }
        close();
      } catch (e) {
        notify('Erreur export : ' + e.message, 'error');
      } finally {
        if (typeof hideLoader === 'function') hideLoader();
      }
    });

    applyFormat();   // initialise l'affichage + premier remplissage de la liste
  }

  // Recopie les filtres type/période du panneau dans exportFilter (utilisé par
  // getChauffeursAvecTournees / getClientsAvecTournees, donc PDF + listes).
  function syncExportFilter() {
    const types = getSelectedTypes();
    const periodes = getSelectedPeriodes();
    exportFilter.types = types.length ? types : null;
    exportFilter.periodes = periodes.length ? periodes : null;
  }

  function getSelectedFormat() {
    const r = document.querySelector('input[name="exportFormat"]:checked');
    return (r && r.value) || 'pdf';
  }
  function getSelectedTypes() {
    return Array.from(document.querySelectorAll('#exportTypeList input:checked')).map(cb => cb.dataset.type);
  }
  function getSelectedPeriodes() {
    return Array.from(document.querySelectorAll('#exportPeriodeList input:checked')).map(cb => cb.dataset.periode);
  }

  // Lit les statuts cochés dans la modal
  function getSelectedStatuts() {
    return Array.from(document.querySelectorAll('#printStatutsList input[type="checkbox"]:checked'))
      .map(cb => cb.dataset.statut);
  }

  // Lit le mode de regroupement choisi
  function getSelectedGroupMode() {
    const r = document.querySelector('input[name="printGroupMode"]:checked');
    return (r && r.value) || 'chauffeur';
  }

  // Rafraîchit la liste de sélection (chauffeurs/clients) selon format + filtres.
  // PDF : basée sur la date choisie. Excel : agrégée sur la plage du/au.
  function refreshList() {
    const listEl  = document.getElementById('printChauffeurList');
    const countEl = document.getElementById('printChauffeurCount');
    const labelEl = document.getElementById('printListLabel');
    if (!listEl) return;

    syncExportFilter(); // type/période -> exportFilter (filtre les collecteurs)
    // En Excel, la sélection chauffeur/client est masquée : rien à rendre.
    if (getSelectedFormat() !== 'pdf') return;
    const statuts = getSelectedStatuts();
    const mode    = getSelectedGroupMode();
    if (labelEl) labelEl.textContent = mode === 'client' ? 'Clients' : 'Chauffeurs';

    if (!statuts.length) {
      if (countEl) countEl.textContent = '';
      listEl.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding:32px 16px; font-size:13px;">Coche au moins un statut pour voir la liste.</div>`;
      return;
    }

    listEl.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding:24px; font-size:13px;">Chargement…</div>`;

    const dateISO = document.getElementById('printDate').value;
    if (!dateISO) return;
    ensurePlanningsLoadedFor(dateISO).then(() => {
      const items = mode === 'client'
        ? getClientsAvecTournees(dateISO, statuts)
        : getChauffeursAvecTournees(dateISO, statuts);
      if (mode === 'client') renderClientList(items, listEl, countEl);
      else                   renderChauffeurList(items, listEl, countEl);
    });
  }

  function renderChauffeurList(items, listEl, countEl) {

    if (countEl) {
      countEl.textContent = items.length
        ? `· ${items.length} avec tournée${items.length > 1 ? 's' : ''}`
        : '';
    }

    if (!items.length) {
      listEl.innerHTML = `
        <div style="text-align:center; color:var(--text-muted); padding:32px 16px; font-size:13px;">
          Aucune tournée pour cette date avec les statuts choisis.
        </div>`;
      return;
    }

    listEl.innerHTML = items.map(({ chauffeur, tours }) => {
      const nbTours  = tours.length;
      const camion   = getCamionPrincipal(tours);
      const initials = `${(chauffeur.prenom||'?')[0]}${(chauffeur.nom||'?')[0]}`.toUpperCase();
      const cid      = chauffeur._id;
      return `
        <label class="print-ch-item" data-id="${cid}"
               style="display:flex; align-items:center; gap:12px; padding:10px 12px;
                      cursor:pointer; border-bottom:1px solid var(--border-light);
                      transition: background .12s;"
               onmouseenter="this.style.background='var(--surface)'"
               onmouseleave="this.style.background=''">
          <input type="checkbox" data-item-id="${cid}" checked
                 style="width:16px; height:16px; cursor:pointer; flex-shrink:0; accent-color: var(--text);" />
          <div style="width:34px; height:34px; border-radius:50%;
                      background: var(--text); color:#fff;
                      display:flex; align-items:center; justify-content:center;
                      font-size:12px; font-weight:700; flex-shrink:0;">
            ${initials}
          </div>
          <div style="flex:1; min-width:0;">
            <div style="font-weight:600; font-size:13.5px; color:var(--text);">
              ${chauffeur.prenom} ${chauffeur.nom}
            </div>
            <div style="font-size:11.5px; color:var(--text-muted); margin-top:1px;">
              ${nbTours} tournée${nbTours>1?'s':''} · ${camion}
            </div>
          </div>
        </label>
      `;
    }).join('');

    bindRowClicks(listEl);
  }

  function renderClientList(items, listEl, countEl) {

    if (countEl) {
      countEl.textContent = items.length
        ? `· ${items.length} client${items.length > 1 ? 's' : ''}`
        : '';
    }

    if (!items.length) {
      listEl.innerHTML = `
        <div style="text-align:center; color:var(--text-muted); padding:32px 16px; font-size:13px;">
          Aucun client avec tournée pour cette date / ces statuts.
        </div>`;
      return;
    }

    listEl.innerHTML = items.map(({ client, key, tours }) => {
      const nbTours    = tours.length;
      // Liste unique des chauffeurs concernés
      const chauffeurs = Array.from(new Set(
        tours.map(t => `${t._chauffeur.prenom || ''} ${t._chauffeur.nom || ''}`.trim())
      )).filter(Boolean);
      const chauffeursLabel = chauffeurs.length <= 3
        ? chauffeurs.join(', ')
        : `${chauffeurs.slice(0, 3).join(', ')}… (+${chauffeurs.length - 3})`;
      const initials = (client.match(/\b\w/g) || ['?']).slice(0, 2).join('').toUpperCase();
      // L'ID utilisé pour la sélection est la clé normalisée (insensible casse/accents)
      const safeId = key.replace(/"/g, '&quot;');
      return `
        <label class="print-ch-item" data-id="${safeId}"
               style="display:flex; align-items:center; gap:12px; padding:10px 12px;
                      cursor:pointer; border-bottom:1px solid var(--border-light);
                      transition: background .12s;"
               onmouseenter="this.style.background='var(--surface)'"
               onmouseleave="this.style.background=''">
          <input type="checkbox" data-item-id="${safeId}" checked
                 style="width:16px; height:16px; cursor:pointer; flex-shrink:0; accent-color: var(--text);" />
          <div style="width:34px; height:34px; border-radius:8px;
                      background: var(--text); color:#fff;
                      display:flex; align-items:center; justify-content:center;
                      font-size:11px; font-weight:700; flex-shrink:0;">
            ${initials}
          </div>
          <div style="flex:1; min-width:0;">
            <div style="font-weight:600; font-size:13.5px; color:var(--text);
                        white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
              ${client}
            </div>
            <div style="font-size:11.5px; color:var(--text-muted); margin-top:1px;
                        white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
              ${nbTours} tournée${nbTours>1?'s':''} · ${chauffeursLabel || '—'}
            </div>
          </div>
        </label>
      `;
    }).join('');

    bindRowClicks(listEl);
  }

  // Helper : clic n'importe où sur la ligne -> toggle la checkbox
  function bindRowClicks(listEl) {
    listEl.querySelectorAll('.print-ch-item').forEach(row => {
      row.addEventListener('click', e => {
        if (e.target.tagName !== 'INPUT') {
          const cb = row.querySelector('input[type="checkbox"]');
          if (cb) cb.checked = !cb.checked;
        }
      });
    });
  }

  // Si la date demandée n'est pas dans la vue actuelle, recharge le planning de ce jour
  async function ensurePlanningsLoadedFor(dateISO) {
    const hasIt = state.plannings.some(p => p.date === dateISO);
    if (hasIt) return;
    try {
      // On recharge juste ce jour (start = end)
      const data = await planningFetch(`/planning?startDate=${dateISO}&endDate=${dateISO}`);
      // On merge dans state.plannings (en évitant les doublons)
      const others = state.plannings.filter(p => p.date !== dateISO);
      state.plannings = [...others, ...(Array.isArray(data) ? data : [])];
    } catch (e) {
      console.warn('Impossible de charger le planning pour', dateISO, e);
    }
  }

  // ─── Chargement dynamique des libs PDF (si absentes) ─────────────────────────
  // Évite d'avoir à modifier planning.html : si jsPDF/autotable ne sont pas là,
  // on les charge depuis le CDN au moment où on en a besoin.
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      // Si déjà présent dans le DOM, on attend juste son chargement éventuel
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        if (existing.dataset.loaded === '1') return resolve();
        existing.addEventListener('load',  () => resolve());
        existing.addEventListener('error', () => reject(new Error('Échec chargement ' + src)));
        return;
      }
      const s = document.createElement('script');
      s.src   = src;
      s.async = true;
      s.addEventListener('load',  () => { s.dataset.loaded = '1'; resolve(); });
      s.addEventListener('error', () => reject(new Error('Échec chargement ' + src)));
      document.head.appendChild(s);
    });
  }

  async function ensurePdfLibsLoaded() {
    const jsPDFReady     = () => !!(window.jspdf && window.jspdf.jsPDF);
    const autoTableReady = () => {
      if (!jsPDFReady()) return false;
      // autotable s'enregistre sur le prototype de jsPDF
      try { return typeof (new window.jspdf.jsPDF()).autoTable === 'function'; }
      catch { return false; }
    };

    if (!jsPDFReady()) {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    }
    if (!autoTableReady()) {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js');
    }

    if (!jsPDFReady())     throw new Error('jsPDF n\'a pas pu être chargé (CDN bloqué ?).');
    if (!autoTableReady()) throw new Error('jspdf-autotable n\'a pas pu être chargé (CDN bloqué ?).');
  }

  // ─── Génération du PDF ───────────────────────────────────────────────────────
  async function generatePDF(dateISO, selectedIds, statuts, mode) {
    await ensurePdfLibsLoaded();
    const { jsPDF } = window.jspdf;

    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const pageW = doc.internal.pageSize.getWidth();   // 210
    const pageH = doc.internal.pageSize.getHeight();  // 297
    const margin = 12;

    // On charge le logo (si défini) une seule fois pour tout le PDF
    const logoData = await loadImageAsDataURL(CONFIG.logoUrl);

    if (mode === 'client') {
      // ── 1 page par client ───────────────────────────────────────────────
      const items = getClientsAvecTournees(dateISO, statuts)
        .filter(({ key }) => selectedIds.includes(key));

      if (!items.length) {
        notify('Aucune tournée à imprimer avec ces critères.', 'warning');
        return;
      }

      const totalPages = items.length;
      items.forEach(({ client, tours }, pageIdx) => {
        if (pageIdx > 0) doc.addPage();
        drawHeader(doc, pageW, margin, dateISO, logoData, 'FEUILLE PAR CLIENT');
        const yAfterInfo = drawInfoBlockClient(doc, client, tours, margin, pageW);
        drawToursTableForClient(doc, tours, yAfterInfo + 4, margin, pageW, pageH);
        drawFooter(doc, pageW, pageH, margin, pageIdx + 1, totalPages);
      });

      const filename = `feuilles-par-client_${dateISO}.pdf`;
      doc.save(filename);
      notify(`PDF généré (${items.length} client${items.length > 1 ? 's' : ''}).`, 'success');
      return;
    }

    // ── Mode par défaut : 1 page par chauffeur ────────────────────────────
    const items = getChauffeursAvecTournees(dateISO, statuts)
      .filter(({ chauffeur }) => selectedIds.includes(String(chauffeur._id)));

    if (!items.length) {
      notify('Aucune tournée à imprimer avec ces critères.', 'warning');
      return;
    }

    const totalPages = items.length;
    items.forEach(({ chauffeur, tours }, pageIdx) => {
      if (pageIdx > 0) doc.addPage();
      drawHeader(doc, pageW, margin, dateISO, logoData, 'FEUILLE DE TOURNÉE');
      const yAfterInfo = drawInfoBlock(doc, chauffeur, dateISO, tours, margin, pageW);
      drawToursTable(doc, tours, yAfterInfo + 4, margin, pageW, pageH);
      drawFooter(doc, pageW, pageH, margin, pageIdx + 1, totalPages);
    });

    const filename = `feuilles-tournee_${dateISO}.pdf`;
    doc.save(filename);
    notify(`PDF généré (${items.length} chauffeur${items.length > 1 ? 's' : ''}).`, 'success');
  }

  // ── En-tête : logo + brand + titre, version sobre noir/gris ──────────────────
  function drawHeader(doc, pageW, margin, dateISO, logoData, title) {
    const baseY = margin;
    const logoSize = CONFIG.logoSize || 28;

    // ── Logo à gauche ──
    if (logoData) {
      try {
        doc.addImage(logoData, 'PNG', margin, baseY, logoSize, logoSize);
      } catch (e) {
        drawLogoPlaceholder(doc, margin, baseY, logoSize);
      }
    } else {
      drawLogoPlaceholder(doc, margin, baseY, logoSize);
    }

    // ── Bloc texte brand juste à droite du logo (centré verticalement) ──
    const centerY = baseY + logoSize / 2;
    const textX = margin + logoSize + 6;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(19);
    doc.setTextColor(26, 29, 35);
    doc.text(CONFIG.brandName, textX, centerY - 0.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(120, 124, 132);
    doc.text(CONFIG.brandTagline, textX, centerY + 5);

    // ── Titre à droite (aligné verticalement avec le brand) ──
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12.5);
    doc.setTextColor(26, 29, 35);
    doc.text(title || 'FEUILLE DE TOURNÉE', pageW - margin, centerY - 0.5, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(107, 114, 128);
    doc.text(formatDateLongFR(dateISO), pageW - margin, centerY + 5, { align: 'right' });

    // ── Trait de séparation ──
    doc.setDrawColor(220, 222, 228);
    doc.setLineWidth(0.4);
    doc.line(margin, baseY + logoSize + 4, pageW - margin, baseY + logoSize + 4);
  }

  // Placeholder neutre quand aucun logo n'est fourni
  function drawLogoPlaceholder(doc, x, y, size) {
    doc.setDrawColor(180, 184, 192);
    doc.setLineWidth(0.4);
    doc.setFillColor(245, 246, 248);
    doc.roundedRect(x, y, size, size, 2.5, 2.5, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(150, 154, 162);
    doc.text('LOGO', x + size / 2, y + size / 2 + 1.2, { align: 'center' });
  }

  // ── Bloc info chauffeur / prise de poste / camion (sobre, sans fond coloré) ──
  function drawInfoBlock(doc, chauffeur, dateISO, tours, margin, pageW, heurePrise) {
    // baseY = margin + logoSize + trait (+4) + un peu d'air (+6)
    const y0 = margin + (CONFIG.logoSize || 28) + 10;
    const w = pageW - margin * 2;
    // Trois colonnes : chauffeur · prise de poste · camion(s)
    const col1 = w * 0.42;
    const col2 = w * 0.24;
    const x2 = margin + col1;         // début colonne prise de poste
    const x3 = margin + col1 + col2;  // début colonne camion
    const h = 16;

    // Pas de fond, juste des blocs de texte séparés par des traits verticaux fins
    doc.setDrawColor(230, 232, 236);
    doc.setLineWidth(0.3);
    doc.line(x2, y0 + 1, x2, y0 + h - 1);
    doc.line(x3, y0 + 1, x3, y0 + h - 1);

    // Labels (petits, en uppercase, gris)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(140, 144, 152);
    doc.text('CHAUFFEUR',      margin, y0 + 3);
    doc.text('PRISE DE POSTE', x2 + 4, y0 + 3);
    doc.text('CAMION(S)',      x3 + 4, y0 + 3);

    // Valeur chauffeur
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(26, 29, 35);
    const chauffeurName = `${chauffeur.prenom || ''} ${chauffeur.nom || ''}`.trim() || '—';
    doc.text(chauffeurName, margin, y0 + 9);

    // Sous-info : téléphone + nb tournées
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(120, 124, 132);
    const sub = [
      chauffeur.telephone ? `Tél. ${chauffeur.telephone}` : null,
      `${tours.length} tournée${tours.length > 1 ? 's' : ''}`
    ].filter(Boolean).join('  ·  ');
    doc.text(sub, margin, y0 + 14);

    // Valeur prise de poste (heure passée par la popup WhatsApp, sinon déduite
    // de la première heureDebut des tournées)
    const prise = heurePrise || getHeurePriseFromTours(tours);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(26, 29, 35);
    doc.text(prise || '—', x2 + 4, y0 + 9);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(120, 124, 132);
    doc.text('Heure d\'arrivée', x2 + 4, y0 + 14);

    // Valeur camion
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(26, 29, 35);
    const camion = getCamionPrincipal(tours);
    const camionLines = doc.splitTextToSize(camion, w - col1 - col2 - 8);
    doc.text(camionLines[0] || '—', x3 + 4, y0 + 9);
    if (camionLines.length > 1) {
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(120, 124, 132);
      doc.text(camionLines.slice(1).join(' '), x3 + 4, y0 + 14);
    }

    return y0 + h;
  }

  // ── Construction des lignes du tableau pour une tournée ──────────────────────
  // `personName` = contenu de la 4e colonne (client en mode chauffeur,
  // chauffeur en mode client). `startNum` = numéro de la première ligne
  // produite (la numérotation continue sur tout le tableau).
  //
  // Une régie est ÉCLATÉE comme des tours : une ligne complète par tour.
  //   - regieTours détaillés  -> une ligne par tour (chargement » déchargement)
  //   - sinon nombreTours = N -> N lignes identiques (source » destination)
  //   - sinon                 -> une seule ligne (comme un tour normal)
  function buildTourRows(t, startNum, personName) {
    const periode = (t.heurePeriode || 'journee').toUpperCase() === 'NUIT' ? 'NUIT' : 'JOUR';

    // Cellule statut colorée
    const statutKey   = t.statut || 'planifie';
    const statutLabel = STATUT_LABELS_SHORT[statutKey] || statutKey;
    const statutColor = STATUT_PDF_COLOR[statutKey]    || [26, 29, 35];
    const statutCell  = {
      content: statutLabel,
      styles: { textColor: statutColor, fontStyle: 'bold' },
    };

    const s = cleanText(t.source) || '—';
    const d = cleanText(t.destination) || '—';
    const lieuMission = `${s}\n» ${d}`;

    const camion = t.immatCamion || '—';
    const ref    = t.refTransport || '';
    const notes  = cleanText(t.notes);
    const extras = [];
    if (ref)   extras.push(`Réf: ${ref}`);
    if (notes) extras.push(`Note: ${notes}`);
    const extra = extras.join('\n');

    const rows = [];
    let n = startNum;

    if (t.type === 'regie') {
      const detail = Array.isArray(t.regieTours)
        ? t.regieTours.filter(rt => rt.chargement || rt.dechargement)
        : [];
      const nb = Math.max(Number(t.nombreTours) || 0, detail.length, 1);

      // Une ligne complète par tour de régie, numérotée comme les tours
      for (let k = 0; k < nb; k++) {
        const rt   = detail[k];
        const lieu = rt
          ? `${cleanText(rt.chargement) || '—'}\n» ${cleanText(rt.dechargement) || '—'}`
          : lieuMission;
        const typeCell = nb > 1 ? `RÉGIE T${k + 1}\n${periode}` : `RÉGIE\n${periode}`;
        // Réf / notes uniquement sur la première ligne pour ne pas surcharger
        rows.push([String(n++), typeCell, statutCell, personName, lieu, camion, k === 0 ? extra : '']);
      }
    } else {
      rows.push([String(n++), `TOUR\n${periode}`, statutCell, personName, lieuMission, camion, extra]);
    }

    return rows;
  }

  // ── Tableau des tournées (sobre, monochrome) ──────────────────────────────────
  function drawToursTable(doc, tours, yStart, margin, pageW, pageH) {
    // Une ligne par tour : les régies sont éclatées comme des tours normaux
    const body = [];
    tours.forEach((t) => {
      body.push(...buildTourRows(t, body.length + 1, cleanText(t.client) || '—'));
    });

    // Titre de section (compte les lignes = les tours réels)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(26, 29, 35);
    doc.text(`TOURNÉES (${body.length})`, margin, yStart + 4);

    doc.setDrawColor(26, 29, 35);
    doc.setLineWidth(0.4);
    doc.line(margin, yStart + 5.5, pageW - margin, yStart + 5.5);

    const tableStartY = yStart + 8;

    if (!tours.length) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(10);
      doc.setTextColor(156, 163, 175);
      doc.text('Aucune tournée à afficher (les annulées sont masquées).',
        margin, tableStartY + 8);
      return tableStartY + 12;
    }

    doc.autoTable({
      startY: tableStartY,
      head: [['#', 'Type', 'Statut', "Donneur d'ordre ", 'Trajet / Chantier', 'Camion', 'Réf · Notes']],
      body: body,
      margin: { left: margin, right: margin },
      styles: {
        font:        'helvetica',
        fontSize:    9,
        cellPadding: 2.8,
        lineColor:   [220, 222, 228],
        lineWidth:   0.2,
        valign:      'top',
        textColor:   [26, 29, 35],
      },
      headStyles: {
        fillColor:   [26, 29, 35],   // noir doux
        textColor:   [255, 255, 255],
        fontStyle:   'bold',
        fontSize:    8.5,
        halign:      'left',
      },
      alternateRowStyles: { fillColor: [250, 250, 251] },
      columnStyles: {
        0: { cellWidth: 8,  halign: 'center', fontStyle: 'bold' },
        1: { cellWidth: 19, halign: 'center', fontStyle: 'bold', fontSize: 8 },
        2: { cellWidth: 18, halign: 'center', fontSize: 8.5 },
        3: { cellWidth: 32, fontStyle: 'bold' },
        4: { cellWidth: 'auto' },
        5: { cellWidth: 22, halign: 'center', font: 'courier', fontSize: 9 },
        6: { cellWidth: 38, fontSize: 8, textColor: [107, 114, 128] },
      },
    });

    return doc.lastAutoTable.finalY;
  }

  // ── Bloc info CLIENT (mode regroupement par client) ─────────────────────────
  function drawInfoBlockClient(doc, clientName, tours, margin, pageW) {
    const y0 = margin + (CONFIG.logoSize || 28) + 10;
    const w = pageW - margin * 2;
    const colW = w / 2;
    const h = 16;

    // Trait de séparation vertical entre les deux colonnes
    doc.setDrawColor(230, 232, 236);
    doc.setLineWidth(0.3);
    doc.line(margin + colW, y0 + 1, margin + colW, y0 + h - 1);

    // Labels
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(140, 144, 152);
    doc.text('CLIENT', margin, y0 + 3);
    doc.text('CHAUFFEUR(S)', margin + colW + 4, y0 + 3);

    // Valeur client (peut être longue -> tronquer à la largeur)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(26, 29, 35);
    const clientLines = doc.splitTextToSize(cleanText(clientName) || '—', colW - 6);
    doc.text(clientLines[0] || '—', margin, y0 + 9);

    // Sous-info : nb tournées
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(120, 124, 132);
    doc.text(`${tours.length} tournée${tours.length > 1 ? 's' : ''}`, margin, y0 + 14);

    // Valeur chauffeur(s) : liste unique
    const uniqueChauffeurs = Array.from(new Set(
      tours.map(t => `${t._chauffeur?.prenom || ''} ${t._chauffeur?.nom || ''}`.trim())
    )).filter(Boolean);
    const chauffeurStr = uniqueChauffeurs.join(', ') || '—';

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(26, 29, 35);
    const chLines = doc.splitTextToSize(chauffeurStr, colW - 6);
    doc.text(chLines[0] || '—', margin + colW + 4, y0 + 9);
    if (chLines.length > 1) {
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(120, 124, 132);
      doc.text(chLines.slice(1).join(' '), margin + colW + 4, y0 + 14);
    } else {
      // Sous-info : nombre de chauffeurs distincts
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(120, 124, 132);
      doc.text(`${uniqueChauffeurs.length} chauffeur${uniqueChauffeurs.length > 1 ? 's' : ''}`,
        margin + colW + 4, y0 + 14);
    }

    return y0 + h;
  }

  // ── Tableau des tournées en mode client (col Chauffeur à la place de l'ordre client) ──
  function drawToursTableForClient(doc, tours, yStart, margin, pageW, pageH) {
    // Une ligne par tour, colonne 4 = chauffeur ; régies éclatées comme des tours
    const body = [];
    tours.forEach((t) => {
      const ch = t._chauffeur;
      const chauffeurName = ch ? `${ch.prenom || ''} ${ch.nom || ''}`.trim() : '—';
      body.push(...buildTourRows(t, body.length + 1, chauffeurName));
    });

    // Titre de section (compte les lignes = les tours réels)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(26, 29, 35);
    doc.text(`TOURNÉES (${body.length})`, margin, yStart + 4);

    doc.setDrawColor(26, 29, 35);
    doc.setLineWidth(0.4);
    doc.line(margin, yStart + 5.5, pageW - margin, yStart + 5.5);

    const tableStartY = yStart + 8;

    if (!tours.length) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(10);
      doc.setTextColor(156, 163, 175);
      doc.text('Aucune tournée à afficher.', margin, tableStartY + 8);
      return tableStartY + 12;
    }

    doc.autoTable({
      startY: tableStartY,
      head: [['#', 'Type', 'Statut', 'Chauffeur', 'Trajet / Chantier', 'Camion', 'Réf · Notes']],
      body: body,
      margin: { left: margin, right: margin },
      styles: {
        font:        'helvetica',
        fontSize:    9,
        cellPadding: 2.8,
        lineColor:   [220, 222, 228],
        lineWidth:   0.2,
        valign:      'top',
        textColor:   [26, 29, 35],
      },
      headStyles: {
        fillColor:   [26, 29, 35],
        textColor:   [255, 255, 255],
        fontStyle:   'bold',
        fontSize:    8.5,
        halign:      'left',
      },
      alternateRowStyles: { fillColor: [250, 250, 251] },
      columnStyles: {
        0: { cellWidth: 8,  halign: 'center', fontStyle: 'bold' },
        1: { cellWidth: 19, halign: 'center', fontStyle: 'bold', fontSize: 8 },
        2: { cellWidth: 18, halign: 'center', fontSize: 8.5 },
        3: { cellWidth: 32, fontStyle: 'bold' },
        4: { cellWidth: 'auto' },
        5: { cellWidth: 22, halign: 'center', font: 'courier', fontSize: 9 },
        6: { cellWidth: 38, fontSize: 8, textColor: [107, 114, 128] },
      },
    });

    return doc.lastAutoTable.finalY;
  }
  function drawFooter(doc, pageW, pageH, margin, pageNum, totalPages) {
    const y = pageH - 8;
    doc.setDrawColor(226, 228, 233);
    doc.setLineWidth(0.2);
    doc.line(margin, y - 3, pageW - margin, y - 3);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(156, 163, 175);
    doc.text(`Imprimé le ${formatNowFR()}`, margin, y);
    doc.text(`Page ${pageNum}/${totalPages}`, pageW - margin, y, { align: 'right' });
    doc.text('Yovatrans · Document interne', pageW / 2, y, { align: 'center' });
  }

  // ─── Bouton dans le header ───────────────────────────────────────────────────
  function injectPrintButton() {
    if (document.getElementById('printSheetBtn')) return;

    const btn = document.createElement('button');
    btn.id = 'printSheetBtn';
    btn.className = 'nav-btn import-toggle-btn'; // réutilise le style existant
    btn.title = 'Exporter le planning (PDF feuilles de tournée ou Excel)';
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      Exporter
    `;
    btn.addEventListener('click', () => buildPrintModal());

    // On insère juste après le bouton "Import PDF" pour rester cohérent
    const importBtn = document.getElementById('importPanelToggle');
    if (importBtn && importBtn.parentNode) {
      importBtn.parentNode.insertBefore(btn, importBtn.nextSibling);
    } else {
      // Fallback : on l'ajoute dans le cluster d'outils du header
      document.querySelector('.header-tools')?.prepend(btn);
    }
  }

  // ─── Feuille de tournée d'UN chauffeur en base64 (pour envoi WhatsApp) ───────
  // Réutilise le même rendu que l'export PDF : en-tête, bloc infos, tableau.
  // Renvoie { base64, filename } ou null si aucune tournée à cette date.
  // `heurePrise` (optionnel, "HH:MM") : heure de prise de poste saisie dans la
  // popup WhatsApp — affichée dans le bloc d'infos du PDF. Si absente, elle est
  // déduite de la première heureDebut des tournées.
  window.buildTourSheetPdfBase64 = async function (chauffeurId, dateISO, heurePrise) {
    await ensurePdfLibsLoaded();
    const { jsPDF } = window.jspdf;

    const chauffeur = state.chauffeurs.find(c => String(c._id) === String(chauffeurId));
    const planning = (typeof getPlanningForCell === 'function')
      ? getPlanningForCell(chauffeurId, dateISO)
      : state.plannings.find(p =>
          String(p.chauffeurId?._id || p.chauffeurId) === String(chauffeurId) && p.date === dateISO
        );
    if (!chauffeur || !planning || !planning.tours) return null;

    const tours = planning.tours.filter(t => t.statut !== 'annule');
    if (!tours.length) return null;

    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 12;

    const logoData = await loadImageAsDataURL(CONFIG.logoUrl);
    drawHeader(doc, pageW, margin, dateISO, logoData, 'FEUILLE DE TOURNÉE');
    const yAfterInfo = drawInfoBlock(doc, chauffeur, dateISO, tours, margin, pageW, heurePrise);
    drawToursTable(doc, tours, yAfterInfo + 4, margin, pageW, pageH);
    drawFooter(doc, pageW, pageH, margin, 1, 1);

    const nomFichier = `tournee_${(chauffeur.nom || '').toLowerCase()}_${dateISO}.pdf`;
    return {
      base64: doc.output('datauristring').split(',')[1],
      filename: nomFichier
    };
  };

  // ─── Init après DOMContentLoaded ─────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectPrintButton);
  } else {
    injectPrintButton();
  }
})();
