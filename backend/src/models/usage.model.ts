import { getDb } from '../db/connection.js';
import type { UsageRow, UsageTotals, AllUsageTotals } from '../types/db.js';

interface CreateUsageParams {
  id: string;
  userId: string;
  examId: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  cost: number;
}

export const UsageModel = {
  create({ id, userId, examId, provider, model, promptTokens, completionTokens, cost }: CreateUsageParams): void {
    const stmt = getDb().prepare(
      'INSERT INTO api_usage (id, user_id, exam_id, provider, model, prompt_tokens, completion_tokens, cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    stmt.run(id, userId, examId, provider, model, promptTokens, completionTokens, cost);
  },

  getTotals(userId: string): UsageTotals | undefined {
    return getDb().prepare(
      'SELECT COUNT(*) as count, COALESCE(SUM(cost), 0) as totalCost FROM api_usage WHERE user_id = ?',
    ).get(userId) as UsageTotals | undefined;
  },

  getAllTotals(): AllUsageTotals | undefined {
    return getDb().prepare(
      'SELECT COALESCE(SUM(cost), 0) as totalCost, COUNT(*) as totalRequests FROM api_usage',
    ).get() as AllUsageTotals | undefined;
  },

  getRecent(limit = 50): UsageRow[] {
    return getDb().prepare(
      'SELECT u.*, us.username FROM api_usage u JOIN users us ON u.user_id = us.id ORDER BY u.created_at DESC LIMIT ?',
    ).all(limit) as UsageRow[];
  },
};
