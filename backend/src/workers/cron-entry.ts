import { getDb } from '../db/connection.js';
import { logger } from '../utils/logger.js';
import { startScheduler, stopScheduler } from './scheduler.js';
import { startEmbeddingWorker, stopEmbeddingWorker } from './embedding-worker.js';
import { processEmbeddingOutbox } from './embedding-worker.js';

async function main(): Promise<void> {
  logger.info('Worker process iniciado', { pid: process.pid });

  getDb();

  startScheduler();
  startEmbeddingWorker();

  processEmbeddingOutbox().catch(err =>
    logger.error('Outbox recovery failed', { error: (err as Error).message })
  );

  process.on('SIGTERM', () => {
    logger.info('Worker: SIGTERM, cerrando...');
    stopScheduler();
    stopEmbeddingWorker();
    process.exit(0);
  });
  process.on('SIGINT', () => {
    logger.info('Worker: SIGINT, cerrando...');
    stopScheduler();
    stopEmbeddingWorker();
    process.exit(0);
  });
}

main().catch(err => {
  logger.error('Worker: fallo fatal', { error: (err as Error).message });
  process.exit(1);
});
