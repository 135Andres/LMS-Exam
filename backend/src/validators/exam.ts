import { z } from 'zod';

export const suggestSchema = z.object({
  syllabus: z.string().min(10, 'Temario muy corto').max(5000),
});

export const generateSchema = z.object({
  name: z.string().min(1, 'Nombre requerido').max(200),
  subtopics: z.array(z.string().min(1)).min(1, 'Al menos un subtema requerido'),
  numQuestions: z.number().int().min(1).max(64),
  subject: z.string().min(1, 'Materia requerida').max(100),
});

export const updateExamSchema = z.object({
  score: z.number().min(0).max(100).optional(),
  data: z.any().optional(),
});

export const saveQuestionsSchema = z.object({
  questions: z.array(z.object({
    pregunta: z.string().min(1),
    opciones: z.array(z.string()).length(4),
    respuesta_correcta: z.string().min(1),
    justificacion: z.string().min(1),
  })).min(1),
});

export const polishMessageSchema = z.object({
  questionIndex: z.number().int().min(0),
  message: z.string().min(1, 'Mensaje requerido').max(2000),
});
