import { callNineRouterStream, parseNineRouterStream, type StreamChunk } from '../ai/nineRouter.js';
import { FALLBACK_MODEL } from '../ai/index.js';
import { logger } from '../../utils/logger.js';
import { ChatModel } from '../../models/chat.model.js';
import { UserModel } from '../../models/user.model.js';
import { EmbeddingModel } from '../../models/embedding.model.js';
import { detectAndSuggestKnowledge } from '../knowledge-detection.service.js';
import { compactSession } from './chat.compaction.service.js';
import { mightReferenceOtherChat, buildCrossChatContext } from './chat.cross-reference.service.js';
import type { ChatPersistenceService } from './chat.persistence.service.js';
import type { ChatEmbeddingService } from './chat.embedding.service.js';
import type { ChatRAGService } from './chat.rag.service.js';
import type { ChatProfileDetectionService } from './chat.profile-detection.service.js';
import type { ChatModelRouter } from './chat.model-router.js';
import { buildEffortInstruction, type ChatOrchestratorService } from './chat.orchestrator.service.js';
import type { ChatPromptService, Attachment } from './chat.prompt.service.js';

const TIMEOUT_MS = 30000;
// Cola cruda desde el último corte de resumen — normalmente pequeña, porque
// la compactación en segundo plano va adelantando el cursor. El cap es solo
// una red de seguridad si la compactación viene fallando repetido.
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

// Si el modelo cambió respecto a la última respuesta de la sesión, compacta
// YA (bloqueante) para que el modelo nuevo arranque con el resumen al día —
// esa es la razón de ser del compactador. Si no cambió, solo dispara la
// compactación de fondo (no bloqueante) cuando ya se acumularon suficientes
// mensajes nuevos.
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

export class ChatStreamingService {
  constructor(
    private persistence: ChatPersistenceService,
    private embeddingService: ChatEmbeddingService,
    private ragService: ChatRAGService,
    private profileDetectionService: ChatProfileDetectionService,
    private modelRouter: ChatModelRouter,
    private promptService: ChatPromptService,
    private orchestrator: ChatOrchestratorService,
  ) {}

  async *execute(
    message: string,
    modelId: string | undefined,
    attachments: Attachment[] | undefined,
    userId: string,
    sessionId: string,
  ): AsyncGenerator<StreamChunk> {
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
    const decision = modelId ? undefined : this.orchestrator.decide(message, ragContext.length, attachments);
    const resolved = this.modelRouter.resolve(decision?.model ?? modelId);
    this.modelRouter.validateMultimodal(resolved, attachments);

    // Corre después de calcular `history` a propósito, ver comentario análogo
    // en chat.completion.service.ts.
    await ensureContextForModel(sessionId, userId, resolved.model);

    this.profileDetectionService.detectAndApply(message, userId).catch(err =>
      logger.warn('Profile detection async failed', { error: (err as Error).message })
    );

    // Solo se lee OTRO chat si el estudiante lo pide explícitamente (ver
    // chat.cross-reference.service.ts) — nunca por defecto. Además respeta
    // el switch maestro del usuario (Settings → Capacidades → Cross-Chats).
    const crossChatEnabled = UserModel.findById(userId)?.cross_chat_enabled !== 0;
    const crossChatContext = crossChatEnabled && mightReferenceOtherChat(message)
      ? await buildCrossChatContext(message, userId, sessionId)
      : '';

    let systemPrompt = this.promptService.buildSystemPrompt(resolved.label, ragContext, userId, undefined, sessionId, crossChatContext);
    if (decision?.effort !== undefined) systemPrompt += buildEffortInstruction(decision.effort);
    const content = this.promptService.buildContent(message, attachments);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let responseBody: ReadableStream<Uint8Array>;
    let usedModel = resolved.model;
    try {
      try {
        const response = await callNineRouterStream(systemPrompt, content, {
          model: resolved.model, signal: controller.signal, history,
        });
        responseBody = response.body!;
      } catch (err) {
        if (resolved.model === FALLBACK_MODEL) throw err;
        logger.warn('Modelo de chat falló, probando fallback', {
          model: resolved.model, fallback: FALLBACK_MODEL, error: (err as Error).message,
        });
        usedModel = FALLBACK_MODEL;
        const response = await callNineRouterStream(systemPrompt, content, {
          model: FALLBACK_MODEL, signal: controller.signal, history,
        });
        responseBody = response.body!;
      }
    } finally {
      clearTimeout(timeoutId);
    }

    const originalStream = parseNineRouterStream(responseBody);
    yield* this.persistAndYield(originalStream, userId, sessionId, hadCollectiveMatch, usedModel, userMsgId);
  }

