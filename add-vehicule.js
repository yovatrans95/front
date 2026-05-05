let currentStep = 0;
const TOTAL_STEPS = 4;

document.addEventListener('DOMContentLoaded', async () => {
  const ok = await requireAuth();
  if (!ok) return;

  syncSummary();
  syncLocationVisibility();

  [
    'f-immatriculation',
    'f-marque',
    'f-modele',
    'f-type',
    'f-statut',
    'f-mode-possession',
    'f-assurance-exp',
    'f-ct-exp'
  ].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', syncSummary);
    el.addEventListener('change', syncSummary);
  });

  document.getElementById('f-mode-possession')?.addEventListener('change', syncLocationVisibility);

  document.querySelectorAll('.form-input,.form-select').forEach(el => {
    el.addEventListener('input', () => {
      el.classList.remove('error');
      const err = document.getElementById(`err-${el.id?.replace(/^f-/, '')}`);
      err?.classList.remove('show');
    });
  });
});

function goStep(target) {
  if (target > currentStep && !validateStep(currentStep)) return;

  document.getElementById(`panel-${currentStep}`)?.classList.remove('active');

  if (target > currentStep) {
    const dot = document.getElementById(`dot-${currentStep}`);
    const name = document.getElementById(`sname-${currentStep}`);
    dot?.classList.remove('active');
    dot?.classList.add('done');
    if (dot) dot.textContent = 'OK';
    name?.classList.remove('active');
    name?.classList.add('done');
    document.getElementById(`line-${currentStep}`)?.classList.add('done');
  }

  if (target < currentStep) {
    for (let i = target + 1; i <= currentStep; i += 1) {
      const dot = document.getElementById(`dot-${i}`);
      const name = document.getElementById(`sname-${i}`);
      dot?.classList.remove('active', 'done');
      if (dot) dot.textContent = String(i + 1);
      name?.classList.remove('active', 'done');
      if (i - 1 >= 0) document.getElementById(`line-${i - 1}`)?.classList.remove('done');
    }
  }

  currentStep = target;

  document.getElementById(`panel-${currentStep}`)?.classList.add('active');
  const nextDot = document.getElementById(`dot-${currentStep}`);
  nextDot?.classList.add('active');
  nextDot?.classList.remove('done');
  if (nextDot) nextDot.textContent = String(currentStep + 1);
  document.getElementById(`sname-${currentStep}`)?.classList.add('active');

  document.getElementById('formCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function validateStep(step) {
  if (step === 0) return validateRequired([
    ['f-immatriculation', 'err-immatriculation'],
    ['f-marque', 'err-marque'],
    ['f-modele', 'err-modele']
  ]);

  if (step === 1) return validateRequired([
    ['f-statut', 'err-statut'],
    ['f-mode-possession', 'err-mode-possession']
  ]);

  return true;
}

function validateRequired(entries) {
  let ok = true;

  entries.forEach(([id, errId]) => {
    const el = document.getElementById(id);
    const err = document.getElementById(errId);
    if (!el) return;

    if (!String(el.value || '').trim()) {
      el.classList.add('error');
      err?.classList.add('show');
      ok = false;
      return;
    }

    el.classList.remove('error');
    err?.classList.remove('show');
  });

  return ok;
}

function syncLocationVisibility() {
  const mode = document.getElementById('f-mode-possession')?.value || 'propre';
  const block = document.getElementById('locationFields');
  if (!block) return;

  block.style.display = mode === 'loue' ? 'block' : 'none';

  document.querySelectorAll('#locationFields input').forEach(input => {
    input.disabled = mode !== 'loue';
  });
}

function syncSummary() {
  const immat = document.getElementById('f-immatriculation')?.value.trim() || '';
  const marque = document.getElementById('f-marque')?.value.trim() || '';
  const modele = document.getElementById('f-modele')?.value.trim() || '';
  const type = document.getElementById('f-type')?.value.trim() || '';
  const statut = document.getElementById('f-statut')?.value || 'actif';
  const possession = document.getElementById('f-mode-possession')?.value || 'propre';
  const assuranceExp = document.getElementById('f-assurance-exp')?.value || '';
  const ctExp = document.getElementById('f-ct-exp')?.value || '';

  setText('sumName', immat || 'Nouveau vehicule');
  setText('sumSub', [marque, modele].filter(Boolean).join(' ') || 'Remplissez les champs pour voir le recap');
  setText('sumType', type || '—');
  setText('sumDocs', nearestDocumentLabel(assuranceExp, ctExp));

  const sumBadge = document.getElementById('sumStatut');
  if (sumBadge) {
    const map = {
      actif: ['badge-green', 'Actif'],
      maintenance: ['badge-yellow', 'Maintenance'],
      hors_service: ['badge-red', 'Hors service']
    };
    const [cls, label] = map[statut] || ['badge-gray', statut];
    sumBadge.innerHTML = `<span class="summary-badge ${cls}">${label}</span>`;
  }

  const sumPossession = document.getElementById('sumPossession');
  if (sumPossession) {
    const map = {
      propre: ['badge-blue', 'Propre'],
      loue: ['badge-yellow', 'Loue']
    };
    const [cls, label] = map[possession] || ['badge-gray', possession];
    sumPossession.innerHTML = `<span class="summary-badge ${cls}">${label}</span>`;
  }
}

function nearestDocumentLabel(...dates) {
  const valid = dates.filter(Boolean).sort((a, b) => new Date(a) - new Date(b));
  if (!valid.length) return '—';
  const nearest = valid[0];
  const days = Math.ceil((new Date(nearest) - new Date()) / 86400000);
  return days < 0 ? `${fmtDate(nearest)} (expire)` : fmtDate(nearest);
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value || '—';
}

async function saveVehicle() {
  if (!validateStep(0) || !validateStep(1)) {
    if (!validateStep(0)) {
      goStep(0);
    } else {
      goStep(1);
    }
    return;
  }

  const formData = new FormData();

  const fields = {
    immatriculation: 'f-immatriculation',
    marque: 'f-marque',
    modele: 'f-modele',
    type_vehicule: 'f-type',
    annee: 'f-annee',
    energie: 'f-energie',
    couleur: 'f-couleur',
    vin: 'f-vin',
    kilometrage: 'f-kilometrage',
    nombre_places: 'f-places',
    charge_utile: 'f-charge',
    date_mise_en_circulation: 'f-mec',
    statut: 'f-statut',
    mode_possession: 'f-mode-possession',
    observations: 'f-observations',
    carte_grise_numero: 'f-cg-num',
    carte_grise_date_emission: 'f-cg-date',
    carte_grise_titulaire: 'f-cg-titulaire',
    carte_grise_date_mise_circulation: 'f-cg-mec',
    contrat_location_reference: 'f-loc-ref',
    contrat_location_bailleur: 'f-loc-bailleur',
    contrat_location_date_debut: 'f-loc-debut',
    contrat_location_date_fin: 'f-loc-fin',
    contrat_location_montant: 'f-loc-montant',
    controle_technique_centre: 'f-ct-centre',
    controle_technique_date_controle: 'f-ct-date',
    controle_technique_expiration: 'f-ct-exp',
    assurance_compagnie: 'f-assurance-compagnie',
    assurance_numero_police: 'f-assurance-police',
    assurance_date_debut: 'f-assurance-debut',
    assurance_expiration: 'f-assurance-exp',
    licence_transport_numero: 'f-licence-num',
    licence_transport_autorite: 'f-licence-autorite',
    licence_transport_delivrance: 'f-licence-deliv',
    licence_transport_expiration: 'f-licence-exp',
    recepisse_transport_numero: 'f-recepisse-num',
    recepisse_transport_autorite: 'f-recepisse-autorite',
    recepisse_transport_delivrance: 'f-recepisse-deliv',
    recepisse_transport_expiration: 'f-recepisse-exp',
    chronotachygraphe_marque: 'f-chrono-marque',
    chronotachygraphe_numero: 'f-chrono-num',
    chronotachygraphe_etalonnage: 'f-chrono-etal',
    chronotachygraphe_expiration: 'f-chrono-exp',
    limiteur_marque: 'f-limiteur-marque',
    limiteur_numero: 'f-limiteur-num',
    limiteur_verification: 'f-limiteur-verif',
    limiteur_expiration: 'f-limiteur-exp'
  };

  Object.entries(fields).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (!el) return;
    formData.append(key, el.value ?? '');
  });
  try {
    const data = await apiFetch('/vehicles', {
      method: 'POST',
      body: formData
    });

    const created = data.vehicle || data;
    showSuccess(created);
  } catch (error) {
    showErrorToast(error.message || 'Erreur lors de la creation');
  }
}

