# Compactación Fase 2 (Modelo de dos pistas) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fase 2 del rediseño de compactación (ver `docs/superpowers/specs/2026-07-17-context-compaction-redesign-design.md`, secciones 2, 3, 4): reemplazar el resumen monolítico de `session-summary.service.ts` por un modelo de dos pistas (`narrative.md` comprimible + `blocks/` verbatim inmutables + `index.json` auditable), y convertir `compactSession` de una sola llamada a un pipeline de 3 pasos (segmentación → extracción → compactación narrativa) con verificación cruzada obligatoria (Paso 4).

**Depende de Fase 1 (ya implementada y verificada, 9/9 tests pasando):** `finish_reason` expuesto en `AIResponse`, retry en truncamiento, `COMPACTION_MODEL_MAP` dinámico, prompt sin tope de palabras. Esta fase **reutiliza** esa lógica de retry para el Paso 3 (compactación narrativa) — no la reescribe.

**Architecture:** Cuatro piezas nuevas sobre lo existente:
1. `session-summary.service.ts` migra de archivo único a estructura de carpeta por sesión.
2. Nuevo `chat.segmentation.service.ts`: clasifica mensajes nuevos en `verificable` / `narrativo` (heurística primero, IA solo para casos ambiguos, en un único batch).
3. Nuevo `chat.block-extraction.service.ts`: extrae contenido verificable a bloques inmutables, casi sin tocar el texto original.
4. `chat.compaction.service.ts` se reescribe como orquestador de los 3+1 pasos, delegando en los servicios anteriores.

**Tech Stack:** TypeScript, Node, vitest, 9router (OpenAI-compatible `/v1/chat/completions`), filesystem (mismo patrón que `session-summary.service.ts` actual).

## Global Constraints

- **Nunca borrar nada.** Los mensajes crudos en `chat_logs` siguen siendo la fuente de verdad — esto no cambia. Los `blocks/` son inmutables una vez creados: una explicación mejor del mismo tema crea un bloque nuevo con `supersedes: block_<id_viejo>`, nunca edita el original (spec 2.2).
- **La pista narrativa es la única que se re-comprime.** El paso de compactación narrativa (Paso 3) jamás recibe como entrada el contenido de un bloque ya extraído — solo referencias (`block_ab12: "título"`).
- **Ante la duda, se conserva.** Si la clasificación heurística y la de IA no coinciden, o la confianza es media/baja → tratar como contenido verificable (crear bloque), nunca descartar (spec 3, Paso 1). Esto es más simple de implementar que una tercera categoría "ambiguo" con su propio flujo, y cumple el principio 4 de la spec sin agregar una rama de código extra.
- **El cursor avanza por mensaje procesado, no solo si la narrativa compactó con éxito.** Esto es lo que resuelve el problema de "stall permanente" documentado en el comentario `ponytail` de `chat.compaction.service.ts` actual: si el Paso 3 (narrativa) falla o trunca, los bloques del Paso 2 ya se guardaron y el cursor de bloques ya avanzó independientemente. Ver Task 4.
- **Segunda opinión (verificación cruzada) es obligatoria en toda compactación, sin excepción** — no hay presupuesto de tokens que la haga condicional (spec 4.3, confirmado en sección 9 de la spec: "sin límite, se prioriza calidad").
- No implementar en esta fase: la UI del sidebar (`contextPanel`, sección 7 de la spec) ni el foldering jerárquico (sección 6). Eso es Fase 3 y Fase 5 respectivamente.
- No tocar `chat.orchestrator.service.ts` ni `chat.classifier.service.ts` — se **reutilizan** (ver Task 2), no se modifican.

---

### Task 1: Modelo de datos — `session-summary.service.ts` migra a carpeta por sesión

