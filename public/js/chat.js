import { formatTime, escapeHtml, svgIcon, formatAIResponse, renderAvatarInto } from './lib/utils.js';
import { initSettingsModal, notifyIfEnabled } from './lib/settings-modal.js';
import { initI18n, t } from './lib/i18n.js';
import { wrapBareLatex } from './lib/latex-detect.js';
import { initOnboarding, renderOnboardingStep, maybeOfferDeferredBanner } from './onboarding.js';

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

function renderKaTeX() {
  if (typeof katex !== 'object') return;
  var elements = document.querySelectorAll('.bubble-ai .bubble-text');
  for (var i = 0; i < elements.length; i++) {
    var el = elements[i];
    if (el.dataset.katexRendered) continue;
    var html = el.innerHTML;
    // Safety net: wrap bare LaTeX commands (no delimiter around them, e.g. a
    // prompt slip-up) in $$...$$ before the 4 known-delimiter passes below.
    var replaced = wrapBareLatex(html);
    replaced = replaced.replace(/\\\[(.+?)\\\]/gs, function (_, expr) {
      try { return katex.renderToString(expr, { displayMode: true, throwOnError: false }); }
      catch (_) { return '\\[' + expr + '\\]'; }
    });
    replaced = replaced.replace(/\$\$(.+?)\$\$/gs, function (_, expr) {
      try { return katex.renderToString(expr, { displayMode: true, throwOnError: false }); }
      catch (_) { return '$$' + expr + '$$'; }
    });
    replaced = replaced.replace(/\\\((.+?)\\\)/gs, function (_, expr) {
      try { return katex.renderToString(expr, { displayMode: false, throwOnError: false }); }
      catch (_) { return '\\(' + expr + '\\)'; }
    });
    replaced = replaced.replace(/\$(.+?)\$/g, function (_, expr) {
      try { return katex.renderToString(expr, { displayMode: false, throwOnError: false }); }
      catch (_) { return '$' + expr + '$'; }
    });
    if (replaced !== html) {
      el.innerHTML = replaced;
      el.dataset.katexRendered = '1';
    }
  }
}

let selectedModelId = '';
let availableModels = [];
let pendingAttachments = [];
let sessionId = sessionStorage.getItem('chatSessionId') || '';
let linkModeActive = false;
let activeLinks = [];
let reExplicarModeActive = false;
let reExplicarTargetRow = null;

const SLASH_COMMANDS = [
  { primary: '/resumen', aliases: ['/resumen', '/resume'], descKey: 'slashSummaryDesc' },
  { primary: '/exportar', aliases: ['/exportar', '/export'], descKey: 'slashExportDesc' },
  { primary: '/help', aliases: ['/help', '/ayuda'], descKey: 'slashHelpDesc' },
];

let slashMenuActive = false;
let slashMenuIndex = 0;
let slashMenuMatches = [];

const REEXPLICAR_SUGGESTIONS = [
  'con una analogía de cocina',
  'más simple, como si tuviera 10 años',
  'con un ejemplo de la vida diaria',
  'con un diagrama en texto',
];

checkSession();

const historyPromise = loadChatHistory().then(data => {
  if (!sessionId && data && data.sessionId) {
    sessionId = data.sessionId;
    sessionStorage.setItem('chatSessionId', sessionId);
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
    availableModels = data.models || [];
    if (availableModels.length > 0) {
      selectedModelId = availableModels[0].id;
    }
  } catch (e) {
    console.warn('Error fetching models (intento ' + attempt + '):', e);
    if (attempt < 3) {
      await new Promise(r => setTimeout(r, 800 * attempt));
      return fetchModels(attempt + 1);
    }
  }
}

const modelsPromise = fetchModels();

async function loadChatHistory() {
  try {
    const res = await fetch('/api/chat/tutor/history', { credentials: 'same-origin' });
    if (!res.ok) return;
    const data = await res.json();
    if (data.sessionId) {
      sessionId = data.sessionId;
      sessionStorage.setItem('chatSessionId', sessionId);
    }
    return data;
  } catch {
    return null;
  }
}

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
      const isActive = s.session_id === sessionId;
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

function setChatTitleRaw(raw) {
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
  const active = sessions.find(s => s.session_id === sessionId);
  const raw = active?.title || active?.preview || t('newChatTitle');
  setChatTitleRaw(raw.length > 50 ? raw.slice(0, 50) + '…' : raw);
}

function setupChatTitleEditing() {
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
        body: JSON.stringify({ sessionId, title: value }),
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

async function refreshSidebarSessions() {
  const sessions = await fetchSessions();
  renderSidebarSessions(sessions);
}

async function loadSession(sid) {
  if (!sid || sid === sessionId) return;
  sessionId = sid;
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
    if (!sessionState.chatCreated) {
      sessionState.chatCreated = formatTime();
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

async function archiveSession(sid) {
  if (!sid) return;
  try {
    await fetch('/api/chat/archive', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ sessionId: sid }),
    });
    if (sid === sessionId) {
      sessionId = '';
      sessionStorage.removeItem('chatSessionId');
      document.getElementById('chatMessages').classList.remove('open');
      document.getElementById('chatMessages').innerHTML = '';
    }
  } catch {}
  const isArchivedView = document.getElementById('sidebar')?.dataset.mode === 'archived';
  if (isArchivedView) fetchArchivedSessions();
  else await refreshSidebarSessions();
}

async function unarchiveSession(sid) {
  if (!sid) return;
  try {
    await fetch('/api/chat/unarchive', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ sessionId: sid }),
    });
  } catch {}
  fetchArchivedSessions();
}

async function deleteSession(sid) {
  if (!sid || !confirm(t('confirmDeleteChat'))) return;
  try {
    await fetch('/api/chat/delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ sessionId: sid }),
    });
    if (sid === sessionId) {
      sessionId = '';
      sessionStorage.removeItem('chatSessionId');
      document.getElementById('chatMessages').classList.remove('open');
      document.getElementById('chatMessages').innerHTML = '';
    }
  } catch {}
  const isArchivedView = document.getElementById('sidebar')?.dataset.mode === 'archived';
  if (isArchivedView) fetchArchivedSessions();
  else await refreshSidebarSessions();
}

function toggleArchivedView() {
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

function updatePlusButton() {
  const model = availableModels.find(m => m.id === selectedModelId);
  const plusBtn = document.getElementById('plusBtn');
  if (!plusBtn) return;
  if (model && model.multimodal) {
    plusBtn.style.display = '';
  } else {
    plusBtn.style.display = 'none';
    const menu = document.querySelector('.plus-menu');
    if (menu) menu.classList.remove('open');
    plusBtn.classList.remove('open');
    clearAttachments();
  }
  // Sync dropdowns
  const topSelect = document.getElementById('topBarModelSelect');
  if (topSelect && selectedModelId) topSelect.value = selectedModelId;
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

/* ── Modo chat / examen ── */
let currentMode = 'chat';

function setMode(mode) {
  currentMode = mode;
  const examActive = mode === 'exam';
  document.body.classList.toggle('exam-mode', examActive);

  const toggleBtn = document.getElementById('modeToggleBtn');
  toggleBtn.classList.toggle('exam-active', examActive);
  toggleBtn.textContent = examActive ? t('switchToChat') : t('switchToExam');

  document.getElementById('sidebarNewChatLabel').textContent = examActive ? t('newExam') : t('newChat');
}

function populateTopBarModels() {
  const topSelect = document.getElementById('topBarModelSelect');
  if (!topSelect) return;
  // Repobla siempre (idempotente) — antes se marcaba "ya poblado" en la
  // primera llamada aunque availableModels siguiera vacío por una carga
  // lenta/fallida, y el selector se quedaba vacío hasta recargar la página.
  topSelect.innerHTML = '';
  availableModels.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    topSelect.appendChild(opt);
  });
  if (selectedModelId) topSelect.value = selectedModelId;
  updatePlusButton();

  if (!topSelect._changeWired) {
    topSelect._changeWired = true;
    topSelect.addEventListener('change', () => {
      selectedModelId = topSelect.value;
      updatePlusButton();
      updateSessionInfo();
    });
  }
}

