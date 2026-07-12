import { getDb } from '../db/connection.js';

export const knowledgeContributionModel = {
  record(data: {
    userId: string;
    knowledgeId: string;
    contributionType: string;
    points: number;
  }): void {
    const id = crypto.randomUUID();
    getDb().prepare(`
      INSERT INTO knowledge_contributions (id, user_id, knowledge_id, contribution_type, points)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, data.userId, data.knowledgeId, data.contributionType, data.points);
  },

  getPointsForUser(userId: string): number {
    const row = getDb().prepare(
      'SELECT COALESCE(SUM(points), 0) as total FROM knowledge_contributions WHERE user_id = ?'
    ).get(userId) as { total: number };
    return row.total;
  },

  getRecentForUser(userId: string, limit = 20): any[] {
    return getDb().prepare(
      `SELECT kc.*, kb.summary, kb.subject FROM knowledge_contributions kc
       JOIN knowledge_base kb ON kb.id = kc.knowledge_id
       WHERE kc.user_id = ? ORDER BY kc.created_at DESC LIMIT ?`
    ).all(userId, limit) as any[];
  },
};
