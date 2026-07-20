import { z } from 'zod';

const uuidV4 = z.string().uuid().refine(
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

export const onboardingAnswerSchema = z.object({
  step: z.number().int().min(1).max(5),
  values: z.record(z.union([z.string(), z.array(z.string())])),
});
