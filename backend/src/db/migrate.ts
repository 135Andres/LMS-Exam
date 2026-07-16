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
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_embeddings_msg ON chat_embeddings(message_id);

-- Tabla migrada: BLOB binario (Float32Array) en vez de JSON string
-- 16KB por vector vs 40KB JSON, sin parse overhead
CREATE TABLE IF NOT EXISTS chat_embeddings_vec (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES chat_logs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  embedding BLOB NOT NULL,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_embeddings_vec_user ON chat_embeddings_vec(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_embeddings_vec_msg ON chat_embeddings_vec(message_id);

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

-- Embedding outbox: desacopla generación de embeddings del request HTTP
CREATE TABLE IF NOT EXISTS embedding_outbox (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES chat_logs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  text_content TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','processing','done','failed')),
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  processed_at TEXT,
  next_retry_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_outbox_status_retry ON embedding_outbox(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_outbox_message ON embedding_outbox(message_id);

-- ── Fase 3: Knowledge Base ──
CREATE TABLE IF NOT EXISTS knowledge_base (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  summary TEXT,
  subject TEXT NOT NULL,
  topic TEXT,
  difficulty TEXT CHECK(difficulty IN ('basico','intermedio','avanzado')) DEFAULT 'intermedio',
  source_type TEXT CHECK(source_type IN ('user_qa','user_explanation','verified_content','imported')) DEFAULT 'user_qa',
  source_user_id TEXT REFERENCES users(id),
  is_verified INTEGER DEFAULT 0,
  verified_by TEXT REFERENCES users(id),
  verified_at TEXT,
  upvotes INTEGER DEFAULT 0,
  downvotes INTEGER DEFAULT 0,
  view_count INTEGER DEFAULT 0,
  tags TEXT DEFAULT '[]',
  language TEXT DEFAULT 'es',
  content_hash TEXT NOT NULL,
  status TEXT DEFAULT 'published' CHECK(status IN ('draft','pending_review','published','rejected')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kb_subject_topic ON knowledge_base(subject, topic);
CREATE INDEX IF NOT EXISTS idx_kb_verified ON knowledge_base(is_verified);
CREATE INDEX IF NOT EXISTS idx_kb_source_user ON knowledge_base(source_user_id);
CREATE INDEX IF NOT EXISTS idx_kb_created ON knowledge_base(created_at);
CREATE INDEX IF NOT EXISTS idx_kb_content_hash ON knowledge_base(content_hash);
CREATE INDEX IF NOT EXISTS idx_kb_status ON knowledge_base(status);

CREATE TABLE IF NOT EXISTS knowledge_embeddings (
  id TEXT PRIMARY KEY,
  knowledge_id TEXT NOT NULL REFERENCES knowledge_base(id) ON DELETE CASCADE,
  embedding BLOB NOT NULL,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kemb_knowledge ON knowledge_embeddings(knowledge_id);

CREATE TABLE IF NOT EXISTS knowledge_votes (
  id TEXT PRIMARY KEY,
  knowledge_id TEXT NOT NULL REFERENCES knowledge_base(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  vote_type INTEGER CHECK(vote_type IN (1, -1)),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(knowledge_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_kv_knowledge ON knowledge_votes(knowledge_id);
CREATE INDEX IF NOT EXISTS idx_kv_user ON knowledge_votes(user_id);

CREATE TABLE IF NOT EXISTS knowledge_contributions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  knowledge_id TEXT NOT NULL REFERENCES knowledge_base(id),
  contribution_type TEXT CHECK(contribution_type IN ('created','edited','upvoted','reported','verified')),
  points INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kc_user ON knowledge_contributions(user_id);
CREATE INDEX IF NOT EXISTS idx_kc_knowledge ON knowledge_contributions(knowledge_id);

CREATE TABLE IF NOT EXISTS user_kb_stats (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  total_points INTEGER DEFAULT 0,
  level INTEGER DEFAULT 1,
  contributions_count INTEGER DEFAULT 0,
  verified_count INTEGER DEFAULT 0,
  total_upvotes_received INTEGER DEFAULT 0,
  total_views INTEGER DEFAULT 0,
  reports_valid INTEGER DEFAULT 0,
  edits_accepted INTEGER DEFAULT 0,
  badges TEXT DEFAULT '[]',
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS knowledge_notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  knowledge_id TEXT REFERENCES knowledge_base(id),
  data TEXT,
  read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kn_user_read ON knowledge_notifications(user_id, read);

-- Triggers para contadores de votos
CREATE TRIGGER IF NOT EXISTS update_kb_votes_after_insert
AFTER INSERT ON knowledge_votes
BEGIN
  UPDATE knowledge_base SET
    upvotes = upvotes + (CASE WHEN new.vote_type = 1 THEN 1 ELSE 0 END),
    downvotes = downvotes + (CASE WHEN new.vote_type = -1 THEN 1 ELSE 0 END)
  WHERE id = new.knowledge_id;
END;

CREATE TRIGGER IF NOT EXISTS update_kb_votes_after_delete
AFTER DELETE ON knowledge_votes
BEGIN
  UPDATE knowledge_base SET
    upvotes = upvotes - (CASE WHEN old.vote_type = 1 THEN 1 ELSE 0 END),
    downvotes = downvotes - (CASE WHEN old.vote_type = -1 THEN 1 ELSE 0 END)
  WHERE id = old.knowledge_id;
END;

-- Trigger para stats de contribuciones
CREATE TRIGGER IF NOT EXISTS update_user_kb_stats
AFTER INSERT ON knowledge_contributions
BEGIN
  UPDATE user_kb_stats SET
    total_points = total_points + new.points,
    contributions_count = contributions_count + (CASE WHEN new.contribution_type = 'created' THEN 1 ELSE 0 END),
    verified_count = verified_count + (CASE WHEN new.contribution_type = 'verified' THEN 1 ELSE 0 END),
    level = CASE
      WHEN total_points + new.points >= 2500 THEN 7
      WHEN total_points + new.points >= 1300 THEN 6
      WHEN total_points + new.points >= 700 THEN 5
      WHEN total_points + new.points >= 350 THEN 4
      WHEN total_points + new.points >= 150 THEN 3
      WHEN total_points + new.points >= 50 THEN 2
      ELSE 1
    END,
    updated_at = datetime('now')
  WHERE user_id = new.user_id;
END;
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

function deduplicateChatEmbeddings(db: Database.Database): void {
  // Check if chat_embeddings table exists
  const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chat_embeddings'").get();
  if (!tableExists) return;

  // Drop the old non-unique index if it exists so we can recreate it as unique
  try {
    db.exec("DROP INDEX IF EXISTS idx_chat_embeddings_msg");
  } catch (err) {
    logger.warn('No se pudo borrar el indice antiguo', { error: (err as Error).message });
  }

  // Find duplicated message_ids
  const duplicates = db.prepare(`
    SELECT message_id, COUNT(*) as count 
    FROM chat_embeddings 
    GROUP BY message_id 
    HAVING count > 1
  `).all() as Array<{ message_id: string; count: number }>;

  if (duplicates.length === 0) return;

  logger.info(`Se encontraron ${duplicates.length} message_ids duplicados en chat_embeddings. Limpiando...`);
  
  let deletedCount = 0;
  
  db.exec("BEGIN TRANSACTION");
  try {
    for (const dup of duplicates) {
      // Keep only the oldest one (by created_at or id if created_at is identical)
      const rowsToKeep = db.prepare(`
        SELECT id FROM chat_embeddings 
        WHERE message_id = ? 
        ORDER BY created_at ASC, id ASC 
        LIMIT 1
      `).get(dup.message_id) as { id: string };
      
      const res = db.prepare(`
        DELETE FROM chat_embeddings 
        WHERE message_id = ? AND id != ?
      `).run(dup.message_id, rowsToKeep.id);
      
      deletedCount += res.changes;
    }
    db.exec("COMMIT");
    logger.info(`Limpieza completada: se eliminaron ${deletedCount} filas duplicadas en chat_embeddings.`);
  } catch (err) {
    db.exec("ROLLBACK");
    logger.error('Error deduplicando chat_embeddings', { error: (err as Error).message });
    throw err;
  }
}

function migrate(): void {
  const db = getDb();
  
  // Deduplicate before creating the unique index to prevent constraint failures
  deduplicateChatEmbeddings(db);
  
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

  // KB colectiva — validacion automatica por IA (nemotron-3-ultra via 9router)
  addColumnIfMissing(db, 'knowledge_base', 'verified_by_ai', 'TEXT');

  logger.info('Migración completada: tablas creadas/verificadas');
  closeDb();
}

migrate();
