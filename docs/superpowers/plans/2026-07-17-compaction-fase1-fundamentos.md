# Compactación Fase 1 (Fundamentos) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fase 1 del rediseño de compactación (ver `docs/superpowers/specs/2026-07-17-context-compaction-redesign-design.md`): detectar respuestas truncadas del compactador, reescribir su prompt para eliminar ambigüedad y el tope ciego de palabras, y resolver el modelo de compactación dinámicamente según el modelo activo de la sesión (Inkling incluido).

**Architecture:** Tres cambios independientes y acumulativos sobre el pipeline existente de `compactSession`: (1) `nineRouter.ts`/`AIResponse` empiezan a exponer `finish_reason`, (2) `SYSTEM_PROMPT_COMPACTOR` se reescribe sin tope de palabras y sin la palabra "relevante" sin definir, (3) `chat.compaction.service.ts` deja de usar `config.models.insights` fijo y resuelve el modelo vía un mapa estático análogo a `DELEGATE_MODEL_MAP`, más un retry si la respuesta vino truncada.

**Tech Stack:** TypeScript, Node, vitest, 9router (OpenAI-compatible `/v1/chat/completions`).

## Global Constraints

- `finish_reason: 'length'` nunca se acepta como resultado final de una compactación — se reintenta con más presupuesto o se descarta, nunca se guarda un resumen truncado (spec 4.1).
- El prompt del compactor no debe usar la palabra "relevante" sin definir su criterio (spec 3.1).
- El prompt del compactor ya no debe imponer un tope de palabras (spec 3.2) — se elimina la frase "Máximo ~400 palabras".
- El modelo de compactación se resuelve por el último modelo asistente usado en la sesión (`ChatModel.getLastAssistantModel`), no por `config.models.insights` (spec 3.3). Mapa exacto:
  - `ag/gemini-3-flash` → `ag/gemini-3-flash`
  - `ag/gemini-3.1-pro-low` → `ag/gemini-3-flash`
  - `ag/claude-sonnet-4-6` → `ag/gemini-3-flash`
  - `nvidia/z-ai/glm-5.2` → `nvidia/z-ai/glm-5.2`
  - `nvidia/thinkingmachines/inkling` → `nvidia/thinkingmachines/inkling` (Inkling se compacta a sí mismo, confirmado)
  - `oc/deepseek-v4-flash-free` → `oc/deepseek-v4-flash-free`
  - Sin modelo previo (sesión nueva, cursor null) → default `INKLING_MODEL_ID` (es el modelo default del chat, `config/index.ts:31`).
- No tocar `config.models.insights` en sí — sigue usándose en `insights.service.ts`, `chat.cross-reference.service.ts` y `chat.export.service.ts`. Solo `chat.compaction.service.ts` deja de leerlo.
- No implementar todavía el pipeline de 2 pistas (narrativa/bloques), la segunda opinión obligatoria, ni la UI del sidebar — eso es Fase 2+ y no entra en este plan.

---

### Task 1: `finish_reason` en `nineRouter.ts` y `AIResponse`

**Files:**
- Modify: `backend/src/types/db.ts:60-66`
- Modify: `backend/src/services/ai/nineRouter.ts:36-42` (interfaz `NineRouterResponse`), `:47-76` (`parseNineRouterNonStreamResponse`), `:206-224` (`callNineRouter`)
- Test: `backend/src/services/ai/nineRouter.test.ts` (nuevo)

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces: `AIResponse.finishReason?: string` — Task 3 lo lee vía `result.finishReason` (el valor que devuelve `generateFromAI`, que reenvía tal cual lo que devuelve `callNineRouter`, confirmado en `backend/src/services/ai/index.ts:78-95` y `:130-138`, no requiere cambios ahí).

- [ ] **Step 1: Escribir los tests que fallan**

Crear `backend/src/services/ai/nineRouter.test.ts`:

