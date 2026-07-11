import { ChatPersistenceService } from './chat/chat.persistence.service.js';
import { ChatEmbeddingService } from './chat/chat.embedding.service.js';
import { ChatRAGService } from './chat/chat.rag.service.js';
import { ChatProfileDetectionService, isProfileEditIntent } from './chat/chat.profile-detection.service.js';
import { ChatModelRouter } from './chat/chat.model-router.js';
import { ChatPromptService, type Attachment } from './chat/chat.prompt.service.js';
import { ChatStreamingService } from './chat/chat.streaming.service.js';
import { ChatCompletionService } from './chat/chat.completion.service.js';

export { isProfileEditIntent };

const persistence = new ChatPersistenceService();
const embeddingService = new ChatEmbeddingService();
const ragService = new ChatRAGService();
const profileDetectionService = new ChatProfileDetectionService();
const modelRouter = new ChatModelRouter();
const promptService = new ChatPromptService();

const streamingService = new ChatStreamingService(
  persistence, embeddingService, ragService, profileDetectionService, modelRouter, promptService,
);
const completionService = new ChatCompletionService(
  persistence, embeddingService, ragService, profileDetectionService, modelRouter, promptService,
);

export function buildContent(message: string, attachments?: Attachment[]): Array<Record<string, unknown>> {
  return promptService.buildContent(message, attachments);
}

export async function sendChatMessageStream(
  message: string,
  modelId: string | undefined,
  attachments: Attachment[] | undefined,
  userId: string,
  sessionId: string,
): Promise<AsyncGenerator<{ type: string; content: string }>> {
  return streamingService.execute(message, modelId, attachments, userId, sessionId);
}

export async function sendChatMessage(
  message: string,
  modelId: string | undefined,
  attachments: Attachment[] | undefined,
  userId: string,
  sessionId: string,
): Promise<{ response: string }> {
  return completionService.execute(message, modelId, attachments, userId, sessionId);
}
