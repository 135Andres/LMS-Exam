# ARQUITECTURA #7: Migración a 9router como Gateway Unificado de IA

---

## AUDITORÍA (2026-07-12)

**VEREDICTO: ⚠️ PARCIAL**

| Ítem del plan | Estado | Ubicación / Evidencia |
|---|---|---|
| FASE 1: `nineRouter.ts` cliente unificado (`callNineRouter`, `callNineRouterStream`, `parseNineRouterStream`, `fetchAvailableModels`) | ✅ COMPLETO | `backend/src/services/ai/nineRouter.ts:70,96,144,44` |
| FASE 1: `generateEmbedding` en nineRouter | ❌ NO IMPLEMENTADO en nineRouter | está en `services/ai/embeddings.ts` (NVIDIA directa) |
| FASE 2: `ai/index.ts` simplificado a proveedor único `nineRouter` | ✅ COMPLETO | `backend/src/services/ai/index.ts:1,34` — usa `callNineRouter` |
| FASE 3: `resolveModel()` async con `fetchAvailableModels()` (cache 5 min) | ✅ COMPLETO | `backend/src/services/chat/chat.model-router.ts` + `/models` endpoint |
| FASE 4: `/models` endpoint dinámico | ✅ COMPLETO | cache 5 min, fallback estático |
| FASE 5: Tests unitarios `callNineRouter`, `generateEmbedding`, `fetchAvailableModels` | ❌ NO IMPLEMENTADO | sin tests para nineRouter.ts |
| Eliminar `nvidia.ts` | ❌ NO IMPLEMENTADO | `backend/src/services/ai/nvidia.ts` existe (5252 bytes) pero NO importado → código muerto |
| Eliminar `embeddings.ts` | ❌ NO IMPLEMENTADO (plan erróneo) | `backend/src/services/ai/embeddings.ts` sigue activo, importado por `knowledge.routes.ts:13` y `chat.embedding.service.ts:2` y `embedding-worker.ts` y `knowledge-detection.service.ts` — el plan original decía "ELIMINAR embeddings.ts" pero el código 9router.ts no incluye `generateEmbedding`; embeddings van directo a NVIDIA API. **El plan estaba mal**, no el código. Ver `BUGS_ACTUALES.md` para aclaración. |
| Eliminar `zenmux` config | ✅ COMPLETO | `backend/src/config/index.ts` — `zenmux` ausente |
| `modelRegistry` hardcodeado → dinámico | ✅ COMPLETO | `backend/src/config/index.ts` — `modelRegistry` objeto vacío `{}` |
| Frontend `model.service.js` con cache | ❌ NO IMPLEMENTADO | `public/js/features/models/model.service.js` no existe |
| Plan almacenado `planes/PLAN_MIGRACION_9ROUTER.md` (748 líneas) | ❌ NO IMPLEMENTADO | `planes/` no existe en el repo |

**Resumen:**
- ✅ 6 ítems completos
- ❌ 5 ítems no implementados (niveRouter.generateEmbedding, tests, nvidia.ts cleanup, frontend model.service, plan doc)
- ⚠️ `embeddings.ts` "no eliminado" — plan erróneo, no bug
- ⚠️ PARCIAL — migración backend funcional, deuda técnica: `nvidia.ts` muerto, sin tests

---

## ESTADO (histórico)
Plan definido en `planes/PLAN_MIGRACION_9ROUTER.md` (748 líneas), sin implementar. Los 10 errores críticos de `01_critical_errors` ya están resueltos.

## OBJETIVO ESPECÍFICO
Reemplazar el sistema actual de múltiples API keys por modelo (NVIDIA, ZenMux) con **9router** como gateway único que enruta todas las peticiones a los modelos correspondientes.

## PROBLEMA ACTUAL

### Arquitectura multi-key
- 7 modelos configurados en `config/index.ts:82-133` con 24+ env vars individuales
- 3 proveedores (NVIDIA, ZenMux, embeddings NVIDIA) con API keys separadas
- `modelRegistry` hardcodeado — añadir modelo requiere code change + deploy
- `/models` endpoint lee de `modelRegistry` estático

### Archivos a modificar
| Archivo | Cambio |
|---------|--------|
| `backend/src/config/index.ts` | Eliminar `modelRegistry`, `nvidia`, `zenmux` configs; añadir `nineRouter` |
| `backend/src/config/nineRouter.ts` | Ya existe como placeholder, expandir |
| `backend/src/services/ai/nvidia.ts` | **REEMPLAZAR** por `nineRouter.ts` |
| `backend/src/services/ai/embeddings.ts` | **ELIMINAR** — embeddings van en `nineRouter.ts` |
| `backend/src/services/ai/index.ts` | Proveedor único `nineRouter` |
| `backend/src/services/chat.service.ts` | `resolveModel()` usa `fetchAvailableModels()` |
| `backend/src/routes/chat.routes.ts` | `/models` endpoint dinámico vía 9router |
| `backend/.env` | Variables nuevas `NINE_ROUTER_*`; deprecar las legacy |
| `public/js/welcome.js` | `fetchModels()` debe integrar `model.service.js` |

