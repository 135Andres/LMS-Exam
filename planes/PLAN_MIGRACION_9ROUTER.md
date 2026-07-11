# Plan de Implementación: Migración a 9router como Gateway Unificado de IA

## Resumen Ejecutivo

**Objetivo:** Reemplazar el sistema actual de múltiples API keys por modelo (NVIDIA, ZenMux, etc.) con **9router** como gateway único que enruta todas las peticiones a los modelos correspondientes.

**Beneficios:**
- Una sola API key (`9ROUTER_API_KEY`) para todos los modelos
- Gestión centralizada de modelos, fallbacks, rate limits, costos
- Observabilidad unificada (logs, métricas, tracing)
- Cambio de proveedores/models sin deploy de código
- Fallback automático entre proveedores

---

## 1. Análisis de Impacto - Archivos a Modificar

| Archivo | Tipo de Cambio | Descripción |
|---------|----------------|-------------|
| `backend/src/config/index.ts` | **MAJOR** | Eliminar `modelRegistry`, `nvidia`, `zenmux` configs; añadir `nineRouter` config |
| `backend/src/services/ai/nvidia.ts` | **REPLACE** | Nuevo `nineRouter.ts` - cliente unificado |
| `backend/src/services/ai/embeddings.ts` | **MODIFY** | Usar 9router para embeddings |
| `backend/src/services/ai/index.ts` | **MODIFY** | Proveedor único `nineRouter` |
| `backend/src/services/chat.service.ts` | **MODIFY** | `resolveModel()` usa nuevo registry |
| `backend/src/routes/chat.routes.ts` | **MINOR** | Endpoint `/models` lee de 9router |
| `backend/.env` | **CONFIG** | Variables de entorno nuevas |
| `backend-python/main.py` | **NONE** | Auth service no usa IA |

---

## 2. Especificación Técnica de 9router

### API Contract (Asumido - verificar docs oficiales)

```typescript
// Endpoint base: https://api.9router.com/v1 (o custom)

// Chat Completions (OpenAI-compatible)
POST /chat/completions
Headers:
  Authorization: Bearer {9ROUTER_API_KEY}
  Content-Type: application/json
  X-9Router-Model: {model_id}          // Opcional: forzar modelo
  X-9Router-Fallback: {model_id}       // Opcional: fallback
  X-9Router-Tags: "chat,tutor,user123" // Opcional: metadata

Body (OpenAI format):
{
  "model": "auto",  // o model_id específico
  "messages": [...],
  "temperature": 0.5,
  "max_tokens": 4096,
  "stream": true/false,
  "response_format": { "type": "json_object" } // opcional
}

// Embeddings
POST /embeddings
Headers: Authorization: Bearer {9ROUTER_API_KEY}
Body:
{
  "model": "nvidia/nv-embed-v1",  // o "auto"
  "input": "texto",
  "encoding_format": "float"
}

// Models List
GET /models
Headers: Authorization: Bearer {9ROUTER_API_KEY}
Response: { data: [{ id, label, provider, capabilities, pricing, context_length }] }
```

---

## 3. Implementación por Fases

### FASE 1: Configuración y Cliente Base (Día 1)

#### 3.1 Nuevo config: `backend/src/config/nineRouter.ts`
```typescript
import dotenv from 'dotenv';
dotenv.config();

export const nineRouterConfig = {
  apiKey: process.env.NINE_ROUTER_API_KEY || '',
  baseUrl: process.env.NINE_ROUTER_BASE_URL || 'https://api.9router.com/v1',
  timeout: parseInt(process.env.NINE_ROUTER_TIMEOUT_MS || '60000', 10),
  defaultModel: process.env.NINE_ROUTER_DEFAULT_MODEL || 'auto',
  enableFallback: process.env.NINE_ROUTER_ENABLE_FALLBACK !== 'false',
  fallbackModels: (process.env.NINE_ROUTER_FALLBACK_MODELS || '').split(',').filter(Boolean),
  tags: {
    app: 'lms-exam',
    version: process.env.APP_VERSION || 'dev',
  },
};

// Validación al inicio
if (!nineRouterConfig.apiKey && process.env.NODE_ENV === 'production') {
  throw new Error('NINE_ROUTER_API_KEY es requerido en producción');
}
```

