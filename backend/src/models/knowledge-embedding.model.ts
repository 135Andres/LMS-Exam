import { getDb } from '../db/connection.js';
import { findTopK } from '../utils/vector.js';

interface SearchOptions {
  subject?: string;
  minScore: number;
  limit: number;
  verifiedOnly: boolean;
}

interface SearchResult {
  id: string;
  knowledge_id: string;
  content: string;
  summary: string;
  subject: string;
  topic: string;
  upvotes: number;
  downvotes: number;
  created_at: string;
  score: number;
}

export const KnowledgeEmbeddingModel = {
  save(id: string, knowledgeId: string, vector: Float32Array, model: string, dimensions: number): void {
    const buffer = Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
    getDb().prepare(`
      INSERT INTO knowledge_embeddings (id, knowledge_id, embedding, model, dimensions)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, knowledgeId, buffer, model, dimensions);
  },

  searchSimilar(queryVector: number[], opts: SearchOptions): SearchResult[] {
    const db = getDb();
    let sql = `
      SELECT ke.id, ke.knowledge_id, ke.embedding, kb.content, kb.summary, kb.subject, kb.topic,
             kb.upvotes, kb.downvotes, kb.created_at
      FROM knowledge_embeddings ke
      JOIN knowledge_base kb ON kb.id = ke.knowledge_id
      WHERE kb.is_verified = ?
    `;
    const params: any[] = [opts.verifiedOnly ? 1 : 0];

    if (opts.subject) {
      sql += ' AND kb.subject = ?';
      params.push(opts.subject);
    }
    sql += ' AND kb.status = ?';
    params.push('published');

    sql += ' LIMIT 200';
    const rows = db.prepare(sql).all(...params) as any[];

    const items = rows.map(row => {
      const vector = new Float32Array(row.embedding.buffer || row.embedding);
      const vec = Array.from(vector);
      return {
        id: row.id,
        knowledge_id: row.knowledge_id,
        content: row.content,
        summary: row.summary,
        subject: row.subject,
        topic: row.topic,
        upvotes: row.upvotes,
        downvotes: row.downvotes,
        created_at: row.created_at,
        vector: vec,
      };
    });

    const topK = findTopK(queryVector, items as any, opts.limit) as any;

    return topK
      .filter((item: any) => item.score >= opts.minScore)
      .map((item: any) => ({
        id: item.id,
        knowledge_id: item.knowledge_id,
        content: item.content,
        summary: item.summary,
        subject: item.subject,
        topic: item.topic,
        upvotes: item.upvotes,
        downvotes: item.downvotes,
        created_at: item.created_at,
        score: item.score,
      }));
  },

  deleteByKnowledgeId(knowledgeId: string): void {
    getDb().prepare('DELETE FROM knowledge_embeddings WHERE knowledge_id = ?').run(knowledgeId);
  },

  count(): number {
    const row = getDb().prepare('SELECT COUNT(*) as count FROM knowledge_embeddings').get() as { count: number };
    return row.count;
  },
};
