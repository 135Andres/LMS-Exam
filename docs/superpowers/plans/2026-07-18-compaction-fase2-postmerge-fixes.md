# Compactación Fase 2 — Fix post-merge (verificador fail-silent + batching de títulos)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Contexto:** dos hallazgos del review post-merge de la Fase 2 (ya en `main`, PR #1 mergeado en `dc22766`). Ninguno rompe lo ya implementado — ambos son correcciones acotadas sobre archivos existentes, sin tocar la firma pública de `compactSession`.

**Goal:**
1. `chat.compaction-verifier.service.ts` trata un error real de la llamada de verificación (red, parseo, lo que sea) exactamente igual que "verifiqué y no falta nada" — recrea, dentro del propio mecanismo anti-silencio, el mismo patrón de silencio que la Fase 2 completa existe para eliminar. Corregir para que un fallo de verificación se distinga de una verificación exitosa.
2. `chat.block-extraction.service.ts` genera el título de cada bloque con una llamada de IA por bloque, en un `for` serial — inconsistente con `chat.segmentation.service.ts`, que ya batchea su clasificación ambigua en una sola llamada por la misma razón (evitar N round-trips seriales en una sola pasada de compactación). Unificar el criterio.

**Tech Stack:** TypeScript, Node, vitest, mismo patrón de tests que el resto de la Fase 2.

## Global Constraints

- No cambiar la firma pública de `verifyCompaction` ni de `extractBlocks` — ambas ya tienen consumidores (`chat.compaction.service.ts`) que no deben tocarse en este fix.
- No reintroducir el problema que la Fase 2 resolvió: ante un error real (de red, de parseo, lo que sea), la respuesta correcta es **señalarlo explícitamente**, nunca asumir silenciosamente el caso "todo bien".
- Los modelos son gratuitos — no hay razón de costo para evitar una llamada extra de reintento en la verificación, igual que ya se decidió para la narrativa (`MAX_NARRATIVE_FAILURES`).

---

### Task 1: Verificador cruzado — distinguir "no falta nada" de "no se pudo verificar"

**Files:**
- Modify: `backend/src/services/chat/chat.compaction-verifier.service.ts`
- Modify: `backend/src/services/chat/chat.compaction.service.ts` (consumidor, ver abajo)
- Test: `backend/src/services/chat/chat.compaction-verifier.service.test.ts` (extender)
- Test: `backend/src/services/chat/chat.compaction.service.test.ts` (extender)

**Diagnóstico exacto:** en `verifyCompaction`, el bloque `catch` actual:

```ts
} catch (err) {
  logger.warn('Error en verificación cruzada de compactación, se asume sin contenido faltante', {
    error: (err as Error).message,
  });
  return { missing: [] };
}
```

`{ missing: [] }` es indistinguible del resultado de una verificación que sí corrió y genuinamente no encontró nada faltante. El llamador (`chat.compaction.service.ts`) no tiene forma de saber cuál de los dos casos ocurrió.

**Diseño del fix:**

1. Cambiar `VerificationResult` para que el estado de éxito/fallo sea explícito, no inferido de un array vacío:

```ts
export interface VerificationResult {
  missing: MissingContentItem[];
  verified: boolean; // false si la llamada falló (red, parseo, respuesta inválida) — no confundir con "verified: true, missing: []"
}
```

2. En el `catch` de `verifyCompaction`, devolver `{ missing: [], verified: false }` en vez de solo `{ missing: [] }`. En el camino feliz (parseo exitoso), devolver `{ missing: parsed.missing, verified: true }`.

3. En `chat.compaction.service.ts`, donde hoy se llama `verifyCompaction` y se usa el resultado directo:

```ts
const verification = await verifyCompaction(newMessages, narrativeResult.summary, blocks, verifierModel);
const finalNarrative = appendMissingContent(narrativeResult.summary, verification.missing);
```

Cambiar para que `verification.verified === false` **reintente una vez** (mismo patrón que ya existe para la narrativa: un reintento, y si sigue fallando, no se descarta el trabajo ya hecho — se guarda la narrativa igual, pero queda marcado que la verificación no se completó):

