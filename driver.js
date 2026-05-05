const OFFIDOC_DEFS = [
  {
    key: 'cni',
    label: "Pièce d'identité",
    sub: 'CNI / Passeport / Titre de séjour',
    icon: '🪪',
    color: '#4f72f5',
    fields: [
      { key: 'type', label: 'Type', driver_key: 'id_type' },
      { key: 'num', label: 'Numéro', driver_key: 'id_num' },
      { key: 'deliv', label: 'Délivré le', driver_key: 'id_deliv', isDate: true },
      { key: 'exp', label: 'Expire le', driver_key: 'id_exp', isDate: true, isExpiry: true }
    ]
  },
  {
    key: 'cc',
    label: 'Carte conducteur',
    sub: 'Chronotachygraphe numérique',
    icon: '💳',
    color: '#7c4fe0',
    fields: [
      { key: 'num', label: 'Numéro', driver_key: 'cc_num' },
      { key: 'exp', label: 'Expire le', driver_key: 'cc_exp', isDate: true, isExpiry: true }
    ]
  },
  {
    key: 'fimo',
    label: 'Carte qualification FIMO/FCO',
    sub: 'Formation initiale / continue',
    icon: '📋',
    color: '#0ea5e9',
    fields: [
      { key: 'type', label: 'Type', driver_key: 'fimo_type' },
      { key: 'num', label: 'Numéro', driver_key: 'fimo_num' },
      { key: 'obt', label: 'Obtenu le', driver_key: 'fimo_obt', isDate: true },
      { key: 'exp', label: 'Expire le', driver_key: 'fimo_exp', isDate: true, isExpiry: true }
    ]
  },
  {
    key: 'vitale',
    label: 'Carte Vitale / Sécu',
    sub: 'Numéro de sécurité sociale',
    icon: '🏥',
    color: '#10b981',
    fields: [
      { key: 'num', label: 'N° Sécu', driver_key: 'ss_num' }
    ]
  },
  {
    key: 'rib',
    label: 'RIB',
    sub: "Relevé d'identité bancaire",
    icon: '🏦',
    color: '#f59e0b',
    fields: [
      { key: 'iban', label: 'IBAN', driver_key: 'rib_iban' },
      { key: 'bic', label: 'BIC', driver_key: 'rib_bic' },
      { key: 'titulaire', label: 'Titulaire', driver_key: 'rib_titulaire' }
    ]
  },
  {
    key: 'btp',
    label: 'Carte BTP',
    sub: 'Bâtiment et Travaux Publics',
    icon: '🏗️',
    color: '#f97316',
    fields: [
      { key: 'num', label: 'Numéro', driver_key: 'btp_num' },
      { key: 'deliv', label: 'Délivré le', driver_key: 'btp_deliv', isDate: true },
      { key: 'exp', label: 'Expire le', driver_key: 'btp_exp', isDate: true, isExpiry: true }
    ]
  }
];


let driverId = null;
let driver = null;

document.addEventListener('DOMContentLoaded', async () => {
  const ok = await requireAuth();
  if (!ok) return;

  driverId = new URLSearchParams(window.location.search).get('id');

  if (!driverId) {
    document.getElementById('notFound')?.style.setProperty('display', 'block');
    return;
  }

  document.getElementById('docModal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('docModal')) closeModal();
  });

  await refreshDriver();
});

async function refreshDriver() {
  try {
    const data = await apiFetch(`/drivers/${driverId}`);
    driver = data.driver || data;
    document.getElementById('content')?.style.setProperty('display', 'block');
    document.getElementById('notFound')?.style.setProperty('display', 'none');
    render();
  } catch {
    document.getElementById('content')?.style.setProperty('display', 'none');
    document.getElementById('notFound')?.style.setProperty('display', 'block');
  }
}

function render() {
  if (!driver) return;

  document.title = `${driver.nom} ${driver.prenom} — Yovatrans`;
  const bcName = document.getElementById('bcName');
  if (bcName) bcName.textContent = `${driver.nom} ${driver.prenom}`;

  renderHero();
  renderPerso();
  renderPermis();
  renderUrgence();
  renderDocs();
  renderOffiDocs();
}

