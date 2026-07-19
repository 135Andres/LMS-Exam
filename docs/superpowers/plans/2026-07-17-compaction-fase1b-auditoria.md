# Compactación Fase 1b (Auditoría de confianza y cobertura) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** cerrar el gap encontrado en code review de Fase 1: `SYSTEM_PROMPT_COMPACTOR` ya le exige al modelo devolver `confidence` (`high`/`medium`/`low`) y `reviewedMessageCount` junto al resumen, pero `chat.compaction.service.ts` nunca lee esos dos campos — ni los valida, ni los loguea, ni actúa sobre ellos. El safeguard anti-alucinación (spec 4.2, "verificación de cobertura") existe en el prompt pero no funciona en runtime. Esta fase lo cierra sin tocar el pipeline de 2 pistas (eso sigue siendo Fase 2).

**Contexto:** ver `docs/superpowers/specs/2026-07-17-context-compaction-redesign-design.md` sección 4.2, y `docs/superpowers/plans/2026-07-17-compaction-fase1-fundamentos.md` (Fase 1, ya mergeada).

**Architecture:** un solo cambio acumulativo sobre `compactSession` en `chat.compaction.service.ts`: (1) extender `CompactionResult` para tipar los dos campos, (2) después de un parseo exitoso (nunca truncado — eso ya lo maneja Fase 1), comparar `reviewedMessageCount` contra el conteo real de mensajes de entrada y detectar `confidence` no-alta, (3) loguear ambas señales siempre — como warning si hay mismatch/baja confianza, incluidas en el log de éxito en cualquier caso. **No se bloquea ni se reintenta la compactación por esto** — la corrección activa (segunda opinión de otro modelo) es explícitamente Fase 3 y no entra acá; esta fase es solo hacer visible/auditable lo que el modelo ya está reportando.

**Tech Stack:** TypeScript, Node, vitest.

## Global Constraints

- No cambiar el comportamiento de truncamiento (`finish_reason === 'length'`) ya implementado en Fase 1 — este plan es aditivo, no lo toca.
- No implementar todavía la segunda opinión con otro modelo (spec 4.3) ni bloquear/reintentar por mismatch de cobertura — eso es Fase 3. Esta fase solo agrega visibilidad (logging), nunca cambia si se guarda o no un resumen válido y no truncado.
- No tocar el pipeline de 2 pistas (`narrative.md` + `blocks/`) — eso sigue siendo Fase 2, sin cambios acá.
- El resumen y los `kbCandidates` se siguen guardando igual que hoy incluso si hay mismatch de cobertura o `confidence: "low"` — la única diferencia es que ahora queda logueado y es auditable.
- Definición de "mismatch de cobertura": `reviewedMessageCount` es un número y es **estrictamente menor** que `newMessages.length` (el modelo dice haber revisado menos mensajes de los que realmente había — el patrón exacto del bug original, donde se saltó contenido). Si `reviewedMessageCount` es mayor o igual, o si el campo no vino en la respuesta, no cuenta como "mismatch" para efectos de esta fase (ausencia del campo se loguea aparte, ver Task 1).

---

### Task 1: leer y auditar `confidence`/`reviewedMessageCount` en `chat.compaction.service.ts`

**Files:**
- Modify: `backend/src/services/chat/chat.compaction.service.ts:35-38` (interfaz `CompactionResult`), `:87-111` (lógica post-parseo y log final)
- Test: `backend/src/services/chat/chat.compaction.service.test.ts` (agregar describe nuevo)

**Interfaces:**
- Consumes: nada nuevo — el prompt ya devuelve estos campos desde Fase 1 (`SYSTEM_PROMPT_COMPACTOR`), no requiere cambios de prompt.
- Produces: nada consumido por otra tarea — es una hoja del árbol, solo logging.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `backend/src/services/chat/chat.compaction.service.test.ts` (reutiliza los mocks ya definidos en el archivo, incluido `NEW_MESSAGES` con 6 mensajes):

```ts
describe('compactSession — auditoría de confianza y cobertura', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    generateFromAIMock.mockReset();
    chatModelMock.getSummaryCursor.mockReset().mockReturnValue(null);
    chatModelMock.getMessagesSince.mockReset().mockReturnValue(NEW_MESSAGES);
    chatModelMock.setSummaryCursor.mockReset();
    chatModelMock.getLastAssistantModel.mockReset().mockReturnValue('nvidia/thinkingmachines/inkling');
    sessionSummaryMock.getSummary.mockReset().mockReturnValue(null);
    sessionSummaryMock.saveSummary.mockReset();
    knowledgeModelMock.existsByHash.mockReset().mockReturnValue(false);
    knowledgeModelMock.create.mockReset();
    const { logger } = await import('../../utils/logger.js');
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as any);
    infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined as any);
  });

  it('loguea un warning si reviewedMessageCount es menor a los mensajes reales (posible contenido saltado)', async () => {
    generateFromAIMock.mockResolvedValueOnce(aiResponse(JSON.stringify({
      summary: 'resumen parcial', confidence: 'high', reviewedMessageCount: 3, kbCandidates: [],
    })));

    await compactSession('s1', 'u1', true);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/cobertura|reviewedMessageCount|menos mensajes/i),
      expect.objectContaining({ sessionId: 's1', expected: 6, reviewedMessageCount: 3 }),
    );
    // Un mismatch de cobertura NO bloquea el guardado — solo se audita (Fase 3 corrige).
    expect(sessionSummaryMock.saveSummary).toHaveBeenCalledWith('s1', 'resumen parcial');
  });

  it('loguea un warning si confidence no es "high"', async () => {
    generateFromAIMock.mockResolvedValueOnce(aiResponse(JSON.stringify({
      summary: 'resumen dudoso', confidence: 'low', reviewedMessageCount: 6, kbCandidates: [],
    })));

    await compactSession('s1', 'u1', true);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/confianza baja|confidence/i),
      expect.objectContaining({ sessionId: 's1', confidence: 'low' }),
    );
  });

  it('loguea un warning si reviewedMessageCount no vino en la respuesta', async () => {
    generateFromAIMock.mockResolvedValueOnce(aiResponse(JSON.stringify({
      summary: 'resumen sin conteo', confidence: 'high', kbCandidates: [],
    })));

    await compactSession('s1', 'u1', true);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/reviewedMessageCount ausente/i),
      expect.objectContaining({ sessionId: 's1' }),
    );
  });

  it('no loguea ningún warning de auditoría cuando confidence es high y el conteo coincide', async () => {
    generateFromAIMock.mockResolvedValueOnce(aiResponse(JSON.stringify({
      summary: 'resumen completo', confidence: 'high', reviewedMessageCount: 6, kbCandidates: [],
    })));

    await compactSession('s1', 'u1', true);

    expect(warnSpy).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith('Sesión compactada', expect.objectContaining({
      confidence: 'high', reviewedMessageCount: 6,
    }));
  });
});
```

