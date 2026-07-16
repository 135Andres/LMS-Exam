import cron, { type ScheduledTask } from 'node-cron';
import { getDb } from '../db/connection.js';
import { logger } from '../utils/logger.js';
import { generateDailyInsights } from '../services/insights.service.js';
import { updateProfileForUser } from '../services/profile-update.service.js';
import { validatePendingKnowledge } from '../services/kb-validator.service.js';
import { acquireLock, releaseLock } from '../utils/lock.js';

const LOCK_NAME = 'cron-scheduler';
let started = false;
const tasks: ScheduledTask[] = [];

export function startScheduler(): void {
  if (started) return;
  started = true;

  const locked = acquireLock(LOCK_NAME);
  if (!locked) {
    logger.info('Scheduler: otro proceso ya tiene el lock, crons no iniciados en este proceso');
    return;
  }

  logger.info('Scheduler: iniciando cron jobs');

  const insightsTask = cron.schedule('0 2 * * *', async () => {
    logger.info('Cron: iniciando generación de insights diarios');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const date = yesterday.toISOString().slice(0, 10);

    try {
      const users = getDb().prepare('SELECT id FROM users').all() as Array<{ id: string }>;
      for (const user of users) {
        await generateDailyInsights(user.id, date);
      }
      logger.info('Cron: insights diarios completados', { users: users.length, date });
    } catch (err) {
      logger.error('Cron: error en generación de insights', { error: (err as Error).message });
    }
  });
  tasks.push(insightsTask);

  const profilesTask = cron.schedule('0 3 * * *', async () => {
    logger.info('Cron: iniciando actualización de perfiles');
    try {
      const users = getDb().prepare('SELECT id FROM users').all() as Array<{ id: string }>;
      let updated = 0;
      for (const user of users) {
        const ok = await updateProfileForUser(user.id);
        if (ok) updated++;
      }
      logger.info('Cron: actualización de perfiles completada', { total: users.length, updated });
    } catch (err) {
      logger.error('Cron: error en actualización de perfiles', { error: (err as Error).message });
    }
  });
  tasks.push(profilesTask);

  const kbValidatorTask = cron.schedule('*/30 * * * *', async () => {
    logger.info('Cron: iniciando validacion de KB pendiente');
    try {
      await validatePendingKnowledge();
      logger.info('Cron: validacion de KB pendiente completada');
    } catch (err) {
      logger.error('Cron: error validando KB pendiente', { error: (err as Error).message });
    }
  });
  tasks.push(kbValidatorTask);
}

export function stopScheduler(): void {
  for (const t of tasks) t.stop();
  tasks.length = 0;
  releaseLock(LOCK_NAME);
  started = false;
}
