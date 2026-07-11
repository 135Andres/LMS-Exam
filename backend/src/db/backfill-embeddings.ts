import { getDb } from './connection.js';
import { logger } from '../utils/logger.js';

function backfillEmbeddings(): void {
  const db = getDb();
  type VecRow = { id: string; message_id: string; user_id: string; vector_text: string; model: string; dimensions: number };
  const rows = db.prepare(
    'SELECT id, message_id, user_id, vector_text, model, dimensions FROM chat_embeddings'
  ).all() as VecRow[];

  if (rows.length === 0) {
    logger.info('Backfill: no hay embeddings JSON para migrar');
    return;
  }

  logger.info(`Backfill: migrando ${rows.length} embeddings de JSON a BLOB...`);
  let migrated = 0;

  const insertVec = db.prepare(
    'INSERT OR IGNORE INTO chat_embeddings_vec (id, message_id, user_id, embedding, model, dimensions) VALUES (?, ?, ?, ?, ?, ?)'
  );

  const tx = db.transaction((items: VecRow[]) => {
    for (const row of items) {
      try {
        const vector = JSON.parse(row.vector_text) as number[];
        const blob = Buffer.from(new Float32Array(vector).buffer);
        insertVec.run(row.id, row.message_id, row.user_id, blob, row.model, row.dimensions);
        migrated++;
      } catch {
        logger.warn('Backfill: fallo en embedding', { id: row.id });
      }
    }
  });

  tx(rows);
  logger.info(`Backfill completado: ${migrated}/${rows.length} embeddings migrados a BLOB`);
}

try {
  backfillEmbeddings();
  process.exit(0);
} catch (err) {
  logger.error('Backfill failed', { error: (err as Error).message });
  process.exit(1);
}
