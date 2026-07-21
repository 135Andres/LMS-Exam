// Set dummy env vars BEFORE any import that triggers config/index.ts
// This makes the test suite hermetic — works on clean checkout without .env
process.env.NINE_ROUTER_API_KEY ??= 'test-dummy-key';
process.env.NVIDIA_API_KEY_EMBEDDINGS ??= 'test-dummy-key';
process.env.JWT_SECRET ??= 'test-jwt-secret-not-for-production';
process.env.INTERNAL_API_SECRET ??= 'test-internal-secret-not-for-production';

import { vi } from 'vitest';
import Database from 'better-sqlite3';

const testDb: Database.Database = new Database(':memory:');
testDb.pragma('journal_mode = WAL');
testDb.pragma('foreign_keys = ON');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, username TEXT,
  password_hash TEXT, role TEXT DEFAULT 'user',
  created_at TEXT DEFAULT (datetime('now')),
  exams_generated INTEGER DEFAULT 0, total_api_cost REAL DEFAULT 0.0,
  onboarding_state TEXT NOT NULL DEFAULT 'pending',
  onboarding_current_step INTEGER NOT NULL DEFAULT 0,
  onboarding_pending_message TEXT,
  onboarding_pending_session_id TEXT
);
CREATE TABLE IF NOT EXISTS chat_logs (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  session_id TEXT NOT NULL, role TEXT NOT NULL,
  content TEXT NOT NULL, subject TEXT, tokens INTEGER DEFAULT 0, model TEXT,
  is_pinned INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS chat_sessions (
  session_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  is_archived INTEGER DEFAULT 0, archived_at TEXT,
  summary_covers_until TEXT, title TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS chat_embeddings (
  id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES chat_logs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL, vector_text TEXT NOT NULL, model TEXT NOT NULL,
  dimensions INTEGER NOT NULL, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS chat_embeddings_vec (
  id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES chat_logs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL, embedding BLOB NOT NULL, model TEXT NOT NULL,
  dimensions INTEGER NOT NULL, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS embedding_outbox (
  id TEXT PRIMARY KEY, message_id TEXT NOT NULL, user_id TEXT NOT NULL,
  text_content TEXT NOT NULL, role TEXT DEFAULT 'user',
  status TEXT DEFAULT 'pending', attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3, error TEXT,
  created_at TEXT DEFAULT (datetime('now')), processed_at TEXT,
  next_retry_at TEXT
);
CREATE TABLE IF NOT EXISTS user_profile (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT, level TEXT, field TEXT,
  subjects TEXT NOT NULL DEFAULT '[]',
  goal TEXT,
  depth TEXT NOT NULL DEFAULT 'auto',
  register TEXT NOT NULL DEFAULT 'tuteo',
  study_methods TEXT NOT NULL DEFAULT '[]',
  profile_line TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);
`;

testDb.exec(SCHEMA);

vi.mock('../src/db/connection.js', () => ({
  getDb: () => testDb,
  get vecAvailable() { return false; },
}));

export function getTestDb(): Database.Database {
  return testDb;
}

export function resetDb(): void {
  testDb.exec('DELETE FROM chat_embeddings_vec');
  testDb.exec('DELETE FROM chat_embeddings');
  testDb.exec('DELETE FROM embedding_outbox');
  testDb.exec('DELETE FROM chat_logs');
  testDb.exec('DELETE FROM chat_sessions');
  testDb.exec('DELETE FROM user_profile');
  testDb.exec('DELETE FROM users');
}