```ts
let verification = await verifyCompaction(newMessages, narrativeResult.summary, blocks, verifierModel);
if (!verification.verified) {
  logger.warn('Verificación cruzada falló, reintentando una vez', { sessionId, verifierModel });
  verification = await verifyCompaction(newMessages, narrativeResult.summary, blocks, verifierModel);
}

let finalNarrative = appendMissingContent(narrativeResult.summary, verification.missing);
if (!verification.verified) {
  // No se pudo confirmar completitud tras el reintento — se guarda igual
  // (los bloques y la narrativa son válidos por sí mismos), pero se marca
  // explícitamente en vez de asumir en silencio que la verificación pasó.
  finalNarrative += '\n\n--- Nota: la verificación cruzada de esta pasada no pudo completarse (error técnico), no confirmada ---';
  logger.warn('Verificación cruzada no se pudo completar tras reintento, se guarda narrativa sin confirmar', { sessionId, verifierModel });
}
```

**Por qué anexar una nota en la narrativa y no bloquear el guardado:** los bloques y la narrativa generados en esta pasada ya son válidos (no son producto del fallo de verificación, son independientes). Bloquear el guardado completo por un fallo de red en un paso *adicional* de auditoría sería peor que el problema que se corrige — perdería trabajo real por un fallo en una capa de control. La nota deja rastro auditable (igual que pide spec 4.5) sin descartar nada.

- [ ] **Step 1: Tests que fallan**
  - `verifyCompaction` devuelve `verified: false` cuando `generateFromAI` lanza error (mock de fetch fallando).
  - `verifyCompaction` devuelve `verified: true, missing: [...]` en el camino feliz, incluyendo el caso `missing: []` genuino (verificado con éxito, nada faltante — debe seguir siendo distinguible del caso de error en el test).
  - `compactSession`: si la primera verificación falla (`verified: false`), se reintenta una vez.
  - `compactSession`: si el reintento de verificación también falla, la narrativa se guarda igual, con la nota de "no confirmada" anexada, y esto se loguea como warning (no como error silencioso).
  - `compactSession`: si el reintento de verificación sí tiene éxito, se usa ese resultado normalmente (sin la nota de "no confirmada").
- [ ] **Step 2: Correr para confirmar que fallan**
- [ ] **Step 3: Implementar** los cambios en `chat.compaction-verifier.service.ts` y `chat.compaction.service.ts`
- [ ] **Step 4: Correr para confirmar que pasan, y correr `npm test` completo** (confirmar que el test de integración `chat.compaction.integration.test.ts` sigue pasando sin cambios)
- [ ] **Step 5: Commit**

---

### Task 2: Batchear la generación de títulos en `chat.block-extraction.service.ts`

**Files:**
- Modify: `backend/src/services/chat/chat.block-extraction.service.ts`
- Test: `backend/src/services/chat/chat.block-extraction.service.test.ts` (extender)

**Diagnóstico exacto:** hoy, `extractBlocks` recorre los segmentos verificables en un `for...of` con `await generateShortTitle(msg.content, model)` dentro del loop — una llamada de IA serial por bloque. Si una pasada de compactación tiene, por ejemplo, 4 mensajes verificables nuevos, son 4 round-trips seriales solo para títulos. `chat.segmentation.service.ts` ya resolvió el mismo tipo de problema (clasificación de mensajes ambiguos) con **una sola llamada batcheada** para todos los ítems de la pasada — este fix aplica el mismo patrón acá, por consistencia y para no alargar la latencia de la compactación en segundo plano sin necesidad.

**Diseño del fix:** reemplazar `generateShortTitle` (llamada individual) por `generateShortTitlesBatch` (una llamada, N ítems), siguiendo el mismo patrón de `json_schema` que ya usa `chat.segmentation.service.ts` y `chat.compaction-verifier.service.ts` — no inventar un formato nuevo, replicar el que ya está probado en este mismo módulo.

```ts
const SYSTEM_PROMPT_TITLES_BATCH = 'Genera un título corto (máximo 8 palabras) para cada uno de los siguientes fragmentos de contenido académico. Responde con un título por fragmento, en el mismo orden, identificado por su id.';

interface TitleBatchItem {
  id: string;
  title: string;
}

async function generateShortTitlesBatch(
  items: Array<{ id: string; content: string }>,
  model: string,
): Promise<Record<string, string>> {
  if (items.length === 0) return {};

  const userPrompt = items.map(i => `(id: ${i.id})\n${i.content}`).join('\n\n---\n\n');

  try {
    const result = await generateFromAI('nineRouter', SYSTEM_PROMPT_TITLES_BATCH, userPrompt, {
      type: 'json_object',
      json_schema: {
        type: 'object',
        properties: {
          titles: {
            type: 'array',
            items: {
              type: 'object',
              properties: { id: { type: 'string' }, title: { type: 'string' } },
              required: ['id', 'title'],
            },
          },
        },
        required: ['titles'],
      },
    }, { model, temperature: 0.3, max_tokens: 800 });

    const parsed = JSON.parse(result.content) as { titles?: TitleBatchItem[] };
    const byId = new Map((parsed.titles || []).map(t => [t.id, t.title]));

    const out: Record<string, string> = {};
    for (const item of items) {
      out[item.id] = byId.get(item.id) || item.content.slice(0, 60).trim(); // mismo fallback que la versión individual
    }
    return out;
  } catch (err) {
    logger.warn('Error en batch de títulos de bloques, se usa fallback por truncamiento', { error: (err as Error).message });
    const out: Record<string, string> = {};
    for (const item of items) out[item.id] = item.content.slice(0, 60).trim();
    return out;
  }
}
```

