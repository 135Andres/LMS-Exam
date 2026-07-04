const API_BASE = '';
const screen1 = document.getElementById('screen1');
const screen2 = document.getElementById('screen2');
const screen3 = document.getElementById('screen3');
const btnArrow = document.getElementById('btnArrow');
const btnContinue = document.getElementById('btnContinue');
const curtain = document.getElementById('curtain');
const spinner = document.getElementById('spinner');
const emailInput = document.getElementById('emailInput');
const otpInput = document.getElementById('otpInput');

const formTitle = screen2.querySelector('.form-title');

const state = {
  email: '',
  otpRequested: false,
  resendCooldown: 0,
};

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

function showOtpScreen(email) {
  document.getElementById('otpEmail').textContent = email;
  screen2.classList.remove('active');
  screen3.classList.add('active');
  hideCurtain();
  startOtpTimer();
  setupOtpInput();
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

  input.addEventListener('input', () => {
    const val = input.value.replace(/\D/g, '').slice(0, 6);
    input.value = val;

    segments.forEach((seg, i) => {
      seg.textContent = val[i] || '';
      seg.classList.toggle('filled', i < val.length);
      seg.classList.toggle('active', i === val.length);
      seg.classList.remove('error');
    });

    if (val.length === 6) validateOtp(val);
  });

  input.focus();
}

async function validateOtp(code) {
  try {
    await apiRequest('/auth/verify', { method: 'POST', body: { email: state.email, otp: code } });
    triggerOtpFlood('success');
  } catch (err) {
    otpAttempts--;
    const attemptsEl = document.getElementById('otpAttempts');
    attemptsEl.textContent = `${otpAttempts} intento${otpAttempts !== 1 ? 's' : ''} restante${otpAttempts !== 1 ? 's' : ''}`;

    document.querySelectorAll('.otp-segments span').forEach(s => {
      s.classList.add('error');
    });

    document.getElementById('otpInput').value = '';
    document.querySelectorAll('.otp-segments span').forEach(s => {
      s.textContent = '';
      s.classList.remove('error', 'filled', 'active');
    });

    if (otpAttempts <= 0) {
      triggerOtpFlood('fail');
    }
  }
}

function triggerOtpFlood(reason) {
  clearInterval(otpInterval);
  const flood = document.getElementById('otpFlood');
  flood.classList.add('active');

  if (reason === 'success') {
    window.location.href = 'welcome.html';
  } else {
    screen3.classList.remove('active');
    screen1.classList.add('active');

    otpAttempts = 3;
    otpSeconds = 300;
    flood.classList.remove('active');
    document.getElementById('otpCard').classList.remove('visible');
    document.getElementById('otpInput').value = '';
    document.querySelectorAll('.otp-segments span').forEach(s => {
      s.textContent = '';
      s.classList.remove('error', 'filled', 'active');
    });
  }
}

function setEmailLoading(loading) {
  btnContinue.disabled = loading;
  btnContinue.textContent = loading ? 'Enviando...' : 'Continuar';
}

async function handleRequestOtp() {
  const email = emailInput.value.trim().toLowerCase();

  if (!email || !email.includes('@')) {
    formTitle.textContent = 'Correo inválido';
    formTitle.style.color = '#e53935';
    setTimeout(() => {
      formTitle.style.color = '#1a1a1a';
      formTitle.textContent = 'Inicia sesión';
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
      formTitle.textContent = 'Demasiadas solicitudes. Espera un momento.';
      formTitle.style.color = '#e53935';
      setTimeout(() => {
        formTitle.style.color = '#1a1a1a';
        formTitle.textContent = 'Inicia sesión';
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

btnArrow.addEventListener('click', () => {
  screen1.classList.remove('active');
  screen2.classList.add('active');
});

btnContinue.addEventListener('click', handleRequestOtp);

emailInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleRequestOtp();
});