Run: `cd backend && npx vitest run src/services/chat/chat.compaction.service.test.ts`
Expected: FAIL — los 4 tests nuevos fallan porque `chat.compaction.service.ts` no lee `confidence` ni `reviewedMessageCount` todavía, así que ningún `logger.warn` se dispara y `logger.info` no incluye esos campos.

- [ ] **Step 2: Confirmar que fallan por la razón correcta**

Verificar en el output que las 4 aserciones nuevas fallan (no un error de import/mock) — el resto de tests existentes en el archivo (los 6 de Fase 1) deben seguir pasando sin tocarlos.

- [ ] **Step 3: Extender `CompactionResult`**

En `chat.compaction.service.ts:35-38`, reemplazar:

```ts
interface CompactionResult {
  summary: string;
  kbCandidates?: Array<{ content: string; subject: string; summary?: string }>;
}
```

por:

```ts
interface CompactionResult {
  summary: string;
  confidence?: 'high' | 'medium' | 'low';
  reviewedMessageCount?: number;
  kbCandidates?: Array<{ content: string; subject: string; summary?: string }>;
}
```

- [ ] **Step 4: Auditar cobertura y confianza después del parseo**

En `chat.compaction.service.ts`, después de la línea `const parsed = JSON.parse(result.content) as CompactionResult;` (línea 87) y antes de `if (!parsed.summary) return;` (línea 88), agregar:

```ts
if (typeof parsed.reviewedMessageCount !== 'number') {
  logger.warn('reviewedMessageCount ausente en la respuesta del compactador', { sessionId, model });
} else if (parsed.reviewedMessageCount < newMessages.length) {
  logger.warn('Posible cobertura incompleta: el compactador reportó menos mensajes revisados que los enviados', {
    sessionId, model, expected: newMessages.length, reviewedMessageCount: parsed.reviewedMessageCount,
  });
}

if (parsed.confidence && parsed.confidence !== 'high') {
  logger.warn('Compactación con confianza baja/media reportada por el modelo', {
    sessionId, model, confidence: parsed.confidence,
  });
}
```

Nota: esto es puramente informativo — no hace `return` ni cambia el flujo. El resumen se guarda igual (`SessionSummaryService.saveSummary` más abajo sigue corriendo sin cambios).

- [ ] **Step 5: Incluir ambos campos en el log de éxito**

En `chat.compaction.service.ts:109-111`, reemplazar:

```ts
logger.info('Sesión compactada', {
  sessionId, model, messagesCompacted: newMessages.length, kbCandidates: parsed.kbCandidates?.length || 0,
});
```

por:

```ts
logger.info('Sesión compactada', {
  sessionId, model, messagesCompacted: newMessages.length, kbCandidates: parsed.kbCandidates?.length || 0,
  confidence: parsed.confidence, reviewedMessageCount: parsed.reviewedMessageCount,
});
```

- [ ] **Step 6: Correr los tests y confirmar que pasan**

Run: `cd backend && npx vitest run src/services/chat/chat.compaction.service.test.ts`
Expected: PASS — los 4 tests nuevos y los 6 existentes de Fase 1 (10 en total en este archivo).

- [ ] **Step 7: Typecheck y suite completa**

Run: `cd backend && npm run typecheck && npx vitest run`
Expected: typecheck limpio. En la suite completa, el único test que puede seguir en rojo es `src/services/chat.profile-detection.test.ts` ("rejects: habla más despacio por favor") — confirmado en code review anterior que es una falla preexistente, no relacionada a esta feature ni a Fase 1. Si aparece cualquier otro test en rojo, investigar antes de dar por terminada la tarea.

---

## Fuera de alcance (a propósito)

- No se agrega ninguna lógica de retry ni bloqueo por mismatch de cobertura o confianza baja — eso requiere la segunda opinión de otro modelo (spec 4.3, Fase 3) para poder corregir de verdad en vez de solo detectar. Intentar "arreglarlo" acá con un reintento naive sobre el mismo prompt es probable que devuelva el mismo resultado (misma temperatura, mismo contexto) y no vale la pena el riesgo de introducir un loop.
- No se expone esta auditoría al usuario todavía (eso es la sección "sidebar editable", Fase 4) — por ahora es solo logging interno para operabilidad/debugging.