```ts
// backend/src/services/ai/nineRouter.test.ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { callNineRouter } from './nineRouter.js';

describe('callNineRouter — finishReason', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('expone finishReason "length" cuando la respuesta viene truncada por max_tokens', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        choices: [{ message: { content: 'texto cortado a la mit' }, finish_reason: 'length' }],
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      }),
    }) as unknown as typeof fetch;

    const result = await callNineRouter('system', 'user');

    expect(result.finishReason).toBe('length');
  });

  it('expone finishReason "stop" en una respuesta completa', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        choices: [{ message: { content: 'texto completo' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    }) as unknown as typeof fetch;

    const result = await callNineRouter('system', 'user');

    expect(result.finishReason).toBe('stop');
  });

  it('parsea finish_reason también en respuestas SSE reensambladas (delta chunks)', async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"hola"}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"length"}]}',
      'data: [DONE]',
    ].join('\n');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => sse,
    }) as unknown as typeof fetch;

    const result = await callNineRouter('system', 'user');

    expect(result.finishReason).toBe('length');
    expect(result.content).toBe('hola');
  });
});
```

- [ ] **Step 2: Correr los tests para confirmar que fallan**

Run: `cd backend && npx vitest run src/services/ai/nineRouter.test.ts`
Expected: FAIL — `result.finishReason` es `undefined` en los tres casos (la propiedad no existe todavía).

- [ ] **Step 3: Agregar `finishReason` a `AIResponse`**

En `backend/src/types/db.ts:60-66`, reemplazar:

```ts
export interface AIResponse {
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
  };
}
```

por:

```ts
export interface AIResponse {
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
  };
  finishReason?: string;
}
```

- [ ] **Step 4: Capturar `finish_reason` en `nineRouter.ts`**

En `backend/src/services/ai/nineRouter.ts:36-42`, reemplazar la interfaz:

```ts
interface NineRouterResponse {
  choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}
```

por:

```ts
interface NineRouterResponse {
  choices?: Array<{ message?: { content?: string; reasoning_content?: string }; finish_reason?: string }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}
```

En `backend/src/services/ai/nineRouter.ts:47-76` (`parseNineRouterNonStreamResponse`), reemplazar el cuerpo de la función completo:

```ts
function parseNineRouterNonStreamResponse(raw: string): NineRouterResponse {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('data:')) {
    // Algunos modelos devuelven un JSON normal pero con "data: [DONE]" pegado
    // al final sin salto de línea (ej. oc/deepseek-v4-flash-free).
    const cleaned = trimmed.replace(/data:\s*\[DONE\]\s*$/, '').trim();
    return JSON.parse(cleaned) as NineRouterResponse;
  }

  let content = '';
  let reasoning = '';
  let finishReason: string | undefined;
  let usage: NineRouterResponse['usage'];

  for (const line of trimmed.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('data:') || t === 'data: [DONE]') continue;
    try {
      const chunk = JSON.parse(t.slice(5).trim());
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.content) content += delta.content;
      if (delta?.reasoning_content) reasoning += delta.reasoning_content;
      const msg = chunk.choices?.[0]?.message;
      if (msg?.content) content += msg.content;
      if (msg?.reasoning_content) reasoning += msg.reasoning_content;
      if (chunk.choices?.[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason;
      if (chunk.usage) usage = chunk.usage;
    } catch { /* skip malformed chunk */ }
  }

  return { choices: [{ message: { content, reasoning_content: reasoning }, finish_reason: finishReason }], usage };
}
```

En `backend/src/services/ai/nineRouter.ts:206-224` (dentro de `callNineRouter`, después de `const content = ...` y antes del `return`), reemplazar:

```ts
  const content = data.choices?.[0]?.message?.content || '';
  const usage = data.usage || {};

  logger.debug('9router response received', {
    elapsed,
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
  });

  return {
    content,
    usage: {
      promptTokens: usage.prompt_tokens || 0,
      completionTokens: usage.completion_tokens || 0,
    },
  };
```

