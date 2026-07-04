import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import type { AIResponse } from '../../types/db.js';

interface NvidiaMessage {
  role: string;
  content: string | Array<Record<string, unknown>>;
}

interface NvidiaResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

export interface NvidiaOptions {
  temperature?: number;
  signal?: AbortSignal;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  max_tokens?: number;
}

export interface StreamChunk {
  type: 'reasoning' | 'content';
  content: string;
}

export async function* parseNvidiaStream(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamChunk> {
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

export async function callNvidiaStream(
  systemPrompt: string,
  userPrompt: string | Array<Record<string, unknown>>,
  options?: NvidiaOptions,
): Promise<Response> {
  const model = options?.model || config.models.generate;
  const userContent = Array.isArray(userPrompt)
    ? userPrompt
    : [{ type: 'text' as const, text: userPrompt }];

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ] as NvidiaMessage[],
    max_tokens: options?.max_tokens ?? 4096,
    stream: true,
  };

  if (options?.temperature !== undefined) {
    body.temperature = options.temperature;
  }

  const apiKey = options?.apiKey || config.nvidia.apiKey;
  const baseUrl = options?.baseUrl || config.nvidia.baseUrl;

  logger.debug('Llamada streaming a NVIDIA API', { model });

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
    logger.error('Error en streaming NVIDIA API', { status: response.status, error: errorText });
    throw new Error(errorText);
  }

  return response;
}

export async function callNvidia(
  systemPrompt: string,
  userPrompt: string | Array<Record<string, unknown>>,
  responseFormat: Record<string, unknown> | null = null,
  options?: NvidiaOptions,
): Promise<AIResponse> {
  const model = options?.model || config.models.generate;

  const userContent = Array.isArray(userPrompt)
    ? userPrompt
    : [{ type: 'text' as const, text: userPrompt }];

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ] as NvidiaMessage[],
    max_tokens: options?.max_tokens ?? 4096,
  };

  if (options?.temperature !== undefined) {
    body.temperature = options.temperature;
  }

  if (responseFormat) {
    body.response_format = responseFormat;
  }

  const start = Date.now();
  logger.debug('Llamando a NVIDIA API', { model, temperature: body.temperature });

  const apiKey = options?.apiKey || config.nvidia.apiKey;
  const baseUrl = options?.baseUrl || config.nvidia.baseUrl;

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
    logger.error('Error en NVIDIA API', {
      status: response.status,
      error: errorText,
      elapsed,
      temperature: body.temperature,
    });
    throw new Error(`NVIDIA API error ${response.status}: ${errorText}`);
  }

  const data = (await response.json()) as NvidiaResponse;
  const content = data.choices?.[0]?.message?.content || '';
  const usage = data.usage || {};

  logger.debug('Respuesta de NVIDIA recibida', {
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
