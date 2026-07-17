import { randomUUID } from 'node:crypto';
import { generateFromAI } from '../ai/index.js';
import { logger } from '../../utils/logger.js';
import { ChatModel } from '../../models/chat.model.js';
import { KnowledgeModel, hashKnowledgeContent } from '../../models/knowledge.model.js';
import { SessionSummaryService } from '../session-summary.service.js';
import { SYSTEM_PROMPT_COMPACTOR } from '../../prompts/system.js';
import { INKLING_MODEL_ID } from '../../config/models.js';

// Umbral para compactación automática en segundo plano (además del disparador
// explícito por cambio de modelo, que siempre compacta sin importar cuántos
// mensajes nuevos haya).
const MIN_MESSAGES_TO_COMPACT = 6;

// El modelo activo de la sesión ya demostró que entiende el vocabulario y
// nivel específico del estudiante — compactar con un modelo distinto agrega
// una traducción innecesaria. Cuando la familia activa no tiene variante
// liviana propia, se usa Gemini Flash como compactador cross-familia.
const COMPACTION_MODEL_MAP: Record<string, string> = {
  'ag/gemini-3-flash': 'ag/gemini-3-flash',
  'ag/gemini-3.1-pro-low': 'ag/gemini-3-flash',
  'ag/claude-sonnet-4-6': 'ag/gemini-3-flash',
  'nvidia/z-ai/glm-5.2': 'nvidia/z-ai/glm-5.2',
  [INKLING_MODEL_ID]: INKLING_MODEL_ID,
  'oc/deepseek-v4-flash-free': 'oc/deepseek-v4-flash-free',
};

function resolveCompactionModel(sessionId: string): string {
  const lastModel = ChatModel.getLastAssistantModel(sessionId);
  if (lastModel && COMPACTION_MODEL_MAP[lastModel]) return COMPACTION_MODEL_MAP[lastModel];
  // Sesión nueva sin modelo previo aún — Inkling es el default del chat.
  return INKLING_MODEL_ID;
}

interface CompactionResult {
  summary: string;
  confidence?: 'high' | 'medium' | 'low';
  reviewedMessageCount?: number;
  kbCandidates?: Array<{ content: string; subject: string; summary?: string }>;
}

const INITIAL_MAX_TOKENS = 3000;
const RETRY_MAX_TOKENS = 6000;

// Compacta lo nuevo desde el último corte (cursor) de una sesión: actualiza el
// resumen incremental en session-summary.service.ts y encola temas
// reutilizables detectados hacia la KB colectiva (mismo pipeline de
// validación que knowledge-detection.service.ts — kb-validator.service.ts).
export async function compactSession(sessionId: string, userId: string, force = false): Promise<void> {
  const cursor = ChatModel.getSummaryCursor(sessionId);
  const newMessages = ChatModel.getMessagesSince(sessionId, cursor)
    .filter(m => m.role === 'user' || m.role === 'assistant');

  if (newMessages.length === 0) return;
  if (!force && newMessages.length < MIN_MESSAGES_TO_COMPACT) return;

  const priorSummary = SessionSummaryService.getSummary(sessionId) || '(sin resumen previo, es el inicio de la conversación)';
  const transcript = newMessages.map(m => `[${m.role}] ${m.content}`).join('\n\n');
  const userPrompt = `--- Resumen previo ---\n${priorSummary}\n\n--- Mensajes nuevos ---\n${transcript}`;
  const model = resolveCompactionModel(sessionId);

  try {
    let result = await generateFromAI('nineRouter', SYSTEM_PROMPT_COMPACTOR, userPrompt, null, {
      model,
      temperature: 0.3,
      max_tokens: INITIAL_MAX_TOKENS,
    });

    if (result.finishReason === 'length') {
      logger.warn('Compactación truncada por max_tokens, reintentando con presupuesto mayor', { sessionId, model });
      result = await generateFromAI('nineRouter', SYSTEM_PROMPT_COMPACTOR, userPrompt, null, {
        model,
        temperature: 0.3,
        max_tokens: RETRY_MAX_TOKENS,
      });
    }

    // Nunca se acepta una respuesta truncada como resultado final — se
    // descarta el intento en vez de guardar un resumen a medias (spec 4.1).
    // ponytail: el cursor NO avanza acá, así que una sesión que trunca
    // repetido reprocesa el mismo (creciente) transcript en cada intento y
    // puede quedar en stall permanente — lo resuelve el pipeline de 2 pistas
    // de Fase 2 (bloques verbatim en vez de un resumen monolítico), no acá.
    if (result.finishReason === 'length') {
      logger.warn('Compactación sigue truncada tras reintento, se descarta este intento', { sessionId, model });
      return;
    }

    const parsed = JSON.parse(result.content) as CompactionResult;

    if (typeof parsed.reviewedMessageCount !== 'number') {
      logger.warn('reviewedMessageCount ausente en la respuesta del compactador', { sessionId, model });
    } else if (parsed.reviewedMessageCount < newMessages.length) {
      logger.warn('Posible cobertura incompleta: el compactador reportó menos mensajes revisados que los enviados', {
        sessionId, model, expected: newMessages.length, reviewedMessageCount: parsed.reviewedMessageCount,
      });
    }

    if (parsed.confidence && parsed.confidence !== 'high') {
      logger.warn('Compactación con confianza baja/media reportada por el modelo', {
        sessionId, model, confidence: parsed.confidence,
      });
    }

    if (!parsed.summary) return;

    SessionSummaryService.saveSummary(sessionId, parsed.summary);
    ChatModel.setSummaryCursor(sessionId, newMessages[newMessages.length - 1].created_at);

    for (const candidate of parsed.kbCandidates || []) {
      if (!candidate.content || candidate.content.trim().length < 40) continue;
      if (KnowledgeModel.existsByHash(hashKnowledgeContent(candidate.content))) continue;

      KnowledgeModel.create({
        id: randomUUID(),
        content: candidate.content,
        summary: candidate.summary,
        subject: candidate.subject || 'general',
        source_type: 'session_compaction',
        source_user_id: userId,
        tags: ['auto-detectado', 'compactacion'],
        status: 'pending_review',
      });
    }

    logger.info('Sesión compactada', {
      sessionId, model, messagesCompacted: newMessages.length, kbCandidates: parsed.kbCandidates?.length || 0,
      confidence: parsed.confidence, reviewedMessageCount: parsed.reviewedMessageCount,
    });
  } catch (err) {
    logger.warn('Error compactando sesión', { sessionId, model, error: (err as Error).message });
  }
}
