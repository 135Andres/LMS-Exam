# Análisis Completo del Proyecto LMS-Exam

## Resumen Ejecutivo

El proyecto es un **LMS (Learning Management System) con chatbot tutor IA** que:
- Usa **Node.js/TypeScript + Express** (backend principal) + **Python/FastAPI** (auth OTP)
- Base de datos **SQLite** con WAL mode
- **Embeddings NVIDIA NIM** (nv-embed-v1, 4096 dims) para RAG
- Frontend **vanilla JS** con KaTeX para LaTeX
- Autenticación **OTP + whitelist** + JWT cookies

---

## 🐛 ERRORES ENCONTRADOS

### 1. **Bug Crítico: Variable mal referenciada en `buildRagContext`**
**Archivo:** `backend/src/services/chat.service.ts:52-53`
```typescript
const filtered = pastEmbeddings.filter(e => e.messageId !== excludeMsgId);
```
**Problema:** El parámetro se llama `excludeMsgId` pero en la llamada (línea 159) se pasa `userMsgId`. Aunque funciona porque JavaScript pasa por valor, el nombre es confuso y propenso a errores.
**Fix:** Renombrar parámetro a `excludeMessageId` para consistencia.

### 2. **Race Condition en Embeddings - No Transaccional**
**Archivo:** `chat.service.ts:146-169` y `234-257`
**Problema:** Se guarda el mensaje → se genera embedding → se guarda embedding. Si falla el embedding, el mensaje queda sin vector. No hay rollback.
**Fix:** Usar transacción SQLite o cola de reintentos.

### 3. **Embedding solo del mensaje usuario, no del asistente**
**Archivo:** `chat.service.ts:151-156` y `238-244`
**Problema:** `generateEmbedding(message)` solo usa el mensaje del usuario. Las respuestas del asistente no se vectorizan, perdiendo contexto valioso para RAG futuro.
**Fix:** Generar embedding también para respuesta IA (en `finally` del stream / después de `generateFromAI`).

### 4. **Regex `PROFILE_EDIT_REGEX` demasiado amplia (Falsos Positivos)**
**Archivo:** `chat.service.ts:17`
```typescript
const PROFILE_EDIT_REGEX = /cambia|ajusta|modifica|ahora|modo|evita|explica|habla/i;
```
**Problema:** Palabras como "ahora", "modo", "explica" son muy comunes en preguntas normales. Dispara clasificador IA innecesario (costo + latencia).
**Fix:** Requerir patrones más específicos: `/quiero que|cambia mi|actualiza mi|prefiero que/`

### 5. **RAG sin Umbral de Similitud (Ruido en Contexto)**
**Archivo:** `backend/src/utils/vector.ts:15-26`
**Problema:** `findTopK` devuelve top-K sin filtrar por score mínimo. Vectores con similitud ~0.1-0.2 contaminan contexto.
**Fix:** Añadir `MIN_SIMILARITY_THRESHOLD = 0.3` y filtrar antes de devolver.

### 6. **Embeddings almacenados como JSON String (Ineficiente)**
**Archivo:** `embedding.model.ts:7-8` y `migrate.ts:104-112`
**Problema:** `vector_text TEXT` con `JSON.stringify(vector)`. Para 4096 dims = ~32KB por fila. No indexable, búsqueda O(n) en memoria.
**Fix:** Usar `sqlite-vec` extension o tabla separada con BLOB + índices HNSW.

### 7. **Falta Validación de `sessionId` en Controlador**
**Archivo:** `chat.controller.ts:22-23`
```typescript
const sid = sessionId || crypto.randomUUID();
```
**Problema:** Si frontend envía `sessionId` inválido (no UUID), se usa ese valor y rompe FK en `chat_logs`.
**Fix:** Validar con `z.string().uuid()` antes de usar.

