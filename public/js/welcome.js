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
    var replaced = html.replace(/\\\[(.+?)\\\]/gs, function (_, expr) {
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
let historyLoaded = null;
let linkModeActive = false;
let activeLinks = [];

// Placeholder: se usará para obtener metadatos/título de una URL vía backend
async function fetchLinkPreview(url) {
  // TODO: implementar con webfetch del backend
  // Debe retornar { title, description, image } o null
  return null;
}

loadChatHistory().then(data => {
  historyLoaded = data;
  if (!sessionId && data && data.sessionId) {
    sessionId = data.sessionId;
    sessionStorage.setItem('chatSessionId', sessionId);
  }
});

async function fetchModels() {
  try {
    const res = await fetch('/api/chat/models', { credentials: 'same-origin' });
    if (res.ok) {
      const data = await res.json();
      availableModels = data.models || [];
      if (availableModels.length > 0) {
        selectedModelId = availableModels[0].id;
      }
    }
  } catch (e) {
    console.warn('Error fetching models:', e);
  }
}

fetchModels();

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

function renderSidebarSessions(sessions) {
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
      const preview = s.preview ? s.preview.slice(0, 40) + (s.preview.length > 40 ? '…' : '') : 'Chat';
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
    html = `<div class="sidebar-date-group"><div class="sidebar-date-label">Sin chats aún</div></div>`;
  }
  container.innerHTML = html;
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
  // Mantener vista actual (archivados/normales) al abrir un chat
  const sidebarMode = document.getElementById('sidebar')?.dataset.mode;
  if (sidebarMode === 'archived') await fetchArchivedSessions();
  else await refreshSidebarSessions();
  updateSessionInfo();
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
  if (!sid || !confirm('¿Eliminar este chat permanentemente?')) return;
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
  await refreshSidebarSessions();
}

function toggleArchivedView() {
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

async function fetchArchivedSessions() {
  try {
    const res = await fetch('/api/chat/sessions/archived', { credentials: 'same-origin' });
    if (!res.ok) return;
    const data = await res.json();
    renderSidebarSessions(data.sessions || []);
  } catch {}
}

function formatTime() {
  const now = new Date();
  return now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function svgIcon(name, size) {
  size = size || 14;
  const icons = {
    copy: `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3a1 1 0 0 0 1 1h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2v-3a1 1 0 0 0-1-1z"/></svg>`,
    edit: `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/></svg>`,
    retry: `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`,
    flag: `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"/></svg>`,
    flagFilled: `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"/></svg>`,
    check: `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    chatText: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/><path d="M7 11h10"/><path d="M7 15h6"/><path d="M7 7h8"/></svg>`,
    chatDot: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.7 3H4a2 2 0 0 0-2 2v16.286a.71.71 0 0 0 1.212.502l2.202-2.202A2 2 0 0 1 6.828 19H20a2 2 0 0 0 2-2v-4.7"/><circle cx="19" cy="6" r="3"/></svg>`,
    chatMore: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/><path d="M12 11h.01"/><path d="M16 11h.01"/><path d="M8 11h.01"/></svg>`,
    collapse: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>`,
    panel: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/></svg>`,
    trash: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`,
    archive: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg>`,
    archiveUp: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M12 17v-7"/><path d="m9 13 3-3 3 3"/></svg>`,
    chevronRight: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`,
    chevronUp: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>`,
  };
  return icons[name] || '';
}

function formatAIResponse(text) {
  let raw = escapeHtml(text);
  // Bold, italic, inline code (before list/para processing)
  raw = raw.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  raw = raw.replace(/\*(.+?)\*/g, '<em>$1</em>');
  raw = raw.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Headers
  raw = raw.replace(/^### (.+)$/gm, '<h4>$1</h4>');
  raw = raw.replace(/^## (.+)$/gm, '<h3>$1</h3>');
  raw = raw.replace(/^# (.+)$/gm, '<h2>$1</h2>');
  // Line-by-line: wrap lists, collect output
  const lines = raw.split('\n');
  const out = [];
  let inUl = false, inOl = false;
  for (const line of lines) {
    const ulMatch = line.match(/^- (.+)/);
    const olMatch = line.match(/^\d+\.\s+(.+)/);
    if (ulMatch) {
      if (inOl) { out.push('</ol>'); inOl = false; }
      if (!inUl) { out.push('<ul>'); inUl = true; }
      out.push('<li>' + ulMatch[1] + '</li>');
    } else if (olMatch) {
      if (inUl) { out.push('</ul>'); inUl = false; }
      if (!inOl) { out.push('<ol>'); inOl = true; }
      out.push('<li>' + olMatch[1] + '</li>');
    } else {
      if (inUl) { out.push('</ul>'); inUl = false; }
      if (inOl) { out.push('</ol>'); inOl = false; }
      out.push(line);
    }
  }
  if (inUl) out.push('</ul>');
  if (inOl) out.push('</ol>');
  let html = out.join('\n');
  // Paragraphs and line breaks
  html = html.replace(/\n{2,}/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');
  if (!html.startsWith('<')) html = '<p>' + html + '</p>';
  return html;
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

const line1 = document.getElementById('line1');
const line2 = document.getElementById('line2');
const subtitle = document.getElementById('subtitle');
const topBar = document.getElementById('topBar');
const originalBottomBarHTML = document.querySelector('.bottom-bar').innerHTML;

checkSession();

// ── Iniciar flujo tras cargar perfil ──
setTimeout(() => {
  ensureUserData().then(() => {
    const { state, user } = getUserState();
    if (state === 'ready') {
      document.getElementById('bottomBar').classList.remove('hidden');
      requestAnimationFrame(() => line1.classList.add('visible'));
      setTimeout(() => line2.classList.add('visible'), 1000);
      setTimeout(() => subtitle.classList.add('visible'), 2000);
    } else {
      renderOnboardingHero(state, user);
    }
  });
}, 500);

// ── Onboarding Flow ─────────────────────────────────────

let onboardingFloatBtn = null;
let onboardingOverlay = null;

function saveUserToLocalStorage(userObj) {
  try {
    localStorage.setItem('user', JSON.stringify(userObj));
  } catch {}
}

function getUserFromLocalStorage() {
  try {
    const raw = localStorage.getItem('user');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function ensureUserData() {
  return fetch('/api/user/profile', { credentials: 'same-origin' })
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      if (!data) return;
      const u = data.user || data;
      const userObj = {
        email: u.email || '',
        name: u.username || u.name || u.email || '',
        role: u.role || '',
        onboarding_status: u.onboarding_status || 'pending',
      };
      saveUserToLocalStorage(userObj);
      return userObj;
    });
}

function getUserState() {
  const user = getUserFromLocalStorage();
  if (!user) return { state: 'register', user: null };
  if (user.onboarding_status !== 'completed') return { state: 'onboarding', user };
  return { state: 'ready', user };
}

function applyUserState() {
  const { state, user } = getUserState();
  if (state === 'ready') return; // normal view, nothing to do
  renderOnboardingHero(state, user);
}

function renderOnboardingHero(state, user) {
  const hero = document.querySelector('.hero');
  if (!hero) return;
  document.getElementById('bottomBar').classList.add('hidden');

  if (state === 'register') {
    hero.innerHTML = `
      <div class="hero-register">
        <p class="hero-line" id="line1">Hola,</p>
        <p class="hero-line" id="line2">bienvenido.</p>
        <p class="hero-sub" id="subtitle">Regístrate para empezar.</p>
        <button class="register-btn" id="registerBtn">
          <svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
          Registrarme
        </button>
      </div>
    `;
    document.getElementById('registerBtn').addEventListener('click', () => {
      window.location.href = 'login.html';
    });
  } else if (state === 'onboarding' && user) {
    const name = user.name || user.email || '';
    hero.innerHTML = `
      <div class="hero-onboarding-ready">
        <p class="hero-line" id="line1">Hola${name ? `,` : ''}</p>
        <p class="hero-line" id="line2">${name || 'bienvenido'}.</p>
        <p class="hero-sub" id="subtitle">Personaliza tu experiencia.</p>
      </div>
    `;
    addOnboardingFloatBtn();
  }
}

function addOnboardingFloatBtn() {
  if (onboardingFloatBtn) return;
  const btn = document.createElement('button');
  btn.className = 'onboarding-float-btn';
  btn.id = 'onboardingFloatBtn';
  btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`;
  btn.title = 'Configurar tutor';
  btn.addEventListener('click', () => {
    showOnboardingPopup();
  });
  document.body.appendChild(btn);
  onboardingFloatBtn = btn;
}

function showOnboardingPopup() {
  if (onboardingOverlay) return;

  const questions = [
    {
      id: 'exam',
      label: '¿Te preparas para algún examen?',
      options: [
        { value: 'no', label: 'No' },
        { value: 'si-escolar', label: 'Sí, examen escolar' },
        { value: 'si-certificacion', label: 'Sí, certificación' },
        { value: 'si-oposicion', label: 'Sí, oposición' },
      ],
    },
    {
      id: 'archetype',
      label: '¿Cómo prefieres que te hable el tutor?',
      options: [
        { value: 'sargento', label: 'Sargento — Firme y directo' },
        { value: 'profesor', label: 'Profesor — Paciente y detallado' },
        { value: 'compa', label: 'Compa — Relajado y conversador' },
        { value: 'guia', label: 'Guía — Motivador y empático' },
      ],
    },
    {
      id: 'feedback_style',
      label: '¿Cómo quieres recibir feedback?',
      options: [
        { value: 'detalladas', label: 'Detalladas — Explicaciones completas' },
        { value: 'cortas', label: 'Cortas — Respuestas breves y al punto' },
        { value: 'numeros', label: 'Solo números — Nada de texto, solo puntuación' },
        { value: 'libre', label: 'Conversación libre — Como un amigo que sabe mucho' },
      ],
    },
    {
      id: 'strictness',
      label: '¿Qué tan estricta quieres a la IA?',
      options: [
        { value: 'alta', label: 'Alta — Exigente y rigurosa' },
        { value: 'media', label: 'Media — Equilibrada' },
        { value: 'baja', label: 'Baja — Flexible y relajada' },
        { value: 'maxima', label: 'Máxima — Nivel juez' },
      ],
    },
  ];

  const answers = {};
  let currentStep = 0;

  const overlay = document.createElement('div');
  overlay.className = 'onboarding-overlay';
  overlay.id = 'onboardingOverlay';
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeOnboarding();
  });
  document.body.appendChild(overlay);
  onboardingOverlay = overlay;

  function closeOnboarding() {
    if (onboardingOverlay) { onboardingOverlay.remove(); onboardingOverlay = null; }
  }

  function renderStep(step) {
    const q = questions[step];
    const total = questions.length;
    let dotsHtml = '';
    for (let i = 0; i < total; i++) {
      const cls = i === step ? 'active' : (answers[questions[i].id] ? 'completed' : '');
      dotsHtml += `<span class="onboarding-dot ${cls}"></span>`;
    }

    let optionsHtml = '';
    q.options.forEach(opt => {
      const value = opt.value;
      const selected = answers[q.id] === value ? 'selected' : '';
      optionsHtml += `
        <div class="onboarding-option ${selected}" data-value="${value}">
          <div class="onboarding-option-radio"><div class="onboarding-option-radio-inner"></div></div>
          <span>${opt.label}</span>
        </div>
      `;
    });

    const isLast = step === total - 1;
    const nextLabel = isLast ? 'Guardar y comenzar' : 'Siguiente';
    const hasAnswer = !!answers[q.id];

    overlay.innerHTML = `
      <div class="onboarding-card">
        <div class="onboarding-header">
          <h2 class="onboarding-title">Personaliza tu tutor</h2>
          <p class="onboarding-desc">Paso ${step + 1} de ${total}</p>
        </div>
        <div class="onboarding-dots">${dotsHtml}</div>
        <div class="onboarding-body">
          <div class="onboarding-question">${q.label}</div>
          <div class="onboarding-options">${optionsHtml}</div>
        </div>
        <div class="onboarding-footer">
          ${step > 0 ? '<button class="onboarding-back-btn" id="onbBack">Atrás</button>' : '<div style="flex:1"></div>'}
          <button class="onboarding-next-btn" id="onbNext" ${hasAnswer ? '' : 'disabled'}>${nextLabel}</button>
        </div>
      </div>
    `;

    overlay.querySelectorAll('.onboarding-option').forEach(el => {
      el.addEventListener('click', () => {
        overlay.querySelectorAll('.onboarding-option').forEach(o => o.classList.remove('selected'));
        el.classList.add('selected');
        answers[q.id] = el.dataset.value;
        document.getElementById('onbNext').disabled = false;
      });
    });

    if (step > 0) {
      document.getElementById('onbBack').addEventListener('click', () => {
        currentStep--;
        renderStep(currentStep);
      });
    }

    document.getElementById('onbNext').addEventListener('click', () => {
      if (!answers[q.id]) return;
      if (isLast) {
        submitOnboarding(answers);
      } else {
        currentStep++;
        renderStep(currentStep);
      }
    });
  }

  renderStep(0);
}

async function submitOnboarding(answers) {
  const btn = document.getElementById('onbNext');
  if (btn) { btn.textContent = 'Guardando...'; btn.disabled = true; }

  try {
    const res = await fetch('/api/user/onboarding/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(answers),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error('Error al guardar: ' + txt);
    }

    // Redirigir para que la página recargue con el perfil activo
    window.location.href = 'welcome.html';
  } catch {
    if (btn) { btn.textContent = 'Error. Intenta de nuevo'; btn.disabled = false; }
  }
}

function renderNormalHero() {
  const hero = document.querySelector('.hero');
  if (!hero) return;
  const bottomBar = document.getElementById('bottomBar');
  if (bottomBar) bottomBar.classList.remove('hidden');
  hero.innerHTML = `
    <p class="hero-line" id="line1">Hola,</p>
    <p class="hero-line" id="line2">bienvenido.</p>
    <p class="hero-sub" id="subtitle">Tu asistente de estudio personal.</p>
  `;
  // Re-run hero animation
  const l1 = document.getElementById('line1');
  const l2 = document.getElementById('line2');
  const sub = document.getElementById('subtitle');
  if (l1) requestAnimationFrame(() => l1.classList.add('visible'));
  if (l2) setTimeout(() => l2.classList.add('visible'), 1000);
  if (sub) setTimeout(() => sub.classList.add('visible'), 2000);
}

function eraseText(el, onComplete) {
  const text = el.textContent;
  const duration = 600;
  const start = performance.now();

  function frame(now) {
    const progress = Math.min((now - start) / duration, 1);
    const charsErased = Math.floor(progress * text.length);
    el.textContent = text.slice(charsErased);
    if (progress < 1) {
      requestAnimationFrame(frame);
    } else {
      el.textContent = '\u00A0';
      el.style.opacity = '0';
      if (onComplete) onComplete();
    }
  }
  requestAnimationFrame(frame);
}

function morphText(el, targetText, onComplete) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.';
  const duration = 900;
  const start = performance.now();
  const finalText = targetText;

  function frame(now) {
    const progress = Math.min((now - start) / duration, 1);
    const resolvedChars = Math.floor(progress * finalText.length);
    let result = '';
    for (let i = 0; i < finalText.length; i++) {
      if (i < resolvedChars) {
        result += finalText[i];
      } else {
        result += chars[Math.floor(Math.random() * chars.length)];
      }
    }
    el.textContent = result;
    if (progress < 1) {
      requestAnimationFrame(frame);
    } else {
      el.textContent = finalText;
      if (onComplete) onComplete();
    }
  }
  requestAnimationFrame(frame);
}

function goToHome() {
  const chatMessages = document.getElementById('chatMessages');
  chatMessages.classList.remove('open');
  chatMessages.innerHTML = '';

  document.getElementById('contextPanel').classList.remove('open');
  document.querySelector('.page-content').classList.remove('panel-open');

  renderNormalHero();

  document.querySelector('.bottom-bar').innerHTML = originalBottomBarHTML;
  document.getElementById('topBar').classList.remove('visible');
  closeSidebar();
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

function populateTopBarModels() {
  const topSelect = document.getElementById('topBarModelSelect');
  if (!topSelect) return;
  if (topSelect._populated) return;
  topSelect._populated = true;
  topSelect.innerHTML = '';
  availableModels.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    topSelect.appendChild(opt);
  });
  if (selectedModelId) topSelect.value = selectedModelId;
  updatePlusButton();

  topSelect.addEventListener('change', () => {
    selectedModelId = topSelect.value;
    updatePlusButton();
    updateSessionInfo();
  });
}

function newChat() {
  document.getElementById('chatMessages').classList.remove('open');
  document.getElementById('chatMessages').innerHTML = '';
  document.getElementById('contextPanel').classList.remove('open');
  document.querySelector('.page-content').classList.remove('panel-open');

  sessionId = crypto.randomUUID();
  sessionStorage.setItem('chatSessionId', sessionId);

  const bar = document.querySelector('.bottom-bar');
  const hasForm = document.getElementById('messageInput');
  if (!hasForm) {
    transformBottomBar();
    return;
  }

  document.getElementById('chatMessages').classList.add('open');
  sessionState.chatCreated = formatTime();
  addMessage('Hola, soy tu tutor. ¿En qué puedo ayudarte?', 'ai');
  updateSessionInfo();
  refreshSidebarSessions();
}

/* ── End Sidebar ── */

function transformBottomBar() {
  topBar.classList.add('visible');

  const bar = document.querySelector('.bottom-bar');
  const dashboardLink = bar.querySelector('.nav-link');

  morphText(dashboardLink, 'Message...', () => {
    const chatTriggerEl = document.getElementById('chatTrigger');
    chatTriggerEl.style.transition = 'opacity 350ms ease';
    chatTriggerEl.style.opacity = '0';

    setTimeout(() => {
      bar.innerHTML = `
        <div class="chat-input-wrapper">
          <div class="chat-input-inner" id="chatInputInner">
            <div class="input-resize-handle"></div>
            <textarea id="messageInput" placeholder="Message..." rows="1"></textarea>
            <div id="chatLinksList"></div>
            <div class="link-mode-bar" id="linkModeBar">
              <span>Modo enlace — Escribe una URL y presiona Enter</span>
              <button class="link-mode-close" id="linkModeClose">&times;</button>
            </div>
          </div>
          <div class="chat-input-actions" id="chatInputActions">
            <button id="plusBtn">+</button>
            <button id="sendBtn">↑</button>
            <div class="plus-menu" id="plusMenu">
              <button class="plus-menu-item" data-action="image">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
                <span>Imagen</span>
              </button>
              <button class="plus-menu-item" data-action="link">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/></svg>
                <span>Enlace</span>
              </button>
              <button class="plus-menu-item" data-action="file">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/></svg>
                <span>Documento</span>
              </button>
              <button class="plus-menu-item" data-action="camera">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z"/><circle cx="12" cy="13" r="3"/></svg>
                <span>Cámara</span>
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

      openSidebar();
      populateTopBarModels();

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
      });

      function exitLinkMode() {
        linkModeActive = false;
        linkModeBar.style.display = 'none';
        const inp = document.getElementById('messageInput');
        if (inp) inp.placeholder = 'Message...';
      }

      function enterLinkMode() {
        linkModeActive = true;
        linkModeBar.querySelector('span').textContent = 'Modo enlace — Escribe una URL y presiona Enter';
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

      document.getElementById('sendBtn').addEventListener('click', handleSend);
      const msgInput = document.getElementById('messageInput');
      msgInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          if (linkModeActive) {
            const url = msgInput.value.trim();
            if (url) {
              if (activeLinks.includes(url)) {
                const label = linkModeBar.querySelector('span');
                label.textContent = 'Ese enlace ya está en la lista';
                msgInput.value = '';
                setTimeout(() => {
                  label.textContent = 'Modo enlace — Escribe una URL y presiona Enter';
                }, 1500);
              } else {
                activeLinks.push(url);
                msgInput.value = '';
                renderLinksList();
                const label = linkModeBar.querySelector('span');
                label.textContent = 'Modo enlace — Escribe una URL y presiona Enter';
              }
            }
          } else {
            handleSend();
          }
        }
      });
      function resetInputHeight() {
        msgInput.style.height = 'auto';
        msgInput.style.overflowY = 'hidden';
        delete msgInput.dataset.userMinHeight;
      }

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
      // Renderizar historial si existe, o mensaje de bienvenida
      if (historyLoaded && historyLoaded.messages && historyLoaded.messages.length > 0) {
        historyLoaded.messages.forEach(msg => {
          addMessage(msg.content, msg.role === 'user' ? 'user' : 'ai');
        });
        document.getElementById('chatMessages').scrollTop = 0;
      } else {
        addMessage('Hola, soy tu tutor. ¿En qué puedo ayudarte?', 'ai');
      }
    }, 350);
  });
}

