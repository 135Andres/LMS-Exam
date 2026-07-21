import { escapeHtml, formatTime } from './lib/utils.js';
import { t } from './lib/i18n.js';
import { state } from './chat-state.js';
import { handleSend, exitReExplicarMode } from './chat-streaming.js';
import { addMessage, showTyping, hideTyping, addSystemMessage, addSessionDivider } from './chat-messages.js';
import { modelsPromise } from './chat.js';
import { updateSessionInfo } from './chat-context-panel.js';
import { initHeroView } from './chat-hero.js';

let linkModeActive = false;

export const SLASH_COMMANDS = [
  { primary: '/resumen', aliases: ['/resumen', '/resume'], descKey: 'slashSummaryDesc' },
  { primary: '/exportar', aliases: ['/exportar', '/export'], descKey: 'slashExportDesc' },
  { primary: '/help', aliases: ['/help', '/ayuda'], descKey: 'slashHelpDesc' },
];

let slashMenuActive = false;
let slashMenuIndex = 0;
let slashMenuMatches = [];

export function updatePlusButton() {
  const model = state.availableModels.find(m => m.id === state.selectedModelId);
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
  if (topSelect && state.selectedModelId) topSelect.value = state.selectedModelId;
}

function populateTopBarModels() {
  const topSelect = document.getElementById('topBarModelSelect');
  if (!topSelect) return;
  // Repobla siempre (idempotente) — antes se marcaba "ya poblado" en la
  // primera llamada aunque availableModels siguiera vacío por una carga
  // lenta/fallida, y el selector se quedaba vacío hasta recargar la página.
  topSelect.innerHTML = '';
  state.availableModels.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    topSelect.appendChild(opt);
  });
  if (state.selectedModelId) topSelect.value = state.selectedModelId;
  updatePlusButton();

  if (!topSelect._changeWired) {
    topSelect._changeWired = true;
    topSelect.addEventListener('change', () => {
      state.selectedModelId = topSelect.value;
      updatePlusButton();
      updateSessionInfo();
    });
  }
}

// Construye el input de chat en el bottom-bar y arranca todas las interacciones.
export function setupChatInput() {
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
    if (state.activeLinks.length === 0) {
      chatLinksList.innerHTML = '';
      chatLinksList.style.display = 'none';
      return;
    }
    chatLinksList.style.display = 'flex';
    chatLinksList.innerHTML = state.activeLinks.map((link, i) =>
      `<span class="link-chip">${escapeHtml(link)}<button class="link-chip-remove" data-index="${i}">&times;</button></span>`
    ).join('');
    chatLinksList.querySelectorAll('.link-chip-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index);
        state.activeLinks.splice(idx, 1);
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
              stream.getTracks().forEach(track => track.stop());
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
        state.pendingAttachments.push(att);
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
        state.pendingAttachments.push(att);
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
          state.pendingAttachments.push({ type, mime: file.type, data, name: file.name });
          renderAttachmentPreviews();
        };
        reader.readAsDataURL(file);
      }
      return;
    }

    // Arrastrado desde otra web (imagen o link) — viene como URL, no archivo.
    const draggedUrl = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (draggedUrl && /^https?:\/\//i.test(draggedUrl) && !state.activeLinks.includes(draggedUrl)) {
      state.activeLinks.push(draggedUrl);
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
          if (state.activeLinks.includes(url)) {
            const label = linkModeBar.querySelector('span');
            label.textContent = t('linkAlreadyAdded');
            msgInput.value = '';
            setTimeout(() => {
              label.textContent = t('linkModePlaceholder');
            }, 1500);
          } else {
            state.activeLinks.push(url);
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
  if (!state.sessionState.chatCreated) {
    state.sessionState.chatCreated = formatTime();
  }
  // Al entrar a la página siempre arranca en "new" (hero) — el historial de
  // la última sesión solo se retoma si el usuario lo abre a propósito desde
  // el sidebar (loadSession), no automáticamente al cargar/navegar aquí.
  initHeroView();
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
  state.pendingAttachments.forEach((att, i) => {
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
      state.pendingAttachments.splice(i, 1);
      renderAttachmentPreviews();
    });
    container.appendChild(chip);
  });
}

export function clearAttachments() {
  state.pendingAttachments = [];
  state.activeLinks = [];
  const container = document.getElementById('attachmentPreviews');
  if (container) container.innerHTML = '';
  const linksList = document.getElementById('chatLinksList');
  if (linksList) { linksList.innerHTML = ''; linksList.style.display = 'none'; }
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

export function closeSlashMenu() {
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

export function executeSlashCommand(primary) {
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

// ── Comando /resumen ("/resume" en inglés) — fuerza compactación y muestra el resumen ──
async function runSummaryCommand() {
  showTyping();
  try {
    const res = await fetch('/api/chat/tutor/summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ sessionId: state.sessionId }),
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
      body: JSON.stringify({ sessionId: state.sessionId }),
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
