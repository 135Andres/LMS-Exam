import { getDb } from '../db/connection.js';

export const EmbeddingOutboxModel = {
  enqueue(id: string, messageId: string, userId: string, textContent: string, role: 'user' | 'assistant' = 'user'): void {
    getDb().prepare(
      `INSERT INTO embedding_outbox (id, message_id, user_id, text_content, role) VALUES (?, ?, ?, ?, ?)`
    ).run(id, messageId, userId, textContent, role);
  },

  getPending(limit = 10): Array<{
    id: string; message_id: string; user_id: string; text_content: string; role: string; attempts: number;
  }> {
    const now = new Date().toISOString();
    return getDb().prepare(
      `SELECT id, message_id, user_id, text_content, role, attempts
       FROM embedding_outbox
       WHERE status = 'pending' AND attempts < max_attempts
         AND (next_retry_at IS NULL OR next_retry_at <= ?)
       ORDER BY created_at ASC LIMIT ?`
    ).all(now, limit) as any[];
  },

  markProcessing(id: string): void {
    getDb().prepare(
      `UPDATE embedding_outbox SET status = 'processing', attempts = attempts + 1 WHERE id = ?`
    ).run(id);
  },

  markDone(id: string): void {
    getDb().prepare(
      `UPDATE embedding_outbox SET status = 'done', processed_at = datetime('now') WHERE id = ?`
    ).run(id);
  },

  markFailed(id: string, error: string): void {
    const backoff = Math.min(60 * Math.pow(2, 1), 3600);
    const nextRetry = new Date(Date.now() + backoff * 1000).toISOString();
    getDb().prepare(
      `UPDATE embedding_outbox SET status = 'failed', error = ?, next_retry_at = ? WHERE id = ?`
    ).run(error.substring(0, 500), nextRetry, id);
  },

  countPending(): number {
    return (getDb().prepare(`SELECT COUNT(*) as c FROM embedding_outbox WHERE status = 'pending'`).get() as any).c;
  },
};