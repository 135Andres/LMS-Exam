import { formatTime, escapeHtml, svgIcon, formatAIResponse } from './lib/utils.js';
import { t } from './lib/i18n.js';
import { wrapBareLatex } from './lib/latex-detect.js';
import { state } from './chat-state.js';
import { stripQuizMarker, appendQuizButtons, appendNextStepButton, handleQuizExplainDone } from './chat-quiz-mode.js';
import { openReExplicarConfirm, handleSend } from './chat-streaming.js';
import { loadSession } from './chat-sessions.js';
import { closeContextPanel } from './chat-context-panel.js';

export function renderKaTeX() {
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
      catch { return '\\[' + expr + '\\]'; }
    });
    replaced = replaced.replace(/\$\$(.+?)\$\$/gs, function (_, expr) {
      try { return katex.renderToString(expr, { displayMode: true, throwOnError: false }); }
      catch { return '$$' + expr + '$$'; }
    });
    replaced = replaced.replace(/\\\((.+?)\\\)/gs, function (_, expr) {
      try { return katex.renderToString(expr, { displayMode: false, throwOnError: false }); }
      catch { return '\\(' + expr + '\\)'; }
    });
    replaced = replaced.replace(/\$(.+?)\$/g, function (_, expr) {
      try { return katex.renderToString(expr, { displayMode: false, throwOnError: false }); }
      catch { return '$' + expr + '$'; }
    });
    if (replaced !== html) {
      el.innerHTML = replaced;
      el.dataset.katexRendered = '1';
    }
  }
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
        img.addEventListener('click', () => openLightbox(dataUrl, att.name || 'image', img));
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

export function showTyping() {
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

export function handleCopy(text, btn) {
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

// Mensaje de sistema: NO es respuesta de la IA (sin botones de copiar/reportar,
// formato visual distinto — recuadro punteado, monoespaciado).
export function addSystemMessage(html) {
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

// ── Notas rápidas (fijar mensajes) ──

export async function togglePinMessage(msgRow, btn) {
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

export async function fetchPinnedMessages() {
  try {
    const res = await fetch('/api/chat/pinned', { credentials: 'same-origin' });
    if (!res.ok) return [];
    const data = await res.json();
    return data.messages || [];
  } catch {
    return [];
  }
}

export function renderPinnedSection(pinned) {
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
  if (targetSessionId !== state.sessionId) {
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
export function addSessionDivider(label) {
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

export async function handleReport(aiText, msgRow, btn) {
  if (btn.dataset.reported === 'true') return;
  const chatMessages = document.getElementById('chatMessages');
  const userRows = chatMessages.querySelectorAll('.msg-row.msg-user');
  let userPrompt = '';
  if (userRows.length > 0) {
    const lastUser = userRows[0];
    const textEl = lastUser.querySelector('.bubble-text');
    if (textEl) userPrompt = textEl.textContent;
  }
  try {
    const res = await fetch('/api/chat/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        aiMessage: aiText,
        userPrompt: userPrompt,
        sessionId: state.sessionId,
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