**Files:**
- Modify: `backend/src/services/session-summary.service.ts` (reescritura completa)
- Test: `backend/src/services/session-summary.service.test.ts` (nuevo)

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces: API nueva que consumen Task 3 y Task 4:
  ```ts
  export interface KnowledgeBlock {
    id: string;               // block_<uuid>
    subject: string;
    extractedFromMessages: string[]; // ids de chat_logs
    extractedAt: string;
    extractionModel: string;
    confidence: 'high' | 'medium' | 'low';
    supersedes?: string;      // id de bloque anterior, si aplica
    title: string;
    content: string;          // casi-verbatim del original
  }

  export const SessionSummaryService = {
    getNarrative(sessionId: string): string | null,
    saveNarrative(sessionId: string, content: string, meta: { model: string; confidence: string }): void,
    getBlocks(sessionId: string): KnowledgeBlock[],
    addBlock(sessionId: string, block: Omit<KnowledgeBlock, 'id'>): KnowledgeBlock, // genera id, escribe archivo, actualiza index.json
    getIndex(sessionId): { narrativeCompactions: Array<{...}>; blocks: Array<{...}> },
    deleteSummary(sessionId: string): void, // ahora borra la carpeta completa
  };
  ```

**Migración de datos existentes (lazy, no un job aparte):**
- Al llamar `getNarrative(sessionId)`, si no existe `data/session-summaries/{sessionId}/narrative.md` PERO existe el archivo viejo `data/session-summaries/{sessionId}.md`, migrar automáticamente: crear la carpeta, mover el contenido a `narrative.md`, crear `index.json` vacío (`blocks: []`), y borrar el archivo viejo. Sin `blocks/` retroactivos — el resumen viejo queda como narrativa inicial, tal como dice la spec sección 8, Fase 2, punto 5.
- Esto evita un script de migración separado y un estado transitorio de "sesiones migradas vs no migradas" que haya que trackear.

- [ ] **Step 1: Escribir tests que fallan** (casos: `getNarrative` migra archivo viejo automáticamente y lo borra; `addBlock` crea archivo + entrada en `index.json` con id incremental; `getBlocks` devuelve lista vacía si no hay carpeta; `saveNarrative` no toca `blocks/`; `deleteSummary` borra la carpeta completa incluyendo `blocks/`)
- [ ] **Step 2: Correr para confirmar que fallan**
- [ ] **Step 3: Implementar** la reescritura completa del servicio
- [ ] **Step 4: Correr para confirmar que pasan**
- [ ] **Step 5: Commit**

---

### Task 2: `chat.segmentation.service.ts` — clasificación por mensaje

**Files:**
- Create: `backend/src/services/chat/chat.segmentation.service.ts`
- Test: `backend/src/services/chat/chat.segmentation.service.test.ts` (nuevo)

**Interfaces:**
- Consumes: **reutiliza** `hasCode()` y las señales de complejidad ya escritas en `chat.classifier.service.ts` (Fase de orquestación) — no reimplementar detección de código desde cero, importar y usar.
- Produces: `SegmentationResult[]` que consume Task 3 (extracción) y Task 4 (compactación narrativa).

```ts
export type SegmentClass = 'verificable' | 'narrativo';

export interface SegmentationResult {
  messageId: string;
  class: SegmentClass;
  confidence: 'high' | 'medium' | 'low';
  method: 'heuristic' | 'llm-batch';
}

const VERIFICABLE_MARKERS = [
  /\$\$?[^$]+\$\$?/,                          // LaTeX inline o bloque
  /```/,                                       // código (reusa hasCode de chat.classifier.service.ts)
  /\b(por lo tanto|entonces|demostraci[oó]n|derivaci[oó]n|paso a paso|definici[oó]n de)\b/i,
];

const NARRATIVE_MARKERS = [
  /^(ok|gracias|entendido|listo|perfecto|dale)\b/i, // mensajes cortos de confirmación
];