Reescribir `extractBlocks` para juntar primero todos los `{ id, content }` pendientes de título (los que pasaron el chequeo de idempotencia), pedir el batch una sola vez, y después armar los bloques:

```ts
export async function extractBlocks(
  sessionId: string,
  messages: ExtractableMessage[],
  segments: SegmentationResult[],
  model: string,
  userId?: string,
): Promise<KnowledgeBlock[]> {
  const verificable = segments.filter(s => s.class === 'verificable');
  if (verificable.length === 0) return [];

  const existingBlocks = SessionSummaryService.getBlocks(sessionId);
  const alreadyExtracted = new Set(existingBlocks.flatMap(b => b.extractedFromMessages));

  const pending = verificable
    .filter(seg => !alreadyExtracted.has(seg.messageId))
    .map(seg => ({ seg, msg: messages.find(m => m.id === seg.messageId) }))
    .filter((x): x is { seg: SegmentationResult; msg: ExtractableMessage } => !!x.msg);

  if (pending.length === 0) return [];

  const titles = await generateShortTitlesBatch(
    pending.map(({ msg }) => ({ id: msg.id, content: msg.content })),
    model,
  );

  const blocks: KnowledgeBlock[] = [];
  for (const { seg, msg } of pending) {
    const content = trimLeadingFillers(msg.content);
    const subject = detectSubjectExtended(msg.content) || 'general';

    const block = SessionSummaryService.addBlock(sessionId, {
      subject,
      extractedFromMessages: [msg.id],
      extractedAt: new Date().toISOString(),
      extractionModel: model,
      confidence: seg.confidence,
      title: titles[msg.id],
      content,
    });
    blocks.push(block);
    maybeAddToCollectiveKB(block, userId);
  }

  return blocks;
}
```

`generateShortTitle` (la versión individual) puede quedar como función privada eliminada, o conservarse sin usar solo si algún test viejo la importa directo — revisar y limpiar si quedó huérfana.

- [ ] **Step 1: Tests que fallan**
  - `extractBlocks` con 3+ segmentos verificables nuevos llama a `generateFromAI` **exactamente 1 vez** para títulos (no 1 vez por bloque) — assertion sobre el mock de `generateFromAI`.
  - Cada bloque recibe el título correspondiente a su `id` del batch, en el orden correcto (no mezclados entre sí).
  - Si el batch falla (mock de error), cada bloque cae al fallback de truncamiento (`content.slice(0, 60)`), igual que la versión individual.
  - Idempotencia sigue funcionando igual: mensajes ya extraídos no entran ni al batch de títulos ni generan bloque nuevo.
- [ ] **Step 2: Correr para confirmar que fallan**
- [ ] **Step 3: Implementar**
- [ ] **Step 4: Correr para confirmar que pasan, y correr `npm test` completo**
- [ ] **Step 5: Commit**

---

### Task 3: Regresión final

- [ ] **Step 1:** `cd backend && npm test` — mismo resultado que antes de este fix en todo lo demás (167 pasan + el mismo test pre-existente de `chat.profile-detection.test.ts` roto, sin empeorar ni arreglar ese aparte).
- [ ] **Step 2:** Confirmar que `chat.compaction.integration.test.ts` (el test end-to-end del caso real "integración por partes") sigue pasando sin modificaciones — es la señal de que ninguno de los dos fixes rompió el flujo principal.
- [ ] **Step 3:** Commit final + push a una rama nueva (ej. `compaction-fase2-fixes`), no directo a `main` — igual que se hizo con la Fase 2 completa, para poder revisar el diff antes de mergear.