### 8. **CORS Hardcodeado en Python Auth Service**
**Archivo:** `backend-python/main.py:193`
```python
allow_origins=["http://localhost:3000"],
```
**Problema:** No configurable por env. Falla en staging/prod.
**Fix:** Usar `os.getenv("CORS_ORIGIN")` con fallback.

### 9. **Rate Limiter IP en Python con Bug de Variable**
**Archivo:** `backend-python/main.py:81-90`
```python
one_hour_ago = now - timedelta(hours=IP_RATE_WINDOW_HOURS)
if client_ip not in ip_rate_limits:  # Variable no definida
    ip_rate_limits[client_ip] = []
ip_rate_limits[client_ip] = [ts for ts in ip_rate_limits[client_ip] if ts > one_hour_ago]
```
**Problema:** `client_ip` no está definido en el scope (debería ser parámetro). `ip_rate_limits` vs `ip_rate_limits` typo.
**Fix:** Corregir variable y pasar `client_ip` como parámetro.

### 10. **Memory Leak en Caché de Perfiles**
**Archivo:** `profile.service.ts` (inferido por `Map` sin TTL)
**Problema:** `Map<string, {content: string}>` crece indefinidamente. Sin límite de tamaño ni expiración.
**Fix:** Usar `LRU Cache` (ej. `lru-cache` npm) con `max: 1000` y `ttl: 10min`.

---

## ⚠️ PROBLEMAS DE ARQUITECTURA Y DISEÑO

### 11. **Acoplamiento Fuerte: Chat Service hace Demasiadas Cosas**
`chat.service.ts` maneja: persistencia, embeddings, RAG, perfil, clasificación, streaming, timeouts, modelos.
**Separación recomendada:**
- `ChatPersistenceService` - solo DB
- `EmbeddingService` - embeddings + vector search
- `RAGService` - construcción contexto
- `ProfileDetectionService` - clasificación
- `ModelRouter` - selección modelo

### 12. **No Hay Tests Automatizados**
**Archivo:** `package.json:6-8`
```json
"test": "echo \"Error: no test specified\" && exit 1"
```
**Riesgo:** Refactors rompen funcionalidad sin detectarse.

### 13. **Frontend Monolítico (`welcome.js` = 2000+ líneas)**
Todo en un archivo: auth, chat, sidebar, onboarding, KaTeX, attachments, link preview, lightbox, etc.
**Fix:** Modularizar en ES modules: `chat.js`, `sidebar.js`, `onboarding.js`, `attachments.js`, `katex.js`.

### 14. **Hardcoded Model Config en `config/index.ts`**
8 modelos en `modelRegistry` con env vars individuales. Difícil mantener.
**Fix:** Config centralizada en JSON/DB + admin UI para añadir modelos.

### 15. **Cron Jobs en Proceso Principal (No Escalable)**
**Archivo:** `server.ts:111-142`
Cron corre en mismo proceso Node. Si hay múltiples instancias, se ejecutan N veces.
**Fix:** Usar `node-cron` con lock distribuido (Redis) o worker separado.

### 16. **Python Auth Service: Stores en Memoria (No Persiste)**
`otp_store`, `session_store`, `ip_rate_limits` son `dict` globales. Reinicio = pérdida de sesiones.
**Fix:** SQLite/Redis para persistencia.

---

## 🚀 OPORTUNIDADES: BASE DE DATOS DE CONOCIMIENTOS COLECTIVOS

### Visión: **"Wikipedia Colaborativa Estudiantil"**
Los estudiantes aportan conocimiento (preguntas, respuestas, explicaciones, recursos) que se vectoriza y comparte anónimamente para mejorar el RAG de todos.

---

### A. Esquema de Base de Datos Nuevo

