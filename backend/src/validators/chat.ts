import { z } from 'zod';

export const attachmentSchema = z.object({
  type: z.enum(['image', 'audio']),
  mime: z.string(),
  data: z.string(),
});

export type Attachment = z.infer<typeof attachmentSchema>;

export const chatMessageSchema = z.object({
  message: z.string().min(1, 'Mensaje requerido').max(4000, 'Mensaje muy largo'),
  modelId: z.string().optional(),
  attachments: z.array(attachmentSchema).max(5, 'Máximo 5 archivos').optional(),
  sessionId: z.string().uuid().optional(),
});