function addMessage(text, sender, attachments) {
  const chatMessages = document.getElementById('chatMessages');

  const msgRow = document.createElement('div');
  msgRow.className = `msg-row msg-${sender}`;
  msgRow.dataset.sender = sender;

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
  copyBtn.title = 'Copiar';
  copyBtn.innerHTML = svgIcon('copy');
  copyBtn.addEventListener('click', () => handleCopy(text, copyBtn));
  actions.appendChild(copyBtn);

  if (sender === 'user') {
    const editBtn = document.createElement('button');
    editBtn.className = 'msg-action';
    editBtn.title = 'Editar';
    editBtn.innerHTML = svgIcon('edit');
    editBtn.addEventListener('click', () => handleEdit(msgRow));
    actions.appendChild(editBtn);

    const retryBtn = document.createElement('button');
    retryBtn.className = 'msg-action';
    retryBtn.title = 'Reintentar';
    retryBtn.innerHTML = svgIcon('retry');
    retryBtn.addEventListener('click', () => handleRetry(msgRow));
    actions.appendChild(retryBtn);
  } else {
    const reportBtn = document.createElement('button');
    reportBtn.className = 'msg-action';
    reportBtn.title = 'Reportar';
    reportBtn.innerHTML = svgIcon('flag');
    reportBtn.dataset.reported = 'false';
    reportBtn.addEventListener('click', () => handleReport(text, msgRow, reportBtn));
    actions.appendChild(reportBtn);
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
  const typing = document.createElement('div');
  typing.className = 'typing-indicator';
  typing.id = 'typingIndicator';
  typing.innerHTML = '<span></span><span></span><span></span>';
  typing.style.opacity = '0';
  typing.style.transform = 'translateY(8px)';
  typing.style.transition = 'opacity 250ms ease, transform 250ms ease';
  chatMessages.prepend(typing);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      typing.style.opacity = '1';
      typing.style.transform = 'translateY(0)';
    });
  });

  chatMessages.scrollTop = 0;
}

