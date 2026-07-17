import { z } from 'zod';

export const setupSchema = z.object({
  answers: z.string().min(10, 'Las respuestas deben tener al menos 10 caracteres').max(4000, 'Respuesta muy larga'),
});

export const usernameSchema = z.object({
  username: z.string().trim().min(1, 'El nombre no puede estar vacío').max(60, 'Nombre muy largo'),
});

export const settingsSchema = z.object({
  language: z.enum(['es', 'en']).optional(),
  theme: z.enum(['light', 'dark']).optional(),
  font: z.enum(['default', 'serif', 'mono']).optional(),
  reduced_motion: z.boolean().optional(),
  notify_on_response: z.boolean().optional(),
  cross_chat_enabled: z.boolean().optional(),
});

// ~500KB de imagen ya comprimida por el frontend (canvas resize) + margen
// para el prefijo "data:image/...;base64,".
export const avatarSchema = z.object({
  avatar: z.string().regex(/^data:image\/(png|jpeg|jpg|webp);base64,/, 'Formato de imagen inválido').max(700_000, 'Imagen muy pesada'),
});

export const memoryImportSchema = z.object({
  text: z.string().trim().min(1, 'El texto no puede estar vacío').max(20_000, 'Texto muy largo'),
});
