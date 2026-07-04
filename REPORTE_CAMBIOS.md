# Reporte de Cambios — RAG + Perfil Adaptativo + Persistencia

Se implementaron 5 fases completas más integración de `detectProfileEdit` y cron de insights.

---

## Fase 0 — Migración DB + Types

### `backend/src/db/migrate.ts`
- Helper `addColumnIfMissing()` con PRAGMA + ALTER TABLE (idempotente)
- Columna `has_completed_setup INTEGER DEFAULT 0` en `users`
- Tabla `chat_logs` (id, user_id, session_id, role, content, created_at) con FK y CASCADE
- Tabla `chat_embeddings` (id, chat_log_id FK, user_id FK, vector_text, model, dimensions, created_at) con CASCADE
- Tabla `chat_insights` (id, user_id FK, subject, date, insights JSON, created_at) con UNIQUE(user_id, subject, date)

### `backend/src/types/db.ts`
- Nuevas interfaces: `ChatLogRow`, `ChatEmbeddingRow`, `ChatInsightRow`
- `UserRow` extendida con `has_completed_setup?: number`

---

## Fase 1 — Persistencia de Chat (Opción C)

### `backend/src/services/chat.service.ts`
- `sendChatMessageStream()`: guarda user msg al inicio; recolecta chunks en `fullResponse`; guarda AI msg en `finally` del generator (Opción C)
- `sendChatMessage()`: guarda user msg al inicio; guarda AI msg después de `generateFromAI`

### `backend/src/models/chat.model.ts`
- `saveMessage()`: INSERT en `chat_logs`
- `getSessionHistory()`: últimas 50 rows de la sesión más reciente
- `getUserSessions()`: sesiones distintas del usuario
- `getHistoryBySession()`: todos los mensajes de una sesión

### `backend/src/validators/chat.ts`
- Schema `sessionId`: `z.string().uuid().optional()`

### `backend/src/controllers/chat.controller.ts`
- `getHistoryHandler`: retorna historial del usuario (última sesión o por sessionId)

### `backend/src/routes/chat.routes.ts`
- `GET /tutor/history` (con auth)

### `public/js/welcome.js`
- `sessionId` generado con `crypto.randomUUID()`, persistido en `sessionStorage`
- Al cargar: `fetch('/api/chat/tutor/history')` y renderiza historial
- Captura `sessionId` en los eventos SSE

---

## Fase 2 — Embeddings + RAG

### `backend/src/config/index.ts`
- `config.embeddings`: `{ model, apiKey, baseUrl, dimensions }`

### `backend/src/services/ai/embeddings.ts`
- `generateEmbedding(text)`: POST `/v1/embeddings` a NVIDIA
- Sin `dimensions` ni `input_type` (no soportados por `nv-embed-v1`)
- Retorna `number[]` (vector 4096d)

### `backend/src/models/embedding.model.ts`
- `saveEmbedding()`: INSERT en `chat_embeddings`
- `findSimilar()`: carga embeddings del usuario, calcula similitud coseno en TS
- `deleteByUser()`: DELETE por user_id

### `backend/src/utils/vector.ts`
- `cosineSimilarity(a, b)`: coseno entre dos vectores
- `findTopK(query, vectors, k)`: top-k por similitud

### `backend/src/services/chat.service.ts`
- En ambas funciones (stream y non-stream):
  1. Generar embedding del mensaje del usuario
  2. `buildRagContext()`: buscar top-3 mensajes pasados similares
  3. Guardar embedding en DB
  4. Inyectar contexto RAG en `buildSystemPrompt(resolved.label, ragContext, userId)`
- `buildRagContext()` recibe el `userMsgId` para excluir el mensaje actual de sus propios resultados

---

## Fase 3 — Setup Mode + Perfil Adaptativo

### `backend/src/services/profile.service.ts`
- `getProfile(userId)`: lee `backend/data/profiles/user_{id}.md` (crea vacío si no existe)
- `saveProfile(userId, content)`: escribe archivo, invalida caché
- `resetProfile(userId)`: borra archivo, invalida caché
- `appendToProfile(userId, section, changes)`: agrega texto markdown con sección, trunca a 1.5KB semánticamente
- Caché en memoria: `Map<string, { content: string }>`, invalidada en save/reset/append

