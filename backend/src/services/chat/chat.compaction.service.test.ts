// backend/src/services/chat/chat.compaction.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  generateFromAIMock, chatModelMock, sessionSummaryMock,
  segmentMessagesMock, extractBlocksMock, verifyCompactionMock, pickVerifierModelMock,
} = vi.hoisted(() => ({
  generateFromAIMock: vi.fn(),
  chatModelMock: {
    getSummaryCursor: vi.fn(),
    getMessagesSince: vi.fn(),
    setSummaryCursor: vi.fn(),
    getLastAssistantModel: vi.fn(),
  },
  sessionSummaryMock: {
    getNarrative: vi.fn(),
    saveNarrative: vi.fn(),
    getNarrativeFailureCount: vi.fn(),
    recordNarrativeFailure: vi.fn(),
    resetNarrativeFailureCount: vi.fn(),
  },
  segmentMessagesMock: vi.fn(),
  extractBlocksMock: vi.fn(),
  verifyCompactionMock: vi.fn(),
  pickVerifierModelMock: vi.fn(),
}));

vi.mock('../ai/index.js', () => ({
  generateFromAI: (...args: unknown[]) => generateFromAIMock(...args),
}));

vi.mock('../../models/chat.model.js', () => ({
  ChatModel: chatModelMock,
}));

vi.mock('../session-summary.service.js', () => ({
  SessionSummaryService: sessionSummaryMock,
}));