por:

```ts
  const content = data.choices?.[0]?.message?.content || '';
  const finishReason = data.choices?.[0]?.finish_reason;
  const usage = data.usage || {};

  logger.debug('9router response received', {
    elapsed,
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    finishReason,
  });

  return {
    content,
    usage: {
      promptTokens: usage.prompt_tokens || 0,
      completionTokens: usage.completion_tokens || 0,
    },
    finishReason,
  };
```

- [ ] **Step 5: Correr los tests para confirmar que pasan**

Run: `cd backend && npx vitest run src/services/ai/nineRouter.test.ts`
Expected: PASS — 3/3 tests.

- [ ] **Step 6: Correr la suite completa para confirmar que nada se rompió**

Run: `cd backend && npm test`
Expected: PASS — todos los tests existentes siguen en verde (este cambio es aditivo, no quita ni renombra nada).

- [ ] **Step 7: Commit**

```bash
git add backend/src/types/db.ts backend/src/services/ai/nineRouter.ts backend/src/services/ai/nineRouter.test.ts
git commit -m "feat: exponer finish_reason en AIResponse para detectar truncamiento"
```

---

### Task 2: Reescribir `SYSTEM_PROMPT_COMPACTOR` sin tope de palabras ni ambigüedad

**Files:**
- Modify: `backend/src/prompts/system.ts:77-89`
- Test: `backend/src/prompts/system.test.ts` (nuevo)

**Interfaces:**
- Consumes: nada.
- Produces: `SYSTEM_PROMPT_COMPACTOR` (mismo nombre exportado, texto nuevo) — Task 3 lo importa sin cambios en la firma, solo cambia el contenido del string. El contrato de salida JSON sigue siendo `{ summary: string, kbCandidates: [...] }` (Task 3 sigue parseando esos dos campos igual).

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/src/prompts/system.test.ts`:

```ts
// backend/src/prompts/system.test.ts
import { describe, it, expect } from 'vitest';
import { SYSTEM_PROMPT_COMPACTOR } from './system.js';

