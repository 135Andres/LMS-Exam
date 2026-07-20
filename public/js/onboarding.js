// Wizard de personalización — burbujas en el chat, no modal (plan 05).
// El backend (plan 04) es la única fuente de verdad del estado: este módulo
// no persiste nada en localStorage/sessionStorage — cada carga de página
// pregunta /api/chat/tutor/onboarding/state y renderiza lo que corresponda.
import { t } from './lib/i18n.js';
import { escapeHtml, formatTime } from './lib/utils.js';
import { addMessage, hideTyping, handleSend } from './chat.js';

let bannerShown = false;
let bannerEl = null;

async function apiGet(url) {
  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function apiPost(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`onboarding request failed: ${url}`);
  return res.json();
}

function exitHeroIfActive() {
  const pageContent = document.getElementById('pageContent');
  if (pageContent && pageContent.classList.contains('hero-active')) {
    pageContent.classList.remove('hero-active');
  }
  document.getElementById('chatMessages')?.classList.add('open');
}

function labelFor(input, rawValue) {
  const opt = (input.options || []).find(o => o.value === rawValue || o.label === rawValue);
  return opt ? opt.label : rawValue;
}

function summarizeValues(payload, values) {
  const parts = [];
  for (const input of payload.inputs) {
    const v = values[input.id];
    if (Array.isArray(v)) {
      if (v.length) parts.push(v.map(x => labelFor(input, x)).join(', '));
    } else if (typeof v === 'string' && v.trim()) {
      parts.push(labelFor(input, v));
    }
  }
  return parts.join(' · ');
}