  private async *persistAndYield(
    originalStream: AsyncGenerator<StreamChunk>,
    userId: string,
    sessionId: string,
    hadCollectiveMatch: boolean,
    model: string,
    userMsgId?: string,
  ): AsyncGenerator<StreamChunk> {
    let fullResponse = '';
    try {
      for await (const chunk of originalStream) {
        if (chunk.type === 'content') {
          fullResponse += chunk.content;
        }
        yield chunk;
      }
    } finally {
      if (fullResponse) {
        const msgId = this.persistence.saveAssistantMessageWithOutbox(userId, sessionId, fullResponse, model);
        yield { type: 'done', content: '', msgId, userMsgId };
        const recentMessages = ChatModel.getSessionMessages(sessionId, 10);
        detectAndSuggestKnowledge(userId, sessionId, recentMessages, hadCollectiveMatch).catch(
          err => logger.warn('Knowledge detection async failed', { error: (err as Error).message })
        );
      }
    }
  }

  // Re-genera la última respuesta de la IA en una sesión con un enfoque distinto
  // (o siguiendo una instrucción explícita del estudiante, ej. "con una analogía de cocina").
  // Solo opera sobre el último intercambio user→assistant — regenerar respuestas
  // de en medio del historial dejaría inconsistente todo lo que se habló después.
  async *regenerate(
    sessionId: string,
    modelId: string | undefined,
    userId: string,
    instruction: string | undefined,
  ): AsyncGenerator<StreamChunk> {
    const recent = ChatModel.getSessionMessages(sessionId, 1000);
    const last = recent[recent.length - 1];
    const prev = recent[recent.length - 2];

    if (!last || last.role !== 'assistant' || !prev || prev.role !== 'user') {
      throw new Error('NOT_LAST_EXCHANGE');
    }

    const queryVector = EmbeddingModel.getVectorByMessageId(prev.id);
    const { context: ragContext, hadCollectiveMatch } = queryVector
      ? await this.ragService.buildContext(userId, prev.id, queryVector, prev.content)
      : { context: '', hadCollectiveMatch: false };

    const decision = modelId ? undefined : this.orchestrator.decide(prev.content, ragContext.length);
    const resolved = this.modelRouter.resolve(decision?.model ?? modelId);
    ChatModel.deleteMessage(last.id, userId);

    await ensureContextForModel(sessionId, userId, resolved.model);
    const history = buildRawTail(sessionId);

    let systemPrompt = this.promptService.buildSystemPrompt(resolved.label, ragContext, userId, instruction ?? '', sessionId);
    if (decision?.effort !== undefined) systemPrompt += buildEffortInstruction(decision.effort);
    const content = this.promptService.buildContent(prev.content);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let responseBody: ReadableStream<Uint8Array>;
    let usedModel = resolved.model;
    try {
      try {
        const response = await callNineRouterStream(systemPrompt, content, {
          model: resolved.model, signal: controller.signal, history,
        });
        responseBody = response.body!;
      } catch (err) {
        if (resolved.model === FALLBACK_MODEL) throw err;
        logger.warn('Modelo de chat falló en regenerate, probando fallback', {
          model: resolved.model, fallback: FALLBACK_MODEL, error: (err as Error).message,
        });
        usedModel = FALLBACK_MODEL;
        const response = await callNineRouterStream(systemPrompt, content, {
          model: FALLBACK_MODEL, signal: controller.signal, history,
        });
        responseBody = response.body!;
      }
    } finally {
      clearTimeout(timeoutId);
    }

    const originalStream = parseNineRouterStream(responseBody);
    yield* this.persistAndYield(originalStream, userId, sessionId, hadCollectiveMatch, usedModel, prev.id);
  }
}