function newChat() {
  document.getElementById('chatMessages').classList.remove('open');
  document.getElementById('chatMessages').innerHTML = '';
  document.getElementById('contextPanel').classList.remove('open');
  document.querySelector('.page-content').classList.remove('panel-open');

  sessionId = crypto.randomUUID();
  sessionStorage.setItem('chatSessionId', sessionId);
  setChatTitleRaw(t('newChatTitle'));

  document.getElementById('chatMessages').classList.add('open');
  sessionState.chatCreated = formatTime();
  addMessage(t('tutorGreeting'), 'ai');
  updateSessionInfo();
  refreshSidebarSessions();
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

// Construye el input de chat en el bottom-bar y arranca todas las interacciones.
function setupChatInput() {
  const bar = document.querySelector('.bottom-bar');

  bar.innerHTML = `
    <div class="chat-input-wrapper">
      <div class="slash-menu hidden" id="slashMenu"></div>
      <div class="chat-input-inner" id="chatInputInner">
        <div class="input-resize-handle"></div>
        <div class="reexplicar-bar hidden" id="reexplicarBar">
          <div class="reexplicar-header">
            <span>${escapeHtml(t('reexplainModeLabel'))}</span>
            <button class="reexplicar-close" id="reexplicarClose" type="button">&times;</button>
          </div>
          <div class="reexplicar-suggestions" id="reexplicarSuggestions"></div>
        </div>
        <textarea id="messageInput" placeholder="${escapeHtml(t('messagePlaceholder'))}" rows="1"></textarea>
        <div id="chatLinksList"></div>
        <div class="link-mode-bar" id="linkModeBar">
          <span>${escapeHtml(t('linkModePlaceholder'))}</span>
          <button class="link-mode-close" id="linkModeClose">&times;</button>
        </div>
      </div>
      <div class="chat-input-actions" id="chatInputActions">
        <button id="plusBtn">+</button>
        <button id="sendBtn"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg></button>
        <div class="plus-menu" id="plusMenu">
          <button class="plus-menu-item" data-action="image">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
            <span>${escapeHtml(t('plusMenuImage'))}</span>
          </button>
          <button class="plus-menu-item" data-action="link">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/></svg>
            <span>${escapeHtml(t('plusMenuLink'))}</span>
          </button>
          <button class="plus-menu-item" data-action="file">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/></svg>
            <span>${escapeHtml(t('plusMenuDocument'))}</span>
          </button>
          <button class="plus-menu-item" data-action="camera">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z"/><circle cx="12" cy="13" r="3"/></svg>
            <span>${escapeHtml(t('plusMenuCamera'))}</span>
          </button>
        </div>
      </div>
    </div>
  `;

  requestAnimationFrame(() => {
    document.getElementById('messageInput').style.opacity = '1';
    document.getElementById('plusBtn').style.opacity = '1';
    document.getElementById('sendBtn').style.opacity = '1';
  });

  populateTopBarModels(); // best-effort inmediato, no bloquea el input por la red
  modelsPromise.then(populateTopBarModels); // repuebla cuando (re)llegue de verdad

  document.getElementById('reexplicarClose').addEventListener('click', () => exitReExplicarMode());

  const plusBtn = document.getElementById('plusBtn');
  const plusMenu = document.getElementById('plusMenu');
  const linkModeBar = document.getElementById('linkModeBar');
  const chatLinksList = document.getElementById('chatLinksList');
  linkModeBar.style.display = 'none';

  function closePlusMenu() {
    plusMenu.classList.remove('open');
    plusBtn.classList.remove('open');
  }

  function togglePlusMenu() {
    const isOpen = plusMenu.classList.toggle('open');
    plusBtn.classList.toggle('open', isOpen);
  }

  function renderLinksList() {
    if (!chatLinksList) return;
    if (activeLinks.length === 0) {
      chatLinksList.innerHTML = '';
      chatLinksList.style.display = 'none';
      return;
    }
    chatLinksList.style.display = 'flex';
    chatLinksList.innerHTML = activeLinks.map((link, i) =>
      `<span class="link-chip">${escapeHtml(link)}<button class="link-chip-remove" data-index="${i}">&times;</button></span>`
    ).join('');
    chatLinksList.querySelectorAll('.link-chip-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index);
        activeLinks.splice(idx, 1);
        renderLinksList();
      });
    });
  }

  plusBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (linkModeActive) {
      exitLinkMode();
    }
    togglePlusMenu();
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.chat-input-wrapper') && !e.target.closest('.plus-menu')) {
      closePlusMenu();
    }
    if (linkModeActive && !e.target.closest('.bottom-bar')) {
      exitLinkMode();
    }
    if (slashMenuActive && !e.target.closest('.chat-input-wrapper')) {
      closeSlashMenu();
    }
  });

  function exitLinkMode() {
    linkModeActive = false;
    linkModeBar.style.display = 'none';
    const inp = document.getElementById('messageInput');
    if (inp) inp.placeholder = t('messagePlaceholder');
  }

  function enterLinkMode() {
    linkModeActive = true;
    linkModeBar.querySelector('span').textContent = t('linkModePlaceholder');
    linkModeBar.style.display = 'flex';
    renderLinksList();
    const inp = document.getElementById('messageInput');
    if (inp) {
      inp.placeholder = 'https://ejemplo.com';
      inp.focus();
    }
  }

  document.getElementById('linkModeClose').addEventListener('click', (e) => {
    e.stopPropagation();
    exitLinkMode();
  });

  // Hidden file inputs
  const imageInput = document.createElement('input');
  imageInput.type = 'file';
  imageInput.accept = 'image/*';
  imageInput.multiple = true;
  imageInput.style.display = 'none';
  imageInput.id = 'imageInput';
  bar.appendChild(imageInput);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.txt,.pdf,.json';
  fileInput.multiple = true;
  fileInput.style.display = 'none';
  fileInput.id = 'fileInput';
  bar.appendChild(fileInput);

  plusMenu.addEventListener('click', (e) => {
    const item = e.target.closest('.plus-menu-item');
    if (!item) return;
    const action = item.dataset.action;
    closePlusMenu();

    switch (action) {
      case 'image':
        imageInput.click();
        break;
      case 'link':
        enterLinkMode();
        break;
      case 'file':
        fileInput.click();
        break;
      case 'camera':
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          navigator.mediaDevices.getUserMedia({ video: true })
            .then((stream) => {
              stream.getTracks().forEach(t => t.stop());
            })
            .catch(() => {});
        }
        break;
    }
  });

  imageInput.addEventListener('change', () => {
    for (const file of imageInput.files) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const data = e.target.result.split(',')[1];
        const att = { type: 'image', mime: file.type, data, name: file.name };
        pendingAttachments.push(att);
        renderAttachmentPreviews();
      };
      reader.readAsDataURL(file);
    }
    imageInput.value = '';
  });

  fileInput.addEventListener('change', () => {
    for (const file of fileInput.files) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const data = e.target.result.split(',')[1];
        const att = { type: 'file', mime: file.type, data, name: file.name };
        pendingAttachments.push(att);
        renderAttachmentPreviews();
      };
      reader.readAsDataURL(file);
    }
    fileInput.value = '';
  });

  // Arrastrar y soltar: archivos/imágenes locales se adjuntan completos;
  // contenido arrastrado desde otra página web (sin archivo real, solo URL)
  // se agrega al menú de enlaces en vez de intentar adjuntarlo.
  const chatInputWrapper = document.querySelector('.chat-input-wrapper');
  ['dragenter', 'dragover'].forEach(evt => {
    chatInputWrapper.addEventListener(evt, (e) => {
      e.preventDefault();
      chatInputWrapper.classList.add('drag-over');
    });
  });
  ['dragleave', 'drop'].forEach(evt => {
    chatInputWrapper.addEventListener(evt, () => {
      chatInputWrapper.classList.remove('drag-over');
    });
  });
  chatInputWrapper.addEventListener('drop', (e) => {
    e.preventDefault();

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      for (const file of e.dataTransfer.files) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const data = ev.target.result.split(',')[1];
          const type = file.type.startsWith('image/') ? 'image' : 'file';
          pendingAttachments.push({ type, mime: file.type, data, name: file.name });
          renderAttachmentPreviews();
        };
        reader.readAsDataURL(file);
      }
      return;
    }

    // Arrastrado desde otra web (imagen o link) — viene como URL, no archivo.
    const draggedUrl = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (draggedUrl && /^https?:\/\//i.test(draggedUrl) && !activeLinks.includes(draggedUrl)) {
      activeLinks.push(draggedUrl);
      renderLinksList();
    }
  });

  document.getElementById('sendBtn').addEventListener('click', handleSend);
  const msgInput = document.getElementById('messageInput');

  msgInput.addEventListener('input', () => updateSlashMenu(msgInput.value));

  msgInput.addEventListener('keydown', (e) => {
    if (slashMenuActive) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        slashMenuIndex = (slashMenuIndex + 1) % slashMenuMatches.length;
        renderSlashMenu();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        slashMenuIndex = (slashMenuIndex - 1 + slashMenuMatches.length) % slashMenuMatches.length;
        renderSlashMenu();
        return;
      }
      if (e.key === 'Tab' || e.key === 'ArrowRight') {
        e.preventDefault();
        completeSlashCommand();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closeSlashMenu();
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        selectSlashCommand(slashMenuMatches[slashMenuIndex]);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (linkModeActive) {
        const url = msgInput.value.trim();
        if (url) {
          if (activeLinks.includes(url)) {
            const label = linkModeBar.querySelector('span');
            label.textContent = t('linkAlreadyAdded');
            msgInput.value = '';
            setTimeout(() => {
              label.textContent = t('linkModePlaceholder');
            }, 1500);
          } else {
            activeLinks.push(url);
            msgInput.value = '';
            renderLinksList();
            const label = linkModeBar.querySelector('span');
            label.textContent = t('linkModePlaceholder');
          }
        }
      } else {
        handleSend();
      }
    }
  });

  // Scroll: si el input tiene focus, el scroll se queda en el input, no en el chat
  msgInput.addEventListener('wheel', (e) => {
    if (document.activeElement !== msgInput) return;
    if (msgInput.scrollHeight > msgInput.clientHeight) {
      const atTop = msgInput.scrollTop === 0;
      const atBottom = msgInput.scrollTop + msgInput.clientHeight >= msgInput.scrollHeight;
      if ((e.deltaY < 0 && atTop) || (e.deltaY > 0 && atBottom)) return;
      e.stopPropagation();
    }
  });

  function getMaxInputHeight() {
    const topBar = document.getElementById('topBar');
    const topBarBottom = topBar ? topBar.getBoundingClientRect().bottom : 72;
    const barRect = bar.getBoundingClientRect();
    const barContentBottom = barRect.bottom - 16;
    const inner = document.getElementById('chatInputInner');
    const innerPad = parseFloat(getComputedStyle(inner).paddingTop) +
                     parseFloat(getComputedStyle(inner).paddingBottom);
    return Math.max(28, barContentBottom - topBarBottom - innerPad - 4);
  }

  msgInput.addEventListener('input', () => {
    msgInput.style.height = 'auto';
    const userMin = parseInt(msgInput.dataset.userMinHeight) || 0;
    const maxH = getMaxInputHeight();
    msgInput.style.height = Math.min(Math.max(msgInput.scrollHeight, userMin), maxH) + 'px';
    if (msgInput.scrollHeight > maxH) msgInput.style.overflowY = 'auto';
  });

  // Focus en input → expande con animación
  msgInput.addEventListener('focus', () => {
    const inner = document.getElementById('chatInputInner');
    const prev = parseInt(inner.dataset.prevHeight) || 0;
    if (prev > 44) {
      inner.style.transition = 'height 300ms ease';
      inner.style.height = inner.offsetHeight + 'px';
      void inner.offsetHeight;
      inner.style.height = prev + 'px';
      const onEnd = () => {
        inner.classList.remove('shrunken');
        inner.style.transition = '';
        inner.style.height = '';
        delete inner.dataset.prevHeight;
        inner.removeEventListener('transitionend', onEnd);
      };
      inner.addEventListener('transitionend', onEnd, { once: true });
    } else {
      inner.classList.remove('shrunken');
      inner.style.transition = '';
      inner.style.height = '';
      msgInput.style.height = 'auto';
      const userMin = parseInt(msgInput.dataset.userMinHeight) || 0;
      const maxH = getMaxInputHeight();
      const h = msgInput.scrollHeight;
      msgInput.style.height = Math.min(Math.max(h, userMin), maxH) + 'px';
    }
  });

  // Resize handle drag
  const handle = document.querySelector('.input-resize-handle');
  let dragStartY, dragStartHeight;
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dragStartY = e.clientY;
    dragStartHeight = msgInput.offsetHeight;
    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup', onDragEnd, { once: true });
  });
  function onDrag(e) {
    const delta = dragStartY - e.clientY;
    const maxH = getMaxInputHeight();
    const newH = Math.max(28, Math.min(dragStartHeight + delta, maxH));
    msgInput.style.height = newH + 'px';
    msgInput.dataset.userMinHeight = newH;
    msgInput.style.overflowY = 'auto';
  }
  function onDragEnd() {
    document.removeEventListener('mousemove', onDrag);
  }

  document.getElementById('chatMessages').classList.add('open');
  if (!sessionState.chatCreated) {
    sessionState.chatCreated = formatTime();
  }
  // Al entrar a la página siempre arranca en "new" (hero) — el historial de
  // la última sesión solo se retoma si el usuario lo abre a propósito desde
  // el sidebar (loadSession), no automáticamente al cargar/navegar aquí.
  initHeroView();
}

