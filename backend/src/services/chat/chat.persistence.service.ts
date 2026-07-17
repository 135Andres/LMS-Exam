import { v4 as uuidv4 } from 'uuid';
import { ChatModel } from '../../models/chat.model.js';
import { EmbeddingOutboxModel } from '../../models/embedding-outbox.model.js';

// Marcadores internos que la IA agrega a respuestas del asistente para
// señalizar al frontend (detección de cuestionario). Nunca deben persistirse:
// en un reload, addMessage() los re-detectaría y renderizaría botones
// "Responder"/"Explicar" sin el dataset.userMsgId que solo existe en vivo.
const QUIZ_MARKERS = ['[[QUIZ_DETECTED]]', '[[QUIZ_EXPLAIN_DONE]]'];

function stripQuizMarkers(content: string): string {
  let result = content;
  for (const marker of QUIZ_MARKERS) {
    result = result.split(marker).join('');
  }
  return result.trimEnd();
}

export class ChatPersistenceService {
  saveUserMessage(msgId: string, userId: string, sessionId: string, content: string): void {
    ChatModel.saveMessage(msgId, userId, sessionId, 'user', content);
  }

  saveAssistantMessage(msgId: string, userId: string, sessionId: string, content: string, model?: string): void {
    ChatModel.saveMessage(msgId, userId, sessionId, 'assistant', stripQuizMarkers(content), 0, model || null);
  }

  saveUserMessageWithOutbox(userId: string, sessionId: string, content: string): { msgId: string; outboxId: string } {
    const msgId = uuidv4();
    const outboxId = uuidv4();
    this.saveUserMessage(msgId, userId, sessionId, content);
    EmbeddingOutboxModel.enqueue(outboxId, msgId, userId, content, 'user');
    return { msgId, outboxId };
  }

  saveAssistantMessageWithOutbox(userId: string, sessionId: string, content: string, model?: string): string {
    const msgId = uuidv4();
    this.saveAssistantMessage(msgId, userId, sessionId, content, model);
    EmbeddingOutboxModel.enqueue(uuidv4(), msgId, userId, content, 'assistant');
    return msgId;
  }

  getSessionMessages(sessionId: string, limit?: number) {
    return ChatModel.getSessionMessages(sessionId, limit);
  }
}
