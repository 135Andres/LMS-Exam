# Plan de Acción Consolidado

---

## AUDITORÍA (2026-07-12)

Este plan fue consolidado tras la implementación. El estado reportado en la versión original era **optimista** — varios ítems marcados como COMPLETADO eran en realidad PARCIAL o tenían código muerto. Esta sección corrige el estado real basado en verificación contra código.

### Correcciones al estado original

| Ítem | Estado original | Estado real (2026-07-12) | Evidencia |
|---|---|---|---|
| 02_tests | COMPLETADO (63 tests) | ⚠️ PARCIAL | 64 tests pasan, pero coverage 29% (meta 80%), sin thresholds en vitest.config, sin CI/CD, sin tests de integración. Ver `02_architecture_issues/02_no_tests.md` |
| 03_frontend | PARCIAL documentado | ⚠️ PARCIAL | sin cambios — módulos ES creados pero NO integrados en welcome.html |
| 05_cron | COMPLETADO | ✅ COMPLETADO | confirmado — scheduler.ts + lock.ts + cron-entry.ts + server.ts integran |
| 07_9router | COMPLETADO | ⚠️ PARCIAL | backend funcional, pero `nvidia.ts` es código muerto sin eliminar, sin tests de nineRouter, sin `model.service.js` frontend. Ver `02_architecture_issues/07_nine_router_migration.md` |
| KB#1 schema | COMPLETADO | ⚠️ PARCIAL | 6 tablas creadas + triggers + índices, pero sin virtual table vec_knowledge_embeddings, sin vistas v_knowledge_*, sin backfill script. Ver `03_knowledge_base/01_database_schema.md` |
| KB#2 contribution | COMPLETADO | ⚠️ PARCIAL | servicio de detección existe pero **código muerto** — nadie lo llama desde chat. Frontend toast/modal no implementado. Ver `03_knowledge_base/02_contribution_flow.md` |
| KB#3 hybrid RAG | COMPLETADO | ⚠️ PARCIAL | HybridRAGService implementado internamente pero **código muerto** — cero imports externos. Chat sigue usando RAG personal solo. Ver `03_knowledge_base/03_hybrid_rag.md` |
| KB#4 gamification | COMPLETADO | ⚠️ PARCIAL | backend base (puntos +10/+2/+50, badge seed, leaderboard), pero solo 1/10 badges, sin config/badges.ts, sin endpoints feature/edit, notificaciones solo 4/8 tipos, frontend ausente. Ver `03_knowledge_base/04_gamification_moderation.md` |
| Bugs post-impl (12) | 8 fixeados | 10 fixeados | BUG-1,2,4,5,6,7,11,12 corregidos + BUG-3,9 falsos positivos. BUG-8 y BUG-10 no corregidos (severidad baja). Ver `04_action_plan/BUGS_POST_IMPLEMENTACION.md` |

**Resumen corregido:**
- ✅ COMPLETO: 01_chat_service_god_class, 05_cron_jobs, 05_deprecate_dual_write_plan, BUGS_POST_IMPLEMENTACION (10/12 + 2 FP)
- ⚠️ PARCIAL: 02_no_tests, 03_frontend, 07_9router, KB#1, KB#2, KB#3, KB#4 (8 items)
- ❌ NO IMPLEMENTADO: ninguno como categoría entera (sub-items específicos son NO IMPLEMENTADO dentro de los PARCIAL)
- Ver `BUGS_ACTUALES.md` para bugs abiertos confirmados tras esta auditoría

### Bugs reportados en esta auditoría
Ver `fixes/BUGS_ACTUALES.md` (nuevo archivo creado en esta auditoría) para los bugs reales encontrados:
- HybridRAGService código muerto
- KnowledgeDetectionService código muerto
- Frontend KB no integrado
- nvidia.ts código muerto
- Coverage real 29% vs meta 80%
- Sin CI/CD
- Aclaración sobre embeddings.ts (plan erróneo, no bug)

---

## Estado de Implementación (histórico — ver correcciones arriba)

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

### `03_knowledge_base` — 4 de 4 COMPLETADOS

| # | Plan | Estado | Notas |
|---|------|--------|-------|
| 1 | Database schema | ✅ Completado | 6 tablas: knowledge_base, knowledge_embeddings, knowledge_votes, knowledge_contributions, user_kb_stats, knowledge_notifications. Triggers de votos y stats automáticos |
| 2 | Contribution flow | ✅ Completado | KnowledgeDetectionService con heurísticas regex, drafts automática, contribute/discard API |
| 3 | Hybrid RAG | ✅ Completado | HybridRAGService merge ponderado (personal 0.7 + colectivo 0.3), findTopK reutilizado, subject detection |
| 4 | Gamification & moderation | ✅ Completado | Puntos+10 creada/+50 verify/+2 upvote, badges, leaderboard, admin moderation (verify/reject/delete) |

### Adicionales Fase 3

| Goal | Estado | Notas |
|------|--------|-------|
| 3.7 Migración 9router | ✅ Completado (en Fase 2) | API key + tunnel, modelRegistry eliminado, /models dinámico |
| 3.8 Deprecar dual-write | ✅ Documentado | Plan en fixes/03_knowledge_base/05_deprecate_dual_write_plan.md — Fase 1 activa, Fases 2-3 post-deploy |
| 3.9 Fix sqlite-vec Windows | ✅ Completado | connection.ts: getVecCandidates() prueba .dll/.dylib/.so según plataforma |

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

### Fase 4: `03_knowledge_base` ✅ COMPLETADO
- **#1 (KB schema)** ✅ — 6 tablas, triggers, índices
- **#2 (contribution flow)** ✅ — KnowledgeDetectionService + drafts + contribute/discard API
- **#3 (hybrid RAG)** ✅ — HybridRAGService merge ponderado personal+colectivo
- **#4 (gamification)** ✅ — puntos, badges, leaderboard, admin moderation
- **3.7 (9router)** ✅ — completado en Fase 2
- **3.8 (deprecate dual-write)** ✅ — plan documentado
- **3.9 (sqlite-vec Windows)** ✅ — multi-plataforma

## Resumen Final

- **Fase 1**: 8 bugs post-implementación corregidos ✅
- **Fase 2**: 10/10 critical errors + 5/5 architecture issues ✅
- **Fase 3**: 4/4 Knowledge Base + 3 adicionales ✅
- **Tests**: 63 tests en 7 suites, todos pasando
- **TypeScript**: tsc --noEmit limpio
- **Commits**: 16 commits en rama Mega-fix
