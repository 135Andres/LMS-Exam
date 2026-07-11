import { logger } from '../../utils/logger.js';
import type { AIResponse } from '../../types/db.js';

export interface NineRouterOptions {
  temperature?: number;
  signal?: AbortSignal;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  max_tokens?: number;
}

export type StreamChunk = {
  type: 'reasoning' | 'content';
  content: string;
};

const EMBEDDINGS_BASE_URL = 'https://integrate.api.nvidia.com/v1';
const EMBEDDINGS_API_KEY = process.env.NVIDIA_API_KEY_EMBEDDINGS || '';
const EMBEDDINGS_MODEL = process.env.NVIDIA_EMBEDDINGS_MODEL || 'nvidia/nv-embed-v1';

export {
  EMBEDDINGS_BASE_URL,
  EMBEDDINGS_API_KEY,
  EMBEDDINGS_MODEL,
};

interface NineRouterMessage {
  role: string;
  content: string | Array<Record<string, unknown>>;
}

interface NineRouterResponse {
  choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

let modelsCache: { id: string; label: string; owned_by: string }[] = [];
let modelsCacheTime = 0;

export async function fetchAvailableModels(): Promise<{ id: string; label: string; owned_by: string }[]> {
  const now = Date.now();
  if (modelsCache.length > 0 && now - modelsCacheTime < 300000) return modelsCache;

  try {
    const apiKey = process.env.NINE_ROUTER_API_KEY || '';
    const baseUrl = process.env.NINE_ROUTER_BASE_URL || 'https://rky8wp8.abc-tunnel.us/v1';
    const response = await fetch(`${baseUrl}/models`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!response.ok) throw new Error(`9router /models returned ${response.status}`);
    const data = (await response.json()) as { data: Array<{ id: string; owned_by: string }> };
    modelsCache = data.data.map(m => ({
      id: m.id,
      label: m.id.split('/').pop() || m.id,
      owned_by: m.owned_by,
    }));
    modelsCacheTime = now;
    logger.info('9router models fetched', { count: modelsCache.length });
    return modelsCache;
  } catch (err) {
    logger.warn('Failed to fetch 9router models', { error: (err as Error).message });
    return modelsCache;
  }
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
  let data: NineRouterResponse;
  try {
    const cleaned = raw.replace(/data: \[DONE\]\n*$/s, '').trim();
    data = JSON.parse(cleaned) as NineRouterResponse;
  } catch {
    data = JSON.parse(raw) as NineRouterResponse;
  }

  const content = data.choices?.[0]?.message?.content || '';
  const usage = data.usage || {};

  logger.debug('9router response received', {
    elapsed,
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
  });

  return {
    content,
    usage: {
      promptTokens: usage.prompt_tokens || 0,
      completionTokens: usage.completion_tokens || 0,
    },
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
