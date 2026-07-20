import { compileProfileLine, type UserProfile } from '../services/user-profile.service.js';

export type ProfileMode = 'full' | 'format-only' | 'none';

// Perfil solo con las líneas de FORMATO (depth/register) + nombre — sin
// materias/nivel/campo/objetivo/métodos de estudio. Para flujos donde el
// contexto académico sobra pero el formato de respuesta importa.
function compileFormatOnlyLine(profile: UserProfile): string {
  return compileProfileLine({
    ...profile,
    level: undefined,
    field: undefined,
    subjects: [],
    goal: undefined,
    studyMethods: [],
  });
}

// Punto único que decide qué prompt recibe perfil y cuál no.
//
// Regla de posición: la profile line SIEMPRE va al final del system prompt —
// el prefijo (reglas de formato compartidas) queda idéntico entre usuarios y
// cacheable por el provider si 9router lo soporta.
//
// Regla de historial: el perfil JAMÁS se agrega como mensaje user/assistant,
// solo aquí, en el system prompt. Así queda fuera de la compactación de
// historial y no consume contexto de conversación (ver prompt-composer.test.ts).
export function composeSystemPrompt(base: string, profile: UserProfile | null, mode: ProfileMode): string {
  if (mode === 'none' || !profile) return base;

  const line = mode === 'full' ? profile.profileLine : compileFormatOnlyLine(profile);
  if (!line) return base;

  return `${base}\n\n${line}`;
}
