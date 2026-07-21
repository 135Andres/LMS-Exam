import { formatTime, escapeHtml, svgIcon } from './lib/utils.js';
import { t } from './lib/i18n.js';
import { state } from './chat-state.js';
import { updateSessionInfo } from './chat-context-panel.js';
import { playHeroToChatMorph } from './chat-hero.js';
import { addMessage } from './chat-messages.js';

async function fetchSessions() {
  try {
    const res = await fetch('/api/chat/tutor/sessions', { credentials: 'same-origin' });
    if (!res.ok) return [];
    const data = await res.json();
    return data.sessions || [];
  } catch {
    return [];
  }
}

function groupSessionsByDate(sessions) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const lastWeek = new Date(today);
  lastWeek.setDate(lastWeek.getDate() - 7);
  const groups = { [t('today')]: [], [t('yesterday')]: [], [t('last7Days')]: [], [t('earlier')]: [] };
  sessions.forEach(s => {
    const date = new Date(s.created_at);
    if (date >= today) groups[t('today')].push(s);
    else if (date >= yesterday) groups[t('yesterday')].push(s);
    else if (date >= lastWeek) groups[t('last7Days')].push(s);
    else groups[t('earlier')].push(s);
  });
  return groups;
}

function renderSidebarSessions(sessions) {
  const container = document.getElementById('sidebarHistory');
  if (!container) return;
  const isGenerating = !!document.getElementById('typingIndicator');
  const showingArchived = document.getElementById('sidebar')?.dataset.mode === 'archived';
  const groups = showingArchived ? { [t('archived')]: sessions } : groupSessionsByDate(sessions);
  let html = '';
  for (const [label, items] of Object.entries(groups)) {
    if (items.length === 0) continue;
    html += `<div class="sidebar-date-group"><div class="sidebar-date-label">${label}</div>`;
    items.forEach(s => {
      const raw = s.title || s.preview || t('chatFallback');
      const preview = raw.slice(0, 40) + (raw.length > 40 ? '…' : '');
      const isActive = s.session_id === state.sessionId;
      let icon = 'chatText';
      if (isActive && isGenerating) icon = 'chatMore';
      html += `<div class="sidebar-chat-item${isActive ? ' active' : ''}" data-session="${s.session_id}">
        ${svgIcon(icon)}
        <span class="sidebar-chat-name">${escapeHtml(preview)}</span>
        <span class="sidebar-item-actions">
          ${showingArchived
            ? `<button class="sidebar-item-btn" data-action="unarchive" title="Restaurar">${svgIcon('archiveUp')}</button>`
            : `<button class="sidebar-item-btn" data-action="archive" title="Archivar">${svgIcon('archive')}</button>`
          }
          <button class="sidebar-item-btn" data-action="delete" title="Eliminar">${svgIcon('trash')}</button>
        </span>
      </div>`;
    });
    html += `</div>`;
  }
  if (!html) {
    html = `<div class="sidebar-date-group"><div class="sidebar-date-label">${escapeHtml(t('noChatsYet'))}</div></div>`;
  }
  container.innerHTML = html;
  // La vista de archivados no refleja necesariamente la sesión activa —
  // no toques el título del chat mientras el usuario la está navegando.
  if (!showingArchived) updateTopBarTitle(sessions);
}

// Soporte mínimo de markdown en el título: **negrita** y *cursiva*.
// Bold primero — si no, "**x**" se leería como dos itálicas pegadas.
function renderTitleMarkup(raw) {
  let html = escapeHtml(raw);
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return html;
}

export function setChatTitleRaw(raw) {
  const textEl = document.getElementById('chatTitleText');
  if (!textEl) return;
  textEl.dataset.raw = raw;
  textEl.innerHTML = renderTitleMarkup(raw);
}

// Título del chat activo en la navbar superior — usa el nombre renombrado a
// mano si existe (cs.title), si no el "preview" (primer mensaje truncado).
function updateTopBarTitle(sessions) {
  const input = document.getElementById('chatTitleInput');
  if (input && !input.classList.contains('hidden')) return; // no pisar mientras el usuario edita
  const active = sessions.find(s => s.session_id === state.sessionId);
  const raw = active?.title || active?.preview || t('newChatTitle');
  setChatTitleRaw(raw.length > 50 ? raw.slice(0, 50) + '…' : raw);
}

export function setupChatTitleEditing() {
  const textEl = document.getElementById('chatTitleText');
  const input = document.getElementById('chatTitleInput');
  if (!textEl || !input || textEl._wired) return;
  textEl._wired = true;

  function startEdit() {
    input.value = textEl.dataset.raw || '';
    textEl.classList.add('hidden');
    input.classList.remove('hidden');
    input.focus();
    input.select();
  }

  async function saveEdit() {
    const value = input.value.trim();
    input.classList.add('hidden');
    textEl.classList.remove('hidden');
    if (!value || value === textEl.dataset.raw) return;
    setChatTitleRaw(value);
    try {
      await fetch('/api/chat/rename', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ sessionId: state.sessionId, title: value }),
      });
    } catch {}
    refreshSidebarSessions();
  }

  textEl.addEventListener('click', startEdit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { input.value = textEl.dataset.raw || ''; input.blur(); }
  });
  input.addEventListener('blur', saveEdit);
}

export async function refreshSidebarSessions() {
  const sessions = await fetchSessions();
  renderSidebarSessions(sessions);
}

