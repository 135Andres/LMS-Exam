import { getDb } from '../db/connection.js';

export interface UserKBStats {
  user_id: string;
  total_points: number;
  level: number;
  contributions_count: number;
  verified_count: number;
  total_upvotes_received: number;
  total_views: number;
  reports_valid: number;
  edits_accepted: number;
  badges: string[];
  updated_at: string;
}

function rowToStats(row: any): UserKBStats {
  return {
    ...row,
    badges: typeof row.badges === 'string' ? JSON.parse(row.badges || '[]') : row.badges || [],
  };
}

export const userKbStatsModel = {
  getForUser(userId: string): UserKBStats {
    const existing = getDb().prepare('SELECT * FROM user_kb_stats WHERE user_id = ?').get(userId) as any;
    if (existing) return rowToStats(existing);

    getDb().prepare(`
      INSERT INTO user_kb_stats (user_id) VALUES (?)
      ON CONFLICT(user_id) DO NOTHING
    `).run(userId);

    const row = getDb().prepare('SELECT * FROM user_kb_stats WHERE user_id = ?').get(userId) as any;
    return rowToStats(row);
  },

  addBadge(userId: string, badgeId: string): void {
    const stats = this.getForUser(userId);
    if (stats.badges.includes(badgeId)) return;
    const badges = [...stats.badges, badgeId];
    getDb().prepare('UPDATE user_kb_stats SET badges = ?, updated_at = datetime(\'now\') WHERE user_id = ?')
      .run(JSON.stringify(badges), userId);
  },

  incrementUpvotesReceived(userId: string): void {
    getDb().prepare(`
      UPDATE user_kb_stats SET total_upvotes_received = total_upvotes_received + 1, updated_at = datetime('now')
      WHERE user_id = ?
    `).run(userId);
  },

  incrementViews(userId: string): void {
    getDb().prepare(`
      UPDATE user_kb_stats SET total_views = total_views + 1, updated_at = datetime('now')
      WHERE user_id = ?
    `).run(userId);
  },

  getLeaderboard(limit = 20): UserKBStats[] {
    const rows = getDb().prepare(`
      SELECT uks.*, u.username FROM user_kb_stats uks
      JOIN users u ON u.id = uks.user_id
      WHERE uks.total_points > 0
      ORDER BY uks.total_points DESC LIMIT ?
    `).all(limit) as any[];
    return rows.map(row => ({ ...rowToStats(row), username: row.username }));
  },
};
