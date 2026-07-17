import { initI18n, t } from './lib/i18n.js';
initI18n();

const API_BASE = '';
const screen1 = document.getElementById('screen1');
const screen2 = document.getElementById('screen2');
const screen3 = document.getElementById('screen3');
const btnArrow = document.getElementById('btnArrow');
const btnContinue = document.getElementById('btnContinue');
const curtain = document.getElementById('curtain');
const emailInput = document.getElementById('emailInput');

const formTitle = screen2.querySelector('.form-title');

// Móviles: al abrir el teclado, visualViewport se achica pero innerHeight no.
// Ajustamos la altura real de screen3 a lo que sí se ve, para que la card
// del OTP quede centrada en el espacio libre y no tape el teclado.
if (window.visualViewport) {
  const syncOtpViewport = () => {
    screen3.style.height = `${window.visualViewport.height}px`;
  };
  window.visualViewport.addEventListener('resize', syncOtpViewport);
  window.visualViewport.addEventListener('scroll', syncOtpViewport);
  syncOtpViewport();
}

const state = {
  email: '',
};

(async function redirectIfAlreadyLoggedIn() {
  try {
    const res = await fetch('/auth/me', { credentials: 'same-origin' });
    if (!res.ok) return;
    const data = await res.json();
    if (data?.email) window.location.href = 'chat.html';
  } catch {}
})();

