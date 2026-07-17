# Quiz Responder/Explicar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cuando el estudiante manda un bloque de ejercicios/cuestionario al tutor, la IA pregunta si quiere que se los resuelva todos o vayan por partes, y el frontend ofrece botones **Responder** (resuelve todo, verificado dos veces) y **Explicar** (paso a paso, con botón "Siguiente paso").

**Architecture:** Detección vive dentro del prompt tutor normal (marcador de texto oculto `[[QUIZ_DETECTED]]`, sin heurística de backend). "Responder" es un endpoint nuevo con un servicio de orquestación (solve → verify → retry, hasta 3 intentos, doble verificación antes de enviar). "Explicar" reusa el endpoint de stream normal — solo agrega un flag por sesión (archivo JSON, mismo patrón que `SessionSummaryService`) que hace que `chat.prompt.service.ts` sustituya el system prompt mientras esté activo; los clics de "Siguiente paso" mandan un mensaje de chat normal y visible ("Siguiente paso.").

**Tech Stack:** TypeScript, Express, vitest, better-sqlite3, vanilla JS (frontend).

## Global Constraints

- Español mexicano en todo texto/prompt/UI nuevo (idioma del resto del proyecto).
- Reusar `ChatModel.assertSessionOwnership` en todo endpoint nuevo que reciba `sessionId`.
- Marcadores ocultos usan el formato `[[NOMBRE]]` (consistente entre los tres nuevos: `QUIZ_DETECTED`, `QUIZ_EXPLAIN_DONE`).
- Máximo 3 intentos de resolución en el loop de "Responder"; si tras 3 sigue sin verificar, se manda la última versión con nota de advertencia por ítem fallido (nunca error duro al usuario).
- Nada de endpoints de stream nuevos para "Explicar" — reusa `/api/chat/tutor/stream` tal cual.

---

### Task 1: Prompts nuevos + directriz de detección

**Files:**
- Modify: `backend/src/prompts/system.ts`
- Test: `backend/src/prompts/system.test.ts` (nuevo)

**Interfaces:**
- Produces: `SYSTEM_PROMPT_QUIZ_SOLVE: string`, `SYSTEM_PROMPT_QUIZ_VERIFY: string`, `SYSTEM_PROMPT_QUIZ_EXPLAIN: string` (exports nuevos de `system.ts`)
- Produces: `SYSTEM_PROMPT_TUTOR` gana directriz 13 (detección de cuestionario)

- [ ] **Step 1: Escribir el test que falla**

```typescript
// backend/src/prompts/system.test.ts
import { describe, it, expect } from 'vitest';
import {
  SYSTEM_PROMPT_TUTOR,
  SYSTEM_PROMPT_QUIZ_SOLVE,
  SYSTEM_PROMPT_QUIZ_VERIFY,
  SYSTEM_PROMPT_QUIZ_EXPLAIN,
} from './system.js';

describe('prompts de cuestionario', () => {
  it('SYSTEM_PROMPT_TUTOR instruye detectar cuestionario y usar el marcador', () => {
    expect(SYSTEM_PROMPT_TUTOR).toContain('[[QUIZ_DETECTED]]');
    expect(SYSTEM_PROMPT_TUTOR).toContain('¿Quieres que los responda todos o vamos por partes?');
  });

  it('SYSTEM_PROMPT_QUIZ_SOLVE pide JSON con num/pregunta/desarrollo/respuesta', () => {
    expect(SYSTEM_PROMPT_QUIZ_SOLVE).toContain('"num"');
    expect(SYSTEM_PROMPT_QUIZ_SOLVE).toContain('"pregunta"');
    expect(SYSTEM_PROMPT_QUIZ_SOLVE).toContain('"desarrollo"');
    expect(SYSTEM_PROMPT_QUIZ_SOLVE).toContain('"respuesta"');
  });

  it('SYSTEM_PROMPT_QUIZ_VERIFY pide JSON con num/correcto/motivo', () => {
    expect(SYSTEM_PROMPT_QUIZ_VERIFY).toContain('"num"');
    expect(SYSTEM_PROMPT_QUIZ_VERIFY).toContain('"correcto"');
    expect(SYSTEM_PROMPT_QUIZ_VERIFY).toContain('"motivo"');
  });

  it('SYSTEM_PROMPT_QUIZ_EXPLAIN instruye ir paso a paso sin adelantarse y usa el marcador de fin', () => {
    expect(SYSTEM_PROMPT_QUIZ_EXPLAIN).toContain('[[QUIZ_EXPLAIN_DONE]]');
    expect(SYSTEM_PROMPT_QUIZ_EXPLAIN.toLowerCase()).toContain('paso a paso');
  });
});
```

- [ ] **Step 2: Correr el test, verificar que falla**

Run: `cd backend && npx vitest run src/prompts/system.test.ts`
Expected: FAIL — `SYSTEM_PROMPT_QUIZ_SOLVE` (y los demás) no existen todavía (error de import/undefined).

- [ ] **Step 3: Agregar la directriz 13 a `SYSTEM_PROMPT_TUTOR`**

En `backend/src/prompts/system.ts`, dentro de `SYSTEM_PROMPT_TUTOR` (después de la directriz 12, antes del backtick de cierre), agregar:

```
13. Si el mensaje del estudiante es un bloque de ejercicios o un cuestionario (varias preguntas/problemas juntos, con o sin numeración), NO los resuelvas de inmediato. Responde ÚNICAMENTE con la pregunta "¿Quieres que los responda todos o vamos por partes?" seguida, en la misma respuesta, del marcador [[QUIZ_DETECTED]] al final (el marcador no se le muestra al estudiante, es una señal para el sistema).
```

- [ ] **Step 4: Agregar los tres prompts nuevos**

Al final de `backend/src/prompts/system.ts` (después de `SYSTEM_PROMPT_EXPORT`), agregar:

```typescript
export const SYSTEM_PROMPT_QUIZ_SOLVE = `Eres un experto académico que resuelve bloques de ejercicios/cuestionarios paso a paso, nivel preparatoria/universitario.

