// backend/src/services/chat/chat.segmentation.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { generateFromAIMock } = vi.hoisted(() => ({
  generateFromAIMock: vi.fn(),
}));

vi.mock('../ai/index.js', () => ({
  generateFromAI: (...args: unknown[]) => generateFromAIMock(...args),
}));

import { segmentMessages } from './chat.segmentation.service.js';

function aiResponse(content: string) {
  return { content, usage: { promptTokens: 1, completionTokens: 1 }, finishReason: 'stop' };
}

const MODEL = 'nvidia/thinkingmachines/inkling';

describe('segmentMessages', () => {
  beforeEach(() => {
    generateFromAIMock.mockReset();
  });

  it('clasifica LaTeX/código como verificable sin llamar a IA', async () => {
    const messages = [
      { id: 'm1', role: 'user', content: 'resuelve $$x^2 + 1 = 0$$' },
      { id: 'm2', role: 'assistant', content: '```js\nconst x = 1;\n```' },
    ];

    const results = await segmentMessages(messages, MODEL);

    expect(results).toEqual([
      { messageId: 'm1', class: 'verificable', confidence: 'high', method: 'heuristic' },
      { messageId: 'm2', class: 'verificable', confidence: 'high', method: 'heuristic' },
    ]);
    expect(generateFromAIMock).not.toHaveBeenCalled();
  });

  it('clasifica confirmaciones cortas como narrativo sin llamar a IA', async () => {
    const messages = [{ id: 'm1', role: 'user', content: 'gracias' }];

    const results = await segmentMessages(messages, MODEL);

    expect(results).toEqual([
      { messageId: 'm1', class: 'narrativo', confidence: 'high', method: 'heuristic' },
    ]);
    expect(generateFromAIMock).not.toHaveBeenCalled();
  });

  it('escala mensaje ambiguo (sin marcadores, <400 chars) a batch de IA', async () => {
    const messages = [{ id: 'm1', role: 'user', content: 'cuál es la capital de Francia' }];
    generateFromAIMock.mockResolvedValueOnce(aiResponse(JSON.stringify({
      classifications: [{ messageId: 'm1', class: 'narrativo', confidence: 'high' }],
    })));

    const results = await segmentMessages(messages, MODEL);

    expect(generateFromAIMock).toHaveBeenCalledTimes(1);
    expect(results).toEqual([
      { messageId: 'm1', class: 'narrativo', confidence: 'high', method: 'llm-batch' },
    ]);
  });

  it('agrupa TODOS los mensajes ambiguos en una sola llamada batch, no una por mensaje', async () => {
    const messages = [
      { id: 'm1', role: 'user', content: 'cuál es la capital de Francia' },
      { id: 'm2', role: 'user', content: 'y de Alemania' },
      { id: 'm3', role: 'user', content: 'y de España' },
    ];
    generateFromAIMock.mockResolvedValueOnce(aiResponse(JSON.stringify({
      classifications: [
        { messageId: 'm1', class: 'narrativo', confidence: 'high' },
        { messageId: 'm2', class: 'narrativo', confidence: 'high' },
        { messageId: 'm3', class: 'narrativo', confidence: 'high' },
      ],
    })));

    await segmentMessages(messages, MODEL);

    expect(generateFromAIMock).toHaveBeenCalledTimes(1);
  });

  it('confianza low en un ítem del batch cae a verificable por default (ante la duda, se conserva)', async () => {
    const messages = [{ id: 'm1', role: 'user', content: 'cuál es la capital de Francia' }];
    generateFromAIMock.mockResolvedValueOnce(aiResponse(JSON.stringify({
      classifications: [{ messageId: 'm1', class: 'narrativo', confidence: 'low' }],
    })));

    const results = await segmentMessages(messages, MODEL);

    expect(results).toEqual([
      { messageId: 'm1', class: 'verificable', confidence: 'low', method: 'llm-batch' },
    ]);
  });

  it('cae a verificable si el modelo no logra parsear ese ítem (item ausente en la respuesta)', async () => {
    const messages = [
      { id: 'm1', role: 'user', content: 'cuál es la capital de Francia' },
      { id: 'm2', role: 'user', content: 'y de Alemania' },
    ];
    generateFromAIMock.mockResolvedValueOnce(aiResponse(JSON.stringify({
      classifications: [{ messageId: 'm1', class: 'narrativo', confidence: 'high' }],
    })));

    const results = await segmentMessages(messages, MODEL);

    expect(results.find(r => r.messageId === 'm2')).toEqual({
      messageId: 'm2', class: 'verificable', confidence: 'low', method: 'llm-batch',
    });
  });

  it('cae a verificable si la llamada a IA falla completamente (error de red/parseo)', async () => {
    const messages = [{ id: 'm1', role: 'user', content: 'cuál es la capital de Francia' }];
    generateFromAIMock.mockRejectedValueOnce(new Error('network error'));

    const results = await segmentMessages(messages, MODEL);

    expect(results).toEqual([
      { messageId: 'm1', class: 'verificable', confidence: 'low', method: 'llm-batch' },
    ]);
  });

  it('repara un backslash de LaTeX suelto (\\sqrt) en la respuesta del batch, sin tirar SyntaxError (FIX consolidado)', async () => {
    const messages = [{ id: 'm1', role: 'user', content: 'cuál es la capital de Francia' }];
    // Un \sqrt sin escapar rompería un JSON.parse ingenuo con "Bad escaped character".
    generateFromAIMock.mockResolvedValueOnce(aiResponse(
      '{"classifications": [{"messageId": "m1", "class": "narrativo", "confidence": "high", "note": "ver \\sqrt{4}"}]}',
    ));

    const results = await segmentMessages(messages, MODEL);

    expect(results).toEqual([
      { messageId: 'm1', class: 'narrativo', confidence: 'high', method: 'llm-batch' },
    ]);
  });

  it('cobertura total: segmentMessages(newMessages).length === newMessages.length siempre', async () => {
    const messages = [
      { id: 'm1', role: 'user', content: 'gracias' },
      { id: 'm2', role: 'assistant', content: '```py\nprint(1)\n```' },
      { id: 'm3', role: 'user', content: 'cuál es la capital de Francia' },
      { id: 'm4', role: 'assistant', content: 'x'.repeat(500) },
    ];
    generateFromAIMock.mockResolvedValueOnce(aiResponse(JSON.stringify({
      classifications: [{ messageId: 'm3', class: 'narrativo', confidence: 'high' }],
    })));

    const results = await segmentMessages(messages, MODEL);

    expect(results.length).toBe(messages.length);
    expect(results.map(r => r.messageId)).toEqual(['m1', 'm2', 'm3', 'm4']);
  });
});
