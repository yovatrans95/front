let map;
let markerLayer;
let vehicles = [];
let selectedPlate = null;
let markersByPlate = {};
let didInitialFit = false;
let tourneeByPlate = {}; // plaque normalisée -> { chauffeur, tours: [] }
let volatileTours = [];  // tours « à la volée » non attribués (chauffeur VOLEE A LA)
let soloMode = false;    // true => un seul camion affiché sur la carte
let siteLayer;           // couche des sites de tournée géocodés

// --- Recherche souple (fuzzy + multi-mots + proximité géographique) ---
let searchDebounce = null;  // debounce du géocodage de la requête
let searchGeo = null;       // { lat, lng, label, query } du lieu géocodé courant
let searchGeoToken = 0;     // garde anti-course pour les géocodages async

// --- Dashboard déplaçable (Gridstack) + repères carte ---
let fleetGrid = null;                       // instance Gridstack
const LAYOUT_KEY = 'fleetDashboardLayout';  // disposition sauvegardée
const PINS_KEY = 'fleetMapPins';            // repères posés sur la carte
let pinLayer = null;                        // couche Leaflet des repères
let pins = [];                              // [{ id, lat, lng, label }]
let pinMarkers = {};                        // id -> marker
let pinMode = false;                        // mode "poser un repère" actif
let ctxMenuEl = null;                       // menu contextuel (clic droit)

// --- Stations-service (prix carburants, open data gouv) ---
let stationLayer;                 // couche Leaflet des stations
let stationsOn = false;           // affichage activé ?
let stationFuel = 'gazole';       // carburant mis en avant (gazole par défaut : flotte diesel)
let stationMarkers = {};          // id station -> marker (diff sans flicker)
let stationFetchTimer = null;     // debounce du rechargement au déplacement
let stationFetchAbort = null;     // annule la requête en vol si on rebouge
let osmPois = [];                 // POI carburant OSM {lat,lng,brand} (enseignes)
const osmPoiKeys = new Set();     // dédup des POI OSM par coordonnée
const osmFetchedKeys = new Set(); // zones déjà interrogées sur Overpass

const params = new URLSearchParams(window.location.search);
const focusPlate = normalizePlate(params.get('plate') || '');

document.addEventListener('DOMContentLoaded', async () => {
  const ok = await requireAuth();
  if (!ok) return;

  initDashboard();
  initMap();
  initStations();
  initPins();
  initContextMenu();
  // Le widget carte vient d'être dimensionné par Gridstack : on recalcule la
  // taille une fois la mise en page posée (sans recentrer).
  setTimeout(() => { if (map) map.invalidateSize(); }, 120);
  document.getElementById('refreshBtn')?.addEventListener('click', () => loadPositions(false));
  document.getElementById('searchInput')?.addEventListener('input', onSearchInput);

  await loadTournees();
  await loadPositions();
  setInterval(() => loadPositions(true), 4000);
  setInterval(loadTournees, 60000); // les plannings changent rarement
});

// Dashboard : transforme les blocs en widgets déplaçables/redimensionnables.
// La disposition est sauvegardée en localStorage. Ne touche JAMAIS au centre
// de la carte : un resize de widget appelle seulement map.invalidateSize().
function initDashboard() {
  if (typeof GridStack === 'undefined') return; // CDN indispo -> page reste utilisable

  const grid = GridStack.init({
    column: 12,
    cellHeight: 80,
    margin: 9,
    handle: '.drag-handle',
    float: true,
    resizable: { handles: 'e,se,s,sw,w' }
  });
  fleetGrid = grid;

  // Restaurer la disposition (positions seulement, sans ajout/suppression de widget).
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) || 'null');
    if (Array.isArray(saved) && saved.length) grid.load(saved, false);
  } catch (e) { /* disposition corrompue : on garde celle par défaut */ }

  // Recalcule la taille de la carte après un déplacement/redimensionnement,
  // SANS recentrer (invalidateSize conserve centre + zoom).
  const refreshMap = () => { if (map) setTimeout(() => map.invalidateSize(), 60); };
  grid.on('change', () => {
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(grid.save(false))); } catch (e) {}
    refreshMap();
  });
  grid.on('resizestop', refreshMap);

  document.getElementById('resetLayoutBtn')?.addEventListener('click', () => {
    localStorage.removeItem(LAYOUT_KEY);
    location.reload();
  });
}

// Repères personnalisés posés sur la carte (persistés en localStorage).
function initPins() {
  if (!map) return;
  pinLayer = L.layerGroup().addTo(map);
  try { pins = JSON.parse(localStorage.getItem(PINS_KEY) || '[]'); } catch (e) { pins = []; }
  if (!Array.isArray(pins)) pins = [];
  pins.forEach(renderPin);

  const btn = document.getElementById('addPinBtn');
  btn?.addEventListener('click', () => {
    pinMode = !pinMode;
    btn.classList.toggle('on', pinMode);
    map.getContainer().style.cursor = pinMode ? 'crosshair' : '';
  });

  // Poser un repère : on le crée tout de suite et on ouvre son popup d'édition
  // (saisie inline du nom — pas de prompt() natif bloquant).
  map.on('click', (e) => {
    if (!pinMode) return;
    const pin = {
      id: 'p' + Date.now() + Math.random().toString(36).slice(2, 6),
      lat: e.latlng.lat,
      lng: e.latlng.lng,
      label: ''
    };
    pins.push(pin);
    renderPin(pin);
    savePins();
    pinMarkers[pin.id].openPopup();
    pinMode = false;
    btn?.classList.remove('on');
    map.getContainer().style.cursor = '';
  });
}

function savePins() {
  try { localStorage.setItem(PINS_KEY, JSON.stringify(pins)); } catch (e) {}
}

function pinIconFor(pin) {
  return L.divIcon({
    className: '',
    html: `<div class="map-pin">${escapeHtml(pin.label || 'Repère')}</div>`,
    iconSize: null,
    iconAnchor: [10, 22]
  });
}

function pinPopupHtml(pin) {
  return (
    `<div class="pin-edit">` +
      `<input class="pin-input" id="pinInput-${pin.id}" type="text" value="${escapeAttr(pin.label || '')}" placeholder="Nom du repère" />` +
      `<div class="pin-edit-actions">` +
        `<button type="button" class="yova-popup-btn primary" onclick="savePinLabel('${pin.id}')">OK</button>` +
        `<button type="button" class="yova-popup-btn soft" onclick="removePin('${pin.id}')">Supprimer</button>` +
      `</div>` +
    `</div>`
  );
}

function renderPin(pin) {
  const m = L.marker([pin.lat, pin.lng], { draggable: true, icon: pinIconFor(pin) }).addTo(pinLayer);
  pinMarkers[pin.id] = m;
  m.on('dragend', () => { const ll = m.getLatLng(); pin.lat = ll.lat; pin.lng = ll.lng; savePins(); });
  m.bindPopup(pinPopupHtml(pin));
  // Focus auto sur le champ + validation à Entrée à l'ouverture du popup.
  m.on('popupopen', () => {
    const inp = document.getElementById('pinInput-' + pin.id);
    if (!inp) return;
    inp.focus();
    inp.select();
    inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') savePinLabel(pin.id); });
  });
}

function savePinLabel(id) {
  const pin = pins.find((p) => p.id === id);
  if (!pin) return;
  const inp = document.getElementById('pinInput-' + id);
  if (inp) pin.label = inp.value.trim();
  const m = pinMarkers[id];
  if (m) { m.setIcon(pinIconFor(pin)); m.setPopupContent(pinPopupHtml(pin)); m.closePopup(); }
  savePins();
}

function removePin(id) {
  const m = pinMarkers[id];
  if (m) { pinLayer.removeLayer(m); delete pinMarkers[id]; }
  pins = pins.filter((p) => p.id !== id);
  savePins();
}

// ── Menu contextuel (clic droit) ─────────────────────────────────────────────
function initContextMenu() {
  ctxMenuEl = document.createElement('div');
  ctxMenuEl.className = 'ctx-menu';
  ctxMenuEl.style.display = 'none';
  document.body.appendChild(ctxMenuEl);

  document.addEventListener('click', hideContextMenu);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideContextMenu(); });
  window.addEventListener('resize', hideContextMenu);

  if (map) {
    map.on('movestart zoomstart', hideContextMenu);
    // Clic droit sur le fond de carte : actions liées à l'endroit cliqué.
    map.on('contextmenu', (e) => {
      e.originalEvent.preventDefault();
      const { lat, lng } = e.latlng;
      // Items itinéraire (fournis par itineraire.js s'il est chargé) en tête de menu.
      const routeItems = (typeof getItineraryContextItems === 'function')
        ? [...getItineraryContextItems(lat, lng), null]
        : [];
      showContextMenu(e.originalEvent.clientX, e.originalEvent.clientY, [
        ...routeItems,
        { label: 'Poser un repère ici', onClick: () => {
          const pin = { id: 'p' + Date.now() + Math.random().toString(36).slice(2, 6), lat, lng, label: '' };
          pins.push(pin); renderPin(pin); savePins(); pinMarkers[pin.id].openPopup();
        } },
        { label: 'Centrer ici', onClick: () => map.panTo([lat, lng], { animate: true }) },
        { label: 'Copier les coordonnées', onClick: () => copyText(`${lat.toFixed(5)}, ${lng.toFixed(5)}`) }
      ]);
    });
  }
}

