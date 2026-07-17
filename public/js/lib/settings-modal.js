// Modal de Settings — compartido entre chat.html y dashboard.html. Asume que
// la página que lo usa ya tiene el markup (#settingsOverlay, #memoryImportOverlay,
// #avatarFileInput, #settingsBtn, etc. — ver chat.html/dashboard.html) y ya
// importa 'Space Mono' / el CSS de welcome.css.
import { escapeHtml, svgIcon, renderAvatarInto } from './utils.js';
import { t, setLanguage } from './i18n.js';

const SETTINGS_CATEGORIES = [
  { key: 'config', labelKey: 'settingsConfig', icon: 'user' },
  { key: 'capacidades', labelKey: 'settingsCapabilities', icon: 'puzzle' },
  { key: 'customize', labelKey: 'settingsCustomize', icon: 'palette' },
];

const MEMORY_IMPORT_PROMPT = `Export all of my stored memories and any context you've learned about me from past conversations. Preserve my words verbatim where possible, especially for instructions and preferences.

## Categories (output in this order):

1. **Instructions**: Rules I've explicitly asked you to follow going forward — tone, format, style, "always do X", "never do Y", and corrections to your behavior. Only include rules from stored memories, not from conversations.

2. **Identity**: Name, age, location, education, family, relationships, languages, and personal interests.

3. **Career**: Current and past roles, companies, and general skill areas.

4. **Projects**: Projects I meaningfully built or committed to. Ideally ONE entry per project. Include what it does, current status, and any key decisions. Use the project name or a short descriptor as the first words of the entry.

5. **Preferences**: Opinions, tastes, and working-style preferences that apply broadly.

## Format:

Use section headers for each category. Within each category, list one entry per line, sorted by oldest date first. Format each line as:

[YYYY-MM-DD] - Entry content here.

If no date is known, use [unknown] instead.

## Output:
- Wrap the entire export in a single code block for easy copying.
- After the code block, state whether this is the complete set or if more remain.`;

const DEFAULT_SETTINGS = {
  language: 'es', theme: 'light', font: 'default',
  reduced_motion: 0, notify_on_response: 0, cross_chat_enabled: 1, avatar_data: null,
};

let settingsData = null;
let settingsActiveCategory = 'config';
let currentUser = { name: '', email: '' };

async function fetchCurrentUser() {
  try {
    const res = await fetch('/api/user/profile', { credentials: 'same-origin' });
    if (res.ok) {
      const data = await res.json();
      const u = data.user || data;
      currentUser.name = u.username || u.name || '';
      currentUser.email = u.email || '';
    }
  } catch {}
}

async function loadSettingsData() {
  try {
    const res = await fetch('/api/user/settings', { credentials: 'same-origin' });
    if (res.ok) {
      const data = await res.json();
      settingsData = { ...DEFAULT_SETTINGS, ...data.settings };
      return;
    }
  } catch {}
  if (!settingsData) settingsData = { ...DEFAULT_SETTINGS };
}

// Aplica lo que ya afecta visualmente sin abrir el modal (fuente, animaciones
// reducidas, idioma) — se llama al boot y cada vez que se guarda un cambio.
// El idioma real de la cuenta vive en el backend, no solo en localStorage —
// sin esto, un browser nuevo (o con localStorage vacío) ignoraría el idioma
// guardado hasta que el usuario abriera el modal y lo tocara.
export function applyPreferencesToDom() {
  if (!settingsData) return;
  document.body.dataset.font = settingsData.font || 'default';
  document.body.classList.toggle('reduced-motion', !!settingsData.reduced_motion);
  if (settingsData.language) setLanguage(settingsData.language);
  if (settingsData.theme) {
    document.documentElement.dataset.theme = settingsData.theme;
    try { localStorage.setItem('lmsTheme', settingsData.theme); } catch {}
  }
}