function renderHero() {
  const wrap = document.getElementById('photoWrap');
  if (wrap) {
    if (driver.photo || driver.photoUrl) {
      wrap.innerHTML = `<img src="${driver.photo || driver.photoUrl}" alt="" style="width:100%;height:100%;object-fit:cover">`;
    } else {
      const i = ((driver.nom?.[0] || '') + (driver.prenom?.[0] || '')).toUpperCase();
      wrap.innerHTML = `<div class="photo-initials">${i}</div>`;
    }
  }

  document.getElementById('heroName').textContent = `${driver.nom} ${driver.prenom}`;
  document.getElementById('heroSub').textContent =
    [driver.nationalite, driver.email].filter(Boolean).join(' · ') || '—';

  const sm = {
    actif: ['badge-green', 'Actif'],
    inactif: ['badge-red', 'Inactif'],
    en_conge: ['badge-yellow', 'En congé']
  };
  const [sc, sl] = sm[driver.statut] || ['badge-gray', driver.statut || '—'];

  let badges = `<span class="badge ${sc}">${sl}</span>`;
  if (driver.permis_categorie) badges += `<span class="badge badge-blue">Permis ${driver.permis_categorie}</span>`;

  if (driver.permis_expiration) {
    const d = daysLeft(driver.permis_expiration);
    if (d < 0) badges += `<span class="badge badge-red">Permis expiré</span>`;
    else if (d < 90) badges += `<span class="badge badge-orange">Permis exp. dans ${d}j</span>`;
  }

  document.getElementById('heroBadges').innerHTML = badges;
  document.getElementById('heroQuick').innerHTML = `
    <div class="qi"><div class="ql">Téléphone</div><div class="qv">${driver.telephone || '—'}</div></div>
    <div class="qi"><div class="ql">Naissance</div><div class="qv">${fmtDate(driver.ddn)}</div></div>
    <div class="qi"><div class="ql">Adresse</div><div class="qv">${driver.adresse || '—'}</div></div>
  `;
}

function renderPerso() {
  const fields = [
    ['Nom', driver.nom],
    ['Prénom', driver.prenom],
    ['Date de naissance', fmtDate(driver.ddn)],
    ['Lieu de naissance', driver.lieu_naissance],
    ['Nationalité', driver.nationalite],
    ['Genre', driver.genre],
    ['Situation familiale', driver.situation],
    ["Nombre d'enfants", driver.enfants ?? null],
    ['Téléphone', driver.telephone],
    ['Email', driver.email],
    ['Adresse', driver.adresse]
  ];

  document.getElementById('infoPerso').innerHTML = fields.map(([l, v]) =>
    `<div class="info-item"><div class="il">${l}</div><div class="iv ${(v == null || v === '') ? 'muted' : ''}">${v ?? 'Non renseigné'}</div></div>`
  ).join('');
}

function renderPermis() {
  const exp = driver.permis_expiration ? new Date(driver.permis_expiration) : null;
  const obt = driver.permis_obtention ? new Date(driver.permis_obtention) : null;
  const days = exp ? daysLeft(driver.permis_expiration) : null;

  let bar = '';
  if (exp && obt) {
    const pct = Math.min(100, Math.max(0, Math.round((Date.now() - obt) / (exp - obt) * 100)));
    bar = `
      <div class="p-bar">
        <div class="p-bar-label"><span>Validité écoulée</span><span>${100 - pct}% restant</span></div>
        <div class="p-bar-track"><div class="p-bar-fill" style="width:${pct}%"></div></div>
      </div>
    `;
  }

  let expLabel = fmtDate(driver.permis_expiration) || '—';
  if (days !== null && days < 0) expLabel += ` <span class="badge badge-red">Expiré</span>`;
  else if (days !== null && days < 90) expLabel += ` <span class="badge badge-orange">${days}j</span>`;

  document.getElementById('infoPermis').innerHTML = `
    <div class="permis-card">
      <div class="p-cat">${driver.permis_categorie || '—'}</div>
      <div class="p-num">N° ${driver.permis_numero || '—'}</div>
      <div class="p-dates">
        <div class="p-date"><div class="pdl">Obtenu le</div><div class="pdv">${fmtDate(driver.permis_obtention)}</div></div>
        <div class="p-date"><div class="pdl">Expire le</div><div class="pdv">${expLabel}</div></div>
        <div class="p-date"><div class="pdl">Pays</div><div class="pdv">${driver.permis_pays || '—'}</div></div>
      </div>
      ${bar}
    </div>
  `;
}