#### 3.2 Nuevo cliente: `backend/src/services/ai/nineRouter.ts`
```typescript
import { nineRouterConfig } from '../../config/nineRouter.js';
import { logger } from '../../utils/logger.js';
import type { AIResponse } from '../../types/db.js';

export interface NineRouterOptions {
  temperature?: number;
  signal?: AbortSignal;
  model?: string;           // model_id o 'auto'
  maxTokens?: number;
  responseFormat?: Record<string, unknown>; // json_object, etc.
  stream?: boolean;
  fallbackModel?: string;   // override global fallback
  tags?: string[];          // metadata para observabilidad
  userId?: string;          // para tracking por usuario
}

export interface NineRouterStreamChunk {
  type: 'reasoning' | 'content';
  content: string;
}

export interface ModelInfo {
  id: string;
  label: string;
  provider: string;
  capabilities: string[];
  contextLength: number;
  pricing?: { input: number; output: number };
  multimodal: boolean;
  enabled: boolean;
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const signal = options.signal 
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  
  try {
    return await fetch(url, { ...options, signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildHeaders(options?: NineRouterOptions): Record<string, string> {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${nineRouterConfig.apiKey}`,
    'Content-Type': 'application/json',
    'X-9Router-Tags': [
      nineRouterConfig.tags.app,
      nineRouterConfig.tags.version,
      options?.userId ? `user:${options.userId}` : '',
      ...(options?.tags || [])
    ].filter(Boolean).join(','),
  };
  
  if (options?.model && options.model !== 'auto') {
    headers['X-9Router-Model'] = options.model;
  }
  if (options?.fallbackModel || nineRouterConfig.enableFallback) {
    headers['X-9Router-Fallback'] = options?.fallbackModel || nineRouterConfig.fallbackModels.join(',');
  }
  return headers;
}

export async function* parseNineRouterStream(body: ReadableStream<Uint8Array>): AsyncGenerator<NineRouterStreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    
    for (const line of lines) {
      const t = line.trim();
      if (!t || t === 'data: [DONE]') continue;
      if (t.startsWith('data: ')) {
        try {
          const json = JSON.parse(t.slice(6));
          const reasoning = json.choices?.[0]?.delta?.reasoning_content;
          if (reasoning) yield { type: 'reasoning', content: reasoning };
          const content = json.choices?.[0]?.delta?.content;
          if (content) yield { type: 'content', content };
        } catch { /* skip malformed */ }
      }
    }
  }
}

export async function callNineRouterStream(
  systemPrompt: string,
  userPrompt: string | Array<Record<string, unknown>>,
  options?: NineRouterOptions
): Promise<Response> {
  const model = options?.model || nineRouterConfig.defaultModel;
  const userContent = Array.isArray(userPrompt) ? userPrompt : [{ type: 'text', text: userPrompt }];
  
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    max_tokens: options?.maxTokens ?? 4096,
    stream: true,
  };
  
  if (options?.temperature !== undefined) body.temperature = options.temperature;
  if (options?.responseFormat) body.response_format = options.responseFormat;
  
  logger.debug('Llamada streaming a 9router', { model, temperature: body.temperature });
  
  const response = await fetchWithTimeout(
    `${nineRouterConfig.baseUrl}/chat/completions`,
    { method: 'POST', headers: buildHeaders(options), body: JSON.stringify(body) },
    nineRouterConfig.timeout
  );
  
  if (!response.ok) {
    const errorText = await response.text();
    logger.error('Error streaming 9router', { status: response.status, error: errorText });
    throw new Error(`9router error ${response.status}: ${errorText}`);
  }
  
  return response;
}

