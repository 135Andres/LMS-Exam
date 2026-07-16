import { generateFromAI } from '../ai/index.js';
import { config } from '../../config/index.js';
import { ChatModel } from '../../models/chat.model.js';
import { SYSTEM_PROMPT_EXPORT } from '../../prompts/system.js';

export class SessionNotFoundError extends Error {}
export class SessionForbiddenError extends Error {}

// Exporta toda la sesión sintetizada en un documento Markdown para el
// usuario (no confundir con compactSession, que resume PARA otra IA).
// ponytail: una sola llamada a la IA con todo el transcript — conversaciones
// muy largas pueden exceder el contexto del modelo; si eso llega a pasar,
// agregar map-reduce por chunks aquí.
export async function exportSessionMarkdown(sessionId: string, userId: string): Promise<string> {
  try {
    ChatModel.assertSessionOwnership(sessionId, userId);
  } catch {
    throw new SessionForbiddenError('No tienes acceso a esta sesión');
  }
  if (!ChatModel.sessionExists(sessionId)) {
    throw new SessionNotFoundError('Sesión no encontrada');
  }

  const messages = ChatModel.getMessagesSince(sessionId, null)
    .filter(m => m.role === 'user' || m.role === 'assistant');

  if (messages.length === 0) {
    return '# Conversación vacía\n\nEsta sesión todavía no tiene mensajes.';
  }

  const transcript = messages.map(m => `[${m.role}] ${m.content}`).join('\n\n');

  const result = await generateFromAI('nineRouter', SYSTEM_PROMPT_EXPORT, transcript, null, {
    model: config.models.insights,
    temperature: 0.3,
    max_tokens: 3000,
  });

  return result.content;
}