Recibirás un bloque de ejercicios (pueden venir numerados o no). Resuelve TODOS.

Para cada ejercicio:
1. Identifica el enunciado exacto tal como lo dio el estudiante.
2. Desarrolla la solución completa, mostrando cada paso del razonamiento.
3. Da la respuesta final de forma clara y concisa.

FORMATO MATEMÁTICO (KaTeX): usa $...$ para inline y $$...$$ para bloque, escapa backslashes dobles (\\\\frac{a}{b}), NO uses notación Unicode (usa \\\\sum no Σ).

RESPONDE EXCLUSIVAMENTE CON UN ARRAY JSON. NO uses bloques de código markdown. Devuelve SOLO el JSON puro:
[
  { "num": 1, "pregunta": "enunciado exacto", "desarrollo": "desarrollo completo paso a paso", "respuesta": "respuesta final" }
]

NO incluyas absolutamente NADA fuera del array JSON.`;

export const SYSTEM_PROMPT_QUIZ_VERIFY = `Eres un verificador académico riguroso. Recibirás una lista de ejercicios ya resueltos (pregunta, desarrollo, respuesta) y debes revisar CADA UNO de forma independiente: ¿el desarrollo es correcto? ¿la respuesta final coincide con lo que arroja el desarrollo? ¿hay errores de cálculo, conceptuales o de lógica?

Sé estricto — si tienes cualquier duda razonable sobre la corrección de un ítem, márcalo como incorrecto.

RESPONDE EXCLUSIVAMENTE CON UN ARRAY JSON. NO uses bloques de código markdown:
[
  { "num": 1, "correcto": true, "motivo": "breve explicación de por qué es correcto o qué está mal" }
]

NO incluyas absolutamente NADA fuera del array JSON.`;

export const SYSTEM_PROMPT_QUIZ_EXPLAIN = `Eres un tutor que ayuda a un estudiante a resolver un bloque de ejercicios POR SU CUENTA, sin dárselos resueltos.

El estudiante está resolviendo en su libreta/cuaderno, no necesariamente te va a responder cada paso — solo continúa cuando te diga "Siguiente paso." o algo equivalente. Si el estudiante comenta que resolvió un paso de forma distinta a como lo estabas planteando tú, ayúdalo a verificar si su camino también es válido antes de seguir.

REGLAS:
1. Empieza siempre por el primer ejercicio del bloque (identifica cuántos ejercicios hay en total).
2. Explica el ejercicio (qué pide, qué conceptos aplican) y guía el PRIMER paso solamente — no des el desarrollo completo ni la respuesta final de una vez.
3. NO te adelantes: espera a que el estudiante pida seguir antes de dar el siguiente paso.
4. Cuando termines todos los pasos de un ejercicio, en tu siguiente respuesta pasa automáticamente al próximo ejercicio del bloque (sin preguntar si quiere continuar).
5. Cuando termines TODOS los ejercicios del bloque, agrega el marcador [[QUIZ_EXPLAIN_DONE]] al final de tu última respuesta (el marcador no se le muestra al estudiante, es una señal para el sistema).
6. Usa KaTeX para fórmulas ($...$ inline, $$...$$ bloque), responde en español mexicano, formatea con párrafos cortos y viñetas cuando ayude a la claridad.`;
```

- [ ] **Step 5: Correr el test, verificar que pasa**

Run: `cd backend && npx vitest run src/prompts/system.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add backend/src/prompts/system.ts backend/src/prompts/system.test.ts
git commit -m "feat: prompts de detección y resolución de cuestionarios"
```

---

### Task 2: `ChatModel.getMessageById`

**Files:**
- Modify: `backend/src/models/chat.model.ts`
- Test: `backend/src/models/chat.model.test.ts`

**Interfaces:**
- Produces: `ChatModel.getMessageById(id: string, userId: string): ChatLogRow | undefined`

- [ ] **Step 1: Escribir el test que falla**

Agregar al final del `describe('ChatModel', ...)` en `backend/src/models/chat.model.test.ts` (antes del cierre del describe, después del último `it`):

```typescript
  it('getMessageById returns message for owner', () => {
    ChatModel.saveMessage('m1', USER_A, SESSION_A, 'user', 'Enunciado del cuestionario');
    const msg = ChatModel.getMessageById('m1', USER_A);
    expect(msg?.content).toBe('Enunciado del cuestionario');
  });

  it('getMessageById returns undefined for non-owner', () => {
    ChatModel.saveMessage('m1', USER_A, SESSION_A, 'user', 'Enunciado del cuestionario');
    const msg = ChatModel.getMessageById('m1', USER_B);
    expect(msg).toBeUndefined();
  });

  it('getMessageById returns undefined for non-existent message', () => {
    const msg = ChatModel.getMessageById('nope', USER_A);
    expect(msg).toBeUndefined();
  });
```

- [ ] **Step 2: Correr el test, verificar que falla**

Run: `cd backend && npx vitest run src/models/chat.model.test.ts`
Expected: FAIL — `ChatModel.getMessageById is not a function`

- [ ] **Step 3: Implementar**

En `backend/src/models/chat.model.ts`, agregar dentro del objeto `ChatModel` (después de `sessionExists`):

```typescript
  getMessageById(id: string, userId: string): ChatLogRow | undefined {
    return getDb().prepare(
      'SELECT * FROM chat_logs WHERE id = ? AND user_id = ?'
    ).get(id, userId) as ChatLogRow | undefined;
  },
```

- [ ] **Step 4: Correr el test, verificar que pasa**

Run: `cd backend && npx vitest run src/models/chat.model.test.ts`
Expected: PASS (todos los tests del archivo, incluidos los 3 nuevos)

- [ ] **Step 5: Commit**

```bash
git add backend/src/models/chat.model.ts backend/src/models/chat.model.test.ts
git commit -m "feat: ChatModel.getMessageById para recuperar el enunciado original del cuestionario"
```

