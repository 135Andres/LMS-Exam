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
  const candidates = getVecCandidates();
  for (const vecPath of candidates) {
    try {
      db!.loadExtension(vecPath);
      vecAvailable = true;
      logger.info('sqlite-vec cargado', { path: vecPath });
      return;
    } catch {
      // try next candidate
    }
  }
  vecAvailable = false;
  logger.warn('sqlite-vec no disponible, usando BLOB + coseno JS', { candidates });
}

function getVecCandidates(): string[] {
  const base = path.resolve('node_modules/sqlite-vec/dist/vec0');
  if (process.platform === 'win32') {
    return [
      `${base}.dll`,
      `${base}.x64.dll`,
      path.resolve('node_modules/sqlite-vec/dist/vec0.dll'),
    ];
  }
  if (process.platform === 'darwin') {
    return [`${base}.dylib`, base];
  }
  return [`${base}.so`, `${base}.node`, base];
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
