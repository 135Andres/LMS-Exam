import Database from 'better-sqlite3';
import path from 'path';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const dbPath = path.resolve(config.db.path);
let db: Database.Database | null = null;

export let vecAvailable = false;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    logger.info(`Base de datos conectada: ${dbPath}`);
    tryLoadVec();
  }
  return db;
}

function tryLoadVec(): void {
  try {
    const vecPath = path.resolve('node_modules/sqlite-vec/dist/vec0');
    db!.loadExtension(vecPath);
    vecAvailable = true;
    logger.info('sqlite-vec cargado correctamente');
  } catch {
    vecAvailable = false;
    logger.warn('sqlite-vec no disponible, usando BLOB + coseno JS');
  }
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
