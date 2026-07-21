import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getTestDb, resetDb } from '../../test/setup.js';

type CapturedTask = {
  pattern: string;
  fn: (...args: any[]) => any;
  options?: Record<string, unknown>;
  stop: ReturnType<typeof vi.fn>;
};

const capturedTasks: CapturedTask[] = [];

vi.mock('node-cron', () => ({
  default: {
    schedule: vi.fn((pattern: string, fn: (...args: any[]) => any, options?: Record<string, unknown>) => {
      const task = { pattern, fn, options, stop: vi.fn() };
      capturedTasks.push(task);
      return task;
    }),
  },
}));

vi.mock('../utils/lock.js', () => ({
  acquireLock: vi.fn(() => true),
  releaseLock: vi.fn(),
}));

vi.mock('../services/insights.service.js', () => ({
  generateDailyInsights: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/profile-update.service.js', () => ({
  updateProfileForUser: vi.fn().mockResolvedValue(true),
}));

vi.mock('../services/kb-validator.service.js', () => ({
  validatePendingKnowledge: vi.fn().mockResolvedValue(undefined),
}));

const { acquireLock, releaseLock } = await import('../utils/lock.js');
const { generateDailyInsights } = await import('../services/insights.service.js');
const { updateProfileForUser } = await import('../services/profile-update.service.js');
const { validatePendingKnowledge } = await import('../services/kb-validator.service.js');

async function freshScheduler() {
  vi.resetModules();
  capturedTasks.length = 0;
  return import('./scheduler.js');
}

describe('scheduler', () => {
  beforeEach(() => {
    resetDb();
    vi.mocked(acquireLock).mockReset().mockReturnValue(true);
    vi.mocked(releaseLock).mockReset();
    vi.mocked(generateDailyInsights).mockReset().mockResolvedValue(undefined);
    vi.mocked(updateProfileForUser).mockReset().mockResolvedValue(true);
    vi.mocked(validatePendingKnowledge).mockReset().mockResolvedValue(undefined);
  });

  it('registra los 3 cron jobs con los patrones esperados cuando obtiene el lock', async () => {
    const { startScheduler } = await freshScheduler();
    startScheduler();

    expect(acquireLock).toHaveBeenCalledWith('cron-scheduler');
    const patterns = capturedTasks.map(t => t.pattern);
    expect(patterns).toEqual(['0 2 * * *', '0 3 * * *', '*/30 * * * *']);
  });

  it('si no consigue el lock, no registra ningún cron job (otro proceso ya está a cargo)', async () => {
    vi.mocked(acquireLock).mockReturnValue(false);
    const { startScheduler } = await freshScheduler();

    startScheduler();

    expect(capturedTasks).toHaveLength(0);
  });

  it('startScheduler es idempotente: llamarlo dos veces no re-adquiere el lock ni duplica jobs', async () => {
    const { startScheduler } = await freshScheduler();

    startScheduler();
    startScheduler();

    expect(acquireLock).toHaveBeenCalledTimes(1);
    expect(capturedTasks).toHaveLength(3);
  });

  it('stopScheduler detiene todos los jobs registrados y libera el lock', async () => {
    const { startScheduler, stopScheduler } = await freshScheduler();
    startScheduler();

    stopScheduler();

    for (const task of capturedTasks) {
      expect(task.stop).toHaveBeenCalledTimes(1);
    }
    expect(releaseLock).toHaveBeenCalledWith('cron-scheduler');
  });

  it('el job de insights diarios itera todos los usuarios y llama a generateDailyInsights', async () => {
    const db = getTestDb();
    db.prepare('INSERT INTO users (id, email) VALUES (?, ?)').run('u1', 'a@test.com');
    db.prepare('INSERT INTO users (id, email) VALUES (?, ?)').run('u2', 'b@test.com');

    const { startScheduler } = await freshScheduler();
    startScheduler();

    const insightsTask = capturedTasks[0];
    await insightsTask.fn();

    expect(generateDailyInsights).toHaveBeenCalledTimes(2);
    expect(generateDailyInsights).toHaveBeenCalledWith('u1', expect.any(String));
    expect(generateDailyInsights).toHaveBeenCalledWith('u2', expect.any(String));
  });

  it('un error dentro de un job se loguea y no interrumpe el proceso (no se propaga)', async () => {
    const db = getTestDb();
    db.prepare('INSERT INTO users (id, email) VALUES (?, ?)').run('u1', 'a@test.com');
    vi.mocked(generateDailyInsights).mockRejectedValue(new Error('AI down'));

    const { startScheduler } = await freshScheduler();
    startScheduler();

    const insightsTask = capturedTasks[0];
    await expect(insightsTask.fn()).resolves.not.toThrow();
  });

  it('el job de actualización de perfiles itera todos los usuarios y cuenta los actualizados', async () => {
    const db = getTestDb();
    db.prepare('INSERT INTO users (id, email) VALUES (?, ?)').run('u1', 'a@test.com');
    db.prepare('INSERT INTO users (id, email) VALUES (?, ?)').run('u2', 'b@test.com');
    vi.mocked(updateProfileForUser).mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const { startScheduler } = await freshScheduler();
    startScheduler();

    const profilesTask = capturedTasks[1];
    await expect(profilesTask.fn()).resolves.not.toThrow();

    expect(updateProfileForUser).toHaveBeenCalledTimes(2);
    expect(updateProfileForUser).toHaveBeenCalledWith('u1');
    expect(updateProfileForUser).toHaveBeenCalledWith('u2');
  });

  it('un error en el job de perfiles se loguea y no interrumpe el proceso', async () => {
    const db = getTestDb();
    db.prepare('INSERT INTO users (id, email) VALUES (?, ?)').run('u1', 'a@test.com');
    vi.mocked(updateProfileForUser).mockRejectedValue(new Error('DB down'));

    const { startScheduler } = await freshScheduler();
    startScheduler();

    const profilesTask = capturedTasks[1];
    await expect(profilesTask.fn()).resolves.not.toThrow();
  });

  it('el job de validación de KB llama a validatePendingKnowledge', async () => {
    const { startScheduler } = await freshScheduler();
    startScheduler();

    const kbTask = capturedTasks[2];
    await kbTask.fn();

    expect(validatePendingKnowledge).toHaveBeenCalledTimes(1);
  });

  it(
    'hallazgo: ningún job se registra con noOverlap, por lo que dos disparos ' +
      'del mismo cron (si el anterior aún no terminó) corren en paralelo sin ' +
      'protección propia — el lock de "cron-scheduler" es un guard de proceso ' +
      'único, no un guard de solapamiento por-job',
    async () => {
      const { startScheduler } = await freshScheduler();
      startScheduler();

      for (const task of capturedTasks) {
        expect(task.options?.noOverlap).not.toBe(true);
      }
    }
  );
});
