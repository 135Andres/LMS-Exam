import { escapeHtml, isValidAvatarDataUrl } from './lib/utils.js';
import { initSettingsModal } from './lib/settings-modal.js';
import { initI18n, t } from './lib/i18n.js';

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
  matematicas: { labelKey: 'subjMatematicas', icon: 'calculator', descKey: 'subjMatematicasDesc' },
  fisica: { labelKey: 'subjFisica', icon: 'atom', descKey: 'subjFisicaDesc' },
  quimica: { labelKey: 'subjQuimica', icon: 'flask-conical', descKey: 'subjQuimicaDesc' },
  biologia: { labelKey: 'subjBiologia', icon: 'dna', descKey: 'subjBiologiaDesc' },
  historia: { labelKey: 'subjHistoria', icon: 'landmark', descKey: 'subjHistoriaDesc' },
  lenguaje: { labelKey: 'subjLenguaje', icon: 'book-open', descKey: 'subjLenguajeDesc' },
  informatica: { labelKey: 'subjInformatica', icon: 'code-2', descKey: 'subjInformaticaDesc' },
  general: { labelKey: 'subjGeneral', icon: 'shapes', descKey: 'subjGeneralDesc' },
};

function subjectMeta(subject) {
  const meta = SUBJECT_META[subject];
  return meta
    ? { label: t(meta.labelKey), icon: meta.icon, desc: t(meta.descKey) }
    : { label: subject, icon: 'shapes', desc: '' };
}

function userCardHtml(user, chatsCount, examsCount, subjectsCount) {
  const name = user.name || user.email || t('studentFallback');
  const initial = (name[0] || '?').toUpperCase();
  const avatarInner = isValidAvatarDataUrl(user.avatar_data) ? `<img src="${user.avatar_data}" alt="avatar">` : escapeHtml(initial);
  return `
    <div class="user-card-identity">
      <div class="user-card-avatar">${avatarInner}</div>
      <span class="user-card-name">${escapeHtml(name)}</span>
      <span class="user-card-email">${escapeHtml(user.email || '')}</span>
    </div>
    <div class="user-card-stats">
      <div class="user-card-stat"><span class="user-card-stat-label">${escapeHtml(t('dashboardChats'))}</span><span class="user-card-stat-value">${chatsCount}</span></div>
      <div class="user-card-stat"><span class="user-card-stat-label">${escapeHtml(t('dashboardExams'))}</span><span class="user-card-stat-value">${examsCount}</span></div>
      <div class="user-card-stat"><span class="user-card-stat-label">${escapeHtml(t('dashboardSubjectsStudied'))}</span><span class="user-card-stat-value">${subjectsCount}</span></div>
    </div>
  `;
}

function subjectCardHtml(item) {
  const meta = subjectMeta(item.subject);
  const pct = Math.max(0, Math.min(100, Math.round(item.calificacion || 0)));
  const prompt = item.recomendaciones || `${t('helpMeImprove')} ${meta.label}.`;
  return `
    <div class="subject-card">
      <div class="subject-card-header">
        <img src="svg/${meta.icon}.svg" width="20" height="20" alt="">
        <span class="subject-card-name">${escapeHtml(meta.label)}</span>
      </div>
      <p class="subject-card-desc">${escapeHtml(meta.desc)}</p>
      <div class="subject-progress-bar"><div class="subject-progress-fill" style="width:${pct}%"></div></div>
      <span class="subject-progress-label">${pct}/100</span>
      <a class="subject-recommend-link" href="chat.html?prompt=${encodeURIComponent(prompt)}">${escapeHtml(t('dashboardRecommendations'))}</a>
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
    userCard.textContent = t('dashboardNoProfile');
    return;
  }

  userCard.innerHTML = userCardHtml(data.user, data.chatsCount, data.examsCount, data.subjects.length);

  if (data.subjects.length === 0) {
    subjectsList.innerHTML = `<p class="subjects-empty">${escapeHtml(t('dashboardEmptySubjects'))}</p>`;
    return;
  }

  subjectsList.innerHTML = data.subjects.map(subjectCardHtml).join('');
}

document.getElementById('homeBtn').addEventListener('click', () => { window.location.href = 'chat.html'; });
document.getElementById('sidebarHome').addEventListener('click', () => { window.location.href = 'chat.html'; });
document.getElementById('sidebarCollapseBtn').addEventListener('click', toggleSidebar);
document.getElementById('sidebarToggleBtn').addEventListener('click', toggleSidebar);
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
    e.preventDefault();
    toggleSidebar();
  }
});

initI18n();
initSettingsModal();
// El modal no conoce la estructura de esta página (user-card grande, sin
// avatar separado en sidebar) — más simple recargar la card completa.
window.addEventListener('lms:profile-updated', () => loadDashboard());

checkSession();
openSidebar();
loadDashboard();
