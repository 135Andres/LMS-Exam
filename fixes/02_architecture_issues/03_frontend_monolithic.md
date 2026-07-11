# ARQUITECTURA #3: Frontend Monolítico (welcome.js 2059+ líneas)

## ESTADO
Bug confirmado en código (`public/js/welcome.js` = 2059 líneas)

## OBJETIVO ESPECÍFICO
Modularizar `welcome.js` en ES modules por dominio funcional, con estado reactivo minimal, API client y componentes compartidos.

## PROBLEMA ACTUAL

**`welcome.js`: 2059 líneas, TODO en un archivo:**
| Funcionalidad | Líneas aprox | Problema |
|---------------|--------------|----------|
| Auth/session check | 1-11 | Mezclado con UI |
| KaTeX rendering | 13-41 | Acoplado a DOM específico |
| Model selection | 43-49, 66-81, 760-780 | Estado global disperso |
| Chat history/sessions | 83-271 | Lógica de negocio + DOM |
| Sidebar (archived, groups) | 127-271 | Renderizado manual HTML strings |
| Onboarding flow | 388-638 | Estado complejo, hardcoded steps |
| Hero animations | 659-705 | Mezclado con app logic |
| Chat input/attachments | 807-1143 | 337 líneas solo input handling |
| Message rendering | 1146-1260 | HTML strings, KaTeX re-render |
| Typing indicator | 1262-1286 | Simple pero acoplado |
| Attachment previews | 1288-1327 | Duplica lógica input |
| Lightbox, copy, edit, retry, report | 1329-1496 | Cada action = función suelta |
| Non-stream chat (sendToChatAPI) | 1498-1534 | **DEAD CODE** — nunca se llama |
| Stream handling | 1536-1734 | 198 líneas, SSE parsing manual |
| Session state object | 1738-1755 | Estado global sin的类型 safety |
| Context ring | 1757-1790 | UI cálculo de uso de contexto |
| updateSessionInfo (polling) | 1794-1884 | setInterval cada 10s, fetch manual |
| Context panel | 1886-1957 | Render manual |
| Event listeners setup | 1959-2033 | DOMContentLoaded gigante |
| Chat trigger animation | 2035-2059 | Erase + morph texto |

**Problemas adicionales detectados:**
1. **`sendToChatAPI` (línea 1498) es dead code** — existe pero `handleSend` usa streaming directamente. Mover a fallback / eliminar.
2. **`fetchLinkPreview` (línea 52) es un stub** — siempre devuelve `null`, link previews nunca se cargan. Implementar o eliminar el link feature.
3. **No module system:** El archivo entero es código procedural no modular. Imposible tree-shake, importar de otros archivos, testear.
4. **Estado global disperso:** Variables sueltas (`selectedModelId`, `pendingAttachments`, `sessionId`, `historyLoaded`, `linkModeActive`, `activeLinks`) sin estructura.

## SOLUCIÓN: ES Modules por Feature + Estado Centralizado

### Estructura propuesta

```
public/js/
├── main.js                    # Entry point (bootstrap)
├── core/
│   ├── api.js                 # fetch wrappers, auth, errores, CSRF
│   ├── state.js               # Estado reactivo (Proxy/observer)
│   ├── events.js              # Event bus (pub/sub)
│   └── dom.js                 # Helpers DOM (escapeHtml, svgIcon, createElement)
├── features/
│   ├── auth/
│   │   ├── auth.service.js    # checkSession, login, logout
│   │   └── auth.ui.js         # Login form, OTP UI (si se añade)
│   ├── chat/
│   │   ├── chat.service.js    # sendMessage, stream, history, sessions
│   │   ├── chat.ui.js         # Message rendering, bubbles
│   │   ├── chat.input.js      # Input textarea, plus menu, attachments, link mode
│   │   ├── chat.sidebar.js    # Sessions list, archive, delete, groups
│   │   └── chat.context-panel.js # Context ring, session info, polling
│   ├── onboarding/
│   │   ├── onboarding.service.js # Steps, validation, submit
│   │   └── onboarding.ui.js      # Modal, steps rendering
│   ├── models/
│   │   ├── model.service.js   # Fetch models, selection, persist
│   │   └── model.ui.js         # Dropdown, multimodal indicator
│   ├── hero/
│   │   └── hero.animation.js  # eraseText, morphText (hero animations)
│   └── katex/
│       └── katex.renderer.js  # renderMathInElement wrapper
└── shared/
    ├── components/
    │   ├── Modal.js
    │   ├── Dropdown.js
    │   ├── Toast.js           # Notificaciones temporales
    │   └── Lightbox.js
    ├── utils/
    │   ├── dom.js             # escapeHtml, svgIcon, formatTime
    │   ├── date.js            # formatTime, formatDuration
    │   ├── debounce.js        # debounce helper
    │   └── stream.js          # SSE parsing helper (reusable)
    └── constants.js           # SELECTORS, ENDPOINTS, REGEX, ICONS
```

