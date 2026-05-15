const VEHICLE_DOC_DEFS = [
  {
    key: 'carte_grise',
    label: 'Carte grise',
    sub: 'Identification officielle du vehicule',
    icon: 'CG',
    color: '#4f72f5',
    fields: [
      { key: 'carte_grise_numero', label: 'Numero' },
      { key: 'carte_grise_titulaire', label: 'Titulaire' },
      { key: 'carte_grise_date_emission', label: 'Emission', isDate: true },
      { key: 'carte_grise_date_mise_circulation', label: '1re MEC', isDate: true }
    ]
  },
  {
    key: 'contrat_location',
    label: 'Contrat de location',
    sub: 'Seulement si le vehicule est loue',
    icon: 'LOC',
    color: '#f59e0b',
    fields: [
      { key: 'contrat_location_reference', label: 'Reference' },
      { key: 'contrat_location_bailleur', label: 'Bailleur' },
      { key: 'contrat_location_date_debut', label: 'Debut', isDate: true },
      { key: 'contrat_location_date_fin', label: 'Fin', isDate: true, isExpiry: true }
    ]
  },
  {
    key: 'controle_technique',
    label: 'Controle technique',
    sub: 'Conformite technique',
    icon: 'CT',
    color: '#10b981',
    fields: [
      { key: 'controle_technique_centre', label: 'Centre' },
      { key: 'controle_technique_date_controle', label: 'Controle le', isDate: true },
      { key: 'controle_technique_expiration', label: 'Expire le', isDate: true, isExpiry: true }
    ]
  },
  {
    key: 'assurance',
    label: 'Assurance',
    sub: 'Police d assurance',
    icon: 'ASS',
    color: '#0ea5e9',
    fields: [
      { key: 'assurance_compagnie', label: 'Compagnie' },
      { key: 'assurance_numero_police', label: 'Police' },
      { key: 'assurance_date_debut', label: 'Debut', isDate: true },
      { key: 'assurance_expiration', label: 'Expire le', isDate: true, isExpiry: true }
    ]
  },
  {
    key: 'licence_transport',
    label: 'Licence transport',
    sub: 'Autorisation d exploitation',
    icon: 'LT',
    color: '#7c4fe0',
    fields: [
      { key: 'licence_transport_numero', label: 'Numero' },
      { key: 'licence_transport_autorite', label: 'Autorite' },
      { key: 'licence_transport_delivrance', label: 'Delivree le', isDate: true },
      { key: 'licence_transport_expiration', label: 'Expire le', isDate: true, isExpiry: true }
    ]
  },
  {
    key: 'recepisse_transport',
    label: 'Recepisse transport',
    sub: 'Recepisse administratif',
    icon: 'RT',
    color: '#f97316',
    fields: [
      { key: 'recepisse_transport_numero', label: 'Numero' },
      { key: 'recepisse_transport_autorite', label: 'Autorite' },
      { key: 'recepisse_transport_delivrance', label: 'Delivre le', isDate: true },
      { key: 'recepisse_transport_expiration', label: 'Expire le', isDate: true, isExpiry: true }
    ]
  },
  {
    key: 'chronotachygraphe',
    label: 'Chronotachygraphe',
    sub: 'Tachygraphe et etalonnage',
    icon: 'CHR',
    color: '#ec4899',
    fields: [
      { key: 'chronotachygraphe_marque', label: 'Marque' },
      { key: 'chronotachygraphe_numero', label: 'Numero' },
      { key: 'chronotachygraphe_etalonnage', label: 'Etalonnage', isDate: true },
      { key: 'chronotachygraphe_expiration', label: 'Echeance', isDate: true, isExpiry: true }
    ]
  },
  {
    key: 'limiteur',
    label: 'Limiteur',
    sub: 'Controle du limiteur de vitesse',
    icon: 'LIM',
    color: '#14b8a6',
    fields: [
      { key: 'limiteur_marque', label: 'Marque' },
      { key: 'limiteur_numero', label: 'Numero' },
      { key: 'limiteur_verification', label: 'Verification', isDate: true },
      { key: 'limiteur_expiration', label: 'Echeance', isDate: true, isExpiry: true }
    ]
  }
];

