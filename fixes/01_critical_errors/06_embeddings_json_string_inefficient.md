# PENDIENTE #6: Embeddings almacenados como JSON String (Ineficiente)

## ESTADO
**No implementado.** Siguen como JSON string en `migrate.ts:104` (`vector_text TEXT`). Los fixes #1-#5 y #7-#10 ya están implementados. Este es el único plan de `01_critical_errors` que queda pendiente.

## OBJETIVO ESPECÍFICO
Migrar de `vector_text TEXT` (JSON string) a `vector_blob BLOB` (Float32Array binario) + `sqlite-vec` extension para búsqueda vectorial nativa.

## PROBLEMA ACTUAL

**Schema (`migrate.ts:104-112`):**
```sql
-- Vectores como JSON string (sin sqlite-vec, similitud coseno en TS puro)
CREATE TABLE IF NOT EXISTS chat_embeddings (
  vector_text TEXT NOT NULL,  -- JSON.stringify([0.1, -0.2, ...]) → ~40KB por fila
);
```

**Modelo (`embedding.model.ts:7-8`):**
```typescript
INSERT INTO chat_embeddings ... VALUES (?, ?, ?, ?, ?, ?)
  .run(id, messageId, userId, JSON.stringify(vector), model, dimensions);
```

**Consulta (`embedding.model.ts:12-19`):**
```sql
SELECT e.vector_text, c.content, e.message_id
FROM chat_embeddings e JOIN chat_logs c ON c.id = e.message_id
WHERE e.user_id = ? ORDER BY c.created_at DESC LIMIT ?
```
→ **Carga TODOS los embeddings del usuario en memoria** → `JSON.parse()` → calcula coseno en JS → O(n) por query

**Costos a escala (1000 usuarios × 100 embeddings c/u = 100k vectores):**
| Métrica | Valor actual (JSON+JS) |
|---------|----------------------|
| RAM por query | ~4MB por usuario (100 × 40KB string) |
| Latencia query | ~50-200ms (parse JSON + loop JS) |
| Storage | ~40KB por vector (JSON text) |
| Indexable | No |
| Escalabilidad | Límite práctico ~50k vectores |

## SOLUCIÓN: sqlite-vec + BLOB

### 1. Instalar dependencia

```bash
cd backend && npm install sqlite-vec
```

**Nota Windows:** `sqlite-vec` usa extensions nativas que `better-sqlite3` carga via `db.loadExtension()`. Verificar que el binario esté disponible para Windows x64. Si no funciona, mantener el fallback en JS (este plan es pragmático — ver sección Fallback).

### 2. Migración — nueva tabla + virtual table

```sql
-- backend/src/db/migrate.ts (añadir)

CREATE TABLE IF NOT EXISTS chat_embeddings_vec (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES chat_logs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  embedding BLOB NOT NULL,           -- Float32Array binario (4096 × 4 = 16KB vs 40KB JSON)
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_chat_embeddings_vec_user ON chat_embeddings_vec(user_id);

-- Virtual table para búsqueda vectorial (sqlite-vec)
-- Nota: sqlite-vec crea su propio índice HNSW
CREATE VIRTUAL TABLE IF NOT EXISTS vec_chat_embeddings USING vec0(
  embedding float[4096]
);
```

### 3. Cargar extension en `connection.ts`

```typescript
// backend/src/db/connection.ts
import Database from 'better-sqlite3';
import path from 'path';

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Cargar sqlite-vec (opcional — fallback a JS si no está)
let vecAvailable = false;
try {
  const vecPath = path.resolve('node_modules/sqlite-vec/dist/vec0');
  db.loadExtension(vecPath);
  vecAvailable = true;
  logger.info('sqlite-vec cargado correctamente');
} catch (err) {
  logger.warn('sqlite-vec no disponible, usando fallback JS para similitud coseno', { error: (err as Error).message });
}

export { vecAvailable };
```

### 4. Modelo con dual-write (durante migración)