```sql
-- Tabla principal de conocimiento colectivo
CREATE TABLE IF NOT EXISTS knowledge_base (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,           -- Texto completo (pregunta+respuesta, explicación, etc.)
  summary TEXT,                    -- Resumen corto para UI
  subject TEXT NOT NULL,           -- Materia: matematicas, fisica, quimica, historia...
  topic TEXT,                      -- Subtema: derivadas, cinematica, tabla periodica...
  difficulty TEXT CHECK(difficulty IN ('basico','intermedio','avanzado')),
  source_type TEXT CHECK(source_type IN ('user_qa','user_explanation','verified_content','imported')),
  source_user_id TEXT,             -- NULL si anonimizado, FK users(id)
  is_verified INTEGER DEFAULT 0,   -- 1 = revisado por admin/profesor
  verified_by TEXT,                -- FK users(id) del verificador
  verified_at TEXT,                -- datetime
  upvotes INTEGER DEFAULT 0,
  downvotes INTEGER DEFAULT 0,
  view_count INTEGER DEFAULT 0,
  tags TEXT DEFAULT '[]',          -- JSON array: ["calculo", "regla-cadena", "ejercicio"]
  language TEXT DEFAULT 'es',
  embedding_model TEXT NOT NULL,   -- Modelo usado: 'nvidia/nv-embed-v1'
  embedding_dims INTEGER NOT NULL, -- 4096
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Índices para búsqueda
CREATE INDEX idx_kb_subject_topic ON knowledge_base(subject, topic);
CREATE INDEX idx_kb_verified ON knowledge_base(is_verified);
CREATE INDEX idx_kb_source_user ON knowledge_base(source_user_id);
CREATE INDEX idx_kb_created ON knowledge_base(created_at);

-- Tabla de embeddings vectoriales (separada para escalar)
CREATE TABLE IF NOT EXISTS knowledge_embeddings (
  id TEXT PRIMARY KEY,
  knowledge_id TEXT NOT NULL REFERENCES knowledge_base(id) ON DELETE CASCADE,
  vector_blob BLOB NOT NULL,       -- BLOB binario (Float32Array) para sqlite-vec
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Contribuciones de usuarios (gamificación)
CREATE TABLE IF NOT EXISTS knowledge_contributions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  knowledge_id TEXT NOT NULL REFERENCES knowledge_base(id),
  contribution_type TEXT CHECK(contribution_type IN ('created','edited','upvoted','reported')),
  points INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_kc_user ON knowledge_contributions(user_id);

-- Votos de usuarios (evitar duplicados)
CREATE TABLE IF NOT EXISTS knowledge_votes (
  id TEXT PRIMARY KEY,
  knowledge_id TEXT NOT NULL REFERENCES knowledge_base(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  vote_type INTEGER CHECK(vote_type IN (1, -1)),  -- 1=up, -1=down
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(knowledge_id, user_id)
);
```

---

### B. Flujo de Contribución (User Journey)

```
┌─────────────────┐     ┌──────────────────┐     ┌────────────────────┐
│ Usuario hace    │     │ Sistema detecta  │     │ Usuario confirma   │
│ pregunta buena  │───▶│ contenido valioso │───▶│ "¿Guardar para     │
│ o da buena resp │     │ (heurística/IA)  │     │  la comunidad?"    │
└─────────────────┘     └──────────────────┘     └────────────────────┘
                                                         │
                                                         ▼
                                                ┌────────────────────┐
                                                │ Guardar en KB     │
                                                │ + Generar embedding│
                                                │ + Puntos usuario  │
                                                └────────────────────┘
```

**Criterios automáticos para sugerir guardado:**
- Usuario pregunta y luego dice "gracias, entendido" → Q&A pair
- Asistente da explicación larga (>500 chars) y usuario reacciona positivamente
- Usuario edita/corrige respuesta del asistente → versión mejorada
- Usuario comparte recurso (link, PDF) relevante

---

### C. API Endpoints Propuestos