describe('SYSTEM_PROMPT_COMPACTOR', () => {
  it('no impone un tope de palabras', () => {
    expect(SYSTEM_PROMPT_COMPACTOR).not.toMatch(/máximo.*palabras/i);
    expect(SYSTEM_PROMPT_COMPACTOR).not.toContain('400 palabras');
  });

  it('no usa "relevante" sin definir el criterio', () => {
    expect(SYSTEM_PROMPT_COMPACTOR).not.toMatch(/conversación relevante/i);
  });

  it('exige declarar conteo de mensajes revisados antes de afirmar ausencia de contenido académico', () => {
    expect(SYSTEM_PROMPT_COMPACTOR).toMatch(/cuántos mensajes/i);
  });

  it('pide autoevaluación de confianza junto al resumen', () => {
    expect(SYSTEM_PROMPT_COMPACTOR).toMatch(/confidence/i);
    expect(SYSTEM_PROMPT_COMPACTOR).toMatch(/high\/medium\/low|high.*medium.*low/i);
  });

  it('mantiene el contrato JSON summary + kbCandidates', () => {
    expect(SYSTEM_PROMPT_COMPACTOR).toContain('"summary"');
    expect(SYSTEM_PROMPT_COMPACTOR).toContain('"kbCandidates"');
  });
});
```

- [ ] **Step 2: Correr el test para confirmar que falla**

Run: `cd backend && npx vitest run src/prompts/system.test.ts`
Expected: FAIL en las primeras 4 aserciones (el prompt actual sí tiene "400 palabras", "conversación relevante", no menciona "cuántos mensajes" ni "confidence").

- [ ] **Step 3: Reescribir el prompt**

En `backend/src/prompts/system.ts:77-89`, reemplazar:

```ts
export const SYSTEM_PROMPT_COMPACTOR = `Eres un compactador de contexto para conversaciones de tutoría académica. Recibes un resumen previo (puede estar vacío si es el inicio de la conversación) y los mensajes nuevos desde el último resumen. Tu trabajo:

1. Devuelve un resumen ACTUALIZADO de toda la conversación relevante hasta ahora: temas cubiertos, nivel del estudiante, qué entendió, qué le costó, dudas pendientes. NO incluyas preferencias de tono/estilo del estudiante (eso se maneja en un sistema aparte). Máximo ~400 palabras.
2. Identifica, si los hay, temas académicos generales y reutilizables que valga la pena guardar para otros estudiantes (definiciones, conceptos, explicaciones completas) — NO dudas específicas de una tarea puntual de este usuario.

Responde ÚNICAMENTE con JSON, sin markdown:
{
  "summary": "resumen actualizado en texto plano",
  "kbCandidates": [
    { "content": "contenido completo reutilizable", "subject": "materia (matematicas, fisica, quimica, biologia, historia, lenguaje, informatica, general)", "summary": "resumen corto de este candidato" }
  ]
}
Si no hay candidatos de KB, "kbCandidates" debe ser un array vacío.`;
```

por:

```ts
export const SYSTEM_PROMPT_COMPACTOR = `Eres un compactador de contexto para conversaciones de tutoría académica. Recibes un resumen previo (puede estar vacío si es el inicio de la conversación) y los mensajes nuevos desde el último resumen. Tu trabajo:

1. Devuelve un resumen ACTUALIZADO de TODO lo narrativo hasta ahora: de qué se habló, nivel del estudiante, qué entendió, qué le costó, dudas resueltas y pendientes, tono de la conversación. NO incluyas preferencias de tono/estilo del estudiante (eso se maneja en un sistema aparte). NO hay límite de palabras — preferí un resumen completo y fiel sobre uno corto que omite información.
2. Cualquier explicación técnica, derivación, definición o ejemplo resuelto NO se resume dentro del texto narrativo — se extrae aparte como candidato de KB (ver "kbCandidates" abajo). Tu única obligación con ese contenido dentro del resumen narrativo es listarlo por referencia (una línea con el tema), nunca omitirlo por completo.
3. Identifica, si los hay, temas académicos generales y reutilizables que valga la pena guardar para otros estudiantes (definiciones, conceptos, explicaciones completas) — NO dudas específicas de una tarea puntual de este usuario.
4. Si no encontrás contenido académico reutilizable para "kbCandidates", tu respuesta igual debe reflejar que revisaste los mensajes: nunca afirmes ausencia de contenido sin haberlo repasado. Si tenés dudas sobre si algo califica como candidato de KB, inclúyelo igual con "confidence": "low" en vez de omitirlo — ante la duda, se conserva, no se descarta.

Responde ÚNICAMENTE con JSON, sin markdown:
{
  "summary": "resumen narrativo actualizado en texto plano",
  "confidence": "high" | "medium" | "low",
  "reviewedMessageCount": número de mensajes nuevos que revisaste en esta pasada,
  "kbCandidates": [
    { "content": "contenido completo reutilizable", "subject": "materia (matematicas, fisica, quimica, biologia, historia, lenguaje, informatica, general)", "summary": "resumen corto de este candidato", "confidence": "high" | "medium" | "low" }
  ]
}
Si no hay candidatos de KB, "kbCandidates" debe ser un array vacío.`;
```

- [ ] **Step 4: Correr el test para confirmar que pasa**

Run: `cd backend && npx vitest run src/prompts/system.test.ts`
Expected: PASS — 5/5 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/prompts/system.ts backend/src/prompts/system.test.ts
git commit -m "fix: quitar tope de palabras y ambigüedad del prompt del compactor"
```

---

### Task 3: Modelo de compactación dinámico + retry en truncamiento