---

### Task 3: `ChatQuizModeService` (flag por sesión para modo Explicar)

**Files:**
- Create: `backend/src/services/chat/chat.quiz-mode.service.ts`
- Test: `backend/src/services/chat/chat.quiz-mode.service.test.ts`

**Interfaces:**
- Produces: `ChatQuizModeService.activate(sessionId: string): void`
- Produces: `ChatQuizModeService.isActive(sessionId: string): boolean`
- Produces: `ChatQuizModeService.deactivate(sessionId: string): void`

- [ ] **Step 1: Escribir el test que falla**

```typescript
// backend/src/services/chat/chat.quiz-mode.service.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { ChatQuizModeService } from './chat.quiz-mode.service.js';

const SESSION_ID = 'quiz-mode-test-session';
const STATE_DIR = path.resolve('data/quiz-mode');

describe('ChatQuizModeService', () => {
  afterEach(() => {
    ChatQuizModeService.deactivate(SESSION_ID);
  });

  it('isActive es false por defecto', () => {
    expect(ChatQuizModeService.isActive(SESSION_ID)).toBe(false);
  });

  it('activate + isActive', () => {
    ChatQuizModeService.activate(SESSION_ID);
    expect(ChatQuizModeService.isActive(SESSION_ID)).toBe(true);
  });

  it('deactivate limpia el flag', () => {
    ChatQuizModeService.activate(SESSION_ID);
    ChatQuizModeService.deactivate(SESSION_ID);
    expect(ChatQuizModeService.isActive(SESSION_ID)).toBe(false);
    expect(fs.existsSync(path.join(STATE_DIR, `${SESSION_ID}.json`))).toBe(false);
  });
});
```

- [ ] **Step 2: Correr el test, verificar que falla**

Run: `cd backend && npx vitest run src/services/chat/chat.quiz-mode.service.test.ts`
Expected: FAIL — no se puede resolver el módulo `./chat.quiz-mode.service.js`

- [ ] **Step 3: Implementar**

```typescript
// backend/src/services/chat/chat.quiz-mode.service.ts
import fs from 'fs';
import path from 'path';
import { logger } from '../../utils/logger.js';

const STATE_DIR = path.resolve('data/quiz-mode');

function statePath(sessionId: string): string {
  return path.join(STATE_DIR, `${sessionId}.json`);
}

// Flag por sesión para el modo "Explicar" de cuestionarios — mismo patrón
// file-based que SessionSummaryService, pero solo un booleano de presencia.
export const ChatQuizModeService = {
  activate(sessionId: string): void {
    if (!fs.existsSync(STATE_DIR)) {
      fs.mkdirSync(STATE_DIR, { recursive: true });
    }
    fs.writeFileSync(statePath(sessionId), JSON.stringify({ active: true }), 'utf-8');
    logger.info('Modo explicar cuestionario activado', { sessionId });
  },

  isActive(sessionId: string): boolean {
    return fs.existsSync(statePath(sessionId));
  },

  deactivate(sessionId: string): void {
    try {
      const filePath = statePath(sessionId);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (err) {
      logger.warn('Error desactivando modo explicar cuestionario', { sessionId, error: (err as Error).message });
    }
  },
};
```

- [ ] **Step 4: Correr el test, verificar que pasa**

Run: `cd backend && npx vitest run src/services/chat/chat.quiz-mode.service.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/chat/chat.quiz-mode.service.ts backend/src/services/chat/chat.quiz-mode.service.test.ts
git commit -m "feat: flag de sesión para modo Explicar de cuestionarios"
```

---

### Task 4: Swap de system prompt en `ChatPromptService` cuando el modo Explicar está activo

**Files:**
- Modify: `backend/src/services/chat/chat.prompt.service.ts`
- Test: `backend/src/services/chat/chat.prompt.service.test.ts` (nuevo)

**Interfaces:**
- Consumes: `ChatQuizModeService.isActive(sessionId: string): boolean` (Task 3)
- Consumes: `SYSTEM_PROMPT_QUIZ_EXPLAIN: string` (Task 1)
- Produces: `ChatPromptService.buildSystemPrompt(...)` — misma firma, ahora usa `SYSTEM_PROMPT_QUIZ_EXPLAIN` en vez de `SYSTEM_PROMPT_TUTOR` cuando `sessionId` está en modo Explicar

- [ ] **Step 1: Escribir el test que falla**

```typescript
// backend/src/services/chat/chat.prompt.service.test.ts
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('../../models/user.model.js', () => ({
  UserModel: { findById: () => undefined },
}));
vi.mock('../profile.service.js', () => ({
  ProfileService: { getProfile: () => null },
}));
vi.mock('../session-summary.service.js', () => ({
  SessionSummaryService: { getSummary: () => null },
}));

import { ChatPromptService } from './chat.prompt.service.js';
import { ChatQuizModeService } from './chat.quiz-mode.service.js';

const SESSION_ID = 'prompt-swap-test-session';

describe('ChatPromptService modo Explicar', () => {
  afterEach(() => {
    ChatQuizModeService.deactivate(SESSION_ID);
  });

  it('usa SYSTEM_PROMPT_TUTOR cuando el modo Explicar no está activo', () => {
    const service = new ChatPromptService();
    const prompt = service.buildSystemPrompt('Modelo X', '', 'user-1', undefined, SESSION_ID);
    expect(prompt).not.toContain('QUIZ_EXPLAIN_DONE');
  });

  it('usa SYSTEM_PROMPT_QUIZ_EXPLAIN cuando el modo Explicar está activo', () => {
    ChatQuizModeService.activate(SESSION_ID);
    const service = new ChatPromptService();
    const prompt = service.buildSystemPrompt('Modelo X', '', 'user-1', undefined, SESSION_ID);
    expect(prompt).toContain('[[QUIZ_EXPLAIN_DONE]]');
  });
});
```

- [ ] **Step 2: Correr el test, verificar que falla**