export async function callNineRouter(
  systemPrompt: string,
  userPrompt: string | Array<Record<string, unknown>>,
  responseFormat: Record<string, unknown> | null = null,
  options?: NineRouterOptions
): Promise<AIResponse> {
  const model = options?.model || nineRouterConfig.defaultModel;
  const userContent = Array.isArray(userPrompt) ? userPrompt : [{ type: 'text', text: userPrompt }];
  
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    max_tokens: options?.maxTokens ?? 4096,
  };
  
  if (options?.temperature !== undefined) body.temperature = options.temperature;
  if (responseFormat) body.response_format = responseFormat;
  
  const start = Date.now();
  logger.debug('Llamando a 9router', { model, temperature: body.temperature });
  
  const response = await fetchWithTimeout(
    `${nineRouterConfig.baseUrl}/chat/completions`,
    { method: 'POST', headers: buildHeaders(options), body: JSON.stringify(body), signal: options?.signal },
    nineRouterConfig.timeout
  );
  
  const elapsed = Date.now() - start;
  
  if (!response.ok) {
    const errorText = await response.text();
    logger.error('Error en 9router', { status: response.status, error: errorText, elapsed });
    throw new Error(`9router error ${response.status}: ${errorText}`);
  }
  
  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    model?: string;
  };
  
  const content = data.choices?.[0]?.message?.content || '';
  const usage = data.usage || {};
  
  logger.debug('Respuesta de 9router recibida', { 
    elapsed, 
    model: data.model,
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens 
  });
  
  return {
    content,
    usage: {
      promptTokens: usage.prompt_tokens || 0,
      completionTokens: usage.completion_tokens || 0,
    },
  };
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const start = Date.now();
  
  const response = await fetchWithTimeout(
    `${nineRouterConfig.baseUrl}/embeddings`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${nineRouterConfig.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'nvidia/nv-embed-v1', // fijo para embeddings
        input: text,
        encoding_format: 'float',
      }),
    },
    nineRouterConfig.timeout
  );
  
  const elapsed = Date.now() - start;
  
  if (!response.ok) {
    const errorText = await response.text();
    logger.error('Error en 9router embeddings', { status: response.status, error: errorText, elapsed });
    throw new Error(`9router embeddings error ${response.status}: ${errorText}`);
  }
  
  const data = await response.json() as { data: Array<{ embedding: number[] }>; usage: { prompt_tokens: number; total_tokens: number } };
  const vector = data.data[0]?.embedding;
  
  if (!vector || !Array.isArray(vector)) {
    throw new Error('Respuesta de embeddings inválida: falta el vector');
  }
  
  logger.debug('Embedding generado via 9router', { dimensions: vector.length, elapsed });
  return vector;
}

export async function fetchAvailableModels(): Promise<ModelInfo[]> {
  try {
    const response = await fetch(`${nineRouterConfig.baseUrl}/models`, {
      headers: { 'Authorization': `Bearer ${nineRouterConfig.apiKey}` },
    });
    
    if (!response.ok) {
      throw new Error(`Models fetch failed: ${response.status}`);
    }
    
    const data = await response.json() as { data: ModelInfo[] };
    return data.data.filter(m => m.enabled);
  } catch (err) {
    logger.warn('No se pudieron obtener modelos de 9router, usando fallback', { error: (err as Error).message });
    return getFallbackModels();
  }
}

function getFallbackModels(): ModelInfo[] {
  // Fallback hardcoded si 9router no disponible
  return [
    { id: 'deepseek-ai/deepseek-v4-flash', label: 'DeepSeek V4 Flash', provider: 'nvidia', capabilities: ['chat'], contextLength: 128000, pricing: { input: 0.05, output: 0.15 }, multimodal: false, enabled: true },
    { id: 'minimaxai/minimax-m2.7', label: 'MiniMax M2.7', provider: 'nvidia', capabilities: ['chat', 'generate'], contextLength: 128000, pricing: { input: 0.15, output: 0.60 }, multimodal: false, enabled: true },
    { id: 'nvidia/nemotron-3-nano', label: 'Nemotron 3 Nano (multimodal)', provider: 'nvidia', capabilities: ['chat', 'vision'], contextLength: 128000, pricing: { input: 0.10, output: 0.30 }, multimodal: true, enabled: true },
  ];
}
```

### FASE 2: Refactor AI Index (Día 1-2)

#### 3.3 `backend/src/services/ai/index.ts` - Simplificado
```typescript
import { callNineRouter, type NineRouterOptions, generateEmbedding, fetchAvailableModels } from './nineRouter.js';
import { logger } from '../../utils/logger.js';
import type { AIResponse } from '../../types/db.js';

export interface GenerateOptions extends NineRouterOptions {}

export class AiRetryError extends Error {
  public attempts: number;
  public lastError: string;
  constructor(attempts: number, lastError: string) {
    super(`La IA no respondió después de ${attempts} intentos. Último error: ${lastError}`);
    this.name = 'AiRetryError';
    this.attempts = attempts;
    this.lastError = lastError;
  }
}

const RETRY_TEMPERATURES = [0.3, 0.5, 0.7];
const TIMEOUT_MS = 30000;