**Files:**
- Modify: `backend/src/services/chat/chat.compaction.service.ts` (archivo completo, 74 líneas)
- Test: `backend/src/services/chat/chat.compaction.service.test.ts` (nuevo)

**Interfaces:**
- Consumes:
  - `AIResponse.finishReason?: string` de Task 1 (`backend/src/services/ai/index.ts` → `generateFromAI` ya lo reenvía sin cambios).
  - `SYSTEM_PROMPT_COMPACTOR` de Task 2, con el nuevo contrato JSON `{ summary, confidence, reviewedMessageCount, kbCandidates: [{ content, subject, summary, confidence }] }` — `confidence`/`reviewedMessageCount` no se usan todavía en esta tarea (quedan para Fase 3, verificación), pero el parseo no debe romperse si vienen presentes.
  - `ChatModel.getLastAssistantModel(sessionId): string | null` — ya existe en `backend/src/models/chat.model.ts:40-45`, sin cambios.
  - `INKLING_MODEL_ID` de `backend/src/config/models.ts:12`.
- Produces: `compactSession(sessionId, userId, force)` mantiene la misma firma pública — nada fuera de este archivo cambia su forma de llamarlo (`backend/src/services/chat/chat.streaming.service.ts` y `chat.completion.service.ts` ya lo importan así, sin cambios).

- [ ] **Step 1: Escribir los tests que fallan**

Crear `backend/src/services/chat/chat.compaction.service.test.ts`:

