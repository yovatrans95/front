// Historique des trajets d'un véhicule (fiche véhicule).
// Consomme GET /api/vehicles/:id/trips?from&to&refresh.
// - Trajets groupés jour par jour (cliquer un jour = toute la journée sur la carte).
// - Heures de démarrage et d'arrivée sur chaque trajet.
// - Itinéraires tracés PAR LA ROUTE (OSRM) quand le fournisseur ne donne pas le tracé GPS.

(function () {
  let histMap = null;
  let histLayer = null;
  let histTrips = [];
  let histVehicleId = null;
  let drawSeq = 0;              // ignore les dessins obsolètes si on clique vite
  const roadCache = {};         // cache des itinéraires OSRM

  // Complétion des trajets passés en arrière-plan (serveur) : on re-demande
  // discrètement la liste quelques fois jusqu'à ce que tout soit archivé.
  let userInteracted = false;   // l'utilisateur a cliqué un jour/trajet ou bougé la carte
  let pollTimer = null;         // minuterie du prochain rafraîchissement discret
  let pollsLeft = 0;            // nombre de rafraîchissements automatiques restants
  const MAX_POLLS = 5;          // ~5 essais espacés de 5 s = 25 s max
  const POLL_DELAY_MS = 5000;

  // ----------------------------- ICONES SVG -----------------------------

  const SVG = {
    start: '<svg width="11" height="11" viewBox="0 0 12 12" style="flex:none"><circle cx="6" cy="6" r="4.5" fill="#10b981" stroke="#fff" stroke-width="1.6"/></svg>',
    end: '<svg width="11" height="11" viewBox="0 0 12 12" style="flex:none"><path d="M6 1l5 8.5H1z" fill="#ef4444" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/></svg>',
    clock: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" style="flex:none"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>',
    road: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" style="flex:none"><path d="M5 21L9 3M19 21L15 3M12 6v2.5M12 12v2.5M12 18v2.5" stroke-linecap="round"/></svg>',
    gauge: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" style="flex:none"><path d="M4 16a8 8 0 1 1 16 0"/><path d="M12 16l4-5" stroke-linecap="round"/></svg>',
    calendar: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="flex:none"><rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
    arrow: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" style="flex:none;vertical-align:-2px"><path d="M4 12h14M13 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };

  function mapPin(kind) {
    const color = kind === 'start' ? '#10b981' : '#ef4444';
    const letter = kind === 'start' ? 'D' : 'A';
    const html = `<svg width="30" height="38" viewBox="0 0 30 38" style="filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))">
      <path d="M15 1C7.8 1 2 6.8 2 14c0 9.6 13 23 13 23s13-13.4 13-23C28 6.8 22.2 1 15 1z" fill="${color}" stroke="#fff" stroke-width="2"/>
      <text x="15" y="18.5" text-anchor="middle" font-size="11.5" font-weight="800" fill="#fff" font-family="'Plus Jakarta Sans',sans-serif">${letter}</text>
    </svg>`;
    return L.divIcon({ className: '', html, iconSize: [30, 38], iconAnchor: [15, 37], popupAnchor: [0, -34] });
  }

  // ----------------------------- FORMATAGE -----------------------------

  function fmtDateInput(d) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function fmtTime(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  function fmtDayLabel(d) {
    const label = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  function fmtDuration(min) {
    if (min == null) return '—';
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return h ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`;
  }

  function providerLabel(p) {
    if (p === 'webfleet') return 'Webfleet';
    if (p === 'quartix') return 'Quartix';
    if (p === 'optifleet') return 'Optifleet';
    return p || 'GPS';
  }

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[c]));
  }

  function shortAddress(value, fallback) {
    const s = String(value || '').replace(/,\s*(FR|France)\s*$/i, '').trim();
    return s || fallback;
  }

  // ----------------------------- CARTE -----------------------------

  function invalidateWhenVisible(tries = 0) {
    const el = document.getElementById('histMap');
    if (el && el.offsetParent !== null) { histMap.invalidateSize(); return; }
    if (tries < 80) setTimeout(() => invalidateWhenVisible(tries + 1), 100);
  }

  function ensureMap() {
    if (histMap) return histMap;
    histMap = L.map('histMap', { zoomControl: true }).setView([48.85, 2.35], 9);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(histMap);
    histLayer = L.layerGroup().addTo(histMap);
    // Dès que l'utilisateur manipule la carte, on cesse de recentrer/redessiner
    // automatiquement lors des rafraîchissements discrets.
    histMap.on('dragstart zoomstart', () => { userInteracted = true; });
    invalidateWhenVisible();
    return histMap;
  }

  // Itinéraire routier réel via OSRM (suit les routes, pas le vol d'oiseau).
  async function roadRoute(trip) {
    if (trip.startLat == null || trip.endLat == null) return null;
    const key = `${trip.startLat.toFixed(5)},${trip.startLng.toFixed(5)}|${trip.endLat.toFixed(5)},${trip.endLng.toFixed(5)}`;
    if (roadCache[key] !== undefined) return roadCache[key];
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${trip.startLng},${trip.startLat};${trip.endLng},${trip.endLat}?overview=full&geometries=geojson`;
      const res = await fetch(url);
      const data = await res.json();
      const geom = data?.routes?.[0]?.geometry;
      const coords = geom ? geom.coordinates.map(([lon, lat]) => [lat, lon]) : null;
      roadCache[key] = coords;
      return coords;
    } catch {
      roadCache[key] = null;
      return null;
    }
  }

  // Tracé style "route" : contour sombre + blanc + bleu (même langage que la carte de suivi).
  function addRouteLine(coords, dashed = false) {
    const base = { interactive: false, lineCap: 'round', lineJoin: 'round' };
    L.polyline(coords, { ...base, color: '#111827', weight: dashed ? 9 : 10, opacity: 0.8, dashArray: dashed ? '8 12' : null }).addTo(histLayer);
    L.polyline(coords, { ...base, color: '#ffffff', weight: dashed ? 6.5 : 7.5, opacity: 1, dashArray: dashed ? '8 12' : null }).addTo(histLayer);
    return L.polyline(coords, { ...base, color: '#38bdf8', weight: dashed ? 4 : 5, opacity: 1, dashArray: dashed ? '8 12' : null }).addTo(histLayer);
  }

  function addTripMarkers(trip, bounds) {
    if (trip.startLat != null) {
      L.marker([trip.startLat, trip.startLng], { icon: mapPin('start') })
        .bindPopup(`<b>Démarrage ${fmtTime(trip.startAt)}</b><br>${escapeHtml(shortAddress(trip.startAddress, 'Position GPS'))}`)
        .addTo(histLayer);
      bounds.push([trip.startLat, trip.startLng]);
    }
    if (trip.endLat != null) {
      L.marker([trip.endLat, trip.endLng], { icon: mapPin('end') })
        .bindPopup(`<b>Arrivée ${fmtTime(trip.endAt)}</b><br>${escapeHtml(shortAddress(trip.endAddress, 'Position GPS'))}`)
        .addTo(histLayer);
      bounds.push([trip.endLat, trip.endLng]);
    }
  }

  // Renvoie les coordonnées à tracer pour un trajet :
  // 1) tracé GPS réel du fournisseur, 2) sinon itinéraire routier OSRM, 3) sinon droite pointillée.
  async function coordsForTrip(trip) {
    if (Array.isArray(trip.path) && trip.path.length > 1) {
      return { coords: trip.path.filter(p => Array.isArray(p) && p.length === 2), dashed: false };
    }
    const road = await roadRoute(trip);
    if (road && road.length > 1) return { coords: road, dashed: false };
    if (trip.startLat != null && trip.endLat != null) {
      return { coords: [[trip.startLat, trip.startLng], [trip.endLat, trip.endLng]], dashed: true };
    }
    return null;
  }

  async function showTripOnMap(trip) {
    ensureMap();
    const seq = ++drawSeq;
    histLayer.clearLayers();

    const bounds = [];
    addTripMarkers(trip, bounds);
    if (bounds.length) histMap.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });

    setStatus('Calcul de l\'itinéraire par la route…');
    const line = await coordsForTrip(trip);
    if (seq !== drawSeq) return; // un autre trajet a été sélectionné entre-temps

    if (line) {
      const poly = addRouteLine(line.coords, line.dashed);
      histMap.fitBounds(poly.getBounds(), { padding: [45, 45], maxZoom: 15 });
    }
    setStatus(statusSummary());
    setTimeout(() => histMap.invalidateSize(), 60);
  }

  // Tous les trajets d'une journée sur la carte, enchaînés.
  async function showDayOnMap(dayTrips) {
    ensureMap();
    const seq = ++drawSeq;
    histLayer.clearLayers();

    const bounds = [];
    dayTrips.forEach(t => addTripMarkers(t, bounds));
    if (bounds.length) histMap.fitBounds(bounds, { padding: [45, 45], maxZoom: 13 });

    setStatus(`Calcul des itinéraires de la journée (${dayTrips.length} trajets)…`);
    for (const trip of dayTrips) {
      const line = await coordsForTrip(trip);
      if (seq !== drawSeq) return;
      if (line) {
        const poly = addRouteLine(line.coords, line.dashed);
        poly.getLatLngs().forEach(ll => bounds.push([ll.lat, ll.lng]));
      }
    }
    if (seq !== drawSeq) return;
    if (bounds.length) histMap.fitBounds(bounds, { padding: [45, 45], maxZoom: 14 });
    setStatus(statusSummary());
    setTimeout(() => histMap.invalidateSize(), 60);
  }

  // ----------------------------- LISTE -----------------------------

  function setStatus(text) {
    const el = document.getElementById('histStatus');
    if (el) el.textContent = text || '';
  }

  function statusSummary() {
    if (!histTrips.length) return 'Aucun trajet trouvé. Essaie « Rafraîchir » pour forcer la récupération.';
    const km = histTrips.reduce((s, t) => s + (t.distanceKm || 0), 0);
    return `${histTrips.length} trajet(s) — ${km.toFixed(0)} km au total. Clique un jour ou un trajet pour voir l'itinéraire routier.`;
  }

  // Groupe les trajets par journée. Jours du plus récent au plus ancien,
  // trajets de la journée dans l'ordre chronologique (matin → soir).
  function groupByDay(trips) {
    const groups = new Map();
    trips.forEach((t, i) => {
      const d = new Date(t.startAt);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!groups.has(key)) groups.set(key, { date: d, trips: [] });
      groups.get(key).trips.push({ ...t, _i: i });
    });
    const out = [...groups.values()];
    out.sort((a, b) => b.date - a.date);
    out.forEach(g => g.trips.sort((a, b) => new Date(a.startAt) - new Date(b.startAt)));
    return out;
  }

  function tripCardHtml(t) {
    const muted = 'color:var(--muted)';
    return `
      <div class="hist-trip" data-i="${t._i}" style="cursor:pointer;border:1px solid var(--border);border-radius:12px;padding:10px 13px;background:#fff;transition:border-color .15s, box-shadow .15s">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:7px">
          <strong style="font-size:0.88rem;color:var(--navy);letter-spacing:.01em">${fmtTime(t.startAt)} <span style="color:var(--blue-500)">${SVG.arrow}</span> ${fmtTime(t.endAt)}</strong>
          <span style="font-size:0.6rem;text-transform:uppercase;letter-spacing:.08em;background:var(--blue-50);color:var(--blue-600);padding:2px 8px;border-radius:20px;font-weight:700">${providerLabel(t.provider)}</span>
        </div>
        <div style="font-size:0.78rem;color:var(--text2);line-height:1.6">
          <div style="display:flex;align-items:center;gap:7px">${SVG.start}<span>${escapeHtml(shortAddress(t.startAddress, 'Position GPS'))}</span></div>
          <div style="display:flex;align-items:center;gap:7px">${SVG.end}<span>${escapeHtml(shortAddress(t.endAddress, 'Position GPS'))}</span></div>
        </div>
        <div style="display:flex;gap:14px;margin-top:8px;font-size:0.73rem;${muted};align-items:center">
          <span style="display:flex;align-items:center;gap:4px">${SVG.road}<strong style="color:var(--navy)">${t.distanceKm != null ? t.distanceKm.toFixed(1) : '—'}</strong>&nbsp;km</span>
          <span style="display:flex;align-items:center;gap:4px">${SVG.clock}<strong style="color:var(--navy)">${fmtDuration(t.durationMin)}</strong></span>
          <span style="display:flex;align-items:center;gap:4px">${SVG.gauge}<strong style="color:var(--navy)">${t.maxSpeed ?? '—'}</strong>&nbsp;km/h</span>
        </div>
      </div>`;
  }

  function renderList() {
    const el = document.getElementById('histList');
    if (!el) return;

    if (!histTrips.length) {
      el.innerHTML = `<div style="padding:18px;color:var(--muted);font-weight:600">Aucun trajet sur cette période.</div>`;
      return;
    }

    const groups = groupByDay(histTrips);

    el.innerHTML = groups.map((g, gi) => {
      const km = g.trips.reduce((s, t) => s + (t.distanceKm || 0), 0);
      const first = g.trips[0];
      const last = g.trips[g.trips.length - 1];
      return `
        <div class="hist-day" data-g="${gi}" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 11px;margin-top:${gi ? '8px' : '0'};background:var(--grad-soft);border:1px solid var(--border);border-radius:10px" title="Voir toute la journée sur la carte">
          <span style="display:flex;align-items:center;gap:7px;font-size:0.78rem;font-weight:800;color:var(--navy)">${SVG.calendar}${fmtDayLabel(g.date)}</span>
          <span style="font-size:0.7rem;color:var(--text2);font-weight:600">${g.trips.length} trajet(s) · ${km.toFixed(0)} km · ${fmtTime(first.startAt)}–${fmtTime(last.endAt)}</span>
        </div>
        ${g.trips.map(tripCardHtml).join('')}`;
    }).join('');

    el.querySelectorAll('.hist-trip').forEach(node => {
      node.addEventListener('click', () => {
        userInteracted = true;
        selectCard(node);
        showTripOnMap(histTrips[Number(node.dataset.i)]);
      });
    });

    el.querySelectorAll('.hist-day').forEach(node => {
      node.addEventListener('click', () => {
        userInteracted = true;
        selectCard(node);
        showDayOnMap(groups[Number(node.dataset.g)].trips);
      });
    });
  }

  function selectCard(node) {
    document.querySelectorAll('.hist-trip, .hist-day').forEach(n => {
      n.style.borderColor = 'var(--border)';
      n.style.boxShadow = 'none';
    });
    node.style.borderColor = 'var(--blue-500)';
    node.style.boxShadow = '0 0 0 2px var(--blue-100)';
  }

  // ----------------------------- CHARGEMENT -----------------------------

  // refresh : force le re-fetch complet côté serveur (bouton « Rafraîchir »).
  // isPoll  : rafraîchissement discret automatique (complétion en arrière-plan) —
  //           on ne réinitialise alors ni le compteur d'essais ni l'interaction.
  async function loadHistory(refresh, isPoll = false) {
    const id = histVehicleId || new URLSearchParams(window.location.search).get('id');
    if (!id) return;
    histVehicleId = id;

    // Nouvelle demande explicite (Charger / Rafraîchir) : on repart à zéro.
    if (!isPoll) {
      clearTimeout(pollTimer);
      pollTimer = null;
      pollsLeft = MAX_POLLS;
      userInteracted = false;
    }

    const from = document.getElementById('histFrom')?.value;
    const to = document.getElementById('histTo')?.value;

    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', `${to}T23:59:59`);
    if (refresh) params.set('refresh', '1');

    if (!isPoll) {
      setStatus(refresh
        ? 'Récupération chez les fournisseurs… (peut prendre quelques secondes)'
        : 'Chargement…');
    }

    try {
      const data = await apiFetch(`/vehicles/${id}/trips?${params.toString()}`);
      histTrips = data.trips || [];
      renderList();
      ensureMap();
      // Par défaut : la journée la plus récente complète sur la carte — tant que
      // l'utilisateur n'a pas pris la main (clic/manipulation de la carte).
      if (histTrips.length && !userInteracted) {
        const groups = groupByDay(histTrips);
        const firstDay = document.querySelector('.hist-day');
        if (firstDay) selectCard(firstDay);
        showDayOnMap(groups[0].trips);
      }

      // Complétion des trajets passés encore en cours côté serveur : on
      // re-demande discrètement la liste jusqu'à ce qu'elle soit complète.
      if (data.pending && pollsLeft > 0) {
        pollsLeft -= 1;
        const base = histTrips.length ? `${statusSummary()} ` : '';
        setStatus(`${base}⏳ Récupération des trajets passés en cours…`);
        clearTimeout(pollTimer);
        pollTimer = setTimeout(() => loadHistory(false, true), POLL_DELAY_MS);
      } else {
        setStatus(statusSummary());
      }
    } catch (e) {
      if (!isPoll) setStatus(`Erreur : ${e.message}`);
    }
  }

  window.loadHistory = loadHistory;

  document.addEventListener('DOMContentLoaded', () => {
    const id = new URLSearchParams(window.location.search).get('id');
    if (!id || !document.getElementById('histList')) return;
    histVehicleId = id;

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
    const fromEl = document.getElementById('histFrom');
    const toEl = document.getElementById('histTo');
    if (fromEl) fromEl.value = fmtDateInput(weekAgo);
    if (toEl) toEl.value = fmtDateInput(now);

    loadHistory(false);
  });
})();