function renderUserEcho(text) {
  const chatMessages = document.getElementById('chatMessages');
  if (!chatMessages || !text) return;

  const row = document.createElement('div');
  row.className = 'msg-row msg-user';

  const bubble = document.createElement('div');
  bubble.className = 'bubble-user';
  const textDiv = document.createElement('div');
  textDiv.className = 'bubble-text';
  textDiv.textContent = text;
  bubble.appendChild(textDiv);

  const footer = document.createElement('div');
  footer.className = 'msg-footer';
  const timeSpan = document.createElement('span');
  timeSpan.className = 'msg-time';
  timeSpan.textContent = formatTime();
  footer.appendChild(timeSpan);

  row.appendChild(bubble);
  row.appendChild(footer);

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

// Construye la burbuja del paso actual — chips single/multi/text según el
// payload que manda el backend. Devuelve nada: pinta directo en #chatMessages.
export function renderOnboardingStep(payload) {
  hideTyping();
  exitHeroIfActive();
  const chatMessages = document.getElementById('chatMessages');
  if (!chatMessages) return;

  const row = document.createElement('div');
  row.className = 'msg-row msg-ai onboarding-step-row';

  const bubble = document.createElement('div');
  bubble.className = 'bubble-ai onboarding-step-bubble';

  const progress = document.createElement('div');
  progress.className = 'onboarding-progress';
  const pct = Math.round((payload.step / payload.total) * 100);
  progress.innerHTML = `
    <div class="onboarding-progress-bar"><div class="onboarding-progress-fill" style="width:${pct}%"></div></div>
    <span class="onboarding-progress-label">${escapeHtml(t('onboardingStepLabel').replace('{n}', payload.step).replace('{total}', payload.total))}</span>
  `;
  bubble.appendChild(progress);

  const promptDiv = document.createElement('div');
  promptDiv.className = 'bubble-text onboarding-prompt';
  promptDiv.textContent = payload.prompt;
  bubble.appendChild(promptDiv);

  if (payload.note) {
    const note = document.createElement('div');
    note.className = 'onboarding-note';
    note.textContent = payload.note;
    bubble.appendChild(note);
  }

  const readers = {}; // input.id -> () => string | string[]
  const singleOnlyInput = payload.inputs.length === 1 && payload.inputs[0].kind === 'single';

  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.className = 'onboarding-confirm-btn';
  confirmBtn.textContent = t('onboardingConfirm');

  function isComplete() {
    return payload.inputs.every(input => {
      const v = readers[input.id]();
      return Array.isArray(v) ? v.length > 0 : !!(v && String(v).trim());
    });
  }

  function refreshConfirmState() {
    const complete = isComplete();
    confirmBtn.disabled = !complete;
    confirmBtn.classList.toggle('visible', complete);
  }

  function submit() {
    const values = {};
    for (const input of payload.inputs) values[input.id] = readers[input.id]();
    onAnswer(row, bubble, payload, values);
  }

  payload.inputs.forEach(input => {
    const group = document.createElement('div');
    group.className = 'onboarding-input-group';

    if (input.kind === 'text') {
      const textRow = document.createElement('div');
      textRow.className = 'onboarding-text-row';
      const textInput = document.createElement('input');
      textInput.type = 'text';
      textInput.className = 'onboarding-text-input';
      textInput.placeholder = t('onboardingTypeAnswer');
      textInput.maxLength = 80;
      textInput.addEventListener('input', refreshConfirmState);
      textInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); if (isComplete()) submit(); }
      });
      textRow.appendChild(textInput);
      group.appendChild(textRow);

      if (input.options && input.options.length) {
        const chipsRow = document.createElement('div');
        chipsRow.className = 'onboarding-chip-row';
        input.options.forEach(opt => {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'onboarding-chip';
          chip.textContent = opt.label;
          chip.addEventListener('click', () => {
            textInput.value = opt.value;
            textInput.focus();
            refreshConfirmState();
          });
          chipsRow.appendChild(chip);
        });
        group.appendChild(chipsRow);
      }

      readers[input.id] = () => textInput.value;
    } else if (input.kind === 'single') {
      const chipsRow = document.createElement('div');
      chipsRow.className = 'onboarding-chip-row';
      let selected = null;
      input.options.forEach(opt => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'onboarding-chip';
        const labelSpan = `<span class="onboarding-chip-label">${escapeHtml(opt.label)}</span>`;
        const previewSpan = opt.preview ? `<span class="onboarding-chip-preview">${escapeHtml(opt.preview)}</span>` : '';
        chip.innerHTML = labelSpan + previewSpan;
        chip.addEventListener('click', () => {
          chipsRow.querySelectorAll('.onboarding-chip').forEach(c => c.classList.remove('selected'));
          chip.classList.add('selected');
          selected = opt.value;
          refreshConfirmState();
          if (singleOnlyInput) submit();
        });
        chipsRow.appendChild(chip);
      });
      group.appendChild(chipsRow);
      readers[input.id] = () => selected;
    } else if (input.kind === 'multi') {
      const chipsRow = document.createElement('div');
      chipsRow.className = 'onboarding-chip-row';
      const selected = new Set();
      let otraText = '';
      let otraInput = null;

      input.options.forEach(opt => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'onboarding-chip onboarding-chip-toggle';
        chip.textContent = opt.label;

        if (opt.value === 'otra') {
          chip.addEventListener('click', () => {
            const active = chip.classList.toggle('selected');
            if (active && !otraInput) {
              otraInput = document.createElement('input');
              otraInput.type = 'text';
              otraInput.className = 'onboarding-text-input onboarding-otra-input';
              otraInput.placeholder = t('onboardingOtraPlaceholder');
              otraInput.maxLength = 60;
              otraInput.addEventListener('input', () => { otraText = otraInput.value; refreshConfirmState(); });
              group.appendChild(otraInput);
              otraInput.focus();
            } else if (!active && otraInput) {
              otraInput.remove();
              otraInput = null;
              otraText = '';
            }
            refreshConfirmState();
          });
        } else {
          chip.addEventListener('click', () => {
            chip.classList.toggle('selected');
            if (selected.has(opt.value)) selected.delete(opt.value);
            else selected.add(opt.value);
            refreshConfirmState();
          });
        }
        chipsRow.appendChild(chip);
      });
      group.appendChild(chipsRow);
      readers[input.id] = () => {
        const arr = Array.from(selected);
        if (otraText.trim()) arr.push(otraText.trim());
        return arr;
      };
    }

    bubble.appendChild(group);
  });

  confirmBtn.addEventListener('click', () => { if (isComplete()) submit(); });
  bubble.appendChild(confirmBtn);
  refreshConfirmState();

  row.appendChild(bubble);

  row.style.opacity = '0';
  row.style.transform = 'translateY(8px)';
  row.style.transition = 'opacity 250ms ease, transform 250ms ease';
  chatMessages.prepend(row);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    row.style.opacity = '1';
    row.style.transform = 'translateY(0)';
  }));
  chatMessages.scrollTop = 0;

  ensureSkipLink();
}

function disableStepRow(row) {
  row.querySelectorAll('button, input').forEach(el => { el.disabled = true; });
  row.classList.add('onboarding-step-done');
}

async function onAnswer(row, bubble, payload, values) {
  disableStepRow(row);
  const echoText = summarizeValues(payload, values);
  renderUserEcho(echoText || t('onboardingDone'));

  try {
    const result = await apiPost('/api/chat/tutor/onboarding/answer', { step: payload.step, values });
    if (result.type === 'onboarding_step') {
      renderOnboardingStep(result);
    } else if (result.type === 'onboarding_complete') {
      finishWizard(result.response);
    }
  } catch {
    // Reintenta emitiendo el mismo paso — no se pierde el progreso ya
    // guardado en el backend (el estado ahí es la fuente de verdad).
    renderOnboardingStep({ ...payload, note: t('onboardingRetryNote') });
  }
}