function hideTyping() {
  const typing = document.getElementById('typingIndicator');
  if (typing) typing.remove();
}

function renderAttachmentPreviews() {
  let container = document.getElementById('attachmentPreviews');
  if (!container) {
    container = document.createElement('div');
    container.id = 'attachmentPreviews';
    const wrapper = document.querySelector('.chat-input-wrapper');
    if (wrapper) {
      wrapper.insertBefore(container, wrapper.firstChild);
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
  const isUser = msgRow.dataset.sender === 'user';
  if (isUser) {
    const bubble = msgRow.querySelector('.bubble-user');
    if (!bubble) return;
    const textDiv = bubble.querySelector('.bubble-text');
    if (!textDiv) return;
    const text = textDiv.textContent;
    msgRow.remove();
    document.getElementById('messageInput').value = text;
    handleSend();
  } else {
    const chatMessages = document.getElementById('chatMessages');
    const userRows = chatMessages.querySelectorAll('.msg-row.msg-user');
    if (userRows.length === 0) return;
    const lastUserRow = userRows[0];
    const bubble = lastUserRow.querySelector('.bubble-user');
    if (!bubble) return;
    const textDiv = bubble.querySelector('.bubble-text');
    if (!textDiv) return;
    const text = textDiv.textContent;
    msgRow.remove();
    document.getElementById('messageInput').value = text;
    handleSend();
  }
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
        timeSpan.textContent = 'Reportado';
        setTimeout(() => { timeSpan.textContent = orig; }, 2000);
      }
    }
  } catch {}
}

