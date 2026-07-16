import { v4 as uuidv4 } from 'uuid';
import { getDb, closeDb } from './connection.js';
import { logger } from '../utils/logger.js';

function seed(): void {
  const db = getDb();

  const existing = db.prepare("SELECT id FROM users WHERE role = 'admin'").get();
  if (existing) {
    logger.info('Admin ya existe, saltando seed');
    closeDb();
    return;
  }

  db.prepare(
    'INSERT INTO users (id, email, username, password_hash, role) VALUES (?, ?, ?, ?, ?)',
  ).run(uuidv4(), 'admin@lmsexam.com', null, null, 'admin');

  logger.info('Admin creado: admin@lmsexam.com (usa OTP para iniciar sesión)');
  closeDb();
}

seed();