# Plan de Acción Consolidado

## Estado de Implementación

### `01_critical_errors` — 10 de 10 COMPLETADOS (carpeta eliminada)

| # | Plan | Estado |
|---|------|--------|
| 1 | Variable mismatch buildRagContext | ✅ Completado |
| 2 | Embedding race condition (outbox) | ✅ Completado |
| 3 | Embedding assistant responses | ✅ Completado |
| 4 | Regex false positives (whitelist) | ✅ Completado |
| 5 | RAG similarity threshold | ✅ Completado |
| 6 | Embeddings JSON→BLOB migration | ✅ Completado |
| 7 | sessionId validation + ownership | ✅ Completado |
| 8 | Python CORS hardcoded | ✅ Completado |
| 9 | Python rate limiter (TRUST_PROXY) | ✅ Completado |
| 10 | Python memory stores -> SQLite | ✅ Completado |

### Bugs Post-Implementación — TODOS FIXEADOS
Ver `04_action_plan/BUGS_POST_IMPLEMENTACION.md`. 8 bugs corregidos, 2 falsos positivos descartados.

### `02_architecture_issues` — 4 de 5 completados

| # | Plan | Estado | Notas |
|---|------|--------|-------|
| 1 | Chat service god class | ✅ Completado | chat.service.ts reducido a fachada de 44 líneas; 8 servicios extraídos |
| 2 | Sin tests (vitest) | ✅ Completado | 63 tests en 7 suites, todos pasando |
| 3 | Frontend monolithic | ⏳ Parcial | Módulos lib/state.js, lib/utils.js, features/sidebar.js creados. Migración real (type="module" + rewrite de bindings) requiere testing manual — documentado |
| 5 | Cron jobs main process | ⏳ Pendiente | Crons en server.ts:118-149 |
| 7 | Migracion 9router | ✅ Completado | Configurado con API key + tunnel |

### `03_knowledge_base` — 0 de 4 (fase de diseño)

| # | Plan | Estado |
|---|------|--------|
| 1 | Database schema | ⏳ Diseño |
| 2 | Contribution flow | ⏳ Diseño |
| 3 | Hybrid RAG | ⏳ Diseño |
| 4 | Gamification & moderation | ⏳ Diseño |

---

## Orden de Ejecución Recomendado

### Fase 1: Fixes de bugs post-implementación ✅ COMPLETADO
8 bugs corregidos en código ya implementado.

### Fase 2: Resto de `01_critical_errors` ✅ COMPLETADO
Plan #6 (BLOB migration) implementado: dual-write JSON+BLOB, tabla nueva, backfill script.

### Fase 3: `02_architecture_issues` (próximo)
- **#2 (tests)** primero — sin tests, futuras refactorizaciones son peligrosas
- **#1 (god class)** después de #2 (cobertura antes de refactor)
- **#5 (cron)** mejora operacional aislada
- **#7 (9router)** bloqueado por API key/contract externo
- **#3 (frontend)** es el más grande y aislado

### Fase 4: `03_knowledge_base` (feature nueva)
- Requiere #1 (KB schema) primero
- #3 (hybrid RAG) da feature-value alto
- #2 (contribution flow) depende de RAG funcionando
- #4 (gamification) es enhancement