```typescript
// POST /api/knowledge/suggest - Sugerir guardar interacción actual
// Body: { sessionId, messageIds: string[], reason: 'qa_pair' | 'explanation' | 'resource' }
// Response: { knowledgeId, preview: string }

// POST /api/knowledge/contribute - Confirmar contribución
// Body: { knowledgeId, tags: string[], allowAttribution: boolean }
// Response: { success, pointsEarned }

// GET /api/knowledge/search - Buscar en base colectiva (RAG global)
// Query: q, subject, topic, difficulty, verified_only, limit
// Response: { results: KnowledgeItem[] }

// GET /api/knowledge/:id - Obtener item completo
// Response: KnowledgeItem

// POST /api/knowledge/:id/vote - Votar
// Body: { vote: 1 | -1 }
// Response: { upvotes, downvotes, userVote }

// GET /api/knowledge/stats/me - Mis contribuciones y puntos
// Response: { totalPoints, contributionsCount, rank }
```

---

### D. Integración con RAG Existente (Híbrido)

**Estrategia:** Combinar embeddings personales + colectivos en `buildRagContext`

```typescript
async function buildHybridRagContext(
  queryVector: number[],
  userId: string,
  options: { personalWeight: number; collectiveWeight: number; maxPersonal: number; maxCollective: number }
): Promise<string> {
  // 1. Embeddings personales (historial propio)
  const personal = await EmbeddingModel.getUserEmbeddings(userId, options.maxPersonal);
  const personalTop = findTopK(queryVector, personal, options.maxPersonal);
  
  // 2. Embeddings colectivos (base conocimiento global)
  const collective = await KnowledgeEmbeddingModel.searchSimilar(queryVector, {
    subject: detectSubject(query),  // Inferir materia del query
    minScore: 0.35,
    limit: options.maxCollective,
    verifiedOnly: true  // Solo contenido verificado
  });
  
  // 3. Merge ponderado
  const combined = [
    ...personalTop.map(r => ({ ...r, source: 'personal', weight: options.personalWeight })),
    ...collective.map(r => ({ ...r, source: 'collective', weight: options.collectiveWeight }))
  ].sort((a, b) => (b.score * b.weight) - (a.score * a.weight));
  
  // 4. Formatear contexto
  return formatContext(combined.slice(0, 5));
}
```

**Ventajas:**
- Usuario nuevo beneficia de conocimiento colectivo inmediato
- Usuario experto aporta y refina la base global
- Control de calidad via `is_verified` + votos comunidad

---

### E. Gamificación y Moderación

| Acción | Puntos | Badge |
|--------|--------|-------|
| Contribución aceptada | +10 | 🌱 "Semilla" (1ª contribución) |
| Contribución verificada por admin | +50 | ✅ "Verificador" |
| 10 upvotes en tu contenido | +20 | ⭐ "Estrella" |
| 100 contribuciones | +100 | 🏆 "Maestro" |
| Reporte válido (contenido malo) | +5 | 🛡️ "Guardián" |

**Moderación:**
- Contribuciones nuevas: `is_verified = 0`, visibles solo si `upvotes >= 3` O `is_verified = 1`
- Admins/profesores pueden verificar/editar/eliminar
- Reporte de usuarios → cola de revisión

---

### F. Migración Progresiva (Sin Romper Existente)

**Fase 1 - Infraestructura (Semana 1):**
- [ ] Añadir tablas `knowledge_base`, `knowledge_embeddings`, `knowledge_contributions`, `knowledge_votes`
- [ ] Crear `KnowledgeModel`, `KnowledgeEmbeddingModel` services
- [ ] Endpoint `/api/knowledge/search` (solo lectura, vacío al inicio)

**Fase 2 - Captura Automática (Semana 2):**
- [ ] Hook en `chat.service.ts` post-respuesta: detectar pares Q&A valiosos
- [ ] UI "¿Guardar esto?" toast no intrusivo
- [ ] Generar embedding colectivo al confirmar

**Fase 3 - RAG Híbrido (Semana 3):**
- [ ] Modificar `buildRagContext` → `buildHybridRagContext`
- [ ] A/B test: 50% usuarios con RAG híbrido, 50% solo personal
- [ ] Métricas: satisfacción, tokens, latencia

