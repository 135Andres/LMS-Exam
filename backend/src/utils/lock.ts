import { getDb } from '../db/connection.js';
import { logger } from '../utils/logger.js';

const LOCK_TIMEOUT_MS = 300000;

export function acquireLock(name: string): boolean {
  try {
    const now = Date.now();
    const db = getDb();
    db.prepare(`
      CREATE TABLE IF NOT EXISTS worker_locks (
        name TEXT PRIMARY KEY,
        locked_at INTEGER NOT NULL,
        locked_by TEXT
      )
    `).run();

    const row = db.prepare('SELECT locked_at FROM worker_locks WHERE name = ?').get(name) as { locked_at: number } | undefined;
    if (row) {
      if (now - row.locked_at < LOCK_TIMEOUT_MS) {
        return false;
      }
      db.prepare('UPDATE worker_locks SET locked_at = ?, locked_by = ? WHERE name = ?').run(now, process.pid, name);
    } else {
      db.prepare('INSERT OR IGNORE INTO worker_locks (name, locked_at, locked_by) VALUES (?, ?, ?)').run(name, now, process.pid);
    }
    logger.info('Lock adquirido', { name, pid: process.pid });
    return true;
  } catch (err) {
    logger.warn('Error adquiriendo lock', { name, error: (err as Error).message });
    return false;
  }
}

export function releaseLock(name: string): void {
  try {
    getDb().prepare('DELETE FROM worker_locks WHERE name = ?').run(name);
    logger.info('Lock liberado', { name });
  } catch (err) {
    logger.warn('Error liberando lock', { name, error: (err as Error).message });
  }
}