async function apiRequest(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...options,
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });

  let data = null;
  try { data = await res.json(); } catch {}

  if (!res.ok) {
    const err = new Error(data?.detail || data?.error || `Error ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

function showCurtain() {
  curtain.classList.add('active');
}

function hideCurtain() {
  curtain.classList.remove('active');
}

let otpAttempts = 3;
let otpInterval = null;
let otpSeconds = 300;

const SWEEP_MS = 700;
const INFO_FADE_OUT_MS = 350;

function showOtpScreen(email) {
  document.getElementById('otpEmail').textContent = email;
  hideCurtain();

  const splitLeft = screen2.querySelector('.split-left');
  const splitRight = screen2.querySelector('.split-right');
  const infoWrap = screen2.querySelector('.info-wrap');

  // 1) Lo azul (split-right) recorre hacia la izquierda cubriendo toda la
  //    pantalla, empujando afuera el panel blanco (texto, botones, inputs).
  splitRight.classList.add('cover');
  splitLeft.classList.remove('slide-in');

  setTimeout(() => {
    // 2) Con la pantalla ya cubierta de azul, se apaga el texto "LMS Exam...".
    infoWrap.classList.remove('fade-in');

    setTimeout(() => {
      // 3) Entra la card del OTP con fade-in.
      screen2.classList.remove('active');
      screen3.classList.add('active');
      void screen3.offsetWidth;
      requestAnimationFrame(() => screen3.classList.add('show'));

      startOtpTimer();
      setupOtpInput();
    }, INFO_FADE_OUT_MS);
  }, SWEEP_MS);
}

function startOtpTimer() {
  const timerEl = document.getElementById('otpTimer');
  otpInterval = setInterval(() => {
    otpSeconds--;
    const m = String(Math.floor(otpSeconds / 60)).padStart(2, '0');
    const s = String(otpSeconds % 60).padStart(2, '0');
    timerEl.textContent = `${m}:${s}`;
    if (otpSeconds <= 0) {
      clearInterval(otpInterval);
      triggerOtpFlood('timeout');
    }
  }, 1000);
}

function setupOtpInput() {
  const input = document.getElementById('otpInput');
  const segments = document.querySelectorAll('.otp-segments span');
  const segmentsEl = document.querySelector('.otp-segments');

  function renderOtp() {
    const val = input.value;
    const cursor = input.selectionStart ?? val.length;

    segments.forEach((seg, i) => {
      const newDigit = val[i] || '';
      if (newDigit && newDigit !== seg.textContent) {
        seg.classList.remove('pop');
        void seg.offsetWidth; // reinicia la animación si se reemplaza rápido
        seg.classList.add('pop');
      }
      seg.textContent = newDigit;
      seg.classList.toggle('filled', i < val.length);
      seg.classList.toggle('active', i === cursor && cursor < segments.length);
      seg.classList.remove('error');
    });
  }

  function selectSegment(i) {
    const val = input.value;
    input.focus();
    if (i < val.length) {
      input.setSelectionRange(i, i + 1); // selecciona ese dígito → escribir lo reemplaza
    } else {
      input.setSelectionRange(val.length, val.length);
    }
    renderOtp();
  }

  // Ya cableado en una llamada anterior a setupOtpInput (misma pantalla, reintento) —
  // no dupliques listeners, solo re-enfoca.
  if (input.dataset.wired !== '1') {
    input.dataset.wired = '1';

    input.addEventListener('input', () => {
      const cleaned = input.value.replace(/\D/g, '').slice(0, 6);
      if (cleaned !== input.value) {
        const pos = input.selectionStart;
        input.value = cleaned;
        input.setSelectionRange(pos, pos);
      }
      renderOtp();
      if (cleaned.length === 6) validateOtp(cleaned);
    });

    // El input invisible cubre toda la fila (z-index más alto que los spans),
    // así que el click siempre llega aquí — calculamos a qué segmento
    // corresponde la posición X y seleccionamos ese dígito.
    input.addEventListener('click', (e) => {
      const rect = segmentsEl.getBoundingClientRect();
      const segWidth = rect.width / segments.length;
      const idx = Math.max(0, Math.min(Math.floor((e.clientX - rect.left) / segWidth), segments.length - 1));
      selectSegment(idx);
    });

    // Flechas (izq/der, Home/End) mueven el cursor sin disparar 'input' —
    // selectionchange sí se dispara, así el resaltado ".active" las sigue.
    document.addEventListener('selectionchange', () => {
      if (document.activeElement !== input) return;
      renderOtp();
    });
  }

  input.focus();
  renderOtp();
}

async function validateOtp(code) {
  try {
    await apiRequest('/auth/verify', { method: 'POST', body: { email: state.email, otp: code } });
    triggerOtpFlood('success');
  } catch (err) {
    otpAttempts--;
    const attemptsEl = document.getElementById('otpAttempts');
    attemptsEl.textContent = `${otpAttempts} ${otpAttempts === 1 ? t('attemptSingular') : t('attemptPlural')}`;

    document.querySelectorAll('.otp-segments span').forEach(s => {
      s.classList.add('error');
    });

    document.getElementById('otpInput').value = '';
    document.querySelectorAll('.otp-segments span').forEach(s => {
      s.textContent = '';
      s.classList.remove('error', 'filled', 'active', 'pop');
    });

    if (otpAttempts <= 0) {
      triggerOtpFlood('fail');
    }
  }
}

const CARD_HIDE_MS = 400;
const WHITEOUT_MS = 500;

function triggerOtpFlood(reason) {
  clearInterval(otpInterval);

  if (reason === 'success') {
    // 1) La card se queda en blanco liso (se apaga solo su contenido).
    document.getElementById('otpCardBody').classList.add('hide');

    setTimeout(() => {
      // 2) Toda la pantalla se cubre de blanco.
      document.getElementById('whiteout').classList.add('show');

      setTimeout(() => {
        // 3) Ya todo blanco, se navega a chat.html.
        window.location.href = 'chat.html';
      }, WHITEOUT_MS);
    }, CARD_HIDE_MS);
  } else {
    const flood = document.getElementById('otpFlood');
    flood.classList.add('active');

    screen3.classList.remove('active', 'show');
    screen1.classList.add('active');

    // Deja screen2 listo para repetir la animación de entrada la próxima vez
    // (split-right vuelve a 50vw; split-left/info-wrap ya quedaron reseteados
    // por el propio sweep de showOtpScreen).
    screen2.querySelector('.split-right').classList.remove('cover');

    otpAttempts = 3;
    otpSeconds = 300;
    flood.classList.remove('active');
    document.getElementById('otpCard').classList.remove('visible');
    document.getElementById('otpInput').value = '';
    document.querySelectorAll('.otp-segments span').forEach(s => {
      s.textContent = '';
      s.classList.remove('error', 'filled', 'active', 'pop');
    });
  }
}

function setEmailLoading(loading) {
  btnContinue.disabled = loading;
  btnContinue.textContent = loading ? t('sending') : t('continueBtn');
}

async function handleRequestOtp() {
  const email = emailInput.value.trim().toLowerCase();

  if (!email || !email.includes('@')) {
    formTitle.textContent = t('invalidEmail');
    formTitle.style.color = '#e53935';
    setTimeout(() => {
      formTitle.style.color = '#1a1a1a';
      formTitle.textContent = t('loginTitle');
    }, 2000);
    return;
  }

  setEmailLoading(true);

  try {
    await apiRequest('/auth/login', { method: 'POST', body: { email } });
    state.email = email;
    showCurtain();
    showOtpScreen(email);
  } catch (err) {
    if (err.status === 429) {
      formTitle.textContent = t('tooManyRequests');
      formTitle.style.color = '#e53935';
      setTimeout(() => {
        formTitle.style.color = '#1a1a1a';
        formTitle.textContent = t('loginTitle');
      }, 3000);
    } else {
      state.email = email;
      showCurtain();
      showOtpScreen(email);
    }
  } finally {
    setEmailLoading(false);
  }
}

// Entrada del botón: fade-in y, al terminar, un pulso de glow que rodea el
// botón (el mismo se repite en cada hover vía CSS, ver .btn-arrow:hover).
requestAnimationFrame(() => {
  btnArrow.classList.add('visible');
  btnArrow.addEventListener('transitionend', function onFadeInDone(e) {
    if (e.propertyName !== 'opacity') return;
    btnArrow.removeEventListener('transitionend', onFadeInDone);
    btnArrow.classList.add('enter-glow');
  });
});
btnArrow.addEventListener('animationend', () => {
  btnArrow.classList.remove('enter-glow');
});

const FADE_OUT_MS = 500;

btnArrow.addEventListener('click', () => {
  screen1.classList.add('fade-out');

  setTimeout(() => {
    screen1.classList.remove('active', 'fade-out');
    screen2.classList.add('active');

    const splitLeft = screen2.querySelector('.split-left');
    const infoWrap = screen2.querySelector('.info-wrap');

    // Fuerza un reflow para que el navegador registre el estado inicial
    // (fuera de pantalla / invisible) antes de animar — si no, se "precarga"
    // directo en la posición final sin recorrer nada.
    void splitLeft.offsetWidth;

    requestAnimationFrame(() => {
      splitLeft.classList.add('slide-in');
      infoWrap.classList.add('fade-in');
    });
  }, FADE_OUT_MS);
});

btnContinue.addEventListener('click', handleRequestOtp);

emailInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleRequestOtp();
});
