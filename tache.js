const TASK_CATEGORY_LABELS = {
  REPLY_EMAIL: 'Répondre à un mail',
  VERIFY_INVOICE: 'Vérifier une facture',
  FOLLOW_UP: 'Relancer quelqu’un',
  READ_RESPONSE: 'Lire une réponse attendue',
  SIGN_DOCUMENT: 'Signer un document',
  SEND_DOCUMENT: 'Envoyer un document',
  CHECK_ATTACHMENT: 'Vérifier une pièce jointe',
  CONFIRM_INFO: 'Confirmer une information'
};

const TASK_STATUS_LABELS = {
  TO_VALIDATE: 'À valider',
  TODO: 'À faire',
  IN_PROGRESS: 'En cours',
  WAITING: 'En attente',
  DONE: 'Terminée',
  CANCELLED: 'Annulée'
};

const TASK_PRIORITY_LABELS = {
  LOW: 'Basse',
  NORMAL: 'Normale',
  HIGH: 'Haute',
  URGENT: 'Urgente'
};

function getId(obj) {
  return obj?._id || obj?.id || '';
}

function esc(v) {
  return String(v ?? '').replace(/[&<>'"]/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[c]));
}

function formatDate(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-FR');
}

function formatDateTime(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('fr-FR');
}

function categoryLabel(v) {
  return TASK_CATEGORY_LABELS[v] || v || '—';
}

function statusLabel(v) {
  return TASK_STATUS_LABELS[v] || v || '—';
}

function priorityLabel(v) {
  return TASK_PRIORITY_LABELS[v] || v || '—';
}

function statusBadge(status) {
  const map = {
    TO_VALIDATE: ['badge-purple', 'À valider'],
    TODO: ['badge-blue', 'À faire'],
    IN_PROGRESS: ['badge-yellow', 'En cours'],
    WAITING: ['badge-orange', 'En attente'],
    DONE: ['badge-green', 'Terminée'],
    CANCELLED: ['badge-gray', 'Annulée']
  };

  const [cls, label] = map[status] || ['badge-gray', status || '—'];
  return `<span class="badge ${cls}">${label}</span>`;
}

function priorityBadge(priority) {
  const map = {
    LOW: ['badge-gray', 'Basse'],
    NORMAL: ['badge-blue', 'Normale'],
    HIGH: ['badge-yellow', 'Haute'],
    URGENT: ['badge-red', 'Urgente']
  };

  const [cls, label] = map[priority] || ['badge-gray', priority || '—'];
  return `<span class="badge ${cls}">${label}</span>`;
}

function getLocalTasks() {
  return JSON.parse(localStorage.getItem('yova_tasks') || '[]');
}

function setLocalTasks(tasks) {
  localStorage.setItem('yova_tasks', JSON.stringify(tasks));
}

function getCurrentUserFromStorage() {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null');
  } catch {
    return null;
  }
}

function getUserName(user) {
  if (!user) return '—';

  return (
    user.username ||
    user.name ||
    user.nom ||
    user.email ||
    user._id ||
    user.id ||
    'Utilisateur'
  );
}

function getTraceName(trace) {
  if (!trace) return '—';

  if (typeof trace === 'string') return trace;

  if (trace.username) return trace.username;
  if (trace.name) return trace.name;
  if (trace.nom && trace.prenom) return `${trace.prenom} ${trace.nom}`;
  if (trace.nom) return trace.nom;
  if (trace.email) return trace.email;

  if (trace.user) {
    if (typeof trace.user === 'string') return trace.user;
    return getUserName(trace.user);
  }

  if (trace._id) return trace._id;

  return '—';
}

function getTraceDate(trace) {
  if (!trace) return null;

  return (
    trace.at ||
    trace.date ||
    trace.createdAt ||
    trace.validatedAt ||
    trace.handledAt ||
    trace.completedAt ||
    null
  );
}

async function taskApi(path, options = {}) {
  try {
    return await apiFetch(path, options);
  } catch (error) {
    console.warn('API tasks indisponible, fallback localStorage:', error.message);
    return null;
  }
}

let taskId = null;
let task = null;

document.addEventListener('DOMContentLoaded', async () => {
  const ok = await requireAuth();
  if (!ok) return;

  taskId = new URLSearchParams(window.location.search).get('id');

  if (!taskId) {
    showNotFound();
    return;
  }

  await refreshTask();
});

async function refreshTask() {
  const data = await taskApi(`/tasks/${taskId}`);

  if (data) {
    task = data.task || data;
  } else {
    task = getLocalTasks().find(t => getId(t) === taskId);
  }

  if (!task) {
    showNotFound();
    return;
  }

  document.getElementById('content').style.display = 'block';
  document.getElementById('notFound').style.display = 'none';

  renderTask();
}

function showNotFound() {
  document.getElementById('content').style.display = 'none';
  document.getElementById('notFound').style.display = 'block';
}

function renderTask() {
  document.title = `${task.title || 'Tâche'} — Yovatrans`;

  document.getElementById('bcName').textContent = task.title || 'Fiche tâche';
  document.getElementById('taskTitle').textContent = task.title || 'Sans titre';

  document.getElementById('taskSub').textContent =
    task.ai?.summary ||
    task.source?.mail?.subject ||
    `Créée le ${formatDateTime(task.createdAt)}`;

  document.getElementById('heroBadges').innerHTML = `
    ${statusBadge(task.status)}
    ${priorityBadge(task.priority)}
    <span class="badge badge-blue">${esc(categoryLabel(task.category))}</span>
  `;

  document.getElementById('taskDescription').textContent =
    task.description ||
    task.ai?.suggestedAction ||
    'Aucune description.';

  document.getElementById('mainMeta').innerHTML = `
    ${meta('Type', categoryLabel(task.category))}
    ${meta('Priorité', priorityLabel(task.priority))}
    ${meta('Statut', statusLabel(task.status))}
    ${meta('Échéance', formatDate(task.dueDate))}
    ${meta('Source', task.source?.type || 'MANUAL')}
    ${meta('Créée le', formatDateTime(task.createdAt))}
  `;

  renderTrackingMeta();
  renderSource();
  renderHistory();
  fillEdit();
  manageButtons();
}

function renderTrackingMeta() {
  const createdBy = task.createdBy || task.createdByUser;
  const validatedBy = task.validatedBy || task.validation?.validatedBy;
  const handledBy = task.handledBy || task.processing?.handledBy;
  const completedBy =
    task.completion?.completedBy ||
    task.completedBy ||
    task.doneBy;

  const createdAt =
    task.createdAt ||
    getTraceDate(createdBy);

  const validatedAt =
    task.validatedAt ||
    task.validation?.validatedAt ||
    getTraceDate(validatedBy);

  const handledAt =
    task.handledAt ||
    task.processing?.handledAt ||
    getTraceDate(handledBy);

  const completedAt =
    task.completion?.completedAt ||
    task.completedAt ||
    getTraceDate(completedBy);

  document.getElementById('sideMeta').innerHTML = `
    ${meta('Créée par', getTraceName(createdBy))}
    ${meta('Créée le', formatDateTime(createdAt))}
    ${meta('Validée par', getTraceName(validatedBy))}
    ${meta('Validée le', formatDateTime(validatedAt))}
    ${meta('Traitée par', getTraceName(handledBy))}
    ${meta('Début traitement', formatDateTime(handledAt))}
    ${meta('Terminée par', getTraceName(completedBy))}
    ${meta('Terminée le', formatDateTime(completedAt))}
    ${meta('Compte connecté', getUserName(getCurrentUserFromStorage()))}
    ${meta('Rôle', getCurrentUserFromStorage()?.role || '—')}
  `;
}

function manageButtons() {
  const btnDone = document.getElementById('btnDone');
  const btnValidate = document.getElementById('btnValidate');
  const btnStart = document.getElementById('btnStart');

  if (btnValidate) {
    btnValidate.style.display =
      task.status === 'TO_VALIDATE' ? 'inline-flex' : 'none';
  }

  if (btnStart) {
    btnStart.style.display =
      ['TODO', 'WAITING'].includes(task.status) ? 'inline-flex' : 'none';
  }

  if (btnDone) {
    btnDone.style.display =
      task.status === 'DONE' || task.status === 'CANCELLED'
        ? 'none'
        : 'inline-flex';
  }
}

function meta(k, v) {
  return `
    <div class="meta-item">
      <div class="meta-key">${esc(k)}</div>
      <div class="meta-val">${esc(v)}</div>
    </div>
  `;
}

function renderSource() {
  const block = document.getElementById('sourceBlock');
  const mail = task.source?.mail;

  let html = '';

  if (mail) {
    html += `
      <div style="margin-top:18px">
        <div class="form-label">Mail source</div>
        <div class="meta-grid">
          ${meta('Boîte', mail.mailbox || '—')}
          ${meta('Expéditeur', mail.fromEmail || mail.fromName || '—')}
          ${meta('Objet', mail.subject || '—')}
          ${meta('Reçu le', formatDateTime(mail.receivedAt))}
        </div>
      </div>
    `;
  }

  if (task.source?.originalText) {
    html += `
      <div style="margin-top:18px">
        <div class="form-label">Texte source</div>
        <div class="notice">${esc(task.source.originalText)}</div>
      </div>
    `;
  }

  if (task.ai?.suggestedReply) {
    html += `
      <div style="margin-top:18px">
        <div class="form-label">Réponse suggérée</div>
        <div class="notice">${esc(task.ai.suggestedReply)}</div>
      </div>
    `;
  }

  block.innerHTML = html;
}

function renderHistory() {
  const list = document.getElementById('historyList');
  const h = task.history || [];

  if (!h.length) {
    list.innerHTML = '<div class="empty">Aucun historique.</div>';
    return;
  }

  list.innerHTML = h.slice().reverse().map(item => {
    const userName =
      getTraceName(item.user) !== '—'
        ? getTraceName(item.user)
        : getTraceName(item.by);

    return `
      <div class="timeline-item">
        <div class="timeline-dot"></div>
        <div class="timeline-text">
          <strong>${esc(item.action || 'ACTION')}</strong>
          ${item.fromStatus ? esc(statusLabel(item.fromStatus)) + ' → ' : ''}
          ${item.toStatus ? esc(statusLabel(item.toStatus)) : ''}
          <br>
          <span style="color:var(--muted)">
            ${item.note ? esc(item.note) + ' · ' : ''}
            ${userName !== '—' ? 'Par ' + esc(userName) + ' · ' : ''}
            ${formatDateTime(item.at || item.createdAt)}
          </span>
        </div>
      </div>
    `;
  }).join('');
}

function fillEdit() {
  document.getElementById('e-title').value = task.title || '';
  document.getElementById('e-description').value = task.description || '';
  document.getElementById('e-category').value = task.category || 'REPLY_EMAIL';
  document.getElementById('e-priority').value = task.priority || 'NORMAL';
  document.getElementById('e-status').value = task.status || 'TODO';
  document.getElementById('e-dueDate').value = task.dueDate
    ? String(task.dueDate).slice(0, 10)
    : '';
}

function toggleEdit(force) {
  const show =
    typeof force === 'boolean'
      ? force
      : document.getElementById('editBlock').style.display === 'none';

  document.getElementById('editBlock').style.display = show ? 'block' : 'none';
  document.getElementById('viewBlock').style.display = show ? 'none' : 'block';
}

async function saveEdit() {
  clearMessages();

  const payload = {
    title: document.getElementById('e-title').value.trim(),
    description: document.getElementById('e-description').value.trim(),
    category: document.getElementById('e-category').value,
    priority: document.getElementById('e-priority').value,
    status: document.getElementById('e-status').value,
    dueDate: document.getElementById('e-dueDate').value || null
  };

  if (!payload.title) {
    showError('Le titre est obligatoire.');
    return;
  }

  const data = await taskApi(`/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });

  if (data) {
    task = data.task || data;
  } else {
    updateLocalTask(payload, 'UPDATED', 'Modification manuelle');
  }

  toggleEdit(false);
  showSuccess('Tâche mise à jour.');
  renderTask();
}

async function validateTask() {
  clearMessages();

  const data = await taskApi(`/tasks/${taskId}/validate`, {
    method: 'PATCH',
    body: JSON.stringify({})
  });

  if (data) {
    task = data.task || data;
  } else {
    const user = getCurrentUserFromStorage();

    updateLocalTask(
      {
        status: 'TODO',
        validatedBy: {
          user: getId(user),
          username: getUserName(user),
          role: user?.role || '',
          at: new Date().toISOString()
        },
        validatedAt: new Date().toISOString()
      },
      'VALIDATED',
      'Tâche validée depuis le front'
    );
  }

  showSuccess('Tâche validée.');
  renderTask();
}

async function startTask() {
  clearMessages();

  const data = await taskApi(`/tasks/${taskId}/start`, {
    method: 'PATCH',
    body: JSON.stringify({})
  });

  if (data) {
    task = data.task || data;
  } else {
    const user = getCurrentUserFromStorage();

    updateLocalTask(
      {
        status: 'IN_PROGRESS',
        handledBy: {
          user: getId(user),
          username: getUserName(user),
          role: user?.role || '',
          at: new Date().toISOString()
        },
        handledAt: new Date().toISOString()
      },
      'STARTED',
      'Tâche prise en charge depuis le front'
    );
  }

  showSuccess('Tâche prise en charge.');
  renderTask();
}

async function markDone() {
  clearMessages();

  const completionNote = document.getElementById('completionNote').value.trim();

  const data = await taskApi(`/tasks/${taskId}/done`, {
    method: 'PATCH',
    body: JSON.stringify({ completionNote })
  });

  if (data) {
    task = data.task || data;
  } else {
    const user = getCurrentUserFromStorage();
    const now = new Date().toISOString();

    updateLocalTask(
      {
        status: 'DONE',
        completion: {
          completedBy: {
            user: getId(user),
            username: getUserName(user),
            role: user?.role || '',
            at: now
          },
          completedAt: now,
          completionNote
        },
        completedAt: now
      },
      'COMPLETED',
      completionNote || 'Tâche marquée comme faite'
    );
  }

  showSuccess('Tâche marquée comme faite.');
  renderTask();
}

function updateLocalTask(payload, action, note) {
  const tasks = getLocalTasks();
  const idx = tasks.findIndex(t => getId(t) === taskId);

  if (idx < 0) return;

  const previousStatus = tasks[idx].status;
  const newStatus = payload.status || previousStatus;

  tasks[idx] = {
    ...tasks[idx],
    ...payload,
    updatedAt: new Date().toISOString()
  };

  tasks[idx].history = [
    ...(tasks[idx].history || []),
    {
      action,
      fromStatus: previousStatus,
      toStatus: newStatus,
      note,
      user: getCurrentUserFromStorage(),
      at: new Date().toISOString()
    }
  ];

  task = tasks[idx];
  setLocalTasks(tasks);
}

function showSuccess(msg) {
  const el = document.getElementById('successMsg');
  el.textContent = msg;
  el.classList.add('show');

  setTimeout(() => {
    el.classList.remove('show');
  }, 3500);
}

function showError(msg) {
  const el = document.getElementById('errorMsg');
  el.textContent = msg;
  el.classList.add('show');
}

function clearMessages() {
  const success = document.getElementById('successMsg');
  const error = document.getElementById('errorMsg');

  success.classList.remove('show');
  error.classList.remove('show');

  success.textContent = '';
  error.textContent = '';
}