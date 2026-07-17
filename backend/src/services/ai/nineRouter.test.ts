// backend/src/services/ai/nineRouter.test.ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { callNineRouter } from './nineRouter.js';

describe('callNineRouter — finishReason', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('expone finishReason "length" cuando la respuesta viene truncada por max_tokens', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        choices: [{ message: { content: 'texto cortado a la mit' }, finish_reason: 'length' }],
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      }),
    }) as unknown as typeof fetch;

    const result = await callNineRouter('system', 'user');

    expect(result.finishReason).toBe('length');
  });

  it('expone finishReason "stop" en una respuesta completa', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        choices: [{ message: { content: 'texto completo' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    }) as unknown as typeof fetch;

    const result = await callNineRouter('system', 'user');

    expect(result.finishReason).toBe('stop');
  });

  it('parsea finish_reason también en respuestas SSE reensambladas (delta chunks)', async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"hola"}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"length"}]}',
      'data: [DONE]',
    ].join('\n');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => sse,
    }) as unknown as typeof fetch;

    const result = await callNineRouter('system', 'user');

    expect(result.finishReason).toBe('length');
    expect(result.content).toBe('hola');
  });
});
