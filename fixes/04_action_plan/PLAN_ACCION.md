# Plan de Acción Consolidado

## Estado de Implementación

### `01_critical_errors` — 9 de 10 completados

| # | Plan | Estado | Archivo |
|---|------|--------|---------|
| 1 | Variable mismatch buildRagContext | ✅ Completado | chat.service.ts:63 |
| 2 | Embedding race condition (outbox) | ✅ Completado | embedding-outbox.model.ts + worker + server.ts |
| 3 | Embedding assistant responses | ✅ Completado | chat.service.ts:227-229, 301-303 |
| 4 | Regex false positives (whitelist) | ✅ Completado | chat.service.ts:18-30 |
| 5 | RAG similarity threshold | ✅ Completado | vector.ts:1,17-22 |
| 6 | sqlite-vec BLOB migration | ⏳ Pendiente | `01_critical_errors/06_*.md` |
| 7 | sessionId validation + ownership | ✅ Completado | validators/chat.ts:3-20, chat.controller.ts |
| 8 | Python CORS hardcoded | ✅ Completado | main.py:36-41, 186-193 |
| 9 | Python rate limiter (TRUST_PROXY) | ✅ Completado | main.py:42, 79-87, db.py:128 |
| 10 | Python memory stores -> SQLite | ✅ Completado | db.py (completo) |

### `02_architecture_issues` — 0 de 6 completados

| # | Plan | Estado | Notas |
|---|------|--------|-------|
| 1 | Chat service god class | ⏳ Pendiente | chat.service.ts sigue 311 líneas |
| 2 | Sin tests (vitest) | ⏳ Pendiente | No hay vitest instalado |
| 3 | Frontend monolithic | ⏳ Pendiente | welcome.js 2059 líneas |
| 4 | Model registry hardcoded | ⏳ Pendiente | Supersedeado por #7 (9router) |
| 5 | Cron jobs main process | ⏳ Pendiente | Crons siguen en server.ts:118-149 |
| 7 | Migracion 9router | ⏳ Pendiente | Ver `02_architecture_issues/07_*.md` |

### `03_knowledge_base` — 0 de 4 completados (todos fase de diseño)

| # | Plan | Estado |
|---|------|--------|
| 1 | Database schema | ⏳ Solo diseño, no implementado |
| 2 | Contribution flow | ⏳ Solo diseño, no implementado |
| 3 | Hybrid RAG | ⏳ Solo diseño, no implementado |
| 4 | Gamification & moderation | ⏳ Solo diseño, no implementado |

---

## Orden de Ejecución Recomendado

### Fase 1: Fixes de bugs post-implementación (inmediato)
Ver `04_action_plan/BUGS_POST_IMPLEMENTACION.md` — 5 bugs de severidad media en código ya implementado:
- BUG-2: markFailed stuck en 'failed' permanentemente
- BUG-5: buildContent ignora attachments tipo 'file'
- BUG-6: detectProfileEdit bloquea inicio de streaming
- BUG-7: Worker no usa transacción atómica save+markDone
- BUG-12: store_otp no invalida OTPs previos

### Fase 2: Resto de `01_critical_errors`
- Pendiente #6: sqlite-vec BLOB migration (esfuerzo alto, sin urgencia funcional)

### Fase 3: `02_architecture_issues` (mejoras estructurales)
- startPosiciónalta: #2 (tests) — sin tests, futuras refactorizaciones son peligrosas
- #7 (9router) depende de obtener API key y confirmar API contract
- #1 (god class) debería ir después de #2 (para tener cobertura antes de refactor)
- #3 (frontend) es el más grande y aislado
- #5 (cron) es mejora operacional, no urgent

### Fase 4: `03_knowledge_base` (feature nueva)
- Requiere #1 (KB schema) primero
- #2 (contribution flow) depende de tener RAG funcionando end-to-end
- #3 (hybrid RAG) es feature-value alto
- #4 (gamification) es feature-value bajo inicial
