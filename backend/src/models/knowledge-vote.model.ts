import { randomUUID } from 'node:crypto';
import { getDb } from '../db/connection.js';

export const knowledgeVoteModel = {
  vote(knowledgeId: string, userId: string, voteType: 1 | -1): boolean {
    const db = getDb();
    const existing = db.prepare(
      'SELECT id, vote_type FROM knowledge_votes WHERE knowledge_id = ? AND user_id = ?'
    ).get(knowledgeId, userId) as { id: string; vote_type: number } | null;

    if (existing) {
      if (existing.vote_type === voteType) {
        db.prepare('DELETE FROM knowledge_votes WHERE id = ?').run(existing.id);
      } else {
        db.prepare('UPDATE knowledge_votes SET vote_type = ? WHERE id = ?').run(voteType, existing.id);
      }
    } else {
      const id = randomUUID();
      db.prepare(
        'INSERT INTO knowledge_votes (id, knowledge_id, user_id, vote_type) VALUES (?, ?, ?, ?)'
      ).run(id, knowledgeId, userId, voteType);
    }
    return true;
  },

  getUserVote(knowledgeId: string, userId: string): number | null {
    const row = getDb().prepare(
      'SELECT vote_type FROM knowledge_votes WHERE knowledge_id = ? AND user_id = ?'
    ).get(knowledgeId, userId) as { vote_type: number } | null;
    return row ? row.vote_type : null;
  },

  countByKnowledge(knowledgeId: string): { upvotes: number; downvotes: number } {
    const upvotes = getDb().prepare(
      'SELECT COUNT(*) as count FROM knowledge_votes WHERE knowledge_id = ? AND vote_type = 1'
    ).get(knowledgeId) as { count: number };
    const downvotes = getDb().prepare(
      'SELECT COUNT(*) as count FROM knowledge_votes WHERE knowledge_id = ? AND vote_type = -1'
    ).get(knowledgeId) as { count: number };
    return { upvotes: upvotes.count, downvotes: downvotes.count };
  },
};
