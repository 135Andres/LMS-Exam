import { v4 as uuidv4 } from 'uuid';
import { ChatModel } from '../../models/chat.model.js';
import { EmbeddingOutboxModel } from '../../models/embedding-outbox.model.js';

export class ChatPersistenceService {
  saveUserMessage(msgId: string, userId: string, sessionId: string, content: string): void {
    ChatModel.saveMessage(msgId, userId, sessionId, 'user', content);
  }

  saveAssistantMessage(msgId: string, userId: string, sessionId: string, content: string): void {
    ChatModel.saveMessage(msgId, userId, sessionId, 'assistant', content);
  }

  saveUserMessageWithOutbox(userId: string, sessionId: string, content: string): { msgId: string; outboxId: string } {
    const msgId = uuidv4();
    const outboxId = uuidv4();
    this.saveUserMessage(msgId, userId, sessionId, content);
    EmbeddingOutboxModel.enqueue(outboxId, msgId, userId, content, 'user');
    return { msgId, outboxId };
  }

  saveAssistantMessageWithOutbox(userId: string, sessionId: string, content: string): string {
    const msgId = uuidv4();
    this.saveAssistantMessage(msgId, userId, sessionId, content);
    EmbeddingOutboxModel.enqueue(uuidv4(), msgId, userId, content, 'assistant');
    return msgId;
  }

  getSessionMessages(sessionId: string, limit?: number) {
    return ChatModel.getSessionMessages(sessionId, limit);
  }
}
