import { getDb } from '../db/connection.js';
import type { ExamRow, PolishMessageRow } from '../types/db.js';

interface CreateExamParams {
  id: string;
  userId: string;
  name: string;
  numQuestions: number;
  subject: string;
  subtopics: string[];
}

export const ExamModel = {
  findById(id: string): ExamRow | undefined {
    return getDb().prepare('SELECT * FROM exams WHERE id = ?').get(id) as ExamRow | undefined;
  },

  findByUser(userId: string): ExamRow[] {
    return getDb().prepare(
      `SELECT id, user_id, name, num_questions, status, score, ai_cost, created_at, completed_at,
       is_draft, is_published, subject, subtopics
       FROM exams WHERE user_id = ? ORDER BY created_at DESC`,
    ).all(userId) as ExamRow[];
  },

  findPublished(limit = 50, offset = 0): ExamRow[] {
    return getDb().prepare(
      `SELECT e.id, e.user_id, e.name, e.num_questions, e.status, e.score, e.ai_cost, e.created_at, e.completed_at,
       e.is_draft, e.is_published, e.subject, e.subtopics, u.username
       FROM exams e JOIN users u ON e.user_id = u.id
       WHERE e.is_published = 1
       ORDER BY e.created_at DESC LIMIT ? OFFSET ?`,
    ).all(limit, offset) as ExamRow[];
  },

  findAll(): ExamRow[] {
    return getDb().prepare(
      'SELECT e.*, u.username FROM exams e JOIN users u ON e.user_id = u.id ORDER BY e.created_at DESC',
    ).all() as ExamRow[];
  },

  create({ id, userId, name, numQuestions, subject, subtopics }: CreateExamParams): ExamRow | undefined {
    const stmt = getDb().prepare(
      `INSERT INTO exams (id, user_id, name, num_questions, status, subject, subtopics, is_draft)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, 1)`,
    );
    stmt.run(id, userId, name, numQuestions, subject, JSON.stringify(subtopics));
    return this.findById(id);
  },

  updateStatus(id: string, status: string): void {
    getDb().prepare('UPDATE exams SET status = ? WHERE id = ?').run(status, id);
  },

  markReady(id: string, data: unknown, aiProvider: string, aiCost: number): void {
    getDb().prepare(
      `UPDATE exams SET status = 'ready', data = ?, ai_provider = ?, ai_cost = ?, completed_at = datetime('now') WHERE id = ?`,
    ).run(JSON.stringify(data), aiProvider, aiCost, id);
  },

  markCompleted(id: string, score: number): void {
    getDb().prepare(
      "UPDATE exams SET status = 'completed', score = ?, completed_at = datetime('now') WHERE id = ?",
    ).run(score, id);
  },

  updateScore(id: string, score: number): void {
    getDb().prepare('UPDATE exams SET score = ? WHERE id = ?').run(score, id);
  },

  updateQuestions(id: string, data: unknown): void {
    getDb().prepare('UPDATE exams SET data = ? WHERE id = ?').run(JSON.stringify(data), id);
  },

  setDraft(id: string, isDraft: number): void {
    getDb().prepare('UPDATE exams SET is_draft = ? WHERE id = ?').run(isDraft, id);
  },

  setPublished(id: string, isPublished: number): void {
    getDb().prepare('UPDATE exams SET is_published = ? WHERE id = ?').run(isPublished, id);
  },

  delete(id: string): void {
    getDb().prepare('DELETE FROM exams WHERE id = ?').run(id);
  },

  // --- Polish messages ---

  savePolishMessage(msg: Omit<PolishMessageRow, 'created_at'>): void {
    getDb().prepare(
      'INSERT INTO polish_messages (id, exam_id, user_id, question_index, role, content) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(msg.id, msg.exam_id, msg.user_id, msg.question_index, msg.role, msg.content);
  },

  getPolishMessages(examId: string, questionIndex: number): PolishMessageRow[] {
    return getDb().prepare(
      'SELECT * FROM polish_messages WHERE exam_id = ? AND question_index = ? ORDER BY created_at ASC',
    ).all(examId, questionIndex) as PolishMessageRow[];
  },

};
