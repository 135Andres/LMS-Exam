// backend/src/services/chat/chat.block-extraction.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { generateFromAIMock } = vi.hoisted(() => ({
  generateFromAIMock: vi.fn(),
}));

const { addBlockMock, getIndexMock, getBlocksMock } = vi.hoisted(() => ({
  addBlockMock: vi.fn(),
  getIndexMock: vi.fn(),
  getBlocksMock: vi.fn(),
}));

const { existsByHashMock, createMock } = vi.hoisted(() => ({
  existsByHashMock: vi.fn(),
  createMock: vi.fn(),
}));

vi.mock('../ai/index.js', () => ({
  generateFromAI: (...args: unknown[]) => generateFromAIMock(...args),
}));

vi.mock('../session-summary.service.js', () => ({
  SessionSummaryService: {
    addBlock: (...args: unknown[]) => addBlockMock(...args),
    getIndex: (...args: unknown[]) => getIndexMock(...args),
    getBlocks: (...args: unknown[]) => getBlocksMock(...args),
  },
}));

vi.mock('../../models/knowledge.model.js', () => ({
  KnowledgeModel: {
    existsByHash: (...args: unknown[]) => existsByHashMock(...args),
    create: (...args: unknown[]) => createMock(...args),
  },
  hashKnowledgeContent: (content: string) => `hash:${content}`,
}));

import { extractBlocks } from './chat.block-extraction.service.js';

function aiResponse(content: string) {
  return { content, usage: { promptTokens: 1, completionTokens: 1 }, finishReason: 'stop' };
}

function titlesBatchResponse(items: Array<{ id: string; title: string; subject?: string }>) {
  return aiResponse(JSON.stringify({ items }));
}

const MODEL = 'nvidia/thinkingmachines/inkling';