// ── Hero (reemplaza a welcome.html) — se muestra solo si la sesión está vacía ──

async function initHeroView() {
  document.getElementById('pageContent').classList.add('hero-active');

  // El hero siempre representa un chat todavía sin crear — genera un
  // sessionId nuevo aquí (mismo patrón que newChat()) para no arrastrar el
  // de la sesión anterior que quedó en sessionStorage.
  sessionId = crypto.randomUUID();
  sessionStorage.setItem('chatSessionId', sessionId);
  setChatTitleRaw(t('newChatTitle'));

  // El ancho final de la fila depende de si hay chip de nombre o no — hay
  // que esperar a que ese layout esté resuelto en el DOM ANTES de revelar
  // "Hola,". Si se revela antes, se ve centrado solo y luego salta de golpe
  // en cuanto el chip entra al flujo (display:none → inline-flex).
  try {
    const res = await fetch('/api/user/profile', { credentials: 'same-origin' });
    if (res.ok) {
      const data = await res.json();
      const u = data.user || data;
      renderHeroNameChip(u.username || '');
    }
  } catch {}

  // Fade-in escalonado: "Hola," primero, el nombre unos ms después — recién
  // ahora, con el layout final ya en el DOM (aunque todavía en opacity:0).
  // Doble rAF: un solo rAF puede caer en el mismo frame que ese render y el
  // navegador nunca pinta el estado de partida, la transición no se vería.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.getElementById('heroLine1')?.classList.add('visible');
    });
  });

  const heroInput = document.getElementById('heroAskInput');
  const heroSend = document.getElementById('heroAskSend');
  heroSend.addEventListener('click', submitHeroAsk);
  heroInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitHeroAsk(); });
  heroInput.focus();
}

function renderHeroNameChip(initialName) {
  const chip = document.getElementById('nameChip');
  const btn = document.getElementById('nameChipBtn');
  const input = document.getElementById('nameChipInput');
  const plus = document.getElementById('nameChipPlus');
  if (!chip) return;

  let name = initialName || '';
  btn.textContent = name || t('addName');
  chip.classList.remove('hidden');
  chip.classList.toggle('has-name', !!name);
  plus.classList.toggle('hidden', !!name);
  // Aparece un poco después que "Hola," (fade-in escalonado).
  chip.classList.remove('chip-in');
  setTimeout(() => chip.classList.add('chip-in'), 250);

  // Ancho del texto ya escrito, para hacer crecer el input al tipear.
  function measureTextWidth(text) {
    const canvas = measureTextWidth._canvas || (measureTextWidth._canvas = document.createElement('canvas'));
    const ctx = canvas.getContext('2d');
    ctx.font = getComputedStyle(input).font;
    return ctx.measureText(text || ' ').width;
  }

  function growToFitContent() {
    const width = measureTextWidth(input.value) + 24; // + padding/cursor breathing room
    input.style.width = Math.max(width, input._baseWidth) + 'px';
  }

  function startEditing() {
    input.value = name;
    const rect = btn.getBoundingClientRect();
    // El input pasa a position:fixed anclado al lugar exacto del botón —
    // así crece solo hacia la derecha (sin límite) sin mover nada verticalmente.
    // Pero eso lo saca del flujo del chip — sin fijar el ancho del chip,
    // "Hola," se recentraba al perder ese espacio reservado.
    chip.style.width = chip.getBoundingClientRect().width + 'px';
    input._baseWidth = rect.width;
    input.style.position = 'fixed';
    input.style.left = rect.left + 'px';
    input.style.top = rect.top + 'px';
    input.style.width = rect.width + 'px';
    btn.classList.add('hidden');
    input.classList.remove('hidden');
    input.focus();
    growToFitContent();
  }

  async function saveName() {
    const value = input.value.trim();
    input.classList.add('hidden');
    input.style.position = '';
    input.style.left = '';
    input.style.top = '';
    input.style.width = '';
    chip.style.width = '';
    btn.classList.remove('hidden');
    if (!value || value === name) return;
    name = value;
    btn.textContent = name;
    chip.classList.add('has-name');
    plus.classList.add('hidden');
    try {
      await fetch('/api/user/username', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ username: name }),
      });
    } catch {}
  }

  btn.addEventListener('click', startEditing);
  input.addEventListener('input', growToFitContent);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  input.addEventListener('blur', saveName);
}

function submitHeroAsk() {
  const heroInput = document.getElementById('heroAskInput');
  const text = heroInput.value.trim();
  playHeroToChatMorph(() => {
    document.getElementById('pageContent').classList.remove('hero-active');
    document.getElementById('chatMessages').classList.add('open');
    if (text) {
      const msgInput = document.getElementById('messageInput');
      msgInput.value = text;
      handleSend();
    } else {
      addMessage(t('tutorGreeting'), 'ai');
    }
  });
}

// Anima el input del hero "viajando" hasta la posición real del input del
// chat — todo dentro de la misma página (sin recarga, a diferencia de la
// versión anterior que usaba sessionStorage para cruzar welcome.html → chat.html).
const MORPH_MS = 500;
const MORPH_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

function playHeroToChatMorph(onComplete) {
  const heroBar = document.getElementById('heroAskBar');
  const heroView = document.getElementById('heroView');
  const wrapper = document.querySelector('.chat-input-wrapper');
  const bottomBar = document.getElementById('bottomBar');
  if (!heroBar || !wrapper) { onComplete(); return; }

  // Medir posiciones reales ANTES de tocar el bottom-bar (visibility:hidden
  // no altera el layout, así que toRect ya es su posición natural final).
  const fromRect = heroBar.getBoundingClientRect();
  const toRect = wrapper.getBoundingClientRect();

  heroView.style.transition = 'opacity 250ms ease';
  heroView.style.opacity = '0';

  // El navbar inferior arranca oculto debajo de la pantalla y sube en sync
  // con el clon, para que ambos lleguen a su posición final al mismo tiempo.
  if (bottomBar) {
    bottomBar.style.transition = 'none';
    bottomBar.style.visibility = 'visible';
    bottomBar.style.pointerEvents = 'none';
    bottomBar.style.transform = 'translateY(100%)';
    void bottomBar.offsetHeight; // fuerza reflow antes de animar
    bottomBar.style.transition = `transform ${MORPH_MS}ms ${MORPH_EASE}`;
  }

  const clone = document.createElement('div');
  clone.className = 'ask-morph-clone';
  clone.style.top = `${fromRect.top}px`;
  clone.style.left = `${fromRect.left}px`;
  clone.style.width = `${fromRect.width}px`;
  clone.style.height = `${fromRect.height}px`;
  document.body.appendChild(clone);

  void clone.offsetHeight; // fuerza reflow antes de animar
  clone.style.transition = `top ${MORPH_MS}ms ${MORPH_EASE}, left ${MORPH_MS}ms ${MORPH_EASE}, width ${MORPH_MS}ms ${MORPH_EASE}, height ${MORPH_MS}ms ${MORPH_EASE}, opacity 250ms ease 300ms`;
  requestAnimationFrame(() => {
    clone.style.top = `${toRect.top}px`;
    clone.style.left = `${toRect.left}px`;
    clone.style.width = `${toRect.width}px`;
    clone.style.height = `${toRect.height}px`;
    clone.style.opacity = '0';
    if (bottomBar) bottomBar.style.transform = 'translateY(0)';
  });

  clone.addEventListener('transitionend', function onDone(e) {
    if (e.propertyName !== 'opacity') return;
    clone.removeEventListener('transitionend', onDone);
    clone.remove();
    heroView.style.display = 'none';
    if (bottomBar) {
      bottomBar.style.transform = '';
      bottomBar.style.transition = '';
      bottomBar.style.visibility = '';
      bottomBar.style.pointerEvents = '';
    }
    onComplete();
  });
}

const QUIZ_MARKERS = ['[[QUIZ_DETECTED]]', '[[QUIZ_EXPLAIN_DONE]]'];