vi.mock('./chat.segmentation.service.js', () => ({
  segmentMessages: (...args: unknown[]) => segmentMessagesMock(...args),
  VERIFICABLE_MARKERS: [
    /\$\$?[^$]+\$\$?/,
    /```/,
    /\b(por lo tanto|entonces|demostraci[oó]n|derivaci[oó]n|paso a paso|definici[oó]n de)\b/i,
  ],
}));

vi.mock('./chat.block-extraction.service.js', () => ({
  extractBlocks: (...args: unknown[]) => extractBlocksMock(...args),
}));

vi.mock('./chat.compaction-verifier.service.js', () => ({
  verifyCompaction: (...args: unknown[]) => verifyCompactionMock(...args),
  pickVerifierModel: (...args: unknown[]) => pickVerifierModelMock(...args),
}));

import { compactSession } from './chat.compaction.service.js';

function aiResponse(content: string, finishReason = 'stop') {
  return { content, usage: { promptTokens: 10, completionTokens: 10 }, finishReason };
}

const NEW_MESSAGES = [
  { id: 'm1', role: 'user', content: 'hola', created_at: '2026-07-17T10:00:00Z' },
  { id: 'm2', role: 'assistant', content: 'hola, ¿en qué te ayudo?', created_at: '2026-07-17T10:00:05Z' },
  { id: 'm3', role: 'user', content: 'explícame integrales', created_at: '2026-07-17T10:01:00Z' },
  { id: 'm4', role: 'assistant', content: 'una integral es...', created_at: '2026-07-17T10:01:30Z' },
  { id: 'm5', role: 'user', content: 'gracias', created_at: '2026-07-17T10:02:00Z' },
  { id: 'm6', role: 'assistant', content: 'de nada', created_at: '2026-07-17T10:02:05Z' },
];

// Todos narrativo por default — segmentación sin ningún candidato a bloque,
// así los tests de modelo dinámico / retry se enfocan solo en lo que
// prueban, sin que Paso 2/4 les agreguen ruido.
function allNarrativo() {
  return NEW_MESSAGES.map(m => ({ messageId: m.id, class: 'narrativo' as const, confidence: 'high' as const, method: 'heuristic' as const }));
}

const VALID_RESULT = JSON.stringify({ summary: 'El estudiante preguntó sobre integrales.', confidence: 'high' });

describe('compactSession — modelo dinámico', () => {
  beforeEach(() => {
    generateFromAIMock.mockReset();
    chatModelMock.getSummaryCursor.mockReset().mockReturnValue(null);
    chatModelMock.getMessagesSince.mockReset().mockReturnValue(NEW_MESSAGES);
    chatModelMock.setSummaryCursor.mockReset();
    chatModelMock.getLastAssistantModel.mockReset();
    sessionSummaryMock.getNarrative.mockReset().mockReturnValue(null);
    sessionSummaryMock.saveNarrative.mockReset();
    sessionSummaryMock.getNarrativeFailureCount.mockReset().mockReturnValue(0);
    sessionSummaryMock.recordNarrativeFailure.mockReset().mockReturnValue(1);
    sessionSummaryMock.resetNarrativeFailureCount.mockReset();
    segmentMessagesMock.mockReset().mockResolvedValue(allNarrativo());
    extractBlocksMock.mockReset().mockResolvedValue([]);
    verifyCompactionMock.mockReset().mockResolvedValue({ missing: [] });
    pickVerifierModelMock.mockReset().mockReturnValue('ag/gemini-3-flash');
  });

  it('usa Inkling para compactar una sesión cuyo último modelo fue Inkling', async () => {
    chatModelMock.getLastAssistantModel.mockReturnValue('nvidia/thinkingmachines/inkling');
    generateFromAIMock.mockResolvedValueOnce(aiResponse(VALID_RESULT));

    await compactSession('s1', 'u1', true);

    expect(generateFromAIMock).toHaveBeenCalledWith(
      'nineRouter', expect.any(String), expect.any(String), null,
      expect.objectContaining({ model: 'nvidia/thinkingmachines/inkling' }),
    );
  });

  it('usa Gemini Flash para compactar una sesión cuyo último modelo fue Claude Sonnet', async () => {
    chatModelMock.getLastAssistantModel.mockReturnValue('ag/claude-sonnet-4-6');
    generateFromAIMock.mockResolvedValueOnce(aiResponse(VALID_RESULT));

    await compactSession('s1', 'u1', true);

    expect(generateFromAIMock).toHaveBeenCalledWith(
      'nineRouter', expect.any(String), expect.any(String), null,
      expect.objectContaining({ model: 'ag/gemini-3-flash' }),
    );
  });

  it('usa GLM para compactar una sesión cuyo último modelo fue GLM', async () => {
    chatModelMock.getLastAssistantModel.mockReturnValue('nvidia/z-ai/glm-5.2');
    generateFromAIMock.mockResolvedValueOnce(aiResponse(VALID_RESULT));

    await compactSession('s1', 'u1', true);

    expect(generateFromAIMock).toHaveBeenCalledWith(
      'nineRouter', expect.any(String), expect.any(String), null,
      expect.objectContaining({ model: 'nvidia/z-ai/glm-5.2' }),
    );
  });

  it('usa Inkling por default si la sesión todavía no tiene modelo previo', async () => {
    chatModelMock.getLastAssistantModel.mockReturnValue(null);
    generateFromAIMock.mockResolvedValueOnce(aiResponse(VALID_RESULT));

    await compactSession('s1', 'u1', true);

    expect(generateFromAIMock).toHaveBeenCalledWith(
      'nineRouter', expect.any(String), expect.any(String), null,
      expect.objectContaining({ model: 'nvidia/thinkingmachines/inkling' }),
    );
  });
});

describe('compactSession — retry en truncamiento', () => {
  beforeEach(() => {
    generateFromAIMock.mockReset();
    chatModelMock.getSummaryCursor.mockReset().mockReturnValue(null);
    chatModelMock.getMessagesSince.mockReset().mockReturnValue(NEW_MESSAGES);
    chatModelMock.setSummaryCursor.mockReset();
    chatModelMock.getLastAssistantModel.mockReset().mockReturnValue('nvidia/thinkingmachines/inkling');
    sessionSummaryMock.getNarrative.mockReset().mockReturnValue(null);
    sessionSummaryMock.saveNarrative.mockReset();
    sessionSummaryMock.getNarrativeFailureCount.mockReset().mockReturnValue(0);
    sessionSummaryMock.recordNarrativeFailure.mockReset().mockReturnValue(1);
    sessionSummaryMock.resetNarrativeFailureCount.mockReset();
    segmentMessagesMock.mockReset().mockResolvedValue(allNarrativo());
    extractBlocksMock.mockReset().mockResolvedValue([]);
    verifyCompactionMock.mockReset().mockResolvedValue({ missing: [] });
    pickVerifierModelMock.mockReset().mockReturnValue('ag/gemini-3-flash');
  });

  it('reintenta con más presupuesto si la primera respuesta viene truncada, y guarda el resultado del reintento', async () => {
    generateFromAIMock
      .mockResolvedValueOnce(aiResponse('{"summary": "cortado a la mit', 'length'))
      .mockResolvedValueOnce(aiResponse(VALID_RESULT, 'stop'));

    await compactSession('s1', 'u1', true);

    expect(generateFromAIMock).toHaveBeenCalledTimes(2);
    expect(generateFromAIMock).toHaveBeenNthCalledWith(2,
      'nineRouter', expect.any(String), expect.any(String), null,
      expect.objectContaining({ max_tokens: 6000 }),
    );
    expect(sessionSummaryMock.saveNarrative).toHaveBeenCalledWith('s1', 'El estudiante preguntó sobre integrales.', expect.any(Object));
    expect(chatModelMock.setSummaryCursor).toHaveBeenCalledWith('s1', NEW_MESSAGES[5].created_at);
  });

  it('descarta el intento (no guarda nada) si sigue truncado tras el reintento, pero los bloques ya extraídos no se pierden', async () => {
    extractBlocksMock.mockResolvedValue([
      { id: 'block_1', subject: 'matematicas', extractedFromMessages: ['m3'], extractedAt: 'x', extractionModel: 'm', confidence: 'high', title: 't', content: 'c' },
    ]);
    generateFromAIMock
      .mockResolvedValueOnce(aiResponse('{"summary": "cortado', 'length'))
      .mockResolvedValueOnce(aiResponse('{"summary": "sigue cortado', 'length'));

    await compactSession('s1', 'u1', true);

    expect(generateFromAIMock).toHaveBeenCalledTimes(2);
    expect(extractBlocksMock).toHaveBeenCalled();
    expect(sessionSummaryMock.saveNarrative).not.toHaveBeenCalled();
    expect(chatModelMock.setSummaryCursor).not.toHaveBeenCalled();
  });
});

describe('compactSession — orquestación de 4 pasos (Fase 2)', () => {
  beforeEach(() => {
    generateFromAIMock.mockReset();
    chatModelMock.getSummaryCursor.mockReset().mockReturnValue(null);
    chatModelMock.getMessagesSince.mockReset().mockReturnValue(NEW_MESSAGES);
    chatModelMock.setSummaryCursor.mockReset();
    chatModelMock.getLastAssistantModel.mockReset().mockReturnValue('nvidia/thinkingmachines/inkling');
    sessionSummaryMock.getNarrative.mockReset().mockReturnValue(null);
    sessionSummaryMock.saveNarrative.mockReset();
    sessionSummaryMock.getNarrativeFailureCount.mockReset().mockReturnValue(0);
    sessionSummaryMock.recordNarrativeFailure.mockReset().mockReturnValue(1);
    sessionSummaryMock.resetNarrativeFailureCount.mockReset();
    segmentMessagesMock.mockReset().mockResolvedValue(allNarrativo());
    extractBlocksMock.mockReset().mockResolvedValue([]);
    verifyCompactionMock.mockReset().mockResolvedValue({ missing: [] });
    pickVerifierModelMock.mockReset().mockReturnValue('ag/gemini-3-flash');
    generateFromAIMock.mockResolvedValue(aiResponse(VALID_RESULT));
  });

  it('cobertura incompleta de segmentación aborta la pasada sin avanzar el cursor ni llamar extractBlocks', async () => {
    segmentMessagesMock.mockResolvedValue(allNarrativo().slice(0, 3)); // menos resultados que mensajes

    await compactSession('s1', 'u1', true);

    expect(extractBlocksMock).not.toHaveBeenCalled();
    expect(generateFromAIMock).not.toHaveBeenCalled();
    expect(sessionSummaryMock.saveNarrative).not.toHaveBeenCalled();
    expect(chatModelMock.setSummaryCursor).not.toHaveBeenCalled();
  });

  it('extractBlocks se ejecuta y persiste (Paso 2) incluso cuando la narrativa (Paso 3) falla', async () => {
    extractBlocksMock.mockResolvedValue([
      { id: 'block_1', subject: 'matematicas', extractedFromMessages: ['m3'], extractedAt: 'x', extractionModel: 'm', confidence: 'high', title: 't', content: 'c' },
    ]);
    generateFromAIMock.mockResolvedValue(aiResponse('no es json', 'stop'));

    await compactSession('s1', 'u1', true);

    expect(extractBlocksMock).toHaveBeenCalledWith('s1', NEW_MESSAGES, allNarrativo(), 'nvidia/thinkingmachines/inkling', 'u1');
    expect(sessionSummaryMock.saveNarrative).not.toHaveBeenCalled();
    expect(chatModelMock.setSummaryCursor).not.toHaveBeenCalled();
  });

  it('la verificación cruzada agrega el contenido faltante directo a la narrativa guardada, sin cola de revisión', async () => {
    verifyCompactionMock.mockResolvedValue({ missing: [{ description: 'falta la derivación de la integral por partes' }] });

    await compactSession('s1', 'u1', true);

    expect(sessionSummaryMock.saveNarrative).toHaveBeenCalledWith(
      's1',
      expect.stringContaining('falta la derivación de la integral por partes'),
      expect.any(Object),
    );
    expect(chatModelMock.setSummaryCursor).toHaveBeenCalled();
  });

  it('el prompt de narrativa excluye el contenido de mensajes verificables, solo los referencia por bloque', async () => {
    segmentMessagesMock.mockResolvedValue([
      { messageId: 'm1', class: 'narrativo', confidence: 'high', method: 'heuristic' },
      { messageId: 'm2', class: 'narrativo', confidence: 'high', method: 'heuristic' },
      { messageId: 'm3', class: 'verificable', confidence: 'high', method: 'heuristic' },
      { messageId: 'm4', class: 'verificable', confidence: 'high', method: 'heuristic' },
      { messageId: 'm5', class: 'narrativo', confidence: 'high', method: 'heuristic' },
      { messageId: 'm6', class: 'narrativo', confidence: 'high', method: 'heuristic' },
    ]);
    extractBlocksMock.mockResolvedValue([
      { id: 'block_abc', subject: 'matematicas', extractedFromMessages: ['m3', 'm4'], extractedAt: 'x', extractionModel: 'm', confidence: 'high', title: 'Integrales', content: 'una integral es...' },
    ]);

    await compactSession('s1', 'u1', true);

    const userPromptSent = generateFromAIMock.mock.calls[0][2] as string;
    expect(userPromptSent).not.toContain('explícame integrales');
    expect(userPromptSent).not.toContain('una integral es...');
    expect(userPromptSent).toContain('block_abc');
    expect(userPromptSent).toContain('Integrales');
    expect(userPromptSent).toContain('hola'); // mensaje narrativo sí va en el prompt
  });
});

describe('compactSession — alucinación de ausencia (Fase 2 paso 6)', () => {
  const CODE_MESSAGES = [
    { id: 'c1', role: 'user', content: 'ayuda con este código', created_at: '2026-07-17T10:00:00Z' },
    { id: 'c2', role: 'assistant', content: 'aquí está:\n```python\nprint(1)\n```', created_at: '2026-07-17T10:00:05Z' },
  ];

  function allNarrativoFor(messages: typeof CODE_MESSAGES) {
    return messages.map(m => ({ messageId: m.id, class: 'narrativo' as const, confidence: 'high' as const, method: 'heuristic' as const }));
  }

  const ABSENT_RESULT = JSON.stringify({ summary: 'No hay contenido académico relevante en esta conversación.', confidence: 'high' });

  beforeEach(() => {
    generateFromAIMock.mockReset();
    chatModelMock.getSummaryCursor.mockReset().mockReturnValue(null);
    chatModelMock.getMessagesSince.mockReset().mockReturnValue(CODE_MESSAGES);
    chatModelMock.setSummaryCursor.mockReset();
    chatModelMock.getLastAssistantModel.mockReset().mockReturnValue('nvidia/thinkingmachines/inkling');
    sessionSummaryMock.getNarrative.mockReset().mockReturnValue(null);
    sessionSummaryMock.saveNarrative.mockReset();
    sessionSummaryMock.getNarrativeFailureCount.mockReset().mockReturnValue(0);
    sessionSummaryMock.recordNarrativeFailure.mockReset().mockReturnValue(1);
    sessionSummaryMock.resetNarrativeFailureCount.mockReset();
    segmentMessagesMock.mockReset().mockResolvedValue(allNarrativoFor(CODE_MESSAGES));
    extractBlocksMock.mockReset().mockResolvedValue([]);
    verifyCompactionMock.mockReset().mockResolvedValue({ missing: [] });
    pickVerifierModelMock.mockReset().mockReturnValue('ag/gemini-3-flash');
  });

  it('reintenta cuando la narrativa dice "sin contenido académico" pero newMessages trae un bloque de código, y guarda el reintento si corrige', async () => {
    generateFromAIMock
      .mockResolvedValueOnce(aiResponse(ABSENT_RESULT, 'stop'))
      .mockResolvedValueOnce(aiResponse(VALID_RESULT, 'stop'));

    await compactSession('s1', 'u1', true);

    expect(generateFromAIMock).toHaveBeenCalledTimes(2);
    expect(sessionSummaryMock.saveNarrative).toHaveBeenCalledWith('s1', 'El estudiante preguntó sobre integrales.', expect.any(Object));
    expect(chatModelMock.setSummaryCursor).toHaveBeenCalledWith('s1', CODE_MESSAGES[1].created_at);
  });

  it('si la alucinación de ausencia persiste tras el reintento, descarta el intento sin perder los bloques ya extraídos', async () => {
    extractBlocksMock.mockResolvedValue([
      { id: 'block_1', subject: 'informatica', extractedFromMessages: ['c2'], extractedAt: 'x', extractionModel: 'm', confidence: 'high', title: 't', content: 'c' },
    ]);
    generateFromAIMock
      .mockResolvedValueOnce(aiResponse(ABSENT_RESULT, 'stop'))
      .mockResolvedValueOnce(aiResponse(ABSENT_RESULT, 'stop'));

    await compactSession('s1', 'u1', true);

    expect(generateFromAIMock).toHaveBeenCalledTimes(2);
    expect(extractBlocksMock).toHaveBeenCalled();
    expect(sessionSummaryMock.saveNarrative).not.toHaveBeenCalled();
    expect(chatModelMock.setSummaryCursor).not.toHaveBeenCalled();
  });
});

describe('compactSession — límite a reintentos indefinidos de narrativa (Fase 2 paso 9)', () => {
  beforeEach(() => {
    generateFromAIMock.mockReset();
    chatModelMock.getSummaryCursor.mockReset().mockReturnValue(null);
    chatModelMock.getMessagesSince.mockReset().mockReturnValue(NEW_MESSAGES);
    chatModelMock.setSummaryCursor.mockReset();
    chatModelMock.getLastAssistantModel.mockReset().mockReturnValue('nvidia/thinkingmachines/inkling');
    sessionSummaryMock.getNarrative.mockReset().mockReturnValue(null);
    sessionSummaryMock.saveNarrative.mockReset();
    sessionSummaryMock.getNarrativeFailureCount.mockReset().mockReturnValue(0);
    sessionSummaryMock.recordNarrativeFailure.mockReset().mockReturnValue(1);
    sessionSummaryMock.resetNarrativeFailureCount.mockReset();
    segmentMessagesMock.mockReset().mockResolvedValue(allNarrativo());
    extractBlocksMock.mockReset().mockResolvedValue([]);
    verifyCompactionMock.mockReset().mockResolvedValue({ missing: [] });
    pickVerifierModelMock.mockReset().mockReturnValue('ag/gemini-3-flash');
  });

  it('narrativa fallida por debajo del umbral: registra el fallo pero no avanza el cursor (comportamiento previo, Task 4)', async () => {
    sessionSummaryMock.recordNarrativeFailure.mockReturnValue(2); // 2/3, aún bajo el umbral
    generateFromAIMock
      .mockResolvedValueOnce(aiResponse('{"summary": "cortado', 'length'))
      .mockResolvedValueOnce(aiResponse('{"summary": "sigue cortado', 'length'));

    await compactSession('s1', 'u1', true);

    expect(sessionSummaryMock.recordNarrativeFailure).toHaveBeenCalledWith('s1');
    expect(sessionSummaryMock.saveNarrative).not.toHaveBeenCalled();
    expect(chatModelMock.setSummaryCursor).not.toHaveBeenCalled();
  });

  it('narrativa exitosa resetea el contador de fallos', async () => {
    generateFromAIMock.mockResolvedValueOnce(aiResponse(VALID_RESULT, 'stop'));

    await compactSession('s1', 'u1', true);

    expect(sessionSummaryMock.resetNarrativeFailureCount).toHaveBeenCalledWith('s1');
    expect(sessionSummaryMock.recordNarrativeFailure).not.toHaveBeenCalled();
  });

  it('al llegar al umbral (3 fallos), fuerza el avance del cursor sin guardar narrativa y sin más intentos de IA de los que ya usa un solo pase', async () => {
    sessionSummaryMock.recordNarrativeFailure.mockReturnValue(3); // ya llegó al umbral
    generateFromAIMock
      .mockResolvedValueOnce(aiResponse('{"summary": "cortado', 'length'))
      .mockResolvedValueOnce(aiResponse('{"summary": "sigue cortado', 'length'));

    await compactSession('s1', 'u1', true);

    expect(generateFromAIMock).toHaveBeenCalledTimes(2); // solo el intento normal + 1 retry, nada extra
    expect(sessionSummaryMock.recordNarrativeFailure).toHaveBeenCalledWith('s1');
    expect(sessionSummaryMock.saveNarrative).not.toHaveBeenCalled();
    expect(chatModelMock.setSummaryCursor).toHaveBeenCalledWith('s1', NEW_MESSAGES[5].created_at);
  });
});
