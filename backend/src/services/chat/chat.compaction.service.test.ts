// backend/src/services/chat/chat.compaction.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { generateFromAIMock, chatModelMock, sessionSummaryMock, knowledgeModelMock } = vi.hoisted(() => ({
  generateFromAIMock: vi.fn(),
  chatModelMock: {
    getSummaryCursor: vi.fn(),
    getMessagesSince: vi.fn(),
    setSummaryCursor: vi.fn(),
    getLastAssistantModel: vi.fn(),
  },
  sessionSummaryMock: {
    getSummary: vi.fn(),
    saveSummary: vi.fn(),
  },
  knowledgeModelMock: {
    existsByHash: vi.fn(),
    create: vi.fn(),
  },
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

vi.mock('../../models/knowledge.model.js', () => ({
  KnowledgeModel: knowledgeModelMock,
  hashKnowledgeContent: (content: string) => `hash:${content}`,
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

const VALID_RESULT = JSON.stringify({
  summary: 'El estudiante preguntó sobre integrales.',
  confidence: 'high',
  reviewedMessageCount: 6,
  kbCandidates: [],
});

describe('compactSession — modelo dinámico', () => {
  beforeEach(() => {
    generateFromAIMock.mockReset();
    chatModelMock.getSummaryCursor.mockReset().mockReturnValue(null);
    chatModelMock.getMessagesSince.mockReset().mockReturnValue(NEW_MESSAGES);
    chatModelMock.setSummaryCursor.mockReset();
    chatModelMock.getLastAssistantModel.mockReset();
    sessionSummaryMock.getSummary.mockReset().mockReturnValue(null);
    sessionSummaryMock.saveSummary.mockReset();
    knowledgeModelMock.existsByHash.mockReset().mockReturnValue(false);
    knowledgeModelMock.create.mockReset();
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
    sessionSummaryMock.getSummary.mockReset().mockReturnValue(null);
    sessionSummaryMock.saveSummary.mockReset();
    knowledgeModelMock.existsByHash.mockReset().mockReturnValue(false);
    knowledgeModelMock.create.mockReset();
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
    expect(sessionSummaryMock.saveSummary).toHaveBeenCalledWith('s1', 'El estudiante preguntó sobre integrales.');
  });

  it('descarta el intento (no guarda nada) si sigue truncado tras el reintento', async () => {
    generateFromAIMock
      .mockResolvedValueOnce(aiResponse('{"summary": "cortado', 'length'))
      .mockResolvedValueOnce(aiResponse('{"summary": "sigue cortado', 'length'));

    await compactSession('s1', 'u1', true);

    expect(generateFromAIMock).toHaveBeenCalledTimes(2);
    expect(sessionSummaryMock.saveSummary).not.toHaveBeenCalled();
    expect(chatModelMock.setSummaryCursor).not.toHaveBeenCalled();
  });
});

describe('compactSession — auditoría de confianza y cobertura', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    generateFromAIMock.mockReset();
    chatModelMock.getSummaryCursor.mockReset().mockReturnValue(null);
    chatModelMock.getMessagesSince.mockReset().mockReturnValue(NEW_MESSAGES);
    chatModelMock.setSummaryCursor.mockReset();
    chatModelMock.getLastAssistantModel.mockReset().mockReturnValue('nvidia/thinkingmachines/inkling');
    sessionSummaryMock.getSummary.mockReset().mockReturnValue(null);
    sessionSummaryMock.saveSummary.mockReset();
    knowledgeModelMock.existsByHash.mockReset().mockReturnValue(false);
    knowledgeModelMock.create.mockReset();
    const { logger } = await import('../../utils/logger.js');
    // vi.spyOn reutiliza la misma instancia de mock si el módulo ya estaba
    // espiado (import cacheado entre tests) — mockClear evita que las
    // llamadas de un test anterior contaminen el conteo del siguiente.
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as any);
    infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined as any);
    warnSpy.mockClear();
    infoSpy.mockClear();
  });

  it('loguea un warning si reviewedMessageCount es menor a los mensajes reales (posible contenido saltado)', async () => {
    generateFromAIMock.mockResolvedValueOnce(aiResponse(JSON.stringify({
      summary: 'resumen parcial', confidence: 'high', reviewedMessageCount: 3, kbCandidates: [],
    })));

    await compactSession('s1', 'u1', true);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/cobertura|reviewedMessageCount|menos mensajes/i),
      expect.objectContaining({ sessionId: 's1', expected: 6, reviewedMessageCount: 3 }),
    );
    // Un mismatch de cobertura NO bloquea el guardado — solo se audita (Fase 3 corrige).
    expect(sessionSummaryMock.saveSummary).toHaveBeenCalledWith('s1', 'resumen parcial');
  });

  it('loguea un warning si confidence no es "high"', async () => {
    generateFromAIMock.mockResolvedValueOnce(aiResponse(JSON.stringify({
      summary: 'resumen dudoso', confidence: 'low', reviewedMessageCount: 6, kbCandidates: [],
    })));

    await compactSession('s1', 'u1', true);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/confianza baja|confidence/i),
      expect.objectContaining({ sessionId: 's1', confidence: 'low' }),
    );
  });

  it('loguea un warning si reviewedMessageCount no vino en la respuesta', async () => {
    generateFromAIMock.mockResolvedValueOnce(aiResponse(JSON.stringify({
      summary: 'resumen sin conteo', confidence: 'high', kbCandidates: [],
    })));

    await compactSession('s1', 'u1', true);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/reviewedMessageCount ausente/i),
      expect.objectContaining({ sessionId: 's1' }),
    );
  });

  it('no loguea ningún warning de auditoría cuando confidence es high y el conteo coincide', async () => {
    generateFromAIMock.mockResolvedValueOnce(aiResponse(JSON.stringify({
      summary: 'resumen completo', confidence: 'high', reviewedMessageCount: 6, kbCandidates: [],
    })));

    await compactSession('s1', 'u1', true);

    expect(warnSpy).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith('Sesión compactada', expect.objectContaining({
      confidence: 'high', reviewedMessageCount: 6,
    }));
  });

  it('audita cobertura/confianza incluso cuando el resumen viene vacío y no se guarda nada', async () => {
    generateFromAIMock.mockResolvedValueOnce(aiResponse(JSON.stringify({
      summary: '', confidence: 'low', reviewedMessageCount: 2, kbCandidates: [],
    })));

    await compactSession('s1', 'u1', true);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/cobertura|reviewedMessageCount|menos mensajes/i),
      expect.objectContaining({ sessionId: 's1', expected: 6, reviewedMessageCount: 2 }),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/confianza baja|confidence/i),
      expect.objectContaining({ sessionId: 's1', confidence: 'low' }),
    );
    expect(sessionSummaryMock.saveSummary).not.toHaveBeenCalled();
    expect(chatModelMock.setSummaryCursor).not.toHaveBeenCalled();
  });
});
