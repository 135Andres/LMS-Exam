import { z } from 'zod';

// Los enums se validan aquí (forma), la sanitización de texto libre
// (displayName/field/subjects) ocurre en UserProfileService.saveProfile —
// plan 02 — nunca se confía en el frontend para eso.
export const updateProfileSchema = z.object({
  displayName: z.string().max(200).optional(),
  level: z.enum(['prepa', 'uni', 'posgrado', 'otro']).optional(),
  field: z.string().max(200).optional(),
  subjects: z.array(z.string().max(200)).max(30).optional(),
  goal: z.enum(['examenes', 'entender', 'tareas', 'repaso', 'mixto']).optional(),
  depth: z.enum(['breve', 'detallado', 'auto']).optional(),
  register: z.enum(['tuteo', 'formal', 'neutro']).optional(),
});