## SOLUCIÓN

### FASE 1: Config + Cliente 9router (4-6 hrs)
- Expandir `nineRouter.ts` con todas las env vars documentadas
- Crear `nineRouter.ts` (cliente unificado): `callNineRouter`, `callNineRouterStream`, `parseNineRouterStream`, `generateEmbedding`, `fetchAvailableModels`
- Incluir `buildHeaders` con `X-9Router-Tags`, timeout handling, fallback models

### FASE 2: Refactor AI Index (2-3 hrs)
- Simplificar `ai/index.ts` a un solo proveedor `nineRouter`
- `generateFromAI` ignora `providerName` (kept for compat)
- Re-exportar `generateEmbedding`, `fetchAvailableModels`, `callNineRouterStream`, `parseNineRouterStream`

### FASE 3: Chat Service + Model Resolution (3-4 hrs)
- `resolveModel()` se vuelve `async` y usa `fetchAvailableModels()` con cache (TTL 5 min)
- Llamadas a `generateFromAI` usan `model: resolved.model` (pasa model_id a 9router)
- `apiKey`/`baseUrl` ya no se pasan individualmente

### FASE 4: Endpoints + Frontend (3-4 hrs)
- `/models` endpoint lee de `fetchAvailableModels()` con fallback estático
- Frontend: crear `model.service.js` con cache + fallback

### FASE 5: Tests + Validación (4-6 hrs)
- Tests unitarios para `callNineRouter`, `generateEmbedding`, `fetchAvailableModels`
- Checklist de validación pre-deploy (10 ítems)

## GAPS IDENTIFICADOS (vs plan original)

| # | Gap | Impacto |
|---|-----|---------|
| 1 | API spec no confirmada (headers, SSE format, /models response) | Todo el código puede estar mal |
| 2 | Sin API key de 9router | No se puede probar |
| 3 | Sin mock server para tests | Dev bloqueado sin API key |
| 4 | Embedding dimensions: verificar que 9router preserve nv-embed-v1 4096d | RAG puede romperse silenciosamente |
| 5 | Sin análisis de costos comparativo | Aumento silencioso de costos |
| 6 | Formato SSE streaming no verificado | Streaming puede no funcionar |
| 7 | Sin procedimiento de rollback testeado | Rollback puede fallar en incidente |
| 8 | Frontend: audit completo de codeo hardcodeado de modelos | UI puede mostrar labels/IDs incorrectos |
| 9 | Sin monitoreo/observabilidad post-migración | No se detectan outages de 9router |
| 10 | Dependencias con otros fixes: toca los mismos archivos que CRIT #1-#7 | Merge conflicts garantizados si no se ordena |
| 11 | Sin timeline de deprecación para código legacy | Dead code se acumula |
| 12 | Sin análisis de failure mode (si 9router cae, todo cae) | Aumento del blast radius |
| 13 | Privacidad: userId en headers X-9Router-Tags | Posible GDPR/data-protection issue |

## DEPENDENCIAS
- **API key de 9router** (BLOCKING — obtener antes de empezar)
- **Confirmar API contract** (BLOCKING — verificar docs oficiales)
- **Resolver CRIT #1-#7** (ya completados — no hay conflictos de merge)

## PRIORIDAD
**MEDIA** — No es un bug en runtime. La arquitectura actual funciona. Beneficio principal es simplificación operativa.

## AGENTE RECOMENDADO
`general` — Implementación multi-fase que abarca backend + frontend + config.

## ARCHIVOS
- `backend/src/config/nineRouter.ts` — MODIFICAR (expandir)
- `backend/src/services/ai/nineRouter.ts` — NUEVO
- `backend/src/services/ai/embeddings.ts` — ELIMINAR
- `backend/src/services/ai/nvidia.ts` — ELIMINAR
- `backend/src/services/ai/index.ts` — MODIFICAR
- `backend/src/services/chat.service.ts` — MODIFICAR
- `backend/src/routes/chat.routes.ts` — MODIFICAR
- `public/js/features/models/model.service.js` — NUEVO
- `public/js/welcome.js` — MODIFICAR
- `backend/.env` — MODIFICAR