let vehicleId = null;
let vehicle = null;

document.addEventListener('DOMContentLoaded', async () => {
  const ok = await requireAuth();
  if (!ok) return;

  vehicleId = new URLSearchParams(window.location.search).get('id');

  if (!vehicleId) {
    document.getElementById('notFound')?.style.setProperty('display', 'block');
    return;
  }

  await refreshVehicle();
});

async function refreshVehicle() {
  try {
    const data = await apiFetch(`/vehicles/${vehicleId}`);
    vehicle = data.vehicle || data;
    document.getElementById('content')?.style.setProperty('display', 'block');
    document.getElementById('notFound')?.style.setProperty('display', 'none');
    render();
  } catch {
    document.getElementById('content')?.style.setProperty('display', 'none');
    document.getElementById('notFound')?.style.setProperty('display', 'block');
  }
}

function render() {
  if (!vehicle) return;

  document.title = `${vehicle.immatriculation || 'Vehicule'} - Yovatrans`;
  document.getElementById('bcName').textContent = vehicle.immatriculation || 'Vehicule';

  renderHero();
  renderIdentity();
  renderOperations();
  renderDocs();
  renderFiles();
}

function renderHero() {
  document.getElementById('heroPlate').textContent = vehicle.immatriculation || 'Sans immatriculation';
  document.getElementById('heroSub').textContent =
    [vehicle.marque, vehicle.modele, vehicle.type_vehicule].filter(Boolean).join(' · ') || 'Vehicule';

  let badges = renderStatutBadge(vehicle.statut);
  badges += renderPossessionBadge(vehicle.mode_possession);

  const alerts = getActiveAlerts(vehicle);
  if (alerts.length) {
    badges += `<span class="badge badge-red">${alerts[0]}</span>`;
  }

  document.getElementById('heroBadges').innerHTML = badges;
  document.getElementById('heroQuick').innerHTML = `
    <div class="qi"><div class="ql">Marque</div><div class="qv">${vehicle.marque || '—'} ${vehicle.modele || ''}</div></div>
    <div class="qi"><div class="ql">Annee</div><div class="qv">${vehicle.annee || '—'}</div></div>
    <div class="qi"><div class="ql">Kilometrage</div><div class="qv">${formatKilometrage(vehicle.kilometrage)}</div></div>
    <div class="qi"><div class="ql">VIN</div><div class="qv">${vehicle.vin || '—'}</div></div>
    <div class="qi"><div class="ql">Energie</div><div class="qv">${vehicle.energie || '—'}</div></div>
    <div class="qi"><div class="ql">MEC</div><div class="qv">${fmtDate(vehicle.date_mise_en_circulation)}</div></div>
  `;
}

function renderIdentity() {
  const fields = [
    ['Immatriculation', vehicle.immatriculation],
    ['Marque', vehicle.marque],
    ['Modele', vehicle.modele],
    ['Type vehicule', vehicle.type_vehicule],
    ['VIN / Chassis', vehicle.vin],
    ['Annee', vehicle.annee],
    ['Couleur', vehicle.couleur],
    ['Energie', vehicle.energie],
    ['Nombre de places', vehicle.nombre_places],
    ['Charge utile', vehicle.charge_utile],
    ['Date mise en circulation', fmtDate(vehicle.date_mise_en_circulation)]
  ];

  document.getElementById('infoIdentity').innerHTML = fields.map(([label, value]) =>
    infoItem(label, value)
  ).join('');
}

function renderOperations() {
  const fields = [
    ['Statut', stripHtml(renderStatutBadge(vehicle.statut))],
    ['Possession', stripHtml(renderPossessionBadge(vehicle.mode_possession))],
    ['Kilometrage', formatKilometrage(vehicle.kilometrage)],
    ['Observations', vehicle.observations],
    ['Assurance', formatExpiryStatus(vehicle.assurance_expiration)],
    ['Controle technique', formatExpiryStatus(vehicle.controle_technique_expiration)],
    ['Licence transport', formatExpiryStatus(vehicle.licence_transport_expiration)],
    ['Recepisse transport', formatExpiryStatus(vehicle.recepisse_transport_expiration)]
  ];

  document.getElementById('infoOperations').innerHTML = fields.map(([label, value]) =>
    infoItem(label, value)
  ).join('');
}