```ts
// backend/src/services/chat/chat.compaction.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const generateFromAIMock = vi.fn();
vi.mock('../ai/index.js', () => ({
  generateFromAI: (...args: unknown[]) => generateFromAIMock(...args),
}));

const chatModelMock = {
  getSummaryCursor: vi.fn(),
  getMessagesSince: vi.fn(),
  setSummaryCursor: vi.fn(),
  getLastAssistantModel: vi.fn(),
};
vi.mock('../../models/chat.model.js', () => ({
  ChatModel: chatModelMock,
}));

const sessionSummaryMock = {
  getSummary: vi.fn(),
  saveSummary: vi.fn(),
};
vi.mock('../session-summary.service.js', () => ({
  SessionSummaryService: sessionSummaryMock,
}));

const knowledgeModelMock = {
  existsByHash: vi.fn(),
  create: vi.fn(),
};
vi.mock('../../models/knowledge.model.js', () => ({
  KnowledgeModel: knowledgeModelMock,
  hashKnowledgeContent: (content: string) => `hash:${content}`,
}));

import { compactSession } from './chat.compaction.service.js';

function aiResponse(content: string, finishReason = 'stop') {
  return { content, usage: { promptTokens: 10, completionTokens: 10 }, finishReason };
}

const NEW_MESSAGES = [
  { id: 'm1', role: 'user', content: 'hola', created_at: '2026-07-17T10:00:00Z' },
  { id: 'm2', role: 'assistant', content: 'hola, ¿en qué te ayudo?', created_at: '2026-07-17T10:00:05Z' },
  { id: 'm3', role: 'user', content: 'explícame integrales', created_at: '2026-07-17T10:01:00Z' },
  { id: 'm4', role: 'assistant', content: 'una integral es...', created_at: '2026-07-17T10:01:30Z' },
  { id: 'm5', role: 'user', content: 'gracias', created_at: '2026-07-17T10:02:00Z' },
  { id: 'm6', role: 'assistant', content: 'de nada', created_at: '2026-07-17T10:02:05Z' },
];

const VALID_RESULT = JSON.stringify({
  summary: 'El estudiante preguntó sobre integrales.',
  confidence: 'high',
  reviewedMessageCount: 6,
  kbCandidates: [],
});

describe('compactSession — modelo dinámico', () => {
  beforeEach(() => {
    generateFromAIMock.mockReset();
    chatModelMock.getSummaryCursor.mockReset().mockReturnValue(null);
    chatModelMock.getMessagesSince.mockReset().mockReturnValue(NEW_MESSAGES);
    chatModelMock.setSummaryCursor.mockReset();
    chatModelMock.getLastAssistantModel.mockReset();
    sessionSummaryMock.getSummary.mockReset().mockReturnValue(null);
    sessionSummaryMock.saveSummary.mockReset();
    knowledgeModelMock.existsByHash.mockReset().mockReturnValue(false);
    knowledgeModelMock.create.mockReset();
  });

  it('usa Inkling para compactar una sesión cuyo último modelo fue Inkling', async () => {
    chatModelMock.getLastAssistantModel.mockReturnValue('nvidia/thinkingmachines/inkling');
    generateFromAIMock.mockResolvedValueOnce(aiResponse(VALID_RESULT));

    await compactSession('s1', 'u1', true);

    expect(generateFromAIMock).toHaveBeenCalledWith(
      'nineRouter', expect.any(String), expect.any(String), null,
      expect.objectContaining({ model: 'nvidia/thinkingmachines/inkling' }),
    );
  });

  it('usa Gemini Flash para compactar una sesión cuyo último modelo fue Claude Sonnet', async () => {
    chatModelMock.getLastAssistantModel.mockReturnValue('ag/claude-sonnet-4-6');
    generateFromAIMock.mockResolvedValueOnce(aiResponse(VALID_RESULT));

    await compactSession('s1', 'u1', true);

    expect(generateFromAIMock).toHaveBeenCalledWith(
      'nineRouter', expect.any(String), expect.any(String), null,
      expect.objectContaining({ model: 'ag/gemini-3-flash' }),
    );
  });

  it('usa GLM para compactar una sesión cuyo último modelo fue GLM', async () => {
    chatModelMock.getLastAssistantModel.mockReturnValue('nvidia/z-ai/glm-5.2');
    generateFromAIMock.mockResolvedValueOnce(aiResponse(VALID_RESULT));

    await compactSession('s1', 'u1', true);

    expect(generateFromAIMock).toHaveBeenCalledWith(
      'nineRouter', expect.any(String), expect.any(String), null,
      expect.objectContaining({ model: 'nvidia/z-ai/glm-5.2' }),
    );
  });

  it('usa Inkling por default si la sesión todavía no tiene modelo previo', async () => {
    chatModelMock.getLastAssistantModel.mockReturnValue(null);
    generateFromAIMock.mockResolvedValueOnce(aiResponse(VALID_RESULT));

    await compactSession('s1', 'u1', true);

    expect(generateFromAIMock).toHaveBeenCalledWith(
      'nineRouter', expect.any(String), expect.any(String), null,
      expect.objectContaining({ model: 'nvidia/thinkingmachines/inkling' }),
    );
  });
});

describe('compactSession — retry en truncamiento', () => {
  beforeEach(() => {
    generateFromAIMock.mockReset();
    chatModelMock.getSummaryCursor.mockReset().mockReturnValue(null);
    chatModelMock.getMessagesSince.mockReset().mockReturnValue(NEW_MESSAGES);
    chatModelMock.setSummaryCursor.mockReset();
    chatModelMock.getLastAssistantModel.mockReset().mockReturnValue('nvidia/thinkingmachines/inkling');
    sessionSummaryMock.getSummary.mockReset().mockReturnValue(null);
    sessionSummaryMock.saveSummary.mockReset();
    knowledgeModelMock.existsByHash.mockReset().mockReturnValue(false);
    knowledgeModelMock.create.mockReset();
  });

  it('reintenta con más presupuesto si la primera respuesta viene truncada, y guarda el resultado del reintento', async () => {
    generateFromAIMock
      .mockResolvedValueOnce(aiResponse('{"summary": "cortado a la mit', 'length'))
      .mockResolvedValueOnce(aiResponse(VALID_RESULT, 'stop'));

    await compactSession('s1', 'u1', true);

    expect(generateFromAIMock).toHaveBeenCalledTimes(2);
    expect(generateFromAIMock).toHaveBeenNthCalledWith(2,
      'nineRouter', expect.any(String), expect.any(String), null,
      expect.objectContaining({ max_tokens: 6000 }),
    );
    expect(sessionSummaryMock.saveSummary).toHaveBeenCalledWith('s1', 'El estudiante preguntó sobre integrales.');
  });

  it('descarta el intento (no guarda nada) si sigue truncado tras el reintento', async () => {
    generateFromAIMock
      .mockResolvedValueOnce(aiResponse('{"summary": "cortado', 'length'))
      .mockResolvedValueOnce(aiResponse('{"summary": "sigue cortado', 'length'));

    await compactSession('s1', 'u1', true);

    expect(generateFromAIMock).toHaveBeenCalledTimes(2);
    expect(sessionSummaryMock.saveSummary).not.toHaveBeenCalled();
    expect(chatModelMock.setSummaryCursor).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correr los tests para confirmar que fallan**

Run: `cd backend && npx vitest run src/services/chat/chat.compaction.service.test.ts`
Expected: FAIL — hoy `compactSession` siempre llama con `model: config.models.insights` (`'oc/deepseek-v4-flash-free'` en test env sin `INSIGHTS_MODEL` seteado) sin importar `getLastAssistantModel`, y nunca reintenta en truncamiento.

- [ ] **Step 3: Reescribir `chat.compaction.service.ts`**

Reemplazar el archivo completo `backend/src/services/chat/chat.compaction.service.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { generateFromAI } from '../ai/index.js';
import { logger } from '../../utils/logger.js';
import { ChatModel } from '../../models/chat.model.js';
import { KnowledgeModel, hashKnowledgeContent } from '../../models/knowledge.model.js';
import { SessionSummaryService } from '../session-summary.service.js';
import { SYSTEM_PROMPT_COMPACTOR } from '../../prompts/system.js';
import { INKLING_MODEL_ID } from '../../config/models.js';

