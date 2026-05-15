
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

let all = [];
let filtered = [];
let page = 1;
const PER = 10;
let sortField = 'createdAt';
let sortDir = -1;

document.addEventListener('DOMContentLoaded', async () => {
  const ok = await requireAuth();
  if (!ok) return;
  await fetchTasks();
  document.getElementById('searchInput')?.addEventListener('input', debounce(filter, 180));
  document.getElementById('filterStatus')?.addEventListener('change', filter);
  document.getElementById('filterCategory')?.addEventListener('change', filter);
  document.getElementById('filterPriority')?.addEventListener('change', filter);
});

async function fetchTasks(){
  const data = await taskApi('/tasks');
  if (data) all = data.tasks || data || [];
  else all = getLocalTasks();
  filter();
  updateStats();
}

function filter(){
  const q=(document.getElementById('searchInput')?.value || '').toLowerCase();
  const st=document.getElementById('filterStatus')?.value || '';
  const cat=document.getElementById('filterCategory')?.value || '';
  const pr=document.getElementById('filterPriority')?.value || '';
  filtered = all.filter(t => {
    const text = [t.title,t.description,t.category,t.priority,t.status,t.source?.mail?.fromEmail,t.source?.mail?.subject,t.ai?.summary,t.source?.originalText].join(' ').toLowerCase();
    return (!q || text.includes(q)) && (!st || t.status === st) && (!cat || t.category === cat) && (!pr || t.priority === pr);
  });
  filtered.sort((a,b)=>compare(a[sortField], b[sortField]));
  page=1;
  render();
}

function normalize(v){ if(v==null) return ''; const d=Date.parse(v); if(!Number.isNaN(d) && /^\d{4}|\d{4}-\d{2}-\d{2}/.test(String(v))) return d; return String(v).toLowerCase(); }
function compare(a,b){ const av=normalize(a), bv=normalize(b); if(av<bv) return -sortDir; if(av>bv) return sortDir; return 0; }
function sortBy(field){ sortField = sortField === field ? field : field; sortDir = sortField === field ? -sortDir : 1; filtered.sort((a,b)=>compare(a[field], b[field])); render(); }
function getPageItems(){ return filtered.slice((page-1)*PER, page*PER); }

function render(){ renderTable(); renderPagination(); }
function renderTable(){
  const tbody=document.getElementById('tbody');
  const rows=getPageItems();
  if(!rows.length){ tbody.innerHTML = `<tr><td colspan="6"><div class="empty">Aucune tâche trouvée</div></td></tr>`; return; }
  tbody.innerHTML = rows.map(t => {
    const id=getId(t);
    return `<tr onclick="window.location.href='tache.html?id=${encodeURIComponent(id)}'">
      <td><div class="task-cell"><div class="task-icon">${categoryInitial(t.category)}</div><div><div class="task-title">${esc(t.title || 'Sans titre')}</div><div class="task-sub">${esc(t.description || t.ai?.summary || t.source?.mail?.subject || '')}</div></div></div></td>
      <td>${esc(categoryLabel(t.category))}</td><td>${priorityBadge(t.priority)}</td><td>${statusBadge(t.status)}</td><td>${formatDate(t.dueDate)}</td><td><a class="view-link" onclick="event.stopPropagation();window.location.href='tache.html?id=${encodeURIComponent(id)}'">Visualiser →</a></td>
    </tr>`;
  }).join('');
}
function renderPagination(){
  const el=document.getElementById('pagination');
  const totalPages=Math.max(1, Math.ceil(filtered.length/PER));
  const start=filtered.length ? (page-1)*PER+1 : 0;
  const end=Math.min(filtered.length, page*PER);
  const buttons=[];
  buttons.push(`<button class="pag-btn" ${page===1?'disabled':''} onclick="changePage(${page-1})">Préc.</button>`);
  for(let i=1;i<=totalPages;i++) buttons.push(`<button class="pag-btn ${i===page?'active':''}" onclick="changePage(${i})">${i}</button>`);
  buttons.push(`<button class="pag-btn" ${page===totalPages?'disabled':''} onclick="changePage(${page+1})">Suiv.</button>`);
  el.innerHTML = `<div class="pag-info">${start}-${end} sur ${filtered.length} tâche(s)</div><div class="pag-btns">${buttons.join('')}</div>`;
}
function changePage(next){ const totalPages=Math.max(1, Math.ceil(filtered.length/PER)); page=Math.min(totalPages, Math.max(1,next)); render(); }
function updateStats(){
  document.getElementById('stat-total').textContent = all.length;
  document.getElementById('stat-todo').textContent = all.filter(t => ['TODO','IN_PROGRESS','WAITING'].includes(t.status)).length;
  document.getElementById('stat-validate').textContent = all.filter(t => t.status === 'TO_VALIDATE').length;
  document.getElementById('stat-done').textContent = all.filter(t => t.status === 'DONE').length;
}