function showSuccess(vehicle) {
  for (let i = 0; i < TOTAL_STEPS; i += 1) {
    document.getElementById(`panel-${i}`)?.classList.remove('active');
  }

  document.getElementById('stepsBar')?.style.setProperty('display', 'none');
  document.getElementById('successScreen')?.classList.add('show');

  const sub = document.getElementById('successSub');
  if (sub) {
    sub.textContent = `Fiche creee pour ${vehicle.immatriculation || 'le vehicule'} ${[vehicle.marque, vehicle.modele].filter(Boolean).join(' ')}`.trim();
  }

  const btn = document.getElementById('btnGoToFiche');
  if (btn) {
    btn.onclick = () => {
      window.location.href = `vehicule.html?id=${vehicle._id}`;
    };
  }
}

function resetForm() {
  document.querySelectorAll('.form-input,.form-select').forEach(el => {
    el.value = '';
    el.classList.remove('error');
  });
  document.querySelectorAll('.field-error').forEach(el => el.classList.remove('show'));

  currentStep = 0;
  for (let i = 0; i < TOTAL_STEPS; i += 1) {
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
    document.getElementById(`panel-${i}`)?.classList.remove('active');
  }

  document.getElementById('panel-0')?.classList.add('active');
  document.getElementById('stepsBar')?.style.setProperty('display', 'flex');
  document.getElementById('successScreen')?.classList.remove('show');

  document.getElementById('f-statut').value = 'actif';
  document.getElementById('f-mode-possession').value = 'propre';
  syncLocationVisibility();
  syncSummary();
  window.scrollTo(0, 0);
}

function fmtDate(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString('fr-FR');
  } catch {
    return value;
  }
}

function showErrorToast(message) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}