import { getDb } from '../db/connection.js';
import type { ChatEmbeddingRow } from '../types/db.js';

export const EmbeddingModel = {
  saveEmbedding(id: string, messageId: string, userId: string, vector: number[], model: string, dimensions: number): void {
    getDb().prepare(
      'INSERT INTO chat_embeddings (id, message_id, user_id, vector_text, model, dimensions) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, messageId, userId, JSON.stringify(vector), model, dimensions);
  },

  getUserEmbeddings(userId: string, limit = 100): Array<{ vector: number[]; content: string; messageId: string }> {
    const rows = getDb().prepare(
      `SELECT e.vector_text, c.content, e.message_id
       FROM chat_embeddings e
       JOIN chat_logs c ON c.id = e.message_id
       WHERE e.user_id = ?
       ORDER BY c.created_at DESC
       LIMIT ?`
    ).all(userId, limit) as Array<{ vector_text: string; content: string; message_id: string }>;

    return rows.map(r => ({
      vector: JSON.parse(r.vector_text) as number[],
      content: r.content,
      messageId: r.message_id,
    }));
  },

  countByUser(userId: string): number {
    const row = getDb().prepare(
      'SELECT COUNT(*) as count FROM chat_embeddings WHERE user_id = ?'
    ).get(userId) as { count: number };
    return row.count;
  },
};
