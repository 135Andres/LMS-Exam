// backend/src/services/chat/chat.quiz.service.ts
import { generateFromAI } from '../ai/index.js';
import { SYSTEM_PROMPT_QUIZ_SOLVE, SYSTEM_PROMPT_QUIZ_VERIFY } from '../../prompts/system.js';
import { logger } from '../../utils/logger.js';

interface SolvedItem {
  num: number;
  pregunta: string;
  desarrollo: string;
  respuesta: string;
}

interface VerifyResult {
  num: number;
  correcto: boolean;
  motivo: string;
}

const MAX_SOLVE_ATTEMPTS = 3;

function parseJSONArray<T>(raw: string): T[] {
  let cleaned = raw.trim();
  const jsonMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) cleaned = jsonMatch[1].trim();
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrayMatch) cleaned = arrayMatch[0];
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) throw new Error('La IA no devolvió un array');
  return parsed as T[];
}

async function solve(quizText: string): Promise<SolvedItem[]> {
  const result = await generateFromAI('nineRouter', SYSTEM_PROMPT_QUIZ_SOLVE, quizText);
  return parseJSONArray<SolvedItem>(result.content);
}

async function verify(items: SolvedItem[]): Promise<VerifyResult[]> {
  const userPrompt = JSON.stringify(items);
  const result = await generateFromAI('nineRouter', SYSTEM_PROMPT_QUIZ_VERIFY, userPrompt);
  return parseJSONArray<VerifyResult>(result.content);
}

function allCorrect(verifications: VerifyResult[]): boolean {
  return verifications.length > 0 && verifications.every(v => v.correcto === true);
}

function formatFinalMessage(items: SolvedItem[], lastVerification: VerifyResult[] | null): string {
  const failedNums = new Set(
    (lastVerification || []).filter(v => !v.correcto).map(v => v.num)
  );

  return items.map(item => {
    const warning = failedNums.has(item.num)
      ? '\n\n⚠️ No pude verificar esta respuesta con certeza, revísala con cuidado.'
      : '';
    return `**${item.num}.** ${item.pregunta}\n\nDesarrollo: ${item.desarrollo}\n\nRespuesta: ${item.respuesta}${warning}`;
  }).join('\n\n---\n\n');
}

// Resuelve un bloque de ejercicios y lo verifica dos veces antes de darlo por
// bueno. Si tras MAX_SOLVE_ATTEMPTS de resolución sigue habiendo ítems que no
// pasan verificación, se manda igual la última versión con advertencia por
// ítem — nunca se le niega la respuesta al estudiante.
export async function resolveQuiz(quizText: string): Promise<string> {
  let items: SolvedItem[] = [];
  let lastVerification: VerifyResult[] | null = null;

  for (let attempt = 1; attempt <= MAX_SOLVE_ATTEMPTS; attempt++) {
    items = await solve(quizText);

    const firstPass = await verify(items);
    if (!allCorrect(firstPass)) {
      lastVerification = firstPass;
      logger.warn('Verificación de cuestionario falló en primera pasada', { attempt });
      continue;
    }

    const secondPass = await verify(items);
    lastVerification = secondPass;
    if (allCorrect(secondPass)) {
      return formatFinalMessage(items, null);
    }
    logger.warn('Verificación de cuestionario falló en segunda pasada', { attempt });
  }

  logger.warn('Cuestionario no verificado tras agotar intentos, enviando última versión con advertencia', {
    attempts: MAX_SOLVE_ATTEMPTS,
  });
  return formatFinalMessage(items, lastVerification);
}
