import { EmbeddingOutboxModel } from '../models/embedding-outbox.model.js';
import { EmbeddingModel } from '../models/embedding.model.js';
import { generateEmbedding } from '../services/ai/embeddings.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { getDb } from '../db/connection.js';
import { v4 as uuidv4 } from 'uuid';

const POLL_INTERVAL_MS = 30_000;
const BATCH_SIZE = 10;

export async function processEmbeddingOutbox(): Promise<number> {
  const pending = EmbeddingOutboxModel.getPending(BATCH_SIZE);
  if (pending.length === 0) return 0;

  let processed = 0;
  for (const item of pending) {
    EmbeddingOutboxModel.markProcessing(item.id);
    try {
      const vector = await generateEmbedding(item.text_content);
      const embId = uuidv4();
      getDb().transaction(() => {
        EmbeddingModel.saveEmbedding(embId, item.message_id, item.user_id, vector, config.embeddings.model, config.embeddings.dimensions);
        EmbeddingOutboxModel.markDone(item.id);
      })();
      processed++;
    } catch (err) {
      const msg = (err as Error).message;
      logger.warn('Embedding outbox: fallo procesando', { id: item.id, error: msg });
      EmbeddingOutboxModel.markFailed(item.id, msg);
    }
  }
  logger.info('Embedding outbox: lote procesado', { processed, total: pending.length });
  return processed;
}

let intervalId: NodeJS.Timeout | null = null;

export function startEmbeddingWorker(): void {
  if (intervalId) return;
  logger.info('Embedding worker iniciado', { intervalMs: POLL_INTERVAL_MS });
  intervalId = setInterval(async () => {
    try {
      await processEmbeddingOutbox();
    } catch (err) {
      logger.error('Embedding worker: error no manejado', { error: (err as Error).message });
    }
  }, POLL_INTERVAL_MS);
}

export function stopEmbeddingWorker(): void {
  if (intervalId) { clearInterval(intervalId); intervalId = null; }
}