function finishWizard(response) {
  removeSkipLink();
  if (response) addMessage(response, 'ai');
}

function ensureSkipLink() {
  removeSkipLink();
  const chatMessages = document.getElementById('chatMessages');
  const lastStepBubble = chatMessages?.querySelector('.onboarding-step-row:not(.onboarding-step-done) .onboarding-step-bubble');
  if (!lastStepBubble) return;

  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'onboarding-skip-link';
  link.textContent = t('onboardingSkipLink');
  link.addEventListener('click', async () => {
    link.disabled = true;
    const row = lastStepBubble.closest('.onboarding-step-row');
    if (row) disableStepRow(row);
    await runSkip();
  });
  lastStepBubble.appendChild(link);
}

function removeSkipLink() {
  document.querySelectorAll('.onboarding-skip-link').forEach(el => el.remove());
}

async function runSkip() {
  try {
    const result = await apiPost('/api/chat/tutor/onboarding/skip', undefined);
    if (result.response) addMessage(result.response, 'ai');
  } catch {
    /* best-effort — el backend ya quedó en 'skipped' aunque esta respuesta falle */
  }
}

// ── Banner diferido: primer mensaje fue largo/cuestionario, el wizard nunca
// arrancó. Se muestra UNA vez por carga de página; "No, gracias" o ignorarlo
// hasta cerrar la pestaña equivalen a skip (ver pagehide más abajo). ──
function renderBanner() {
  if (bannerShown) return;
  bannerShown = true;

  const pageContent = document.getElementById('pageContent');
  if (!pageContent) return;

  bannerEl = document.createElement('div');
  bannerEl.className = 'onboarding-banner';
  bannerEl.innerHTML = `
    <span class="onboarding-banner-text">${escapeHtml(t('onboardingBannerText'))}</span>
    <div class="onboarding-banner-actions">
      <button type="button" class="onboarding-banner-btn onboarding-banner-now">${escapeHtml(t('onboardingBannerNow'))}</button>
      <button type="button" class="onboarding-banner-btn onboarding-banner-dismiss">${escapeHtml(t('onboardingBannerDismiss'))}</button>
    </div>
  `;
  pageContent.appendChild(bannerEl);

  bannerEl.querySelector('.onboarding-banner-now').addEventListener('click', () => {
    dismissBanner();
    const input = document.getElementById('messageInput');
    if (!input) return;
    input.value = t('onboardingStartTrigger');
    handleSend();
  });

  bannerEl.querySelector('.onboarding-banner-dismiss').addEventListener('click', () => {
    dismissBanner();
    runSkip();
  });
}

function dismissBanner() {
  if (bannerEl) { bannerEl.remove(); bannerEl = null; }
}

// Si el usuario cierra/navega fuera sin decidir, cuenta como skip — sin esto,
// el banner reaparecería en cada carga mientras el estado siga 'pending'.
window.addEventListener('pagehide', () => {
  if (!bannerEl) return;
  try {
    navigator.sendBeacon('/api/chat/tutor/onboarding/skip', new Blob([], { type: 'application/json' }));
  } catch { /* best-effort */ }
});

// Deja de preguntarle al backend una vez que el wizard ya no está 'pending'
// (completed/skipped) — no tiene sentido seguir chequeando por el resto de
// la sesión de pestaña.
let stillRelevant = true;

// Punto de entrada — llamar tras montar el input del chat, en cada carga de
// página. SOLO retoma un wizard ya en curso (current_step > 0); el banner
// diferido NO se decide aquí — un usuario nuevo sin mensajes no debe verlo
// de entrada, solo aparece tras un primer mensaje largo/cuestionario
// (ver maybeOfferDeferredBanner, llamado desde chat.js tras esa respuesta).
export async function initOnboarding() {
  const state = await apiGet('/api/chat/tutor/onboarding/state');
  if (!state) return;

  if (state.state !== 'pending') { stillRelevant = false; return; }
  if (state.step) renderOnboardingStep(state.step);
}

// Llamado por chat.js justo después de que una respuesta NORMAL de la IA
// termina de stremear (es decir, el mensaje NO fue interceptado como paso
// del wizard) — es el único momento en que el banner diferido tiene sentido:
// el usuario ya mandó su primer mensaje y este vino "pasado de largo".
export async function maybeOfferDeferredBanner() {
  if (!stillRelevant || bannerShown) return;
  const state = await apiGet('/api/chat/tutor/onboarding/state');
  if (!state) return;
  if (state.state !== 'pending') { stillRelevant = false; return; }
  if (!state.step) renderBanner();
}