```typescript
// backend/src/models/embedding.model.ts
import { vecAvailable } from '../db/connection.js';

export const EmbeddingModel = {
  saveEmbedding(id, messageId, userId, vector, model, dimensions) {
    const db = getDb();

    // Convertir a BLOB (Float32Array → Buffer)
    const blob = Buffer.from(new Float32Array(vector).buffer);

    db.transaction(() => {
      // Tabla nueva (vec)
      db.prepare(
        `INSERT INTO chat_embeddings_vec (id, message_id, user_id, embedding, model, dimensions) VALUES (?, ?, ?, ?, ?, ?)`
      ).run(id, messageId, userId, blob, model, dimensions);

      // Índice vec (solo si está disponible)
      if (vecAvailable) {
        db.prepare(`INSERT INTO vec_chat_embeddings(rowid, embedding) VALUES (?, ?)`)
          .run(id, blob);
      }
    })();
  },

  // Búsqueda nativa via sqlite-vec (más eficiente)
  findSimilar(userId: string, queryVector: number[], k: number = 3, minScore: number = 0.35) {
    if (!vecAvailable) {
      return this.findSimilarFallback(userId, queryVector, k, minScore);
    }

    const db = getDb();
    const queryBlob = Buffer.from(new Float32Array(queryVector).buffer);

    const rows = db.prepare(`
      SELECT
        c.content,
        c.id as message_id,
        c.role,
        vec_distance_cosine(v.embedding, ?) as distance
      FROM vec_chat_embeddings e
      JOIN chat_embeddings_vec v ON v.id = e.rowid
      JOIN chat_logs c ON c.id = v.message_id
      WHERE v.user_id = ?
      ORDER BY distance ASC
      LIMIT ?
    `).all(queryBlob, userId, k * 2) as Array<{ content: string; message_id: string; role: string; distance: number }>;

    // Convertir distance (0 = idéntico, 2 = opuesto) a similarity (1 = idéntico, -1 = opuesto)
    // norma: similarity = 1 - distance
    return rows
      .map(r => ({
        content: r.content,
        messageId: r.message_id,
        role: r.role,
        score: 1 - r.distance,
      }))
      .filter(r => r.score >= minScore)
      .slice(0, k);
  },

  // Fallback en JS (si sqlite-vec no está disponible)
  findSimilarFallback(userId: string, queryVector: number[], k: number, minScore: number) {
    const rows = getDb().prepare(
      `SELECT e.embedding, c.content, c.id as message_id, c.role
       FROM chat_embeddings_vec e
       JOIN chat_logs c ON c.id = e.message_id
       WHERE e.user_id = ?
       ORDER BY c.created_at DESC LIMIT 100`
    ).all(userId) as Array<{ embedding: Buffer; content: string; message_id: string; role: string }>;

    const items = rows.map(r => ({
      vector: Array.from(new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4)),
      content: r.content,
      messageId: r.message_id,
      role: r.role,
    }));

    return findTopK(queryVector, items, k, minScore);
  },

  // Mantener método legacy temporalmente para compatibilidad
  getUserEmbeddings(userId: string, limit = 100): Array<{ vector: number[]; content: string; messageId: string; role: string }> {
    const rows = getDb().prepare(
      `SELECT e.embedding, c.content, e.message_id, c.role
       FROM chat_embeddings_vec e
       JOIN chat_logs c ON c.id = e.message_id
       WHERE e.user_id = ?
       ORDER BY c.created_at DESC LIMIT ?`
    ).all(userId, limit) as Array<{ embedding: Buffer; content: string; message_id: string; role: string }>;

    return rows.map(r => ({
      vector: Array.from(new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4)),
      content: r.content,
      messageId: r.message_id,
      role: r.role,
    }));
  },
};
```

### 5. Backfill script para migrar datos existentes

```typescript
// backend/src/db/backfill-embeddings.ts
import { getDb } from './connection.js';
import { logger } from '../utils/logger.js';

async function backfillEmbeddings() {
  const db = getDb();
  logger.info('Backfill: migrando embeddings de JSON a BLOB...');

  const rows = db.prepare('SELECT id, message_id, user_id, vector_text, model, dimensions FROM chat_embeddings').all() as any[];
  let migrated = 0;

  for (const row of rows) {
    try {
      const vector = JSON.parse(row.vector_text) as number[];
      const blob = Buffer.from(new Float32Array(vector).buffer);

      db.prepare(
        `INSERT OR IGNORE INTO chat_embeddings_vec (id, message_id, user_id, embedding, model, dimensions) VALUES (?, ?, ?, ?, ?, ?)`
      ).run(row.id, row.message_id, row.user_id, blob, row.model, row.dimensions);

      if (vecAvailable) {
        db.prepare(`INSERT OR IGNORE INTO vec_chat_embeddings(rowid, embedding) VALUES (?, ?)`)
          .run(row.id, blob);
      }
      migrated++;
    } catch (err) {
      logger.warn('Backfill: fallo en embedding', { id: row.id, error: (err as Error).message });
    }
  }

  logger.info(`Backfill completado: ${migrated}/${rows.length} embeddings migrados`);
}

backfillEmbeddings().catch(err => { logger.error('Backfill failed', { error: err.message }); process.exit(1); });
```

