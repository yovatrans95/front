let all = [];
let filtered = [];
let view = 'table';
let page = 1;
const PER = 10;
let sortField = 'immatriculation';
let sortDir = 1;

document.addEventListener('DOMContentLoaded', async () => {
  const ok = await requireAuth();
  if (!ok) return;

  await fetchVehicles();

  document.getElementById('searchInput')?.addEventListener('input', debounce(filter, 200));
  document.getElementById('filterStatut')?.addEventListener('change', filter);
  document.getElementById('filterPossession')?.addEventListener('change', filter);
});

async function fetchVehicles() {
  const data = await apiFetch('/vehicles');
  all = data.vehicles || data || [];
  filter();
  updateStats();
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function filter() {
  const q = (document.getElementById('searchInput')?.value || '').toLowerCase();
  const statut = document.getElementById('filterStatut')?.value || '';
  const possession = document.getElementById('filterPossession')?.value || '';

  filtered = all.filter(vehicle => {
    const text = [
      vehicle.immatriculation,
      vehicle.marque,
      vehicle.modele,
      vehicle.type_vehicule,
      vehicle.vin,
      vehicle.assurance_numero_police
    ].join(' ').toLowerCase();

    const matchesQuery = !q || text.includes(q);
    const matchesStatut = !statut || vehicle.statut === statut;
    const matchesPossession = !possession || vehicle.mode_possession === possession;

    return matchesQuery && matchesStatut && matchesPossession;
  });

  filtered.sort((a, b) => compareValues(a[sortField], b[sortField]));
  page = 1;
  render();
}

function compareValues(a, b) {
  const av = normalizeSortValue(a);
  const bv = normalizeSortValue(b);
  if (av < bv) return -sortDir;
  if (av > bv) return sortDir;
  return 0;
}

function normalizeSortValue(value) {
  if (value == null) return '';
  if (typeof value === 'number') return value;
  const asDate = Date.parse(value);
  if (!Number.isNaN(asDate) && /^\d{4}-\d{2}-\d{2}/.test(String(value))) {
    return asDate;
  }
  return String(value).toLowerCase();
}

function sortBy(field) {
  if (sortField === field) {
    sortDir *= -1;
  } else {
    sortField = field;
    sortDir = 1;
  }

  document.querySelectorAll('th[data-sort]').forEach(th => {
    th.classList.toggle('sorted', th.dataset.sort === field);
  });

  filtered.sort((a, b) => compareValues(a[sortField], b[sortField]));
  render();
}

function setView(nextView) {
  view = nextView;
  document.getElementById('tableView').style.display = view === 'table' ? 'block' : 'none';
  document.getElementById('gridView').style.display = view === 'grid' ? 'block' : 'none';
  document.getElementById('btnTable')?.classList.toggle('active', view === 'table');
  document.getElementById('btnGrid')?.classList.toggle('active', view === 'grid');
  render();
}

function render() {
  renderTable();
  renderGrid();
  renderPagination('pag1');
  renderPagination('pag2');
}

function getPageItems() {
  return filtered.slice((page - 1) * PER, page * PER);
}

function renderTable() {
  const tbody = document.getElementById('tbody');
  if (!tbody) return;

  const rows = getPageItems();
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7">Aucun vehicule trouve</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(vehicle => `
    <tr onclick="go('${vehicle._id}')">
      <td>
        <div class="driver-cell">
          <div class="avatar-ph">${vehicleIcon(vehicle)}</div>
          <div>
            <div class="driver-name">${vehicle.immatriculation || 'Sans immatriculation'}</div>
            <div class="driver-sub">${[vehicle.marque, vehicle.modele].filter(Boolean).join(' ') || 'Modele non renseigne'}</div>
          </div>
        </div>
      </td>
      <td>${vehicle.type_vehicule || '—'}</td>
      <td>${renderPossessionBadge(vehicle.mode_possession)}</td>
      <td>${renderExpiry(vehicle.assurance_expiration, 'assurance')}</td>
      <td>${renderExpiry(vehicle.controle_technique_expiration, 'controle')}</td>
      <td>${renderStatutBadge(vehicle.statut)}</td>
      <td><span class="view-link" onclick="event.stopPropagation();go('${vehicle._id}')">Voir fiche</span></td>
    </tr>
  `).join('');
}

function renderGrid() {
  const grid = document.getElementById('grid');
  if (!grid) return;

  const rows = getPageItems();
  if (!rows.length) {
    grid.innerHTML = `<div class="empty-state">Aucun vehicule trouve</div>`;
    return;
  }

  grid.innerHTML = rows.map(vehicle => `
    <div class="driver-card" onclick="go('${vehicle._id}')">
      <div class="card-av-ph">${vehicleIcon(vehicle)}</div>
      <div class="card-name">${vehicle.immatriculation || 'Sans immatriculation'}</div>
      <div class="card-phone">${[vehicle.marque, vehicle.modele].filter(Boolean).join(' ') || 'Modele non renseigne'}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        ${renderStatutBadge(vehicle.statut)}
        ${renderPossessionBadge(vehicle.mode_possession)}
      </div>
      <div class="card-meta">
        <span style="font-size:0.75rem;color:var(--muted)">${vehicle.type_vehicule || 'Type non renseigne'}</span>
        <span style="font-size:0.75rem;color:var(--text2);font-weight:700">${formatAlertLabel(vehicle)}</span>
      </div>
    </div>
  `).join('');
}

function renderPagination(targetId) {
  const el = document.getElementById(targetId);
  if (!el) return;

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER));
  const start = filtered.length ? (page - 1) * PER + 1 : 0;
  const end = Math.min(page * PER, filtered.length);

  const buttons = [];
  buttons.push(`<button class="pag-btn" ${page === 1 ? 'disabled' : ''} onclick="changePage(${page - 1})">Prec.</button>`);
  for (let i = 1; i <= totalPages; i += 1) {
    buttons.push(`<button class="pag-btn ${i === page ? 'active' : ''}" onclick="changePage(${i})">${i}</button>`);
  }
  buttons.push(`<button class="pag-btn" ${page === totalPages ? 'disabled' : ''} onclick="changePage(${page + 1})">Suiv.</button>`);

  el.innerHTML = `
    <div class="pag-info">${start}-${end} sur ${filtered.length} vehicule(s)</div>
    <div class="pag-btns">${buttons.join('')}</div>
  `;
}

function changePage(nextPage) {
  const totalPages = Math.max(1, Math.ceil(filtered.length / PER));
  page = Math.min(totalPages, Math.max(1, nextPage));
  render();
}

function updateStats() {
  const now = new Date();
  document.getElementById('stat-total').textContent = all.length;
  document.getElementById('stat-active').textContent = all.filter(vehicle => vehicle.statut === 'actif').length;
  document.getElementById('stat-rented').textContent = all.filter(vehicle => vehicle.mode_possession === 'loue').length;
  document.getElementById('stat-alerts').textContent = all.filter(hasDocumentAlert).length;
}

function hasDocumentAlert(vehicle) {
  const keys = [
    'contrat_location_date_fin',
    'controle_technique_expiration',
    'assurance_expiration',
    'licence_transport_expiration',
    'recepisse_transport_expiration',
    'chronotachygraphe_expiration',
    'limiteur_expiration'
  ];

  return keys.some(key => {
    const value = vehicle[key];
    if (!value) return false;
    const days = daysLeft(value);
    return days <= 60;
  });
}

function formatAlertLabel(vehicle) {
  if (!hasDocumentAlert(vehicle)) return 'Rien a signaler';

  const dates = [
    vehicle.assurance_expiration,
    vehicle.controle_technique_expiration,
    vehicle.licence_transport_expiration,
    vehicle.recepisse_transport_expiration,
    vehicle.chronotachygraphe_expiration,
    vehicle.limiteur_expiration,
    vehicle.contrat_location_date_fin
  ].filter(Boolean);

  const nearest = dates.sort((a, b) => new Date(a) - new Date(b))[0];
  const days = daysLeft(nearest);
  return days < 0 ? 'Document expire' : `Alerte ${days}j`;
}

function renderStatutBadge(statut) {
  const map = {
    actif: ['badge-green', 'Actif'],
    maintenance: ['badge-yellow', 'Maintenance'],
    hors_service: ['badge-red', 'Hors service']
  };
  const [cls, label] = map[statut] || ['badge-gray', statut || '—'];
  return `<span class="badge ${cls}">${label}</span>`;
}

function renderPossessionBadge(mode) {
  const map = {
    propre: ['badge-blue', 'Propre'],
    loue: ['badge-yellow', 'Loue']
  };
  const [cls, label] = map[mode] || ['badge-gray', mode || '—'];
  return `<span class="badge ${cls}">${label}</span>`;
}

function renderExpiry(value, label) {
  if (!value) return '—';
  const days = daysLeft(value);
  const base = fmtDate(value);
  if (days < 0) return `${base} <span class="badge badge-red">${label} expire</span>`;
  if (days <= 60) return `${base} <span class="badge badge-yellow">${days}j</span>`;
  return `${base}`;
}

function vehicleIcon(vehicle) {
  const type = (vehicle.type_vehicule || '').toLowerCase();
  if (type.includes('bus')) return 'BUS';
  if (type.includes('camion')) return 'TR';
  if (type.includes('van')) return 'VAN';
  return 'VH';
}

function go(id) {
  window.location.href = `vehicule.html?id=${id}`;
}

function daysLeft(value) {
  return Math.ceil((new Date(value) - new Date()) / 86400000);
}

function fmtDate(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  } catch {
    return value;
  }
}
