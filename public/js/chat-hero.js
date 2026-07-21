import { t } from './lib/i18n.js';
import { state } from './chat-state.js';
import { handleSend } from './chat-streaming.js';
import { addMessage } from './chat-messages.js';
import { setChatTitleRaw } from './chat-sessions.js';

// ── Hero (reemplaza a welcome.html) — se muestra solo si la sesión está vacía ──

export async function initHeroView() {
  document.getElementById('pageContent').classList.add('hero-active');

  // El hero siempre representa un chat todavía sin crear — genera un
  // sessionId nuevo aquí (mismo patrón que newChat()) para no arrastrar el
  // de la sesión anterior que quedó en sessionStorage.
  state.sessionId = crypto.randomUUID();
  sessionStorage.setItem('chatSessionId', state.sessionId);
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

export function playHeroToChatMorph(onComplete) {
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