// items : [{ label, onClick }] ; un item null insère un séparateur.
function showContextMenu(x, y, items) {
  if (!ctxMenuEl) return;
  ctxMenuEl.innerHTML = '';
  items.forEach((it) => {
    if (!it) { const s = document.createElement('div'); s.className = 'ctx-sep'; ctxMenuEl.appendChild(s); return; }
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ctx-item';
    b.textContent = it.label;
    b.addEventListener('click', (ev) => { ev.stopPropagation(); hideContextMenu(); it.onClick(); });
    ctxMenuEl.appendChild(b);
  });
  ctxMenuEl.style.left = x + 'px';
  ctxMenuEl.style.top = y + 'px';
  ctxMenuEl.style.display = 'block';
  // Garder le menu dans la fenêtre.
  const r = ctxMenuEl.getBoundingClientRect();
  if (r.right > window.innerWidth) ctxMenuEl.style.left = Math.max(8, x - r.width) + 'px';
  if (r.bottom > window.innerHeight) ctxMenuEl.style.top = Math.max(8, y - r.height) + 'px';
}

function hideContextMenu() {
  if (ctxMenuEl) ctxMenuEl.style.display = 'none';
}

// Clic droit sur un camion : actions liées à ce véhicule (lues en temps réel
// via marker._vehicle, mis à jour à chaque rafraîchissement).
function vehicleContextMenu(ev, marker) {
  ev.originalEvent.preventDefault();
  L.DomEvent.stopPropagation(ev);
  const v = marker._vehicle;
  if (!v) return;
  const items = [
    { label: 'Centrer sur ce camion', onClick: () => {
      if (v.lat != null && v.lng != null) map.setView([v.lat, v.lng], Math.max(map.getZoom(), 13), { animate: true });
    } },
    { label: 'Voir la tournée du jour', onClick: () => selectVehicle(v.immatriculation, true) },
    null,
    { label: 'Copier l\'immatriculation', onClick: () => copyText(v.immatriculation || '') }
  ];
  // Itinéraire vers/depuis la position actuelle du camion (module itineraire.js)
  if (window.itineraire && v.lat != null && v.lng != null) {
    const label = `Camion ${v.immatriculation || ''}`.trim();
    items.splice(2, 0,
      { label: 'Itinéraire vers ce camion',  onClick: () => window.itineraire.setTo(v.lat, v.lng, label) },
      { label: 'Itinéraire depuis ce camion', onClick: () => window.itineraire.setFrom(v.lat, v.lng, label) }
    );
  }
  if (v.vehicleId) {
    items.push({ label: 'Ouvrir la fiche véhicule', onClick: () => { window.location.href = `vehicule.html?id=${v.vehicleId}`; } });
  }
  showContextMenu(ev.originalEvent.clientX, ev.originalEvent.clientY, items);
}

// Copie dans le presse-papier avec retour visuel via le bandeau de la carte.
function copyText(text) {
  if (!text) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => setLoading(false, `Copié : ${text}`)).catch(() => {});
  }
}

function todayStr() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// Le chauffeur fictif « VOLEE A LA » porte les tours non attribués (à dispatcher
// au fil de la journée). On les surveille dans un panneau dédié.
const VOLEE_DRIVER_ID = '6a1542a989b85108c823aae1';
function isVolatileChauffeur(c) {
  if (!c) return false;
  if (String(c._id || c) === VOLEE_DRIVER_ID) return true;
  return /\bVOLEE\b/i.test(`${c.nom || ''} ${c.prenom || ''}`);
}

// Construit la table plaque -> { chauffeur, tours } à partir des plannings du jour.
async function loadTournees() {
  try {
    const date = todayStr();
    const plannings = await apiFetch(`/planning?startDate=${date}&endDate=${date}`);

    const map = {};
    const volatiles = [];
    (plannings || []).forEach((planning) => {
      const chauffeur = planning.chauffeurId || null;
      // Tours du chauffeur fictif « à la volée » : non attribués, à surveiller.
      if (isVolatileChauffeur(chauffeur)) {
        (planning.tours || []).forEach((tour) => volatiles.push(tour));
        return; // ne pas les indexer par plaque (immatCamion vide)
      }
      (planning.tours || []).forEach((tour) => {
        const key = normalizePlate(tour.immatCamion || '');
        if (!key) return;
        if (!map[key]) map[key] = { chauffeur, tours: [] };
        map[key].tours.push(tour);
      });
    });

    tourneeByPlate = map;
    volatileTours = volatiles;
    renderVolatile();

    // Rafraîchir les popups déjà ouverts/liés
    vehicles.forEach((v) => {
      if (v._marker) v._marker.setPopupContent(popupHtml(v));
    });
  } catch (error) {
    console.error('Erreur chargement tournées:', error);
  }
}

// Panneau « tours à la volée » : liste en lecture seule des tours non attribués.
// Clic sur un tour -> trace ses lieux sur la carte pour situer où l'attribuer.
function renderVolatile() {
  const el = document.getElementById('volatileList');
  const countEl = document.getElementById('volatileCount');
  if (countEl) countEl.textContent = volatileTours.length;
  if (!el) return;

  if (!volatileTours.length) {
    el.innerHTML = `<div class="tour-detail empty">Aucun tour à la volée aujourd'hui</div>`;
    return;
  }

  el.innerHTML = volatileTours.map((t, i) => {
    const heure = [t.heureDebut, t.heureFin].filter(Boolean).join(' → ');
    const lieux = [t.source, t.destination, t.lieuChantier].filter(Boolean).map(escapeHtml);
    const lieuxLine = lieux.length
      ? lieux.join(' <span class="tour-arrow">→</span> ')
      : 'Lieux non renseignés';
    const typeLabel = t.type === 'regie' ? 'Régie' : 'Tour';
    return `
      <div class="tour-row" onclick="showVolatileTourSites(${i})">
        <div class="tour-row-top">
          <span class="tour-dot st-${escapeAttr(t.statut || 'planifie')}"></span>
          <span class="tour-client">${escapeHtml(t.client || '—')}</span>
          ${heure ? `<span class="tour-time">${escapeHtml(heure)}</span>` : `<span class="tour-time">${typeLabel}</span>`}
        </div>
        <div class="tour-lieux">${lieuxLine}</div>
      </div>`;
  }).join('');
}

function showVolatileTourSites(index) {
  const tour = volatileTours[index];
  if (tour) plotTourSites(tour);
}


function initMap() {
  map = L.map('map', { zoomControl: true }).setView([48.95, 2.35], 9);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
  }).addTo(map);

  markerLayer = L.markerClusterGroup({
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: true,
    disableClusteringAtZoom: 14,
    maxClusterRadius: 35,
    iconCreateFunction: function (cluster) {
      const count = cluster.getChildCount();

      return L.divIcon({
        html: `<div><span>${count}</span></div>`,
        className: 'marker-cluster marker-cluster-small',
        iconSize: L.point(42, 42)
      });
    }
  });

  map.addLayer(markerLayer);
  siteLayer = L.layerGroup().addTo(map);
}

async function loadPositions(silent = false) {
  if (!silent) setLoading(true, 'Chargement flotte...');

  try {
    const data = await apiFetch('/tracking/vehicles');
    vehicles = data.vehicles || [];
    renderStats();
    renderList();
    renderMarkers();
    if (!silent) setLoading(false, `Mis à jour: ${new Date().toLocaleTimeString('fr-FR')}`);
  } catch (error) {
    console.error(error);
    if (!silent) setLoading(true, `Erreur: ${error.message}`);
  }
}

// Glisse un marqueur de sa position actuelle vers (toLat,toLng) en douceur.
function slideMarker(marker, toLat, toLng, duration = 1200) {
  const start = marker.getLatLng();
  const fromLat = start.lat;
  const fromLng = start.lng;

  if (Math.abs(fromLat - toLat) < 1e-7 && Math.abs(fromLng - toLng) < 1e-7) return;

  if (marker._slideRAF) cancelAnimationFrame(marker._slideRAF);

  const t0 = performance.now();

  function step(now) {
    const p = Math.min(1, (now - t0) / duration);
    const e = p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p; // easeInOut
    marker.setLatLng([fromLat + (toLat - fromLat) * e, fromLng + (toLng - fromLng) * e]);
    marker._slideRAF = p < 1 ? requestAnimationFrame(step) : null;
  }

  marker._slideRAF = requestAnimationFrame(step);
}

function makeIcon(vehicle) {
  return L.divIcon({
    className: '',
    html: truckMarkerHtml(vehicle),
    iconSize: [54, 54],
    iconAnchor: [27, 27],
    popupAnchor: [0, -28]
  });
}

function renderMarkers() {
  const seen = new Set();
  const bounds = [];
  let focusMarker = null;

  vehicles.forEach((vehicle) => {
    if (vehicle.lat == null || vehicle.lng == null) return;

    const key = normalizePlate(vehicle.immatriculation);
    seen.add(key);
    bounds.push([vehicle.lat, vehicle.lng]);

    let marker = markersByPlate[key];

    if (marker) {
      // Mise à jour en place : le marqueur glisse vers sa nouvelle position,
      // sans recréer la couche ni recentrer la carte.
      marker.setIcon(makeIcon(vehicle));
      marker.setPopupContent(popupHtml(vehicle));
      slideMarker(marker, vehicle.lat, vehicle.lng);
    } else {
      marker = L.marker([vehicle.lat, vehicle.lng], { icon: makeIcon(vehicle) });
      marker.bindPopup(popupHtml(vehicle));
      marker.on('click', () => selectVehicle(vehicle.immatriculation, false));
      marker.on('contextmenu', (ev) => vehicleContextMenu(ev, marker));
      markersByPlate[key] = marker;
    }

    vehicle._marker = marker;
    marker._vehicle = vehicle; // donnée à jour pour le menu contextuel

    if (focusPlate && key === focusPlate) {
      focusMarker = marker;
    }
  });

  // Retirer les marqueurs des véhicules qui ne sont plus remontés
  Object.keys(markersByPlate).forEach((key) => {
    if (!seen.has(key)) {
      markerLayer.removeLayer(markersByPlate[key]);
      delete markersByPlate[key];
    }
  });

  applyMarkerVisibility();

  // Recentrage UNIQUEMENT au premier chargement (ou si un camion est ciblé
  // via ?plate=). Les rafraîchissements suivants ne bougent plus la carte.
  if (!didInitialFit) {
    if (focusMarker) {
      const vehicle = vehicles.find((v) => normalizePlate(v.immatriculation) === focusPlate);
      selectVehicle(vehicle.immatriculation, true);
      focusMarker.openPopup();
    } else if (bounds.length) {
      map.fitBounds(bounds, { padding: [45, 45] });
    }
    didInitialFit = true;
  }
}