function renderDocs() {
  const grid = document.getElementById('docsGrid');
  if (!grid) return;

  grid.innerHTML = VEHICLE_DOC_DEFS.map(def => {
    const statusHtml = renderDocStatus(def);
    const fieldsHtml = def.fields.map(field => {
      const rawValue = vehicle[field.key];
      const display = field.isDate ? fmtDate(rawValue) : (rawValue || '');
      return `
        <div class="offidoc-field">
          <div class="offidoc-field-label">${field.label}</div>
          <div class="offidoc-field-val ${display ? '' : 'empty'}">${display || 'Non renseigne'}</div>
        </div>
      `;
    }).join('');

    return `
      <div class="offidoc-card">
        <div class="offidoc-header">
          <div class="offidoc-icon" style="background:${def.color}18;color:${def.color}">${def.icon}</div>
          <div>
            <div class="offidoc-label">${def.label}</div>
            <div class="offidoc-sub">${def.sub}</div>
          </div>
        </div>
        <div class="offidoc-body">
          ${statusHtml}
          <div class="offidoc-fields">${fieldsHtml}</div>
        </div>
      </div>
    `;
  }).join('');
}

function renderDocStatus(def) {
  const expiryField = def.fields.find(field => field.isExpiry);
  if (!expiryField) {
    const hasAnyValue = def.fields.some(field => vehicle[field.key]);
    return `<div class="offidoc-status ${hasAnyValue ? 'ok' : 'empty-s'}">${hasAnyValue ? 'Renseigne' : 'Non renseigne'}</div>`;
  }

  const value = vehicle[expiryField.key];
  if (!value) return `<div class="offidoc-status empty-s">Non renseigne</div>`;

  const days = daysLeft(value);
  if (days < 0) return `<div class="offidoc-status exp">Expire</div>`;
  if (days <= 60) return `<div class="offidoc-status warn">Expire dans ${days}j</div>`;
  return `<div class="offidoc-status ok">Valide</div>`;
}

