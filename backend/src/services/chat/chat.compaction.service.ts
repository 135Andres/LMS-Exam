import { randomUUID } from 'node:crypto';
import { generateFromAI } from '../ai/index.js';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { ChatModel } from '../../models/chat.model.js';
import { KnowledgeModel, hashKnowledgeContent } from '../../models/knowledge.model.js';
import { SessionSummaryService } from '../session-summary.service.js';
import { SYSTEM_PROMPT_COMPACTOR } from '../../prompts/system.js';

// Umbral para compactación automática en segundo plano (además del disparador
// explícito por cambio de modelo, que siempre compacta sin importar cuántos
// mensajes nuevos haya).
const MIN_MESSAGES_TO_COMPACT = 6;

interface CompactionResult {
  summary: string;
  kbCandidates?: Array<{ content: string; subject: string; summary?: string }>;
}

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

  try {
    const result = await generateFromAI('nineRouter', SYSTEM_PROMPT_COMPACTOR, userPrompt, null, {
      model: config.models.insights,
      temperature: 0.3,
      // deepseek-v4-flash-free razona pesado en reasoning_content antes del
      // JSON final (ver kb-validator.service.ts/insights.service.ts).
      max_tokens: 3000,
    });

    const parsed = JSON.parse(result.content) as CompactionResult;
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
      sessionId, messagesCompacted: newMessages.length, kbCandidates: parsed.kbCandidates?.length || 0,
    });
  } catch (err) {
    logger.warn('Error compactando sesión', { sessionId, error: (err as Error).message });
  }
}
