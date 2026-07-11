import { callNineRouter, type NineRouterOptions } from './nineRouter.js';
import { logger } from '../../utils/logger.js';
import type { AIResponse } from '../../types/db.js';

type AiProvider = (
  systemPrompt: string,
  userPrompt: string | Record<string, unknown>[],
  schema: Record<string, unknown> | null,
  options?: NineRouterOptions,
) => Promise<AIResponse>;

const providers: Record<string, AiProvider> = {
  nineRouter: callNineRouter,
  nvidia: callNineRouter, // compat alias
};

export interface GenerateOptions extends NineRouterOptions {}

const RETRY_TEMPERATURES = [0.3, 0.5, 0.7];
const TIMEOUT_MS = 30000;

export class AiRetryError extends Error {
  public attempts: number;
  public lastError: string;

  constructor(attempts: number, lastError: string) {
    super(`La IA no respondió después de ${attempts} intentos. Último error: ${lastError}`);
    this.name = 'AiRetryError';
    this.attempts = attempts;
    this.lastError = lastError;
  }
}

export async function generateFromAI(
  providerName: string,
  systemPrompt: string,
  userPrompt: string | Record<string, unknown>[],
  schema: Record<string, unknown> | null = null,
  options?: GenerateOptions,
): Promise<AIResponse> {
  const call = providers[providerName];

  if (!call) {
    throw new Error(`Proveedor AI no soportado: ${providerName}`);
  }

  let lastError: Error | undefined;

  for (let attempt = 0; attempt < RETRY_TEMPERATURES.length; attempt++) {
    if (options?.signal?.aborted) {
      logger.warn('Operación cancelada por señal externa', { attempt: attempt + 1 });
      throw new Error('Operación cancelada');
    }

    const temperature = options?.temperature ?? RETRY_TEMPERATURES[attempt];
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let onAbort: (() => void) | null = null;
    if (options?.signal && !options.signal.aborted) {
      onAbort = () => { clearTimeout(timeoutId); controller.abort(); };
      options.signal.addEventListener('abort', onAbort, { once: true });
    }

    try {
      logger.info('Intento de llamada a IA', {
        provider: providerName,
        attempt: attempt + 1,
        temperature,
        timeoutMs: TIMEOUT_MS,
        model: options?.model,
      });

      const result = await call(systemPrompt, userPrompt, schema, {
        model: options?.model,
        temperature,
        signal: controller.signal,
        apiKey: options?.apiKey,
        baseUrl: options?.baseUrl,
        max_tokens: options?.max_tokens,
      });

      if (onAbort && options?.signal) options.signal.removeEventListener('abort', onAbort);
      clearTimeout(timeoutId);

      if (attempt > 0) {
        logger.info('Reintento exitoso', { attempt: attempt + 1, temperature });
      }

      return result;
    } catch (err) {
      if (onAbort && options?.signal) options.signal.removeEventListener('abort', onAbort);
      clearTimeout(timeoutId);

      if (options?.signal?.aborted) {
        throw new Error('Operación cancelada');
      }

      const error = err as Error;
      lastError = error;

      const isTimeout = error.name === 'AbortError';
      const isServerError = /^5\d\d/.test(error.message) || error.message.includes('5xx');
      const isNetworkError = /fetch|network|econnrefused|enotfound|etimedout/i.test(error.message);
      const isParseError = /formato inválido|JSON|Unexpected token|parse/i.test(error.message);

      if (isTimeout) {
        logger.warn('Timeout en llamada a IA', { attempt: attempt + 1, temperature });
      } else if (isServerError || isNetworkError) {
        logger.warn('Error recuperable en IA', { attempt: attempt + 1, temperature, error: error.message });
      } else if (isParseError) {
        logger.warn('Error de parseo en IA', { attempt: attempt + 1, temperature, error: error.message });
      } else {
        logger.error('Error no recuperable en IA', { attempt: attempt + 1, temperature, error: error.message });
        throw error;
      }

      const isLastAttempt = attempt === RETRY_TEMPERATURES.length - 1;
      if (isLastAttempt) {
        throw new AiRetryError(RETRY_TEMPERATURES.length, error.message);
      }
    }
  }

  throw new AiRetryError(RETRY_TEMPERATURES.length, lastError?.message || 'Error desconocido');
}
