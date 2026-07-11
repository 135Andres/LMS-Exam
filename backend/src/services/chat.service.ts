import { v4 as uuidv4 } from 'uuid';
import { generateFromAI } from './ai/index.js';
import { callNvidiaStream, parseNvidiaStream } from './ai/nvidia.js';
import { config, modelRegistry } from '../config/index.js';
import { SYSTEM_PROMPT_TUTOR } from '../prompts/system.js';
import { ProfileService } from './profile.service.js';
import { logger } from '../utils/logger.js';
import { ChatPersistenceService } from './chat/chat.persistence.service.js';
import { ChatEmbeddingService } from './chat/chat.embedding.service.js';
import { ChatRAGService } from './chat/chat.rag.service.js';
import { ChatProfileDetectionService, isProfileEditIntent } from './chat/chat.profile-detection.service.js';

export { isProfileEditIntent };

const persistence = new ChatPersistenceService();
const embeddingService = new ChatEmbeddingService();
const ragService = new ChatRAGService();
const profileDetectionService = new ChatProfileDetectionService();

const TIMEOUT_MS = 30000;

interface Attachment {
  type: 'image' | 'audio' | 'file';
  mime: string;
  data: string;
}

function resolveModel(modelId?: string) {
  const entry = modelId && modelRegistry[modelId] ? modelRegistry[modelId] : null;
  return {
    model: entry?.model || config.models.chat,
    apiKey: entry?.apiKey,
    baseUrl: entry?.baseUrl,
    label: entry?.label || entry?.model || config.models.chat,
    multimodal: !!entry?.multimodal,
  };
}

function buildSystemPrompt(modelLabel: string, ragContext: string, userId: string): string {
  let prompt = SYSTEM_PROMPT_TUTOR.replace(/\{MODEL_NAME\}/g, modelLabel);

  const profile = ProfileService.getProfile(userId);
  if (profile) {
    prompt += `\n\n--- Perfil del estudiante ---\n${profile}\n---`;
  }

  if (ragContext) {
    prompt += ragContext;
  }
  return prompt;
}

export function buildContent(message: string, attachments?: Attachment[]): Array<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: message }];

  if (attachments && attachments.length > 0) {
    for (const att of attachments) {
      if (att.type === 'image') {
        content.push({ type: 'image_url', image_url: { url: `data:${att.mime};base64,${att.data}` } });
      } else if (att.type === 'audio') {
        content.push({ type: 'audio_url', audio_url: { url: `data:${att.mime};base64,${att.data}` } });
      } else if (att.type === 'file') {
        content.push({ type: 'text', text: `\n\n[Archivo adjunto: ${att.mime}, ${att.data.length} chars base64]` });
      }
    }
  }

  return content;
}

export async function sendChatMessageStream(
  message: string,
  modelId: string | undefined,
  attachments: Attachment[] | undefined,
  userId: string,
  sessionId: string,
): Promise<AsyncGenerator<{ type: string; content: string }>> {
  const resolved = resolveModel(modelId);

  if (attachments && attachments.length > 0 && !resolved.multimodal) {
    throw new Error(`El modelo **${resolved.label}** no soporta archivos adjuntos.`);
  }

  // Paso 1-2: guardar mensaje + encolar outbox
  const { msgId: userMsgId, outboxId } = persistence.saveUserMessageWithOutbox(userId, sessionId, message);

  // Paso 2b: generar embedding inline (best-effort para RAG inmediato)
  const queryVector = await embeddingService.generateAndSave(userMsgId, userId, message, outboxId);

  // Paso 3: RAG context usando el vector generado
  const ragContext = queryVector ? await ragService.buildContext(userId, userMsgId, queryVector) : '';

  // Paso 4: detectar edición de perfil desde el chat (fire-and-forget, no bloquea stream)
  profileDetectionService.detectAndApply(message, userId).catch(err =>
    logger.warn('Profile detection async failed', { error: (err as Error).message })
  );

  // Paso 5: construir prompts con RAG
  const systemPrompt = buildSystemPrompt(resolved.label, ragContext, userId);
  const content = buildContent(message, attachments);

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

  // Wrap generator: recolecta chunks de contenido (no reasoning) para guardar al cerrar
  async function* persistedStream(): AsyncGenerator<{ type: string; content: string }> {
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
        persistence.saveAssistantMessageWithOutbox(userId, sessionId, fullResponse);
      }
    }
  }

  return persistedStream();
}

export async function sendChatMessage(
  message: string,
  modelId: string | undefined,
  attachments: Attachment[] | undefined,
  userId: string,
  sessionId: string,
): Promise<{ response: string }> {
  const resolved = resolveModel(modelId);

  if (attachments && attachments.length > 0 && !resolved.multimodal) {
    throw new Error(`El modelo **${resolved.label}** no soporta archivos adjuntos.`);
  }

  logger.info('Enviando mensaje al tutor IA', {
    messageLength: message.length,
    model: resolved.model,
    modelId: modelId || 'default',
    attachmentsCount: attachments?.length || 0,
  });

  // Paso 1-2: guardar mensaje + encolar outbox
  const { msgId: userMsgId, outboxId } = persistence.saveUserMessageWithOutbox(userId, sessionId, message);

  // Paso 2b: generar embedding inline (best-effort para RAG inmediato)
  const queryVector = await embeddingService.generateAndSave(userMsgId, userId, message, outboxId);

  // Paso 3: RAG context usando el vector generado
  const ragContext = queryVector ? await ragService.buildContext(userId, userMsgId, queryVector) : '';

  // Paso 4: detectar edición de perfil desde el chat (fire-and-forget, no bloquea)
  profileDetectionService.detectAndApply(message, userId).catch(err =>
    logger.warn('Profile detection async failed', { error: (err as Error).message })
  );

  // Paso 5: construir prompts con RAG
  const systemPrompt = buildSystemPrompt(resolved.label, ragContext, userId);
  const content = buildContent(message, attachments);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const result = await generateFromAI(
      'nvidia',
      systemPrompt,
      content,
      null,
      { model: resolved.model, temperature: 0.5, apiKey: resolved.apiKey, baseUrl: resolved.baseUrl, signal: controller.signal },
    );

    persistence.saveAssistantMessageWithOutbox(userId, sessionId, result.content);

    return { response: result.content };
  } catch {
    return { response: `El modelo **${resolved.label}** no respondió a tiempo. Cambia a otro modelo desde el selector e intenta de nuevo.` };
  } finally {
    clearTimeout(timeoutId);
  }
}
