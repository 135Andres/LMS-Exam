import type { Request, Response } from 'express';
import { UserModel } from '../models/user.model.js';
import { getDb } from '../db/connection.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import { ProfileService } from '../services/profile.service.js';
import { logger } from '../utils/logger.js';
import { generateFromAI } from '../services/ai/index.js';
import { config } from '../config/index.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

export async function saveOnboardingHandler(req: Request, res: Response): Promise<void> {
  const { exam, archetype, feedback_style, strictness } = req.validatedBody as {
    exam: string; archetype: string; feedback_style: string; strictness: string;
  };
  const userId = req.user!.id;
  const db = getDb();

  // Guardar en DB
  db.prepare(`
    UPDATE users SET
      onboarding_exam = ?, onboarding_archetype = ?,
      onboarding_feedback_style = ?, onboarding_strictness = ?,
      onboarding_status = 'completed'
    WHERE id = ?
  `).run(exam, archetype, feedback_style, strictness, userId);

  // Generar perfil con IA
  try {
    const systemPrompt = 'Actúa como un Diseñador de Perfiles. Toma estas 4 respuestas de encuesta y genera un archivo Markdown (.md) estructurado con tres secciones: 1. PREFERENCIAS FIJAS (Tono, Feedback, Estrictez basados en las respuestas), 2. ESTADO DE CONOCIMIENTO (Vacío por ahora), 3. HISTORIAL DE COMPORTAMIENTO (Vacío por ahora). Devuelve SOLO el código Markdown, sin textos introductorios.';

    const userPrompt = `Respuestas de la encuesta:\n- Preparación para examen: ${exam}\n- Arquetipo de tutor: ${archetype}\n- Estilo de feedback: ${feedback_style}\n- Nivel de estrictez: ${strictness}`;

    const aiResult = await generateFromAI('nvidia', systemPrompt, userPrompt, null, {
      model: config.models.chat,
      temperature: 0.3,
      max_tokens: 1024,
    });

    const profileContent = aiResult.content;

    // Guardar en users/{userId}.md (raíz del proyecto)
    const usersDir = path.resolve(__dirname, '../../../users');
    if (!fs.existsSync(usersDir)) {
      fs.mkdirSync(usersDir, { recursive: true });
    }
    fs.writeFileSync(path.join(usersDir, `${userId}.md`), profileContent, 'utf-8');

    // Guardar también en el sistema de perfiles existente (para el tutor)
    ProfileService.saveProfile(userId, profileContent);

    logger.info('Perfil IA generado desde onboarding', { userId });
  } catch (err) {
    logger.warn('Error generando perfil IA en onboarding', { userId, error: (err as Error).message });
    // No bloqueamos — el onboarding se completa igual
  }

  res.json({ success: true });
}
