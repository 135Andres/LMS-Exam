# Bugs y Errores Post-Implementación

Documento generado tras revisar todos los cambios implementados de `01_critical_errors` (fixes #1-#5, #7-#10) contra el código real.

## BUGS CONFIRMADOS EN CÓIGO IMPLEMENTADO

### BUG-1: `markFailed` backoff hardcoded — no usa `attempts` (`embedding-outbox.model.ts:36`)

```typescript
markFailed(id: string, error: string): void {
  const backoff = Math.min(60 * Math.pow(2, 1), 3600);  // ← siempre 60*2=120s
  ...
}
```

El exponente está hardcoded en `1` → siempre genera 120s de backoff. Debería usar `attempts` disponibles en la fila (el plan original especificaba `Math.pow(2, attempts)`):

```typescript
markFailed(id: string, error: string, attempts: number): void {
  const backoff = Math.min(60 * Math.pow(2, attempts), 3600);
  ...
}
```

**Severidad:** Baja — el sistema funciona pero no escala el delay entre reintentos como fue diseñado.

---

### BUG-2: `markFailed` no consulta `attempts` — no distingue agotados de reintentables (`embedding-outbox.model.ts:35-41`)

Tras `markFailed`, el `status` queda `'failed'`. `getPending` filtra por `status = 'pending'` → los `failed` **nunca se recuperan automáticamente**. El worker solo los reintentaría cuando el backoff de `next_retry_at` expire, pero la query SQL filtra por `status = 'pending'`, no `'failed'`. En la práctica, cualquier error transitorio marca el outbox item como `'failed'` permanentemente (solo el `next_retry_at` está en el futuro, pero el status no vuelve a `'pending'`).

**Fix:**
```typescript
markFailed(id: string, error: string): void {
  const row = getDb().prepare('SELECT attempts, max_attempts FROM embedding_outbox WHERE id = ?').get(id) as any;
  const isExhausted = row.attempts >= row.max_attempts;
  const backoff = Math.min(60 * Math.pow(2, row.attempts), 3600);
  const nextRetry = new Date(Date.now() + backoff * 1000).toISOString();
  // Si no agotado, volver a 'pending' (el worker lo reintentará tras backoff)
  const newStatus = isExhausted ? 'failed' : 'pending';
  getDb().prepare(
    `UPDATE embedding_outbox SET status = ?, error = ?, next_retry_at = ? WHERE id = ?`
  ).run(newStatus, error.substring(0, 500), nextRetry, id);
}
```

**Severidad:** Media — si la API de embeddings tiene un timeout transitorio, el item queda stuck en `'failed'` y nunca se recupera via el worker programado. La única forma de recuperar es el `processEmbeddingOutbox()` call al arrancar el server, que también filtra por `status = 'pending'`.

---

### BUG-3: `ensureSession` es `INSERT OR IGNORE` — no valida ownership al crear sesión (`chat.model.ts:5-8`)

```typescript
ensureSession(sessionId: string, userId: string): void {
  getDb().prepare(
    'INSERT OR IGNORE INTO chat_sessions (session_id, user_id) VALUES (?, ?)'
  ).run(sessionId, userId);
}
```

Si el usuario A envía `sessionId` del usuario B (UUID válido), `assertSessionOwnership` en el controller lo bloquea con 403 ✓. **Pero** `assertSessionOwnership` solo checkea si la sesión existe → si la sesión **no existe** (UUID nuevo), `ensureSession` la crea con `user_id = A`. Esto está bien para sesiones nuevas.

El bug sutil: el orden en `sendChatMessageHandler` es:
1. `assertSessionOwnership(sid, userId)` — si `sessionId` viene en el body y la sesión no existe, retorna sin error (no valida)
2. `sendChatMessage(...)` → `ChatModel.saveMessage` → `ensureSession` → `INSERT OR IGNORE`

**Esto funciona correctamente.** No es un bug — confirmo que la ownership check solo aplica a sesiones existentes, las nuevas se asignan al usuario autenticado. ✅ Falso positivo del análisis.

---

### BUG-4: `archiveSession` / `unarchiveSession` / `deleteSession` no validan ownership (`chat.controller.ts:177-199`)

```typescript
export async function archiveSessionHandler(req: Request, res: Response): Promise<void> {
  const { sessionId } = req.body as { sessionId: string };
  const userId = req.user!.id;
  if (!sessionId) { res.status(400).json({ error: 'sessionId requerido' }); return; }
  ChatModel.archiveSession(sessionId, userId);  // ← usa userId en WHERE, pero no valida antes
}
```

Los métodos del `ChatModel` usan `WHERE session_id = ? AND user_id = ?` → no modifican sesiones ajenas (silenciosamente no-op si el user_id no coincide). Pero **no retornan error** — el usuario recibe `{ success: true }` aun si archivó una sesión inexistente o ajena.

**Severidad:** Baja — los datos no se corrompen (WHERE filtra), pero el usuario no recibe feedback de fallo.

---

### BUG-5: `buildContent` ignora attachments tipo `'file'` (`chat.service.ts:106-117`)

```typescript
function buildContent(message: string, attachments?: Attachment[]): Array<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: message }];
  if (attachments && attachments.length > 0) {
    for (const att of attachments) {
      if (att.type === 'image') { ... }
      else if (att.type === 'audio') { ... }
      // ← NO HAY caso para att.type === 'file'
    }
  }
  return content;
}
```

El frontend (welcome.js) permite subir documentos, el validator ahora acepta `type: 'file'` (`chat.ts:9`), pero `buildContent` **ignora silenciosamente los archivos de tipo file** — no se envían al modelo. El usuario cree que subió un PDF pero el tutor no lo recibe.

**Severidad:** Media — feature roto sin feedback al usuario.

---

### BUG-6: `detectProfileEdit` se ejecuta **antes** de streaming — bloquea respuesta (`chat.service.ts:192, 280`)

```typescript
// Paso 4: detectar edición de perfil desde el chat
await detectProfileEdit(message, userId);  // ← await: bloquea
// Paso 5: construir prompts con RAG
const systemPrompt = buildSystemPrompt(...);
```

`detectProfileEdit` hace una llamada a `generateFromAI` (clasificador IA) que puede tomar 500ms-2s. En el path de streaming, esto retrasa el inicio del stream: el usuario ve `showTyping()` durante ~1s extra por cada mensaje que matchea el regex (aunque después el clasificador diga "no es edición").

**Severidad:** Media — el fix #4 redujo los falsos positivos del regex, pero los que pasan el gate añaden latencia al streaming. Debería ser fire-and-forget (no `await`).

**Fix:**
```typescript
detectProfileEdit(message, userId).catch(err =>
  logger.warn('Profile detection async failed', { error: err.message })
);
// No await — corre en background
```

---

### BUG-7: Worker no hace transacción atómica save+markDone (`embedding-worker.ts:17-24`)

```typescript
EmbeddingModel.saveEmbedding(uuidv4(), item.message_id, ...);
EmbeddingOutboxModel.markDone(item.id);
```

Si el proceso crashea entre `saveEmbedding` y `markDone`, el outbox item queda `'processing'` → nunca se recupera (worker filtra `pending`), y el embedding está duplicado cuando el recovery al restart hace `processEmbeddingOutbox()` en... wait, no. `processing` no está en `getPending`. El item queda stuck en `'processing'` permanentemente.

**Severidad:** Media — raro (crash entre 2 statements), pero si pasa, el outbox item se pierde del pipeline permanentemente.

**Fix:** envolver en transacción `better-sqlite3`:
```typescript
getDb().transaction(() => {
  EmbeddingModel.saveEmbedding(uuidv4(), item.message_id, ...);
  EmbeddingOutboxModel.markDone(item.id);
})();
```

---

### BUG-8: `next_retry_at` query en `getPending` puede usar índice ineficiente (`embedding-outbox.model.ts:14-20`)

```sql
WHERE status = 'pending' AND attempts < max_attempts
  AND (next_retry_at IS NULL OR next_retry_at <= ?)
```

El `OR next_retry_at IS NULL` rompe el uso del índice `idx_outbox_status_retry` (definido como `(status, next_retry_at)`). Para新人 items sin `next_retry_at`, el query debe scan todo el estado pending.

**Severidad:** Baja — pocos registros en outbox, el performance hit es despreciable en la escala actual.

---

### BUG-9: Python `db.py` cleanup hace DELETE en auth_ip_rate_limits con `now - 2*window` pero no por IP (`db.py:163-168`)

```python
def cleanup_expired():
  conn.execute("DELETE FROM auth_ip_rate_limits WHERE request_at < ?", (old,))
```

Funciona correctamente por IP. ✅ Falso positivo del análisis.

---

### BUG-10: `check_ip_rate_limit` no es thread-safe entre `COUNT` e `INSERT` (`db.py:128-143`)

```python
count = conn.execute("SELECT COUNT(*) ... WHERE ip = ?").fetchone()["c"]
if count >= IP_RATE_LIMIT: return False
conn.execute("INSERT INTO auth_ip_rate_limits ...")
```

Dos threads (FastAPI async coroutines o procesos) podrían pasar el check `count < 5` ambos antes de que uno inserte → ambos insertan → 6+ requests permitidos. El `transaction()` wrapper solo garantiza ACID dentro de la transacción, no serialize el check-then-insert.

**Severidad:** Baja — SQLite WAL permite lecturas no-bloqueantes, pero los writes son serialized por `busy_timeout`. En la práctica, el segundo write esperará al commit del primero, y el COUNT en la segunda transacción verá el nuevo INSERT si el primer commit ya terminó. El race window es muy pequeño.

---

### BUG-11: `increment_otp_attempts` SQL puede incrementar OTP expirado (`db.py:96-100`)

```python
def increment_otp_attempts(email: str) -> int:
  conn.execute("UPDATE auth_otp_codes SET attempts = attempts + 1 WHERE email = ? AND expires_at > datetime('now')", (email,))
  row = conn.execute("SELECT attempts FROM auth_otp_codes WHERE email = ? ORDER BY created_at DESC LIMIT 1", (email,)).fetchone()
```

El UPDATE filtra por `expires_at > datetime('now')` ✓, pero el SELECT posterior **no** filtra por expires_at → podría retornar un OTP expirado diferente. Y el `ORDER BY created_at DESC` sin el filtro de expiración puede devolver un OTP que justo expiró en el último tick.

**Severidad:** Baja — edge case de timing, el flujo principal checkea expiración antes (`main.py:271`).

---

### BUG-12: `store_otp` resetea `attempts` en lugar de `used`/`status` (`db.py:79-85`)

```python
def store_otp(email: str, code_hash: str, ...):
  conn.execute("UPDATE auth_otp_codes SET attempts = 0 WHERE email = ?", (email,))
  conn.execute("INSERT INTO auth_otp_codes (id, ...) VALUES (...)")
```

El plan original decía: *"Invalidar OTPs previos del mismo email"*. Pero `UPDATE ... SET attempts = 0` **reactiva** OTPs viejos al resetear sus intentos a 0. El nuevo OTP se inserta, pero los viejos siguen siendo válidos para `get_otp` (que devuelve `ORDER BY created_at DESC LIMIT 1` — el más nuevo). Funciona por el `ORDER BY`, pero los viejos siguen activos en DB con `attempts=0`.

**Fix:**
```python
conn.execute("DELETE FROM auth_otp_codes WHERE email = ?", (email,))
# o
conn.execute("UPDATE auth_otp_codes SET expires_at = datetime('now') WHERE email = ?", (email,))
```

**Severidad:** Media — seguridad. Un atacante que conozca un OTP expirado no podría usarlo (el check de expiración lo bloquea), pero los datos se acumulan innecesariamente.

---

## RESUMEN DE SEVERIDADES

| Bug | Severidad | Archivo |
|-----|----------|---------|
| BUG-1 backoff hardcoded | Baja | embedding-outbox.model.ts:36 |
| BUG-2 markFailed stuck | Media | embedding-outbox.model.ts:35 |
| BUG-3 ensureSession | Falso positivo ✅ | — |
| BUG-4 archive sin feedback | Baja | chat.controller.ts:177 |
| BUG-5 buildContent ignora file | Media | chat.service.ts:106 |
| BUG-6 detectProfileEdit bloquea | Media | chat.service.ts:192 |
| BUG-7 worker no transaccional | Media | embedding-worker.ts:17 |
| BUG-8 getPending OR index | Baja | embedding-outbox.model.ts:14 |
| BUG-9 cleanup | Falso positivo ✅ | — |
| BUG-10 race rate limit | Baja | db.py:128 |
| BUG-11 increment_otp expired | Baja | db.py:96 |
| BUG-12 store_otp no invalida | Media | db.py:81 |

**Bugs a fixear prioritariamente:** BUG-2, BUG-5, BUG-6, BUG-7, BUG-12 (todos severidad media).
