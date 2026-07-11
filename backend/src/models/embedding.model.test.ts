import { describe, it, expect, beforeEach } from 'vitest';
import { EmbeddingModel } from './embedding.model.js';
import { getTestDb, resetDb } from '../../test/setup.js';

const USER_ID = 'u1';
const MSG_ID = 'm1';
const SESSION_ID = 's1';

describe('EmbeddingModel', () => {
  beforeEach(() => {
    resetDb();
    const db = getTestDb();
    db.prepare('INSERT INTO users (id, email) VALUES (?, ?)').run(USER_ID, 'test@test.com');
    db.prepare('INSERT INTO chat_sessions (session_id, user_id) VALUES (?, ?)').run(SESSION_ID, USER_ID);
    db.prepare('INSERT INTO chat_logs (id, user_id, session_id, role, content) VALUES (?, ?, ?, ?, ?)').run(MSG_ID, USER_ID, SESSION_ID, 'user', 'Hola');
  });

  it('saveEmbedding + getUserEmbeddings roundtrip', () => {
    const vec = new Array(128).fill(0).map((_, i) => i / 128);
    EmbeddingModel.saveEmbedding('e1', MSG_ID, USER_ID, vec, 'test-model', 128);

    const results = EmbeddingModel.getUserEmbeddings(USER_ID, 100);
    expect(results).toHaveLength(1);
    expect(results[0].vector).toHaveLength(128);
    expect(results[0].vector[0]).toBeCloseTo(0);
    expect(results[0].messageId).toBe(MSG_ID);
    expect(results[0].content).toBe('Hola');
    expect(results[0].role).toBe('user');
  });

  it('returns empty for unknown user', () => {
    expect(EmbeddingModel.getUserEmbeddings('no-existe', 100)).toHaveLength(0);
  });

  it('countByUser returns count', () => {
    const db = getTestDb();
    db.prepare('INSERT INTO chat_logs (id, user_id, session_id, role, content) VALUES (?, ?, ?, ?, ?)').run('m2', USER_ID, SESSION_ID, 'assistant', '¡Hola!');
    const vec = new Array(128).fill(0.5);
    EmbeddingModel.saveEmbedding('e1', MSG_ID, USER_ID, vec, 'test-model', 128);
    EmbeddingModel.saveEmbedding('e2', 'm2', USER_ID, vec, 'test-model', 128);
    expect(EmbeddingModel.countByUser(USER_ID)).toBe(2);
  });
});
