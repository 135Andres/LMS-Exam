import { getDb } from '../db/connection.js';

function vectorToBlob(vector: number[]): Buffer {
  return Buffer.from(new Float32Array(vector).buffer);
}

function blobToVector(buf: Buffer): number[] {
  return Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4));
}

export const EmbeddingModel = {
  saveEmbedding(id: string, messageId: string, userId: string, vector: number[], model: string, dimensions: number): void {
    const db = getDb();
    const blob = vectorToBlob(vector);

    db.transaction(() => {
      db.prepare(
        'INSERT OR IGNORE INTO chat_embeddings (id, message_id, user_id, vector_text, model, dimensions) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(id, messageId, userId, JSON.stringify(vector), model, dimensions);

      db.prepare(
        'INSERT OR IGNORE INTO chat_embeddings_vec (id, message_id, user_id, embedding, model, dimensions) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(id, messageId, userId, blob, model, dimensions);
    })();
  },

  getUserEmbeddings(userId: string, limit = 100): Array<{ vector: number[]; content: string; messageId: string; role: string }> {
    const db = getDb();

    const vecRows = db.prepare(
      `SELECT e.id, e.embedding, c.content, e.message_id, c.role
       FROM chat_embeddings_vec e
       JOIN chat_logs c ON c.id = e.message_id
       WHERE e.user_id = ?
       ORDER BY c.created_at DESC
       LIMIT ?`
    ).all(userId, limit) as Array<{ id: string; embedding: Buffer; content: string; message_id: string; role: string }>;

    if (vecRows.length > 0) {
      return vecRows.map(r => ({
        vector: blobToVector(r.embedding),
        content: r.content,
        messageId: r.message_id,
        role: r.role,
      }));
    }

    const jsonRows = db.prepare(
      `SELECT e.vector_text, c.content, e.message_id, c.role
       FROM chat_embeddings e
       JOIN chat_logs c ON c.id = e.message_id
       WHERE e.user_id = ?
       ORDER BY c.created_at DESC
       LIMIT ?`
    ).all(userId, limit) as Array<{ vector_text: string; content: string; message_id: string; role: string }>;

    return jsonRows.map(r => ({
      vector: JSON.parse(r.vector_text) as number[],
      content: r.content,
      messageId: r.message_id,
      role: r.role,
    }));
  },

  countByUser(userId: string): number {
    const db = getDb();
    const vecCount = db.prepare(
      'SELECT COUNT(*) as count FROM chat_embeddings_vec WHERE user_id = ?'
    ).get(userId) as { count: number };
    if (vecCount.count > 0) return vecCount.count;

    const row = db.prepare(
      'SELECT COUNT(*) as count FROM chat_embeddings WHERE user_id = ?'
    ).get(userId) as { count: number };
    return row.count;
  },
};
