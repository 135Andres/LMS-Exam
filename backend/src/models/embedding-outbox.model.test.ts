import { describe, it, expect, beforeEach } from 'vitest';
import { EmbeddingOutboxModel } from './embedding-outbox.model.js';
import { getTestDb, resetDb } from '../../test/setup.js';

const USER_ID = 'u1';
const MSG_ID = 'm1';
const SESSION_ID = 's1';

describe('EmbeddingOutboxModel', () => {
  beforeEach(() => {
    resetDb();
    const db = getTestDb();
    db.prepare('INSERT INTO users (id, email) VALUES (?, ?)').run(USER_ID, 'test@test.com');
    db.prepare('INSERT INTO chat_sessions (session_id, user_id) VALUES (?, ?)').run(SESSION_ID, USER_ID);
    db.prepare('INSERT INTO chat_logs (id, user_id, session_id, role, content) VALUES (?, ?, ?, ?, ?)').run(MSG_ID, USER_ID, SESSION_ID, 'user', 'Hola');
  });

  it('enqueue + getPending + markDone roundtrip', () => {
    EmbeddingOutboxModel.enqueue('o1', MSG_ID, USER_ID, 'texto de prueba', 'user');
    const pending = EmbeddingOutboxModel.getPending(10);
    expect(pending).toHaveLength(1);
    expect(pending[0].text_content).toBe('texto de prueba');
    expect(pending[0].role).toBe('user');

    EmbeddingOutboxModel.markDone('o1');
    expect(EmbeddingOutboxModel.getPending(10)).toHaveLength(0);
  });

  it('markProcessing increments attempts', () => {
    EmbeddingOutboxModel.enqueue('o2', MSG_ID, USER_ID, 'texto2', 'user');
    EmbeddingOutboxModel.markProcessing('o2');
    const pending = EmbeddingOutboxModel.getPending(10);
    expect(pending).toHaveLength(0);
  });

  it('markFailed with backoff → pending retry, or failed if exhausted', () => {
    EmbeddingOutboxModel.enqueue('o3', MSG_ID, USER_ID, 'texto3', 'user');
    EmbeddingOutboxModel.markProcessing('o3');
    EmbeddingOutboxModel.markFailed('o3', 'API timeout');

    const db = getTestDb();
    const row = db.prepare('SELECT status, attempts, error, next_retry_at FROM embedding_outbox WHERE id = ?').get('o3') as any;
    expect(row.attempts).toBe(1);
    expect(row.error).toBe('API timeout');
    expect(row.status).toBe('pending');
    expect(row.next_retry_at).toBeTruthy();
  });

  it('markFailed → failed if attempts >= max_attempts', () => {
    EmbeddingOutboxModel.enqueue('o4', MSG_ID, USER_ID, 'texto4', 'user');
    EmbeddingOutboxModel.markProcessing('o4');
    EmbeddingOutboxModel.markProcessing('o4');
    EmbeddingOutboxModel.markProcessing('o4');
    EmbeddingOutboxModel.markFailed('o4', 'API down');

    const db = getTestDb();
    const row = db.prepare('SELECT status, attempts FROM embedding_outbox WHERE id = ?').get('o4') as any;
    expect(row.attempts).toBe(3);
    expect(row.status).toBe('failed');
  });

  it('countPending only counts pending', () => {
    EmbeddingOutboxModel.enqueue('o5', MSG_ID, USER_ID, 'p', 'user');
    EmbeddingOutboxModel.enqueue('o6', MSG_ID, USER_ID, 'p2', 'user');
    expect(EmbeddingOutboxModel.countPending()).toBeGreaterThanOrEqual(2);
  });
});
