let all = [];
let filtered = [];
let view = 'table';
let page = 1;
const PER = 10;
let sortField = 'nom';
let sortDir = 1;

document.addEventListener('DOMContentLoaded', async () => {
  const ok = await requireAuth();
  if (!ok) return;

  await fetchDrivers();

  document.getElementById('searchInput')?.addEventListener('input', debounce(filter, 200));
  document.getElementById('filterStatut')?.addEventListener('change', filter);
  document.getElementById('filterPermis')?.addEventListener('change', filter);
});

async function fetchDrivers() {
  const data = await apiFetch('/drivers');
  all = data.drivers || data || [];
  filter();
  updateStats();
}

function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

function filter() {
  const q = (document.getElementById('searchInput')?.value || '').toLowerCase();
  const st = document.getElementById('filterStatut')?.value || '';
  const pm = document.getElementById('filterPermis')?.value || '';

  filtered = all.filter(d => {
    const mq = !q || `${d.nom || ''} ${d.prenom || ''} ${d.telephone || ''} ${d.email || ''}`.toLowerCase().includes(q);
    const ms = !st || d.statut === st;
    const mp = !pm || (d.permis_categorie || '').includes(pm);
    return mq && ms && mp;
  });

  filtered.sort((a, b) => {
    const av = String(a[sortField] || '').toLowerCase();
    const bv = String(b[sortField] || '').toLowerCase();
    return av < bv ? -sortDir : av > bv ? sortDir : 0;
  });

  page = 1;
  render();
}

function render() {
  view === 'table' ? renderTable() : renderGrid();
  // Les barres de pagination ne sont plus utilisées : on affiche toute la liste
  // et on la fait défiler. On masque les conteneurs vides pour éviter une barre
  // fantôme sous le tableau / la grille.
  const p1 = document.getElementById('pag1'); if (p1) p1.style.display = 'none';
  const p2 = document.getElementById('pag2'); if (p2 && p2.parentElement) p2.parentElement.style.display = 'none';
}

// Renvoie tous les chauffeurs filtrés : la liste défile en entier (pas de
// pagination — avant, seuls les 10 premiers s'affichaient et les suivants
// étaient inaccessibles car aucune commande de pagination n'était générée).
function getPage() {
  return filtered;
}

function renderTable() {
  const tbody = document.getElementById('tbody');
  const rows = getPage();

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6">Aucun chauffeur trouvé</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(d => `
    <tr onclick="go('${d._id}')">
      <td>${d.nom || ''} ${d.prenom || ''}</td>
      <td>${d.telephone || '—'}</td>
      <td>${d.permis_categorie || '—'}</td>
      <td>${d.email || '—'}</td>
      <td>${d.statut || '—'}</td>
    <td>
  <span class="view-link" onclick="event.stopPropagation();go('${d._id}')">
    Voir fiche
  </span>
</td>
    </tr>
  `).join('');
}

function renderGrid() {
  const grid = document.getElementById('grid');
  const rows = getPage();

  if (!rows.length) {
    grid.innerHTML = `<div>Aucun chauffeur trouvé</div>`;
    return;
  }

  grid.innerHTML = rows.map(d => `
    <div class="driver-card" onclick="go('${d._id}')">
      <div>${d.nom || ''} ${d.prenom || ''}</div>
      <div>${d.telephone || '—'}</div>
      <div>${d.permis_categorie || '—'}</div>
      <div>${d.statut || '—'}</div>
    </div>
  `).join('');
}

function updateStats() {
  const now = new Date();
  const in90 = new Date(now.getTime() + 90 * 86400000);

  document.getElementById('stat-total').textContent = all.length;
  document.getElementById('stat-active').textContent = all.filter(d => d.statut === 'actif').length;
  document.getElementById('stat-expiring').textContent = all.filter(d => {
    if (!d.permis_expiration) return false;
    const e = new Date(d.permis_expiration);
    return e >= now && e <= in90;
  }).length;
  document.getElementById('stat-new').textContent = all.filter(d => {
    if (!d.createdAt && !d.created_at) return false;
    const c = new Date(d.createdAt || d.created_at);
    return c.getMonth() === now.getMonth() && c.getFullYear() === now.getFullYear();
  }).length;
}

function go(id) {
  window.location.href = `driver.html?id=${id}`;
}