function stripQuizMarker(text) {
  for (const marker of QUIZ_MARKERS) {
    if (text.includes(marker)) {
      return { text: text.replace(marker, '').trimEnd(), marker: marker.slice(2, -2) };
    }
  }
  return { text, marker: null };
}

// Plan 07 — orden/énfasis según el goal del perfil (viaja en el evento SSE
// 'done' como quizGoal, ver chat.streaming.service.ts): examenes → Responder
// primero y destacado; entender → Explicar primero y destacado. Otros goals
// o sin perfil → orden actual, sin cambios. Ambos botones SIEMPRE disponibles,
// esto es solo orden/énfasis visual, nunca oculta ninguno.
function appendQuizButtons(actions, msgRow, quizGoal) {
  const responderBtn = document.createElement('button');
  responderBtn.className = 'msg-action msg-action-quiz msg-action-quiz-responder';
  responderBtn.textContent = t('respondBtn');
  responderBtn.addEventListener('click', () => handleQuizResolve(msgRow));

  const explicarBtn = document.createElement('button');
  explicarBtn.className = 'msg-action msg-action-quiz msg-action-quiz-explicar';
  explicarBtn.textContent = t('explainBtn');
  explicarBtn.addEventListener('click', () => handleQuizExplain());

  if (quizGoal === 'entender') {
    explicarBtn.classList.add('msg-action-quiz-preferred');
    actions.appendChild(explicarBtn);
    actions.appendChild(responderBtn);
  } else {
    if (quizGoal === 'examenes') responderBtn.classList.add('msg-action-quiz-preferred');
    actions.appendChild(responderBtn);
    actions.appendChild(explicarBtn);
  }
}

// Modo "Explicar": mientras está activo, cada mensaje de IA subsecuente
// (que no sea el que trae [[QUIZ_EXPLAIN_DONE]]) recibe un botón "Siguiente
// paso" que pide el próximo ejercicio.
let quizExplainActive = false;

function appendNextStepButton(actions, quizMarker) {
  if (!quizExplainActive || quizMarker === 'QUIZ_EXPLAIN_DONE') return;
  const nextStepBtn = document.createElement('button');
  nextStepBtn.className = 'msg-action msg-action-quiz';
  nextStepBtn.textContent = t('nextStepBtn');
  nextStepBtn.addEventListener('click', () => handleQuizNextStep());
  actions.appendChild(nextStepBtn);
}

export function addMessage(text, sender, attachments, msgId, isPinned) {
  const chatMessages = document.getElementById('chatMessages');

  const msgRow = document.createElement('div');
  msgRow.className = `msg-row msg-${sender}`;
  msgRow.dataset.sender = sender;
  if (msgId) msgRow.dataset.msgId = msgId;
  if (isPinned) msgRow.dataset.pinned = 'true';

  // Attachments above the bubble (outside)
  if (attachments && attachments.length > 0) {
    const attContainer = document.createElement('div');
    attContainer.className = 'msg-attachments';
    attachments.forEach(att => {
      const attEl = document.createElement('div');
      attEl.className = 'msg-attachment';
      const dataUrl = `data:${att.mime};base64,${att.data}`;
      if (att.type === 'image') {
        const img = document.createElement('img');
        img.className = 'att-thumb';
        img.src = dataUrl;
        img.alt = att.name || 'image';
        img.loading = 'lazy';
        img.addEventListener('click', (e) => openLightbox(dataUrl, att.name || 'image', img));
        attEl.appendChild(img);
      } else if (att.type === 'audio') {
        const aud = document.createElement('audio');
        aud.className = 'att-audio';
        aud.src = dataUrl;
        aud.controls = true;
        attEl.appendChild(aud);
      }
      attContainer.appendChild(attEl);
    });
    msgRow.appendChild(attContainer);
  }

  // Message bubble
  const bubble = document.createElement('div');
  bubble.classList.add(sender === 'user' ? 'bubble-user' : 'bubble-ai');

  let quizMarker = null;
  if (sender === 'ai') {
    const stripped = stripQuizMarker(text);
    text = stripped.text;
    quizMarker = stripped.marker;
  }

  const textDiv = document.createElement('div');
  textDiv.className = 'bubble-text';
  if (sender === 'ai') {
    textDiv.innerHTML = formatAIResponse(text);
  } else {
    textDiv.textContent = text;
  }
  bubble.appendChild(textDiv);

  // Footer: time left + actions right, below bubble
  const footer = document.createElement('div');
  footer.className = 'msg-footer';

  const timeSpan = document.createElement('span');
  timeSpan.className = 'msg-time';
  timeSpan.textContent = formatTime();

  const actions = document.createElement('div');
  actions.className = 'msg-actions';

  const copyBtn = document.createElement('button');
  copyBtn.className = 'msg-action';
  copyBtn.title = t('copy');
  copyBtn.innerHTML = svgIcon('copy');
  copyBtn.addEventListener('click', () => handleCopy(text, copyBtn));
  actions.appendChild(copyBtn);

  const pinBtn = document.createElement('button');
  pinBtn.className = 'msg-action';
  pinBtn.title = isPinned ? t('unpinMessage') : t('pinMessage');
  pinBtn.innerHTML = svgIcon(isPinned ? 'pinFilled' : 'pin');
  pinBtn.addEventListener('click', () => togglePinMessage(msgRow, pinBtn));
  actions.appendChild(pinBtn);

  if (sender === 'user') {
    const editBtn = document.createElement('button');
    editBtn.className = 'msg-action';
    editBtn.title = t('edit');
    editBtn.innerHTML = svgIcon('edit');
    editBtn.addEventListener('click', () => handleEdit(msgRow));
    actions.appendChild(editBtn);

    const retryBtn = document.createElement('button');
    retryBtn.className = 'msg-action';
    retryBtn.title = t('retry');
    retryBtn.innerHTML = svgIcon('retry');
    retryBtn.addEventListener('click', () => handleRetry(msgRow));
    actions.appendChild(retryBtn);
  } else {
    const reportBtn = document.createElement('button');
    reportBtn.className = 'msg-action';
    reportBtn.title = t('report');
    reportBtn.innerHTML = svgIcon('flag');
    reportBtn.dataset.reported = 'false';
    reportBtn.addEventListener('click', () => handleReport(text, msgRow, reportBtn));
    actions.appendChild(reportBtn);

    const reexplainBtn = document.createElement('button');
    reexplainBtn.className = 'msg-action';
    reexplainBtn.title = t('reexplain');
    reexplainBtn.innerHTML = svgIcon('retry');
    reexplainBtn.addEventListener('click', () => openReExplicarConfirm(msgRow));
    actions.appendChild(reexplainBtn);

    if (quizMarker === 'QUIZ_DETECTED') {
      appendQuizButtons(actions, msgRow);
    }

    appendNextStepButton(actions, quizMarker);

    if (quizMarker === 'QUIZ_EXPLAIN_DONE') {
      handleQuizExplainDone();
    }
  }

  footer.appendChild(timeSpan);
  footer.appendChild(actions);

  msgRow.appendChild(bubble);
  msgRow.appendChild(footer);

  // Animation
  msgRow.style.opacity = '0';
  msgRow.style.transform = 'translateY(8px)';
  msgRow.style.transition = 'opacity 250ms ease, transform 250ms ease';
  chatMessages.prepend(msgRow);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      msgRow.style.opacity = '1';
      msgRow.style.transform = 'translateY(0)';
    });
  });

  chatMessages.scrollTop = 0;

  if (sender === 'ai') {
    renderKaTeX();
  }
}

function showTyping() {
  const chatMessages = document.getElementById('chatMessages');
  // Envuelto en .msg-row.msg-ai (mismo patrón que las burbujas reales) para
  // heredar el ancho centrado de 780px en vez de pegarse al borde izquierdo.
  const row = document.createElement('div');
  row.className = 'msg-row msg-ai';
  row.id = 'typingIndicator';
  const typing = document.createElement('div');
  typing.className = 'typing-indicator';
  typing.innerHTML = '<span></span><span></span><span></span>';
  row.appendChild(typing);
  row.style.opacity = '0';
  row.style.transform = 'translateY(8px)';
  row.style.transition = 'opacity 250ms ease, transform 250ms ease';
  chatMessages.prepend(row);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      row.style.opacity = '1';
      row.style.transform = 'translateY(0)';
    });
  });

  chatMessages.scrollTop = 0;
}

export function hideTyping() {
  const typing = document.getElementById('typingIndicator');
  if (typing) typing.remove();
}

function renderAttachmentPreviews() {
  let container = document.getElementById('attachmentPreviews');
  if (!container) {
    container = document.createElement('div');
    container.id = 'attachmentPreviews';
    // Dentro de .chat-input-inner (la burbuja del input), no como hermano de
    // .chat-input-wrapper — así la preview queda dentro del chat, no a un lado.
    const inner = document.getElementById('chatInputInner');
    if (inner) {
      inner.insertBefore(container, inner.firstChild);
    } else {
      document.querySelector('.bottom-bar').insertBefore(container, document.querySelector('.bar-actions'));
    }
  }
  container.innerHTML = '';
  pendingAttachments.forEach((att, i) => {
    const chip = document.createElement('div');
    chip.className = 'att-chip';
    if (att.type === 'image') {
      chip.innerHTML = `
        <img class="att-chip-preview" src="data:${att.mime};base64,${att.data}" />
        <span class="att-remove" data-index="${i}">×</span>`;
    } else if (att.type === 'file') {
      chip.innerHTML = `
        <span class="att-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/></svg>
        </span>
        <span class="att-name">${att.name || 'documento'}</span>
        <span class="att-remove" data-index="${i}">×</span>`;
    } else {
      chip.innerHTML = `
        <span class="att-icon">🎵</span>
        <span class="att-name">${att.name || 'audio'}</span>
        <span class="att-remove" data-index="${i}">×</span>`;
    }
    chip.querySelector('.att-remove').addEventListener('click', () => {
      pendingAttachments.splice(i, 1);
      renderAttachmentPreviews();
    });
    container.appendChild(chip);
  });
}

