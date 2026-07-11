import { generateFromAI } from '../ai/index.js';
import { logger } from '../../utils/logger.js';
import type { ChatPersistenceService } from './chat.persistence.service.js';
import type { ChatEmbeddingService } from './chat.embedding.service.js';
import type { ChatRAGService } from './chat.rag.service.js';
import type { ChatProfileDetectionService } from './chat.profile-detection.service.js';
import type { ChatModelRouter } from './chat.model-router.js';
import type { ChatPromptService, Attachment } from './chat.prompt.service.js';

const TIMEOUT_MS = 30000;

export class ChatCompletionService {
  constructor(
    private persistence: ChatPersistenceService,
    private embeddingService: ChatEmbeddingService,
    private ragService: ChatRAGService,
    private profileDetectionService: ChatProfileDetectionService,
    private modelRouter: ChatModelRouter,
    private promptService: ChatPromptService,
  ) {}

  async execute(
    message: string,
    modelId: string | undefined,
    attachments: Attachment[] | undefined,
    userId: string,
    sessionId: string,
  ): Promise<{ response: string }> {
    const resolved = this.modelRouter.resolve(modelId);
    this.modelRouter.validateMultimodal(resolved, attachments);

    logger.info('Enviando mensaje al tutor IA', {
      messageLength: message.length,
      model: resolved.model,
      modelId: modelId || 'default',
      attachmentsCount: attachments?.length || 0,
    });

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

    try {
      const result = await generateFromAI(
        'nineRouter',
        systemPrompt,
        content,
        null,
        { model: resolved.model, temperature: 0.5, signal: controller.signal },
      );

      this.persistence.saveAssistantMessageWithOutbox(userId, sessionId, result.content);

      return { response: result.content };
    } catch {
      return { response: `El modelo **${resolved.label}** no respondió a tiempo. Cambia a otro modelo desde el selector e intenta de nuevo.` };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