function popupHtml(vehicle) {
  const speed = Math.round(Number(vehicle.speed || 0));
  const stateLabel = getStateLabel(vehicle);
  const provider = providerLabel(vehicle.provider);

  const fiche = vehicle.vehicleId
    ? `<a class="yova-popup-btn primary" href="vehicule.html?id=${vehicle.vehicleId}">Ouvrir fiche</a>`
    : `<span class="yova-popup-btn soft">Non lié Mongo</span>`;

  const driverName = driverNameForVehicle(vehicle);

  return `
    <div class="yova-popup">
      <div class="yova-popup-head">
        <div class="yova-popup-title">${escapeHtml(vehicle.immatriculation || vehicle.name || 'Véhicule')}</div>
        <div class="yova-popup-sub">${escapeHtml(driverName || provider || '')}</div>
      </div>

      <div class="yova-popup-body">
        <div class="yova-popup-grid">
          <div class="yova-popup-item">
            <div class="yova-popup-label">Vitesse</div>
            <div class="yova-popup-value">${speed} km/h</div>
          </div>

          <div class="yova-popup-item">
            <div class="yova-popup-label">État</div>
            <div class="yova-popup-value">${stateLabel}</div>
          </div>

          <div class="yova-popup-item">
            <div class="yova-popup-label">Source</div>
            <div class="yova-popup-value">${provider}</div>
          </div>

          <div class="yova-popup-item">
            <div class="yova-popup-label">Position</div>
            <div class="yova-popup-value">${formatTrackingTime(vehicle.posTime)}</div>
          </div>
        </div>

        <div class="yova-popup-address">
          ${escapeHtml(vehicle.address || 'Adresse non disponible')}
        </div>

        <div class="yova-popup-actions">
          ${fiche}
          <a class="yova-popup-btn soft" href="https://www.google.com/maps?q=${vehicle.lat},${vehicle.lng}" target="_blank">Maps</a>
        </div>
      </div>
    </div>
  `;
}

// Nom du chauffeur lié au camion (via immatCamion <-> planning du jour).
function driverNameForVehicle(vehicle) {
  const entry = tourneeByPlate[normalizePlate(vehicle.immatriculation)];
  const c = entry && entry.chauffeur;
  if (!c) return '';
  return `${c.prenom || ''} ${c.nom || ''}`.trim();
}

// Détail de la tournée du jour (axé sur les lieux), affiché dans la liste
// quand un camion est sélectionné.
function tourneeDetailHtml(vehicle) {
  const entry = tourneeByPlate[normalizePlate(vehicle.immatriculation)];
  const tours = (entry && entry.tours) || [];

  if (!tours.length) {
    return `<div class="tour-detail empty">Aucune tournée aujourd'hui</div>`;
  }

  const key = normalizePlate(vehicle.immatriculation);

  const rows = tours.map((t, i) => {
    const heure = [t.heureDebut, t.heureFin].filter(Boolean).join(' → ');
    const lieux = [t.source, t.destination, t.lieuChantier].filter(Boolean).map(escapeHtml);
    const lieuxLine = lieux.length
      ? lieux.join(' <span class="tour-arrow">→</span> ')
      : 'Lieux non renseignés';
    return `
      <div class="tour-row" onclick="event.stopPropagation(); showTourSites('${escapeAttr(key)}', ${i})">
        <div class="tour-row-top">
          <span class="tour-dot st-${escapeAttr(t.statut || 'planifie')}"></span>
          <span class="tour-client">${escapeHtml(t.client || '—')}</span>
          ${heure ? `<span class="tour-time">${escapeHtml(heure)}</span>` : ''}
        </div>
        <div class="tour-lieux">${lieuxLine}</div>
      </div>`;
  }).join('');

  return `<div class="tour-detail">${rows}</div>`;
}

// Affiche/masque les marqueurs selon le mode solo (un seul camion).
function applyMarkerVisibility() {
  const solo = soloMode ? normalizePlate(selectedPlate) : null;

  Object.keys(markersByPlate).forEach((key) => {
    const marker = markersByPlate[key];
    const show = !solo || key === solo;
    if (show && !markerLayer.hasLayer(marker)) markerLayer.addLayer(marker);
    else if (!show && markerLayer.hasLayer(marker)) markerLayer.removeLayer(marker);
  });

  markerLayer.refreshClusters();
}

function refreshSelectedIcons() {
  vehicles.forEach((v) => {
    if (v._marker) v._marker.setIcon(makeIcon(v));
  });
}

// Géocodage texte -> {lat,lng,label}, SANS cache : un mauvais résultat mis en
// cache restait erroné pour toujours (localStorage). On re-géocode à chaque clic
// (2-3 s, acceptable), et on purge les anciennes entrées encore stockées.
(function purgeOldGeoCache() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith('geo:')) localStorage.removeItem(k);
    }
  } catch { /* stockage indisponible : rien à purger */ }
})();

async function geocodeCached(query) {
  const queries = Array.isArray(query) ? query : [query];
  const cleanQueries = queries.map((q) => String(q || '').trim()).filter(Boolean);
  if (!cleanQueries.length) return null;
  return geocodeQuery(cleanQueries);
}

function uniq(arr) {
  return [...new Set((arr || []).map((v) => String(v || '').replace(/\s+/g, ' ').trim()).filter(Boolean))];
}