async function patchSettings(partial) {
  Object.assign(settingsData, partial);
  applyPreferencesToDom();
  try {
    const res = await fetch('/api/user/settings', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify(partial),
    });
    if (res.ok) {
      const data = await res.json();
      settingsData = { ...DEFAULT_SETTINGS, ...data.settings };
      applyPreferencesToDom();
    }
  } catch {}
}

function notifyIfEnabled() {
  if (!settingsData?.notify_on_response) return;
  if (!document.hidden) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  new Notification(t('brand'), { body: t('tutorReplied') });
}

async function openSettingsModal() {
  document.getElementById('settingsOverlay').classList.remove('hidden');
  await Promise.all([loadSettingsData(), fetchCurrentUser()]);
  renderSettingsSidebar();
  renderSettingsSection(settingsActiveCategory);
}

function closeSettingsModal() {
  document.getElementById('settingsOverlay').classList.add('hidden');
}

function renderSettingsSidebar() {
  const sidebar = document.getElementById('settingsSidebar');
  sidebar.innerHTML = SETTINGS_CATEGORIES.map(c => `
    <button class="settings-cat-btn${c.key === settingsActiveCategory ? ' active' : ''}" data-cat="${c.key}">
      ${svgIcon(c.icon, 16)}<span>${escapeHtml(t(c.labelKey))}</span>
    </button>
  `).join('');
  sidebar.querySelectorAll('.settings-cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      settingsActiveCategory = btn.dataset.cat;
      renderSettingsSidebar();
      renderSettingsSection(settingsActiveCategory);
    });
  });
}

function renderSettingsSection(key) {
  const content = document.getElementById('settingsContent');
  if (key === 'config') { content.innerHTML = configSectionHtml(); wireConfigSection(); }
  else if (key === 'capacidades') { content.innerHTML = capacidadesSectionHtml(); wireCapacidadesSection(); }
  else { content.innerHTML = customizeSectionHtml(); }
}

function configSectionHtml() {
  const initial = (currentUser.name || currentUser.email || '?')[0]?.toUpperCase() || '?';
  const avatarInner = settingsData.avatar_data ? `<img src="${settingsData.avatar_data}" alt="avatar">` : initial;
  return `
    <h3 class="settings-section-title">${escapeHtml(t('settingsConfig'))}</h3>

    <div class="settings-group">
      <div class="settings-group-label">${escapeHtml(t('settingsAccount'))}</div>
      <div class="settings-row" style="align-items:flex-start;">
        <button class="settings-avatar-btn" id="settingsAvatarBtn" type="button" title="${escapeHtml(t('settingsChangePhoto'))}">${avatarInner}</button>
        <div style="flex:1;">
          <input type="text" class="settings-text-input" id="settingsNameInput" placeholder="${escapeHtml(t('settingsNamePlaceholder'))}" value="${escapeHtml(currentUser.name || '')}">
        </div>
      </div>
      <div class="settings-row">
        <span class="settings-row-label">${escapeHtml(t('settingsLanguage'))}</span>
        <select class="settings-select" id="settingsLanguageSelect">
          <option value="es"${settingsData.language === 'es' ? ' selected' : ''}>Español</option>
          <option value="en"${settingsData.language === 'en' ? ' selected' : ''}>English</option>
        </select>
      </div>
    </div>

    <div class="settings-divider"></div>

    <div class="settings-group">
      <div class="settings-group-label">${escapeHtml(t('settingsPreferences'))}</div>
      <div class="settings-row">
        <span class="settings-row-label">${escapeHtml(t('settingsAppearance'))}</span>
        <select class="settings-select" id="settingsThemeSelect">
          <option value="light"${settingsData.theme === 'light' ? ' selected' : ''}>${escapeHtml(t('themeLight'))}</option>
          <option value="dark"${settingsData.theme === 'dark' ? ' selected' : ''}>${escapeHtml(t('themeDark'))}</option>
        </select>
      </div>
      <div class="settings-row">
        <span class="settings-row-label">${escapeHtml(t('settingsFont'))}</span>
        <select class="settings-select" id="settingsFontSelect">
          <option value="default"${settingsData.font === 'default' ? ' selected' : ''}>${escapeHtml(t('fontDefault'))}</option>
          <option value="serif"${settingsData.font === 'serif' ? ' selected' : ''}>${escapeHtml(t('fontSerif'))}</option>
          <option value="mono"${settingsData.font === 'mono' ? ' selected' : ''}>${escapeHtml(t('fontMono'))}</option>
        </select>
      </div>
      <div class="settings-row">
        <span class="settings-row-label">${escapeHtml(t('settingsAnimations'))}</span>
        <select class="settings-select" id="settingsMotionSelect">
          <option value="0"${!settingsData.reduced_motion ? ' selected' : ''}>${escapeHtml(t('motionDefault'))}</option>
          <option value="1"${settingsData.reduced_motion ? ' selected' : ''}>${escapeHtml(t('motionReduced'))}</option>
        </select>
      </div>
    </div>

    <div class="settings-divider"></div>

    <div class="settings-group">
      <div class="settings-group-label">${escapeHtml(t('settingsNotifications'))}</div>
      <div class="settings-row">
        <div>
          <div class="settings-row-label">${escapeHtml(t('settingsMessageNotif'))}</div>
          <div class="settings-row-desc">${escapeHtml(t('settingsMessageNotifDesc'))}</div>
        </div>
        <label class="settings-switch">
          <input type="checkbox" id="settingsNotifySwitch"${settingsData.notify_on_response ? ' checked' : ''}>
          <span class="settings-switch-track"></span>
        </label>
      </div>
    </div>
  `;
}