export async function loadSession(sid) {
  if (!sid || sid === state.sessionId) return;
  state.sessionId = sid;
  sessionStorage.setItem('chatSessionId', sid);
  const chatMessages = document.getElementById('chatMessages');
  chatMessages.classList.remove('open');
  chatMessages.innerHTML = '';
  document.getElementById('contextPanel').classList.remove('open');
  document.querySelector('.page-content').classList.remove('panel-open');

  async function renderHistoryAndFinish() {
    try {
      const res = await fetch(`/api/chat/tutor/history?session_id=${sid}&limit=100`, { credentials: 'same-origin' });
      if (res.ok) {
        const data = await res.json();
        if (data.messages && data.messages.length > 0) {
          data.messages.forEach(msg => {
            addMessage(msg.content, msg.role === 'user' ? 'user' : 'ai', undefined, msg.id, !!msg.is_pinned);
          });
        }
      }
    } catch {}
    chatMessages.classList.add('open');
    if (!state.sessionState.chatCreated) {
      state.sessionState.chatCreated = formatTime();
    }
    // Mantener vista actual (archivados/normales) al abrir un chat
    const sidebarMode = document.getElementById('sidebar')?.dataset.mode;
    if (sidebarMode === 'archived') await fetchArchivedSessions();
    else await refreshSidebarSessions();
    updateSessionInfo();
  }

  // Si estaba en la posición (new), seleccionar un chat del sidebar debe
  // pasar a la posición (chat) con la misma animación que al enviar el
  // primer mensaje — si no, los mensajes se renderizan pero quedan ocultos
  // (hero-active pone #chatMessages en visibility:hidden).
  if (document.getElementById('pageContent').classList.contains('hero-active')) {
    playHeroToChatMorph(() => {
      document.getElementById('pageContent').classList.remove('hero-active');
      renderHistoryAndFinish();
    });
  } else {
    await renderHistoryAndFinish();
  }
}

export async function archiveSession(sid) {
  if (!sid) return;
  try {
    await fetch('/api/chat/archive', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ sessionId: sid }),
    });
    if (sid === state.sessionId) {
      state.sessionId = '';
      sessionStorage.removeItem('chatSessionId');
      document.getElementById('chatMessages').classList.remove('open');
      document.getElementById('chatMessages').innerHTML = '';
    }
  } catch {}
  const isArchivedView = document.getElementById('sidebar')?.dataset.mode === 'archived';
  if (isArchivedView) fetchArchivedSessions();
  else await refreshSidebarSessions();
}

export async function unarchiveSession(sid) {
  if (!sid) return;
  try {
    await fetch('/api/chat/unarchive', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ sessionId: sid }),
    });
  } catch {}
  fetchArchivedSessions();
}

export async function deleteSession(sid) {
  if (!sid || !confirm(t('confirmDeleteChat'))) return;
  try {
    await fetch('/api/chat/delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ sessionId: sid }),
    });
    if (sid === state.sessionId) {
      state.sessionId = '';
      sessionStorage.removeItem('chatSessionId');
      document.getElementById('chatMessages').classList.remove('open');
      document.getElementById('chatMessages').innerHTML = '';
    }
  } catch {}
  const isArchivedView = document.getElementById('sidebar')?.dataset.mode === 'archived';
  if (isArchivedView) fetchArchivedSessions();
  else await refreshSidebarSessions();
}

export function toggleArchivedView() {
  const sidebar = document.getElementById('sidebar');
  const isArchived = sidebar.dataset.mode === 'archived';
  const brand = sidebar.querySelector('.sidebar-brand');
  const btn = document.getElementById('showArchivedBtn');
  if (isArchived) {
    sidebar.dataset.mode = '';
    if (brand) brand.textContent = t('brand');
    if (btn) btn.innerHTML = `${svgIcon('archive', 14)} ${escapeHtml(t('archivedChats'))}`;
    refreshSidebarSessions();
  } else {
    sidebar.dataset.mode = 'archived';
    if (brand) brand.textContent = t('archived');
    if (btn) btn.innerHTML = `${svgIcon('chevronUp', 14)} ${escapeHtml(t('backToChats'))}`;
    fetchArchivedSessions();
  }
  document.getElementById('userDropdown')?.classList.remove('open');
}

async function fetchArchivedSessions() {
  try {
    const res = await fetch('/api/chat/sessions/archived', { credentials: 'same-origin' });
    if (!res.ok) return;
    const data = await res.json();
    renderSidebarSessions(data.sessions || []);
  } catch {}
}

/* ── Sidebar ── */
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

function closeSidebar() {
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.remove('open', 'collapsed');
}

export function toggleSidebar() {
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

/* ── Modo chat / examen ── */

export function setMode(mode) {
  state.currentMode = mode;
  const examActive = mode === 'exam';
  document.body.classList.toggle('exam-mode', examActive);

  const toggleBtn = document.getElementById('modeToggleBtn');
  toggleBtn.classList.toggle('exam-active', examActive);
  toggleBtn.textContent = examActive ? t('switchToChat') : t('switchToExam');

  document.getElementById('sidebarNewChatLabel').textContent = examActive ? t('newExam') : t('newChat');
}

export function newChat() {
  document.getElementById('chatMessages').classList.remove('open');
  document.getElementById('chatMessages').innerHTML = '';
  document.getElementById('contextPanel').classList.remove('open');
  document.querySelector('.page-content').classList.remove('panel-open');

  state.sessionId = crypto.randomUUID();
  sessionStorage.setItem('chatSessionId', state.sessionId);
  setChatTitleRaw(t('newChatTitle'));

  document.getElementById('chatMessages').classList.add('open');
  state.sessionState.chatCreated = formatTime();
  addMessage(t('tutorGreeting'), 'ai');
  updateSessionInfo();
  refreshSidebarSessions();
}
