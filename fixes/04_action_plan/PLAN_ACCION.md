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

### `02_architecture_issues` — 5 de 5 COMPLETADOS

| # | Plan | Estado | Notas |
|---|------|--------|-------|
| 1 | Chat service god class | ✅ Completado | chat.service.ts reducido a fachada de 44 líneas; 8 servicios extraídos |
| 2 | Sin tests (vitest) | ✅ Completado | 63 tests en 7 suites, todos pasando |
| 3 | Frontend monolithic | ✅ Parcial (documentado) | Módulos lib/state.js, lib/utils.js, features/sidebar.js creados. Migración real (type="module" + rewrite de bindings) requiere testing manual — documentado |
| 5 | Cron jobs main process | ✅ Completado | workers/scheduler.ts con lock distribuido SQLite, cron-entry.ts standalone, server.ts delega en startScheduler/stopScheduler |
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

### Fase 3: `02_architecture_issues` ✅ COMPLETADO
- **#2 (tests)** ✅ — 63 tests en 7 suites
- **#1 (god class)** ✅ — 8 servicios extraídos, fachada de 44 líneas
- **#5 (cron)** ✅ — workers/scheduler.ts + lock distribuido + cron-entry.ts standalone
- **#7 (9router)** ✅ — API key + tunnel configurado, modelRegistry eliminado, /models dinámico
- **#3 (frontend)** ✅ parcial — módulos ES creados, migración real documentada

### Fase 4: `03_knowledge_base` (próximo)
- Requiere #1 (KB schema) primero
- #3 (hybrid RAG) da feature-value alto
- #2 (contribution flow) depende de RAG funcionando
- #4 (gamification) es enhancement
