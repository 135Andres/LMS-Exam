import { getDb } from '../db/connection.js';
import { logger } from '../utils/logger.js';
import crypto from 'crypto';

export interface KnowledgeBaseItem {
  id: string;
  content: string;
  summary: string | null;
  subject: string;
  topic: string | null;
  difficulty: string;
  source_type: string;
  source_user_id: string | null;
  is_verified: boolean;
  verified_by: string | null;
  verified_at: string | null;
  upvotes: number;
  downvotes: number;
  view_count: number;
  tags: string[];
  language: string;
  content_hash: string;
  status: string;
  created_at: string;
  updated_at: string;
}

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function rowToItem(row: any): KnowledgeBaseItem {
  return {
    ...row,
    is_verified: !!row.is_verified,
    tags: typeof row.tags === 'string' ? JSON.parse(row.tags || '[]') : row.tags || [],
  };
}

export const KnowledgeModel = {
  create(data: {
    id: string;
    content: string;
    summary?: string;
    subject: string;
    topic?: string;
    source_type?: string;
    source_user_id?: string | null;
    tags?: string[];
    status?: string;
  }): KnowledgeBaseItem {
    const db = getDb();
    const contentHash = hashContent(data.content);
    const summary = data.summary || data.content.slice(0, 180) + '...';
    const tags = JSON.stringify(data.tags || []);
    const status = data.status || 'pending_review';

    db.prepare(`
      INSERT INTO knowledge_base (id, content, summary, subject, topic, source_type, source_user_id, tags, content_hash, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.id, data.content, summary, data.subject, data.topic || null,
      data.source_type || 'user_qa', data.source_user_id || null,
      tags, contentHash, status
    );

    return this.getById(data.id)!;
  },

  getById(id: string): KnowledgeBaseItem | null {
    const row = getDb().prepare('SELECT * FROM knowledge_base WHERE id = ?').get(id) as any;
    return row ? rowToItem(row) : null;
  },

  getDraftsByUser(userId: string): KnowledgeBaseItem[] {
    const rows = getDb().prepare(
      'SELECT * FROM knowledge_base WHERE source_user_id = ? AND status = ? ORDER BY created_at DESC'
    ).all(userId, 'draft') as any[];
    return rows.map(rowToItem);
  },

  getPendingReview(limit = 50, offset = 0): KnowledgeBaseItem[] {
    const rows = getDb().prepare(
      'SELECT * FROM knowledge_base WHERE status = ? ORDER BY created_at ASC LIMIT ? OFFSET ?'
    ).all('pending_review', limit, offset) as any[];
    return rows.map(rowToItem);
  },

  getPublished(limit = 20, offset = 0, subject?: string): KnowledgeBaseItem[] {
    let sql = 'SELECT * FROM knowledge_base WHERE status = ? AND is_verified = 1';
    const params: any[] = ['published'];
    if (subject) {
      sql += ' AND subject = ?';
      params.push(subject);
    }
    sql += ' ORDER BY (upvotes - downvotes) DESC, view_count DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    const rows = getDb().prepare(sql).all(...params) as any[];
    return rows.map(rowToItem);
  },

  search(opts: {
    query?: string;
    subject?: string;
    topic?: string;
    verified_only?: boolean;
    limit?: number;
    offset?: number;
  }): KnowledgeBaseItem[] {
    let sql = 'SELECT * FROM knowledge_base WHERE status = ?';
    const params: any[] = ['published'];
    if (opts.verified_only) sql += ' AND is_verified = 1';
    if (opts.subject) { sql += ' AND subject = ?'; params.push(opts.subject); }
    if (opts.topic) { sql += ' AND topic = ?'; params.push(opts.topic); }
    if (opts.query) {
      sql += ' AND (content LIKE ? OR summary LIKE ?)';
      params.push(`%${opts.query}%`, `%${opts.query}%`);
    }
    sql += ' ORDER BY (upvotes - downvotes) DESC LIMIT ? OFFSET ?';
    params.push(opts.limit || 20, opts.offset || 0);
    const rows = getDb().prepare(sql).all(...params) as any[];
    return rows.map(rowToItem);
  },

  publish(id: string, tags?: string[]): void {
    const item = this.getById(id);
    if (!item) return;
    const finalTags = tags ? JSON.stringify([...new Set([...item.tags, ...tags])]) : JSON.stringify(item.tags);
    getDb().prepare(`
      UPDATE knowledge_base SET status = 'published', tags = ?, updated_at = datetime('now') WHERE id = ?
    `).run(finalTags, id);
  },

  verify(id: string, adminId: string): void {
    getDb().prepare(`
      UPDATE knowledge_base SET is_verified = 1, verified_by = ?, verified_at = datetime('now'),
      status = 'published', updated_at = datetime('now') WHERE id = ?
    `).run(adminId, id);
  },

  reject(id: string): void {
    getDb().prepare(`UPDATE knowledge_base SET status = 'rejected', updated_at = datetime('now') WHERE id = ?`).run(id);
  },

  deleteDraft(id: string, userId: string): boolean {
    const result = getDb().prepare(
      "DELETE FROM knowledge_base WHERE id = ? AND source_user_id = ? AND status = 'draft'"
    ).run(id, userId);
    return result.changes > 0;
  },

  deleteById(id: string): boolean {
    const result = getDb().prepare('DELETE FROM knowledge_base WHERE id = ?').run(id);
    return result.changes > 0;
  },

  incrementView(id: string): void {
    getDb().prepare('UPDATE knowledge_base SET view_count = view_count + 1 WHERE id = ?').run(id);
  },

  existsByHash(hash: string): boolean {
    const row = getDb().prepare('SELECT 1 FROM knowledge_base WHERE content_hash = ? LIMIT 1').get(hash);
    return !!row;
  },

  countByUser(userId: string): number {
    const row = getDb().prepare(
      "SELECT COUNT(*) as count FROM knowledge_base WHERE source_user_id = ? AND status != 'rejected'"
    ).get(userId) as { count: number };
    return row.count;
  },
};
