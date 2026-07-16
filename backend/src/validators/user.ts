import { z } from 'zod';

export const setupSchema = z.object({
  answers: z.string().min(10, 'Las respuestas deben tener al menos 10 caracteres').max(4000, 'Respuesta muy larga'),
});

export const onboardingSchema = z.object({
  exam: z.string().min(1).max(200),
  archetype: z.enum(['sargento', 'profesor', 'compa', 'guia']),
  feedback_style: z.enum(['detalladas', 'cortas', 'numeros', 'libre']),
  strictness: z.enum(['alta', 'media', 'baja', 'maxima']),
});
