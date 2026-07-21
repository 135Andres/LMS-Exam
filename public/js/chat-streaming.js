import { formatTime, escapeHtml, svgIcon, formatAIResponse } from './lib/utils.js';
import { notifyIfEnabled } from './lib/settings-modal.js';
import { t } from './lib/i18n.js';
import { renderOnboardingStep, maybeOfferDeferredBanner } from './onboarding.js';
import { state } from './chat-state.js';
import { stripQuizMarker, appendQuizButtons, appendNextStepButton, handleQuizExplainDone } from './chat-quiz-mode.js';
import {
  addMessage, showTyping, hideTyping, handleCopy, togglePinMessage, handleReport, renderKaTeX,
  clearAttachments, updatePlusButton, SLASH_COMMANDS, closeSlashMenu, executeSlashCommand,
  updateSessionInfo, refreshSidebarSessions,
} from './chat.js';

let reExplicarModeActive = false;
let reExplicarTargetRow = null;

const REEXPLICAR_SUGGESTIONS = [
  'con una analogía de cocina',
  'más simple, como si tuviera 10 años',
  'con un ejemplo de la vida diaria',
  'con un diagrama en texto',
];

// Al terminar un stream, el turno del usuario que lo disparó no tenía id todavía
// (se generó server-side) — se lo asignamos al primer .msg-user (el más
// reciente, por el patrón prepend) para que se pueda fijar sin recargar.
function setLastUserMsgId(id) {
  if (!id) return;
  const row = document.querySelector('.msg-row.msg-user');
  if (row && !row.dataset.msgId) row.dataset.msgId = id;
}

// ── "Explícamelo diferente" (regenerar última respuesta de la IA) ──

export function openReExplicarConfirm(msgRow) {
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

export function enterReExplicarMode(msgRow) {
  reExplicarModeActive = true;
  reExplicarTargetRow = msgRow;
  document.querySelector('.chat-input-wrapper')?.classList.add('reexplicar-active');
  const bar = document.getElementById('reexplicarBar');
  if (bar) bar.classList.remove('hidden');
  renderReExplicarSuggestions();
  const input = document.getElementById('messageInput');
  if (input) { input.placeholder = '¿Cómo quieres que te lo expliquen?'; input.focus(); }
}

export function exitReExplicarMode() {
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
      body: JSON.stringify({ sessionId: state.sessionId, modelId: state.selectedModelId || undefined, instruction }),
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

  if (state.pendingAttachments.length > 0) {
    const model = state.availableModels.find(m => m.id === state.selectedModelId);
    if (!model || !model.multimodal) {
      if (!confirm(t('confirmSwitchModel'))) {
        clearAttachments();
        return;
      }
      const mmModel = state.availableModels.find(m => m.multimodal);
      if (mmModel) {
        state.selectedModelId = mmModel.id;
        const topSelect2 = document.getElementById('topBarModelSelect');
        if (topSelect2) topSelect2.value = mmModel.id;
        updatePlusButton();
      }
    }
  }

  const attSnapshot = state.pendingAttachments.slice();
  const linksSnapshot = state.activeLinks.slice();
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
    const body = { message: text, modelId: state.selectedModelId || undefined, sessionId: state.sessionId };
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
            state.sessionId = json.sessionId;
            sessionStorage.setItem('chatSessionId', state.sessionId);
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