Run: `cd backend && npx vitest run src/services/chat/chat.prompt.service.test.ts`
Expected: FAIL — el segundo test falla porque el prompt sigue siendo `SYSTEM_PROMPT_TUTOR`.

- [ ] **Step 3: Implementar el swap**

En `backend/src/services/chat/chat.prompt.service.ts`, modificar el import y el inicio de `buildSystemPrompt`:

```typescript
import { SYSTEM_PROMPT_TUTOR, SYSTEM_PROMPT_QUIZ_EXPLAIN } from '../../prompts/system.js';
import { ChatQuizModeService } from './chat.quiz-mode.service.js';
```

Y el cuerpo del método, la primera línea pasa de:

```typescript
    let prompt = SYSTEM_PROMPT_TUTOR.replace(/\{MODEL_NAME\}/g, modelLabel);
```

a:

```typescript
    const basePrompt = sessionId && ChatQuizModeService.isActive(sessionId)
      ? SYSTEM_PROMPT_QUIZ_EXPLAIN
      : SYSTEM_PROMPT_TUTOR;
    let prompt = basePrompt.replace(/\{MODEL_NAME\}/g, modelLabel);
```

- [ ] **Step 4: Correr el test, verificar que pasa**

Run: `cd backend && npx vitest run src/services/chat/chat.prompt.service.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/chat/chat.prompt.service.ts backend/src/services/chat/chat.prompt.service.test.ts
git commit -m "feat: sustituir system prompt por el de explicación paso a paso en modo Explicar"
```

---

### Task 5: `ChatQuizService` — orquestación solve/verify/retry para "Responder"

**Files:**
- Create: `backend/src/services/chat/chat.quiz.service.ts`
- Test: `backend/src/services/chat/chat.quiz.service.test.ts`

**Interfaces:**
- Consumes: `generateFromAI(providerName: string, systemPrompt: string, userPrompt: string, schema: null, options?): Promise<AIResponse>` (de `../ai/index.js`, ya existente)
- Consumes: `SYSTEM_PROMPT_QUIZ_SOLVE: string`, `SYSTEM_PROMPT_QUIZ_VERIFY: string` (Task 1)
- Produces: `resolveQuiz(quizText: string): Promise<string>` — devuelve el texto final formateado listo para persistir como mensaje de IA

- [ ] **Step 1: Escribir el test que falla**

```typescript
// backend/src/services/chat/chat.quiz.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const generateFromAIMock = vi.fn();
vi.mock('../ai/index.js', () => ({
  generateFromAI: (...args: unknown[]) => generateFromAIMock(...args),
}));

import { resolveQuiz } from './chat.quiz.service.js';

function aiResponse(content: string) {
  return { content, usage: { promptTokens: 10, completionTokens: 10 } };
}

const SOLVED_OK = JSON.stringify([
  { num: 1, pregunta: '¿Cuánto es 2+2?', desarrollo: '2+2 = 4', respuesta: '4' },
]);
const VERIFY_OK = JSON.stringify([{ num: 1, correcto: true, motivo: 'Suma correcta' }]);
const VERIFY_FAIL = JSON.stringify([{ num: 1, correcto: false, motivo: 'Error de suma' }]);

describe('resolveQuiz', () => {
  beforeEach(() => {
    generateFromAIMock.mockReset();
  });

  it('resuelve y verifica dos veces exitosamente, arma el mensaje final', async () => {
    generateFromAIMock
      .mockResolvedValueOnce(aiResponse(SOLVED_OK)) // solve
      .mockResolvedValueOnce(aiResponse(VERIFY_OK)) // verify 1
      .mockResolvedValueOnce(aiResponse(VERIFY_OK)); // verify 2

    const result = await resolveQuiz('¿Cuánto es 2+2?');

    expect(generateFromAIMock).toHaveBeenCalledTimes(3);
    expect(result).toContain('¿Cuánto es 2+2?');
    expect(result).toContain('2+2 = 4');
    expect(result).toContain('4');
    expect(result).not.toContain('No pude verificar');
  });

  it('reintenta resolver si la primera verificación falla, hasta un máximo de 3 intentos de resolución', async () => {
    generateFromAIMock
      .mockResolvedValueOnce(aiResponse(SOLVED_OK)) // solve intento 1
      .mockResolvedValueOnce(aiResponse(VERIFY_FAIL)) // verify falla
      .mockResolvedValueOnce(aiResponse(SOLVED_OK)) // solve intento 2
      .mockResolvedValueOnce(aiResponse(VERIFY_OK)) // verify 1 ok
      .mockResolvedValueOnce(aiResponse(VERIFY_OK)); // verify 2 ok

    const result = await resolveQuiz('¿Cuánto es 2+2?');

    expect(generateFromAIMock).toHaveBeenCalledTimes(5);
    expect(result).not.toContain('No pude verificar');
  });

  it('tras 3 intentos de resolución sin verificar, manda la última versión con nota de advertencia', async () => {
    generateFromAIMock
      .mockResolvedValueOnce(aiResponse(SOLVED_OK)) // solve intento 1
      .mockResolvedValueOnce(aiResponse(VERIFY_FAIL))
      .mockResolvedValueOnce(aiResponse(SOLVED_OK)) // solve intento 2
      .mockResolvedValueOnce(aiResponse(VERIFY_FAIL))
      .mockResolvedValueOnce(aiResponse(SOLVED_OK)) // solve intento 3
      .mockResolvedValueOnce(aiResponse(VERIFY_FAIL));

    const result = await resolveQuiz('¿Cuánto es 2+2?');

    expect(generateFromAIMock).toHaveBeenCalledTimes(6);
    expect(result).toContain('No pude verificar');
  });
});
```

- [ ] **Step 2: Correr el test, verificar que falla**

Run: `cd backend && npx vitest run src/services/chat/chat.quiz.service.test.ts`
Expected: FAIL — no se puede resolver el módulo `./chat.quiz.service.js`

