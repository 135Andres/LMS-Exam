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

checkSession();

const line1 = document.getElementById('line1');
const line2 = document.getElementById('line2');
const subtitle = document.getElementById('subtitle');

// ── Iniciar flujo tras cargar perfil ──
setTimeout(() => {
  ensureUserData().then(() => {
    const { state, user } = getUserState();
    if (state === 'ready') {
      const bottomBar = document.getElementById('bottomBar');
      bottomBar.classList.add('slide-up');
      bottomBar.classList.remove('hidden');
      void bottomBar.offsetWidth; // reflow: registra translateY(100%)/opacity:0 antes de animar
      requestAnimationFrame(() => bottomBar.classList.add('in'));

      requestAnimationFrame(() => line1.classList.add('visible'));
      setTimeout(() => line2.classList.add('visible'), 1000);
      setTimeout(() => subtitle.classList.add('visible'), 2000);

      addEditPreferencesBtn();
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

// Botón para re-abrir la encuesta ya completada (usuarios en estado 'ready').
// Reutiliza el mismo círculo flotante inferior-derecho que el onboarding.
function addEditPreferencesBtn() {
  if (document.getElementById('editPreferencesBtn')) return;
  const btn = document.createElement('button');
  btn.className = 'onboarding-float-btn';
  btn.id = 'editPreferencesBtn';
  btn.innerHTML = `<img src="svg/square-pen.svg" width="22" height="22" alt="">`;
  btn.title = 'Editar preferencias del tutor';
  btn.addEventListener('click', () => showOnboardingPopup());
  document.body.appendChild(btn);
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
      el.textContent = ' ';
      el.style.opacity = '0';
      if (onComplete) onComplete();
    }
  }
  requestAnimationFrame(frame);
}

// Al ir a chat.html o dashboard.html: borra el texto del hero y baja la
// navbar hacia afuera de la pantalla, y solo al terminar ambas navega.
function navigateWithExitAnimation(href) {
  const bottomBar = document.getElementById('bottomBar');
  bottomBar.style.pointerEvents = 'none';

  const total = 4; // line1, line2, subtitle, navbar
  let count = 0;
  function checkDone() {
    count++;
    if (count === total) window.location.href = href;
  }

  const l1 = document.getElementById('line1');
  const l2 = document.getElementById('line2');
  const sub = document.getElementById('subtitle');
  if (l1) eraseText(l1, checkDone); else checkDone();
  if (l2) setTimeout(() => eraseText(l2, checkDone), 200); else checkDone();
  if (sub) setTimeout(() => eraseText(sub, checkDone), 400); else checkDone();

  if (bottomBar.classList.contains('in')) {
    bottomBar.addEventListener('transitionend', function onDone(e) {
      if (e.propertyName !== 'transform') return;
      bottomBar.removeEventListener('transitionend', onDone);
      checkDone();
    });
    bottomBar.classList.remove('in'); // reversa: vuelve a translateY(100%)/opacity:0
  } else {
    checkDone();
  }
}

document.addEventListener('click', (e) => {
  const chatTrigger = e.target.closest('#chatTrigger');
  const dashboardTrigger = e.target.closest('#dashboardTrigger');
  const trigger = chatTrigger || dashboardTrigger;
  if (!trigger) return;
  e.preventDefault();
  navigateWithExitAnimation(chatTrigger ? 'chat.html' : 'dashboard.html');
});
