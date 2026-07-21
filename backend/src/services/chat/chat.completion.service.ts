import { generateFromAI } from '../ai/index.js';
import { logger } from '../../utils/logger.js';
import { getModelLabel } from '../../config/models.js';
import { ChatModel } from '../../models/chat.model.js';
import { UserProfileService } from '../user-profile.service.js';
import { detectAndSuggestKnowledge } from '../knowledge-detection.service.js';
import { compactSession } from './chat.compaction.service.js';
import type { ChatPersistenceService } from './chat.persistence.service.js';
import type { ChatEmbeddingService } from './chat.embedding.service.js';
import type { ChatRAGService } from './chat.rag.service.js';
import type { ChatProfileDetectionService } from './chat.profile-detection.service.js';
import type { ChatModelRouter } from './chat.model-router.js';
import { buildEffortInstruction, type ChatOrchestratorService } from './chat.orchestrator.service.js';
import type { ChatPromptService, Attachment } from './chat.prompt.service.js';

// Ver comentario análogo en chat.streaming.service.ts — Inkling puede tardar
// mucho más de 30s en responder.
const TIMEOUT_MS = 120000;
const RAW_TAIL_CAP = 30;
const RAW_TAIL_MSG_MAX_CHARS = 2000;

function buildRawTail(sessionId: string) {
  const cursor = ChatModel.getSummaryCursor(sessionId);
  const messages = ChatModel.getMessagesSince(sessionId, cursor)
    .filter(m => m.role === 'user' || m.role === 'assistant');
  return messages
    .slice(-RAW_TAIL_CAP)
    .map(m => ({ role: m.role, content: m.content.slice(0, RAW_TAIL_MSG_MAX_CHARS) }));
}

async function ensureContextForModel(sessionId: string, userId: string, resolvedModel: string): Promise<void> {
  const lastModel = ChatModel.getLastAssistantModel(sessionId);
  if (lastModel && lastModel !== resolvedModel) {
    await compactSession(sessionId, userId, true);
  } else {
    compactSession(sessionId, userId, false).catch(err =>
      logger.warn('Compactación en segundo plano falló', { error: (err as Error).message })
    );
  }
}

export class ChatCompletionService {
  constructor(
    private persistence: ChatPersistenceService,
    private embeddingService: ChatEmbeddingService,
    private ragService: ChatRAGService,
    private profileDetectionService: ChatProfileDetectionService,
    private modelRouter: ChatModelRouter,
    private promptService: ChatPromptService,
    private orchestrator: ChatOrchestratorService,
  ) {}

  async execute(
    message: string,
    modelId: string | undefined,
    attachments: Attachment[] | undefined,
    userId: string,
    sessionId: string,
  ): Promise<{ response: string }> {
    // Se toma ANTES de persistir el mensaje actual — de lo contrario aparecería
    // duplicado (una vez en `history`, otra vez en `content`).
    const history = buildRawTail(sessionId);

    const { msgId: userMsgId, outboxId } = this.persistence.saveUserMessageWithOutbox(userId, sessionId, message);

    const queryVector = await this.embeddingService.generateAndSave(userMsgId, userId, message, outboxId);

    const { context: ragContext, hadCollectiveMatch } = queryVector
      ? await this.ragService.buildContext(userId, userMsgId, queryVector, message)
      : { context: '', hadCollectiveMatch: false };

    // Si el usuario forzó un modelo desde el selector, se respeta esa elección
    // manual y no se orquesta.
    const decision = modelId ? undefined : this.orchestrator.decide(message, ragContext.length, attachments, UserProfileService.getProfile(userId)?.subjects);
    const resolved = this.modelRouter.resolve(decision?.model ?? modelId);
    this.modelRouter.validateMultimodal(resolved, attachments, !!modelId);

    logger.info('Enviando mensaje al tutor IA', {
      messageLength: message.length,
      model: resolved.model,
      modelId: modelId || 'default',
      attachmentsCount: attachments?.length || 0,
    });

    // Corre después de calcular `history` a propósito: si el modelo cambió,
    // esta compactación bloqueante ya no alcanza a angostar el `history` de
    // ESTE turno (sí lo hará para el próximo) — trade-off aceptado para no
    // acoplar la resolución del modelo a la construcción del historial.
    await ensureContextForModel(sessionId, userId, resolved.model);

    this.profileDetectionService.detectAndApply(message, userId).catch(err =>
      logger.warn('Profile detection async failed', { error: (err as Error).message })
    );

    let systemPrompt = this.promptService.buildSystemPrompt(resolved.label, ragContext, userId, undefined, sessionId);
    if (decision?.effort !== undefined) systemPrompt += buildEffortInstruction(decision.effort);
    const content = this.promptService.buildContent(message, attachments);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const result = await generateFromAI(
        'nineRouter',
        systemPrompt,
        content,
        null,
        { model: resolved.model, temperature: 0.5, signal: controller.signal, history },
      );

      this.persistence.saveAssistantMessageWithOutbox(userId, sessionId, result.content, resolved.model);
      const recentMessages = ChatModel.getSessionMessages(sessionId, 10);
      detectAndSuggestKnowledge(userId, sessionId, recentMessages, hadCollectiveMatch).catch(
        err => logger.warn('Knowledge detection async failed', { error: (err as Error).message })
      );

      return { response: result.content };
    } catch {
      // Si el usuario no eligió modelo explícito, resolved.model puede ser una
      // delegación automática interna de Inkling — nunca se nombra al usuario
      // (ver FIX 3, consolidado post-planes 01-06).
      const label = modelId ? getModelLabel(resolved.model) : 'Inkling';
      return { response: `El modelo **${label}** no respondió a tiempo. Cambia a otro modelo desde el selector e intenta de nuevo.` };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
