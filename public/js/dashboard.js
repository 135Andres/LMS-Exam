import { escapeHtml } from './lib/utils.js';

async function checkSession() {
  try {
    const res = await fetch('/auth/me', { credentials: 'same-origin' });
    if (!res.ok) throw new Error('No session');
    const data = await res.json();
    if (!data?.email) throw new Error('No user');
  } catch {
    window.location.href = 'login.html';
    return;
  }
}

/* ── Sidebar (igual que chat.js, sin dependencias de estado de chat) ── */
function openSidebar() {
  const sidebar = document.getElementById('sidebar');
  const isCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
  if (isCollapsed) {
    sidebar.classList.remove('open');
    sidebar.classList.add('collapsed');
  } else {
    sidebar.classList.add('open');
    sidebar.classList.remove('collapsed');
  }
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const wasCollapsed = sidebar.classList.contains('collapsed');
  const isOpen = sidebar.classList.contains('open');

  if (!isOpen && wasCollapsed) {
    sidebar.classList.remove('collapsed');
    sidebar.classList.add('open');
    localStorage.setItem('sidebarCollapsed', 'false');
  } else if (isOpen && !wasCollapsed) {
    sidebar.classList.remove('open');
    sidebar.classList.add('collapsed');
    localStorage.setItem('sidebarCollapsed', 'true');
  } else {
    sidebar.classList.add('open');
    sidebar.classList.remove('collapsed');
    localStorage.setItem('sidebarCollapsed', 'false');
  }
}

/* ── Materias: mismo set de 7 subjects que detecta el resto del backend
   (hybrid-rag.service.ts / knowledge-detection.service.ts) + 'general'. ── */
const SUBJECT_META = {
  matematicas: { label: 'Matemáticas', icon: 'calculator', desc: 'Álgebra, cálculo, geometría y más.' },
  fisica: { label: 'Física', icon: 'atom', desc: 'Movimiento, fuerzas, energía.' },
  quimica: { label: 'Química', icon: 'flask-conical', desc: 'Elementos, reacciones, compuestos.' },
  biologia: { label: 'Biología', icon: 'dna', desc: 'Células, genética, organismos.' },
  historia: { label: 'Historia', icon: 'landmark', desc: 'Eventos, procesos y civilizaciones.' },
  lenguaje: { label: 'Lenguaje', icon: 'book-open', desc: 'Gramática, redacción, literatura.' },
  informatica: { label: 'Informática', icon: 'code-2', desc: 'Algoritmos, programación, datos.' },
  general: { label: 'General', icon: 'shapes', desc: 'Temas variados sin materia específica.' },
};

function subjectMeta(subject) {
  return SUBJECT_META[subject] || { label: subject, icon: 'shapes', desc: '' };
}

function userCardHtml(user, chatsCount, examsCount, subjectsCount) {
  const name = user.name || user.email || 'Estudiante';
  const initial = (name[0] || '?').toUpperCase();
  return `
    <div class="user-card-identity">
      <div class="user-card-avatar">${escapeHtml(initial)}</div>
      <span class="user-card-name">${escapeHtml(name)}</span>
      <span class="user-card-email">${escapeHtml(user.email || '')}</span>
    </div>
    <div class="user-card-stats">
      <div class="user-card-stat"><span class="user-card-stat-label">Chats</span><span class="user-card-stat-value">${chatsCount}</span></div>
      <div class="user-card-stat"><span class="user-card-stat-label">Exámenes</span><span class="user-card-stat-value">${examsCount}</span></div>
      <div class="user-card-stat"><span class="user-card-stat-label">Materias estudiadas</span><span class="user-card-stat-value">${subjectsCount}</span></div>
    </div>
  `;
}

function subjectCardHtml(item) {
  const meta = subjectMeta(item.subject);
  const pct = Math.max(0, Math.min(100, Math.round(item.calificacion || 0)));
  const prompt = item.recomendaciones || `Ayúdame a mejorar en ${meta.label}.`;
  return `
    <div class="subject-card">
      <div class="subject-card-header">
        <img src="svg/${meta.icon}.svg" width="20" height="20" alt="">
        <span class="subject-card-name">${escapeHtml(meta.label)}</span>
      </div>
      <p class="subject-card-desc">${escapeHtml(meta.desc)}</p>
      <div class="subject-progress-bar"><div class="subject-progress-fill" style="width:${pct}%"></div></div>
      <span class="subject-progress-label">${pct}/100</span>
      <a class="subject-recommend-link" href="chat.html?prompt=${encodeURIComponent(prompt)}">Recomendaciones →</a>
    </div>
  `;
}

async function loadDashboard() {
  const userCard = document.getElementById('userCard');
  const subjectsList = document.getElementById('subjectsList');

  let data = null;
  try {
    const res = await fetch('/api/user/dashboard-summary', { credentials: 'same-origin' });
    if (res.status === 401) { window.location.href = 'login.html'; return; }
    if (res.ok) data = await res.json();
  } catch {}

  if (!data) {
    userCard.textContent = 'No se pudo cargar tu perfil.';
    return;
  }

  userCard.innerHTML = userCardHtml(data.user, data.chatsCount, data.examsCount, data.subjects.length);

  if (data.subjects.length === 0) {
    subjectsList.innerHTML = '<p class="subjects-empty">Aún no hay suficiente actividad para generar tu primer análisis. Sigue chateando con el tutor — el análisis nocturno empieza a llenar esto solo.</p>';
    return;
  }

  subjectsList.innerHTML = data.subjects.map(subjectCardHtml).join('');
}

document.getElementById('homeBtn').addEventListener('click', () => { window.location.href = 'welcome.html'; });
document.getElementById('sidebarHome').addEventListener('click', () => { window.location.href = 'welcome.html'; });
document.getElementById('sidebarCollapseBtn').addEventListener('click', toggleSidebar);
document.getElementById('sidebarToggleBtn').addEventListener('click', toggleSidebar);
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
    e.preventDefault();
    toggleSidebar();
  }
});

checkSession();
openSidebar();
loadDashboard();