function openLightbox(src, name, triggerImg) {
  const r = triggerImg.getBoundingClientRect();
  const w = r.width;
  const h = r.height;

  const overlay = document.createElement('div');
  overlay.className = 'lightbox';

  const fly = document.createElement('div');
  fly.className = 'lightbox-fly';
  fly.style.cssText = `
    position: fixed;
    left:${r.left}px; top:${r.top}px;
    width:${w}px; height:${h}px;
    background:url("${src}") center / contain no-repeat;
    border-radius:8px; z-index:10000;
    transform-origin:0 0;
    transition:transform 250ms cubic-bezier(0.2,0,0,1), border-radius 200ms ease, box-shadow 250ms ease;
    will-change:transform; cursor:default;
  `;

  const label = document.createElement('span');
  label.className = 'lightbox-name';
  label.textContent = name;
  label.style.cssText = `
    position:fixed; bottom:2rem; left:50%; transform:translateX(-50%);
    color:rgba(255,255,255,0.65); font-size:0.8rem; z-index:10000;
    opacity:0; transition:opacity 200ms ease; pointer-events:none;
  `;

  overlay.appendChild(fly);
  overlay.appendChild(label);
  document.body.appendChild(overlay);

  const s = Math.min((window.innerWidth * 0.85) / w, (window.innerHeight * 0.8) / h, 3);
  const dx = (window.innerWidth - w * s) / 2 - r.left;
  const dy = (window.innerHeight - h * s) / 2 - r.top;

  void fly.offsetHeight;

  requestAnimationFrame(() => {
    overlay.style.transition = 'background 250ms ease';
    overlay.style.background = 'rgba(0,0,0,0.88)';
    fly.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`;
    fly.style.boxShadow = '0 4px 30px rgba(0,0,0,0.5)';
    label.style.opacity = '1';
  });

  overlay.addEventListener('click', () => {
    label.style.opacity = '0';
    fly.style.transform = 'translate(0,0) scale(1)';
    fly.style.boxShadow = 'none';
    overlay.style.background = 'rgba(0,0,0,0)';
    setTimeout(() => overlay.remove(), 280);
  });
}

function clearAttachments() {
  pendingAttachments = [];
  activeLinks = [];
  const container = document.getElementById('attachmentPreviews');
  if (container) container.innerHTML = '';
  const linksList = document.getElementById('chatLinksList');
  if (linksList) { linksList.innerHTML = ''; linksList.style.display = 'none'; }
}

function handleCopy(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    btn.innerHTML = svgIcon('check');
    setTimeout(() => {
      btn.innerHTML = svgIcon('copy');
    }, 1500);
  });
}

function handleEdit(msgRow) {
  const bubble = msgRow.querySelector('.bubble-user, .bubble-ai');
  if (!bubble) return;
  const textDiv = bubble.querySelector('.bubble-text');
  if (!textDiv) return;
  const currentText = textDiv.textContent;
  const textarea = document.createElement('textarea');
  textarea.value = currentText;
  textarea.className = 'edit-textarea';
  textarea.style.cssText = 'width:100%;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.2);color:#fff;border-radius:8px;padding:0.5rem 0.6rem;resize:none;font-family:inherit;font-size:0.85rem;line-height:1.5;outline:none;box-sizing:border-box;';
  textarea.rows = 3;
  textDiv.replaceWith(textarea);
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);

  function saveEdit() {
    const newDiv = document.createElement('div');
    newDiv.className = 'bubble-text';
    newDiv.textContent = textarea.value;
    textarea.replaceWith(newDiv);
    handleRetry(msgRow);
  }

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      saveEdit();
    }
  });
  textarea.addEventListener('blur', saveEdit);
}

function handleRetry(msgRow) {
  const bubble = msgRow.querySelector('.bubble-user');
  if (!bubble) return;
  const textDiv = bubble.querySelector('.bubble-text');
  if (!textDiv) return;
  const text = textDiv.textContent;
  msgRow.remove();
  document.getElementById('messageInput').value = text;
  handleSend();
}

// ── Menú de comandos slash (tipo Claude Code CLI) ──

function updateSlashMenu(text) {
  const menu = document.getElementById('slashMenu');
  if (!menu) return;
  if (!text.startsWith('/') || text.includes(' ')) { closeSlashMenu(); return; }
  const lower = text.toLowerCase();
  slashMenuMatches = SLASH_COMMANDS.filter(c => c.aliases.some(a => a.startsWith(lower)));
  if (slashMenuMatches.length === 0) { closeSlashMenu(); return; }
  slashMenuActive = true;
  slashMenuIndex = Math.min(slashMenuIndex, slashMenuMatches.length - 1);
  renderSlashMenu();
  menu.classList.remove('hidden');
}

function renderSlashMenu() {
  const menu = document.getElementById('slashMenu');
  if (!menu) return;
  menu.innerHTML = slashMenuMatches.map((c, i) => `
    <div class="slash-item ${i === slashMenuIndex ? 'active' : ''}" data-index="${i}">
      <span class="slash-item-cmd">${c.primary}</span>
      <span class="slash-item-desc">${escapeHtml(t(c.descKey))}</span>
    </div>
  `).join('');
  menu.querySelectorAll('.slash-item').forEach(el => {
    el.addEventListener('mouseenter', () => {
      slashMenuIndex = parseInt(el.dataset.index, 10);
      renderSlashMenu();
    });
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      selectSlashCommand(slashMenuMatches[parseInt(el.dataset.index, 10)]);
    });
  });
}

function closeSlashMenu() {
  slashMenuActive = false;
  slashMenuMatches = [];
  slashMenuIndex = 0;
  const menu = document.getElementById('slashMenu');
  if (menu) menu.classList.add('hidden');
}

function completeSlashCommand() {
  if (!slashMenuActive) return;
  const input = document.getElementById('messageInput');
  const cmd = slashMenuMatches[slashMenuIndex];
  input.value = cmd.primary;
  updateSlashMenu(input.value);
}

function selectSlashCommand(cmd) {
  const input = document.getElementById('messageInput');
  input.value = '';
  closeSlashMenu();
  executeSlashCommand(cmd.primary);
}

function executeSlashCommand(primary) {
  if (primary === '/help') { showHelpMessage(); return; }
  if (primary === '/resumen') { runSummaryCommand(); return; }
  if (primary === '/exportar') { runExportCommand(); return; }
}

function showHelpMessage() {
  const rows = SLASH_COMMANDS.map(c =>
    `<div class="sys-cmd-row"><span class="sys-cmd-name">${c.aliases.join(', ')}</span><span class="sys-cmd-desc">${escapeHtml(t(c.descKey))}</span></div>`
  ).join('');
  addSystemMessage(`<div class="sys-help-title">${escapeHtml(t('availableCommands'))}</div>${rows}`);
}

// Mensaje de sistema: NO es respuesta de la IA (sin botones de copiar/reportar,
// formato visual distinto — recuadro punteado, monoespaciado).
function addSystemMessage(html) {
  const chatMessages = document.getElementById('chatMessages');
  const row = document.createElement('div');
  row.className = 'msg-row msg-system';
  row.innerHTML = `<div class="bubble-system">${html}</div>`;
  row.style.opacity = '0';
  row.style.transform = 'translateY(8px)';
  row.style.transition = 'opacity 250ms ease, transform 250ms ease';
  chatMessages.prepend(row);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    row.style.opacity = '1';
    row.style.transform = 'translateY(0)';
  }));
  chatMessages.scrollTop = 0;
}

// Al terminar un stream, el turno del usuario que lo disparó no tenía id todavía
// (se generó server-side) — se lo asignamos al primer .msg-user (el más
// reciente, por el patrón prepend) para que se pueda fijar sin recargar.
function setLastUserMsgId(id) {
  if (!id) return;
  const row = document.querySelector('.msg-row.msg-user');
  if (row && !row.dataset.msgId) row.dataset.msgId = id;
}

// ── Notas rápidas (fijar mensajes) ──

async function togglePinMessage(msgRow, btn) {
  const msgId = msgRow.dataset.msgId;
  if (!msgId) return;
  const pinned = msgRow.dataset.pinned === 'true';
  try {
    await fetch(`/api/chat/${pinned ? 'unpin' : 'pin'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ messageId: msgId }),
    });
    msgRow.dataset.pinned = pinned ? 'false' : 'true';
    btn.innerHTML = svgIcon(pinned ? 'pin' : 'pinFilled');
    btn.title = pinned ? t('pinMessage') : t('unpinMessage');
    if (document.getElementById('contextPanel')?.classList.contains('open')) {
      fetchPinnedMessages().then(renderPinnedSection);
    }
  } catch {}
}

async function fetchPinnedMessages() {
  try {
    const res = await fetch('/api/chat/pinned', { credentials: 'same-origin' });
    if (!res.ok) return [];
    const data = await res.json();
    return data.messages || [];
  } catch {
    return [];
  }
}

function renderPinnedSection(pinned) {
  const list = document.getElementById('pinnedMessagesList');
  const countEl = document.getElementById('pinnedMessagesCount');
  if (!list) return;
  if (countEl) countEl.textContent = pinned.length;

  if (pinned.length === 0) {
    list.innerHTML = '<div class="raw-message-item">Todavía no has fijado ningún mensaje.</div>';
    return;
  }

  list.innerHTML = pinned.map(m => `
    <div class="raw-message-item pinned-message-item" data-msg-id="${m.id}" data-session-id="${m.session_id}">
      <span class="raw-message-role ${m.role}">${m.role === 'user' ? 'Tú' : 'Tutor'}</span>
      <span class="pinned-message-preview">${escapeHtml(m.content.slice(0, 90))}${m.content.length > 90 ? '…' : ''}</span>
    </div>
  `).join('');

  list.querySelectorAll('.pinned-message-item').forEach(el => {
    el.addEventListener('click', () => jumpToPinnedMessage(el.dataset.sessionId, el.dataset.msgId));
  });
}