## MIGRACIÓN ZERO-DOWNTIME (por fases)

1. **Fase 1:** Instalar `sqlite-vec` + crear nueva tabla vec + cargar extension
2. **Fase 2:** Dual-write: nuevo código escribe en AMBAS tablas (vieja + nueva) temporalmente
3. **Fase 3:** Backfill: script migración datos existentes de `chat_embeddings.vector_text` → `chat_embeddings_vec.embedding`
4. **Fase 4:** Switch: `buildRagContext` usa `EmbeddingModel.findSimilar()` si vec disponible, fallback a `getUserEmbeddings()` + JS cosine
5. **Fase 5:** Eliminar tabla vieja `chat_embeddings` tras verificación (1 semana después)

## BENEFICIOS

| Métrica | Antes (JSON + JS) | Después (sqlite-vec) |
|---------|-------------------|----------------------|
| Latencia query 10k vecs | ~150ms | ~5ms |
| RAM por query | ~4MB (carga 100 vecs) | <10KB (streaming) |
| Storage por vector | ~40KB (JSON text) | 16KB (BLOB) |
| Escalabilidad | ~50k vecs límite | 1M+ vecs |
| Precisión | Coseno JS (float64) | Coseno nativo (SIMD) |

## MEJORAS ADICIONALES DETECTADAS

1. **Fallback robusto:** Si `sqlite-vec` no está disponible en Windows (binario no compilado), el código degrada automáticamente a JS cosine sin error. Esto hace la migración segura.

2. **Constraint UNIQUE en message_id:** Añadir `UNIQUE(message_id)` a `chat_embeddings_vec` para prevenir embeddings duplicados del mismo mensaje (problema potencial si el worker outbox reprocesa):

```sql
CREATE UNIQUE INDEX idx_chat_embeddings_vec_msg ON chat_embeddings_vec(message_id);
```

3. **Detección automática de dimensión:** El schema de virtual table asume 4096 dims. Si el modelo cambia (ej. 2048), la virtual table fallará. Hacer la dimensión configurable:

```typescript
const EMBEDDING_DIMS = config.embeddings.dimensions; // del env var
// En migrate.ts, usar string interpolation para la dimensión:
db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS vec_chat_embeddings USING vec0(embedding float[${EMBEDDING_DIMS}])`);
```

## VERIFICACIÓN

```bash
# 1. Instalar sqlite-vec y verificar carga
npx tsx -e "import {getDb} from './src/db/connection.js'; console.log(getDb().prepare('SELECT vec_version()').get())"

# 2. Migración
npx tsx src/db/migrate.ts

# 3. Backfill
npx tsx src/db/backfill-embeddings.ts

# 4. Verificar: misma búsqueda en ambos métodos produce mismo resultado
# 5. npx tsc --noEmit
```

## ARCHIVOS A MODIFICAR/CREAR
1. `backend/package.json` — añadir `sqlite-vec`
2. `backend/src/db/connection.ts` — cargar extension + flag `vecAvailable`
3. `backend/src/db/migrate.ts` — nuevas tablas + virtual table + índice unique
4. `backend/src/db/backfill-embeddings.ts` — **NUEVO** script de migración
5. `backend/src/models/embedding.model.ts` — reescritura con BLOB + findSimilar + fallback
6. `backend/src/services/chat.service.ts` — usar `findSimilar()` en `buildRagContext`

## NOTA DE PRIORIZACIÓN
Este fix es el de mayor esfuerzo en `01_critical_errors`. Se recomienda implementarlo **después** de los fixes 1-5 y 7-10, ya que:
- No causa bugs funcionales (el RAG funciona, solo es lento)
- Requiere instalación de dependencia nativa (riesgo en Windows)
- La migración de datos existentes es delicada
- Los fixes 2 (outbox), 3 (assistant embeddings) y 5 (threshold) deben ir primero
