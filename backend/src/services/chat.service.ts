import { v4 as uuidv4 } from 'uuid';
import { generateFromAI } from './ai/index.js';
import { callNvidiaStream, parseNvidiaStream } from './ai/nvidia.js';
import { generateEmbedding } from './ai/embeddings.js';
import { config, modelRegistry } from '../config/index.js';
import { SYSTEM_PROMPT_TUTOR } from '../prompts/system.js';
import { EmbeddingModel } from '../models/embedding.model.js';
import { EmbeddingOutboxModel } from '../models/embedding-outbox.model.js';
import { ProfileService } from './profile.service.js';
import { findTopK } from '../utils/vector.js';
import { logger } from '../utils/logger.js';
import { ChatPersistenceService } from './chat/chat.persistence.service.js';

const persistence = new ChatPersistenceService();

const TIMEOUT_MS = 30000;
const RAG_MIN_EMBEDDINGS = 2;
const RAG_TOP_K = 3;

const PROFILE_EDIT_REGEX = /\b(?:quiero que|cambia mi|actualiza mi|prefiero que|configura mi|ajusta mi|modifica mi)\b/i;

function isProfileEditIntent(message: string): boolean {
  if (PROFILE_EDIT_REGEX.test(message)) return true;
  return false;
}
export { isProfileEditIntent };

const SYSTEM_PROMPT_CLASSIFIER = `Eres un clasificador de intención. Analiza si el mensaje del estudiante contiene una instrucción para CAMBIAR o AJUSTAR la forma en que el tutor IA debe comportarse (preferencias de aprendizaje, tono, profundidad, temas, etc.).

Responde ÚNICAMENTE con JSON, sin markdown ni explicaciones extra:

- Si el mensaje SÍ expresa una preferencia o cambio: {"update_profile": true, "change": "descripción clara del cambio que pide"}
- Si el mensaje NO expresa una preferencia (es una pregunta normal, saludo, ejercicio, etc.): {"update_profile": false}

Ejemplos:
Mensaje: "explícame qué es una derivada" → {"update_profile": false}
Mensaje: "cambia tu forma de explicar, hazlo más sencillo" → {"update_profile": true, "change": "Prefiere explicaciones más sencillas"}
Mensaje: "ahora vamos a estudiar química orgánica" → {"update_profile": true, "change": "Cambiando enfoque a química orgánica"}
Mensaje: "evita usar ejemplos de física" → {"update_profile": true, "change": "No usar ejemplos de física"}
Mensaje: "hola" → {"update_profile": false}`;

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

async function buildRagContext(userId: string, excludeMessageId: string, queryVector: number[]): Promise<string> {
  try {
    const pastEmbeddings = EmbeddingModel.getUserEmbeddings(userId, 100);
    const filtered = pastEmbeddings.filter(e => e.messageId !== excludeMessageId);

    if (filtered.length < RAG_MIN_EMBEDDINGS) return '';

    const topK = findTopK(queryVector, filtered, RAG_TOP_K);
    logger.debug('RAG context recuperado', {
      total_embeddings: filtered.length,
      above_threshold: topK.length,
      min_score: topK.length > 0 ? topK[topK.length - 1].score.toFixed(3) : 'N/A',
      max_score: topK.length > 0 ? topK[0].score.toFixed(3) : 'N/A',
    });
    if (topK.length === 0) return '';

    const contextParts = topK.map((item, i) => {
      const roleLabel = item.role === 'assistant' ? 'Tu explicación anterior' : 'Pregunta anterior';
      return `[Contexto ${i + 1}] (${roleLabel}, relevancia: ${(item.score * 100).toFixed(0)}%)\n${item.content}`;
    });

    return `\n\n--- Contexto de conversaciones anteriores ---\n${contextParts.join('\n\n')}\n---`;
  } catch (err) {
    logger.warn('Error generando RAG context', { error: (err as Error).message });
    return '';
  }
}

function buildSystemPrompt(modelLabel: string, ragContext: string, userId: string): string {
  let prompt = SYSTEM_PROMPT_TUTOR.replace(/\{MODEL_NAME\}/g, modelLabel);

  // Inyectar perfil del estudiante si existe
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

// Fase 4: clasificador de edición de perfil
async function detectProfileEdit(message: string, userId: string): Promise<string | null> {
  if (!isProfileEditIntent(message)) return null;

  try {
    const result = await generateFromAI('nvidia', SYSTEM_PROMPT_CLASSIFIER, message, {
      type: 'json_object',
      json_schema: {
        type: 'object',
        properties: {
          update_profile: { type: 'boolean' },
          change: { type: 'string' },
        },
        required: ['update_profile'],
      },
    }, { model: config.models.chat, temperature: 0.1, max_tokens: 150 });

    const parsed = JSON.parse(result.content) as { update_profile: boolean; change?: string };
    if (parsed.update_profile && parsed.change) {
      logger.info('Perfil actualizado desde chat', { userId, change: parsed.change });
      ProfileService.appendToProfile(userId, parsed.change);
      ProfileService.invalidateCache(userId);
      return parsed.change;
    }
    logger.debug('ProfileEdit: clasificador descartó (regex pasó pero IA dice no)', {
      message_preview: message.slice(0, 50)
    });
  } catch (err) {
    logger.warn('Error en clasificador de perfil', { error: (err as Error).message });
  }

  return null;
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
  let queryVector: number[] | null = null;
  try {
    queryVector = await generateEmbedding(message);
    if (queryVector) {
      const embId = uuidv4();
      EmbeddingModel.saveEmbedding(embId, userMsgId, userId, queryVector, config.embeddings.model, config.embeddings.dimensions);
      EmbeddingOutboxModel.markDone(outboxId);
    }
  } catch (err) {
    logger.warn('Embedding inline falló, worker lo reintentará', { error: (err as Error).message });
  }

  // Paso 3: RAG context usando el vector generado
  const ragContext = queryVector ? await buildRagContext(userId, userMsgId, queryVector) : '';

  // Paso 4: detectar edición de perfil desde el chat (fire-and-forget, no bloquea stream)
  detectProfileEdit(message, userId).catch(err =>
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
  let queryVector: number[] | null = null;
  try {
    queryVector = await generateEmbedding(message);
    if (queryVector) {
      const embId = uuidv4();
      EmbeddingModel.saveEmbedding(embId, userMsgId, userId, queryVector, config.embeddings.model, config.embeddings.dimensions);
      EmbeddingOutboxModel.markDone(outboxId);
    }
  } catch (err) {
    logger.warn('Embedding inline falló, worker lo reintentará', { error: (err as Error).message });
  }

  // Paso 3: RAG context usando el vector generado
  const ragContext = queryVector ? await buildRagContext(userId, userMsgId, queryVector) : '';

  // Paso 4: detectar edición de perfil desde el chat (fire-and-forget, no bloquea)
  detectProfileEdit(message, userId).catch(err =>
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
