/**
 * planning-excel.js — Yovatrans Planning
 * ─────────────────────────────────────────────────────────────────────────────
 * Génération Excel (.xlsx) des tournées, pilotée par le panneau d'export
 * (planning-print.js). Expose des fonctions sur window ; n'injecte plus de
 * bouton (le panneau unifié est la seule entrée).
 *
 *   window.exportPlanningExcel(opts)   -> génère et télécharge le .xlsx
 *   window.ensurePlanningsRange(f, t)  -> charge les jours manquants de la plage
 *
 * Dépend de planning.js (state, toISO, loadPlannings, notify) et charge SheetJS
 * depuis le CDN à la demande.
 * ─────────────────────────────────────────────────────────────────────────────
 */
'use strict';

(function () {
  const STATUT_LABELS = {
    planifie:     'Planifié',
    annule:       'Annulé',
    chute:        'Chute',
    debord:       'Débord',
    passage_vide: 'Passage à vide',
    effectue:     'Effectué',
  };
  const DAYS_FR = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

  // ─── Chargement dynamique de SheetJS ─────────────────────────────────────────
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        if (existing.dataset.loaded === '1') return resolve();
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', () => reject(new Error('Échec chargement ' + src)));
        return;
      }
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.addEventListener('load', () => { s.dataset.loaded = '1'; resolve(); });
      s.addEventListener('error', () => reject(new Error('Échec chargement ' + src)));
      document.head.appendChild(s);
    });
  }
  async function ensureXlsxLoaded() {
    if (window.XLSX) return;
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
    if (!window.XLSX) throw new Error('SheetJS n\'a pas pu être chargé (CDN bloqué ?).');
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────
  function chauffeurName(planning) {
    const c = planning.chauffeurId;
    if (c && typeof c === 'object') return `${c.nom || ''} ${c.prenom || ''}`.trim();
    const found = (state.chauffeurs || []).find((x) => String(x._id) === String(c));
    return found ? `${found.nom || ''} ${found.prenom || ''}`.trim() : '';
  }
  function chauffeurIdOf(planning) {
    const c = planning.chauffeurId;
    return String((c && typeof c === 'object') ? c._id : c);
  }
  function weekdayFR(dateISO) {
    const d = new Date(dateISO + 'T00:00:00');
    return Number.isNaN(d.getTime()) ? '' : DAYS_FR[d.getDay()];
  }
  function normalizeClientKey(name) {
    return String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  }
  function regieDetail(tour) {
    if (tour.type !== 'regie' || !Array.isArray(tour.regieTours)) return '';
    return tour.regieTours
      .map((rt, i) => (!rt.chargement && !rt.dechargement) ? '' : `T${i + 1} : ${rt.chargement || '—'} → ${rt.dechargement || '—'}`)
      .filter(Boolean)
      .join(' ; ');
  }

  // Date -> 'YYYY-MM-DD' (local, pour ne pas dépendre du global toISO).
  function isoOf(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  // Charge les jours manquants de la plage [fromISO, toISO] dans state.plannings.
  async function ensurePlanningsRange(fromISO, toISO) {
    if (!fromISO || !toISO) return;
    const have = new Set((state.plannings || []).map((p) => p.date));
    const days = [];
    let d = new Date(fromISO + 'T00:00:00');
    const end = new Date(toISO + 'T00:00:00');
    while (d <= end) { days.push(isoOf(d)); d = new Date(d.getTime() + 86400000); }
    if (days.every((x) => have.has(x))) return;
    const data = await loadPlannings(fromISO, toISO);
    const arr = Array.isArray(data) ? data : [];
    // On remplace les jours de la plage par les données fraîches (autoritatives).
    state.plannings = (state.plannings || []).filter((p) => p.date < fromISO || p.date > toISO).concat(arr);
  }

  // ─── Construction des lignes filtrées ────────────────────────────────────────
  function buildRows(opts) {
    const o = opts || {};
    const statuts  = (o.statuts  && o.statuts.length)  ? o.statuts  : null;  // null = tous
    const types    = (o.types    && o.types.length)    ? o.types    : null;
    const periodes = (o.periodes && o.periodes.length) ? o.periodes : null;
    const mode     = o.mode || 'chauffeur';
    const selected = (o.selectedIds && o.selectedIds.length) ? new Set(o.selectedIds.map(String)) : null;

    const header = [
      'Date', 'Jour', 'Chauffeur', 'Type', 'Statut', 'Période', 'Client',
      'Immatriculation', 'Heure début', 'Heure fin', 'Départ / Source',
      'Arrivée / Destination', 'Lieu chantier', 'Nb tours (régie)',
      'Détail régie', 'Réf transport', 'Notes'
    ];

    const inRange = (state.plannings || []).filter((p) =>
      (!o.fromISO || p.date >= o.fromISO) && (!o.toISO || p.date <= o.toISO));

    inRange.sort((a, b) => (a.date !== b.date) ? (a.date < b.date ? -1 : 1)
      : chauffeurName(a).localeCompare(chauffeurName(b), 'fr'));

    const rows = [header];
    inRange.forEach((planning) => {
      if (mode === 'chauffeur' && selected && !selected.has(chauffeurIdOf(planning))) return;
      const name = chauffeurName(planning);
      (planning.tours || []).forEach((t) => {
        if (statuts && !statuts.includes(t.statut || 'planifie')) return;
        if (types && !types.includes(t.type)) return;
        if (periodes && !periodes.includes(t.heurePeriode || 'journee')) return;
        if (mode === 'client' && selected && !selected.has(normalizeClientKey(t.client))) return;
        rows.push([
          planning.date, weekdayFR(planning.date), name,
          t.type === 'regie' ? 'Régie' : 'Tour',
          STATUT_LABELS[t.statut] || t.statut || 'Planifié',
          t.heurePeriode === 'nuit' ? 'Nuit' : 'Jour',
          t.client || '', t.immatCamion || '', t.heureDebut || '', t.heureFin || '',
          t.source || '', t.destination || '', t.lieuChantier || '',
          t.type === 'regie' ? (t.nombreTours || 0) : '',
          regieDetail(t), t.refTransport || '', t.notes || ''
        ]);
      });
    });
    return rows;
  }

  // ─── Génération du fichier ───────────────────────────────────────────────────
  async function exportPlanningExcel(opts) {
    const o = opts || {};
    const rows = buildRows(o);
    if (rows.length <= 1) {
      if (typeof notify === 'function') notify('Aucune tournée à exporter avec ces filtres.', 'warning');
      return 0;
    }
    await ensureXlsxLoaded();

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [
      { wch: 11 }, { wch: 9 }, { wch: 22 }, { wch: 7 }, { wch: 12 }, { wch: 8 },
      { wch: 16 }, { wch: 14 }, { wch: 11 }, { wch: 11 }, { wch: 28 }, { wch: 28 },
      { wch: 20 }, { wch: 13 }, { wch: 40 }, { wch: 14 }, { wch: 30 }
    ];
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: rows[0].length - 1 } }) };

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Tournées');

    const from = o.fromISO || '';
    const to = o.toISO || from;
    const fname = (from && to && from !== to) ? `planning_${from}_${to}.xlsx` : `planning_${from || to || 'export'}.xlsx`;
    XLSX.writeFile(wb, fname);

    const count = rows.length - 1;
    if (typeof notify === 'function') notify(`Export Excel : ${count} tournée(s).`, 'success');
    return count;
  }

  // Exposé pour le panneau d'export (planning-print.js).
  window.exportPlanningExcel = exportPlanningExcel;
  window.ensurePlanningsRange = ensurePlanningsRange;
})();