export async function generateFromAI(
  _providerName: string, // ignored - kept for compat
  systemPrompt: string,
  userPrompt: string | Record<string, unknown>[],
  schema: Record<string, unknown> | null = null,
  options?: GenerateOptions,
): Promise<AIResponse> {
  let lastError: Error | undefined;
  
  for (let attempt = 0; attempt < RETRY_TEMPERATURES.length; attempt++) {
    if (options?.signal?.aborted) {
      logger.warn('Operación cancelada por señal externa', { attempt: attempt + 1 });
      throw new Error('Operación cancelada');
    }
    
    const temperature = options?.temperature ?? RETRY_TEMPERATURES[attempt];
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
    
    let onAbort: (() => void) | null = null;
    if (options?.signal && !options.signal.aborted) {
      onAbort = () => { clearTimeout(timeoutId); controller.abort(); };
      options.signal.addEventListener('abort', onAbort, { once: true });
    }
    
    try {
      logger.info('Intento llamada 9router', { attempt: attempt + 1, temperature, model: options?.model });
      
      const result = await callNineRouter(systemPrompt, userPrompt, schema, {
        ...options,
        temperature,
        signal: controller.signal,
      });
      
      if (onAbort && options?.signal) options.signal.removeEventListener('abort', onAbort);
      clearTimeout(timeoutId);
      
      if (attempt > 0) logger.info('Reintento exitoso', { attempt: attempt + 1, temperature });
      return result;
    } catch (err) {
      if (onAbort && options?.signal) options.signal.removeEventListener('abort', onAbort);
      clearTimeout(timeoutId);
      
      if (options?.signal?.aborted) throw new Error('Operación cancelada');
      
      const error = err as Error;
      lastError = error;
      
      const isTimeout = error.name === 'AbortError';
      const isServerError = /^5\d\d/.test(error.message) || error.message.includes('5xx');
      const isNetworkError = /fetch|network|econnrefused|enotfound|etimedout/i.test(error.message);
      const isParseError = /formato inválido|JSON|Unexpected token|parse/i.test(error.message);
      
      if (isTimeout) logger.warn('Timeout en 9router', { attempt: attempt + 1, temperature });
      else if (isServerError || isNetworkError) logger.warn('Error recuperable 9router', { attempt: attempt + 1, temperature, error: error.message });
      else if (isParseError) logger.warn('Error de parseo 9router', { attempt: attempt + 1, temperature, error: error.message });
      else { logger.error('Error no recuperable 9router', { attempt: attempt + 1, temperature, error: error.message }); throw error; }
      
      if (attempt === RETRY_TEMPERATURES.length - 1) throw new AiRetryError(RETRY_TEMPERATURES.length, error.message);
    }
  }
  
  throw new AiRetryError(RETRY_TEMPERATURES.length, lastError?.message || 'Error desconocido');
}

// Re-export para compatibilidad
export { generateEmbedding, fetchAvailableModels, type NineRouterStreamChunk, parseNineRouterStream, callNineRouterStream } from './nineRouter.js';
```

### FASE 3: Chat Service & Model Resolution (Día 2)

#### 3.4 `backend/src/services/chat.service.ts` - Actualizar `resolveModel`
```typescript
// REEMPLAZAR function resolveModel (líneas 39-48)
import { fetchAvailableModels } from './ai/nineRouter.js';

let modelsCache: Awaited<ReturnType<typeof fetchAvailableModels>> | null = null;
let modelsCacheTime = 0;
const MODELS_CACHE_TTL = 5 * 60 * 1000; // 5 min

async function getModelsRegistry() {
  const now = Date.now();
  if (!modelsCache || now - modelsCacheTime > MODELS_CACHE_TTL) {
    modelsCache = await fetchAvailableModels();
    modelsCacheTime = now;
  }
  return modelsCache;
}

async function resolveModel(modelId?: string) {
  const models = await getModelsRegistry();
  
  // Si no se especifica, usar default de 9router ('auto')
  if (!modelId) {
    return {
      model: 'auto',
      apiKey: '',
      baseUrl: '',
      label: '9router (auto)',
      multimodal: true, // conservador: asumir que auto puede ser multimodal
    };
  }
  
  const entry = models.find(m => m.id === modelId);
  if (!entry) {
    logger.warn('Modelo no encontrado en 9router, usando auto', { modelId });
    return { model: 'auto', apiKey: '', baseUrl: '', label: '9router (auto)', multimodal: true };
  }
  
  return {
    model: entry.id,
    apiKey: '', // 9router usa header Authorization
    baseUrl: '',
    label: entry.label,
    multimodal: entry.multimodal,
  };
}
```

#### 3.5 Actualizar llamadas en `sendChatMessageStream` y `sendChatMessage`
```typescript
// EN AMBAS FUNCIONES: cambiar resolveModel a async
const resolved = await resolveModel(modelId);