function classifyHeuristic(message: { id: string; content: string; role: string }): SegmentationResult | null {
  if (message.content.length < 30 && NARRATIVE_MARKERS.some(re => re.test(message.content))) {
    return { messageId: message.id, class: 'narrativo', confidence: 'high', method: 'heuristic' };
  }
  if (VERIFICABLE_MARKERS.some(re => re.test(message.content)) || hasCode(message.content)) {
    return { messageId: message.id, class: 'verificable', confidence: 'high', method: 'heuristic' };
  }
  if (message.content.length > 400 && message.role === 'assistant') {
    // explicación larga del asistente sin marcadores explícitos — probable
    // candidato, pero sin la certeza de un marcador explícito.
    return { messageId: message.id, class: 'verificable', confidence: 'medium', method: 'heuristic' };
  }
  return null; // inconcluso, escalar a batch de IA
}
```

**Regla de resolución (constraint global aplicada aquí):** los mensajes que la heurística no resuelve (`null`) se agrupan y se mandan en **un solo batch** a IA (no una llamada por mensaje) pidiendo clasificación de cada uno. Si la respuesta del batch para un mensaje específico viene con confianza `low` o el modelo no logra parsear ese ítem → default a `verificable` (nunca a `narrativo` en caso de duda, por el principio "ante la duda, se conserva").

- [ ] **Step 1: Tests que fallan** — cubrir: heurística de LaTeX/código clasifica sin llamar IA; mensaje corto de confirmación clasifica como narrativo sin IA; mensaje ambiguo (sin marcadores, <400 chars) escala a batch; batch con confianza `low` en un ítem cae a `verificable` por default; **cobertura total**: `segmentMessages(newMessages).length === newMessages.length` siempre (spec 4.2, chequeo mecánico de cobertura).
- [ ] **Step 2: Confirmar que fallan**
- [ ] **Step 3: Implementar** `segmentMessages(messages, model): Promise<SegmentationResult[]>`
- [ ] **Step 4: Confirmar que pasan**
- [ ] **Step 5: Commit**

---

### Task 3: `chat.block-extraction.service.ts` — extracción verbatim

**Files:**
- Create: `backend/src/services/chat/chat.block-extraction.service.ts`
- Test: `backend/src/services/chat/chat.block-extraction.service.test.ts` (nuevo)

**Interfaces:**
- Consumes: `SegmentationResult[]` de Task 2 (filtrar `class === 'verificable'`), `SessionSummaryService.addBlock` de Task 1.
- Produces: bloques persistidos, consumidos por Task 4 (narrativa los referencia) y por el pipeline existente de `kbCandidates` (ver nota abajo).

**Diseño clave: NO reformular el contenido técnico.** El bloque se arma con el texto original del mensaje (trim de muletillas conversacionales tipo "claro, te explico:" al inicio, nada más). Solo se usa una llamada de IA barata para generar **metadata** (`title`, `subject` — reutilizando `detectSubjectExtended` de `chat.classifier.service.ts`), nunca para reescribir el contenido:

```ts
export async function extractBlocks(
  sessionId: string,
  messages: Array<{ id: string; content: string; role: string }>,
  segments: SegmentationResult[],
  model: string,
): Promise<KnowledgeBlock[]> {
  const verificable = segments.filter(s => s.class === 'verificable');
  const blocks: KnowledgeBlock[] = [];

  for (const seg of verificable) {
    const msg = messages.find(m => m.id === seg.messageId)!;
    const subject = detectSubjectExtended(msg.content) || 'general';
    const title = await generateShortTitle(msg.content, model); // 1 llamada corta, solo título, no reescribe el cuerpo
    blocks.push(
      SessionSummaryService.addBlock(sessionId, {
        subject,
        extractedFromMessages: [msg.id],
        extractedAt: new Date().toISOString(),
        extractionModel: model,
        confidence: seg.confidence,
        title,
        content: msg.content.trim(),
      }),
    );
  }
  return blocks;
}
```

**Nota de integración con KB colectiva:** el pipeline actual de `kbCandidates` en `chat.compaction.service.ts` (Fase 1) generaba candidatos vía el mismo prompt monolítico. En Fase 2, los bloques `confidence: high|medium` con contenido genuinamente reutilizable (no dudas puntuales del estudiante) son el input directo para `KnowledgeModel.create(...)` con `status: 'pending_review'` — mismo comportamiento que hoy, pero la fuente ahora es un bloque ya extraído en vez de un campo separado del JSON de compactación. Reutilizar la lógica existente de filtrado (`content.trim().length < 40` → skip, `existsByHash` → skip duplicados) tal cual está en el `chat.compaction.service.ts` actual, moviéndola a este servicio.

- [ ] **Step 1: Tests que fallan** — extracción no reformula el contenido (el `content` del bloque debe ser substring casi exacto del mensaje original, permitiendo solo trim de muletillas iniciales conocidas); genera título vía IA pero no modifica el cuerpo; bloques con contenido reutilizable llegan a `KnowledgeModel.create`; duplicados por hash se saltan igual que en Fase 1.
- [ ] **Step 2: Confirmar que fallan**
- [ ] **Step 3: Implementar**
- [ ] **Step 4: Confirmar que pasan**
- [ ] **Step 5: Commit**

---

### Task 4: Reescribir `compactSession` como orquestador de 4 pasos

**Files:**
- Modify: `backend/src/services/chat/chat.compaction.service.ts` (reescritura completa del cuerpo de `compactSession`)
- Modify: `backend/src/services/chat/chat.compaction.service.test.ts` (actualizar tests existentes de Fase 1 al nuevo flujo, no borrarlos — el retry/finishReason sigue igual, solo cambia qué texto se manda a compactar)

**Interfaces:**
- Consumes: `segmentMessages` (Task 2), `extractBlocks` (Task 3), `SessionSummaryService` nuevo (Task 1), `resolveCompactionModel`/`COMPACTION_MODEL_MAP` (ya existe de Fase 1, sin cambios).
- Produces: misma firma pública `compactSession(sessionId, userId, force)` — no rompe a quien la llama (`chat.completion.service.ts`, `chat.streaming.service.ts`, cron de compactación en background si existe).

```ts
export async function compactSession(sessionId: string, userId: string, force = false): Promise<void> {
  const cursor = ChatModel.getSummaryCursor(sessionId);
  const newMessages = ChatModel.getMessagesSince(sessionId, cursor)
    .filter(m => m.role === 'user' || m.role === 'assistant');

  if (newMessages.length === 0) return;
  if (!force && newMessages.length < MIN_MESSAGES_TO_COMPACT) return;

  const model = resolveCompactionModel(sessionId); // sin cambios de Fase 1

  // Paso 1 — Segmentación (heurística + batch IA para lo inconcluso)
  const segments = await segmentMessages(newMessages, model);

  // Chequeo de cobertura mecánico (spec 4.2) — sin esto no se avanza al paso 2
  if (segments.length !== newMessages.length) {
    logger.warn('Segmentación incompleta, se aborta esta pasada', { sessionId, expected: newMessages.length, got: segments.length });
    return; // no avanza cursor, se reintentará en la próxima pasada de compactación
  }

  // Paso 2 — Extracción de bloques verbatim (siempre se ejecuta y persiste,
  // INDEPENDIENTE de si el Paso 3 más adelante falla o trunca — esto es lo
  // que resuelve el stall permanente documentado como "ponytail" en Fase 1)
  const blocks = await extractBlocks(sessionId, newMessages, segments, model);

  // Paso 3 — Compactación narrativa (reusa retry/finishReason de Fase 1,
  // pero el userPrompt ahora excluye contenido verificable, solo lo referencia)
  const narrativeMessages = newMessages.filter(m => segments.find(s => s.messageId === m.id)?.class === 'narrativo');
  const priorNarrative = SessionSummaryService.getNarrative(sessionId) || '(sin resumen previo)';
  const blockRefs = blocks.map(b => `- ${b.id}: "${b.title}" (ver blocks/${b.id}.md)`).join('\n');
  const userPrompt = buildNarrativePrompt(priorNarrative, narrativeMessages, blockRefs);

  const narrativeResult = await runNarrativeCompaction(userPrompt, model); // misma lógica de retry/finishReason de Fase 1, extraída a helper

  if (!narrativeResult) {
    // Paso 3 falló/truncó tras reintento — se descarta SOLO la narrativa.
    // Los bloques del Paso 2 YA quedaron guardados y el cursor de esta
    // pasada NO avanza (para que los mismos mensajes se reintenten en la
    // narrativa la próxima vez) — pero no se re-extraen bloques ya creados,
    // porque Paso 2 es idempotente por messageId (ver Task 3, chequear
    // existencia antes de re-extraer si compactSession corre de nuevo sobre
    // el mismo rango antes de que el cursor avance).
    logger.warn('Narrativa truncada tras reintento, bloques ya persistidos, narrativa pendiente', { sessionId, model });
    return;
  }

  // Paso 4 — Verificación cruzada OBLIGATORIA (spec 4.3)
  const verifierModel = pickVerifierModel(model); // modelo de OTRA familia, ver Task 5
  const verification = await verifyCompaction(newMessages, narrativeResult.summary, blocks, verifierModel);

  if (verification.missing.length > 0) {
    // Se agrega directo, no se manda a cola de revisión separada (spec 4.4)
    for (const missing of verification.missing) {
      await appendMissingContent(sessionId, missing, model);
    }
  }

  SessionSummaryService.saveNarrative(sessionId, narrativeResult.summary, { model, confidence: narrativeResult.confidence });
  ChatModel.setSummaryCursor(sessionId, newMessages[newMessages.length - 1].created_at);

  logger.info('Sesión compactada (dos pistas)', {
    sessionId, model, messagesCompacted: newMessages.length,
    blocksExtracted: blocks.length, verificationGaps: verification.missing.length,
  });
}
```

**Nota sobre idempotencia de Task 3 (Paso 2):** como el cursor puede no avanzar si el Paso 3 falla repetidamente, `extractBlocks` debe chequear en `index.json` si un `messageId` ya tiene un bloque asociado antes de crear uno nuevo — evita duplicar bloques si `compactSession` se reintenta sobre el mismo rango de mensajes.

- [ ] **Step 1: Actualizar tests existentes de Fase 1** al nuevo flujo (mockear `segmentMessages`, `extractBlocks`, `verifyCompaction`) + tests nuevos: cobertura incompleta aborta sin avanzar cursor; bloques persisten aunque narrativa falle; verificación agrega contenido faltante directo (no cola); idempotencia de extracción en reintento.
- [ ] **Step 2: Confirmar que fallan**
- [ ] **Step 3: Implementar**
- [ ] **Step 4: Confirmar que pasan, y correr `npm test` completo** (confirmar que `chat.streaming.service.test.ts`/`chat.completion.service.test.ts` que mockean `compactSession` siguen pasando sin cambios — firma pública intacta)
- [ ] **Step 5: Commit**

---

### Task 5: Verificación cruzada obligatoria (`chat.compaction-verifier.service.ts`)

**Files:**
- Create: `backend/src/services/chat/chat.compaction-verifier.service.ts`
- Test: `backend/src/services/chat/chat.compaction-verifier.service.test.ts` (nuevo)

**Interfaces:**
- Consumes: nada nuevo (mensajes originales, narrativa generada, bloques generados — todo ya existe en Task 4).
- Produces: `{ missing: Array<{ description: string; suggestedBlock?: boolean }> }` que Task 4 usa para `appendMissingContent`.

```ts
// Modelo de otra FAMILIA al que compactó — no el mismo proveedor con otro
// nombre. Mapa simple invertido respecto a COMPACTION_MODEL_MAP.
function pickVerifierModel(compactionModel: string): string {
  if (compactionModel.startsWith('nvidia/')) return 'ag/gemini-3-flash';
  return 'nvidia/z-ai/glm-5.2';
}

