import { z } from 'zod';

export const uuidV4 = z.string().uuid().refine(
  val => val[14] === '4',
  'sessionId debe ser UUID v4'
);

export const attachmentSchema = z.object({
  type: z.enum(['image', 'audio', 'file']),
  mime: z.string(),
  data: z.string(),
});

export type Attachment = z.infer<typeof attachmentSchema>;

export const chatMessageSchema = z.object({
  message: z.string().min(1, 'Mensaje requerido').max(4000, 'Mensaje muy largo'),
  modelId: z.string().optional(),
  attachments: z.array(attachmentSchema).max(5, 'Máximo 5 archivos').optional(),
  links: z.array(z.string().url()).max(5, 'Máximo 5 enlaces').optional(),
  sessionId: uuidV4.optional(),
});

export const regenerateSchema = z.object({
  sessionId: uuidV4,
  modelId: z.string().optional(),
  instruction: z.string().max(500, 'Instrucción muy larga').optional(),
});

export const summarySchema = z.object({
  sessionId: uuidV4,
});

// Fase 4 — edición manual de la narrativa de sesión. Tope propio (no
// MAX_PROFILE_BYTES de ProfileService — ese es para perfiles, contenido
// mucho más corto por naturaleza; la narrativa de sesión es texto largo por
// diseño). 20000 caracteres es punto de partida razonable, ajustable con
// uso real, no un número medido.
export const summaryUpdateSchema = z.object({
  sessionId: uuidV4,
  content: z.string().min(1, 'content requerido').max(20000, 'content muy largo'),
});

export const exportSchema = z.object({
  sessionId: uuidV4,
});

export const quizResolveSchema = z.object({
  sessionId: uuidV4,
  userMsgId: z.string().min(1, 'userMsgId requerido'),
});

export const quizExplainSchema = z.object({
  sessionId: uuidV4,
});

// Mismos límites que updateProfileSchema (profile.ts) — resolveStepValues()
// termina guardando esto en el mismo perfil, así que las cotas deben ser
// consistentes entre wizard y Settings.
const onboardingValueString = z.string().max(200);
export const onboardingAnswerSchema = z.object({
  step: z.number().int().min(1).max(5),
  values: z.record(z.union([onboardingValueString, z.array(onboardingValueString).max(30)])),
});