async function jumpToPinnedMessage(targetSessionId, targetMsgId) {
  closeContextPanel();
  if (targetSessionId !== sessionId) {
    await loadSession(targetSessionId);
  }
  requestAnimationFrame(() => {
    const row = document.querySelector(`.msg-row[data-msg-id="${targetMsgId}"]`);
    if (!row) return;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.classList.add('jump-highlight');
    setTimeout(() => row.classList.remove('jump-highlight'), 1500);
  });
}

// División delgada y gris entre secciones del chat (ej. "Sesión compactada").
function addSessionDivider(label) {
  const chatMessages = document.getElementById('chatMessages');
  const row = document.createElement('div');
  row.className = 'session-divider';
  row.innerHTML = `<span>${escapeHtml(label)}</span>`;
  row.style.opacity = '0';
  row.style.transition = 'opacity 300ms ease';
  chatMessages.prepend(row);
  requestAnimationFrame(() => requestAnimationFrame(() => { row.style.opacity = '1'; }));
  chatMessages.scrollTop = 0;
}

// ── Comando /resumen ("/resume" en inglés) — fuerza compactación y muestra el resumen ──
async function runSummaryCommand() {
  showTyping();
  try {
    const res = await fetch('/api/chat/tutor/summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ sessionId }),
    });
    hideTyping();
    if (res.status === 401) { window.location.href = 'login.html'; return; }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      addMessage(t('summaryFailed') + ' ' + (err.error || t('unknownError')), 'ai');
      return;
    }
    const data = await res.json();
    addSessionDivider(t('sessionCompacted'));
    if (data.summary) {
      addMessage(data.summary, 'ai');
    }

    if (Array.isArray(data.blocks) && data.blocks.length > 0) {
      const list = data.blocks.map(b => `- **${b.title}** (${b.subject})`).join('\n');
      addMessage(`${t('blocksDetected')}\n\n${list}`, 'ai');
    }
  } catch (err) {
    hideTyping();
    addMessage(t('errorPrefix') + ' ' + (err.message || t('connectionError')), 'ai');
  }
}

// ── Comando /exportar ("/export") — descarga la conversación sintetizada
// como Markdown. Los modelos detrás de 9router no generan PDF real (solo
// texto), así que se limita a Markdown.
async function runExportCommand() {
  showTyping();
  try {
    const res = await fetch('/api/chat/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ sessionId }),
    });
    hideTyping();
    if (res.status === 401) { window.location.href = 'login.html'; return; }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      addMessage(t('exportFailed') + ' ' + (err.error || t('unknownError')), 'ai');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'chat-export.md';
    a.click();
    URL.revokeObjectURL(url);
    addSystemMessage(t('exportedToMarkdown'));
  } catch (err) {
    hideTyping();
    addMessage(t('errorPrefix') + ' ' + (err.message || t('connectionError')), 'ai');
  }
}

// ── "Explícamelo diferente" (regenerar última respuesta de la IA) ──

