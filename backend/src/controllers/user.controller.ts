import type { Request, Response } from 'express';
import { UserModel } from '../models/user.model.js';
import { ChatModel } from '../models/chat.model.js';
import { getDb } from '../db/connection.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import { ProfileService } from '../services/profile.service.js';
import { logger } from '../utils/logger.js';

export function getProfile(req: Request, res: Response): void {
  const user = UserModel.findById(req.user!.id);

  if (!user) {
    throw new NotFoundError('Usuario no encontrado');
  }

  res.json({
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      created_at: user.created_at,
      exams_generated: user.exams_generated,
      total_api_cost: user.total_api_cost,
      has_completed_setup: user.has_completed_setup,
      onboarding_status: user.onboarding_status || 'pending',
    },
  });
}

export function updateUsername(req: Request, res: Response): void {
  const { username } = req.body as { username: string };
  UserModel.setUsername(req.user!.id, username);
  res.json({ username });
}

interface DailyInsight {
  fortalezas?: string[];
  debilidades?: string[];
  recomendaciones?: string;
  calificacion?: number;
}

export function getDashboardSummary(req: Request, res: Response): void {
  const user = UserModel.findById(req.user!.id);
  if (!user) {
    throw new NotFoundError('Usuario no encontrado');
  }

  const db = getDb();
  const userId = user.id;

  const chatsCount = ChatModel.getUserSessions(userId).length;

  const examsCount = (db.prepare(
    'SELECT COUNT(*) as count FROM exams WHERE user_id = ?'
  ).get(userId) as { count: number }).count;

  // Fila más reciente de chat_insights por materia (análisis nocturno).
  const rows = db.prepare(
    `SELECT subject, insights, date FROM chat_insights
     WHERE user_id = ? ORDER BY date DESC`
  ).all(userId) as Array<{ subject: string; insights: string; date: string }>;

  const seenSubjects = new Set<string>();
  const subjects: Array<{ subject: string; calificacion: number; recomendaciones: string; lastUpdated: string }> = [];

  for (const row of rows) {
    if (seenSubjects.has(row.subject)) continue;
    seenSubjects.add(row.subject);

    let parsed: DailyInsight = {};
    try { parsed = JSON.parse(row.insights); } catch { /* fila corrupta, se ignora */ }

    subjects.push({
      subject: row.subject,
      calificacion: typeof parsed.calificacion === 'number' ? parsed.calificacion : 0,
      recomendaciones: parsed.recomendaciones || '',
      lastUpdated: row.date,
    });
  }

  // Autoexpansión: una materia con exámenes generados pero sin análisis
  // nocturno todavía (usuario nuevo, cron aún no corre) igual aparece —
  // calificación = promedio de sus exámenes calificados, sin recomendación
  // de IA hasta que el análisis nocturno la alcance.
  const examSubjectRows = db.prepare(
    `SELECT subject, AVG(score) as avgScore, MAX(created_at) as lastCreated
     FROM exams
     WHERE user_id = ? AND subject != '' AND subject IS NOT NULL AND score IS NOT NULL
     GROUP BY subject`
  ).all(userId) as Array<{ subject: string; avgScore: number; lastCreated: string }>;

  for (const row of examSubjectRows) {
    if (seenSubjects.has(row.subject)) continue;
    seenSubjects.add(row.subject);
    subjects.push({
      subject: row.subject,
      calificacion: Math.round(row.avgScore || 0),
      recomendaciones: '',
      lastUpdated: row.lastCreated,
    });
  }

  res.json({
    user: {
      name: user.username || user.email,
      email: user.email,
      role: user.role,
    },
    chatsCount,
    examsCount,
    subjects,
  });
}

export function getSetupStatus(req: Request, res: Response): void {
  const user = UserModel.findById(req.user!.id);
  const hasProfile = ProfileService.getProfile(req.user!.id) !== null;
  res.json({ hasCompletedSetup: !!(user?.has_completed_setup), hasProfile });
}

export async function completeSetup(req: Request, res: Response): Promise<void> {
  const { answers } = req.validatedBody as { answers: string };

  if (!answers || answers.trim().length < 10) {
    throw new ValidationError('Las respuestas deben tener al menos 10 caracteres');
  }

  // Generar perfil .md a partir de las respuestas
  const profileContent = `# Perfil de Estudiante\n\n${answers.trim()}`;
  ProfileService.saveProfile(req.user!.id, profileContent);

  // Marcar setup como completado
  getDb().prepare('UPDATE users SET has_completed_setup = 1 WHERE id = ?').run(req.user!.id);

  logger.info('Setup completado', { userId: req.user!.id });
  res.json({ message: 'Perfil guardado correctamente' });
}

export function resetSetup(req: Request, res: Response): void {
  ProfileService.resetProfile(req.user!.id);
  getDb().prepare('UPDATE users SET has_completed_setup = 0 WHERE id = ?').run(req.user!.id);

  logger.info('Setup reiniciado', { userId: req.user!.id });
  res.json({ message: 'Perfil eliminado. Puedes volver a configurar tu IA.' });
}