### 1. core/state.js — estado reactivo minimal

```javascript
// public/js/core/state.js
const _state = {
  user: null,                  // Datos del usuario autenticado
  sessionId: '',                // Session de chat actual
  messages: [],                 // Mensajes de la sesión actual
  pendingAttachments: [],       // Adjuntos pendientes
  activeLinks: [],              // Links pendientes (en modo enlace)
  selectedModelId: '',          // Modelo IA seleccionado
  availableModels: [],          // Modelos disponibles
  sidebarOpen: false,
  sidebarCollapsed: false,
  isGenerating: false,          // Flag streaming en curso
  linkModeActive: false,
  linkPreviews: [],             // Previews de links cargados
  contextUsage: 0,              // % de ventana de contexto usado
};

const _listeners = new Map(); // key -> Set<callback>

export function getState() { return _state; }

export function setState(key, value) {
  _state[key] = value;
  if (_listeners.has(key)) _listeners.get(key).forEach(cb => cb(value));
}

export function subscribe(key, callback) {
  if (!_listeners.has(key)) _listeners.set(key, new Set());
  _listeners.get(key).add(callback);
  // Emitir valor actual inmediatamente
  callback(_state[key]);
  return () => _listeners.get(key).delete(callback); // unsub
}
```

### 2. core/api.js — fetch wrapper con auth y errores

```javascript
// public/js/core/api.js
const API_BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });

  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('Sesión expirada');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }

  return res;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) }),
  postStream: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) }),
};
```

### 3. features/chat/chat.service.js — solo lógica

```javascript
import { api } from '../../core/api.js';
import { state, setState } from '../../core/state.js';
import { parseSSEStream } from '../../shared/utils/stream.js';

export async function sendMessageStream(message, attachments = [], links = []) {
  const sessionId = state.sessionId || crypto.randomUUID();
  setState('sessionId', sessionId);

  const res = await api.postStream('/chat/tutor/stream', {
    message, modelId: state.selectedModelId, attachments, sessionId, links,
  });

  // SSE stream — helper reusable
  return parseSSEStream(res.body);
}

export async function loadHistory(sessionId, limit = 50) {
  const res = await api.get(`/chat/tutor/history?session_id=${sessionId}&limit=${limit}`);
  const data = await res.json();
  setState('messages', data.messages);
  setState('sessionId', data.sessionId);
  return data;
}

export async function loadSessions(archived = false) {
  const path = archived ? '/chat/sessions/archived' : '/chat/tutor/sessions';
  const res = await api.get(path);
  return res.json();
}

export async function archiveSession(sid) {
  await api.post('/chat/archive', { sessionId: sid });
}
export async function unarchiveSession(sid) {
  await api.post('/chat/unarchive', { sessionId: sid });
}
export async function deleteSession(sid) {
  await api.post('/chat/delete', { sessionId: sid });
}
export async function reportMessage(messageId, reason) {
  await api.post('/chat/report', { messageId, reason });
}
```

### 4. shared/utils/stream.js — SSE parsing reusable

```javascript
// shared/utils/stream.js
export async function* parseSSEStream(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') return;
      try { yield JSON.parse(data); }
      catch { /* línea parcial, ignorar */ }
    }
  }
}
```

### 5. features/chat/chat.ui.js — solo DOM

```javascript
import { state, subscribe, setState } from '../../core/state.js';
import { sendMessageStream, loadHistory } from './chat.service.js';
import { escapeHtml, svgIcon, formatTime } from '../../shared/utils/dom.js';
import { renderKatex } from '../katex/katex.renderer.js';

export function initChatUI() {
  subscribe('messages', renderMessages);
  subscribe('isGenerating', toggleTypingIndicator);

  document.getElementById('sendBtn').addEventListener('click', handleSend);
  document.getElementById('messageInput').addEventListener('keydown', handleKeydown);
}

async function handleSend() {
  const input = document.getElementById('messageInput');
  const text = input.value.trim();
  if (!text && state.pendingAttachments.length === 0) return;

  setState('isGenerating', true);
  input.value = '';

  try {
    const stream = await sendMessageStream(text, state.pendingAttachments);
    setState('pendingAttachments', []);

    for await (const event of stream) {
      if (event.type === 'delta') appendToLastMessage(event.content);
      else if (event.type === 'reasoning') appendReasoning(event.content);
      else if (event.type === 'done') finalizeMessage(event);
    }
    renderKatex();
  } catch (err) {
    showError(err.message);
  } finally {
    setState('isGenerating', false);
  }
}
```

### 6. main.js — bootstrap

