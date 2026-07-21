import { renderAvatarInto } from './lib/utils.js';
import { initSettingsModal } from './lib/settings-modal.js';
import { initI18n, t } from './lib/i18n.js';
import { initOnboarding } from './onboarding.js';
import { state } from './chat-state.js';
import { handleSend } from './chat-streaming.js';
import {
  refreshSidebarSessions, loadSession, toggleSidebar, toggleArchivedView, archiveSession,
  unarchiveSession, deleteSession, setupChatTitleEditing, setMode, newChat,
} from './chat-sessions.js';
import { addMessage, hideTyping, fetchPinnedMessages, renderPinnedSection } from './chat-messages.js';
import { setupChatInput } from './chat-input.js';
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

function formatStopwatch(totalSeconds) {
  const pad2 = n => String(n).padStart(2, '0');
  const totalMinutes = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  if (totalMinutes < 100) return `${pad2(totalMinutes)}:${pad2(secs)}`;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  const hoursStr = hours < 10 ? String(hours) : pad2(hours);
  return `${hoursStr}:${pad2(mins)}:${pad2(secs)}`;
}

// Acepta "MM:SS" o "H:MM:SS"/"HH:MM:SS". null si no se puede interpretar.
function parseStopwatchInput(text) {
  const parts = text.trim().split(':');
  if (parts.length < 2 || parts.length > 3 || parts.some(p => !/^\d+$/.test(p.trim()))) return null;
  const nums = parts.map(p => parseInt(p.trim(), 10));
  if (nums.length === 2) return nums[0] * 60 + nums[1];
  return nums[0] * 3600 + nums[1] * 60 + nums[2];
}

function setupStopwatch() {
  const widget = document.getElementById('stopwatchWidget');
  const display = document.getElementById('stopwatchDisplay');
  const startBtn = document.getElementById('stopwatchStartBtn');
  const countdownBtn = document.getElementById('stopwatchCountdownBtn');
  let seconds = 0;
  let mode = 'up'; // 'up' (cronómetro) | 'down' (contador)
  let interval = null;

  function render() { display.textContent = formatStopwatch(seconds); }

  function tick() {
    if (mode === 'up') {
      seconds++;
    } else {
      seconds = Math.max(0, seconds - 1);
      if (seconds === 0) { render(); stop(); return; }
    }
    render();
  }

  function start() {
    widget.classList.add('running');
    startBtn.textContent = t('stopwatchPause');
    interval = setInterval(tick, 1000);
  }

  function stop() {
    clearInterval(interval);
    interval = null;
    widget.classList.remove('running');
    startBtn.textContent = t('stopwatchResume');
  }

  startBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (interval) { stop(); return; }
    if (seconds === 0 && mode === 'down') mode = 'up'; // contador ya llegó a 0: reinicia como cronómetro normal
    if (mode === 'up' && seconds === 0) startBtn.textContent = t('stopwatchPause');
    start();
  });

  countdownBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (interval) return;
    display.contentEditable = 'true';
    display.focus();
    const range = document.createRange();
    range.selectNodeContents(display);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });

  function commitEdit() {
    display.contentEditable = 'false';
    const parsed = parseStopwatchInput(display.textContent);
    if (parsed !== null && parsed > 0) {
      seconds = parsed;
      mode = 'down';
      render();
      start();
    } else {
      render();
    }
  }

  function placeCaretAtEnd() {
    const range = document.createRange();
    range.selectNodeContents(display);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // Autoformatea mientras escribe: solo dígitos, ":" cada 2 (ej. "1000" → "10:00").
  display.addEventListener('input', () => {
    if (display.contentEditable !== 'true') return;
    const digits = display.textContent.replace(/\D/g, '').slice(0, 6);
    display.textContent = digits.match(/.{1,2}/g)?.join(':') || digits;
    placeCaretAtEnd();
  });

  display.addEventListener('keydown', (e) => {
    if (display.contentEditable === 'true' && e.key === 'Enter') { e.preventDefault(); display.blur(); }
  });
  display.addEventListener('blur', () => {
    if (display.contentEditable === 'true') commitEdit();
  });
}
/* ── End Sidebar ── */

/* ── Context Ring & Panel ── */

function getRingColor(pct) {
  if (pct <= 0.5) return '#4ade80';
  if (pct <= 0.8) return '#facc15';
  return '#f87171';
}

function getContextUsage() {
  const limit = state.sessionState.contextLength || 128000;
  return Math.min(state.sessionState.totalTokens / limit, 1);
}

