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
