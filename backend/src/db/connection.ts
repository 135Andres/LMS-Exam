import Database from 'better-sqlite3';
import path from 'path';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const dbPath = path.resolve(config.db.path);
let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    logger.info(`Base de datos conectada: ${dbPath}`);
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
