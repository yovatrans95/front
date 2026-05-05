let currentStep = 0;
let photoFile = null;
const TOTAL_STEPS = 4;

document.addEventListener('DOMContentLoaded', async () => {
  const ok = await requireAuth();
  if (!ok) return;

  syncSummary();

  [
    'f-pcat', 'f-pexp', 'f-statut',
    'f-nom', 'f-prenom', 'f-tel', 'f-email'
  ].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', syncSummary);
    el.addEventListener('input', syncSummary);
  });

  document.querySelectorAll('.form-input,.form-select').forEach(el => {
    el.addEventListener('input', () => {
      el.classList.remove('error');
      const err = document.getElementById(`err-${el.id?.replace(/^f-/, '')}`);
      if (err) err.classList.remove('show');
    });
  });
});

function goStep(target) {
  if (target > currentStep && !validateStep(currentStep)) return;

  const currentDot = document.getElementById(`dot-${currentStep}`);
  const currentName = document.getElementById(`sname-${currentStep}`);
  const currentPanel = document.getElementById(`panel-${currentStep}`);

  currentPanel?.classList.remove('active');

  if (target > currentStep) {
    currentDot?.classList.remove('active');
    currentDot?.classList.add('done');
    if (currentDot) currentDot.textContent = '✓';
    currentName?.classList.remove('active');
    currentName?.classList.add('done');
    document.getElementById(`line-${currentStep}`)?.classList.add('done');
  } else {
    currentDot?.classList.remove('active', 'done');
    if (currentDot) currentDot.textContent = String(currentStep + 1);
    currentName?.classList.remove('active', 'done');
    document.getElementById(`line-${currentStep - 1}`)?.classList.remove('done');
  }

  currentStep = target;

  const nextPanel = document.getElementById(`panel-${currentStep}`);
  const nextDot = document.getElementById(`dot-${currentStep}`);
  const nextName = document.getElementById(`sname-${currentStep}`);

  nextPanel?.classList.add('active');
  nextDot?.classList.add('active');
  nextDot?.classList.remove('done');
  if (nextDot) nextDot.textContent = String(currentStep + 1);
  nextName?.classList.add('active');
  nextName?.classList.remove('done');

  document.getElementById('formCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function validateStep(step) {
  if (step !== 0) return true;

  let ok = true;

  const requiredFields = [
    ['f-nom', 'err-nom'],
    ['f-prenom', 'err-prenom'],
    ['f-tel', 'err-tel'],
    ['f-email', 'err-email']
  ];

  requiredFields.forEach(([id, errId]) => {
    const el = document.getElementById(id);
    const err = document.getElementById(errId);
    if (!el) return;

    if (!el.value.trim()) {
      el.classList.add('error');
      if (err) {
        err.textContent = 'Ce champ est requis';
        err.classList.add('show');
      }
      ok = false;
    } else {
      el.classList.remove('error');
      err?.classList.remove('show');
    }
  });

  const email = document.getElementById('f-email')?.value.trim().toLowerCase() || '';
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const el = document.getElementById('f-email');
    const err = document.getElementById('err-email');
    el?.classList.add('error');
    if (err) {
      err.textContent = 'Email invalide';
      err.classList.add('show');
    }
    ok = false;
  }

  const p1 = document.getElementById('f-password')?.value || '';
  const p2 = document.getElementById('f-password2')?.value || '';
  const ep = document.getElementById('err-password');
  const ep2 = document.getElementById('err-password2');

  if (!p1) {
    document.getElementById('f-password')?.classList.add('error');
    if (ep) {
      ep.textContent = 'Ce champ est requis';
      ep.classList.add('show');
    }
    ok = false;
  } else if (p1.length < 6) {
    document.getElementById('f-password')?.classList.add('error');
    if (ep) {
      ep.textContent = 'Minimum 6 caractères';
      ep.classList.add('show');
    }
    ok = false;
  } else {
    document.getElementById('f-password')?.classList.remove('error');
    ep?.classList.remove('show');
  }

  if (p1 && p2 && p1 !== p2) {
    document.getElementById('f-password2')?.classList.add('error');
    if (ep2) {
      ep2.textContent = 'Les mots de passe ne correspondent pas';
      ep2.classList.add('show');
    }
    ok = false;
  } else if (p1 === p2) {
    document.getElementById('f-password2')?.classList.remove('error');
    ep2?.classList.remove('show');
  }

  return ok;
}