// Validación multimodal (línea 142-144 / 223-225)
if (attachments && attachments.length > 0 && !resolved.multimodal) {
  throw new Error(`El modelo **${resolved.label}** no soporta archivos adjuntos.`);
}

// Pasar modelId a generateFromAI (ya no se usa apiKey/baseUrl de resolved)
const result = await generateFromAI('nineRouter', systemPrompt, content, null, {
  model: resolved.model, // pasa el model_id a 9router
  temperature: 0.5,
  signal: controller.signal,
  userId, // para tags en 9router
});
```

### FASE 4: Endpoints y Frontend (Día 2-3)

#### 3.6 `backend/src/routes/chat.routes.ts` - `/models` endpoint
```typescript
import { fetchAvailableModels } from '../services/ai/nineRouter.js';

router.get('/models', async (_req, res) => {
  try {
    const models = await fetchAvailableModels();
    const formatted = models.map(m => ({
      id: m.id,
      label: m.label,
      model: m.id,
      multimodal: m.multimodal,
      contextLength: m.contextLength,
      provider: m.provider,
      pricing: m.pricing,
    }));
    res.json({ models: formatted });
  } catch (err) {
    logger.error('Error fetching models from 9router', { error: (err as Error).message });
    // Fallback estático
    res.json({ models: getFallbackModels() });
  }
});
```

#### 3.7 Frontend: `public/js/features/models/model.service.js` (nuevo módulo)
```javascript
// Cache simple en memoria
let modelsCache = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000;

export async function fetchModels() {
  const now = Date.now();
  if (modelsCache && now - cacheTime < CACHE_TTL) return modelsCache;
  
  try {
    const res = await fetch('/api/chat/models', { credentials: 'same-origin' });
    if (!res.ok) throw new Error('Failed to fetch models');
    const { models } = await res.json();
    modelsCache = models;
    cacheTime = now;
    return models;
  } catch (e) {
    console.warn('Error fetching models, using fallback:', e);
    return getFallbackModels();
  }
}

function getFallbackModels() {
  return [
    { id: 'auto', label: 'Auto (9router)', model: 'auto', multimodal: true, contextLength: 128000 },
    { id: 'deepseek-ai/deepseek-v4-flash', label: 'DeepSeek V4 Flash', model: 'deepseek-ai/deepseek-v4-flash', multimodal: false, contextLength: 128000 },
    { id: 'minimaxai/minimax-m2.7', label: 'MiniMax M2.7', model: 'minimaxai/minimax-m2.7', multimodal: false, contextLength: 128000 },
    { id: 'nvidia/nemotron-3-nano', label: 'Nemotron 3 Nano (multimodal)', model: 'nvidia/nemotron-3-nano', multimodal: true, contextLength: 128000 },
  ];
}

export function invalidateModelsCache() { modelsCache = null; }
```

---

## 4. Variables de Entorno

### `backend/.env` - NUEVAS (añadir)
```env
# 9router Configuration
NINE_ROUTER_API_KEY=sk-9router-xxxxxxxxxxxxxxxx
NINE_ROUTER_BASE_URL=https://api.9router.com/v1
NINE_ROUTER_TIMEOUT_MS=60000
NINE_ROUTER_DEFAULT_MODEL=auto
NINE_ROUTER_ENABLE_FALLBACK=true
NINE_ROUTER_FALLBACK_MODELS=deepseek-ai/deepseek-v4-flash,minimaxai/minimax-m2.7