function normalizeTextForRegex(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Abr\u00e9viations courantes des plannings TP, qu'un humain lit sans r\u00e9fl\u00e9chir.
// Ex: "St Ouen", "Bruy\u00e8res s/Oise", "Bd Voltaire" -> formes compl\u00e8tes.
function expandAbbreviations(raw) {
  let s = ` ${String(raw || '')} `;

  // "s/" = "sur" (Bruy\u00e8res s/Oise), puis "/" g\u00e9n\u00e9rique entre deux mots (Annet/Marne).
  s = s.replace(/\bs\s*\/\s*/gi, ' sur ');
  s = s.replace(/([A-Za-z\u00c0-\u00ff])\s*\/\s*([A-Za-z\u00c0-\u00ff])/g, '$1 sur $2');

  // Saint / Sainte abr\u00e9g\u00e9s (g\u00e8re "St", "St.", "St-").
  s = s.replace(/\bSte\b\.?/gi, 'Sainte');
  s = s.replace(/\bSt\b\.?/gi, 'Saint');

  // Types de voie usuels.
  s = s.replace(/\bav\b\.?/gi, 'avenue');
  s = s.replace(/\bbd\b\.?/gi, 'boulevard');
  s = s.replace(/\brte\b\.?/gi, 'route');
  s = s.replace(/\bchem\b\.?/gi, 'chemin');
  s = s.replace(/\bimp\b\.?/gi, 'impasse');
  s = s.replace(/\bpl\b\.?/gi, 'place');

  return s.replace(/\s+/g, ' ').trim();
}

// Distance d'\u00e9dition (Levenshtein), born\u00e9e en m\u00e9moire \u00e0 une ligne.
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;

  const dp = Array.from({ length: m + 1 }, (_, i) => i);
  for (let j = 1; j <= n; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= m; i++) {
      const tmp = dp[i];
      dp[i] = Math.min(dp[i] + 1, dp[i - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[m];
}

// "Contient \u00e0 peu pr\u00e8s" : tol\u00e8re les petites fautes de frappe du planning,
// comme un humain qui reconna\u00eet "Romainvile" pour "Romainville".
// On glisse une fen\u00eatre de la m\u00eame longueur (en mots) que la ville cherch\u00e9e.
function fuzzyContains(haystackNorm, needleNorm) {
  if (!needleNorm) return false;
  if (haystackNorm.includes(needleNorm)) return true;

  const maxDist = needleNorm.length <= 5 ? 1 : (needleNorm.length <= 9 ? 2 : 3);
  const hWords = haystackNorm.split(' ').filter(Boolean);
  const nWords = needleNorm.split(' ').length;

  for (let i = 0; i + nWords <= hWords.length; i++) {
    const chunk = hWords.slice(i, i + nWords).join(' ');
    // Pr\u00e9-filtre bon march\u00e9 : longueurs trop \u00e9loign\u00e9es => pas la peine de calculer.
    if (Math.abs(chunk.length - needleNorm.length) > maxDist) continue;
    if (levenshtein(chunk, needleNorm) <= maxDist) return true;
  }
  return false;
}

const KNOWN_SITE_BRANDS = [
  'ECT', 'ORTEC', 'SEINEO', 'VEOLIA', 'REP', 'MYMAT', 'LAFARGE', 'EQIOM', 'CEMEX',
  'TERAFORM', 'PANAME TP', 'ROISSY TP', 'EIFFAGE', 'EUROVIA', 'COLAS', 'SPL', 'SUEZ'
];

// Communes / zones qu'on retrouve souvent dans tes plannings TP.
// Le but n'est pas de tout connaître : c'est surtout pour reconstruire vite
// "site + ville" quand le PDF donne un libellé sale.
const KNOWN_SITE_CITIES = [
  'Romainville', 'Annet-sur-Marne', 'Annet', 'Bruyères-sur-Oise', 'Bruyeres-sur-Oise',
  'Nanterre', 'Saint-Ouen-l\'Aumône', 'Saint-Ouen-l-Aumone', 'Bonneuil-sur-Marne',
  'Bonneuil', 'Monthyon', 'Houilles', 'Gennevilliers', 'Villepinte', 'Claye-Souilly',
  'Villers-Saint-Paul', 'Villers St Paul', 'Amblainville', 'Cormeilles-en-Parisis',
  'Cormeilles', 'Goussainville', 'Le Blanc-Mesnil', 'Roissy-en-France', 'Tremblay-en-France',
  'Mitry-Mory', 'Compans', 'Vémars', 'Vemars', 'Louvres', 'Gonesse', 'Sarcelles',
  'Aulnay-sous-Bois', 'Bobigny', 'Pantin', 'Bondy', 'Noisy-le-Sec', 'Montreuil',
  'Saint-Denis', 'Aubervilliers', 'Pierrefitte-sur-Seine', 'Stains', 'Créteil', 'Creteil',
  'Vitry-sur-Seine', 'Ivry-sur-Seine', 'Bonneuil-en-France', 'Argenteuil', 'Bezons',
  'Clichy', 'Asnières-sur-Seine', 'Asnieres-sur-Seine', 'Saint-Witz', 'Moussy-le-Neuf',
  'Dammartin-en-Goële', 'Dammartin-en-Goele', 'Meaux', 'Chelles', 'Torcy', 'Noisiel',
  'Lognes', 'Lagny-sur-Marne', 'Saint-Thibault-des-Vignes'
];

function stripPlanningNoise(raw) {
  return expandAbbreviations(raw)
    .replace(/\b(chargement|dechargement|déchargement|depart|départ|arrivee|arrivée|rotation|tour|benne|semi|camion|tracteur|immat|chauffeur)\b/gi, ' ')
    .replace(/\b(bl|bp|bc|cmd|commande|ref|réf|n[°o])\s*[:#-]?\s*[a-z0-9-]+/gi, ' ')
    .replace(/\b\d{1,2}h\d{0,2}\b/gi, ' ')
    .replace(/\b\d{1,2}:\d{2}\b/gi, ' ')
    .replace(/[()\[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitSiteText(raw) {
  const text = stripPlanningNoise(raw);
  if (!text) return [];

  // La ville est souvent dans le même libellé : "ECT Romainville".
  // On garde toujours le bloc complet en premier.
  return uniq([
    text,
    ...text.split(/\s*(?:→|->|=>|;|\||\n)\s*/g),
    ...text.split(/\s+-\s+/g)
  ]).filter((v) => v.length > 2);
}

function addFranceSuffix(q) {
  if (/\bfrance\b/i.test(q)) return q;
  return `${q}, France`;
}

function cityRegexName(city) {
  return normalizeTextForRegex(city).replace(/\s+/g, '[\\s\\-\']+');
}

function findKnownCities(text) {
  // On déplie d'abord les abréviations ("St" -> "Saint") avant de comparer,
  // puis on accepte un match exact OU approximatif (tolérant aux fautes).
  const norm = normalizeTextForRegex(expandAbbreviations(text));
  const found = [];

  KNOWN_SITE_CITIES.forEach((city) => {
    const cityNorm = normalizeTextForRegex(city);
    const pattern = new RegExp(`(^|\\s)${cityRegexName(city)}(\\s|$)`, 'i');
    if (pattern.test(norm) || fuzzyContains(norm, cityNorm)) found.push(city);
  });

  return uniq(found);
}

function findKnownBrands(text) {
  const norm = normalizeTextForRegex(text);
  return KNOWN_SITE_BRANDS.filter((brand) => {
    const b = normalizeTextForRegex(brand).replace(/\s+/g, '\\s+');
    return new RegExp(`(^|\\s)${b}(\\s|$)`, 'i').test(norm);
  });
}

function postalCityParts(text) {
  const out = [];
  const raw = String(text || '');

  // 75001 Paris / 95380 Louvres / 93130 Noisy-le-Sec
  const zipCity = raw.match(/\b((?:0[1-9]|[1-8]\d|9[0-8])\d{3})\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' -]{2,40})\b/);
  if (zipCity) {
    const city = zipCity[2].replace(/\s+/g, ' ').trim();
    out.push(`${zipCity[1]} ${city}`, city, zipCity[1]);
  }

  // Dernier segment après virgule, souvent ville/code postal.
  if (raw.includes(',')) {
    const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
    out.push(parts.at(-1));
    if (parts.length >= 2) out.push(parts.slice(-2).join(', '));
  }

  return out;
}

function regexSiteCandidates(text) {
  const out = [];
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return out;

  const brands = findKnownBrands(cleaned);
  const cities = findKnownCities(cleaned);

  // Cas parfait : marque connue + ville connue dans le même string.
  // Exemple : "ECT ROMAINVILLE" => "ECT Romainville" en premier.
  brands.forEach((brand) => {
    cities.forEach((city) => {
      out.push(`${brand} ${city}`);
      out.push(`${brand}, ${city}`);
      out.push(`${brand} ${city}, France`);
    });
  });

  // Extrait "à Romainville", "sur Bonneuil", "de Nanterre" sans casser le string complet.
  const prepositionCityRegex = /\b(?:a|à|sur|vers|de|du|des|aux)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' -]{2,35})\b/gi;
  let m;
  while ((m = prepositionCityRegex.exec(cleaned)) !== null) {
    const city = m[1].replace(/\s+/g, ' ').trim();
    if (city && !/^(chantier|site|depot|dépôt|carriere|carrière|zone|zi|za)$/i.test(city)) {
      brands.forEach((brand) => out.push(`${brand} ${city}`));
      out.push(city);
    }
  }

  // Si une ville connue est présente mais pas de marque, elle reste un secours utile.
  cities.forEach((city) => out.push(city, `${city}, France`));

  // Code postal + ville.
  postalCityParts(cleaned).forEach((part) => out.push(part, addFranceSuffix(part)));

  return uniq(out);
}

// ── Extraction d'une adresse de voirie explicite ─────────────────────────────
// "62 Rue Anatole France", "99 Quai du Président Roosevelt", "Route de l'Île
// Saint-Julien"... Si le libellé contient une vraie adresse, elle prime sur tout.
const STREET_TYPES_RE = "rue|avenue|boulevard|route|chemin|impasse|place|quai|all[ée]e|voie|cours|sentier|esplanade|passage|square";

function extractStreetAddress(text) {
  const t = expandAbbreviations(text);
  const re = new RegExp(
    "\\b(\\d{1,4}\\s*(?:bis|ter)?\\s+)?((?:" + STREET_TYPES_RE + ")\\s+[A-Za-zà-ÿÀ-Ÿ'’\\- ]{3,60})",
    'i'
  );
  const m = t.match(re);
  if (!m) return null;

  // Coupe le nom de voie avant les mots de site qui suivent parfois dans le
  // libellé ("...Rue Anatole France Déchèterie de Romainville"), puis 5 mots max.
  let name = m[2].split(/\b(?:d[ée]ch[èe]tt?erie|site|chantier|d[ée]p[ôo]t|carri[èe]re|zone|za|zi|zac|lieu-?dit|b[âa]timent|cedex)\b/i)[0];
  name = name.trim().split(/\s+/).slice(0, 5).join(' ');
  if (name.split(/\s+/).length < 2) return null; // "Rue" seul = pas une adresse

  const num = (m[1] || '').trim();
  return { street: (num ? num + ' ' : '') + name, index: m.index };
}

// Ville juste AVANT l'adresse dans le libellé ("VEOLIA TAIS Villeneuve-le-Roi
// 13 Rue Raoul Delattre" -> "Villeneuve-le-Roi"). On remonte les derniers mots
// en ignorant les noms de site tout en majuscules (VEOLIA, SYCTOM, ISSEANE...).
function cityBeforeStreet(text, streetIndex) {
  const before = expandAbbreviations(text).slice(0, streetIndex).trim();
  const words = before.split(/\s+/);
  const picked = [];

  for (let i = words.length - 1; i >= 0 && picked.length < 4; i--) {
    const w = words[i].replace(/[(),;:]/g, '');
    if (!w) continue;
    // Mot de site tout en majuscules (≥3 lettres) ou numérique : on s'arrête.
    if (/^[A-ZÀ-Ÿ0-9'’\-]{3,}$/.test(w) && w === w.toUpperCase() && /[A-ZÀ-Ÿ]/.test(w)) break;
    if (!/^[A-ZÀ-Ÿ]/.test(w)) break; // une ville commence par une majuscule
    picked.unshift(w);
  }

  // Dédoublonne la ville répétée ("Villeneuve-le-Roi Villeneuve-le-Roi").
  if (picked.length >= 2) {
    const half = Math.floor(picked.length / 2);
    const a = picked.slice(0, half).join(' ');
    const b = picked.slice(picked.length - half).join(' ');
    if (a && a === b) return b;
  }
  return picked.join(' ') || null;
}

function looksLikeCoordinates(raw) {
  const m = String(raw || '').match(/(-?\d{1,2}\.\d+)\s*[,; ]\s*(-?\d{1,3}\.\d+)/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
    return { lat, lng, label: 'Coordonnées GPS', score: 1 };
  }
  return null;
}

// Construit plusieurs variantes d'une adresse libre, de la plus intelligente à la plus large.
function geoCandidates(raw) {
  const fragments = splitSiteText(raw);
  const cands = [];

  fragments.forEach((text) => {
    // 1) Candidats regex : marque + ville si détectées.
    regexSiteCandidates(text).forEach((v) => cands.push(v));

    // 2) Le string complet EXACT, prioritaire : la ville est dedans.
    cands.push(text);
    cands.push(addFranceSuffix(text));

    // 3) Nettoyage doux : on enlève les mots parasites mais jamais les villes.
    const cleaned = text
      .replace(/\b(chargement|dechargement|déchargement|chantier|site|zone|za|zac|zi|z\.i\.|lieu-?dit|base vie|d[ée]p[ôo]t|carri[èe]re)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned && cleaned !== text) {
      regexSiteCandidates(cleaned).forEach((v) => cands.push(v));
      cands.push(cleaned);
      cands.push(addFranceSuffix(cleaned));
    }

    // 4) Ville/code postal seulement en secours.
    postalCityParts(text).forEach((part) => cands.push(part, addFranceSuffix(part)));
  });

  // On limite volontairement pour accélérer : les meilleurs regex + string complet sont au début.
  return uniq(cands).filter((v) => v.length >= 2).slice(0, 14);
}

function distKm(a, b) {
  if (!a || !b || !Number.isFinite(a.lat) || !Number.isFinite(b.lat)) return 0;
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const s1 = Math.sin(dLat / 2) ** 2;
  const s2 = Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s1 + s2));
}

function fetchJsonWithTimeout(url, options = {}, timeoutMs = 3500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal })
    .then((res) => {
      clearTimeout(timer);
      if (!res.ok) return null;
      return res.json();
    })
    .catch(() => {
      clearTimeout(timer);
      return null;
    });
}



// --- Jugement interne sans Google ---
// On génère beaucoup de combinaisons possibles, puis on note chaque requête et chaque résultat.
// Objectif : préférer "site + ville" quand le PDF donne par exemple "ECT Romainville".
const SITE_TYPE_WORDS = [
  'CHANTIER', 'SITE', 'DEPOT', 'DÉPÔT', 'CARRIERE', 'CARRIÈRE', 'DECHARGE', 'DÉCHARGE',
  'PLATEFORME', 'PLATE-FORME', 'ZI', 'Z I', 'ZA', 'ZAC', 'ZONE', 'PARC', 'BASE VIE'
];

const CITY_CONNECTORS = ['a', 'à', 'sur', 'de', 'du', 'des', 'aux', 'vers', 'chez'];

function wordsFromText(raw) {
  return normalizeTextForRegex(raw).split(' ').filter((w) => w.length >= 2);
}

function queryQualityScore(q, originalText = '') {
  const norm = normalizeTextForRegex(q);
  const original = normalizeTextForRegex(originalText || q);
  let score = 0;

  if (!norm) return -999;
  if (norm === original) score += 24;                 // string complet exact du planning
  if (/\bFRANCE\b/.test(norm)) score += 2;
  if (/\b\d{5}\b/.test(norm)) score += 12;           // code postal = très fiable
  if (findKnownBrands(q).length) score += 18;         // ECT / ORTEC / VEOLIA...
  if (findKnownCities(q).length) score += 20;         // ville connue détectée
  if (findKnownBrands(q).length && findKnownCities(q).length) score += 28; // combo parfait
  if (SITE_TYPE_WORDS.some((w) => norm.includes(w))) score += 4;

  // Adresse de voirie dans la requête = la recherche la plus précise possible.
  const hasStreet = new RegExp('\\b(?:' + STREET_TYPES_RE + ')\\b', 'i').test(q);
  if (hasStreet) {
    score += 14;
    if (/\d/.test(q)) score += 8;                              // numéro de voie
    const cityish = findKnownCities(q).length || wordsFromText(q).length >= 4;
    if (cityish) score += 10;                                  // rue + ville
  }

  const wordCount = wordsFromText(q).length;
  if (wordCount >= 2 && wordCount <= 5) score += 10;
  if (wordCount > 8) score -= 10;
  if (norm.length < 4) score -= 30;

  // Éviter les requêtes trop génériques qui géocodent n'importe quoi.
  if (/^(SITE|CHANTIER|DEPOT|DÉPÔT|CARRIERE|CARRIÈRE|ZI|ZA|ZONE)$/.test(norm)) score -= 80;

  return score;
}

// Note un résultat de géocodage sur la seule pertinence TEXTUELLE (ville, marque,
// mots du site). Volontairement AUCUN biais de proximité avec le camion : le site
// d'une tournée peut être à 100 km de sa position actuelle, et favoriser "le plus
// proche" choisissait le mauvais homonyme.
function resultJudgementScore(result, query, originalText = '') {
  if (!result) return -999;
  const labelNorm = normalizeTextForRegex(result.label || '');
  const originalNorm = normalizeTextForRegex(originalText || query);
  let score = 0;

  score += Number(result.score || 0) * 70; // score BAN/OSM
  score += queryQualityScore(query, originalText);

  // Si la ville ou la marque de la requête apparaît dans le résultat, gros bonus.
  findKnownCities(query).forEach((city) => {
    if (labelNorm.includes(normalizeTextForRegex(city))) score += 35;
  });
  findKnownBrands(query).forEach((brand) => {
    if (labelNorm.includes(normalizeTextForRegex(brand))) score += 18;
  });

  // Bonus si plusieurs mots importants du site ressortent dans le label.
  const importantWords = wordsFromText(query)
    .filter((w) => !['FRANCE','SITE','CHANTIER','DEPOT','DECHARGEMENT','CHARGEMENT'].includes(w));
  const matched = importantWords.filter((w) => labelNorm.includes(w)).length;
  score += matched * 6;

  // Le string original est parfois un nom de site complet.
  if (originalNorm && labelNorm.includes(originalNorm)) score += 22;

  if (result.source === 'BAN') score += 4;
  if (result.source === 'OSM') score += 1;

  // Précision du résultat : une adresse exacte vaut toujours mieux qu'une
  // commune seule — c'est ce qui empêche "Romainville" (centre-ville) de gagner
  // contre "62 Rue Anatole France 93230 Romainville".
  if (result.type === 'housenumber') score += 26;
  else if (result.type === 'street') score += 16;
  else if (result.type === 'locality') score += 6;
  else if (result.type === 'municipality') score -= 6;

  return score;
}

function buildSmartQueryObjects(rawQueries) {
  const rawList = Array.isArray(rawQueries) ? rawQueries : [rawQueries];
  const objects = [];

  rawList.forEach((raw) => {
    const original = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!original) return;

    const fragments = splitSiteText(original);
    fragments.forEach((fragment) => {
      const variants = [];

      const brands = findKnownBrands(fragment);
      const cities = findKnownCities(fragment);
      const postalParts = postalCityParts(fragment);

      // 0) PRIORITÉ ABSOLUE : adresse de voirie explicite ("62 Rue Anatole France")
      // + sa ville. Quand le libellé contient une vraie adresse, c'est elle qu'on
      // cherche — pas la commune seule, pas le nom du site.
      const sa = extractStreetAddress(fragment);
      if (sa) {
        const cityNear = cityBeforeStreet(fragment, sa.index);
        const cityList = uniq([cityNear, ...cities].filter(Boolean));
        cityList.forEach((city) => {
          variants.push(`${sa.street} ${city}`);
          variants.push(`${sa.street}, ${city}`);
        });
        postalParts.forEach((part) => variants.push(`${sa.street} ${part}`));
        variants.push(sa.street);
      }

      // 1) Combinaisons regex intelligentes : marque + ville, ville + CP, etc.
      regexSiteCandidates(fragment).forEach((v) => variants.push(v));

      // 2) String complet exact, car la ville est souvent dedans.
      variants.push(fragment);
      variants.push(addFranceSuffix(fragment));

      // 3) Toutes les combinaisons utiles marque / ville / CP.
      brands.forEach((brand) => {
        cities.forEach((city) => {
          variants.push(`${brand} ${city}`);
          variants.push(`${brand} ${city} France`);
          variants.push(`${city} ${brand}`);
          variants.push(`${brand}, ${city}`);
          variants.push(`${brand} site ${city}`);
          variants.push(`${brand} depot ${city}`);
          variants.push(`${brand} carrière ${city}`);
        });
        postalParts.forEach((part) => {
          variants.push(`${brand} ${part}`);
          variants.push(`${brand}, ${part}`);
        });
      });

      // 4) Ville seule en secours, mais moins prioritaire.
      cities.forEach((city) => variants.push(city, `${city} France`));
      postalParts.forEach((part) => variants.push(part, addFranceSuffix(part)));

      // 5) Nettoyage doux sans casser la ville.
      const cleaned = fragment
        .replace(/\b(chargement|dechargement|déchargement|chantier|site|zone|za|zac|zi|z\.i\.|lieu-?dit|base vie|d[ée]p[ôo]t|carri[èe]re)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (cleaned && cleaned !== fragment) {
        variants.push(cleaned, addFranceSuffix(cleaned));
        regexSiteCandidates(cleaned).forEach((v) => variants.push(v));
      }

      uniq(variants).forEach((q) => {
        objects.push({ query: q, original, score: queryQualityScore(q, original) });
      });
    });
  });

  // Dédup + tri par jugement interne de la requête.
  const byQuery = new Map();
  objects.forEach((obj) => {
    const key = normalizeTextForRegex(obj.query);
    if (!key) return;
    const prev = byQuery.get(key);
    if (!prev || obj.score > prev.score) byQuery.set(key, obj);
  });

  return [...byQuery.values()]
    .filter((o) => o.query.length >= 2 && o.score > -50)
    .sort((a, b) => b.score - a.score)
    .slice(0, 22); // assez large pour tester les combinaisons sans ralentir excessivement
}

async function geocodeBANAll(q) {
  const url = `https://api-adresse.data.gouv.fr/search/?limit=5&q=${encodeURIComponent(q)}`;
  const data = await fetchJsonWithTimeout(url, {}, 2200);
  if (!data) return [];
  return (Array.isArray(data.features) ? data.features : [])
    .filter((f) => f && f.geometry && Array.isArray(f.geometry.coordinates))
    .map((f) => {
      const [lon, lat] = f.geometry.coordinates;
      return {
        lat,
        lng: lon,
        label: f.properties?.label || q,
        score: Number(f.properties?.score || 0),
        type: f.properties?.type || '', // housenumber > street > locality > municipality
        source: 'BAN'
      };
    });
}

async function geocodeNominatimAll(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=fr&addressdetails=1&q=${encodeURIComponent(q)}`;
  const arr = await fetchJsonWithTimeout(url, { headers: { Accept: 'application/json' } }, 2800);
  if (!Array.isArray(arr)) return [];
  return arr
    .map((item) => ({
      lat: Number(item.lat),
      lng: Number(item.lon),
      label: item.display_name,
      score: Number(item.importance || 0.5),
      source: 'OSM'
    }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
}

function pickBestJudgedResult(results, minScore = 25) {
  if (!results.length) return null;
  const sorted = results.sort((a, b) => b._judgementScore - a._judgementScore);
  const best = sorted[0];
  if (!best || best._judgementScore < minScore) return null;
  return best;
}

async function geocodeQuery(rawQueries) {
  const rawList = Array.isArray(rawQueries) ? rawQueries : [rawQueries];

  for (const raw of rawList) {
    const gps = looksLikeCoordinates(raw);
    if (gps) return gps;
  }

  const queryObjects = buildSmartQueryObjects(rawList);
  if (!queryObjects.length) return null;

  const judge = (results, obj) => results.map((r) => ({
    ...r,
    _query: obj.query,
    _queryScore: obj.score,
    _judgementScore: resultJudgementScore(r, obj.query, obj.original)
  }));

  // BAN (adresses officielles) et OSM/Nominatim (POI, entreprises, carrières)
  // interrogés EN PARALLÈLE sur les meilleures combinaisons, puis tous les
  // résultats sont départagés ensemble au score textuel. OSM n'est plus un
  // simple secours : c'est souvent lui qui connaît les sites industriels.
  const banQueries = queryObjects.slice(0, 12);
  const osmQueries = queryObjects.slice(0, 6);

  const [banGroups, osmGroups] = await Promise.all([
    Promise.all(banQueries.map(async (obj) => judge(await geocodeBANAll(obj.query), obj))),
    Promise.all(osmQueries.map(async (obj) => judge(await geocodeNominatimAll(obj.query), obj)))
  ]);

  const allResults = [...banGroups.flat(), ...osmGroups.flat()];
  const best = pickBestJudgedResult(allResults, 40);
  if (best) return best;

  // Dernier recours : le meilleur résultat existant, même sous le seuil.
  return allResults.sort((a, b) => b._judgementScore - a._judgementScore)[0] || null;
}

function siteQueriesForTour(tour, role) {
  const values = [];
  if (role === 'start') {
    values.push(tour.source, tour.lieuChargement, tour.siteChargement, tour.adresseChargement, tour.depart, tour.départ);
  } else {
    values.push(tour.destination, tour.lieuDechargement, tour.lieuDéchargement, tour.siteDechargement, tour.siteDéchargement, tour.adresseDechargement, tour.adresseDéchargement, tour.lieuChantier, tour.arrivee, tour.arrivée);
  }

  // Le libellé du site reste prioritaire tel quel, car il contient souvent la ville.
  // Le client + lieu n'est ajouté qu'en secours pour certains POI.
  const cleanValues = values.filter(Boolean);
  const client = tour.client || '';
  const enriched = [
    ...cleanValues,
    ...cleanValues.map((v) => client ? `${client} ${v}` : '').filter(Boolean)
  ];
  return uniq(enriched);
}

function bestLabelForQueries(queries) {
  return uniq(queries)[0] || '';
}

// Itinéraire routier réel via OSRM (suit les routes, pas à vol d'oiseau).
async function routeOSRM(a, b) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`;
    const data = await fetchJsonWithTimeout(url, {}, 4000);
    if (!data) return null;
    const route = data && Array.isArray(data.routes) && data.routes[0];
    if (!route || !route.geometry) return null;
    return {
      coords: route.geometry.coordinates.map(([lon, lat]) => [lat, lon]),
      distance: route.distance,
      duration: route.duration
    };
  } catch {
    return null;
  }
}

function addRoutePolyline(coords, dashed = false) {
  // Effet demandé : bleu ciel au centre, contour blanc, contour noir extérieur.
  const base = { interactive: false, lineCap: 'round', lineJoin: 'round' };
  L.polyline(coords, { ...base, color: '#111827', weight: dashed ? 11 : 12, opacity: 0.85, dashArray: dashed ? '10 12' : null }).addTo(siteLayer);
  L.polyline(coords, { ...base, color: '#ffffff', weight: dashed ? 8 : 9, opacity: 1, dashArray: dashed ? '10 12' : null }).addTo(siteLayer);
  return L.polyline(coords, { ...base, color: '#38bdf8', weight: dashed ? 5 : 6, opacity: 1, dashArray: dashed ? '10 12' : null }).addTo(siteLayer);
}

function addSiteMarker(pt, role, text) {
  const isStart = role === 'Départ';
  const marker = L.marker([pt.lat, pt.lng], {
    icon: L.divIcon({
      className: '',
      html: `<div class="site-pin ${isStart ? 'start' : 'end'}"><span>${isStart ? 'D' : 'A'}</span></div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 30],
      popupAnchor: [0, -28]
    })
  });
  marker.bindPopup(`
    <div class="yova-popup">
      <div class="yova-popup-head">
        <div class="yova-popup-title">${escapeHtml(role)}</div>
        <div class="yova-popup-sub">${escapeHtml(text || pt.label || '')}</div>
      </div>
      <div class="yova-popup-body">
        <div class="yova-popup-address">${escapeHtml(pt.label || 'Adresse localisée')}</div>
        <div class="yova-popup-actions">
          <a class="yova-popup-btn soft" href="https://www.google.com/maps?q=${pt.lat},${pt.lng}" target="_blank">Ouvrir Maps</a>
        </div>
      </div>
    </div>`);
  marker.addTo(siteLayer);
}

// Clic sur une tournée -> positionne ses 2 sites (source + destination) sur la carte.
async function showTourSites(plateKey, index) {
  const entry = tourneeByPlate[plateKey];
  const tour = entry && entry.tours[index];
  return plotTourSites(tour);
}

// Trace les sites (départ/arrivée + itinéraire) d'un tour donné sur la carte.
// Utilisé par les tournées liées (par plaque) ET les tours « à la volée ».
async function plotTourSites(tour) {
  if (!tour) return;

  siteLayer.clearLayers();

  const aQueries = siteQueriesForTour(tour, 'start');
  const bQueries = siteQueriesForTour(tour, 'end');
  const aText = bestLabelForQueries(aQueries);
  const bText = bestLabelForQueries(bQueries);

  if (!aQueries.length && !bQueries.length) {
    setLoading(true, 'Aucun lieu renseigné pour cette tournée');
    return;
  }

  setLoading(true, 'Localisation des sites...');

  const [a, b] = await Promise.all([
    aQueries.length ? geocodeCached(aQueries) : Promise.resolve(null),
    bQueries.length ? geocodeCached(bQueries) : Promise.resolve(null)
  ]);

  const pts = [];
  if (a) { addSiteMarker(a, 'Départ', aText); pts.push([a.lat, a.lng]); }
  if (b) { addSiteMarker(b, 'Arrivée', bText); pts.push([b.lat, b.lng]); }

  if (a && b) {
    setLoading(true, 'Calcul de l\'itinéraire...');
    const route = await routeOSRM(a, b);

    if (route && route.coords.length) {
      const line = addRoutePolyline(route.coords, false);
      map.fitBounds(line.getBounds(), { padding: [80, 80] });
      setLoading(false, 'Itinéraire affiché');
    } else {
      // Repli : trait pointillé à vol d'oiseau si le routage échoue, avec le même style.
      const line = addRoutePolyline([[a.lat, a.lng], [b.lat, b.lng]], true);
      map.fitBounds(line.getBounds(), { padding: [80, 80] });
      setLoading(false, 'Itinéraire indisponible (vol d\'oiseau)');
    }
    return;
  }

  if (pts.length === 1) {
    map.setView(pts[0], 13, { animate: true });
    setLoading(false, 'Un seul site localisé');
  } else {
    setLoading(true, 'Sites introuvables : adresse trop vague ou nom de site absent');
  }
}

// Texte normalisé fouillé par la recherche : champs véhicule + chauffeur + lieux
// des tournées du jour liées par immat. Permet de retrouver un camion par son
// client/destination, pas seulement par sa plaque.
function vehicleHaystack(vehicle) {
  const parts = [
    vehicle.immatriculation,
    vehicle.name,
    vehicle.marque,
    vehicle.modele,
    vehicle.provider,
    vehicle.address,
    driverNameForVehicle(vehicle)
  ];
  const entry = tourneeByPlate[normalizePlate(vehicle.immatriculation)];
  if (entry && entry.tours) {
    entry.tours.forEach((t) => parts.push(t.client, t.source, t.destination, t.lieuChantier));
  }
  return normalizeTextForRegex(expandAbbreviations(parts.filter(Boolean).join(' ')));
}

// Découpe la requête en mots normalisés (≥2 car), ordre libre.
function searchWords(q) {
  return normalizeTextForRegex(expandAbbreviations(q)).split(' ').filter((w) => w.length >= 2);
}

// Score d'un véhicule pour une recherche multi-mots. Tous les mots doivent
// matcher (ET, ordre libre) ; sinon -1 (exclu). Substring exact > fuzzy,
// match sur la plaque privilégié.
function scoreVehicle(hay, immatNorm, words) {
  // Plaque sans séparateurs : on tape souvent "gv100tk" ou "ab123cd".
  const immatCompact = immatNorm.replace(/ /g, '');
  let score = 0;
  for (const w of words) {
    if (immatNorm.includes(w) || immatCompact.includes(w)) { score += 50; continue; }
    if (hay.includes(w)) { score += 20; continue; }
    if (fuzzyContains(hay, w)) { score += 8; continue; }
    return -1;
  }
  return score;
}

// Saisie recherche : rendu texte immédiat + géocodage différé (proximité).
function onSearchInput() {
  renderList();
  clearTimeout(searchDebounce);
  const q = (document.getElementById('searchInput')?.value || '').trim();
  searchDebounce = setTimeout(() => runGeoIfNeeded(q), 300);
}

// Si la recherche texte ne donne aucun camion, on traite la requête comme un
// lieu : géocodage (BAN puis OSM) → la liste se trie par proximité.
async function runGeoIfNeeded(q) {
  if (q.length < 3 || soloMode) { searchGeo = null; return; }

  const words = searchWords(q);
  if (words.length) {
    const anyText = vehicles.some((v) =>
      scoreVehicle(vehicleHaystack(v), normalizeTextForRegex(v.immatriculation || ''), words) >= 0);
    if (anyText) { searchGeo = null; renderList(); return; }
  }

  const token = ++searchGeoToken;
  let res = [];
  try {
    res = await geocodeBANAll(q);
    if (!res.length) res = await geocodeNominatimAll(q);
  } catch (e) { /* réseau indisponible : pas de proximité */ }
  if (token !== searchGeoToken) return; // requête obsolète

  res.sort((a, b) => (b.score || 0) - (a.score || 0));
  const best = res[0] || null;
  searchGeo = best ? { lat: best.lat, lng: best.lng, label: best.label, query: q } : null;
  renderList();
}

function renderList() {
  const el = document.getElementById('vehicleList');
  if (!el) return;

  const rawQ = (document.getElementById('searchInput')?.value || '').trim();

  // En mode solo (un camion sélectionné dans la liste ou sur la carte),
  // la liste se réduit à ce seul camion avec ses tournées.
  const soloPlate = soloMode ? normalizePlate(selectedPlate) : null;

  const words = soloPlate ? [] : searchWords(rawQ);
  let rows;
  let geoMode = false;
  const distByPlate = new Map();

  if (soloPlate) {
    rows = vehicles.filter((v) => normalizePlate(v.immatriculation) === soloPlate);
  } else if (!words.length) {
    rows = vehicles.slice();
  } else {
    rows = vehicles
      .map((v) => ({ v, s: scoreVehicle(vehicleHaystack(v), normalizeTextForRegex(v.immatriculation || ''), words) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.v);

    // Aucun résultat texte mais la requête a été géocodée -> tri par proximité.
    if (!rows.length && searchGeo && searchGeo.query === rawQ) {
      geoMode = true;
      rows = vehicles
        .filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lng))
        .map((v) => {
          const d = distKm(searchGeo, v);
          distByPlate.set(normalizePlate(v.immatriculation), d);
          return { v, d };
        })
        .sort((a, b) => a.d - b.d)
        .slice(0, 30)
        .map((x) => x.v);
    }
  }

  if (!rows.length) {
    el.innerHTML = '<div style="padding:18px;color:var(--muted);font-weight:700">Aucun camion trouvé</div>';
    return;
  }

  const backBtn = soloPlate
    ? `<div class="fleet-back" onclick="selectVehicle('${escapeAttr(selectedPlate || '')}', false)">← Retour à la flotte</div>`
    : '';
  const geoBanner = geoMode
    ? `<div class="fleet-back" style="cursor:default">Camions proches de « ${escapeHtml(searchGeo.label)} »</div>`
    : '';

  const prevScroll = el.scrollTop;
  el.innerHTML = backBtn + geoBanner + rows.map((vehicle) => {
    const distBadge = geoMode
      ? `<span class="badge blue">à ${formatKm(distByPlate.get(normalizePlate(vehicle.immatriculation)))}</span>`
      : '';
    return `
    <div class="vehicle-card ${normalizePlate(vehicle.immatriculation) === normalizePlate(selectedPlate) ? 'active' : ''}" onclick="selectVehicle('${escapeAttr(vehicle.immatriculation || '')}', true)">
      <div class="vehicle-top">
        <div>
          <div class="vehicle-name">${escapeHtml(vehicle.immatriculation || vehicle.name || 'Véhicule')}</div>
          <div class="vehicle-sub">${escapeHtml(driverNameForVehicle(vehicle) || '—')}</div>
        </div>
        <span class="badge ${vehicle.ignition ? (vehicle.standstill ? 'blue' : 'green') : 'gray'}">
          ${vehicle.ignition ? (vehicle.standstill ? 'Allumé' : 'Roule') : 'Éteint'}
        </span>
      </div>

      <div class="meta">
        <div><strong>${vehicle.speed || 0} km/h</strong>Vitesse</div>
        <div><strong>${formatTrackingTime(vehicle.posTime)}</strong>Dernière position</div>
        <div style="grid-column:1 / -1"><strong>${escapeHtml(vehicle.address || '-')}</strong>Adresse</div>
        <div style="grid-column:1 / -1">
          <span class="badge blue">${providerLabel(vehicle.provider)}</span>
          ${vehicle.vehicleId ? '<span class="badge green">lié véhicule</span>' : '<span class="badge red">non lié</span>'}
          ${distBadge}
        </div>
      </div>
      ${normalizePlate(vehicle.immatriculation) === normalizePlate(selectedPlate) ? tourneeDetailHtml(vehicle) : ''}
    </div>`;
  }).join('');

  el.scrollTop = prevScroll;
}

// Distance lisible : « 850 m » sous 1 km, sinon « 12 km ».
function formatKm(km) {
  if (!Number.isFinite(km)) return '?';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

function renderStats() {
  document.getElementById('statTotal').textContent = vehicles.length;
  document.getElementById('statMoving').textContent = vehicles.filter((v) => v.ignition && !v.standstill).length;
  document.getElementById('statLinked').textContent = vehicles.filter((v) => v.vehicleId).length;
}

function selectVehicle(plate, openPopup) {
  const norm = normalizePlate(plate);

  // Re-cliquer sur le véhicule déjà ouvert => on referme (toggle)
  if (soloMode && normalizePlate(selectedPlate) === norm) {
    selectedPlate = null;
    soloMode = false;
    siteLayer.clearLayers();
    renderList();
    refreshSelectedIcons();
    applyMarkerVisibility();
    return;
  }

  // Ouverture d'un véhicule : mode solo (seul lui sur la carte)
  selectedPlate = plate;
  soloMode = true;
  siteLayer.clearLayers();
  renderList();
  refreshSelectedIcons();
  applyMarkerVisibility();

  const vehicle = vehicles.find((v) => normalizePlate(v.immatriculation) === norm);
  if (!vehicle || !vehicle._marker) return;

  map.setView([vehicle.lat, vehicle.lng], Math.max(map.getZoom(), 13), { animate: true });

  if (openPopup) {
    setTimeout(() => {
      vehicle._marker.openPopup();
    }, 150);
  }
}

function setLoading(visible, text) {
  const el = document.getElementById('loading');
  if (!el) return;

  el.textContent = text || '';
  el.style.display = 'block';

  if (!visible) {
    clearTimeout(window.__loadingTimer);
    window.__loadingTimer = setTimeout(() => {
      el.style.display = 'none';
    }, 2500);
  }
}

function truckMarkerHtml(vehicle) {
  const isMoving = vehicle.ignition && !vehicle.standstill && Number(vehicle.speed || 0) > 0;
  const isOff = !vehicle.ignition;
  const speed = Math.round(Number(vehicle.speed || 0));

  const cls = [
    'truck-marker',
    isMoving ? 'moving' : '',
    isOff ? 'off' : '',
    normalizePlate(vehicle.immatriculation) === normalizePlate(selectedPlate) ? 'selected' : ''
  ].filter(Boolean).join(' ');

  const course = Number(vehicle.course);
  const dir = (isMoving && Number.isFinite(course))
    ? `<span class="truck-dir" style="transform:rotate(${course}deg)">
         <span class="dir-arm">
           <svg class="dir-arrow" viewBox="0 0 24 24" width="26" height="26"><path d="M12 2l6 11-6-3-6 3z" fill="#1a2c6e" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>
           <span class="dir-speed" style="transform:translateY(-50%) rotate(${-course}deg)">${speed}</span>
         </span>
       </span>`
    : '';

  const plateDigits = (normalizePlate(vehicle.immatriculation).match(/(\d{3})/) || ['', ''])[1];

  return `
    <div class="${cls}">
      ${dir}
      <span class="truck-dot">${plateDigits}</span>
    </div>
  `;
}





function providerLabel(provider = '') {
  const p = String(provider || '').toLowerCase();

  if (p.includes('webfleet')) return 'Webfleet';
  if (p.includes('quartix')) return 'Quartix';
  if (p.includes('optifleet')) return 'Optifleet';

  return 'GPS';
}

function getStateLabel(vehicle) {
  if (!vehicle.ignition) return 'Éteint';
  if (vehicle.standstill) return 'À l’arrêt';
  return 'En mouvement';
}

function formatTrackingTime(value) {
  if (!value) return '—';

  const raw = String(value).trim();

  const date = new Date(raw);

  if (Number.isNaN(date.getTime())) {
    return raw;
  }

  return date.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function normalizePlate(value = '') {
  const clean = String(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const match = clean.match(/^([A-Z]{2})(\d{3})([A-Z]{2})$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : clean;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#039;',
    '"': '&quot;'
  }[char]));
}

function escapeAttr(value = '') {
  return escapeHtml(value).replace(/`/g, '&#096;');
}

/* =========================================================================
   STATIONS-SERVICE — prix carburants (open data data.economie.gouv.fr)
   Affichage sur la même carte, rechargé automatiquement quand on bouge.
   ========================================================================= */

const STATION_API = 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records';

const FUEL_FIELDS = {
  gazole: 'gazole_prix',
  sp95: 'sp95_prix',
  sp98: 'sp98_prix',
  e10: 'e10_prix',
  e85: 'e85_prix',
  gplc: 'gplc_prix'
};

// Enseignes affichées (mots-clés cherchés dans le nom OSM, en minuscules).
// "total" couvre Total, TotalEnergies, Total Access ; "esso" couvre Esso, Esso Express.
const STATION_BRAND_FILTER = ['esso', 'total'];

const FUEL_LABELS = {
  gazole: 'Gazole',
  sp95: 'SP95',
  sp98: 'SP98',
  e10: 'E10',
  e85: 'E85',
  gplc: 'GPLc'
};

function initStations() {
  stationLayer = L.layerGroup().addTo(map);

  const toggle = document.getElementById('stationsToggle');
  const fuelSel = document.getElementById('stationFuel');

  toggle?.addEventListener('click', () => {
    stationsOn = !stationsOn;
    toggle.classList.toggle('on', stationsOn);
    if (fuelSel) fuelSel.hidden = !stationsOn;

    if (stationsOn) {
      fetchStationsInView();
    } else {
      stationLayer.clearLayers();
      stationMarkers = {};
      toggle.textContent = 'Stations';
    }
  });

  fuelSel?.addEventListener('change', () => {
    stationFuel = fuelSel.value;
    // On recolore/réaffiche sans refetch : les prix sont déjà en mémoire sur chaque marker.
    renderStationsFromCache();
  });

  // Recharge automatique (débouncée) à chaque déplacement / zoom de la carte.
  map.on('moveend', scheduleStationFetch);
}

function scheduleStationFetch() {
  if (!stationsOn) return;
  clearTimeout(stationFetchTimer);
  stationFetchTimer = setTimeout(fetchStationsInView, 350);
}

function setStationStatus(text) {
  const toggle = document.getElementById('stationsToggle');
  if (toggle) toggle.textContent = text;
}

async function fetchStationsInView() {
  if (!stationsOn) return;

  // Recherche par rayon autour du centre de la carte (fiable à tous les zooms) :
  // on couvre le viewport puis on borne le rayon pour rester raisonnable.
  const center = map.getCenter();
  const ne = map.getBounds().getNorthEast();
  let radiusKm = center.distanceTo(ne) / 1000;
  radiusKm = Math.min(Math.max(radiusKm, 1.5), 60);

  const pt = `geom'POINT(${center.lng.toFixed(5)} ${center.lat.toFixed(5)})'`;
  const where = `within_distance(geom, ${pt}, ${radiusKm.toFixed(2)}km)`;
  const order = `distance(geom, ${pt})`;

  const url = `${STATION_API}?where=${encodeURIComponent(where)}`
    + `&order_by=${encodeURIComponent(order)}&limit=100`
    + `&select=id,geom,adresse,ville,cp,gazole_prix,sp95_prix,sp98_prix,e10_prix,e85_prix,gplc_prix`;

  // Annule une éventuelle requête précédente encore en vol (déplacements rapides).
  if (stationFetchAbort) stationFetchAbort.abort();
  stationFetchAbort = new AbortController();

  setStationStatus('Stations…');

  try {
    const res = await fetch(url, { signal: stationFetchAbort.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const list = (data.results || []).filter((s) => s.geom && Number.isFinite(s.geom.lat));
    renderStations(list); // le compteur affiché est géré par le rendu (filtré Esso/Total)
  } catch (error) {
    if (error.name === 'AbortError') return; // remplacée par une requête plus récente
    console.error('Erreur stations:', error);
    setStationStatus('Stations (erreur)');
  }
}

// Cache des dernières stations chargées (pour recolorer au changement de carburant).
let stationCache = [];

function renderStations(list) {
  stationCache = list;
  renderStationsFromCache();
  // Enrichissement asynchrone des enseignes (Esso, Total…) via OpenStreetMap :
  // les stations s'affichent tout de suite, les noms se précisent dès qu'OSM répond.
  enrichStationsWithBrands();
}

// Récupère les enseignes des stations dans la zone via OpenStreetMap (Overpass).
async function enrichStationsWithBrands() {
  if (!stationsOn) return;

  const b = map.getBounds();
  const key = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()]
    .map((v) => v.toFixed(2)).join(',');

  // Zone déjà connue : on réutilise le cache OSM sans rappeler Overpass.
  if (osmFetchedKeys.has(key)) {
    renderStationsFromCache();
    return;
  }

  const query = `[out:json][timeout:20];node["amenity"="fuel"]`
    + `(${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()});out;`;
  const url = 'https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(query);

  try {
    const res = await fetch(url); // GET = requête simple, pas de souci de Content-Type
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();

    (data.elements || []).forEach((el) => {
      if (!Number.isFinite(el.lat) || !Number.isFinite(el.lon)) return;
      const t = el.tags || {};
      const brand = t.brand || t.name || t.operator;
      if (!brand) return;
      const poiKey = `${el.lat.toFixed(5)},${el.lon.toFixed(5)}`;
      if (osmPoiKeys.has(poiKey)) return; // déjà connu, on évite les doublons
      osmPoiKeys.add(poiKey);
      osmPois.push({ lat: el.lat, lng: el.lon, brand: String(brand).trim() });
    });

    // On ne marque la zone « faite » qu'en cas de succès : sinon on pourra réessayer.
    osmFetchedKeys.add(key);
    renderStationsFromCache(); // ré-affiche avec les titres enrichis
  } catch (error) {
    console.warn('Enseignes OSM indisponibles:', error.message);
  }
}

// Enseigne de la station prix = POI OSM le plus proche (≤ 350 m).
function brandForStation(station) {
  if (!osmPois.length) return null;
  const p = { lat: station.geom.lat, lng: station.geom.lon };
  let best = null;
  let bestD = Infinity;

  for (const poi of osmPois) {
    const d = distKm(p, poi);
    if (d < bestD) { bestD = d; best = poi; }
  }

  return (best && bestD <= 0.35) ? best.brand : null;
}

// Titre humain : "Esso Express Arnouville" si possible, sinon la ville.
function stationTitle(station) {
  const brand = brandForStation(station);
  const ville = (station.ville || '').trim();
  if (!brand) return ville || 'Station-service';
  if (ville && brand.toLowerCase().includes(ville.toLowerCase())) return brand;
  return ville ? `${brand} ${ville}` : brand;
}

// Ne garde que les enseignes voulues (Esso / Total). Une station sans enseigne
// OSM connue est exclue ; elle réapparaîtra si OSM la renseigne ensuite.
function passesBrandFilter(station) {
  if (!STATION_BRAND_FILTER.length) return true;
  const brand = brandForStation(station);
  if (!brand) return false;
  const b = brand.toLowerCase();
  return STATION_BRAND_FILTER.some((k) => b.includes(k));
}

function renderStationsFromCache() {
  const list = stationCache.filter(passesBrandFilter);
  const field = FUEL_FIELDS[stationFuel];

  // Échelle de prix du carburant choisi pour colorer du moins cher au plus cher.
  const prices = list.map((s) => Number(s[field])).filter((p) => Number.isFinite(p) && p > 0);
  const min = prices.length ? Math.min(...prices) : 0;
  const max = prices.length ? Math.max(...prices) : 0;

  const seen = new Set();

  list.forEach((station) => {
    const id = String(station.id);
    seen.add(id);

    const icon = L.divIcon({
      className: '',
      html: stationPinHtml(station, min, max),
      iconSize: [46, 22],
      iconAnchor: [23, 11],
      popupAnchor: [0, -12]
    });

    const title = stationTitle(station);
    let marker = stationMarkers[id];
    if (marker) {
      marker.setIcon(icon);
      marker.setPopupContent(stationPopupHtml(station));
      marker.setTooltipContent(title);
    } else {
      marker = L.marker([station.geom.lat, station.geom.lon], { icon });
      marker.bindPopup(stationPopupHtml(station));
      marker.bindTooltip(title, { direction: 'top', offset: [0, -10] });
      stationLayer.addLayer(marker);
      stationMarkers[id] = marker;
    }
  });

  // Retire les stations sorties de la zone (ou filtrées par enseigne).
  Object.keys(stationMarkers).forEach((id) => {
    if (!seen.has(id)) {
      stationLayer.removeLayer(stationMarkers[id]);
      delete stationMarkers[id];
    }
  });

  setStationStatus(`${list.length} station${list.length > 1 ? 's' : ''}`);
}

function fuelPriceColor(price, min, max) {
  if (!Number.isFinite(price) || price <= 0) return '#8a95b8';
  if (max <= min) return '#10b981';
  const r = (price - min) / (max - min);     // 0 = moins cher, 1 = plus cher
  const hue = 130 - 130 * r;                  // 130 (vert) -> 0 (rouge)
  return `hsl(${hue.toFixed(0)},72%,42%)`;
}

function formatFuelPrice(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toFixed(3).replace('.', ',');
}

function stationPinHtml(station, min, max) {
  const raw = station[FUEL_FIELDS[stationFuel]];
  const price = formatFuelPrice(raw);

  if (!price) {
    return `<div class="fuel-pin no-price"><span>—</span></div>`;
  }

  const color = fuelPriceColor(Number(raw), min, max);
  return `<div class="fuel-pin" style="background:${color}"><span>${price}</span></div>`;
}

function stationPopupHtml(station) {
  const title = escapeHtml(stationTitle(station));
  const address = [station.adresse, [station.cp, station.ville].filter(Boolean).join(' ')]
    .filter(Boolean).join(', ');
  const sub = escapeHtml(address || 'Adresse non renseignée');

  const rows = Object.keys(FUEL_FIELDS).map((key) => {
    const price = formatFuelPrice(station[FUEL_FIELDS[key]]);
    const isActive = key === stationFuel;
    return `
      <div class="yova-popup-item" style="${isActive ? 'outline:2px solid var(--blue-500);outline-offset:-2px' : ''}">
        <div class="yova-popup-label">${FUEL_LABELS[key]}</div>
        <div class="yova-popup-value">${price ? price + ' €' : '—'}</div>
      </div>`;
  }).join('');

  return `
    <div class="yova-popup">
      <div class="yova-popup-head">
        <div class="yova-popup-title">${title}</div>
        <div class="yova-popup-sub">${sub || 'Adresse non renseignée'}</div>
      </div>
      <div class="yova-popup-body">
        <div class="yova-popup-grid">${rows}</div>
        <div class="yova-popup-actions">
          <a class="yova-popup-btn soft" href="https://www.google.com/maps?q=${station.geom.lat},${station.geom.lon}" target="_blank">Y aller</a>
        </div>
      </div>
    </div>`;
}