describe('extractBlocks', () => {
  beforeEach(() => {
    generateFromAIMock.mockReset();
    addBlockMock.mockReset();
    getIndexMock.mockReset();
    getBlocksMock.mockReset();
    existsByHashMock.mockReset();
    createMock.mockReset();

    getIndexMock.mockReturnValue({ narrativeCompactions: [], blocks: [] });
    getBlocksMock.mockReturnValue([]);
    existsByHashMock.mockReturnValue(false);
    addBlockMock.mockImplementation((sessionId: string, block: any) => ({ id: 'block_1', ...block }));
    generateFromAIMock.mockResolvedValue(titlesBatchResponse([]));
  });

  it('ignora mensajes narrativos, solo extrae los verificables', async () => {
    const messages = [
      { id: 'm1', role: 'user', content: 'gracias' },
      { id: 'm2', role: 'assistant', content: 'La derivada de x^2 es 2x, aplicando la regla de la potencia paso a paso.' },
    ];
    const segments = [
      { messageId: 'm1', class: 'narrativo' as const, confidence: 'high' as const, method: 'heuristic' as const },
      { messageId: 'm2', class: 'verificable' as const, confidence: 'high' as const, method: 'heuristic' as const },
    ];

    const blocks = await extractBlocks('session1', messages, segments, MODEL);

    expect(blocks).toHaveLength(1);
    expect(addBlockMock).toHaveBeenCalledTimes(1);
  });

  it('el contenido del bloque es casi-verbatim del mensaje original, sin reformular', async () => {
    const messages = [
      { id: 'm1', role: 'assistant', content: 'claro, te explico: la fórmula cuadrática es x = (-b ± √(b²-4ac)) / 2a' },
    ];
    const segments = [
      { messageId: 'm1', class: 'verificable' as const, confidence: 'high' as const, method: 'heuristic' as const },
    ];

    await extractBlocks('session1', messages, segments, MODEL);

    const call = addBlockMock.mock.calls[0][1];
    // Solo se recorta la muletilla inicial conocida, el resto queda intacto.
    expect(call.content).toBe('la fórmula cuadrática es x = (-b ± √(b²-4ac)) / 2a');
    expect(call.content).not.toContain('claro, te explico');
  });

  it('usa la IA solo para el título, no para reescribir el contenido', async () => {
    const messages = [
      { id: 'm1', role: 'assistant', content: 'La segunda ley de Newton establece que F = m·a.' },
    ];
    const segments = [
      { messageId: 'm1', class: 'verificable' as const, confidence: 'high' as const, method: 'heuristic' as const },
    ];
    generateFromAIMock.mockResolvedValueOnce(titlesBatchResponse([{ id: 'm1', title: 'Segunda ley de Newton' }]));

    await extractBlocks('session1', messages, segments, MODEL);

    expect(generateFromAIMock).toHaveBeenCalledTimes(1);
    const call = addBlockMock.mock.calls[0][1];
    expect(call.title).toBe('Segunda ley de Newton');
    expect(call.content).toBe('La segunda ley de Newton establece que F = m·a.');
  });

  it('llama a generateFromAI exactamente una vez para 3+ bloques nuevos, y cada uno recibe su título correcto sin mezclarse', async () => {
    const messages = [
      { id: 'm1', role: 'assistant', content: 'La derivada de x^2 es 2x, aplicando la regla de la potencia paso a paso.' },
      { id: 'm2', role: 'assistant', content: 'La segunda ley de Newton establece que F = m·a, paso a paso.' },
      { id: 'm3', role: 'assistant', content: 'El teorema de Pitágoras dice que a^2 + b^2 = c^2, por lo tanto.' },
    ];
    const segments = messages.map(m => ({
      messageId: m.id, class: 'verificable' as const, confidence: 'high' as const, method: 'heuristic' as const,
    }));
    // Respuesta deliberadamente en orden distinto al de los items pedidos,
    // para probar que el match es por id y no por posición.
    generateFromAIMock.mockResolvedValueOnce(titlesBatchResponse([
      { id: 'm3', title: 'Teorema de Pitágoras' },
      { id: 'm1', title: 'Derivada de x^2' },
      { id: 'm2', title: 'Segunda ley de Newton' },
    ]));

    const blocks = await extractBlocks('session1', messages, segments, MODEL);

    expect(generateFromAIMock).toHaveBeenCalledTimes(1);
    expect(blocks).toHaveLength(3);
    const byId = new Map(addBlockMock.mock.calls.map(call => [call[1].extractedFromMessages[0], call[1].title]));
    expect(byId.get('m1')).toBe('Derivada de x^2');
    expect(byId.get('m2')).toBe('Segunda ley de Newton');
    expect(byId.get('m3')).toBe('Teorema de Pitágoras');
  });

  it('si el batch de títulos falla, cada bloque cae al fallback de truncamiento', async () => {
    const messages = [
      { id: 'm1', role: 'assistant', content: 'La derivada de x^2 es 2x, aplicando la regla de la potencia paso a paso, un contenido bien largo.' },
      { id: 'm2', role: 'assistant', content: 'La segunda ley de Newton establece que F = m·a, paso a paso, otro contenido largo también.' },
    ];
    const segments = messages.map(m => ({
      messageId: m.id, class: 'verificable' as const, confidence: 'high' as const, method: 'heuristic' as const,
    }));
    generateFromAIMock.mockRejectedValueOnce(new Error('AI down'));

    const blocks = await extractBlocks('session1', messages, segments, MODEL);

    expect(generateFromAIMock).toHaveBeenCalledTimes(1);
    expect(blocks).toHaveLength(2);
    const byId = new Map(addBlockMock.mock.calls.map(call => [call[1].extractedFromMessages[0], call[1].title]));
    expect(byId.get('m1')).toBe(messages[0].content.slice(0, 60).trim());
    expect(byId.get('m2')).toBe(messages[1].content.slice(0, 60).trim());
  });

  it('completa subject, extractedFromMessages, extractionModel y confidence en el bloque', async () => {
    const messages = [
      { id: 'm7', role: 'assistant', content: 'La derivada de una función mide su tasa de cambio instantánea.' },
    ];
    const segments = [
      { messageId: 'm7', class: 'verificable' as const, confidence: 'medium' as const, method: 'heuristic' as const },
    ];

    await extractBlocks('session1', messages, segments, MODEL);

    const call = addBlockMock.mock.calls[0][1];
    expect(call.subject).toBe('matematicas');
    expect(call.extractedFromMessages).toEqual(['m7']);
    expect(call.extractionModel).toBe(MODEL);
    expect(call.confidence).toBe('medium');
    expect(typeof call.extractedAt).toBe('string');
  });

  it('heurística de alta confianza: no le pide materia a la IA y usa la materia heurística', async () => {
    const messages = [
      { id: 'm1', role: 'assistant', content: 'La derivada de x^2 es 2x, aplicando la regla de la potencia.' },
    ];
    const segments = [
      { messageId: 'm1', class: 'verificable' as const, confidence: 'high' as const, method: 'heuristic' as const },
    ];
    // La IA devuelve una materia distinta (equivocada a propósito) para probar que se ignora.
    generateFromAIMock.mockResolvedValueOnce(titlesBatchResponse([{ id: 'm1', title: 'Derivada', subject: 'artes' }]));

    await extractBlocks('session1', messages, segments, MODEL);

    const call = addBlockMock.mock.calls[0][1];
    expect(call.subject).toBe('matematicas');
    const userPromptSent = generateFromAIMock.mock.calls[0][2] as string;
    expect(userPromptSent).not.toContain('requiere materia');
  });

  it('heurística de baja confianza/indefinida: usa la materia que devuelve la IA', async () => {
    const messages = [
      { id: 'm1', role: 'assistant', content: 'el clima cambió el movimiento de las corrientes marinas' },
    ];
    const segments = [
      { messageId: 'm1', class: 'verificable' as const, confidence: 'high' as const, method: 'heuristic' as const },
    ];
    generateFromAIMock.mockResolvedValueOnce(titlesBatchResponse([{ id: 'm1', title: 'Corrientes marinas', subject: 'fisica' }]));

    await extractBlocks('session1', messages, segments, MODEL);

    const call = addBlockMock.mock.calls[0][1];
    expect(call.subject).toBe('fisica');
    const userPromptSent = generateFromAIMock.mock.calls[0][2] as string;
    expect(userPromptSent).toContain('requiere materia');
  });

  it('si la llamada de IA falla, la materia cae al resultado heurístico aunque sea de baja confianza', async () => {
    const messages = [
      { id: 'm1', role: 'assistant', content: 'el clima cambió el movimiento de las corrientes marinas' },
    ];
    const segments = [
      { messageId: 'm1', class: 'verificable' as const, confidence: 'high' as const, method: 'heuristic' as const },
    ];
    generateFromAIMock.mockRejectedValueOnce(new Error('AI down'));

    const blocks = await extractBlocks('session1', messages, segments, MODEL);

    expect(blocks).toHaveLength(1);
    const call = addBlockMock.mock.calls[0][1];
    expect(call.subject).toBe('fisica');
  });

  it('salta re-extracción si ya existe un bloque para ese messageId (idempotencia)', async () => {
    getIndexMock.mockReturnValue({ narrativeCompactions: [], blocks: [] });
    getBlocksMock.mockReturnValue([
      { id: 'block_existing', subject: 'matematicas', extractedFromMessages: ['m1'], extractedAt: 'x', extractionModel: MODEL, confidence: 'high', title: 't', content: 'c' },
    ]);
    const messages = [
      { id: 'm1', role: 'assistant', content: 'La derivada de x^2 es 2x.' },
    ];
    const segments = [
      { messageId: 'm1', class: 'verificable' as const, confidence: 'high' as const, method: 'heuristic' as const },
    ];

    const blocks = await extractBlocks('session1', messages, segments, MODEL);

    expect(blocks).toHaveLength(0);
    expect(addBlockMock).not.toHaveBeenCalled();
    expect(generateFromAIMock).not.toHaveBeenCalled();
  });

  it('bloques con confianza high/medium y contenido reutilizable van a KnowledgeModel.create', async () => {
    const longContent = 'La segunda ley de Newton establece que la fuerza neta aplicada a un objeto es igual a su masa multiplicada por la aceleración que experimenta.';
    const messages = [{ id: 'm1', role: 'assistant', content: longContent }];
    const segments = [
      { messageId: 'm1', class: 'verificable' as const, confidence: 'high' as const, method: 'heuristic' as const },
    ];

    await extractBlocks('session1', messages, segments, MODEL, 'user-123');

    expect(createMock).toHaveBeenCalledTimes(1);
    const arg = createMock.mock.calls[0][0];
    expect(arg.content).toBe(longContent);
    expect(arg.source_type).toBe('session_compaction');
    expect(arg.source_user_id).toBe('user-123');
    expect(arg.status).toBe('pending_review');
    expect(arg.tags).toEqual(['auto-detectado', 'compactacion']);
  });

  it('bloques con contenido corto (<40 chars) NO van a la KB colectiva', async () => {
    const messages = [{ id: 'm1', role: 'assistant', content: 'F = m·a' }];
    const segments = [
      { messageId: 'm1', class: 'verificable' as const, confidence: 'high' as const, method: 'heuristic' as const },
    ];

    await extractBlocks('session1', messages, segments, MODEL, 'user-123');

    expect(createMock).not.toHaveBeenCalled();
  });

  it('bloques con confidence low NO van a la KB colectiva', async () => {
    const longContent = 'La segunda ley de Newton establece que la fuerza neta aplicada a un objeto es igual a su masa multiplicada por la aceleración.';
    const messages = [{ id: 'm1', role: 'assistant', content: longContent }];
    const segments = [
      { messageId: 'm1', class: 'verificable' as const, confidence: 'low' as const, method: 'heuristic' as const },
    ];

    await extractBlocks('session1', messages, segments, MODEL, 'user-123');

    expect(createMock).not.toHaveBeenCalled();
  });

  it('duplicados por hash se saltan igual que en Fase 1', async () => {
    existsByHashMock.mockReturnValue(true);
    const longContent = 'La segunda ley de Newton establece que la fuerza neta aplicada a un objeto es igual a su masa multiplicada por la aceleración.';
    const messages = [{ id: 'm1', role: 'assistant', content: longContent }];
    const segments = [
      { messageId: 'm1', class: 'verificable' as const, confidence: 'high' as const, method: 'heuristic' as const },
    ];

    await extractBlocks('session1', messages, segments, MODEL, 'user-123');

    expect(createMock).not.toHaveBeenCalled();
  });
});