// Umbral para compactación automática en segundo plano (además del disparador
// explícito por cambio de modelo, que siempre compacta sin importar cuántos
// mensajes nuevos haya).
const MIN_MESSAGES_TO_COMPACT = 6;

// El modelo activo de la sesión ya demostró que entiende el vocabulario y
// nivel específico del estudiante — compactar con un modelo distinto agrega
// una traducción innecesaria. Cuando la familia activa no tiene variante
// liviana propia, se usa Gemini Flash como compactador cross-familia.
const COMPACTION_MODEL_MAP: Record<string, string> = {
  'ag/gemini-3-flash': 'ag/gemini-3-flash',
  'ag/gemini-3.1-pro-low': 'ag/gemini-3-flash',
  'ag/claude-sonnet-4-6': 'ag/gemini-3-flash',
  'nvidia/z-ai/glm-5.2': 'nvidia/z-ai/glm-5.2',
  [INKLING_MODEL_ID]: INKLING_MODEL_ID,
  'oc/deepseek-v4-flash-free': 'oc/deepseek-v4-flash-free',
};

function resolveCompactionModel(sessionId: string): string {
  const lastModel = ChatModel.getLastAssistantModel(sessionId);
  if (lastModel && COMPACTION_MODEL_MAP[lastModel]) return COMPACTION_MODEL_MAP[lastModel];
  // Sesión nueva sin modelo previo aún — Inkling es el default del chat.
  return INKLING_MODEL_ID;
}

interface CompactionResult {
  summary: string;
  kbCandidates?: Array<{ content: string; subject: string; summary?: string }>;
}

const INITIAL_MAX_TOKENS = 3000;
const RETRY_MAX_TOKENS = 6000;