function openReExplicarConfirm(msgRow) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `
    <div class="confirm-card">
      <p class="confirm-question">¿Quieres cambiar el enfoque?</p>
      <div class="confirm-actions">
        <button class="confirm-btn confirm-btn-secondary" id="confirmNo" type="button">No</button>
        <button class="confirm-btn confirm-btn-primary" id="confirmYes" type="button">Sí</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('#confirmNo').addEventListener('click', () => {
    overlay.remove();
    runRegenerate(msgRow, '');
  });
  overlay.querySelector('#confirmYes').addEventListener('click', () => {
    overlay.remove();
    enterReExplicarMode(msgRow);
  });
}

function renderReExplicarSuggestions() {
  const box = document.getElementById('reexplicarSuggestions');
  if (!box) return;
  box.innerHTML = REEXPLICAR_SUGGESTIONS.map(s =>
    `<button type="button" class="reexplicar-chip">${escapeHtml(s)}</button>`
  ).join('');
  box.querySelectorAll('.reexplicar-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById('messageInput');
      if (!input) return;
      input.value = t('explainMePrefix') + ' ' + btn.textContent;
      input.focus();
    });
  });
}

function enterReExplicarMode(msgRow) {
  reExplicarModeActive = true;
  reExplicarTargetRow = msgRow;
  document.querySelector('.chat-input-wrapper')?.classList.add('reexplicar-active');
  const bar = document.getElementById('reexplicarBar');
  if (bar) bar.classList.remove('hidden');
  renderReExplicarSuggestions();
  const input = document.getElementById('messageInput');
  if (input) { input.placeholder = '¿Cómo quieres que te lo expliquen?'; input.focus(); }
}

function exitReExplicarMode() {
  reExplicarModeActive = false;
  reExplicarTargetRow = null;
  document.querySelector('.chat-input-wrapper')?.classList.remove('reexplicar-active');
  const bar = document.getElementById('reexplicarBar');
  if (bar) bar.classList.add('hidden');
  const input = document.getElementById('messageInput');
  if (input) input.placeholder = t('messagePlaceholder');
}

// Regenera la última respuesta de la IA (msgRow debe ser la más reciente en
// la sesión — el backend lo valida y rechaza si ya no lo es).
async function runRegenerate(targetRow, instruction) {
  if (!targetRow.dataset.msgId) return;
  const chatMessages = document.getElementById('chatMessages');
  targetRow.remove();
  showTyping();

  let fullTextRef = '';
  let fullReasoningRef = '';
  let quizGoalRef;
  let aiBubble = null;
  let textDiv = null;
  let thinkingRow = null;
  let thinkingTextDiv = null;
  let thinkingOpen = false;

  function createRegenBubble() {
    const msgRow = document.createElement('div');
    msgRow.className = 'msg-row msg-ai';
    msgRow.dataset.sender = 'ai';

    const bubble = document.createElement('div');
    bubble.className = 'bubble-ai';
    const textDivEl = document.createElement('div');
    textDivEl.className = 'bubble-text';
    bubble.appendChild(textDivEl);

    const footer = document.createElement('div');
    footer.className = 'msg-footer';
    const timeSpan = document.createElement('span');
    timeSpan.className = 'msg-time';
    timeSpan.textContent = formatTime();
    const actions = document.createElement('div');
    actions.className = 'msg-actions';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'msg-action';
    copyBtn.title = t('copy');
    copyBtn.innerHTML = svgIcon('copy');
    copyBtn.addEventListener('click', () => handleCopy(stripQuizMarker(fullTextRef).text, copyBtn));
    actions.appendChild(copyBtn);

    const pinBtn = document.createElement('button');
    pinBtn.className = 'msg-action';
    pinBtn.title = t('pinMessage');
    pinBtn.innerHTML = svgIcon('pin');
    pinBtn.addEventListener('click', () => togglePinMessage(msgRow, pinBtn));
    actions.appendChild(pinBtn);

    const reportBtn = document.createElement('button');
    reportBtn.className = 'msg-action';
    reportBtn.title = t('report');
    reportBtn.innerHTML = svgIcon('flag');
    reportBtn.dataset.reported = 'false';
    reportBtn.addEventListener('click', () => handleReport(stripQuizMarker(fullTextRef).text, null, reportBtn));
    actions.appendChild(reportBtn);

    const reexplainBtn = document.createElement('button');
    reexplainBtn.className = 'msg-action';
    reexplainBtn.title = t('reexplain');
    reexplainBtn.innerHTML = svgIcon('retry');
    reexplainBtn.addEventListener('click', () => openReExplicarConfirm(msgRow));
    actions.appendChild(reexplainBtn);

    footer.appendChild(timeSpan);
    footer.appendChild(actions);
    msgRow.appendChild(bubble);
    msgRow.appendChild(footer);

    msgRow.style.opacity = '0';
    msgRow.style.transform = 'translateY(8px)';
    msgRow.style.transition = 'opacity 250ms ease, transform 250ms ease';
    chatMessages.prepend(msgRow);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      msgRow.style.opacity = '1';
      msgRow.style.transform = 'translateY(0)';
    }));
    chatMessages.scrollTop = 0;
    return { msgRow, textDiv: textDivEl };
  }

  try {
    const res = await fetch('/api/chat/tutor/regenerate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ sessionId, modelId: selectedModelId || undefined, instruction }),
    });

    if (res.status === 401) { window.location.href = 'login.html'; return; }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || t('serverError'));
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';
      for (const part of parts) {
        const line = part.trim();
        if (!line || !line.startsWith('data: ')) continue;
        const payload = line.slice(6);
        if (payload === '[DONE]') continue;
        try {
          const json = JSON.parse(payload);
          if (json.error) throw new Error(json.error);
          if (json.done) {
            if (aiBubble && json.msgId) aiBubble.dataset.msgId = json.msgId;
            setLastUserMsgId(json.userMsgId);
            quizGoalRef = json.quizGoal;
            notifyIfEnabled();
            continue;
          }
          if (json.reasoning) {
            if (!thinkingRow) {
              hideTyping();
              const row = document.createElement('div');
              row.className = 'msg-row thinking-row';
              const label = document.createElement('div');
              label.className = 'thinking-label';
              label.innerHTML = `${svgIcon('chevronRight', 12)} Pensando...`;
              const contentDiv = document.createElement('div');
              contentDiv.className = 'thinking-content';
              row.appendChild(label);
              row.appendChild(contentDiv);
              chatMessages.prepend(row);
              chatMessages.scrollTop = 0;
              thinkingRow = row;
              thinkingTextDiv = contentDiv;
              label.addEventListener('click', () => {
                thinkingOpen = !thinkingOpen;
                contentDiv.classList.toggle('open', thinkingOpen);
                label.querySelector('svg').style.transform = thinkingOpen ? 'rotate(90deg)' : '';
              });
            }
            fullReasoningRef += json.reasoning;
            thinkingTextDiv.innerHTML = formatAIResponse(fullReasoningRef);
            if (thinkingOpen) thinkingTextDiv.scrollTop = thinkingTextDiv.scrollHeight;
          }
          if (json.content) {
            if (!aiBubble) {
              hideTyping();
              const b = createRegenBubble();
              aiBubble = b.msgRow;
              textDiv = b.textDiv;
            }
            fullTextRef += json.content;
            textDiv.innerHTML = formatAIResponse(stripQuizMarker(fullTextRef).text);
            chatMessages.scrollTop = 0;
          }
        } catch (e) {
          if (e instanceof SyntaxError) continue;
          throw e;
        }
      }
    }

    hideTyping();
    if (fullTextRef) {
      const { text: cleanText, marker: quizMarker } = stripQuizMarker(fullTextRef);
      const actions = aiBubble ? aiBubble.querySelector('.msg-actions') : null;
      if (actions) {
        if (quizMarker === 'QUIZ_DETECTED') appendQuizButtons(actions, aiBubble, quizGoalRef);
        appendNextStepButton(actions, quizMarker);
      }
      if (quizMarker === 'QUIZ_EXPLAIN_DONE') {
        handleQuizExplainDone();
      }
      renderKaTeX();
    }
  } catch (err) {
    hideTyping();
    addMessage(t('errorPrefix') + ' ' + (err.message || t('connectionError')), 'ai');
  }
  updateSessionInfo();
  refreshSidebarSessions();
}

async function handleReport(aiText, msgRow, btn) {
  if (btn.dataset.reported === 'true') return;
  const chatMessages = document.getElementById('chatMessages');
  const userRows = chatMessages.querySelectorAll('.msg-row.msg-user');
  let userPrompt = '';
  if (userRows.length > 0) {
    const lastUser = userRows[0];
    const t = lastUser.querySelector('.bubble-text');
    if (t) userPrompt = t.textContent;
  }
  try {
    const res = await fetch('/api/chat/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        aiMessage: aiText,
        userPrompt: userPrompt,
        sessionId: sessionId,
      }),
    });
    if (res.ok) {
      btn.dataset.reported = 'true';
      btn.innerHTML = svgIcon('flagFilled');
      btn.style.color = '#f87171';
      const timeSpan = btn.closest('.msg-footer')?.querySelector('.msg-time');
      if (timeSpan) {
        const orig = timeSpan.textContent;
        timeSpan.textContent = t('reported');
        setTimeout(() => { timeSpan.textContent = orig; }, 2000);
      }
    }
  } catch {}
}

export async function handleSend() {
  const input = document.getElementById('messageInput');
  const text = input.value.trim();
  if (!text) return;

  if (!reExplicarModeActive) {
    const matchedCmd = SLASH_COMMANDS.find(c => c.aliases.includes(text.toLowerCase()));
    if (matchedCmd) {
      input.value = '';
      closeSlashMenu();
      executeSlashCommand(matchedCmd.primary);
      return;
    }
  }

  if (reExplicarModeActive) {
    const targetRow = reExplicarTargetRow;
    input.value = '';
    exitReExplicarMode();
    if (targetRow) runRegenerate(targetRow, text);
    return;
  }

  if (pendingAttachments.length > 0) {
    const model = availableModels.find(m => m.id === selectedModelId);
    if (!model || !model.multimodal) {
      if (!confirm(t('confirmSwitchModel'))) {
        clearAttachments();
        return;
      }
      const mmModel = availableModels.find(m => m.multimodal);
      if (mmModel) {
        selectedModelId = mmModel.id;
        const topSelect2 = document.getElementById('topBarModelSelect');
        if (topSelect2) topSelect2.value = mmModel.id;
        updatePlusButton();
      }
    }
  }

  const attSnapshot = pendingAttachments.slice();
  const linksSnapshot = activeLinks.slice();
  addMessage(text, 'user', attSnapshot);
  input.value = '';
  input.style.height = 'auto';
  input.style.height = Math.max(input.scrollHeight, 24) + 'px';
  showTyping();

  const chatMessages = document.getElementById('chatMessages');
  let fullTextRef = '';
  let fullReasoningRef = '';
  let quizGoalRef;

  function createAIBubble() {
    const msgRow = document.createElement('div');
    msgRow.className = 'msg-row msg-ai';
    msgRow.dataset.sender = 'ai';

    const bubble = document.createElement('div');
    bubble.className = 'bubble-ai';

    const textDiv = document.createElement('div');
    textDiv.className = 'bubble-text';
    bubble.appendChild(textDiv);

    const footer = document.createElement('div');
    footer.className = 'msg-footer';
    const timeSpan = document.createElement('span');
    timeSpan.className = 'msg-time';
    timeSpan.textContent = formatTime();
    const actions = document.createElement('div');
    actions.className = 'msg-actions';
    const copyBtn = document.createElement('button');
    copyBtn.className = 'msg-action';
    copyBtn.title = t('copy');
    copyBtn.innerHTML = svgIcon('copy');
    copyBtn.addEventListener('click', () => handleCopy(stripQuizMarker(fullTextRef).text, copyBtn));
    actions.appendChild(copyBtn);

    const pinBtn = document.createElement('button');
    pinBtn.className = 'msg-action';
    pinBtn.title = t('pinMessage');
    pinBtn.innerHTML = svgIcon('pin');
    pinBtn.addEventListener('click', () => togglePinMessage(msgRow, pinBtn));
    actions.appendChild(pinBtn);

    const reportBtn = document.createElement('button');
    reportBtn.className = 'msg-action';
    reportBtn.title = t('report');
    reportBtn.innerHTML = svgIcon('flag');
    reportBtn.dataset.reported = 'false';
    reportBtn.addEventListener('click', () => handleReport(stripQuizMarker(fullTextRef).text, null, reportBtn));
    actions.appendChild(reportBtn);

    const reexplainBtn = document.createElement('button');
    reexplainBtn.className = 'msg-action';
    reexplainBtn.title = t('reexplain');
    reexplainBtn.innerHTML = svgIcon('retry');
    reexplainBtn.addEventListener('click', () => openReExplicarConfirm(msgRow));
    actions.appendChild(reexplainBtn);
    footer.appendChild(timeSpan);
    footer.appendChild(actions);
    msgRow.appendChild(bubble);
    msgRow.appendChild(footer);

    msgRow.style.opacity = '0';
    msgRow.style.transform = 'translateY(8px)';
    msgRow.style.transition = 'opacity 250ms ease, transform 250ms ease';
    chatMessages.prepend(msgRow);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        msgRow.style.opacity = '1';
        msgRow.style.transform = 'translateY(0)';
      });
    });
    chatMessages.scrollTop = 0;

    return { msgRow, textDiv };
  }

  try {
    const body = { message: text, modelId: selectedModelId || undefined, sessionId };
    if (attSnapshot.length > 0) {
      body.attachments = attSnapshot.map(a => ({ type: a.type, mime: a.mime, data: a.data }));
    }
    if (linksSnapshot.length > 0) {
      body.links = linksSnapshot;
    }

    const res = await fetch('/api/chat/tutor/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });

    if (res.status === 401) { window.location.href = 'login.html'; return; }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || t('serverError'));
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let aiBubble = null;
    let textDiv = null;
    let thinkingRow = null;
    let thinkingTextDiv = null;
    let thinkingOpen = false;
    let onboardingHandled = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';
      for (const part of parts) {
        const line = part.trim();
        if (!line || !line.startsWith('data: ')) continue;
        const payload = line.slice(6);
        if (payload === '[DONE]') continue;
        try {
          const json = JSON.parse(payload);
          if (json.error) throw new Error(json.error);
          if (json.sessionId) {
            sessionId = json.sessionId;
            sessionStorage.setItem('chatSessionId', sessionId);
          }
          // Plan 04/05 — el mensaje fue interceptado por el wizard de
          // personalización en vez de generar una respuesta de IA.
          if (json.type === 'onboarding_step') {
            onboardingHandled = true;
            renderOnboardingStep(json);
            continue;
          }
          if (json.done) {
            if (aiBubble && json.msgId) aiBubble.dataset.msgId = json.msgId;
            if (aiBubble && json.userMsgId) aiBubble.dataset.userMsgId = json.userMsgId;
            setLastUserMsgId(json.userMsgId);
            quizGoalRef = json.quizGoal;
            continue;
          }
          if (json.reasoning) {
            if (!thinkingRow) {
              hideTyping();
              const row = document.createElement('div');
              row.className = 'msg-row thinking-row';
              const label = document.createElement('div');
              label.className = 'thinking-label';
              label.innerHTML = `${svgIcon('chevronRight', 12)} Pensando...`;
              const contentDiv = document.createElement('div');
              contentDiv.className = 'thinking-content';
              row.appendChild(label);
              row.appendChild(contentDiv);
              chatMessages.prepend(row);
              chatMessages.scrollTop = 0;
              thinkingRow = row;
              thinkingTextDiv = contentDiv;
              label.addEventListener('click', () => {
                thinkingOpen = !thinkingOpen;
                contentDiv.classList.toggle('open', thinkingOpen);
                label.querySelector('svg').style.transform = thinkingOpen ? 'rotate(90deg)' : '';
              });
            }
            fullReasoningRef += json.reasoning;
            thinkingTextDiv.innerHTML = formatAIResponse(fullReasoningRef);
            if (thinkingOpen) thinkingTextDiv.scrollTop = thinkingTextDiv.scrollHeight;
          }
          if (json.content) {
            if (!aiBubble) {
              hideTyping();
              clearAttachments();
              const b = createAIBubble();
              aiBubble = b.msgRow;
              textDiv = b.textDiv;
            }
            fullTextRef += json.content;
            textDiv.innerHTML = formatAIResponse(stripQuizMarker(fullTextRef).text);
            chatMessages.scrollTop = 0;
          }
        } catch (e) {
          if (e instanceof SyntaxError) continue;
          throw e;
        }
      }
    }

    hideTyping();
    clearAttachments();

    if (fullTextRef) {
      const { text: cleanText, marker: quizMarker } = stripQuizMarker(fullTextRef);
      const actions = aiBubble ? aiBubble.querySelector('.msg-actions') : null;
      if (actions) {
        if (quizMarker === 'QUIZ_DETECTED') appendQuizButtons(actions, aiBubble, quizGoalRef);
        appendNextStepButton(actions, quizMarker);
      }
      if (quizMarker === 'QUIZ_EXPLAIN_DONE') {
        handleQuizExplainDone();
      }
      renderKaTeX();
    } else if (!onboardingHandled && !aiBubble && !thinkingRow) {
      addMessage(t('processingError'), 'ai');
    }

    // El mensaje pasó de largo el interceptor del wizard (primer mensaje
    // largo o tipo cuestionario) — es el único momento en que el banner
    // diferido tiene sentido mostrarse (plan 05).
    if (!onboardingHandled && fullTextRef) {
      maybeOfferDeferredBanner();
    }
  } catch (err) {
    hideTyping();
    clearAttachments();
    addMessage(t('errorPrefix') + ' ' + (err.message || t('connectionError')), 'ai');
  }
  updateSessionInfo();
  refreshSidebarSessions();
}

/* ── Context Ring & Panel ── */

const sessionState = {
  email: '',
  name: '',
  role: '',
  createdAt: '',
  examsGenerated: 0,
  totalApiCost: 0,
  userMessages: 0,
  assistantMessages: 0,
  totalTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  provider: 'NVIDIA',
  model: '',
  contextLength: 128000,
  chatCreated: '',
  lastActivity: '',
};

function getRingColor(pct) {
  if (pct <= 0.5) return '#4ade80';
  if (pct <= 0.8) return '#facc15';
  return '#f87171';
}

function getContextUsage() {
  const limit = sessionState.contextLength || 128000;
  return Math.min(sessionState.totalTokens / limit, 1);
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

async function updateSessionInfo() {
  if (updateSessionTimeout) return;
  updateSessionTimeout = setTimeout(async () => {
    updateSessionTimeout = null;
    try {
      const res = await fetch('/auth/me', { credentials: 'same-origin' });
      if (res.status === 401) { window.location.href = 'login.html'; return; }
      if (res.ok) {
        const data = await res.json();
        sessionState.email = data.email || '';
        sessionState.name = data.name || data.email || '';
        sessionState.role = data.role || '';
      }
    } catch (_) {}

    try {
      const res = await fetch('/api/user/profile', { credentials: 'same-origin' });
      if (res.ok) {
        const data = await res.json();
        const u = data.user || data;
        sessionState.email = u.email || sessionState.email;
        sessionState.name = u.username || u.name || sessionState.name;
        sessionState.role = u.role || sessionState.role;
        sessionState.createdAt = u.created_at || u.createdAt || '';
        sessionState.examsGenerated = u.exams_generated ?? u.examsGenerated ?? 0;
        sessionState.totalApiCost = u.total_api_cost ?? u.totalApiCost ?? 0;
        sessionState.avatarData = u.avatar_data || null;
      }
    } catch (_) {}

    try {
      const exRes = await fetch('/api/exams', { credentials: 'same-origin' });
      if (exRes.ok) {
        const exData = await exRes.json();
        sessionState.examsGenerated = (exData.exams && exData.exams.length) || 0;
      }
    } catch (_) {}

    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) {
      const userRows = chatMessages.querySelectorAll('.msg-row.msg-user');
      const aiRows = chatMessages.querySelectorAll('.msg-row.msg-ai');
      sessionState.userMessages = userRows.length;
      sessionState.assistantMessages = aiRows.length;

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
      sessionState.totalTokens = Math.round(totalChars / 4);
      sessionState.inputTokens = Math.round(sessionState.totalTokens * ratio);
      sessionState.outputTokens = sessionState.totalTokens - sessionState.inputTokens;
    }

    const modelSelect = document.getElementById('modelSelect') || document.getElementById('topBarModelSelect');
    if (modelSelect && modelSelect.value) {
      const m = availableModels.find(x => x.id === modelSelect.value);
      if (m) {
        sessionState.model = m.label || m.id;
        sessionState.provider = m.provider || 'NVIDIA';
        sessionState.contextLength = m.contextLength || 128000;
      } else {
        sessionState.model = modelSelect.value;
      }
    }

    // Update sidebar user info
    const userNameEl = document.getElementById('sidebarUserName');
    const avatarEl = document.getElementById('sidebarUserAvatar');
    if (userNameEl) userNameEl.textContent = sessionState.name || sessionState.email || t('user');
    if (avatarEl) renderAvatarInto(avatarEl, sessionState.avatarData, sessionState.name || sessionState.email);

    sessionState.lastActivity = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

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
        <span class="session-info-value">${sessionState.email || '—'}</span>
      </div>
      <div class="session-info-item">
        <span class="session-info-label">Rol</span>
        <span class="session-info-value">${sessionState.role || '—'}</span>
      </div>
      <div class="session-info-item">
        <span class="session-info-label">Exámenes disponibles</span>
        <span class="session-info-value">${sessionState.examsGenerated}</span>
      </div>
      <div class="session-info-item">
        <span class="session-info-label">Límite de contexto</span>
        <span class="session-info-value">${(sessionState.contextLength / 1000).toFixed(0)}K</span>
      </div>
      <div class="session-info-item">
        <span class="session-info-label">Chat creado</span>
        <span class="session-info-value">${sessionState.chatCreated || '—'}</span>
      </div>
      <div class="session-info-item">
        <span class="session-info-label">Mensajes de usuario</span>
        <span class="session-info-value">${sessionState.userMessages}</span>
      </div>
      <div class="session-info-item">
        <span class="session-info-label">Mensajes del asistente</span>
        <span class="session-info-value">${sessionState.assistantMessages}</span>
      </div>
      <div class="session-info-item">
        <span class="session-info-label">Total tokens estimados</span>
        <span class="session-info-value">${sessionState.totalTokens.toLocaleString()}</span>
      </div>
      <div class="session-info-item">
        <span class="session-info-label">Tokens de entrada</span>
        <span class="session-info-value">${sessionState.inputTokens.toLocaleString()}</span>
      </div>
      <div class="session-info-item">
        <span class="session-info-label">Tokens de salida</span>
        <span class="session-info-value">${sessionState.outputTokens.toLocaleString()}</span>
      </div>
      <div class="session-info-item">
        <span class="session-info-label">Proveedor</span>
        <span class="session-info-value">${sessionState.provider}</span>
      </div>
      <div class="session-info-item">
        <span class="session-info-label">Modelo</span>
        <span class="session-info-value">${sessionState.model || '—'}</span>
      </div>
      <div class="session-info-item">
        <span class="session-info-label">Última actividad</span>
        <span class="session-info-value">${sessionState.lastActivity}</span>
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

function closeContextPanel() {
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
      sessionState.avatarData = e.detail.avatarData;
      if (avatarEl) renderAvatarInto(avatarEl, e.detail.avatarData, sessionState.name || sessionState.email);
    }
    if (e.detail.name !== undefined) {
      sessionState.name = e.detail.name;
      const nameEl = document.getElementById('sidebarUserName');
      if (nameEl) nameEl.textContent = e.detail.name;
      if (!e.detail.avatarData && avatarEl) renderAvatarInto(avatarEl, sessionState.avatarData, e.detail.name);
    }
  });

  document.getElementById('sidebarCollapseBtn').addEventListener('click', toggleSidebar);
  document.getElementById('sidebarToggleBtn').addEventListener('click', toggleSidebar);
  document.getElementById('sidebarNewChat').addEventListener('click', () => {
    if (currentMode === 'exam') return; // modo examen aún sin funcionalidad
    newChat();
  });
  document.getElementById('modeToggleBtn').addEventListener('click', () => {
    setMode(currentMode === 'chat' ? 'exam' : 'chat');
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
    if (!sid || sid === sessionId) return;
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

  if (!sessionId) {
    sessionId = crypto.randomUUID();
    sessionStorage.setItem('chatSessionId', sessionId);
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

async function handleQuizResolve(msgRow) {
  const userMsgId = msgRow.dataset.userMsgId;
  if (!userMsgId) {
    addMessage(t('quizNoOriginalMsg'), 'ai');
    return;
  }

  addSystemMessage(t('quizSolving'));
  showTyping();
  try {
    const res = await fetch('/api/chat/tutor/quiz/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ sessionId, userMsgId }),
    });
    const data = await res.json();
    hideTyping();
    if (!res.ok) {
      addMessage(t('errorPrefix') + ' ' + (data.error || t('quizSolveFailed')), 'ai');
      return;
    }
    addMessage(data.response, 'ai');
  } catch (err) {
    hideTyping();
    addMessage(t('quizConnError'), 'ai');
  }
}

function triggerVisibleMessage(text) {
  const input = document.getElementById('messageInput');
  input.value = text;
  handleSend();
}

async function handleQuizExplain() {
  try {
    const res = await fetch('/api/chat/tutor/quiz/explain-start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ sessionId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      addMessage(t('explainModeError') + ' ' + (err.error || t('unknownError')), 'ai');
      return;
    }
    quizExplainActive = true;
    triggerVisibleMessage('Quiero que vayamos por partes.');
  } catch (err) {
    addMessage(t('explainModeError') + ' ' + (err.message || t('connectionError')), 'ai');
  }
}

function handleQuizExplainDone() {
  quizExplainActive = false;
  fetch('/api/chat/tutor/quiz/explain-end', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ sessionId }),
  }).catch(() => {});
}

function handleQuizNextStep() {
  triggerVisibleMessage('Siguiente paso.');
}