function toggleEdit() {
  const panel = document.getElementById('editPanel');
  if (!panel) return;

  const isOpening = !panel.classList.contains('open');
  panel.classList.toggle('open');

  if (isOpening) {
    fillEdit();
    syncEditLocationVisibility();

    setTimeout(() => {
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }
}
function renderFiles() {
  const list = document.getElementById('docList');
  if (!list) return;

  const docs = vehicle.documents || [];

  if (!docs.length) {
    list.innerHTML = `<p style="color:var(--muted);font-size:0.875rem;text-align:center;padding:16px">Aucun document disponible</p>`;
    return;
  }

  list.innerHTML = docs.map((doc, i) => {
    const file = doc.file || doc;
    const name = doc.label || file.originalName || file.name || 'Document';

    return `
      <div class="doc-item">
        <div class="doc-icon">PDF</div>
        <div class="doc-info">
          <div class="doc-name">${name}</div>
          <div class="doc-meta">${file.mimeType || ''}</div>
        </div>
       <div class="doc-btns">
  <button class="doc-btn" onclick="openDoc(${i})" title="Voir">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  </button>

  <button class="doc-btn del" onclick="showDeleteDocModal('${doc._id}')" title="Supprimer">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
      <path d="M10 11v6"/>
      <path d="M14 11v6"/>
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
    </svg>
  </button>
</div>
      </div>
    `;
  }).join('');
}

let pendingDeleteDocId = null;

function showDeleteDocModal(documentId) {
  pendingDeleteDocId = documentId;
  document.getElementById('deleteDocModal')?.classList.add('open');
}

function closeDeleteDocModal() {
  pendingDeleteDocId = null;
  document.getElementById('deleteDocModal')?.classList.remove('open');
}

async function confirmDeleteDoc() {
  if (!pendingDeleteDocId) return;

  try {
    const data = await apiFetch(`/vehicles/${vehicleId}/documents/${pendingDeleteDocId}`, {
      method: 'DELETE'
    });

    vehicle = data.vehicle || data;
    render();
    toast('Document supprimé');
  } catch (error) {
    toast(error.message || 'Erreur suppression document');
  }

  closeDeleteDocModal();
}

function fillEdit() {
  if (!vehicle) {
    console.log('Aucun vehicule charge');
    return;
  }

  console.log('Vehicule charge dans le formulaire :', vehicle);

  setEditValue('e-immatriculation', vehicle.immatriculation);
  setEditValue('e-marque', vehicle.marque);
  setEditValue('e-modele', vehicle.modele);
  setEditValue('e-type', vehicle.type_vehicule);
  setEditValue('e-annee', vehicle.annee);
  setEditValue('e-energie', vehicle.energie);
  setEditValue('e-couleur', vehicle.couleur);
  setEditValue('e-vin', vehicle.vin);
  setEditValue('e-kilometrage', vehicle.kilometrage);
  setEditValue('e-places', vehicle.nombre_places);
  setEditValue('e-charge', vehicle.charge_utile);
  setEditValue('e-mec', vehicle.date_mise_en_circulation);

  setEditValue('e-statut', vehicle.statut || 'actif');
  setEditValue('e-mode-possession', vehicle.mode_possession || 'propre');
  setEditValue('e-observations', vehicle.observations);

  setEditValue('e-cg-num', vehicle.carte_grise_numero);
  setEditValue('e-cg-date', vehicle.carte_grise_date_emission);
  setEditValue('e-cg-titulaire', vehicle.carte_grise_titulaire);
  setEditValue('e-cg-mec', vehicle.carte_grise_date_mise_circulation);

  setEditValue('e-loc-ref', vehicle.contrat_location_reference);
  setEditValue('e-loc-bailleur', vehicle.contrat_location_bailleur);
  setEditValue('e-loc-debut', vehicle.contrat_location_date_debut);
  setEditValue('e-loc-fin', vehicle.contrat_location_date_fin);
  setEditValue('e-loc-montant', vehicle.contrat_location_montant);

  setEditValue('e-ct-centre', vehicle.controle_technique_centre);
  setEditValue('e-ct-date', vehicle.controle_technique_date_controle);
  setEditValue('e-ct-exp', vehicle.controle_technique_expiration);

  setEditValue('e-assurance-compagnie', vehicle.assurance_compagnie);
  setEditValue('e-assurance-police', vehicle.assurance_numero_police);
  setEditValue('e-assurance-debut', vehicle.assurance_date_debut);
  setEditValue('e-assurance-exp', vehicle.assurance_expiration);

  setEditValue('e-licence-num', vehicle.licence_transport_numero);
  setEditValue('e-licence-autorite', vehicle.licence_transport_autorite);
  setEditValue('e-licence-deliv', vehicle.licence_transport_delivrance);
  setEditValue('e-licence-exp', vehicle.licence_transport_expiration);

  setEditValue('e-recepisse-num', vehicle.recepisse_transport_numero);
  setEditValue('e-recepisse-autorite', vehicle.recepisse_transport_autorite);
  setEditValue('e-recepisse-deliv', vehicle.recepisse_transport_delivrance);
  setEditValue('e-recepisse-exp', vehicle.recepisse_transport_expiration);

  setEditValue('e-chrono-marque', vehicle.chronotachygraphe_marque);
  setEditValue('e-chrono-num', vehicle.chronotachygraphe_numero);
  setEditValue('e-chrono-etal', vehicle.chronotachygraphe_etalonnage);
  setEditValue('e-chrono-exp', vehicle.chronotachygraphe_expiration);

  setEditValue('e-limiteur-marque', vehicle.limiteur_marque);
  setEditValue('e-limiteur-num', vehicle.limiteur_numero);
  setEditValue('e-limiteur-verif', vehicle.limiteur_verification);
  setEditValue('e-limiteur-exp', vehicle.limiteur_expiration);
}
async function handleDocs(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;

  for (const file of files) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('label', file.name);
    fd.append('category', 'general');

    try {
      await apiFetch(`/vehicles/${vehicleId}/documents`, {
        method: 'POST',
        body: fd
      });
    } catch (error) {
      toast(error.message || `Erreur upload ${file.name}`);
      return;
    }
  }

  event.target.value = '';
  await refreshVehicle();
  toast('Document ajouté');
}
function makeApiUrl(path) {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  if (path.startsWith('/api/')) return `${API_BASE}${path.replace(/^\/api/, '')}`;
  return `${API_BASE}${path}`;
}

async function openDoc(index) {
  const doc = vehicle.documents[index];
  const file = doc.file || doc;
  if (!file?.path) return alert('Fichier introuvable');

  const token = localStorage.getItem('token');

  const res = await fetch(makeApiUrl(file.path), {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!res.ok) {
    alert('Impossible d’ouvrir le fichier');
    return;
  }

  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  window.open(blobUrl, '_blank');
}

function syncEditLocationVisibility() {
  const mode = document.getElementById('e-mode-possession')?.value || 'propre';
  const block = document.getElementById('editLocationFields');
  if (!block) return;

  block.style.display = mode === 'loue' ? 'block' : 'none';
  block.querySelectorAll('input').forEach(input => {
    input.disabled = mode !== 'loue';
  });
}

async function saveEdit() {
  const immatriculation = document.getElementById('e-immatriculation')?.value.trim() || '';
  const marque = document.getElementById('e-marque')?.value.trim() || '';
  const modele = document.getElementById('e-modele')?.value.trim() || '';

  if (!immatriculation || !marque || !modele) {
    alert('Immatriculation, marque et modele sont obligatoires.');
    return;
  }

  const payload = {
    immatriculation,
    marque,
    modele,
    type_vehicule: document.getElementById('e-type')?.value || '',
    annee: document.getElementById('e-annee')?.value || '',
    energie: document.getElementById('e-energie')?.value || '',
    couleur: document.getElementById('e-couleur')?.value || '',
    vin: document.getElementById('e-vin')?.value || '',
    kilometrage: document.getElementById('e-kilometrage')?.value || '',
    nombre_places: document.getElementById('e-places')?.value || '',
    charge_utile: document.getElementById('e-charge')?.value || '',
    date_mise_en_circulation: document.getElementById('e-mec')?.value || '',
    statut: document.getElementById('e-statut')?.value || 'actif',
    mode_possession: document.getElementById('e-mode-possession')?.value || 'propre',
    observations: document.getElementById('e-observations')?.value || '',
    carte_grise_numero: document.getElementById('e-cg-num')?.value || '',
    carte_grise_date_emission: document.getElementById('e-cg-date')?.value || '',
    carte_grise_titulaire: document.getElementById('e-cg-titulaire')?.value || '',
    carte_grise_date_mise_circulation: document.getElementById('e-cg-mec')?.value || '',
    contrat_location_reference: document.getElementById('e-loc-ref')?.value || '',
    contrat_location_bailleur: document.getElementById('e-loc-bailleur')?.value || '',
    contrat_location_date_debut: document.getElementById('e-loc-debut')?.value || '',
    contrat_location_date_fin: document.getElementById('e-loc-fin')?.value || '',
    contrat_location_montant: document.getElementById('e-loc-montant')?.value || '',
    controle_technique_centre: document.getElementById('e-ct-centre')?.value || '',
    controle_technique_date_controle: document.getElementById('e-ct-date')?.value || '',
    controle_technique_expiration: document.getElementById('e-ct-exp')?.value || '',
    assurance_compagnie: document.getElementById('e-assurance-compagnie')?.value || '',
    assurance_numero_police: document.getElementById('e-assurance-police')?.value || '',
    assurance_date_debut: document.getElementById('e-assurance-debut')?.value || '',
    assurance_expiration: document.getElementById('e-assurance-exp')?.value || '',
    licence_transport_numero: document.getElementById('e-licence-num')?.value || '',
    licence_transport_autorite: document.getElementById('e-licence-autorite')?.value || '',
    licence_transport_delivrance: document.getElementById('e-licence-deliv')?.value || '',
    licence_transport_expiration: document.getElementById('e-licence-exp')?.value || '',
    recepisse_transport_numero: document.getElementById('e-recepisse-num')?.value || '',
    recepisse_transport_autorite: document.getElementById('e-recepisse-autorite')?.value || '',
    recepisse_transport_delivrance: document.getElementById('e-recepisse-deliv')?.value || '',
    recepisse_transport_expiration: document.getElementById('e-recepisse-exp')?.value || '',
    chronotachygraphe_marque: document.getElementById('e-chrono-marque')?.value || '',
    chronotachygraphe_numero: document.getElementById('e-chrono-num')?.value || '',
    chronotachygraphe_etalonnage: document.getElementById('e-chrono-etal')?.value || '',
    chronotachygraphe_expiration: document.getElementById('e-chrono-exp')?.value || '',
    limiteur_marque: document.getElementById('e-limiteur-marque')?.value || '',
    limiteur_numero: document.getElementById('e-limiteur-num')?.value || '',
    limiteur_verification: document.getElementById('e-limiteur-verif')?.value || '',
    limiteur_expiration: document.getElementById('e-limiteur-exp')?.value || ''
  };

  try {
    const data = await apiFetch(`/vehicles/${vehicleId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });

    vehicle = data.vehicle || data;
    document.getElementById('editPanel')?.classList.remove('open');
    render();
    toast('Fiche vehicule mise a jour');
  } catch (error) {
    toast(error.message || 'Erreur de mise a jour');
  }
}

function toggleConfirm() {
  document.getElementById('confirmBox')?.classList.toggle('open');
}

async function deleteVehicle() {
  try {
    await apiFetch(`/vehicles/${vehicleId}`, { method: 'DELETE' });
    window.location.href = 'vehicules.html';
  } catch (error) {
    toast(error.message || 'Erreur suppression');
  }
}
function setEditValue(id, value) {
  const el = document.getElementById(id);
  if (!el) return;

  let finalValue = value;

  if (finalValue === null || finalValue === undefined) {
    finalValue = '';
  }

  if (el.type === 'date' && finalValue) {
    finalValue = String(finalValue).slice(0, 10);
  }

  el.value = finalValue;
  el.placeholder = finalValue || '';
}

function infoItem(label, value) {
  const display = value == null || value === '' ? 'Non renseigne' : value;
  const muted = value == null || value === '' ? ' muted' : '';
  return `<div class="info-item"><div class="il">${label}</div><div class="iv${muted}">${display}</div></div>`;
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

function getActiveAlerts(currentVehicle) {
  const alerts = [];
  [
    ['assurance_expiration', 'Assurance a surveiller'],
    ['controle_technique_expiration', 'Controle technique a surveiller'],
    ['licence_transport_expiration', 'Licence transport a surveiller'],
    ['recepisse_transport_expiration', 'Recepisse a surveiller'],
    ['chronotachygraphe_expiration', 'Chronotachygraphe a surveiller'],
    ['limiteur_expiration', 'Limiteur a surveiller']
  ].forEach(([key, label]) => {
    if (!currentVehicle[key]) return;
    if (daysLeft(currentVehicle[key]) <= 60) alerts.push(label);
  });
  return alerts;
}

function formatExpiryStatus(value) {
  if (!value) return 'Non renseigne';
  const days = daysLeft(value);
  if (days < 0) return `${fmtDate(value)} (expire)`;
  if (days <= 60) return `${fmtDate(value)} (${days}j)`;
  return fmtDate(value);
}

function formatKilometrage(value) {
  if (value == null || value === '') return '—';
  const num = Number(value);
  if (Number.isNaN(num)) return value;
  return `${num.toLocaleString('fr-FR')} km`;
}

function fmtDate(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    });
  } catch {
    return value;
  }
}

function daysLeft(value) {
  return Math.ceil((new Date(value) - new Date()) / 86400000);
}

function stripHtml(html) {
  return String(html).replace(/<[^>]+>/g, '').trim();
}

function toast(message) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}
