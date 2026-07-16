import { callNineRouterStream, parseNineRouterStream, type StreamChunk } from '../ai/nineRouter.js';
import { FALLBACK_MODEL } from '../ai/index.js';
import { logger } from '../../utils/logger.js';
import { ChatModel } from '../../models/chat.model.js';
import { detectAndSuggestKnowledge } from '../knowledge-detection.service.js';
import type { ChatPersistenceService } from './chat.persistence.service.js';
import type { ChatEmbeddingService } from './chat.embedding.service.js';
import type { ChatRAGService } from './chat.rag.service.js';
import type { ChatProfileDetectionService } from './chat.profile-detection.service.js';
import type { ChatModelRouter, ResolvedModel } from './chat.model-router.js';
import type { ChatPromptService, Attachment } from './chat.prompt.service.js';

const TIMEOUT_MS = 30000;

export class ChatStreamingService {
  constructor(
    private persistence: ChatPersistenceService,
    private embeddingService: ChatEmbeddingService,
    private ragService: ChatRAGService,
    private profileDetectionService: ChatProfileDetectionService,
    private modelRouter: ChatModelRouter,
    private promptService: ChatPromptService,
  ) {}

  async *execute(
    message: string,
    modelId: string | undefined,
    attachments: Attachment[] | undefined,
    userId: string,
    sessionId: string,
  ): AsyncGenerator<StreamChunk> {
    const resolved = this.modelRouter.resolve(modelId);
    this.modelRouter.validateMultimodal(resolved, attachments);

    const { msgId: userMsgId, outboxId } = this.persistence.saveUserMessageWithOutbox(userId, sessionId, message);

    const queryVector = await this.embeddingService.generateAndSave(userMsgId, userId, message, outboxId);

    const { context: ragContext, hadCollectiveMatch } = queryVector
      ? await this.ragService.buildContext(userId, userMsgId, queryVector, message)
      : { context: '', hadCollectiveMatch: false };

    this.profileDetectionService.detectAndApply(message, userId).catch(err =>
      logger.warn('Profile detection async failed', { error: (err as Error).message })
    );

    const systemPrompt = this.promptService.buildSystemPrompt(resolved.label, ragContext, userId);
    const content = this.promptService.buildContent(message, attachments);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let responseBody: ReadableStream<Uint8Array>;
    try {
      try {
        const response = await callNineRouterStream(systemPrompt, content, {
          model: resolved.model, signal: controller.signal,
        });
        responseBody = response.body!;
      } catch (err) {
        if (resolved.model === FALLBACK_MODEL) throw err;
        logger.warn('Modelo de chat falló, probando fallback', {
          model: resolved.model, fallback: FALLBACK_MODEL, error: (err as Error).message,
        });
        const response = await callNineRouterStream(systemPrompt, content, {
          model: FALLBACK_MODEL, signal: controller.signal,
        });
        responseBody = response.body!;
      }
    } finally {
      clearTimeout(timeoutId);
    }

    const originalStream = parseNineRouterStream(responseBody);

    async function* persistedStream(self: ChatStreamingService): AsyncGenerator<StreamChunk> {
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
          self.persistence.saveAssistantMessageWithOutbox(userId, sessionId, fullResponse);
          const recentMessages = ChatModel.getSessionMessages(sessionId, 10);
          detectAndSuggestKnowledge(userId, sessionId, recentMessages, hadCollectiveMatch).catch(
            err => logger.warn('Knowledge detection async failed', { error: (err as Error).message })
          );
        }
      }
    }

    yield* persistedStream(this);
  }
}
