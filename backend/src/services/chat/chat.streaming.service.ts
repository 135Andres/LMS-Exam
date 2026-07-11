import { callNvidiaStream, parseNvidiaStream, type StreamChunk } from '../ai/nvidia.js';
import { logger } from '../../utils/logger.js';
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

    const ragContext = queryVector ? await this.ragService.buildContext(userId, userMsgId, queryVector) : '';

    this.profileDetectionService.detectAndApply(message, userId).catch(err =>
      logger.warn('Profile detection async failed', { error: (err as Error).message })
    );

    const systemPrompt = this.promptService.buildSystemPrompt(resolved.label, ragContext, userId);
    const content = this.promptService.buildContent(message, attachments);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let responseBody: ReadableStream<Uint8Array>;
    try {
      const response = await callNvidiaStream(systemPrompt, content, {
        model: resolved.model, apiKey: resolved.apiKey, baseUrl: resolved.baseUrl, signal: controller.signal,
      });
      responseBody = response.body!;
    } finally {
      clearTimeout(timeoutId);
    }

    const originalStream = parseNvidiaStream(responseBody);

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
        }
      }
    }

    yield* persistedStream(this);
  }
}
