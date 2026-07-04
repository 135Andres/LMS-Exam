import { getDb, closeDb } from './connection.js';
import Database from 'better-sqlite3';
import { logger } from '../utils/logger.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE,
  password_hash TEXT,
  role TEXT DEFAULT 'user' CHECK(role IN ('user','admin')),
  created_at TEXT DEFAULT (datetime('now')),
  exams_generated INTEGER DEFAULT 0,
  total_api_cost REAL DEFAULT 0.0
);

CREATE TABLE IF NOT EXISTS exams (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  num_questions INTEGER NOT NULL,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','generating','ready','completed')),
  score REAL,
  data TEXT,
  ai_provider TEXT,
  ai_cost REAL DEFAULT 0.0,
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS api_usage (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  exam_id TEXT REFERENCES exams(id),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  cost REAL NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_exams_user_id ON exams(user_id);
CREATE INDEX IF NOT EXISTS idx_exams_status ON exams(status);
CREATE INDEX IF NOT EXISTS idx_api_usage_user_id ON api_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_created_at ON api_usage(created_at);

CREATE TABLE IF NOT EXISTS polish_messages (
  id TEXT PRIMARY KEY,
  exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  question_index INTEGER NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user','assistant')),
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_polish_exam ON polish_messages(exam_id, question_index);

CREATE TABLE IF NOT EXISTS otp_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS auth_log (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  action TEXT NOT NULL,
  ip TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ── Fase 0: RAG, Perfil Adaptativo y Persistencia de Chat ──
-- Mensajes del tutor IA (persistencia del chat existente)
CREATE TABLE IF NOT EXISTS chat_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  subject TEXT,
  tokens INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_logs_user_id ON chat_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_logs_session ON chat_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_logs_created_at ON chat_logs(created_at);

-- Metadatos de sesiones (archivado, borrado lógico)
CREATE TABLE IF NOT EXISTS chat_sessions (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  is_archived INTEGER DEFAULT 0,
  archived_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id);

-- Vectores como JSON string (sin sqlite-vec, similitud coseno en TS puro)
CREATE TABLE IF NOT EXISTS chat_embeddings (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES chat_logs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  vector_text TEXT NOT NULL,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_embeddings_user_id ON chat_embeddings(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_embeddings_msg ON chat_embeddings(message_id);

-- Insights diarios por materia (clave única user_id + subject + date)
CREATE TABLE IF NOT EXISTS chat_insights (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  subject TEXT NOT NULL,
  date TEXT NOT NULL,
  insights TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_insights_user_subject_date
  ON chat_insights(user_id, subject, date);
CREATE INDEX IF NOT EXISTS idx_chat_insights_user_date ON chat_insights(user_id, date);
`;

function migrateUsersTable(db: Database.Database): void {
  // Check if users table has old NOT NULL constraints
  const tableInfo = db.prepare("PRAGMA table_info('users')").all() as Array<{ name: string; notnull: number }>;
  const usernameNotNull = tableInfo.find(c => c.name === 'username')?.notnull === 1;

  if (!usernameNotNull) return; // Already migrated

  logger.info('Migrando tabla users: haciendo username y password_hash opcionales...');

  db.exec("PRAGMA foreign_keys = OFF");
  db.exec("BEGIN TRANSACTION");

  try {
    db.exec(`CREATE TABLE IF NOT EXISTS users_v2 (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE,
      password_hash TEXT,
      role TEXT DEFAULT 'user' CHECK(role IN ('user','admin')),
      created_at TEXT DEFAULT (datetime('now')),
      exams_generated INTEGER DEFAULT 0,
      total_api_cost REAL DEFAULT 0.0
    )`);

    db.exec("INSERT INTO users_v2 SELECT id, email, username, password_hash, role, created_at, exams_generated, total_api_cost FROM users");
    db.exec("DROP TABLE users");
    db.exec("ALTER TABLE users_v2 RENAME TO users");
    db.exec("COMMIT");
    db.exec("PRAGMA foreign_keys = ON");

    logger.info('Migración de users completada');
  } catch (err) {
    db.exec("ROLLBACK");
    db.exec("PRAGMA foreign_keys = ON");
    logger.error('Error migrando users', { error: (err as Error).message });
    throw err;
  }
}

// PRAGMA-based check before ALTER TABLE — idempotente y sin try/catch silenciado.
// Reutiliza el mismo patrón de migrateUsersTable() para verificar columnas nuevas.
function addColumnIfMissing(db: Database.Database, table: string, column: string, definition: string): void {
  const tableInfo = db.prepare(`PRAGMA table_info('${table}')`).all() as Array<{ name: string }>;
  const exists = tableInfo.some(c => c.name === column);
  if (exists) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  logger.info(`Columna añadida: ${table}.${column}`);
}

function migrate(): void {
  const db = getDb();
  db.exec(SCHEMA);

  // Migrate users table to nullable columns
  migrateUsersTable(db);

  // Safe ALTER TABLE con PRAGMA check — idempotente y explícito
  addColumnIfMissing(db, 'exams', 'is_draft', 'INTEGER DEFAULT 1');
  addColumnIfMissing(db, 'exams', 'is_published', 'INTEGER DEFAULT 0');
  addColumnIfMissing(db, 'exams', 'subject', "TEXT DEFAULT ''");
  addColumnIfMissing(db, 'exams', 'subtopics', "TEXT DEFAULT '[]'");
  // Fase 0 — flag de setup del perfil adaptativo
  addColumnIfMissing(db, 'users', 'has_completed_setup', 'INTEGER DEFAULT 0');

  // Onboarding — preferencias del perfil adaptativo
  addColumnIfMissing(db, 'users', 'onboarding_exam', "TEXT DEFAULT ''");
  addColumnIfMissing(db, 'users', 'onboarding_archetype', "TEXT DEFAULT ''");
  addColumnIfMissing(db, 'users', 'onboarding_feedback_style', "TEXT DEFAULT ''");
  addColumnIfMissing(db, 'users', 'onboarding_strictness', "TEXT DEFAULT ''");
  addColumnIfMissing(db, 'users', 'onboarding_status', "TEXT DEFAULT 'pending'");

  logger.info('Migración completada: tablas creadas/verificadas');
  closeDb();
}

migrate();
