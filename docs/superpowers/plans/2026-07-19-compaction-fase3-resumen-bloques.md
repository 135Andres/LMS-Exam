# Compactación Fase 3 — Bloques visibles en `/resumen`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Contexto:** de la Fase 3 original del spec (`docs/superpowers/specs/2026-07-17-context-compaction-redesign-design.md`, sección 8), los puntos 7 y 8 (cobertura mecánica + segunda opinión obligatoria) ya se implementaron dentro de la Fase 2. Solo queda el **punto 9**: `summarizeSessionHandler` (endpoint `/api/chat/tutor/summary`, comando `/resumen` en el chat) hoy devuelve únicamente `{ summary }` — la narrativa — sin mencionar los bloques de contenido verificable que la Fase 2 ya extrae y persiste. Este plan cierra ese punto.

**Goal:** que el comando `/resumen` le muestre al estudiante, además del resumen narrativo de siempre, la lista de bloques de conocimiento verificable detectados en esa sesión (título + materia), para que sepa que ese contenido quedó guardado íntegro y no se perdió en la compactación — sin construir todavía la UI completa editable del sidebar (eso es Fase 4, aparte).

**Tech Stack:** TypeScript/Express (backend), JS vanilla (frontend, `public/js/chat.js`), vitest.

## Global Constraints

- No tocar `compactSession` ni el pipeline de 4 pasos — esta fase es puramente de exposición de datos que ya existen (`SessionSummaryService.getBlocks`), no de generación.
- No adelantar trabajo de Fase 4 (edición manual, `GET/PUT /api/chat/summary`, sección desplegable en `contextPanel`) — este plan solo toca el comando `/resumen` existente, que ya es un endpoint y un flujo de UI distintos.
- Mantener retrocompatibilidad de la respuesta: `summary` sigue siendo un string en la raíz de la respuesta (no reestructurar lo que ya consume el frontend), los bloques se agregan como campo nuevo.

---

### Task 1: Backend — `summarizeSessionHandler` devuelve también los bloques

**Files:**
- Modify: `backend/src/controllers/chat.controller.ts` (`summarizeSessionHandler`)
- Test: `backend/src/controllers/chat.controller.test.ts` (si no existe test de este handler, crear `backend/src/controllers/chat.controller.summarize.test.ts`)

**Interfaces:**
- Consumes: `SessionSummaryService.getBlocks(sessionId)` — ya existe de la Fase 2, sin cambios.
- Produces: respuesta JSON extendida, consumida por Task 2 (frontend).

```ts
export async function summarizeSessionHandler(req: Request, res: Response): Promise<void> {
  const { sessionId } = req.validatedBody as { sessionId: string };
  const userId = req.user!.id;

  try {
    ChatModel.assertSessionOwnership(sessionId, userId);
  } catch {
    res.status(403).json({ error: 'No tienes acceso a esta sesión' });
    return;
  }

  await compactSession(sessionId, userId, true);
  const summary = SessionSummaryService.getNarrative(sessionId);
  const blocks = SessionSummaryService.getBlocks(sessionId).map(b => ({
    id: b.id,
    title: b.title,
    subject: b.subject,
  })); // solo metadata liviana — el contenido completo del bloque no se manda acá,
       // eso es para cuando exista la vista de detalle (Fase 4)

  res.json({ summary, blocks });
}
```

- [ ] **Step 1: Tests que fallan**
  - `summarizeSessionHandler` devuelve `blocks` como array de `{ id, title, subject }`, no el `content` completo de cada bloque.
  - Si la sesión no tiene bloques (solo narrativa), `blocks` es `[]`, no `undefined` ni ausente del JSON.
  - `summary` sigue comportándose igual que antes (retrocompatibilidad — el test existente de este handler, si existe, no debe romperse).
- [ ] **Step 2: Correr para confirmar que fallan**
- [ ] **Step 3: Implementar**
- [ ] **Step 4: Correr para confirmar que pasan**
- [ ] **Step 5: Commit**

---

### Task 2: Frontend — `runSummaryCommand` muestra los bloques

**Files:**
- Modify: `public/js/chat.js` (`runSummaryCommand`)
- Modify: `public/js/lib/i18n.js` (agregar `blocksDetected` en `es` y `en`, junto a `sessionCompacted`/`notEnoughToSummarize`)

**Diseño:** después del mensaje de la narrativa (como ya hace hoy), si `data.blocks.length > 0`, agregar un segundo mensaje corto tipo lista con los títulos — sin rediseñar la UI del chat, reusando `addMessage` tal como ya se usa:

```js
async function runSummaryCommand() {
  showTyping();
  try {
    const res = await fetch('/api/chat/tutor/summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ sessionId }),
    });
    hideTyping();
    if (res.status === 401) { window.location.href = 'login.html'; return; }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      addMessage(t('summaryFailed') + ' ' + (err.error || t('unknownError')), 'ai');
      return;
    }
    const data = await res.json();
    addSessionDivider(t('sessionCompacted'));
    addMessage(data.summary || t('notEnoughToSummarize'), 'ai');

    if (Array.isArray(data.blocks) && data.blocks.length > 0) {
      const list = data.blocks.map(b => `- **${b.title}** (${b.subject})`).join('\n');
      addMessage(`${t('blocksDetected')}\n\n${list}`, 'ai');
    }
  } catch (err) {
    hideTyping();
    addMessage(t('errorPrefix') + ' ' + (err.message || t('connectionError')), 'ai');
  }
}
```

`blocksDetected` como texto tipo: *"Además, se guardaron íntegros estos contenidos para que no se pierdan al resumir:"*. `public/js/lib/i18n.js` tiene dos bloques de idioma confirmados: `es` (línea ~10) y `en` (línea ~174), con `notEnoughToSummarize`/`sessionCompacted` ya presentes en ambos (es: líneas 66/85; en: líneas 226/245) — agregar `blocksDetected` junto a esas claves en ambos bloques.

- [ ] **Step 1:** Confirmar la ubicación real de las claves en `public/js/lib/i18n.js` (ya verificado por el controller: `es` línea 10, `en` línea 174, claves hermanas en 66/85 y 226/245 respectivamente) antes de editar.
- [ ] **Step 2:** Agregar la clave `blocksDetected` en `es` y `en`.
- [ ] **Step 3:** Implementar el cambio en `runSummaryCommand`.
- [ ] **Step 4:** Prueba manual: correr el backend local, forzar `/resumen` en una sesión con contenido verificable (código o LaTeX) y confirmar que aparecen los dos mensajes (narrativa + lista de bloques).
- [ ] **Step 5: Commit**

---

### Task 3: Regresión

- [ ] **Step 1:** `cd backend && npm test` — sin romper nada existente (mismo estado que antes: todo verde salvo el test pre-existente y no relacionado de `chat.profile-detection.test.ts`).
- [ ] **Step 2:** Confirmar que `chat.compaction.integration.test.ts` sigue pasando sin tocar (esta fase no modifica el pipeline, solo lectura posterior).
- [ ] **Step 3:** Commit final + push a rama nueva (ej. `compaction-fase3-resumen-bloques`) para revisar el diff antes de mergear a `main`, mismo patrón que las fases anteriores.

---

## Nota para cuando se planee Fase 4

Cuando llegue el momento, Fase 4 (UI editable en `contextPanel`) puede reusar directo el mismo shape de `blocks` que este plan expone (`id, title, subject`), solo agregando un endpoint de detalle (`GET /api/chat/summary/blocks/:id` o similar) para el contenido completo bajo demanda, en vez de mandar todo el contenido de golpe en `/resumen`. No es necesario replantear el contrato de datos cuando llegue esa fase.