# OPCIONAL: Para desarrollo local sin 9router
# NINE_ROUTER_API_KEY=dev-key
# NINE_ROUTER_BASE_URL=http://localhost:4000/v1
```

### `backend/.env` - ELIMINAR/DEPRECAR
```env
# ESTAS YA NO SE USAN (comentar o eliminar tras migración)
# NVIDIA_API_KEY=...
# NVIDIA_API_KEY_EMBEDDINGS=...
# NVIDIA_API_KEY_NEMOTRON_NANO=...
# NVIDIA_API_KEY_NEMOTRON_SUPER=...
# NVIDIA_API_KEY_DEEPSEEK=...
# NVIDIA_BASE_URL=...
# NVIDIA_BASE_URL_NEMOTRON_NANO=...
# NVIDIA_BASE_URL_NEMOTRON_SUPER=...
# NVIDIA_BASE_URL_DEEPSEEK=...
# ZENMUX_API_KEY=...
# ZENMUX_BASE_URL=...
# ZENMUX_MODEL_CLAUDE_FABLE_5=...
# ZENMUX_MODEL_CLAUDE_SONNET_5=...
# ZENMUX_MODEL_STEP_3_7_FLASH=...
# ZENMUX_MODEL_GLM_4_7_FLASH=...
```

---

## 5. Testing y Validación

### 5.1 Test Unitario: `backend/src/services/ai/nineRouter.test.ts`
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { callNineRouter, generateEmbedding, fetchAvailableModels } from './nineRouter.js';

describe('nineRouter client', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  
  it('buildHeaders incluye tags y model', () => {
    // test interno o mock fetch
  });
  
  it('callNineRouter envía model y response_format', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: 'test response' } }],
        usage: { prompt_tokens: 10, completion_tokens: 20 },
        model: 'deepseek-ai/deepseek-v4-flash'
      })
    });
    
    const result = await callNineRouter('sys', 'user', { type: 'json_object' }, { model: 'test-model' });
    expect(result.content).toBe('test response');
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/chat/completions'),
      expect.objectContaining({
        body: expect.stringContaining('"model":"test-model"'),
      })
    );
  });
  
  it('generateEmbedding retorna vector', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ embedding: [0.1, 0.2, 0.3] }], usage: { prompt_tokens: 5 } })
    });
    const vec = await generateEmbedding('test');
    expect(vec).toEqual([0.1, 0.2, 0.3]);
  });
});
```

### 5.2 Test Integración: Chat E2E
```bash
# Script de prueba manual
cd backend
NINE_ROUTER_API_KEY=test-key NINE_ROUTER_BASE_URL=http://localhost:4000/v1 npm run dev

# En otra terminal:
curl -X POST http://localhost:3000/api/chat/tutor \
  -H "Content-Type: application/json" \
  -H "Cookie: session_token=..." \
  -d '{"message":"Hola, ¿qué es una derivada?","modelId":"auto"}'
```

### 5.3 Checklist de Validación Pre-Deploy
- [ ] Chat streaming funciona con `modelId: 'auto'`
- [ ] Chat non-streaming funciona
- [ ] Modelos multimodales (imagen/audio) funcionan
- [ ] Embeddings se generan correctamente (RAG funciona)
- [ ] Endpoint `/api/chat/models` retorna lista de 9router
- [ ] Frontend selector de modelos muestra modelos de 9router
- [ ] Fallback automático funciona (simular error 500 en modelo primario)
- [ ] Logs muestran `X-9Router-Tags` con userId, app, version
- [ ] Rate limiting 9router respetado (no 429 inesperados)
- [ ] Cost tracking: `usage.promptTokens` / `completionTokens` correctos

---

## 6. Rollback Plan

Si hay problemas críticos en producción:

1. **Feature flag** en config:
   ```typescript
   // config/index.ts
   export const useNineRouter = process.env.USE_NINE_ROUTER === 'true';
   ```

2. **Mantener código legacy** en `nvidia.ts` y `index.ts` (no eliminar, solo no usar)

3. **Deploy rápido**: `USE_NINE_ROUTER=false npm run deploy` → vuelve a NVIDIA/ZenMux directo

4. **Variables legacy** mantener en `.env` por 2 semanas

---

## 7. Estimación de Esfuerzo

| Fase | Tareas | Tiempo | Riesgo |
|------|--------|--------|--------|
| 1. Config + Cliente 9router | 3 archivos nuevos | 4-6 hrs | Bajo |
| 2. Refactor AI Index | 1 archivo | 2-3 hrs | Bajo |
| 3. Chat Service + Model Resolution | 2 archivos | 3-4 hrs | Medio (streaming) |
| 4. Endpoints + Frontend | 2-3 archivos | 3-4 hrs | Medio |
| 5. Tests + Validación | 3-4 archivos | 4-6 hrs | - |
| **Total** | | **16-23 hrs** | **2-3 días** |

---

## 8. Próximos Pasos Inmediatos

1. **Confirmar specs 9router** - Verificar endpoint exacto, headers, response format
2. **Obtener API key** de 9router para desarrollo
3. **Crear branch** `feat/nine-router-migration`
4. **Implementar FASE 1** (config + cliente)
5. **Probar localmente** con mock server o 9router staging
6. **Iterar FASE 2-4**

---

*Documento generado para implementación inmediata. Ajustar según specs reales de 9router.*