```javascript
// public/js/main.js
import { checkSession } from './features/auth/auth.service.js';
import { initChatUI } from './features/chat/chat.ui.js';
import { initSidebar } from './features/chat/chat.sidebar.js';
import { initOnboarding } from './features/onboarding/onboarding.ui.js';
import { initModelSelector } from './features/models/model.ui.js';
import { initContextPanel } from './features/chat/chat.context-panel.js';
import { initHeroAnimation } from './features/hero/hero.animation.js';
import { state, setState } from './core/state.js';

async function bootstrap() {
  const user = await checkSession();
  if (!user) { window.location.href = '/login'; return; }
  setState('user', user);

  // Init features en orden de dependencia
  initModelSelector();
  initSidebar();
  initChatUI();
  initContextPanel();
  initOnboarding();
  initHeroAnimation();

  // Restaurar sesión anterior
  const savedSession = sessionStorage.getItem('chatSessionId');
  if (savedSession) {
    setState('sessionId', savedSession);
    await loadHistory(savedSession);
  }
}

bootstrap();
```

## MIGRACIÓN INCREMENTAL (sin romper)

**Principio:** `welcome.js` queda como orchestrador durante la migración, delegando a módulos extraídos.

### Semana 1: Foundation
- Crear `core/state.js`, `core/api.js`, `core/events.js`
- Crear `shared/utils/dom.js` (extraer `escapeHtml`, `svgIcon`, `formatTime`)
- `welcome.js` importa state/api pero mantiene toda su lógica

### Semana 2: Chat core
- Extraer `chat.service.js` (API calls)
- Extraer `chat.ui.js` (message rendering)
- Extraer `shared/utils/stream.js` (SSE parsing)

### Semana 3: Chat extensions
- `chat.sidebar.js`, `chat.input.js`, `chat.context-panel.js`
- `katex.renderer.js`

### Semana 4: Features restantes
- `onboarding.service/ui.js`
- `model.service/ui.js`
- `hero.animation.js`

### Semana 5: Cleanup
- Eliminar `sendToChatAPI` (dead code)
- Eliminar `fetchLinkPreview` stub (o implementar)
- `welcome.js` queda vacío → borrar o convertir en re-export
- Actualizar `welcome.html` para importar `main.js` como módulo

## MEJORAS ADICIONALES DETECTADAS

1. **Eliminar dead code confirmado:**
   - `sendToChatAPI` (línea 1498) nunca se llama → borrar
   - `fetchLinkPreview` (línea 52) siempre retorna null → borrar o implementar

2. **PWA-ready:** Añadir service worker como módulo separado en `public/sw.js`:

3. **TypeScript opcional (roadmap futuro):** Migrar a TS con `checkJs`:
```json
// tsconfig.json
{
  "compilerOptions": {
    "checkJs": true,
    "allowJs": true,
    "strict": true,
    "module": "ES2022",
    "target": "ES2022",
    "moduleResolution": "bundler"
  },
  "include": ["public/js/**/*.js"]
}
```

4. **Vite como dev server (opcional pero recomendado):**
```json
// package.json
"scripts": {
  "dev:frontend": "vite public --port 3000 --proxy /api=http://localhost:3000",
  "build:frontend": "vite build --outDir dist/public"
}
```

5. **Toast notifications system:** Crear `shared/components/Toast.js` para reemplazar alerts manuales:
```javascript
import { toast } from '../../shared/components/Toast.js';
toast.success('Contribución guardada');
toast.error('Error: ' + err.message);
```

## ARCHIVOS A CREAR (~25 nuevos) + 1 REFACTOR

```
public/js/
├── main.js                        (NUEVO)
├── core/
│   ├── api.js                     (NUEVO)
│   ├── state.js                   (NUEVO)
│   ├── events.js                  (NUEVO)
│   └── dom.js                     (NUEVO)
├── features/
│   ├── auth/
│   │   ├── auth.service.js        (NUEVO)
│   │   └── auth.ui.js             (NUEVO)
│   ├── chat/
│   │   ├── chat.service.js        (NUEVO)
│   │   ├── chat.ui.js             (NUEVO)
│   │   ├── chat.input.js          (NUEVO)
│   │   ├── chat.sidebar.js        (NUEVO)
│   │   └── chat.context-panel.js  (NUEVO)
│   ├── onboarding/
│   │   ├── onboarding.service.js  (NUEVO)
│   │   └── onboarding.ui.js       (NUEVO)
│   ├── models/
│   │   ├── model.service.js       (NUEVO)
│   │   └── model.ui.js            (NUEVO)
│   ├── hero/
│   │   └── hero.animation.js      (NUEVO)
│   └── katex/
│       └── katex.renderer.js      (NUEVO)
├── shared/
│   ├── components/
│   │   ├── Modal.js               (NUEVO)
│   │   ├── Toast.js              (NUEVO)
│   │   └── Lightbox.js           (NUEVO)
│   ├── utils/
│   │   ├── dom.js                 (NUEVO)
│   │   ├── date.js                (NUEVO)
│   │   ├── debounce.js            (NUEVO)
│   │   └── stream.js              (NUEVO)
│   └── constants.js               (NUEVO)
└── welcome.js                     (REFACTOR → eventualmente eliminar)
```
