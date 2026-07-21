import { t } from './lib/i18n.js';
import { state } from './chat-state.js';
import { addMessage, showTyping, hideTyping, addSystemMessage } from './chat-messages.js';
import { handleSend } from './chat-streaming.js';

const QUIZ_MARKERS = ['[[QUIZ_DETECTED]]', '[[QUIZ_EXPLAIN_DONE]]'];

export function stripQuizMarker(text) {
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
export function appendQuizButtons(actions, msgRow, quizGoal) {
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

export function appendNextStepButton(actions, quizMarker) {
  if (!quizExplainActive || quizMarker === 'QUIZ_EXPLAIN_DONE') return;
  const nextStepBtn = document.createElement('button');
  nextStepBtn.className = 'msg-action msg-action-quiz';
  nextStepBtn.textContent = t('nextStepBtn');
  nextStepBtn.addEventListener('click', () => handleQuizNextStep());
  actions.appendChild(nextStepBtn);
}

export async function handleQuizResolve(msgRow) {
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
      body: JSON.stringify({ sessionId: state.sessionId, userMsgId }),
    });
    const data = await res.json();
    hideTyping();
    if (!res.ok) {
      addMessage(t('errorPrefix') + ' ' + (data.error || t('quizSolveFailed')), 'ai');
      return;
    }
    addMessage(data.response, 'ai');
  } catch {
    hideTyping();
    addMessage(t('quizConnError'), 'ai');
  }
}

export function triggerVisibleMessage(text) {
  const input = document.getElementById('messageInput');
  input.value = text;
  handleSend();
}

export async function handleQuizExplain() {
  try {
    const res = await fetch('/api/chat/tutor/quiz/explain-start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ sessionId: state.sessionId }),
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

export function handleQuizExplainDone() {
  quizExplainActive = false;
  fetch('/api/chat/tutor/quiz/explain-end', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ sessionId: state.sessionId }),
  }).catch(() => {});
}

export function handleQuizNextStep() {
  triggerVisibleMessage('Siguiente paso.');
}
