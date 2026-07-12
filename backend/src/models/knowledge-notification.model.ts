import { randomUUID } from 'node:crypto';
import { getDb } from '../db/connection.js';

export const knowledgeNotificationModel = {
  queue(data: { userId: string; type: string; knowledgeId?: string; data?: any }): void {
    const id = randomUUID();
    getDb().prepare(`
      INSERT INTO knowledge_notifications (id, user_id, type, knowledge_id, data)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, data.userId, data.type, data.knowledgeId || null, data.data ? JSON.stringify(data.data) : null);
  },

  getUnread(userId: string): any[] {
    return getDb().prepare(
      'SELECT * FROM knowledge_notifications WHERE user_id = ? AND read = 0 ORDER BY created_at DESC'
    ).all(userId) as any[];
  },

  markRead(id: string, userId: string): void {
    getDb().prepare('UPDATE knowledge_notifications SET read = 1 WHERE id = ? AND user_id = ?').run(id, userId);
  },

  markAllRead(userId: string): void {
    getDb().prepare('UPDATE knowledge_notifications SET read = 1 WHERE user_id = ?').run(userId);
  },
};
