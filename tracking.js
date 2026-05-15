let map;
let markerLayer;
let vehicles = [];
let selectedPlate = null;

const params = new URLSearchParams(window.location.search);
const focusPlate = normalizePlate(params.get('plate') || '');

document.addEventListener('DOMContentLoaded', async () => {
  const ok = await requireAuth();
  if (!ok) return;

  initMap();
  document.getElementById('refreshBtn')?.addEventListener('click', loadPositions);
  document.getElementById('searchInput')?.addEventListener('input', renderList);

  await loadPositions();
  setInterval(loadPositions, 60000);
});


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
}

async function loadPositions() {
  setLoading(true, 'Chargement flotte...');

  try {
    const data = await apiFetch('/tracking/vehicles');
    vehicles = data.vehicles || [];
    renderStats();
    renderList();
    renderMarkers();
    setLoading(false, `Mis à jour: ${new Date().toLocaleTimeString('fr-FR')}`);
  } catch (error) {
    console.error(error);
    setLoading(true, `Erreur: ${error.message}`);
  }
}

function renderMarkers() {
  markerLayer.clearLayers();
  const bounds = [];
  let focusMarker = null;

  vehicles.forEach((vehicle) => {
    if (vehicle.lat == null || vehicle.lng == null) return;

    const marker = L.marker([vehicle.lat, vehicle.lng], {
      icon: L.divIcon({
        className: '',
        html: truckMarkerHtml(vehicle),
        iconSize: [54, 54],
        iconAnchor: [27, 27],
        popupAnchor: [0, -28]
      })
    });

    marker.bindPopup(popupHtml(vehicle));
    marker.on('click', () => selectVehicle(vehicle.immatriculation, false));
    marker.addTo(markerLayer);
    vehicle._marker = marker;
    bounds.push([vehicle.lat, vehicle.lng]);

    if (focusPlate && normalizePlate(vehicle.immatriculation) === focusPlate) {
      focusMarker = marker;
    }
  });

  if (focusMarker) {
    const vehicle = vehicles.find((v) => normalizePlate(v.immatriculation) === focusPlate);
    selectVehicle(vehicle.immatriculation, true);
    focusMarker.openPopup();
  } else if (bounds.length) {
    map.fitBounds(bounds, { padding: [45, 45] });
  }
}

function popupHtml(vehicle) {
  const speed = Math.round(Number(vehicle.speed || 0));
  const stateLabel = getStateLabel(vehicle);
  const provider = providerLabel(vehicle.provider);

  const fiche = vehicle.vehicleId
    ? `<a class="yova-popup-btn primary" href="vehicule.html?id=${vehicle.vehicleId}">Ouvrir fiche</a>`
    : `<span class="yova-popup-btn soft">Non lié Mongo</span>`;

  return `
    <div class="yova-popup">
      <div class="yova-popup-head">
        <div class="yova-popup-title">${escapeHtml(vehicle.immatriculation || vehicle.name || 'Véhicule')}</div>
        <div class="yova-popup-sub">${escapeHtml(vehicle.name || provider || '')}</div>
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

function renderList() {
  const el = document.getElementById('vehicleList');
  if (!el) return;

  const q = (document.getElementById('searchInput')?.value || '').toLowerCase().trim();
  const rows = vehicles.filter((vehicle) => {
    const text = [
      vehicle.name,
      vehicle.immatriculation,
      vehicle.address,
      vehicle.marque,
      vehicle.modele,
      vehicle.provider
    ].join(' ').toLowerCase();

    return !q || text.includes(q);
  });

  if (!rows.length) {
    el.innerHTML = '<div style="padding:18px;color:var(--muted);font-weight:700">Aucun camion trouvé</div>';
    return;
  }

  el.innerHTML = rows.map((vehicle) => `
    <div class="vehicle-card ${normalizePlate(vehicle.immatriculation) === normalizePlate(selectedPlate) ? 'active' : ''}" onclick="selectVehicle('${escapeAttr(vehicle.immatriculation || '')}', true)">
      <div class="vehicle-top">
        <div>
          <div class="vehicle-name">${escapeHtml(vehicle.immatriculation || vehicle.name || 'Véhicule')}</div>
          <div class="vehicle-sub">${escapeHtml(vehicle.name || '')}</div>
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
        </div>
      </div>
    </div>
  `).join('');
}

function renderStats() {
  document.getElementById('statTotal').textContent = vehicles.length;
  document.getElementById('statMoving').textContent = vehicles.filter((v) => v.ignition && !v.standstill).length;
  document.getElementById('statLinked').textContent = vehicles.filter((v) => v.vehicleId).length;
}

function selectVehicle(plate, openPopup) {
  selectedPlate = plate;

  const vehicle = vehicles.find((v) => normalizePlate(v.immatriculation) === normalizePlate(plate));

  renderList();

  if (!vehicle || !vehicle._marker) return;

  map.setView([vehicle.lat, vehicle.lng], Math.max(map.getZoom(), 14), { animate: true });

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

  return `
    <div class="${cls}">
    <img src="truck-marker.png" alt="Camion">
      ${isMoving ? `<span class="speed-bubble">${speed}</span>` : ''}
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