import { logger } from '../../utils/logger.js';
import type { AIResponse } from '../../types/db.js';

export interface NineRouterOptions {
  temperature?: number;
  signal?: AbortSignal;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  max_tokens?: number;
  history?: NineRouterMessage[];
}

export type StreamChunk = {
  type: 'reasoning' | 'content' | 'done';
  content: string;
  msgId?: string;
  userMsgId?: string;
  // Plan 07 — solo presente cuando la respuesta trae [[QUIZ_DETECTED]]: el
  // goal del perfil del estudiante, para que el frontend preseleccione
  // Responder/Explicar sin pedir el perfil aparte.
  quizGoal?: string;
};

const EMBEDDINGS_BASE_URL = 'https://integrate.api.nvidia.com/v1';
const EMBEDDINGS_API_KEY = process.env.NVIDIA_API_KEY_EMBEDDINGS || '';
const EMBEDDINGS_MODEL = process.env.NVIDIA_EMBEDDINGS_MODEL || 'nvidia/nv-embed-v1';

export {
  EMBEDDINGS_BASE_URL,
  EMBEDDINGS_API_KEY,
  EMBEDDINGS_MODEL,
};

export interface NineRouterMessage {
  role: string;
  content: string | Array<Record<string, unknown>>;
}

interface NineRouterResponse {
  choices?: Array<{ message?: { content?: string; reasoning_content?: string }; finish_reason?: string }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

// Algunos modelos (ej. los gemini/ag) devuelven SSE en chunks (delta) aunque
// no se pida stream:true. Reensambla esos chunks en la misma forma que un
// response normal de /chat/completions; si no es SSE, hace JSON.parse plano.
function parseNineRouterNonStreamResponse(raw: string): NineRouterResponse {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('data:')) {
    // Algunos modelos devuelven un JSON normal pero con "data: [DONE]" pegado
    // al final sin salto de línea (ej. oc/deepseek-v4-flash-free).
    const cleaned = trimmed.replace(/data:\s*\[DONE\]\s*$/, '').trim();
    return JSON.parse(cleaned) as NineRouterResponse;
  }

  let content = '';
  let reasoning = '';
  let finishReason: string | undefined;
  let usage: NineRouterResponse['usage'];

  for (const line of trimmed.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('data:') || t === 'data: [DONE]') continue;
    try {
      const chunk = JSON.parse(t.slice(5).trim());
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.content) content += delta.content;
      if (delta?.reasoning_content) reasoning += delta.reasoning_content;
      const msg = chunk.choices?.[0]?.message;
      if (msg?.content) content += msg.content;
      if (msg?.reasoning_content) reasoning += msg.reasoning_content;
      if (chunk.choices?.[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason;
      if (chunk.usage) usage = chunk.usage;
    } catch { /* skip malformed chunk */ }
  }

  return { choices: [{ message: { content, reasoning_content: reasoning }, finish_reason: finishReason }], usage };
}

export async function* parseNineRouterStream(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const t = line.trim();
      if (!t || t === 'data: [DONE]') continue;
      if (t.startsWith('data: ')) {
        try {
          const json = JSON.parse(t.slice(6));
          const reasoning = json.choices?.[0]?.delta?.reasoning_content;
          if (reasoning) yield { type: 'reasoning', content: reasoning };
          const content = json.choices?.[0]?.delta?.content;
          if (content) yield { type: 'content', content };
        } catch { /* skip malformed chunk */ }
      }
    }
  }
}

export async function callNineRouterStream(
  systemPrompt: string,
  userPrompt: string | Array<Record<string, unknown>>,
  options?: NineRouterOptions,
): Promise<Response> {
  const apiKey = process.env.NINE_ROUTER_API_KEY || '';
  const baseUrl = process.env.NINE_ROUTER_BASE_URL || 'https://rky8wp8.abc-tunnel.us/v1';
  const model = options?.model || 'nvidia/deepseek-ai/deepseek-v4-flash';

  const userContent = Array.isArray(userPrompt)
    ? userPrompt
    : [{ type: 'text' as const, text: userPrompt }];

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      ...(options?.history || []),
      { role: 'user', content: userContent },
    ] as NineRouterMessage[],
    max_tokens: options?.max_tokens ?? 4096,
    stream: true,
  };

  if (options?.temperature !== undefined) {
    body.temperature = options.temperature;
  }

  logger.debug('9router streaming call', { model });

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: options?.signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error('9router streaming error', { status: response.status, error: errorText });
    throw new Error(errorText);
  }

  return response;
}

export async function callNineRouter(
  systemPrompt: string,
  userPrompt: string | Array<Record<string, unknown>>,
  responseFormat: Record<string, unknown> | null = null,
  options?: NineRouterOptions,
): Promise<AIResponse> {
  const apiKey = process.env.NINE_ROUTER_API_KEY || '';
  const baseUrl = process.env.NINE_ROUTER_BASE_URL || 'https://rky8wp8.abc-tunnel.us/v1';
  const model = options?.model || 'nvidia/deepseek-ai/deepseek-v4-flash';

  const userContent = Array.isArray(userPrompt)
    ? userPrompt
    : [{ type: 'text' as const, text: userPrompt }];

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      ...(options?.history || []),
      { role: 'user', content: userContent },
    ] as NineRouterMessage[],
    max_tokens: options?.max_tokens ?? 4096,
  };

  if (options?.temperature !== undefined) {
    body.temperature = options.temperature;
  }

  if (responseFormat) {
    body.response_format = responseFormat;
  }

  const start = Date.now();
  logger.debug('Calling 9router', { model, temperature: body.temperature });

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    signal: options?.signal,
    body: JSON.stringify(body),
  });

  const elapsed = Date.now() - start;

  if (!response.ok) {
    const errorText = await response.text();
    logger.error('9router error', { status: response.status, error: errorText, elapsed });
    throw new Error(`9router API error ${response.status}: ${errorText}`);
  }

  const raw = await response.text();
  const data = parseNineRouterNonStreamResponse(raw);

  const content = data.choices?.[0]?.message?.content || '';
  const finishReason = data.choices?.[0]?.finish_reason;
  const usage = data.usage || {};

  logger.debug('9router response received', {
    elapsed,
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    finishReason,
  });

  return {
    content,
    usage: {
      promptTokens: usage.prompt_tokens || 0,
      completionTokens: usage.completion_tokens || 0,
    },
    finishReason,
  };
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const start = Date.now();

  const response = await fetch(`${EMBEDDINGS_BASE_URL}/embeddings`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${EMBEDDINGS_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: EMBEDDINGS_MODEL,
      input: text,
      encoding_format: 'float',
    }),
  });

  const elapsed = Date.now() - start;

  if (!response.ok) {
    const errorText = await response.text();
    logger.error('Error en NVIDIA embeddings API', { status: response.status, error: errorText, elapsed });
    throw new Error(`Embeddings API error ${response.status}: ${errorText}`);
  }

  const data = (await response.json()) as { data: Array<{ embedding: number[] }> };
  const vector = data.data[0]?.embedding;

  if (!vector || !Array.isArray(vector)) {
    throw new Error('Respuesta de embeddings inválida: falta el vector');
  }

  logger.debug('Embedding generado', { dimensions: vector.length, model: EMBEDDINGS_MODEL, elapsed });
  return vector;
}
