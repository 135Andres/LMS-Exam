import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getTestDb, resetDb } from '../../test/setup.js';
import { acquireLock, releaseLock } from './lock.js';

const LOCK_NAME = 'test-lock';

describe('acquireLock / releaseLock', () => {
  beforeEach(() => {
    resetDb();
    const db = getTestDb();
    db.exec('DROP TABLE IF EXISTS worker_locks');
  });

  it('dos intentos de adquirir el mismo lock: solo el primero lo consigue', () => {
    const first = acquireLock(LOCK_NAME);
    const second = acquireLock(LOCK_NAME);

    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it('locks con nombres distintos no se bloquean entre sí', () => {
    expect(acquireLock('lock-a')).toBe(true);
    expect(acquireLock('lock-b')).toBe(true);
  });

  it('releaseLock libera el lock, permitiendo adquirirlo de nuevo', () => {
    expect(acquireLock(LOCK_NAME)).toBe(true);
    expect(acquireLock(LOCK_NAME)).toBe(false);

    releaseLock(LOCK_NAME);

    expect(acquireLock(LOCK_NAME)).toBe(true);
  });

  it('un lock cuyo dueño murió (locked_at vencido más allá del TTL) puede ser tomado por otro proceso', () => {
    expect(acquireLock(LOCK_NAME)).toBe(true);

    const db = getTestDb();
    const STALE_MS = 300_000 + 1_000; // por encima del LOCK_TIMEOUT_MS de lock.ts
    db.prepare('UPDATE worker_locks SET locked_at = ? WHERE name = ?').run(
      Date.now() - STALE_MS,
      LOCK_NAME
    );

    expect(acquireLock(LOCK_NAME)).toBe(true);
  });

  it('un lock fresco (dentro del TTL) no puede ser tomado por otro proceso', () => {
    expect(acquireLock(LOCK_NAME)).toBe(true);

    const db = getTestDb();
    const FRESH_MS = 60_000; // muy por debajo del TTL de 300_000ms
    db.prepare('UPDATE worker_locks SET locked_at = ? WHERE name = ?').run(
      Date.now() - FRESH_MS,
      LOCK_NAME
    );

    expect(acquireLock(LOCK_NAME)).toBe(false);
  });

  it('releaseLock sobre un lock inexistente no lanza (idempotente)', () => {
    expect(() => releaseLock('never-acquired')).not.toThrow();
  });

  it('acquireLock no lanza si la operación de DB falla: retorna false de forma segura', async () => {
    vi.resetModules();
    vi.doMock('../db/connection.js', () => ({
      getDb: () => {
        throw new Error('db unavailable');
      },
    }));

    const { acquireLock: acquireLockWithBrokenDb } = await import('./lock.js');
    expect(() => acquireLockWithBrokenDb(LOCK_NAME)).not.toThrow();
    expect(acquireLockWithBrokenDb(LOCK_NAME)).toBe(false);

    vi.doUnmock('../db/connection.js');
    vi.resetModules();
  });
});