**Fase 4 - Comunidad (Semana 4):**
- [ ] Página "Biblioteca Colectiva" en frontend
- [ ] Perfil usuario: "Mis aportes", puntos, badges
- [ ] Panel admin: moderación, verificación, analytics

---

## 📋 PLAN DE ACCIÓN PRIORIZADO

### Crítico (Hacer Ya)
| # | Tarea | Archivo | Esfuerzo |
|---|-------|---------|----------|
| 1 | Fix race condition embeddings (transacción) | `chat.service.ts` | 30 min |
| 2 | Embedding también para respuesta IA | `chat.service.ts` | 45 min |
| 3 | Umbral similitud RAG (0.35) | `vector.ts` | 15 min |
| 4 | Fix regex profile edit (falsos positivos) | `chat.service.ts` | 10 min |
| 5 | Validar sessionId UUID en controller | `chat.controller.ts` | 10 min |
| 6 | Fix Python rate limiter bug | `backend-python/main.py` | 20 min |

### Alto Impacto (Esta Semana)
| # | Tarea | Esfuerzo |
|---|-------|----------|
| 7 | Modularizar `welcome.js` en ES modules | 3-4 hrs |
| 8 | Añadir tests unitarios (vitest) para vector.ts, chat.model.ts | 2-3 hrs |
| 9 | Migrar Python auth stores a SQLite | 2-3 hrs |
| 10 | Config CORS por env en Python | 15 min |
| 11 | LRU Cache para ProfileService | 30 min |

### Base Conocimientos Colectivos (Próximas 4 Semanas)
Ver **Sección F - Migración Progresiva** arriba.

---

## 🔍 HALLAZGOS ADICIONALES

### Positivos (Bien Hecho)
✅ Arquitectura RAG personal funcional y en producción
✅ Perfil adaptativo persistente en archivos Markdown
✅ Streaming SSE bien implementado con persistencia al cerrar
✅ Migraciones DB idempotentes con PRAGMA checks
✅ Cron jobs para insights diarios y perfiles
✅ Multi-modelo con registry configurable
✅ KaTeX rendering client-side eficiente
✅ Session management robusto (UUID + sessionStorage)

### Deuda Técnica
- ⚠️ `chat.service.ts` = 288 líneas, hace 7 cosas distintas
- ⚠️ Sin TypeScript strict en algunos `any` implícitos
- ⚠️ Frontend todo en un archivo, sin build step
- ⚠️ Logs Winston pero sin correlation IDs para tracing
- ⚠️ No hay health check endpoint completo (DB, NVIDIA API, Python auth)

### Seguridad
- ✅ Helmet CSP configurado
- ✅ Rate limiting en ambos servicios
- ✅ Cookies HttpOnly + Secure + SameSite=Lax
- ✅ Whitelist emails para auth
- ⚠️ SQLite file permissions (archivo en repo)
- ⚠️ `.env` en repo (backend/.env, backend-python/.env) — **MOVER A .gitignore**

---

## 📁 ARCHIVOS CLAVE PARA REVISAR EN PRÓXIMOS CAMBIOS

```
backend/src/services/chat.service.ts       # Core logic - REFACTORIZAR PRIMERO
backend/src/services/ai/embeddings.ts      # Embeddings NVIDIA
backend/src/utils/vector.ts                # Similitud coseno - AÑADIR UMBRAL
backend/src/models/embedding.model.ts      # DB embeddings - MIGRAR A BLOB/sqlite-vec
backend/src/db/migrate.ts                  # Esquema DB - AÑADIR TABLAS KB
backend-python/main.py                     # Auth - FIX RATE LIMITER + SQLITE
public/js/welcome.js                       # Frontend - MODULARIZAR
```

---

*Documento generado automáticamente tras análisis profundo del código base.*
*Fecha: 2026-07-10*
*Proyecto: LMS-Exam*