import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getTestDb, resetDb } from '../../test/setup.js';
import { EmbeddingOutboxModel } from '../models/embedding-outbox.model.js';

const USER_ID = 'u1';
const SESSION_ID = 's1';
const MSG_ID = 'm1';

vi.mock('../services/ai/embeddings.js', () => ({
  generateEmbedding: vi.fn(),
}));

const { generateEmbedding } = await import('../services/ai/embeddings.js');
const { processEmbeddingOutbox, startEmbeddingWorker, stopEmbeddingWorker } = await import('./embedding-worker.js');

function seedMessage(msgId: string) {
  const db = getTestDb();
  db.prepare('INSERT OR IGNORE INTO users (id, email) VALUES (?, ?)').run(USER_ID, 'test@test.com');
  db.prepare('INSERT OR IGNORE INTO chat_sessions (session_id, user_id) VALUES (?, ?)').run(SESSION_ID, USER_ID);
  db.prepare('INSERT INTO chat_logs (id, user_id, session_id, role, content) VALUES (?, ?, ?, ?, ?)').run(
    msgId, USER_ID, SESSION_ID, 'user', 'hola'
  );
}

describe('processEmbeddingOutbox', () => {
  beforeEach(() => {
    resetDb();
    seedMessage(MSG_ID);
    vi.mocked(generateEmbedding).mockReset();
  });

  it('procesa un item pendiente y lo marca como completado', async () => {
    vi.mocked(generateEmbedding).mockResolvedValue([0.1, 0.2, 0.3]);
    EmbeddingOutboxModel.enqueue('o1', MSG_ID, USER_ID, 'texto de prueba', 'user');

    const processed = await processEmbeddingOutbox();

    expect(processed).toBe(1);
    const db = getTestDb();
    const row = db.prepare('SELECT status FROM embedding_outbox WHERE id = ?').get('o1') as any;
    expect(row.status).toBe('done');

    const embedding = db.prepare('SELECT * FROM chat_embeddings_vec WHERE message_id = ?').get(MSG_ID);
    expect(embedding).toBeTruthy();
  });

  it('un item que falla al generar el embedding queda reintentable, no se pierde ni se marca como completado', async () => {
    vi.mocked(generateEmbedding).mockRejectedValue(new Error('API timeout'));
    EmbeddingOutboxModel.enqueue('o2', MSG_ID, USER_ID, 'texto que falla', 'user');

    const processed = await processEmbeddingOutbox();

    expect(processed).toBe(0);
    const db = getTestDb();
    const row = db.prepare('SELECT status, attempts, error, next_retry_at FROM embedding_outbox WHERE id = ?').get('o2') as any;
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(1);
    expect(row.error).toBe('API timeout');
    expect(row.next_retry_at).toBeTruthy();

    const embedding = db.prepare('SELECT * FROM chat_embeddings_vec WHERE message_id = ?').get(MSG_ID);
    expect(embedding).toBeFalsy();
  });

  it('no se marca como fallo permanente ni se pierde si ocurre un error a mitad de un lote (otros items sí se procesan)', async () => {
    seedMessage('m2');
    vi.mocked(generateEmbedding)
      .mockResolvedValueOnce([0.1, 0.2])
      .mockRejectedValueOnce(new Error('boom'));

    EmbeddingOutboxModel.enqueue('ok1', MSG_ID, USER_ID, 'texto ok', 'user');
    EmbeddingOutboxModel.enqueue('bad1', 'm2', USER_ID, 'texto malo', 'user');

    const processed = await processEmbeddingOutbox();

    expect(processed).toBe(1);
    const db = getTestDb();
    const okRow = db.prepare('SELECT status FROM embedding_outbox WHERE id = ?').get('ok1') as any;
    const badRow = db.prepare('SELECT status FROM embedding_outbox WHERE id = ?').get('bad1') as any;
    expect(okRow.status).toBe('done');
    expect(badRow.status).toBe('pending');
  });

  it('respeta el límite máximo de reintentos: tras agotarlos, el item deja de aparecer como pendiente', async () => {
    vi.mocked(generateEmbedding).mockRejectedValue(new Error('persistent failure'));
    EmbeddingOutboxModel.enqueue('o3', MSG_ID, USER_ID, 'texto que siempre falla', 'user');

    const db = getTestDb();
    // Forzamos next_retry_at a ya-pasado entre corridas para no depender de
    // los backoffs reales (que crecen hasta 1h) — el foco es el límite de
    // intentos, no el cálculo de backoff (ya cubierto a nivel de modelo).
    for (let i = 0; i < 5; i++) {
      await processEmbeddingOutbox();
      db.prepare(`UPDATE embedding_outbox SET next_retry_at = datetime('now', '-1 hour') WHERE id = ?`).run('o3');
    }

    const row = db.prepare('SELECT status, attempts, max_attempts FROM embedding_outbox WHERE id = ?').get('o3') as any;
    expect(row.attempts).toBe(row.max_attempts);
    expect(row.status).toBe('failed');

    // Ya no debe volver a intentarse ni siquiera si se vuelve a invocar.
    const processedAfterExhaustion = await processEmbeddingOutbox();
    expect(processedAfterExhaustion).toBe(0);
    expect(vi.mocked(generateEmbedding)).toHaveBeenCalledTimes(row.max_attempts);
  });

  it('no hace nada si no hay items pendientes', async () => {
    const processed = await processEmbeddingOutbox();
    expect(processed).toBe(0);
    expect(generateEmbedding).not.toHaveBeenCalled();
  });
});

describe('startEmbeddingWorker / stopEmbeddingWorker', () => {
  beforeEach(() => {
    resetDb();
    seedMessage(MSG_ID);
    vi.mocked(generateEmbedding).mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    stopEmbeddingWorker();
    vi.useRealTimers();
  });

  it('sondea el outbox en el intervalo esperado sin esperar tiempo real', async () => {
    vi.mocked(generateEmbedding).mockResolvedValue([0.1]);
    EmbeddingOutboxModel.enqueue('poll1', MSG_ID, USER_ID, 'texto', 'user');

    startEmbeddingWorker();
    expect(generateEmbedding).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(generateEmbedding).toHaveBeenCalledTimes(1);
  });

  it('startEmbeddingWorker es idempotente: llamarlo dos veces no duplica el intervalo', async () => {
    vi.mocked(generateEmbedding).mockResolvedValue([0.1]);
    EmbeddingOutboxModel.enqueue('poll2', MSG_ID, USER_ID, 'texto', 'user');

    startEmbeddingWorker();
    startEmbeddingWorker();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(generateEmbedding).toHaveBeenCalledTimes(1);
  });

  it('stopEmbeddingWorker detiene el sondeo', async () => {
    vi.mocked(generateEmbedding).mockResolvedValue([0.1]);
    EmbeddingOutboxModel.enqueue('poll3', MSG_ID, USER_ID, 'texto', 'user');

    startEmbeddingWorker();
    stopEmbeddingWorker();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(generateEmbedding).not.toHaveBeenCalled();
  });
});