async function sendToChatAPI(text) {
  try {
    const body = { message: text, modelId: selectedModelId || undefined, sessionId };
    if (pendingAttachments.length > 0) {
      body.attachments = pendingAttachments.map(a => ({ type: a.type, mime: a.mime, data: a.data }));
    }
    if (activeLinks.length > 0) {
      body.links = activeLinks.slice();
    }
    const res = await fetch('/api/chat/tutor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });

    if (res.status === 401) {
      window.location.href = 'login.html';
      return null;
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error del servidor');
    }

    const data = await res.json();
    if (data.sessionId) {
      sessionId = data.sessionId;
      sessionStorage.setItem('chatSessionId', sessionId);
    }
    return { response: data.response };
  } catch (err) {
    console.error('Chat API error:', err);
    return { error: err.message || 'Error del servidor' };
  }
}

async function handleSend() {
  const input = document.getElementById('messageInput');
  const text = input.value.trim();
  if (!text) return;

  if (pendingAttachments.length > 0) {
    const model = availableModels.find(m => m.id === selectedModelId);
    if (!model || !model.multimodal) {
      if (!confirm('El modelo actual no soporta archivos adjuntos. ¿Cambiar a un modelo multimodal?')) {
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
  let copyBtnRef = null;
  let fullTextRef = '';
  let fullReasoningRef = '';

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
    copyBtn.title = 'Copiar';
    copyBtn.innerHTML = svgIcon('copy');
    copyBtn.addEventListener('click', () => handleCopy(fullTextRef, copyBtn));
    actions.appendChild(copyBtn);
    copyBtnRef = copyBtn;

    const reportBtn = document.createElement('button');
    reportBtn.className = 'msg-action';
    reportBtn.title = 'Reportar';
    reportBtn.innerHTML = svgIcon('flag');
    reportBtn.dataset.reported = 'false';
    reportBtn.addEventListener('click', () => handleReport(fullTextRef, null, reportBtn));
    actions.appendChild(reportBtn);
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
      throw new Error(err.error || 'Error del servidor');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let aiBubble = null;
    let textDiv = null;
    let thinkingRow = null;
    let thinkingTextDiv = null;
    let thinkingOpen = false;

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
            thinkingTextDiv.textContent = fullReasoningRef;
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
            textDiv.innerHTML = formatAIResponse(fullTextRef);
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
      renderKaTeX();
    } else if (!aiBubble && !thinkingRow) {
      addMessage('Lo siento, hubo un error al procesar tu mensaje. Intenta de nuevo.', 'ai');
    }
  } catch (err) {
    hideTyping();
    clearAttachments();
    addMessage('Error: ' + (err.message || 'Error de conexión'), 'ai');
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

function formatCost(cost) {
  return '$' + Number(cost).toFixed(4);
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
        saveUserToLocalStorage({
          email: sessionState.email,
          name: sessionState.name,
          role: sessionState.role,
          onboarding_status: u.onboarding_status || 'pending',
        });
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
    if (userNameEl) userNameEl.textContent = sessionState.name || sessionState.email || 'Usuario';
    if (avatarEl) avatarEl.textContent = (sessionState.name || sessionState.email || '?')[0].toUpperCase();

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
}

function closeContextPanel() {
  document.getElementById('contextPanel').classList.remove('open');
  document.querySelector('.page-content').classList.remove('panel-open');
}

document.addEventListener('DOMContentLoaded', () => {
  updateSessionInfo();
  setInterval(updateSessionInfo, 10000);

  document.getElementById('contextBtn').addEventListener('click', toggleContextPanel);
  document.getElementById('contextPanelClose').addEventListener('click', closeContextPanel);
  document.getElementById('homeBtn').addEventListener('click', goToHome);
  document.getElementById('sidebarHome').addEventListener('click', goToHome);
  document.getElementById('settingsBtn').addEventListener('click', () => {
    console.log('settings');
  });

  document.getElementById('sidebarCollapseBtn').addEventListener('click', toggleSidebar);
  document.getElementById('sidebarToggleBtn').addEventListener('click', toggleSidebar);
  document.getElementById('sidebarNewChat').addEventListener('click', newChat);

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
      e.preventDefault();
      toggleSidebar();
    }
  });

  document.getElementById('showArchivedBtn').addEventListener('click', toggleArchivedView);

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
});

document.addEventListener('click', (e) => {
  const trigger = e.target.closest('#chatTrigger');
  if (!trigger) return;
  e.preventDefault();
  trigger.style.pointerEvents = 'none';

  // Asegurar sessionId antes de abrir el chat
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    sessionStorage.setItem('chatSessionId', sessionId);
  }

  let count = 0;
  function checkDone() {
    count++;
    if (count === 3) transformBottomBar();
  }

  const l1 = document.getElementById('line1');
  const l2 = document.getElementById('line2');
  const sub = document.getElementById('subtitle');
  if (l1) eraseText(l1, checkDone);
  if (l2) setTimeout(() => eraseText(l2, checkDone), 200);
  if (sub) setTimeout(() => eraseText(sub, checkDone), 400);
});