- [ ] **Step 3: Implementar**

```typescript
// backend/src/services/chat/chat.quiz.service.ts
import { generateFromAI } from '../ai/index.js';
import { SYSTEM_PROMPT_QUIZ_SOLVE, SYSTEM_PROMPT_QUIZ_VERIFY } from '../../prompts/system.js';
import { logger } from '../../utils/logger.js';

interface SolvedItem {
  num: number;
  pregunta: string;
  desarrollo: string;
  respuesta: string;
}

interface VerifyResult {
  num: number;
  correcto: boolean;
  motivo: string;
}

const MAX_SOLVE_ATTEMPTS = 3;

function parseJSONArray<T>(raw: string): T[] {
  let cleaned = raw.trim();
  const jsonMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) cleaned = jsonMatch[1].trim();
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrayMatch) cleaned = arrayMatch[0];
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) throw new Error('La IA no devolvió un array');
  return parsed as T[];
}

async function solve(quizText: string): Promise<SolvedItem[]> {
  const result = await generateFromAI('nineRouter', SYSTEM_PROMPT_QUIZ_SOLVE, quizText);
  return parseJSONArray<SolvedItem>(result.content);
}

async function verify(items: SolvedItem[]): Promise<VerifyResult[]> {
  const userPrompt = JSON.stringify(items);
  const result = await generateFromAI('nineRouter', SYSTEM_PROMPT_QUIZ_VERIFY, userPrompt);
  return parseJSONArray<VerifyResult>(result.content);
}

function allCorrect(verifications: VerifyResult[]): boolean {
  return verifications.length > 0 && verifications.every(v => v.correcto === true);
}

function formatFinalMessage(items: SolvedItem[], lastVerification: VerifyResult[] | null): string {
  const failedNums = new Set(
    (lastVerification || []).filter(v => !v.correcto).map(v => v.num)
  );

  return items.map(item => {
    const warning = failedNums.has(item.num)
      ? '\n\n⚠️ No pude verificar esta respuesta con certeza, revísala con cuidado.'
      : '';
    return `**${item.num}.** ${item.pregunta}\n\nDesarrollo: ${item.desarrollo}\n\nRespuesta: ${item.respuesta}${warning}`;
  }).join('\n\n---\n\n');
}

// Resuelve un bloque de ejercicios y lo verifica dos veces antes de darlo por
// bueno. Si tras MAX_SOLVE_ATTEMPTS de resolución sigue habiendo ítems que no
// pasan verificación, se manda igual la última versión con advertencia por
// ítem — nunca se le niega la respuesta al estudiante.
export async function resolveQuiz(quizText: string): Promise<string> {
  let items: SolvedItem[] = [];
  let lastVerification: VerifyResult[] | null = null;

  for (let attempt = 1; attempt <= MAX_SOLVE_ATTEMPTS; attempt++) {
    items = await solve(quizText);

    const firstPass = await verify(items);
    if (!allCorrect(firstPass)) {
      lastVerification = firstPass;
      logger.warn('Verificación de cuestionario falló en primera pasada', { attempt });
      continue;
    }

    const secondPass = await verify(items);
    lastVerification = secondPass;
    if (allCorrect(secondPass)) {
      return formatFinalMessage(items, null);
    }
    logger.warn('Verificación de cuestionario falló en segunda pasada', { attempt });
  }

  logger.warn('Cuestionario no verificado tras agotar intentos, enviando última versión con advertencia', {
    attempts: MAX_SOLVE_ATTEMPTS,
  });
  return formatFinalMessage(items, lastVerification);
}
```

- [ ] **Step 4: Correr el test, verificar que pasa**

Run: `cd backend && npx vitest run src/services/chat/chat.quiz.service.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/chat/chat.quiz.service.ts backend/src/services/chat/chat.quiz.service.test.ts
git commit -m "feat: orquestación solve/verify/retry para resolver cuestionarios"
```

---

### Task 6: Endpoints — validators, controller, rutas

**Files:**
- Modify: `backend/src/validators/chat.ts`
- Modify: `backend/src/controllers/chat.controller.ts`
- Modify: `backend/src/routes/chat.routes.ts`
- Test: `backend/src/controllers/chat.quiz.controller.test.ts` (nuevo, prueba de integración liviana contra el servicio mockeado)

**Interfaces:**
- Consumes: `resolveQuiz(quizText: string): Promise<string>` (Task 5)
- Consumes: `ChatQuizModeService.activate/deactivate(sessionId: string): void` (Task 3)
- Consumes: `ChatModel.getMessageById(id: string, userId: string): ChatLogRow | undefined` (Task 2)
- Consumes: `ChatPersistenceService.saveAssistantMessageWithOutbox(userId, sessionId, content, model?): string` (ya existente)
- Produces: `resolveQuizHandler`, `startQuizExplainHandler`, `endQuizExplainHandler` (nuevos exports de `chat.controller.ts`)
- Produces: rutas `POST /api/chat/tutor/quiz/resolve`, `POST /api/chat/tutor/quiz/explain-start`, `POST /api/chat/tutor/quiz/explain-end`

- [ ] **Step 1: Agregar los schemas de validación**

En `backend/src/validators/chat.ts`, agregar al final:

```typescript
export const quizResolveSchema = z.object({
  sessionId: uuidV4,
  userMsgId: z.string().min(1, 'userMsgId requerido'),
});

export const quizExplainSchema = z.object({
  sessionId: uuidV4,
});
```

- [ ] **Step 2: Escribir el test que falla (controller)**