### `backend/src/validators/user.ts`
- `setupSchema`: `answers` array de strings (10–4000 chars cada uno)

### `backend/src/controllers/user.controller.ts`
- `getSetupStatus`: retorna `{ completed: boolean }` basado en `has_completed_setup`
- `completeSetup`: recibe respuestas del formulario, genera perfil `.md`, marca `has_completed_setup = 1`
- `resetSetup`: borra perfil, resetea `has_completed_setup = 0`

### `backend/src/routes/user.routes.ts`
- `GET /setup/status`
- `POST /setup`
- `POST /setup/reset`

### `backend/src/services/chat.service.ts`
- `buildSystemPrompt()` recibe `userId`, inyecta sección "--- Perfil del estudiante ---" con contenido del `.md`

### `public/js/welcome.js`
- `checkSetup()`: consulta `/api/user/setup/status` tras 500ms
- Si `completed === false`: overlay semi-transparente bloquea dashboard
- Formulario multi-paso: 3 preguntas con textarea
- Botón "Iniciar" → POST `/api/user/setup` → recarga
- Botón "Saltar" → marca completado con perfil vacío

---

## Fase 4 — Edición de Perfil desde el Chat

### `backend/src/services/profile.service.ts`
- `appendToProfile()`: toma `section` (string) y `changes` (string), construye bloque markdown `## section\n\nchanges\n`, trunca a 1536 bytes

### `backend/src/services/chat.service.ts`
- `detectProfileEdit(message, userId)`:
  - Regex pre-filter: busca patrones como "quiero agregar", "actualiza mi perfil", "soy", etc.
  - Si match: llama a AI classifier (system prompt dedicado, 150 tokens, temp 0.2)
  - Classifier retorna JSON `{ action, section, changes }` o `{ action: "none" }`
  - Si `action === "append"`: llama `appendToProfile(userId, section, changes)`
- Integrada en ambas funciones (stream y non-stream) entre guardar embedding y construir prompts

---

## Fase 5 — Cron de Insights

### `backend/package.json`
- Dependencia `node-cron` instalada

### `backend/src/services/insights.service.ts`
- `generateDailyInsights(userId, date)`:
  - Lee todos los `chat_logs` del día
  - Si menos de 3 mensajes, no-op
  - Envía a DeepSeek V4 Flash para extraer fortalezas, debilidades, recomendaciones
  - Parsea JSON y guarda en `chat_insights` con ON CONFLICT DO UPDATE
  - Extrae `subject` por keywords (matematicas, fisica, quimica, historia, lenguaje, biologia)

### `backend/server.ts`
- `cron.schedule('0 2 * * *', ...)`: a las 2 AM itera todos los usuarios y llama `generateDailyInsights` para el día anterior

---

## Cambios Adicionales

### `backend/src/services/ai/nvidia.ts`
- Interface `NvidiaOptions` extendida con `max_tokens?: number`
- `callNvidia()` y `callNvidiaStream()` usan `options?.max_tokens ?? 4096`

### `backend/.env`
- Nuevas variables: `NVIDIA_API_KEY_EMBEDDINGS`, `NVIDIA_EMBEDDINGS_MODEL=nvidia/nv-embed-v1`, `NVIDIA_EMBEDDINGS_DIM=4096`

### `AGENTS.md`
- Nota de licencia CC-BY-NC-4.0 para `nv-embed-v1`
- Sección "Registro de Sesión Actual" actualizada con progreso completo

---

## Compilación

```bash
cd backend
npx tsc --noEmit  # ✅ Sin errores
```

## Pendientes

1. **Pre-flight verification**: arrancar servidores y probar login + chat + persistencia + RAG + setup end-to-end
2. **Pruebas en frontend**: setup overlay, edición de perfil desde chat
3. **Refinamiento UI**: timing del overlay setup vs carga del dashboard