function renderUrgence() {
  const el = document.getElementById('infoUrgence');
  if (!driver.urgence_nom && !driver.urgence_prenom) {
    el.innerHTML = `<p style="color:var(--muted);font-size:0.875rem;text-align:center;padding:16px">Aucun contact renseigné</p>`;
    return;
  }

  el.innerHTML = `
    <div class="urgence-row">
      <div class="urg-ico">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
          <circle cx="12" cy="7" r="4"/>
        </svg>
      </div>
      <div>
        <div class="urgence-name">${driver.urgence_nom || ''} ${driver.urgence_prenom || ''}</div>
        <div class="urgence-sub">${driver.urgence_lien || '—'}</div>
        <div class="urgence-tel">${driver.urgence_tel || '—'}</div>
      </div>
    </div>
  `;
}


function renderDocs() {
  const list = document.getElementById('docList');
  if (!list) return;

  const docs = driver.documents || [];
  if (!docs.length) {
    list.innerHTML = `<p style="color:var(--muted);font-size:0.875rem;text-align:center;padding:16px">Aucun document disponible</p>`;
    return;
  }

  list.innerHTML = docs.map((doc, i) => {
    const file = doc.file || doc;
const isImg = (file.mimeType || file.type || '').startsWith('image/');
const url = file.url || file.path || '#';
const name = doc.label || file.originalName || file.name || 'Document';
const size = file.size || '—';
const date = doc.createdAt || file.uploadedAt || '—';
    const icon = isImg
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;

   
    return `
      <div class="doc-item">
        <div class="doc-icon">${icon}</div>
        <div class="doc-info">
          <div class="doc-name" title="${name}">${name}</div>
          <div class="doc-meta">${size} · ${fmtDate(date)}</div>
        </div>
        <div class="doc-btns">
          <button class="doc-btn" onclick="viewDoc(${i})" title="Voir">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          </button>
         <button class="doc-btn" onclick="openDocNewTab(${i})" title="Ouvrir">↗</button>
        </div>
      </div>
    `;
  }).join('');
}

