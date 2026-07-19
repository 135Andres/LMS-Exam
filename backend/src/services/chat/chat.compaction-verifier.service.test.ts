// backend/src/services/chat/chat.compaction-verifier.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { generateFromAIMock } = vi.hoisted(() => ({
  generateFromAIMock: vi.fn(),
}));

vi.mock('../ai/index.js', () => ({
  generateFromAI: (...args: unknown[]) => generateFromAIMock(...args),
}));

import { pickVerifierModel, verifyCompaction } from './chat.compaction-verifier.service.js';
import type { KnowledgeBlock } from '../session-summary.service.js';

function aiResponse(content: string) {
  return { content, usage: { promptTokens: 1, completionTokens: 1 }, finishReason: 'stop' };
}

const originalMessages = [
  { id: 'm1', role: 'user', content: '¿Qué es una derivada?' },
  { id: 'm2', role: 'assistant', content: 'Una derivada mide la tasa de cambio instantánea de una función.' },
];

const narrative = 'El estudiante preguntó sobre derivadas.';
const blocks: KnowledgeBlock[] = [];

describe('pickVerifierModel', () => {
  it('elige un modelo de otra familia cuando compactó nvidia/*', () => {
    expect(pickVerifierModel('nvidia/z-ai/glm-5.2')).toBe('ag/gemini-3-flash');
    expect(pickVerifierModel('nvidia/thinkingmachines/inkling')).toBe('ag/gemini-3-flash');
  });

  it('elige nvidia/z-ai/glm-5.2 como default para cualquier otra familia', () => {
    expect(pickVerifierModel('ag/gemini-3-flash')).toBe('nvidia/z-ai/glm-5.2');
    expect(pickVerifierModel('ag/claude-sonnet-4-6')).toBe('nvidia/z-ai/glm-5.2');
    expect(pickVerifierModel('oc/deepseek-v4-flash-free')).toBe('nvidia/z-ai/glm-5.2');
  });
});

describe('verifyCompaction', () => {
  beforeEach(() => {
    generateFromAIMock.mockReset();
  });

  it('detecta contenido faltante y lo reporta', async () => {
    generateFromAIMock.mockResolvedValueOnce(aiResponse(JSON.stringify({
      missing: [{ description: 'Falta la fórmula de la derivada por definición (límite)', suggestedBlock: true }],
    })));

    const result = await verifyCompaction(originalMessages, narrative, blocks, 'ag/gemini-3-flash');

    expect(result.missing).toEqual([
      { description: 'Falta la fórmula de la derivada por definición (límite)', suggestedBlock: true },
    ]);
    expect(result.verified).toBe(true);
  });

  it('usa el modelo de otra familia indicado por pickVerifierModel para la llamada a IA', async () => {
    generateFromAIMock.mockResolvedValueOnce(aiResponse(JSON.stringify({ missing: [] })));
    const compactionModel = 'nvidia/z-ai/glm-5.2';
    const verifierModel = pickVerifierModel(compactionModel);

    await verifyCompaction(originalMessages, narrative, blocks, verifierModel);

    expect(generateFromAIMock).toHaveBeenCalledTimes(1);
    const callArgs = generateFromAIMock.mock.calls[0];
    const options = callArgs[callArgs.length - 1] as { model: string };
    expect(options.model).toBe('ag/gemini-3-flash');
    expect(options.model).not.toBe(compactionModel);
  });

  it('si no falta nada, devuelve missing: [] con verified: true (distinguible de un fallo de verificación)', async () => {
    generateFromAIMock.mockResolvedValueOnce(aiResponse(JSON.stringify({ missing: [] })));

    const result = await verifyCompaction(originalMessages, narrative, blocks, 'ag/gemini-3-flash');

    expect(result.missing).toEqual([]);
    expect(result.verified).toBe(true);
  });

  it('ante respuesta de IA no parseable, devuelve missing: [] y verified: false en vez de lanzar', async () => {
    generateFromAIMock.mockResolvedValueOnce(aiResponse('esto no es JSON'));

    const result = await verifyCompaction(originalMessages, narrative, blocks, 'ag/gemini-3-flash');

    expect(result.missing).toEqual([]);
    expect(result.verified).toBe(false);
  });

  it('ante error de la IA, devuelve missing: [] y verified: false en vez de lanzar', async () => {
    generateFromAIMock.mockRejectedValueOnce(new Error('timeout'));

    const result = await verifyCompaction(originalMessages, narrative, blocks, 'ag/gemini-3-flash');

    expect(result.missing).toEqual([]);
    expect(result.verified).toBe(false);
  });
});