// Compacta lo nuevo desde el último corte (cursor) de una sesión: actualiza el
// resumen incremental en session-summary.service.ts y encola temas
// reutilizables detectados hacia la KB colectiva (mismo pipeline de
// validación que knowledge-detection.service.ts — kb-validator.service.ts).
export async function compactSession(sessionId: string, userId: string, force = false): Promise<void> {
  const cursor = ChatModel.getSummaryCursor(sessionId);
  const newMessages = ChatModel.getMessagesSince(sessionId, cursor)
    .filter(m => m.role === 'user' || m.role === 'assistant');

  if (newMessages.length === 0) return;
  if (!force && newMessages.length < MIN_MESSAGES_TO_COMPACT) return;

  const priorSummary = SessionSummaryService.getSummary(sessionId) || '(sin resumen previo, es el inicio de la conversación)';
  const transcript = newMessages.map(m => `[${m.role}] ${m.content}`).join('\n\n');
  const userPrompt = `--- Resumen previo ---\n${priorSummary}\n\n--- Mensajes nuevos ---\n${transcript}`;
  const model = resolveCompactionModel(sessionId);

  try {
    let result = await generateFromAI('nineRouter', SYSTEM_PROMPT_COMPACTOR, userPrompt, null, {
      model,
      temperature: 0.3,
      max_tokens: INITIAL_MAX_TOKENS,
    });

    if (result.finishReason === 'length') {
      logger.warn('Compactación truncada por max_tokens, reintentando con presupuesto mayor', { sessionId, model });
      result = await generateFromAI('nineRouter', SYSTEM_PROMPT_COMPACTOR, userPrompt, null, {
        model,
        temperature: 0.3,
        max_tokens: RETRY_MAX_TOKENS,
      });
    }

    // Nunca se acepta una respuesta truncada como resultado final — se
    // descarta el intento en vez de guardar un resumen a medias (spec 4.1).
    if (result.finishReason === 'length') {
      logger.warn('Compactación sigue truncada tras reintento, se descarta este intento', { sessionId, model });
      return;
    }

    const parsed = JSON.parse(result.content) as CompactionResult;
    if (!parsed.summary) return;

    SessionSummaryService.saveSummary(sessionId, parsed.summary);
    ChatModel.setSummaryCursor(sessionId, newMessages[newMessages.length - 1].created_at);

    for (const candidate of parsed.kbCandidates || []) {
      if (!candidate.content || candidate.content.trim().length < 40) continue;
      if (KnowledgeModel.existsByHash(hashKnowledgeContent(candidate.content))) continue;

      KnowledgeModel.create({
        id: randomUUID(),
        content: candidate.content,
        summary: candidate.summary,
        subject: candidate.subject || 'general',
        source_type: 'session_compaction',
        source_user_id: userId,
        tags: ['auto-detectado', 'compactacion'],
        status: 'pending_review',
      });
    }

    logger.info('Sesión compactada', {
      sessionId, model, messagesCompacted: newMessages.length, kbCandidates: parsed.kbCandidates?.length || 0,
    });
  } catch (err) {
    logger.warn('Error compactando sesión', { sessionId, model, error: (err as Error).message });
  }
}
```

- [ ] **Step 4: Correr los tests para confirmar que pasan**

Run: `cd backend && npx vitest run src/services/chat/chat.compaction.service.test.ts`
Expected: PASS — 6/6 tests.

- [ ] **Step 5: Correr la suite completa**

Run: `cd backend && npm test`
Expected: PASS — todo verde. Confirmar en particular que `chat.streaming.service.test.ts` / `chat.completion.service.test.ts` (si existen y mockean `compactSession`) siguen pasando sin cambios, ya que la firma pública de `compactSession` no cambió.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/chat/chat.compaction.service.ts backend/src/services/chat/chat.compaction.service.test.ts
git commit -m "feat: modelo de compactación dinámico por sesión + retry en truncamiento"
```