function renderOffiDocs() {
  const grid = document.getElementById('offiDocsGrid');
  if (!grid) return;

  grid.innerHTML = OFFIDOC_DEFS.map(def => {
    const fieldsHtml = def.fields.map(f => {
      const val = driver[f.driver_key];
      const display = f.isDate ? fmtDate(val) : (val || null);
      return `
        <div class="offidoc-field">
          <div class="offidoc-field-label">${f.label}</div>
          <div class="offidoc-field-val ${!display ? 'empty' : ''}">${display || 'Non renseigné'}</div>
        </div>
      `;
    }).join('');

    const expiryField = def.fields.find(f => f.isExpiry);
    const statusHtml = expiryField ? (() => {
      const val = driver[expiryField.driver_key];
      if (!val) return `<div class="offidoc-status empty-s">Non renseigné</div>`;
      const d = daysLeft(val);
      if (d < 0) return `<div class="offidoc-status exp">Expiré</div>`;
      if (d < 90) return `<div class="offidoc-status warn">Expire dans ${d}j</div>`;
      return `<div class="offidoc-status ok">Valide</div>`;
    })() : '';

    return `
      <div class="offidoc-card">
        <div class="offidoc-header">
          <div class="offidoc-icon" style="background:${def.color}18">${def.icon}</div>
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

async function viewDoc(i) {
  const docs = driver.documents || [];
  const doc = docs[i];
  if (!doc) return;

  const file = doc.file || doc;
  const url = file.url || file.path;
  const type = file.mimeType || '';
  const name = doc.label || file.originalName || 'Document';

  try {
    const blobUrl = await getSecureBlobUrl(url);

    showDocModal(name, type, blobUrl);
  } catch (error) {
    toast(error.message || 'Erreur lecture document');
  }
}
async function openDocNewTab(i) {
  const docs = driver.documents || [];
  const doc = docs[i];
  if (!doc) return;

  const file = doc.file || doc;
  const url = file.url || file.path;

  try {
    const blobUrl = await getSecureBlobUrl(url);
    window.open(blobUrl, '_blank');
  } catch (error) {
    toast(error.message || 'Erreur ouverture document');
  }
}
function makeApiUrl(path) {
  if (!path) return '';
  if (path.startsWith('http')) return path;

  // enlève le /api en doublon
  if (path.startsWith('/api/')) {
    return `${API_BASE}${path.replace(/^\/api/, '')}`;
  }

  return `${API_BASE}${path}`;
}
async function getSecureBlobUrl(url) {
  const token = localStorage.getItem('token');

  const response = await fetch(makeApiUrl(url), {
    method: 'GET',
    credentials: 'include',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });

  if (!response.ok) {
    throw new Error(`Erreur ${response.status}`);
  }

  const blob = await response.blob();
  return URL.createObjectURL(blob);
}
async function openSecureFile(url, mimeType = 'application/octet-stream', filename = 'document') {
  const response = await fetch(`${API_BASE_URL}${url}`, {
    method: 'GET',
    credentials: 'include'
  });

  if (!response.ok) {
    throw new Error('Impossible de charger le fichier');
  }

  const blob = await response.blob();
  const blobUrl = URL.createObjectURL(blob);

  window.open(blobUrl, '_blank');
}

function showDocModal(name, type, data, isUrl = false) {
  document.getElementById('docModalTitle').textContent = name;
  const body = document.getElementById('docModalBody');

  const src = data;

  if (type.startsWith('image/')) {
    body.innerHTML = `<img src="${src}" style="max-width:100%;border-radius:8px">`;
  } else if (type === 'application/pdf') {
    body.innerHTML = `<iframe src="${src}" style="width:100%;height:480px;border:none;border-radius:8px"></iframe>`;
  } else {
    body.innerHTML = `<p style="color:var(--muted)">Aperçu non disponible. <a href="${src}" target="_blank" rel="noopener noreferrer" style="color:var(--blue-600)">Ouvrir</a></p>`;
  }

  document.getElementById('docModal').classList.add('open');
}

function closeModal() {
  document.getElementById('docModal').classList.remove('open');
}

async function handlePhoto(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  const fd = new FormData();
  fd.append('photo', file);

  try {
    await apiFetch(`/drivers/${driverId}`, {
      method: 'PATCH',
      body: fd
    });
    await refreshDriver();
    toast('Photo mise à jour');
  } catch (error) {
    toast(error.message || 'Erreur photo');
  }
}

function toggleEdit() {
  const p = document.getElementById('editPanel');
  const open = p.classList.toggle('open');
  if (open) {
    fillEdit();
    p.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function toDateInputValue(value) {
  if (!value) return '';

  if (typeof value === 'string') {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
  }

  const date = new Date(value);
  if (isNaN(date.getTime())) return '';

  return date.toISOString().slice(0, 10);
}

function fillEdit() {
  const m = {
    'e-nom': 'nom',
    'e-prenom': 'prenom',
    'e-ddn': 'ddn',
    'e-lieu': 'lieu_naissance',
    'e-nat': 'nationalite',
    'e-genre': 'genre',
    'e-sit': 'situation',
    'e-enfants': 'enfants',
    'e-adresse': 'adresse',
    'e-tel': 'telephone',
    'e-email': 'email',
    'e-pnum': 'permis_numero',
    'e-pcat': 'permis_categorie',
    'e-pobt': 'permis_obtention',
    'e-pexp': 'permis_expiration',
    'e-ppays': 'permis_pays',
    'e-statut': 'statut',
    'e-unom': 'urgence_nom',
    'e-uprenom': 'urgence_prenom',
    'e-ulien': 'urgence_lien',
    'e-utel': 'urgence_tel',
    'e-id-type': 'id_type',
    'e-id-num': 'id_num',
    'e-id-deliv': 'id_deliv',
    'e-id-exp': 'id_exp',
    'e-cc-num': 'cc_num',
    'e-cc-exp': 'cc_exp',
    'e-fimo-type': 'fimo_type',
    'e-fimo-num': 'fimo_num',
    'e-fimo-obt': 'fimo_obt',
    'e-fimo-exp': 'fimo_exp',
    'e-ss-num': 'ss_num',
    'e-rib-iban': 'rib_iban',
    'e-rib-bic': 'rib_bic',
    'e-rib-titulaire': 'rib_titulaire',
    'e-btp-num': 'btp_num',
    'e-btp-deliv': 'btp_deliv',
    'e-btp-exp': 'btp_exp'
  };

  for (const [id, key] of Object.entries(m)) {
    const el = document.getElementById(id);
    if (!el) continue;

    if (el.type === 'date') {
      el.value = toDateInputValue(driver[key]);
    } else {
      el.value = driver[key] ?? '';
    }
  }

  const accountEl = document.getElementById('e-user-email');
  if (accountEl) accountEl.value = driver.user_email || driver.email || '';

  const passEl = document.getElementById('e-user-password');
  if (passEl) passEl.value = '';
}

async function saveEdit() {
  const nom = document.getElementById('e-nom')?.value.trim() || '';
  const prenom = document.getElementById('e-prenom')?.value.trim() || '';
  const tel = document.getElementById('e-tel')?.value.trim() || '';

  if (!nom || !prenom || !tel) {
    alert('Nom, Prénom et Téléphone sont obligatoires.');
    return;
  }

  const payload = {
    nom,
    prenom,
    ddn: document.getElementById('e-ddn')?.value || '',
    lieu_naissance: document.getElementById('e-lieu')?.value || '',
    nationalite: document.getElementById('e-nat')?.value || '',
    genre: document.getElementById('e-genre')?.value || '',
    situation: document.getElementById('e-sit')?.value || '',
    enfants: parseInt(document.getElementById('e-enfants')?.value || '0', 10) || 0,
    adresse: document.getElementById('e-adresse')?.value || '',
    telephone: tel,
    email: document.getElementById('e-email')?.value || '',
    permis_numero: document.getElementById('e-pnum')?.value || '',
    permis_categorie: document.getElementById('e-pcat')?.value || '',
    permis_obtention: document.getElementById('e-pobt')?.value || '',
    permis_expiration: document.getElementById('e-pexp')?.value || '',
    permis_pays: document.getElementById('e-ppays')?.value || '',
    statut: document.getElementById('e-statut')?.value || '',
    urgence_nom: document.getElementById('e-unom')?.value || '',
    urgence_prenom: document.getElementById('e-uprenom')?.value || '',
    urgence_lien: document.getElementById('e-ulien')?.value || '',
    urgence_tel: document.getElementById('e-utel')?.value || '',
    id_type: document.getElementById('e-id-type')?.value || '',
    id_num: document.getElementById('e-id-num')?.value || '',
    id_deliv: document.getElementById('e-id-deliv')?.value || '',
    id_exp: document.getElementById('e-id-exp')?.value || '',
    cc_num: document.getElementById('e-cc-num')?.value || '',
    cc_exp: document.getElementById('e-cc-exp')?.value || '',
    fimo_type: document.getElementById('e-fimo-type')?.value || '',
    fimo_num: document.getElementById('e-fimo-num')?.value || '',
    fimo_obt: document.getElementById('e-fimo-obt')?.value || '',
    fimo_exp: document.getElementById('e-fimo-exp')?.value || '',
    ss_num: document.getElementById('e-ss-num')?.value || '',
    rib_iban: document.getElementById('e-rib-iban')?.value || '',
    rib_bic: document.getElementById('e-rib-bic')?.value || '',
    rib_titulaire: document.getElementById('e-rib-titulaire')?.value || '',
    btp_num: document.getElementById('e-btp-num')?.value || '',
    btp_deliv: document.getElementById('e-btp-deliv')?.value || '',
    btp_exp: document.getElementById('e-btp-exp')?.value || ''
  };

  const accountEmail = document.getElementById('e-user-email')?.value.trim().toLowerCase();
  const newPassword = document.getElementById('e-user-password')?.value || '';

  if (accountEmail) payload.user_email = accountEmail;
  if (newPassword) payload.password = newPassword;

  try {
    const data = await apiFetch(`/drivers/${driverId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });

    driver = data.driver || data;
    document.getElementById('editPanel')?.classList.remove('open');
    render();
    toast('Fiche mise à jour');
  } catch (error) {
    toast(error.message || 'Erreur mise à jour');
  }
}