```typescript
// backend/src/controllers/chat.quiz.controller.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const resolveQuizMock = vi.fn();
vi.mock('../services/chat/chat.quiz.service.js', () => ({
  resolveQuiz: (...args: unknown[]) => resolveQuizMock(...args),
}));

const assertOwnershipMock = vi.fn();
const getMessageByIdMock = vi.fn();
vi.mock('../models/chat.model.js', () => ({
  ChatModel: {
    assertSessionOwnership: (...args: unknown[]) => assertOwnershipMock(...args),
    getMessageById: (...args: unknown[]) => getMessageByIdMock(...args),
  },
}));

const activateMock = vi.fn();
const deactivateMock = vi.fn();
vi.mock('../services/chat/chat.quiz-mode.service.js', () => ({
  ChatQuizModeService: {
    activate: (...args: unknown[]) => activateMock(...args),
    deactivate: (...args: unknown[]) => deactivateMock(...args),
  },
}));

const saveAssistantMock = vi.fn(() => 'new-msg-id');
vi.mock('../services/chat/chat.persistence.service.js', () => ({
  ChatPersistenceService: vi.fn().mockImplementation(() => ({
    saveAssistantMessageWithOutbox: (...args: unknown[]) => saveAssistantMock(...args),
  })),
}));

import { resolveQuizHandler, startQuizExplainHandler, endQuizExplainHandler } from './chat.controller.js';

function mockReqRes(body: Record<string, unknown>) {
  const req = { validatedBody: body, user: { id: 'user-1' } } as unknown as Request;
  const res = {
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { req, res };
}

describe('quiz endpoints', () => {
  beforeEach(() => {
    resolveQuizMock.mockReset();
    assertOwnershipMock.mockReset();
    getMessageByIdMock.mockReset();
    activateMock.mockReset();
    deactivateMock.mockReset();
    saveAssistantMock.mockClear();
  });

  it('resolveQuizHandler resuelve, persiste y devuelve la respuesta', async () => {
    getMessageByIdMock.mockReturnValue({ id: 'm1', content: '¿Cuánto es 2+2?' });
    resolveQuizMock.mockResolvedValue('**1.** ¿Cuánto es 2+2?\n\nDesarrollo: ...\n\nRespuesta: 4');

    const { req, res } = mockReqRes({ sessionId: '11111111-1111-4111-8111-111111111111', userMsgId: 'm1' });
    await resolveQuizHandler(req, res);

    expect(assertOwnershipMock).toHaveBeenCalled();
    expect(resolveQuizMock).toHaveBeenCalledWith('¿Cuánto es 2+2?');
    expect(saveAssistantMock).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ response: expect.stringContaining('4') }));
  });

  it('resolveQuizHandler devuelve 404 si el mensaje original no existe', async () => {
    getMessageByIdMock.mockReturnValue(undefined);

    const { req, res } = mockReqRes({ sessionId: '11111111-1111-4111-8111-111111111111', userMsgId: 'nope' });
    await resolveQuizHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(resolveQuizMock).not.toHaveBeenCalled();
  });

  it('startQuizExplainHandler activa el flag', async () => {
    const { req, res } = mockReqRes({ sessionId: '11111111-1111-4111-8111-111111111111' });
    await startQuizExplainHandler(req, res);

    expect(activateMock).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('endQuizExplainHandler desactiva el flag', async () => {
    const { req, res } = mockReqRes({ sessionId: '11111111-1111-4111-8111-111111111111' });
    await endQuizExplainHandler(req, res);

    expect(deactivateMock).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });
});
```

- [ ] **Step 3: Correr el test, verificar que falla**

Run: `cd backend && npx vitest run src/controllers/chat.quiz.controller.test.ts`
Expected: FAIL — `resolveQuizHandler`/`startQuizExplainHandler`/`endQuizExplainHandler` no existen en `chat.controller.js`

- [ ] **Step 4: Implementar los handlers**

En `backend/src/controllers/chat.controller.ts`, agregar los imports:

```typescript
import { resolveQuiz } from '../services/chat/chat.quiz.service.js';
import { ChatQuizModeService } from '../services/chat/chat.quiz-mode.service.js';
import { ChatPersistenceService } from '../services/chat/chat.persistence.service.js';

const persistence = new ChatPersistenceService();
```

Y agregar al final del archivo:

```typescript
export async function resolveQuizHandler(req: Request, res: Response): Promise<void> {
  const { sessionId, userMsgId } = req.validatedBody as { sessionId: string; userMsgId: string };
  const userId = req.user!.id;

  try {
    ChatModel.assertSessionOwnership(sessionId, userId);
  } catch {
    res.status(403).json({ error: 'No tienes acceso a esta sesión' });
    return;
  }

  const original = ChatModel.getMessageById(userMsgId, userId);
  if (!original) {
    res.status(404).json({ error: 'Mensaje original no encontrado' });
    return;
  }

  logger.info('Resolviendo cuestionario', { sessionId, userMsgId });

  const response = await resolveQuiz(original.content);
  persistence.saveAssistantMessageWithOutbox(userId, sessionId, response);

  res.json({ response });
}

export async function startQuizExplainHandler(req: Request, res: Response): Promise<void> {
  const { sessionId } = req.validatedBody as { sessionId: string };
  const userId = req.user!.id;

  try {
    ChatModel.assertSessionOwnership(sessionId, userId);
  } catch {
    res.status(403).json({ error: 'No tienes acceso a esta sesión' });
    return;
  }

  ChatQuizModeService.activate(sessionId);
  res.json({ success: true });
}

export async function endQuizExplainHandler(req: Request, res: Response): Promise<void> {
  const { sessionId } = req.validatedBody as { sessionId: string };
  const userId = req.user!.id;

  try {
    ChatModel.assertSessionOwnership(sessionId, userId);
  } catch {
    res.status(403).json({ error: 'No tienes acceso a esta sesión' });
    return;
  }

  ChatQuizModeService.deactivate(sessionId);
  res.json({ success: true });
}
```

- [ ] **Step 5: Correr el test, verificar que pasa**

