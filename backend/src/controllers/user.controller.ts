import type { Request, Response } from 'express';
import { UserModel } from '../models/user.model.js';
import { ChatModel } from '../models/chat.model.js';
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

// Traducción de las respuestas de la encuesta a descripciones que la IA
// entiende sin ambigüedad. Agregar una opción nueva a la encuesta = agregar
// una línea aquí, nada más.
const EXAM_DESCRIPTIONS: Record<string, string> = {
  'no': 'No se prepara para ningún examen en particular, solo quiere aprender.',
  'si-escolar': 'Se prepara para un examen escolar (materia de la escuela).',
  'si-certificacion': 'Se prepara para una certificación profesional.',
  'si-oposicion': 'Se prepara para una oposición/concurso público.',
};

const ARCHETYPE_DESCRIPTIONS: Record<string, string> = {
  sargento: 'Tono firme, directo, sin rodeos ni endulzar el mensaje. Exige rigor.',
  profesor: 'Tono paciente, detallado, explica con calma y ejemplos.',
  compa: 'Tono relajado, casual, como un compañero de clase que sabe del tema. Nada formal.',
  guia: 'Tono motivador, empático, celebra avances y acompaña sin presionar.',
};

const FEEDBACK_DESCRIPTIONS: Record<string, string> = {
  detalladas: 'Feedback extenso: explica el por qué completo de cada respuesta.',
  cortas: 'Feedback breve: va directo al punto, sin rodeos ni relleno.',
  numeros: 'Feedback mínimo: solo la calificación/puntuación, nada de texto explicativo salvo que se pida.',
  libre: 'Feedback conversacional: como charlar con un amigo que sabe mucho, sin formato rígido.',
};

const STRICTNESS_DESCRIPTIONS: Record<string, string> = {
  alta: 'Exigente y riguroso al evaluar, señala todos los errores.',
  media: 'Equilibrado: exigente pero flexible según el contexto.',
  baja: 'Flexible y relajado, prioriza no desmotivar sobre el rigor.',
  maxima: 'Nivel juez: cero tolerancia a imprecisiones, exige perfección.',
};

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
    const systemPrompt = `Actúa como Diseñador de Perfiles de un tutor IA. Recibes las preferencias de un estudiante y debes producir un archivo Markdown con REGLAS DE COMPORTAMIENTO que el tutor va a leer como instrucciones obligatorias antes de cada respuesta.

Formato de salida (SOLO esto, sin texto introductorio, sin bloque de código):

## Reglas de comportamiento (obligatorias)
- [4 a 6 bullets imperativos, cortos, concretos — cómo debe hablar el tutor: tono, longitud de feedback, nivel de exigencia. Ejemplo de bullet: "Usa un tono relajado y casual, nunca formal."]

## Estado de conocimiento
(vacío por ahora)

## Historial de comportamiento
(vacío por ahora)

Máximo 150 palabras en total. No repitas la pregunta de la encuesta, solo las reglas ya traducidas a instrucciones.`;

    const userPrompt = [
      `Preparación: ${EXAM_DESCRIPTIONS[exam] || exam}`,
      `Tono (arquetipo elegido "${archetype}"): ${ARCHETYPE_DESCRIPTIONS[archetype] || archetype}`,
      `Feedback (elegido "${feedback_style}"): ${FEEDBACK_DESCRIPTIONS[feedback_style] || feedback_style}`,
      `Exigencia (elegida "${strictness}"): ${STRICTNESS_DESCRIPTIONS[strictness] || strictness}`,
    ].join('\n');

    const aiResult = await generateFromAI('nineRouter', systemPrompt, userPrompt, null, {
      model: config.models.chat,
      temperature: 0.3,
      max_tokens: 400,
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