function toggleConfirm() {
  document.getElementById('confirmBox')?.classList.toggle('open');
}

async function deleteDriver() {
  try {
    await apiFetch(`/drivers/${driverId}`, { method: 'DELETE' });
    window.location.href = 'drivers.html';
  } catch (error) {
    toast(error.message || 'Erreur suppression');
  }
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
      await apiFetch(`/drivers/${driverId}/documents`, {
        method: 'POST',
        body: fd
      });
    } catch (error) {
      toast(error.message || `Erreur upload ${file.name}`);
      return;
    }
  }

  event.target.value = '';
  await refreshDriver();
  toast('Document ajouté');
}

function deleteDoc() {
  toast("Suppression document à brancher quand l'API documents sera complète.");
}

function handleOffiUpload() {
  toast("Upload document officiel à brancher si tu veux stocker les pièces jointes par type.");
}

function triggerOffiUpload() {
  toast("Upload document officiel à brancher côté API.");
}

function viewOffiDoc() {
  toast("Lecture document officiel à brancher côté API.");
}

function deleteOffiDoc() {
  toast("Suppression document officiel à brancher côté API.");
}

function daysLeft(s) {
  return Math.round((new Date(s) - new Date()) / 86400000);
}

function fmtDate(d) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    });
  } catch {
    return d;
  }
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}