Run: `cd backend && npx vitest run src/controllers/chat.quiz.controller.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Conectar las rutas**

En `backend/src/routes/chat.routes.ts`, agregar al import existente `resolveQuizHandler, startQuizExplainHandler, endQuizExplainHandler`, y al import de validators agregar `quizResolveSchema, quizExplainSchema`. Luego, después de la línea de `/tutor/summary`, agregar:

```typescript
router.post('/tutor/quiz/resolve', validate(quizResolveSchema), resolveQuizHandler);
router.post('/tutor/quiz/explain-start', validate(quizExplainSchema), startQuizExplainHandler);
router.post('/tutor/quiz/explain-end', validate(quizExplainSchema), endQuizExplainHandler);
```

- [ ] **Step 7: Correr toda la suite del backend**

Run: `cd backend && npm test`
Expected: PASS (todos los tests, incluidos los existentes)

- [ ] **Step 8: Commit**

```bash
git add backend/src/validators/chat.ts backend/src/controllers/chat.controller.ts backend/src/routes/chat.routes.ts backend/src/controllers/chat.quiz.controller.test.ts
git commit -m "feat: endpoints para resolver cuestionario y activar/desactivar modo Explicar"
```

---

### Task 7: Frontend — detectar `[[QUIZ_DETECTED]]` y mostrar botones Responder/Explicar

**Files:**
- Modify: `public/js/chat.js`

**Interfaces:**
- Consumes: marcador de texto `[[QUIZ_DETECTED]]` embebido al final del texto de un mensaje de IA
- Produces: función `stripQuizMarker(text)` que quita cualquiera de los marcadores conocidos y devuelve `{ text, marker }`
- Produces: botones `.msg-action-quiz-responder` / `.msg-action-quiz-explicar` en el footer del mensaje cuando `marker === 'QUIZ_DETECTED'`

No hay test automatizado de frontend en este repo (no hay suite JS) — este task se verifica manual en navegador (ver Task 9, verificación end-to-end).

- [ ] **Step 1: Agregar la función de detección de marcadores**

En `public/js/chat.js`, cerca de las demás funciones de utilidad de mensajes (junto a `formatAIResponse`), agregar:

```javascript
const QUIZ_MARKERS = ['[[QUIZ_DETECTED]]', '[[QUIZ_EXPLAIN_DONE]]'];

function stripQuizMarker(text) {
  for (const marker of QUIZ_MARKERS) {
    if (text.includes(marker)) {
      return { text: text.replace(marker, '').trimEnd(), marker: marker.slice(2, -2) };
    }
  }
  return { text, marker: null };
}
```

- [ ] **Step 2: Usar la función al renderizar el mensaje y agregar los botones**

Ubicar el bloque de renderizado de mensaje (alrededor de la línea 1250-1320, función que crea `bubble`/`textDiv`/`actions` para `sender === 'ai'`). Antes de asignar `textDiv.innerHTML = formatAIResponse(text)`, extraer el marcador:

```javascript
  let quizMarker = null;
  if (sender === 'ai') {
    const stripped = stripQuizMarker(text);
    text = stripped.text;
    quizMarker = stripped.marker;
  }