function handlePhotoPreview(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  photoFile = file;

  const reader = new FileReader();
  reader.onload = ev => {
    document.getElementById('photoPlaceholder')?.style.setProperty('display', 'none');
    const img = document.getElementById('photoPreviewImg');
    if (img) {
      img.src = ev.target.result;
      img.style.display = 'block';
    }
    document.getElementById('photoZone')?.classList.add('has-photo');
    const sumAvatar = document.getElementById('sumAvatar');
    if (sumAvatar) {
      sumAvatar.innerHTML = `<img src="${ev.target.result}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
    }
  };
  reader.readAsDataURL(file);
}

function syncLoginId() {
  const email = document.getElementById('f-email')?.value.trim() || '';
  const loginId = document.getElementById('f-login-id');
  if (loginId) loginId.value = email;
}

function syncSummary() {
  syncLoginId();

  const nom = document.getElementById('f-nom')?.value.trim() || '';
  const prenom = document.getElementById('f-prenom')?.value.trim() || '';
  const tel = document.getElementById('f-tel')?.value.trim() || '';
  const email = document.getElementById('f-email')?.value.trim() || '';
  const cat = document.getElementById('f-pcat')?.value.trim() || '';
  const exp = document.getElementById('f-pexp')?.value || '';
  const statut = document.getElementById('f-statut')?.value || 'actif';

  const sumName = document.getElementById('sumName');
  const sumSub = document.getElementById('sumSub');
  const sumAvatar = document.getElementById('sumAvatar');

  if (nom || prenom) {
    if (sumName) sumName.textContent = `${nom} ${prenom}`.trim();
    if (sumSub) sumSub.textContent = email || tel || 'Chauffeur en cours de création';

    if (sumAvatar && !photoFile) {
      const ini = ((nom[0] || '') + (prenom[0] || '')).toUpperCase();
      sumAvatar.innerHTML =
        `<span style="font-family:'Plus Jakarta Sans',sans-serif;font-weight:800;font-size:1.6rem;color:#fff">${ini || '👤'}</span>`;
    }
  } else {
    if (sumName) sumName.textContent = 'Nouveau chauffeur';
    if (sumSub) sumSub.textContent = 'Remplissez les champs pour voir le récap';
    if (sumAvatar && !photoFile) sumAvatar.innerHTML = '👤';
  }

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value || '—';
  };

  setText('sumTel', tel);
  setText('sumEmail', email);
  setText('sumPermis', cat);

  if (exp) {
    const days = Math.round((new Date(exp) - new Date()) / 86400000);
    const fmtd = new Date(exp).toLocaleDateString('fr-FR');
    setText('sumPermisExp', days < 0 ? `${fmtd} (expiré)` : fmtd);
  } else {
    setText('sumPermisExp', '—');
  }

  const sMap = {
    actif: ['badge-green', 'Actif'],
    inactif: ['badge-red', 'Inactif'],
    en_conge: ['badge-yellow', 'En congé']
  };
  const [cls, label] = sMap[statut] || ['badge-gray', statut];
  const sumStatut = document.getElementById('sumStatut');
  if (sumStatut) {
    sumStatut.innerHTML = `<span class="summary-badge ${cls}">${label}</span>`;
  }
}

async function saveDriver() {
  if (!validateStep(0)) {
    goStep(0);
    return;
  }

  const formData = new FormData();

  if (photoFile) {
    formData.append('photo', photoFile);
  }

  const fields = {
    nom: 'f-nom',
    prenom: 'f-prenom',
    ddn: 'f-ddn',
    lieu_naissance: 'f-lieu',
    nationalite: 'f-nat',
    genre: 'f-genre',
    situation: 'f-sit',
    enfants: 'f-enfants',
    adresse: 'f-adresse',
    telephone: 'f-tel',
    email: 'f-email',
    password: 'f-password',
    permis_numero: 'f-pnum',
    permis_categorie: 'f-pcat',
    permis_obtention: 'f-pobt',
    permis_expiration: 'f-pexp',
    permis_pays: 'f-ppays',
    statut: 'f-statut',
    urgence_nom: 'f-unom',
    urgence_prenom: 'f-uprenom',
    urgence_lien: 'f-ulien',
    urgence_tel: 'f-utel',
    id_type: 'f-id-type',
    id_num: 'f-id-num',
    id_deliv: 'f-id-deliv',
    id_exp: 'f-id-exp',
    cc_num: 'f-cc-num',
    cc_exp: 'f-cc-exp',
    fimo_type: 'f-fimo-type',
    fimo_num: 'f-fimo-num',
    fimo_obt: 'f-fimo-obt',
    fimo_exp: 'f-fimo-exp',
    ss_num: 'f-ss-num',
    rib_iban: 'f-rib-iban',
    rib_bic: 'f-rib-bic',
    rib_titulaire: 'f-rib-titulaire',
    btp_num: 'f-btp-num',
    btp_deliv: 'f-btp-deliv',
    btp_exp: 'f-btp-exp'
  };

  Object.entries(fields).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (!el) return;
    formData.append(key, el.value ?? '');
  });

  try {
    const data = await apiFetch('/drivers', {
      method: 'POST',
      body: formData
    });

    const created = data.driver || data;
    showSuccess(created);
  } catch (error) {
    showErrorToast(error.message || 'Erreur lors de la création');
  }
}

function showSuccess(driver) {
  for (let i = 0; i < TOTAL_STEPS; i++) {
    document.getElementById(`panel-${i}`)?.classList.remove('active');
  }

  document.getElementById('stepsBar')?.style.setProperty('display', 'none');
  document.getElementById('successScreen')?.classList.add('show');

  const successSub = document.getElementById('successSub');
  if (successSub) {
    successSub.textContent = `Fiche créée pour ${driver.nom} ${driver.prenom}. Identifiant : ${driver.email}`;
  }

  const btn = document.getElementById('btnGoToFiche');
  if (btn) {
    btn.onclick = () => {
      window.location.href = `driver.html?id=${driver._id}`;
    };
  }
}

function resetForm() {
  document.querySelectorAll('.form-input,.form-select').forEach(el => {
    el.value = '';
    el.classList.remove('error');
  });

  document.querySelectorAll('.field-error').forEach(el => el.classList.remove('show'));

  photoFile = null;

  document.getElementById('photoPlaceholder')?.style.setProperty('display', 'block');
  const preview = document.getElementById('photoPreviewImg');
  if (preview) {
    preview.style.display = 'none';
    preview.src = '';
  }

  document.getElementById('photoZone')?.classList.remove('has-photo');

  const avatar = document.getElementById('sumAvatar');
  if (avatar) avatar.innerHTML = '👤';

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  setText('sumName', 'Nouveau chauffeur');
  setText('sumSub', 'Remplissez les champs pour voir le récap');
  setText('sumTel', '—');
  setText('sumEmail', '—');
  setText('sumPermis', '—');
  setText('sumPermisExp', '—');

  currentStep = 0;

  for (let i = 0; i < TOTAL_STEPS; i++) {
    const dot = document.getElementById(`dot-${i}`);
    const name = document.getElementById(`sname-${i}`);
    if (dot) {
      dot.className = `step-dot${i === 0 ? ' active' : ''}`;
      dot.textContent = String(i + 1);
    }
    if (name) {
      name.className = `step-name${i === 0 ? ' active' : ''}`;
    }
    document.getElementById(`line-${i}`)?.classList.remove('done');
  }

  document.getElementById('stepsBar')?.style.setProperty('display', 'flex');
  document.getElementById('successScreen')?.classList.remove('show');
  document.getElementById('panel-0')?.classList.add('active');

  const statut = document.getElementById('f-statut');
  if (statut) statut.value = 'actif';

  syncSummary();
  window.scrollTo(0, 0);
}

function showErrorToast(message) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}