import type { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { ExamModel } from '../models/exam.model.js';
import { NotFoundError, AppError, ForbiddenError } from '../utils/errors.js';
import { generateExam, suggestSubtopics, polishQuestion, calculateCost } from '../services/exam.service.js';
import { recordUsage } from '../services/billing.service.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import type { ExamQuestion } from '../types/db.js';

export function getExams(req: Request, res: Response): void {
  const exams = ExamModel.findByUser(req.user!.id);
  res.json({ exams });
}

export function getPublicExams(req: Request, res: Response): void {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  const offset = parseInt(req.query.offset as string) || 0;
  const exams = ExamModel.findPublished(limit, offset);
  res.json({ exams });
}

export function getExamById(req: Request, res: Response): void {
  const exam = ExamModel.findById(req.params.id as string);

  if (!exam) {
    throw new NotFoundError('Examen');
  }

  if (exam.user_id !== req.user!.id && req.user!.role !== 'admin') {
    throw new AppError(403, 'No tienes acceso a este examen');
  }

  res.json({ exam });
}

export function updateExam(req: Request, res: Response): void {
  const exam = ExamModel.findById(req.params.id as string);

  if (!exam) {
    throw new NotFoundError('Examen');
  }

  if (exam.user_id !== req.user!.id) {
    throw new AppError(403, 'No tienes acceso a este examen');
  }

  const { score, data } = (req.validatedBody || {}) as { score?: number; data?: unknown };

  const examId = req.params.id as string;
  if (data) {
    ExamModel.updateScore(examId, score ?? exam.score!);
    ExamModel.updateQuestions(examId, data);
  }

  if (score !== undefined && !data) {
    ExamModel.markCompleted(examId, score);
  }

  logger.info('Examen actualizado', { examId: req.params.id as string, score });
  res.json({ message: 'Examen actualizado' });
}

export function deleteExam(req: Request, res: Response): void {
  const exam = ExamModel.findById(req.params.id as string);

  if (!exam) {
    throw new NotFoundError('Examen');
  }

  const examId2 = req.params.id as string;
  ExamModel.delete(examId2);
  logger.info('Examen eliminado', { examId: examId2 });
  res.json({ message: 'Examen eliminado' });
}

export async function suggestSubtopicsHandler(req: Request, res: Response): Promise<void> {
  const { syllabus } = req.validatedBody as { syllabus: string };
  const subtopics = await suggestSubtopics(syllabus);
  res.json({ subtopics });
}

export async function generateExamHandler(req: Request, res: Response): Promise<void> {
  const { name, subtopics, numQuestions, subject } = req.validatedBody as {
    name: string;
    subtopics: string[];
    numQuestions: number;
    subject: string;
  };

  const exam = ExamModel.create({
    id: uuidv4(),
    userId: req.user!.id,
    name,
    numQuestions,
    subject,
    subtopics,
  });

  ExamModel.updateStatus(exam!.id, 'generating');

  try {
    const result = await generateExam(name, subtopics, numQuestions);
    const cost = calculateCost(result.usage);

    ExamModel.markReady(exam!.id, result.questions, config.models.generate, cost);

    recordUsage(
      req.user!.id,
      exam!.id,
      'nvidia',
      config.models.generate,
      result.usage,
      cost,
    );

    const updated = ExamModel.findById(exam!.id);
    logger.info('Examen generado y listo', { examId: exam!.id, cost });

    res.json({ exam: updated });
  } catch (err) {
    ExamModel.updateStatus(exam!.id, 'pending');
    logger.error('Error generando examen', { examId: exam!.id, error: (err as Error).message });
    throw err;
  }
}

// --- Save edited questions (polish) ---

export function saveQuestions(req: Request, res: Response): void {
  const exam = ExamModel.findById(req.params.id as string);

  if (!exam) {
    throw new NotFoundError('Examen');
  }

  if (exam.user_id !== req.user!.id) {
    throw new ForbiddenError('No puedes editar este examen');
  }

  const { questions } = req.validatedBody as { questions: ExamQuestion[] };

  ExamModel.updateQuestions(exam.id, questions);
  logger.info('Preguntas editadas guardadas', { examId: exam.id, count: questions.length });

  res.json({ message: 'Preguntas guardadas' });
}

// --- Publish / Unpublish ---

export function publishExam(req: Request, res: Response): void {
  const exam = ExamModel.findById(req.params.id as string);

  if (!exam) {
    throw new NotFoundError('Examen');
  }

  if (exam.user_id !== req.user!.id) {
    throw new ForbiddenError('No puedes publicar este examen');
  }

  ExamModel.setPublished(exam.id, 1);
  ExamModel.setDraft(exam.id, 0);

  logger.info('Examen publicado', { examId: exam.id });
  res.json({ message: 'Examen publicado' });
}

export function unpublishExam(req: Request, res: Response): void {
  const exam = ExamModel.findById(req.params.id as string);

  if (!exam) {
    throw new NotFoundError('Examen');
  }

  if (exam.user_id !== req.user!.id) {
    throw new ForbiddenError('No puedes despublicar este examen');
  }

  ExamModel.setPublished(exam.id, 0);

  logger.info('Examen despublicado', { examId: exam.id });
  res.json({ message: 'Examen despublicado' });
}

// --- Polish Chat ---

export async function sendPolishMessage(req: Request, res: Response): Promise<void> {
  const exam = ExamModel.findById(req.params.id as string);

  if (!exam) {
    throw new NotFoundError('Examen');
  }

  if (exam.user_id !== req.user!.id) {
    throw new ForbiddenError('No puedes pulir este examen');
  }

  const { questionIndex, message } = req.validatedBody as { questionIndex: number; message: string };

  const questions = typeof exam.data === 'string' ? JSON.parse(exam.data) : exam.data;
  const question = questions?.[questionIndex] as ExamQuestion | undefined;

  if (!question) {
    throw new AppError(400, 'Índice de pregunta inválido');
  }

  // Guardar mensaje del usuario
  ExamModel.savePolishMessage({
    id: uuidv4(),
    exam_id: exam.id,
    user_id: req.user!.id,
    question_index: questionIndex,
    role: 'user',
    content: message,
  });

  // Llamar a la IA de pulido (DeepSeek)
  const polishResult = await polishQuestion(question, message);

  // Guardar respuesta de la IA
  const assistantContent = polishResult.suggestedQuestion
    ? JSON.stringify({ text: polishResult.response, suggestedQuestion: polishResult.suggestedQuestion })
    : polishResult.response;

  ExamModel.savePolishMessage({
    id: uuidv4(),
    exam_id: exam.id,
    user_id: req.user!.id,
    question_index: questionIndex,
    role: 'assistant',
    content: assistantContent,
  });

  logger.info('Mensaje de pulido procesado', {
    examId: exam.id,
    questionIndex,
    hasSuggestion: !!polishResult.suggestedQuestion,
  });

  res.json(polishResult);
}

export function getPolishMessagesHandler(req: Request, res: Response): void {
  const exam = ExamModel.findById(req.params.id as string);

  if (!exam) {
    throw new NotFoundError('Examen');
  }

  if (exam.user_id !== req.user!.id) {
    throw new ForbiddenError('No tienes acceso a este examen');
  }

  const questionIndex = parseInt(req.query.questionIndex as string);
  if (isNaN(questionIndex) || questionIndex < 0) {
    throw new AppError(400, 'questionIndex inválido');
  }

  const messages = ExamModel.getPolishMessages(exam.id, questionIndex);
  res.json({ messages });
}
