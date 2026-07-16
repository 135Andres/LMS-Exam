import { z } from 'zod';

export const setupSchema = z.object({
  answers: z.string().min(10, 'Las respuestas deben tener al menos 10 caracteres').max(4000, 'Respuesta muy larga'),
});

export const usernameSchema = z.object({
  username: z.string().trim().min(1, 'El nombre no puede estar vacío').max(60, 'Nombre muy largo'),
});