export async function verifyCompaction(
  originalMessages: ChatMessage[],
  narrative: string,
  blocks: KnowledgeBlock[],
  verifierModel: string,
): Promise<{ missing: Array<{ description: string }> }> {
  const prompt = `Acá está la conversación original y el resumen (narrativa + bloques) que otro modelo generó a partir de ella.
¿Falta alguna explicación, derivación, definición o dato técnico del original que no está reflejado ni en la narrativa ni en los bloques?
Responde JSON: { "missing": [{ "description": "..." }] }. Si no falta nada, "missing": [].`;
  // ... llamada a generateFromAI con verifierModel, parseo defensivo
}
```

- [ ] **Step 1: Tests que fallan** — verificador detecta contenido faltante y lo reporta; verificador usa modelo de otra familia (assertion sobre qué modelo se llamó según `pickVerifierModel`); si no falta nada devuelve `missing: []` y Task 4 no llama `appendMissingContent`.
- [ ] **Step 2: Confirmar que fallan**
- [ ] **Step 3: Implementar**
- [ ] **Step 4: Confirmar que pasan**
- [ ] **Step 5: Commit**

---

### Task 6: Detección heurística de "alucinación de ausencia" (spec sección 5.2)

**Files:**
- Modify: `chat.segmentation.service.ts` o `chat.compaction.service.ts` (agregar chequeo mecánico previo, sin costo de IA)

Antes de aceptar el resultado del Paso 1 (segmentación) o Paso 3 (narrativa) como "no hay contenido verificable/académico": si `newMessages` contiene bloques de código, LaTeX, o mensajes de asistente >N caracteres, y el resultado dice que no hay nada relevante → **contradicción mecánicamente detectable, forzar reintento sin gastar otra llamada de IA para la primera señal de alarma** (spec 5, punto 2). Esto es un chequeo barato adicional sobre lo que ya hace Task 2 con sus marcadores heurísticos — reusar las mismas regex de `VERIFICABLE_MARKERS`.

- [ ] **Step 1: Test que falla** — narrativa/segmentación que dice "sin contenido académico" cuando hay un bloque de código en `newMessages` → se rechaza y se reintenta.
- [ ] **Step 2: Confirmar que falla**
- [ ] **Step 3: Implementar**
- [ ] **Step 4: Confirmar que pasa**
- [ ] **Step 5: Commit**

---

### Task 7: Suite completa + regresión

- [ ] **Step 1:** `cd backend && npm test` — 100% verde, incluyendo el test roto de `chat.profile-detection.test.ts` reportado aparte (no forma parte de esta fase, pero confirmar que sigue igual de roto o ya se arregló en paralelo, no lo empeoramos).
- [ ] **Step 2:** Prueba manual/integración: simular una sesión con una explicación de "integración por partes" (el caso real que disparó todo esto) + mensajes narrativos alrededor → confirmar que el bloque se extrae verbatim, la narrativa lo referencia por id, y `getBlocks(sessionId)` lo devuelve completo.
- [ ] **Step 3:** Commit final de la fase + actualizar `docs/superpowers/specs/2026-07-17-context-compaction-redesign-design.md` marcando Fase 2 como implementada.

---

## Fuera de alcance de este plan (recordatorio)

- UI del sidebar (`contextPanel`, "Resumen de la sesión" desplegable, edición manual) — Fase 3, spec sección 7.
- Endpoints `GET/PUT /api/chat/summary` — Fase 3, mismo motivo.
- Foldering jerárquico (`folder_<uuid>/`) — Fase 5, no antes de que exista la feature de carpetas en el producto.
