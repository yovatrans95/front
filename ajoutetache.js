
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
  TO_VALIDATE: 'À valider', TODO: 'À faire', IN_PROGRESS: 'En cours', WAITING: 'En attente', DONE: 'Terminée', CANCELLED: 'Annulée'
};
const TASK_PRIORITY_LABELS = { LOW: 'Basse', NORMAL: 'Normale', HIGH: 'Haute', URGENT: 'Urgente' };
function getId(obj){ return obj?._id || obj?.id || ''; }
function esc(v){ return String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function formatDate(v){ if(!v) return '—'; const d=new Date(v); if(Number.isNaN(d.getTime())) return '—'; return d.toLocaleDateString('fr-FR'); }
function formatDateTime(v){ if(!v) return '—'; const d=new Date(v); if(Number.isNaN(d.getTime())) return '—'; return d.toLocaleString('fr-FR'); }
function categoryLabel(v){ return TASK_CATEGORY_LABELS[v] || v || '—'; }
function statusLabel(v){ return TASK_STATUS_LABELS[v] || v || '—'; }
function priorityLabel(v){ return TASK_PRIORITY_LABELS[v] || v || '—'; }
function statusBadge(status){
  const map={TO_VALIDATE:['badge-purple','À valider'],TODO:['badge-blue','À faire'],IN_PROGRESS:['badge-yellow','En cours'],WAITING:['badge-orange','En attente'],DONE:['badge-green','Terminée'],CANCELLED:['badge-gray','Annulée']};
  const [cls,label]=map[status]||['badge-gray',status||'—']; return `<span class="badge ${cls}">${label}</span>`;
}
function priorityBadge(priority){
  const map={LOW:['badge-gray','Basse'],NORMAL:['badge-blue','Normale'],HIGH:['badge-yellow','Haute'],URGENT:['badge-red','Urgente']};
  const [cls,label]=map[priority]||['badge-gray',priority||'—']; return `<span class="badge ${cls}">${label}</span>`;
}
function categoryInitial(cat){ return (categoryLabel(cat).split(' ').map(w=>w[0]).join('').slice(0,2) || 'TA').toUpperCase(); }
function getLocalTasks(){ return JSON.parse(localStorage.getItem('yova_tasks') || '[]'); }
function setLocalTasks(tasks){ localStorage.setItem('yova_tasks', JSON.stringify(tasks)); }
function getCurrentUserFromStorage(){ try { return JSON.parse(localStorage.getItem('user')||'null'); } catch { return null; } }
async function taskApi(path, options={}){
  try { return await apiFetch(path, options); }
  catch (error) {
    console.warn('API tasks indisponible, fallback localStorage:', error.message);
    return null;
  }
}
function debounce(fn, ms){ let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args),ms); }; }

document.addEventListener('DOMContentLoaded', async () => {
  const ok = await requireAuth();
  if (!ok) return;
});

async function createTask(){
  const title = document.getElementById('f-title').value.trim();
  const description = document.getElementById('f-description').value.trim();
  const category = document.getElementById('f-category').value;
  const priority = document.getElementById('f-priority').value;
  const status = document.getElementById('f-status').value;
  const dueDate = document.getElementById('f-dueDate').value || null;
  const sourceText = document.getElementById('f-sourceText').value.trim();
  if(!title){ showError('Le titre est obligatoire.'); return; }
  const payload = {
    title, description, category, priority, status, dueDate,
    source: { type:'MANUAL', originalText: sourceText },
    ai: { generated:false },
    history: [{ action:'CREATED', toStatus:status, note:'Création manuelle', at:new Date().toISOString() }]
  };
  const btn=document.getElementById('btnSave'); btn.disabled=true;
  const data = await taskApi('/tasks', { method:'POST', body: JSON.stringify(payload) });
  if(data){
    const task = data.task || data;
    showSuccess('Tâche créée avec succès.');
    setTimeout(()=>{ window.location.href = `tache.html?id=${encodeURIComponent(getId(task))}`; }, 600);
  } else {
    payload._id = `local_${Date.now()}`;
    payload.createdAt = new Date().toISOString();
    payload.updatedAt = payload.createdAt;
    const tasks=getLocalTasks(); tasks.unshift(payload); setLocalTasks(tasks);
    showSuccess('Tâche créée en local. Elle sera reliée à l’API quand le backend sera prêt.');
    setTimeout(()=>{ window.location.href = `tache.html?id=${encodeURIComponent(payload._id)}`; }, 700);
  }
  btn.disabled=false;
}
function showError(msg){ const el=document.getElementById('errorMsg'); el.textContent=msg; el.classList.add('show'); document.getElementById('successMsg')?.classList.remove('show'); }
function showSuccess(msg){ const el=document.getElementById('successMsg'); el.textContent=msg; el.classList.add('show'); document.getElementById('errorMsg')?.classList.remove('show'); }