function wireConfigSection() {
  document.getElementById('settingsAvatarBtn').addEventListener('click', () => {
    document.getElementById('avatarFileInput').click();
  });

  document.getElementById('settingsNameInput').addEventListener('blur', async (e) => {
    const value = e.target.value.trim();
    if (!value || value === currentUser.name) return;
    try {
      await fetch('/api/user/username', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ username: value }),
      });
      currentUser.name = value;
      window.dispatchEvent(new CustomEvent('lms:profile-updated', { detail: { name: value } }));
    } catch {}
  });

  document.getElementById('settingsLanguageSelect').addEventListener('change', e => {
    patchSettings({ language: e.target.value });
    setLanguage(e.target.value);
    // El modal mismo tiene texto armado con t() en las plantillas — re-renderizar
    // para que se vea en el idioma nuevo sin tener que cerrar/abrir el modal.
    renderSettingsSidebar();
    renderSettingsSection(settingsActiveCategory);
  });
  document.getElementById('settingsThemeSelect').addEventListener('change', e => {
    patchSettings({ theme: e.target.value });
    window.dispatchEvent(new CustomEvent('lms:theme-changed', { detail: { theme: e.target.value } }));
  });
  document.getElementById('settingsFontSelect').addEventListener('change', e => patchSettings({ font: e.target.value }));
  document.getElementById('settingsMotionSelect').addEventListener('change', e => patchSettings({ reduced_motion: e.target.value === '1' }));

  document.getElementById('settingsNotifySwitch').addEventListener('change', async (e) => {
    if (e.target.checked && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { e.target.checked = false; return; }
    }
    patchSettings({ notify_on_response: e.target.checked });
  });
}

