import { getDb } from '../db/connection.js';
import type { ChatLogRow } from '../types/db.js';

export const ChatModel = {
  ensureSession(sessionId: string, userId: string): void {
    getDb().prepare(
      'INSERT OR IGNORE INTO chat_sessions (session_id, user_id) VALUES (?, ?)'
    ).run(sessionId, userId);
  },

  saveMessage(id: string, userId: string, sessionId: string, role: 'user' | 'assistant' | 'system', content: string, tokens = 0, model: string | null = null): void {
    this.ensureSession(sessionId, userId);
    getDb().prepare(
      'INSERT INTO chat_logs (id, user_id, session_id, role, content, tokens, model) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, userId, sessionId, role, content, tokens, model);
  },

  // Mensajes desde el último corte de resumen (cursor = created_at del último
  // mensaje ya incluido en el resumen, o null si nunca se ha compactado esta sesión).
  getMessagesSince(sessionId: string, sinceCreatedAt: string | null): ChatLogRow[] {
    if (!sinceCreatedAt) return this.getSessionMessages(sessionId, 1000);
    return getDb().prepare(
      'SELECT * FROM chat_logs WHERE session_id = ? AND created_at > ? ORDER BY created_at ASC'
    ).all(sessionId, sinceCreatedAt) as ChatLogRow[];
  },

  getSummaryCursor(sessionId: string): string | null {
    const row = getDb().prepare(
      'SELECT summary_covers_until FROM chat_sessions WHERE session_id = ?'
    ).get(sessionId) as { summary_covers_until: string | null } | undefined;
    return row?.summary_covers_until || null;
  },

  setSummaryCursor(sessionId: string, coversUntil: string): void {
    getDb().prepare(
      'UPDATE chat_sessions SET summary_covers_until = ? WHERE session_id = ?'
    ).run(coversUntil, sessionId);
  },

  getLastAssistantModel(sessionId: string): string | null {
    const row = getDb().prepare(
      "SELECT model FROM chat_logs WHERE session_id = ? AND role = 'assistant' ORDER BY created_at DESC LIMIT 1"
    ).get(sessionId) as { model: string | null } | undefined;
    return row?.model || null;
  },

  getSessionMessages(sessionId: string, limit = 50): ChatLogRow[] {
    return getDb().prepare(
      'SELECT * FROM chat_logs WHERE session_id = ? ORDER BY created_at ASC LIMIT ?'
    ).all(sessionId, limit) as ChatLogRow[];
  },

  getLastSessionId(userId: string): string | null {
    const row = getDb().prepare(
      'SELECT session_id FROM chat_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(userId) as { session_id: string } | undefined;
    return row?.session_id || null;
  },

  getUserSessions(userId: string, archived = false): { session_id: string; created_at: string; updated_at: string; message_count: number; preview: string; title: string | null }[] {
    const archivedFilter = archived
      ? 'AND (cs.is_archived = 1)'
      : 'AND (cs.is_archived IS NULL OR cs.is_archived = 0)';
    return getDb().prepare(`
      SELECT
        c.session_id,
        MIN(c.created_at) as created_at,
        MAX(c.created_at) as updated_at,
        COUNT(*) as message_count,
        (SELECT content FROM chat_logs WHERE session_id = c.session_id AND role = 'user' ORDER BY created_at ASC LIMIT 1) as preview,
        cs.title as title
      FROM chat_logs c
      LEFT JOIN chat_sessions cs ON c.session_id = cs.session_id
      WHERE c.user_id = ? ${archivedFilter}
      GROUP BY c.session_id
      ORDER BY MAX(c.created_at) DESC
      LIMIT 50
    `).all(userId) as any[];
  },

  renameSession(sessionId: string, userId: string, title: string): void {
    this.ensureSession(sessionId, userId);
    getDb().prepare(
      'UPDATE chat_sessions SET title = ? WHERE session_id = ? AND user_id = ?'
    ).run(title, sessionId, userId);
  },

  getRecentMessages(userId: string, limit = 50): ChatLogRow[] {
    return getDb().prepare(
      'SELECT * FROM chat_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(userId, limit) as ChatLogRow[];
  },

  archiveSession(sessionId: string, userId: string): void {
    this.ensureSession(sessionId, userId);
    getDb().prepare(
      "UPDATE chat_sessions SET is_archived = 1, archived_at = datetime('now') WHERE session_id = ? AND user_id = ?"
    ).run(sessionId, userId);
  },

  unarchiveSession(sessionId: string, userId: string): void {
    this.ensureSession(sessionId, userId);
    getDb().prepare(
      "UPDATE chat_sessions SET is_archived = 0, archived_at = NULL WHERE session_id = ? AND user_id = ?"
    ).run(sessionId, userId);
  },

  deleteSession(sessionId: string, userId: string): void {
    getDb().prepare('DELETE FROM chat_logs WHERE session_id = ? AND user_id = ?').run(sessionId, userId);
    getDb().prepare('DELETE FROM chat_sessions WHERE session_id = ? AND user_id = ?').run(sessionId, userId);
  },

  assertSessionOwnership(sessionId: string, userId: string): void {
    const session = getDb().prepare(
      'SELECT user_id FROM chat_sessions WHERE session_id = ?'
    ).get(sessionId) as { user_id: string } | undefined;
    if (!session) return;
    if (session.user_id !== userId) {
      throw new Error('SESSION_OWNERSHIP_VIOLATION');
    }
  },

  deleteMessage(id: string, userId: string): void {
    getDb().prepare('DELETE FROM chat_logs WHERE id = ? AND user_id = ?').run(id, userId);
  },

  pinMessage(id: string, userId: string): void {
    getDb().prepare('UPDATE chat_logs SET is_pinned = 1 WHERE id = ? AND user_id = ?').run(id, userId);
  },

  unpinMessage(id: string, userId: string): void {
    getDb().prepare('UPDATE chat_logs SET is_pinned = 0 WHERE id = ? AND user_id = ?').run(id, userId);
  },

  getPinnedMessages(userId: string): ChatLogRow[] {
    return getDb().prepare(
      'SELECT * FROM chat_logs WHERE user_id = ? AND is_pinned = 1 ORDER BY created_at DESC'
    ).all(userId) as ChatLogRow[];
  },

  sessionExists(sessionId: string): boolean {
    const row = getDb().prepare(
      'SELECT 1 FROM chat_sessions WHERE session_id = ?'
    ).get(sessionId);
    return !!row;
  },

  getMessageById(id: string, userId: string): ChatLogRow | undefined {
    return getDb().prepare(
      'SELECT * FROM chat_logs WHERE id = ? AND user_id = ?'
    ).get(id, userId) as ChatLogRow | undefined;
  },
};
