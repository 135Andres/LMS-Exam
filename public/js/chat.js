import { renderAvatarInto } from './lib/utils.js';
import { initSettingsModal } from './lib/settings-modal.js';
import { initI18n } from './lib/i18n.js';
import { initOnboarding } from './onboarding.js';
import { state } from './chat-state.js';
import { handleSend } from './chat-streaming.js';
import {
  refreshSidebarSessions, loadSession, toggleSidebar, toggleArchivedView, archiveSession,
  unarchiveSession, deleteSession, setupChatTitleEditing, setMode, newChat,
} from './chat-sessions.js';
import { addMessage, hideTyping } from './chat-messages.js';
import { setupChatInput } from './chat-input.js';
import { updateSessionInfo, toggleContextPanel, closeContextPanel, setupStopwatch } from './chat-context-panel.js';
export { handleSend, addMessage, hideTyping }; // onboarding.js importa estas 3 desde chat.js — mantener ese import funcionando sin tocarlo

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

checkSession();

const historyPromise = loadChatHistory().then(data => {
  if (!state.sessionId && data && data.sessionId) {
    state.sessionId = data.sessionId;
    sessionStorage.setItem('chatSessionId', state.sessionId);
  }
});

// Antes: si esta llamada era lenta/fallaba, populateTopBarModels() (llamado
// justo después de construir el input) corría con availableModels=[] y se
// quedaba marcado como "ya poblado" para siempre — el selector nunca se
// llenaba hasta recargar la página. Ahora: reintenta y siempre resuelve;
// setupChatInput espera este promise antes de poblar el selector.
async function fetchModels(attempt = 1) {
  try {
    const res = await fetch('/api/chat/models', { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.availableModels = data.models || [];
    if (state.availableModels.length > 0) {
      state.selectedModelId = state.availableModels[0].id;
    }
  } catch (e) {
    console.warn('Error fetching models (intento ' + attempt + '):', e);
    if (attempt < 3) {
      await new Promise(r => setTimeout(r, 800 * attempt));
      return fetchModels(attempt + 1);
    }
  }
}

export const modelsPromise = fetchModels();

async function loadChatHistory() {
  try {
    const res = await fetch('/api/chat/tutor/history', { credentials: 'same-origin' });
    if (!res.ok) return;
    const data = await res.json();
    if (data.sessionId) {
      state.sessionId = data.sessionId;
      sessionStorage.setItem('chatSessionId', state.sessionId);
    }
    return data;
  } catch {
    return null;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  initI18n();
  updateSessionInfo();
  setInterval(updateSessionInfo, 10000);

  document.getElementById('contextBtn').addEventListener('click', toggleContextPanel);
  document.getElementById('contextPanelClose').addEventListener('click', closeContextPanel);
  // "LMS Exams" ya no navega a ningún lado — chat.html es la página raíz ahora,
  // el logo es solo decoración.
  initSettingsModal();
  window.addEventListener('lms:profile-updated', (e) => {
    const avatarEl = document.getElementById('sidebarUserAvatar');
    if (e.detail.avatarData !== undefined) {
      state.sessionState.avatarData = e.detail.avatarData;
      if (avatarEl) renderAvatarInto(avatarEl, e.detail.avatarData, state.sessionState.name || state.sessionState.email);
    }
    if (e.detail.name !== undefined) {
      state.sessionState.name = e.detail.name;
      const nameEl = document.getElementById('sidebarUserName');
      if (nameEl) nameEl.textContent = e.detail.name;
      if (!e.detail.avatarData && avatarEl) renderAvatarInto(avatarEl, state.sessionState.avatarData, e.detail.name);
    }
  });

  document.getElementById('sidebarCollapseBtn').addEventListener('click', toggleSidebar);
  document.getElementById('sidebarToggleBtn').addEventListener('click', toggleSidebar);
  document.getElementById('sidebarNewChat').addEventListener('click', () => {
    if (state.currentMode === 'exam') return; // modo examen aún sin funcionalidad
    newChat();
  });
  document.getElementById('modeToggleBtn').addEventListener('click', () => {
    setMode(state.currentMode === 'chat' ? 'exam' : 'chat');
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
      e.preventDefault();
      toggleSidebar();
    }
  });

  document.getElementById('showArchivedBtn').addEventListener('click', toggleArchivedView);
  document.getElementById('toggleStopwatchBtn').addEventListener('click', () => {
    document.getElementById('stopwatchWidget').classList.toggle('visible');
    document.getElementById('userDropdown').classList.remove('open');
  });
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    try {
      await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } catch {}
    sessionStorage.clear();
    window.location.href = 'login.html';
  });
  setupStopwatch();

  // Click fuera del input → colapsa con animación
  document.addEventListener('mousedown', (e) => {
    if (e.target.closest('.chat-input-wrapper')) return;
    const msgInput = document.getElementById('messageInput');
    if (!msgInput) return;
    if (!document.getElementById('chatMessages').classList.contains('open')) return;
    const inner = document.getElementById('chatInputInner');
    if (inner.classList.contains('shrunken')) return;
    if (inner.offsetHeight <= 44) return;
    inner.dataset.prevHeight = inner.offsetHeight;
    msgInput.blur();
    inner.style.transition = 'height 300ms ease';
    inner.style.height = inner.offsetHeight + 'px';
    inner.classList.add('shrunken');
    void inner.offsetHeight;
    inner.style.height = '44px';
  });

  document.getElementById('sidebarHistory').addEventListener('click', (e) => {
    const actionBtn = e.target.closest('.sidebar-item-btn');
    if (actionBtn) {
      const item = actionBtn.closest('.sidebar-chat-item');
      if (!item) return;
      const sid = item.dataset.session;
      const action = actionBtn.dataset.action;
      if (action === 'archive') archiveSession(sid);
      else if (action === 'unarchive') unarchiveSession(sid);
      else if (action === 'delete') deleteSession(sid);
      return;
    }
    const item = e.target.closest('.sidebar-chat-item');
    if (!item) return;
    const sid = item.dataset.session;
    if (!sid || sid === state.sessionId) return;
    loadSession(sid);
  });

  document.getElementById('sidebarUserInfo').addEventListener('click', (e) => {
    e.stopPropagation();
    const dropdown = document.getElementById('userDropdown');
    if (dropdown) dropdown.classList.toggle('open');
  });

  document.addEventListener('click', () => {
    const dropdown = document.getElementById('userDropdown');
    if (dropdown) dropdown.classList.remove('open');
  });

  refreshSidebarSessions();

  if (!state.sessionId) {
    state.sessionId = crypto.randomUUID();
    sessionStorage.setItem('chatSessionId', state.sessionId);
  }
  await historyPromise;
  setupChatInput();
  setupChatTitleEditing();
  initOnboarding();

  // Viene de dashboard.html con un prompt preparado (ej. "Recomendaciones" de
  // una materia) — se autoenvía y se limpia el query param para que un
  // refresh no lo vuelva a mandar.
  const prefilledPrompt = new URLSearchParams(location.search).get('prompt');
  if (prefilledPrompt) {
    history.replaceState(null, '', 'chat.html');
    newChat();
    const input = document.getElementById('messageInput');
    input.value = prefilledPrompt;
    handleSend();
  }
});