```

(mover esto antes de la creación de `textDiv` para que `formatAIResponse(text)` reciba el texto ya sin marcador).

Luego, en el bloque `else { // sender === 'ai' ... }` donde se agregan `reportBtn`/`reexplainBtn`, agregar justo después de `actions.appendChild(reexplainBtn);`:

```javascript
    if (quizMarker === 'QUIZ_DETECTED') {
      const responderBtn = document.createElement('button');
      responderBtn.className = 'msg-action msg-action-quiz';
      responderBtn.textContent = 'Responder';
      responderBtn.addEventListener('click', () => handleQuizResolve(msgRow, text));
      actions.appendChild(responderBtn);

      const explicarBtn = document.createElement('button');
      explicarBtn.className = 'msg-action msg-action-quiz';
      explicarBtn.textContent = 'Explicar';
      explicarBtn.addEventListener('click', () => handleQuizExplain());
      actions.appendChild(explicarBtn);
    }

    if (quizMarker === 'QUIZ_EXPLAIN_DONE') {
      handleQuizExplainDone();
    }
```

`handleQuizResolve`, `handleQuizExplain` y `handleQuizExplainDone` se implementan en los Tasks 8 y 9.

- [ ] **Step 3: Verificación manual básica**

No hay build step — el archivo se sirve directo. Abrir `public/chat.html` en el navegador (con el backend corriendo), mandar un mensaje que sea claramente un cuestionario (ej. "1. ¿Cuánto es 2+2? 2. ¿Cuánto es 3+3?") y confirmar en devtools que el texto renderizado NO incluye `[[QUIZ_DETECTED]]` literal. (Los botones Responder/Explicar aparecerán vacíos de funcionalidad hasta Tasks 8-9 — está bien, se verifica junto con esos tasks).

- [ ] **Step 4: Commit**

```bash
git add public/js/chat.js
git commit -m "feat: detectar marcador de cuestionario y mostrar botones Responder/Explicar"
```

---

### Task 8: Frontend — flujo "Explicar" (activar modo, mandar mensaje visible, botón Siguiente paso, detectar fin)

**Files:**
- Modify: `public/js/chat.js`

**Interfaces:**
- Consumes: `POST /api/chat/tutor/quiz/explain-start { sessionId }` (Task 6)
- Consumes: `POST /api/chat/tutor/quiz/explain-end { sessionId }` (Task 6)
- Consumes: función existente que manda un mensaje de chat normal por el stream (buscar la función que ya usa el input + botón enviar, ej. `sendMessage()` — reusar tal cual, no reimplementar el streaming)
- Produces: `handleQuizExplain()`, `handleQuizExplainDone()`, botón "Siguiente paso" que se agrega a CADA mensaje de IA subsecuente mientras el modo esté activo

- [ ] **Step 1: Confirmar el punto de entrada de envío de mensaje**

`handleSend()` (definida en `public/js/chat.js:2048`) lee el texto directo de `document.getElementById('messageInput').value` — no acepta parámetro. Para mandar un mensaje programáticamente (sin que el usuario lo escriba) hay que setear el `value` del input y llamar `handleSend()`, exactamente igual a como lo hacen los chips de sugerencia de reexplicar (`public/js/chat.js:1811-1816`, que hacen `input.value = '...'; input.focus();` — la diferencia aquí es que además hay que disparar el envío, no solo prellenar).

- [ ] **Step 2: Implementar `handleQuizExplain`, el flag local, y el botón "Siguiente paso"**

Agregar junto a las demás funciones de manejo de cuestionario:

```javascript
let quizExplainActive = false;

function triggerVisibleMessage(text) {
  const input = document.getElementById('messageInput');
  input.value = text;
  handleSend();
}

async function handleQuizExplain() {
  try {
    await fetch('/api/chat/tutor/quiz/explain-start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ sessionId }),
    });
    quizExplainActive = true;
    triggerVisibleMessage('Quiero que vayamos por partes.');
  } catch (err) {
    addMessage('Error activando el modo Explicar: ' + (err.message || 'error de conexión'), 'ai');
  }
}

function handleQuizExplainDone() {
  quizExplainActive = false;
  fetch('/api/chat/tutor/quiz/explain-end', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ sessionId }),
  }).catch(() => {});
}

function handleQuizNextStep() {
  triggerVisibleMessage('Siguiente paso.');
}
```

- [ ] **Step 3: Agregar el botón "Siguiente paso" a los mensajes de IA mientras el modo esté activo**

En el mismo bloque de footer de mensaje de IA del Task 7 (después del bloque `if (quizMarker === 'QUIZ_DETECTED') { ... }`), agregar:

```javascript
    if (quizExplainActive && quizMarker !== 'QUIZ_EXPLAIN_DONE') {
      const nextStepBtn = document.createElement('button');
      nextStepBtn.className = 'msg-action msg-action-quiz';
      nextStepBtn.textContent = 'Siguiente paso';
      nextStepBtn.addEventListener('click', () => handleQuizNextStep());
      actions.appendChild(nextStepBtn);
    }
```

- [ ] **Step 4: Verificación manual end-to-end**

Con backend corriendo: mandar un cuestionario de 2 ejercicios simples al tutor, click en "Explicar", confirmar que aparece el mensaje visible "Quiero que vayamos por partes." como burbuja de usuario, que la IA responde explicando el primer ejercicio con un botón "Siguiente paso" debajo, que al hacer click se manda "Siguiente paso." y la IA continúa, y que al terminar ambos ejercicios el botón desaparece (sin `[[QUIZ_EXPLAIN_DONE]]` visible en el texto).

- [ ] **Step 5: Commit**

```bash
git add public/js/chat.js
git commit -m "feat: flujo Explicar de cuestionarios con botón Siguiente paso"
```

---

### Task 9: Frontend — flujo "Responder"

**Files:**
- Modify: `public/js/chat.js`

**Interfaces:**
- Consumes: `POST /api/chat/tutor/quiz/resolve { sessionId, userMsgId }` (Task 6) — devuelve `{ response: string }`
- Produces: `handleQuizResolve(msgRow, quizQuestionText)`

- [ ] **Step 1: Guardar el `userMsgId` en el `msgRow` de la burbuja de IA**

Hoy `handleSend()` (el flujo normal de envío, `public/js/chat.js:2048`) recibe `json.userMsgId` en el evento `done` del stream y solo lo pasa a `setLastUserMsgId(json.userMsgId)` (línea 2218) — no lo guarda en el DOM. En `public/js/chat.js:2216-2219`:

```javascript
          if (json.done) {
            if (aiBubble && json.msgId) aiBubble.dataset.msgId = json.msgId;
            setLastUserMsgId(json.userMsgId);
            continue;
          }
```

cambiar a:

```javascript
          if (json.done) {
            if (aiBubble && json.msgId) aiBubble.dataset.msgId = json.msgId;
            if (aiBubble && json.userMsgId) aiBubble.dataset.userMsgId = json.userMsgId;
            setLastUserMsgId(json.userMsgId);
            continue;
          }
```

(`aiBubble` en ese scope es el `msgRow` de la respuesta de IA en curso — mismo elemento donde ya se setea `dataset.msgId`).

- [ ] **Step 2: Implementar `handleQuizResolve`**

```javascript
async function handleQuizResolve(msgRow, quizQuestionText) {
  const userMsgId = msgRow.dataset.userMsgId;
  if (!userMsgId) {
    addMessage('No se pudo identificar el mensaje original del cuestionario.', 'ai');
    return;
  }

  showTyping();
  try {
    const res = await fetch('/api/chat/tutor/quiz/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ sessionId, userMsgId }),
    });
    const data = await res.json();
    hideTyping();
    if (!res.ok) {
      addMessage('Error: ' + (data.error || 'no se pudo resolver el cuestionario'), 'ai');
      return;
    }
    addMessage(data.response, 'ai');
  } catch (err) {
    hideTyping();
    addMessage('Error de conexión al resolver el cuestionario.', 'ai');
  }
}
```

(reusa `addMessage(text, 'ai')` y `showTyping()`/`hideTyping()`, ya existentes en el archivo — mismo patrón usado en `handleExport`).

- [ ] **Step 3: Verificación manual end-to-end**

Con backend corriendo: mandar un cuestionario de 2-3 ejercicios simples, click en "Responder", confirmar que aparece un indicador de "escribiendo" mientras se resuelve (puede tardar varios segundos por el loop de verificación), y que el mensaje final tiene el formato número/pregunta/desarrollo/respuesta por cada ítem.

- [ ] **Step 4: Commit**

```bash
git add public/js/chat.js
git commit -m "feat: flujo Responder de cuestionarios (resolver + mostrar resultado verificado)"
```

---

## Notas de verificación final

Tras completar los 9 tasks:
- `cd backend && npm test` — toda la suite debe pasar.
- Verificación manual en navegador de los tres caminos: detección → Responder, detección → Explicar → Siguiente paso × N → fin automático.
- Confirmar que un mensaje normal (sin cuestionario) sigue sin mostrar botones extra ni activar ningún flag.