function capacidadesSectionHtml() {
  return `
    <h3 class="settings-section-title">${escapeHtml(t('settingsCapabilities'))}</h3>
    <div class="settings-group">
      <div class="settings-group-label">${escapeHtml(t('settingsMemory'))}</div>
      <div class="settings-row">
        <div>
          <div class="settings-row-label">${escapeHtml(t('settingsCrossChats'))}</div>
          <div class="settings-row-desc">${escapeHtml(t('settingsCrossChatsDesc'))}</div>
        </div>
        <label class="settings-switch">
          <input type="checkbox" id="settingsCrossChatSwitch"${settingsData.cross_chat_enabled ? ' checked' : ''}>
          <span class="settings-switch-track"></span>
        </label>
      </div>
      <div class="settings-row">
        <div>
          <div class="settings-row-label">${escapeHtml(t('settingsImportMemory'))}</div>
          <div class="settings-row-desc">${escapeHtml(t('settingsImportMemoryDesc'))}</div>
        </div>
        <button class="settings-select" id="openMemoryImportBtn" type="button">${escapeHtml(t('settingsImportBtn'))}</button>
      </div>
    </div>
  `;
}

function wireCapacidadesSection() {
  document.getElementById('settingsCrossChatSwitch').addEventListener('change', e => patchSettings({ cross_chat_enabled: e.target.checked }));
  document.getElementById('openMemoryImportBtn').addEventListener('click', openMemoryImportModal);
}

function customizeSectionHtml() {
  return `
    <h3 class="settings-section-title">${escapeHtml(t('settingsCustomize'))}</h3>
    <div class="settings-group">
      <div class="settings-group-label">${escapeHtml(t('settingsSkills'))}</div>
      <div class="settings-stub">${escapeHtml(t('settingsSkillsStub'))}</div>
    </div>
  `;
}

function openMemoryImportModal() {
  document.getElementById('memoryPromptText').value = MEMORY_IMPORT_PROMPT;
  document.getElementById('memoryImportOverlay').classList.remove('hidden');
}

function closeMemoryImportModal() {
  document.getElementById('memoryImportOverlay').classList.add('hidden');
}

function resizeImageToDataUrl(file, maxSize) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height) { if (width > maxSize) { height = Math.round(height * maxSize / width); width = maxSize; } }
        else if (height > maxSize) { width = Math.round(width * maxSize / height); height = maxSize; }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Llamar una vez por página (chat.js/dashboard.js) en DOMContentLoaded —
// asume que el markup del modal ya está presente en el HTML de esa página.
export function initSettingsModal() {
  document.getElementById('settingsBtn').addEventListener('click', openSettingsModal);
  document.getElementById('settingsCloseBtn').addEventListener('click', closeSettingsModal);
  document.getElementById('settingsOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'settingsOverlay') closeSettingsModal();
  });

  document.getElementById('avatarFileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const dataUrl = await resizeImageToDataUrl(file, 256);
      const res = await fetch('/api/user/avatar', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ avatar: dataUrl }),
      });
      if (res.ok) {
        if (settingsData) settingsData.avatar_data = dataUrl;
        window.dispatchEvent(new CustomEvent('lms:profile-updated', { detail: { avatarData: dataUrl } }));
        if (settingsActiveCategory === 'config') renderSettingsSection('config');
      }
    } catch {}
    e.target.value = '';
  });

  document.getElementById('memoryImportCloseBtn').addEventListener('click', closeMemoryImportModal);
  document.getElementById('memoryImportOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'memoryImportOverlay') closeMemoryImportModal();
  });
  document.getElementById('copyMemoryPromptBtn').addEventListener('click', () => {
    navigator.clipboard?.writeText(MEMORY_IMPORT_PROMPT).catch(() => {});
  });
  document.getElementById('saveMemoryImportBtn').addEventListener('click', async () => {
    const input = document.getElementById('memoryImportInput');
    const text = input.value.trim();
    if (!text) return;
    try {
      await fetch('/api/user/memory-import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ text }),
      });
      input.value = '';
      closeMemoryImportModal();
    } catch {}
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!document.getElementById('memoryImportOverlay').classList.contains('hidden')) { closeMemoryImportModal(); return; }
    if (!document.getElementById('settingsOverlay').classList.contains('hidden')) { closeSettingsModal(); return; }
  });

  loadSettingsData().then(applyPreferencesToDom);
}

// Expuesto para que chat.js dispare la notificación al terminar un streaming.
export { notifyIfEnabled };
