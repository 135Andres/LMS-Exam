import { state, sessionState } from '../lib/state.js';
import { formatTime, escapeHtml, svgIcon } from '../lib/utils.js';

export function groupSessionsByDate(sessions) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const lastWeek = new Date(today);
  lastWeek.setDate(lastWeek.getDate() - 7);
  const groups = { 'Hoy': [], 'Ayer': [], 'Últimos 7 días': [], 'Anterior': [] };
  sessions.forEach(s => {
    const date = new Date(s.created_at);
    if (date >= today) groups['Hoy'].push(s);
    else if (date >= yesterday) groups['Ayer'].push(s);
    else if (date >= lastWeek) groups['Últimos 7 días'].push(s);
    else groups['Anterior'].push(s);
  });
  return groups;
}

export function renderSidebarSessions(sessions) {
  const container = document.getElementById('sidebarHistory');
  if (!container) return;
  const isGenerating = !!document.getElementById('typingIndicator');
  const showingArchived = document.getElementById('sidebar')?.dataset.mode === 'archived';
  const groups = showingArchived ? { 'Archivados': sessions } : groupSessionsByDate(sessions);
  let html = '';
  for (const [label, items] of Object.entries(groups)) {
    if (items.length === 0) continue;
    html += `<div class="sidebar-date-group"><div class="sidebar-date-label">${label}</div>`;
    items.forEach(s => {
      const preview = s.preview ? s.preview.slice(0, 40) + (s.preview.length > 40 ? '\u2026' : '') : 'Chat';
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
    html = `<div class="sidebar-date-group"><div class="sidebar-date-label">Sin chats aún</div></div>`;
  }
  container.innerHTML = html;
}

export async function fetchSessions() {
  try {
    const res = await fetch('/api/chat/tutor/sessions', { credentials: 'same-origin' });
    if (!res.ok) return [];
    const data = await res.json();
    return data.sessions || [];
  } catch {
    return [];
  }
}

export async function refreshSidebarSessions() {
  const sessions = await fetchSessions();
  renderSidebarSessions(sessions);
}

export async function fetchArchivedSessions() {
  try {
    const res = await fetch('/api/chat/sessions/archived', { credentials: 'same-origin' });
    if (!res.ok) return;
    const data = await res.json();
    renderSidebarSessions(data.sessions || []);
  } catch {}
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
  if (!sid || !confirm('\u00BFEliminar este chat permanentemente?')) return;
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
  await refreshSidebarSessions();
}

export function toggleArchivedView() {
  const sidebar = document.getElementById('sidebar');
  const isArchived = sidebar.dataset.mode === 'archived';
  const brand = sidebar.querySelector('.sidebar-brand');
  const btn = document.getElementById('showArchivedBtn');
  if (isArchived) {
    sidebar.dataset.mode = '';
    if (brand) brand.textContent = 'LMS Exams';
    if (btn) btn.innerHTML = `${svgIcon('archive', 14)} Chats archivados`;
    refreshSidebarSessions();
  } else {
    sidebar.dataset.mode = 'archived';
    if (brand) brand.textContent = 'Archivados';
    if (btn) btn.innerHTML = `${svgIcon('chevronUp', 14)} Volver a chats`;
    fetchArchivedSessions();
  }
  document.getElementById('userDropdown')?.classList.remove('open');
}

export function openSidebar() {
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

export function closeSidebar() {
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

export async function loadSession(sid, { addMessage, updateSessionInfo }) {
  if (!sid || sid === state.sessionId) return;
  state.sessionId = sid;
  sessionStorage.setItem('chatSessionId', sid);
  const chatMessages = document.getElementById('chatMessages');
  chatMessages.classList.remove('open');
  chatMessages.innerHTML = '';
  document.getElementById('contextPanel').classList.remove('open');
  document.querySelector('.page-content').classList.remove('panel-open');
  try {
    const res = await fetch(`/api/chat/tutor/history?session_id=${sid}&limit=100`, { credentials: 'same-origin' });
    if (res.ok) {
      const data = await res.json();
      if (data.messages && data.messages.length > 0) {
        data.messages.forEach(msg => {
          addMessage(msg.content, msg.role === 'user' ? 'user' : 'ai');
        });
      }
    }
  } catch {}
  chatMessages.classList.add('open');
  if (!sessionState.chatCreated) {
    sessionState.chatCreated = formatTime();
  }
  const sidebarMode = document.getElementById('sidebar')?.dataset.mode;
  if (sidebarMode === 'archived') await fetchArchivedSessions();
  else await refreshSidebarSessions();
  updateSessionInfo();
}
