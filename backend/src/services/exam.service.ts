import { SYSTEM_PROMPT_EXAM, SYSTEM_SUGERIR_PROMPT, SYSTEM_PROMPT_POLISH } from '../prompts/system.js';
import { generateFromAI } from './ai/index.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import type { AIResponse, ExamQuestion } from '../types/db.js';

const MAX_PARSE_RETRIES = 2;

function parseAndCleanJSON(raw: string): unknown {
  let cleaned = raw.trim();

  const jsonMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    cleaned = jsonMatch[1].trim();
  }

  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    cleaned = arrayMatch[0];
  }

  return JSON.parse(cleaned);
}

function validateQuestion(q: Record<string, unknown>, index: number): ExamQuestion {
  if (!q.pregunta || typeof q.pregunta !== 'string') {
    throw new Error(`Pregunta ${index}: campo 'pregunta' inválido`);
  }

  if (!Array.isArray(q.opciones) || q.opciones.length !== 4) {
    throw new Error(`Pregunta ${index}: se requieren exactamente 4 opciones`);
  }

  if (!q.respuesta_correcta || typeof q.respuesta_correcta !== 'string' || !(q.opciones as string[]).includes(q.respuesta_correcta)) {
    throw new Error(`Pregunta ${index}: respuesta_correcta no coincide con ninguna opción`);
  }

  if (!q.justificacion || typeof q.justificacion !== 'string') {
    throw new Error(`Pregunta ${index}: campo 'justificacion' inválido`);
  }

  return {
    pregunta: (q.pregunta as string).trim(),
    opciones: (q.opciones as string[]).map(o => o.trim()),
    respuesta_correcta: (q.respuesta_correcta as string).trim(),
    justificacion: (q.justificacion as string).trim(),
  };
}

async function generateWithParseRetry(
  name: string,
  subtopics: string[],
  numQuestions: number,
): Promise<{ questions: ExamQuestion[]; usage: AIResponse['usage'] }> {
  let parseAttempt = 0;

  while (parseAttempt <= MAX_PARSE_RETRIES) {
    const userPrompt = `Genera un examen llamado "${name}" con ${numQuestions} preguntas distribuidas uniformemente entre estos subtemas:\n${subtopics.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\nDistribuye las preguntas de manera balanceada entre todos los subtemas.\n\nIMPORTANTE: Responde SOLO con un array JSON válido. Nada de markdown, nada de texto adicional.`;

    logger.info('Generando examen con IA', {
      name,
      subtopics,
      numQuestions,
      parseAttempt: parseAttempt + 1,
    });

    const result = await generateFromAI('nineRouter', SYSTEM_PROMPT_EXAM, userPrompt);

    try {
      const questions = parseAndCleanJSON(result.content) as unknown[];

      if (!Array.isArray(questions)) {
        throw new Error('La IA no generó un array de preguntas');
      }

      const validated = questions.map((q, i) => validateQuestion(q as Record<string, unknown>, i));

      if (parseAttempt > 0) {
        logger.info('Reintento de parseo exitoso', { parseAttempt: parseAttempt + 1 });
      }

      logger.info('Examen generado exitosamente', {
        questionsCount: validated.length,
        usage: result.usage,
      });

      return { questions: validated, usage: result.usage };
    } catch (err) {
      logger.error('Error parseando respuesta de IA', {
        attempt: parseAttempt + 1,
        error: (err as Error).message,
        raw: result.content.slice(0, 500),
      });

      if (parseAttempt >= MAX_PARSE_RETRIES) {
        throw new Error(`La IA no generó un formato válido después de ${MAX_PARSE_RETRIES + 1} intentos. Intente de nuevo con un temario más específico.`);
      }

      parseAttempt++;
    }
  }

  throw new Error('Error inesperado al generar examen');
}

export async function generateExam(
  name: string,
  subtopics: string[],
  numQuestions: number,
): Promise<{ questions: ExamQuestion[]; usage: AIResponse['usage'] }> {
  return generateWithParseRetry(name, subtopics, numQuestions);
}

export async function suggestSubtopics(syllabusText: string): Promise<string[]> {
  const userPrompt = `Analiza el siguiente temario y extrae una lista de subtemas específicos y enseñables:\n\n${syllabusText}`;

  logger.info('Sugiriendo subtemas desde temario');

  const result = await generateFromAI('nineRouter', SYSTEM_SUGERIR_PROMPT, userPrompt);

  try {
    const subtopics = parseAndCleanJSON(result.content) as string[];

    if (!Array.isArray(subtopics)) {
      throw new Error('La respuesta no es un array');
    }

    return subtopics.filter(s => typeof s === 'string' && s.trim().length > 0);
  } catch (err) {
    logger.error('Error parseando subtemas sugeridos', { error: (err as Error).message });
    throw new Error('No se pudieron extraer subtemas del temario');
  }
}

export async function polishQuestion(
  question: ExamQuestion,
  userMessage: string,
): Promise<{ response: string; suggestedQuestion?: ExamQuestion }> {
  const currentQuestionJSON = JSON.stringify(question, null, 2);

  const userPrompt = `Esta es la pregunta actual del examen:

\`\`\`json
${currentQuestionJSON}
\`\`\`

El usuario solicita: ${userMessage}

Responde con consejo útil o, si procede, devuelve la pregunta modificada completa en el formato JSON especificado.`;

  logger.info('Enviando solicitud de pulido a DeepSeek', {
    question: question.pregunta.slice(0, 60),
    userMessage: userMessage.slice(0, 60),
    model: config.models.polish,
  });

  const result = await generateFromAI(
    'nvidia',
    SYSTEM_PROMPT_POLISH,
    userPrompt,
    null,
    { model: config.models.polish, temperature: 0.5 },
  );

  const content = result.content.trim();

  // Intentar extraer JSON suggestedQuestion si existe
  const jsonMatch = content.match(/\{[\s\S]*"suggestedQuestion"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.suggestedQuestion && parsed.suggestedQuestion.pregunta) {
        const sq = parsed.suggestedQuestion;
        const suggestedQuestion: ExamQuestion = {
          pregunta: sq.pregunta,
          opciones: sq.opciones,
          respuesta_correcta: sq.respuesta_correcta,
          justificacion: sq.justificacion,
        };
        return { response: parsed.explicacion || 'Pregunta modificada', suggestedQuestion };
      }
    } catch {
      // Si falla el parse, devolver solo texto
    }
  }

  return { response: content };
}

export function calculateCost(usage: AIResponse['usage']): number {
  const inputPricePer1k = 0.0002;
  const outputPricePer1k = 0.0004;

  const inputCost = (usage.promptTokens / 1000) * inputPricePer1k;
  const outputCost = (usage.completionTokens / 1000) * outputPricePer1k;

  return parseFloat((inputCost + outputCost).toFixed(6));
}