function renderContextRing() {
  const fg = document.getElementById('contextRingFg');
  const text = document.getElementById('contextRingText');
  if (!fg || !text) return;
  const usage = getContextUsage();
  const circumference = 97.4;
  const offset = circumference * (1 - usage);
  fg.style.strokeDashoffset = String(offset);
  fg.style.stroke = getRingColor(usage);
  text.textContent = Math.round(usage * 100) + '%';
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-MX', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

let updateSessionTimeout = null;

export async function updateSessionInfo() {
  if (updateSessionTimeout) return;
  updateSessionTimeout = setTimeout(async () => {
    updateSessionTimeout = null;
    try {
      const res = await fetch('/auth/me', { credentials: 'same-origin' });
      if (res.status === 401) { window.location.href = 'login.html'; return; }
      if (res.ok) {
        const data = await res.json();
        state.sessionState.email = data.email || '';
        state.sessionState.name = data.name || data.email || '';
        state.sessionState.role = data.role || '';
      }
    } catch (_) {}

    try {
      const res = await fetch('/api/user/profile', { credentials: 'same-origin' });
      if (res.ok) {
        const data = await res.json();
        const u = data.user || data;
        state.sessionState.email = u.email || state.sessionState.email;
        state.sessionState.name = u.username || u.name || state.sessionState.name;
        state.sessionState.role = u.role || state.sessionState.role;
        state.sessionState.createdAt = u.created_at || u.createdAt || '';
        state.sessionState.examsGenerated = u.exams_generated ?? u.examsGenerated ?? 0;
        state.sessionState.totalApiCost = u.total_api_cost ?? u.totalApiCost ?? 0;
        state.sessionState.avatarData = u.avatar_data || null;
      }
    } catch (_) {}

    try {
      const exRes = await fetch('/api/exams', { credentials: 'same-origin' });
      if (exRes.ok) {
        const exData = await exRes.json();
        state.sessionState.examsGenerated = (exData.exams && exData.exams.length) || 0;
      }
    } catch (_) {}

    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) {
      const userRows = chatMessages.querySelectorAll('.msg-row.msg-user');
      const aiRows = chatMessages.querySelectorAll('.msg-row.msg-ai');
      state.sessionState.userMessages = userRows.length;
      state.sessionState.assistantMessages = aiRows.length;

      let userChars = 0;
      let aiChars = 0;
      userRows.forEach(r => {
        const t = r.querySelector('.bubble-text');
        if (t) userChars += t.textContent.length;
      });
      aiRows.forEach(r => {
        const t = r.querySelector('.bubble-text');
        if (t) aiChars += t.textContent.length;
      });
      const totalChars = userChars + aiChars;
      const ratio = totalChars > 0 ? userChars / totalChars : 0.5;
      state.sessionState.totalTokens = Math.round(totalChars / 4);
      state.sessionState.inputTokens = Math.round(state.sessionState.totalTokens * ratio);
      state.sessionState.outputTokens = state.sessionState.totalTokens - state.sessionState.inputTokens;
    }

    const modelSelect = document.getElementById('modelSelect') || document.getElementById('topBarModelSelect');
    if (modelSelect && modelSelect.value) {
      const m = state.availableModels.find(x => x.id === modelSelect.value);
      if (m) {
        state.sessionState.model = m.label || m.id;
        state.sessionState.provider = m.provider || 'NVIDIA';
        state.sessionState.contextLength = m.contextLength || 128000;
      } else {
        state.sessionState.model = modelSelect.value;
      }
    }

    // Update sidebar user info
    const userNameEl = document.getElementById('sidebarUserName');
    const avatarEl = document.getElementById('sidebarUserAvatar');
    if (userNameEl) userNameEl.textContent = state.sessionState.name || state.sessionState.email || t('user');
    if (avatarEl) renderAvatarInto(avatarEl, state.sessionState.avatarData, state.sessionState.name || state.sessionState.email);

    state.sessionState.lastActivity = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

    renderContextRing();
    renderContextPanel();
  }, 50);
}

function renderContextPanel() {
  const body = document.getElementById('contextPanelBody');
  if (!body) return;

  body.innerHTML = `
    <div class="session-info-grid">
      <div class="session-info-item">
        <span class="session-info-label">Email</span>
        <span class="session-info-value">${state.sessionState.email || '—'}</span>
      </div>
      <div class="session-info-item">
        <span class="session-info-label">Rol</span>
        <span class="session-info-value">${state.sessionState.role || '—'}</span>
      </div>
      <div class="session-info-item">
        <span class="session-info-label">Exámenes disponibles</span>
        <span class="session-info-value">${state.sessionState.examsGenerated}</span>
      </div>
      <div class="session-info-item">
        <span class="session-info-label">Límite de contexto</span>
        <span class="session-info-value">${(state.sessionState.contextLength / 1000).toFixed(0)}K</span>
      </div>
      <div class="session-info-item">
        <span class="session-info-label">Chat creado</span>
        <span class="session-info-value">${state.sessionState.chatCreated || '—'}</span>
      </div>
      <div class="session-info-item">
        <span class="session-info-label">Mensajes de usuario</span>
        <span class="session-info-value">${state.sessionState.userMessages}</span>
      </div>
      <div class="session-info-item">
        <span class="session-info-label">Mensajes del asistente</span>
        <span class="session-info-value">${state.sessionState.assistantMessages}</span>
      </div>
      <div class="session-info-item">
        <span class="session-info-label">Total tokens estimados</span>
        <span class="session-info-value">${state.sessionState.totalTokens.toLocaleString()}</span>
      </div>
      <div class="session-info-item">
        <span class="session-info-label">Tokens de entrada</span>
        <span class="session-info-value">${state.sessionState.inputTokens.toLocaleString()}</span>
      </div>
      <div class="session-info-item">
        <span class="session-info-label">Tokens de salida</span>
        <span class="session-info-value">${state.sessionState.outputTokens.toLocaleString()}</span>
      </div>
      <div class="session-info-item">
        <span class="session-info-label">Proveedor</span>
        <span class="session-info-value">${state.sessionState.provider}</span>
      </div>
      <div class="session-info-item">
        <span class="session-info-label">Modelo</span>
        <span class="session-info-value">${state.sessionState.model || '—'}</span>
      </div>
      <div class="session-info-item">
        <span class="session-info-label">Última actividad</span>
        <span class="session-info-value">${state.sessionState.lastActivity}</span>
      </div>
    </div>
  `;
}

function toggleContextPanel() {
  const panel = document.getElementById('contextPanel');
  const isOpen = panel.classList.toggle('open');
  document.querySelector('.page-content').classList.toggle('panel-open', isOpen);
  if (isOpen) fetchPinnedMessages().then(renderPinnedSection);
}

export function closeContextPanel() {
  document.getElementById('contextPanel').classList.remove('open');
  document.querySelector('.page-content').classList.remove('panel-open');
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
