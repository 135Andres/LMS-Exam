import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const assertOwnershipMock = vi.fn();
vi.mock('../models/chat.model.js', () => ({
  ChatModel: {
    assertSessionOwnership: (...args: unknown[]) => assertOwnershipMock(...args),
  },
}));

const compactSessionMock = vi.fn();
vi.mock('../services/chat/chat.compaction.service.js', () => ({
  compactSession: (...args: unknown[]) => compactSessionMock(...args),
}));

const getNarrativeMock = vi.fn();
const getBlocksMock = vi.fn();
const getNarrativeFailureCountMock = vi.fn();
const saveNarrativeMock = vi.fn();
const getIndexMock = vi.fn();
vi.mock('../services/session-summary.service.js', () => ({
  SessionSummaryService: {
    getNarrative: (...args: unknown[]) => getNarrativeMock(...args),
    getBlocks: (...args: unknown[]) => getBlocksMock(...args),
    getNarrativeFailureCount: (...args: unknown[]) => getNarrativeFailureCountMock(...args),
    saveNarrative: (...args: unknown[]) => saveNarrativeMock(...args),
    getIndex: (...args: unknown[]) => getIndexMock(...args),
  },
}));

const loggerWarnMock = vi.fn();
vi.mock('../utils/logger.js', () => ({
  logger: { warn: (...args: unknown[]) => loggerWarnMock(...args), info: vi.fn(), error: vi.fn() },
}));

import { summarizeSessionHandler, getSessionSummaryHandler, updateSessionSummaryHandler } from './chat.controller.js';

function mockReqRes(body: Record<string, unknown>) {
  const req = { validatedBody: body, user: { id: 'user-1' } } as unknown as Request;
  const res = {
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { req, res };
}

// getSessionSummaryHandler es un GET — recibe session_id por query string, no
// por validatedBody (no hay body en un GET).
function mockReqResQuery(query: Record<string, unknown>) {
  const req = { query, user: { id: 'user-1' } } as unknown as Request;
  const res = {
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { req, res };
}

describe('summarizeSessionHandler', () => {
  beforeEach(() => {
    assertOwnershipMock.mockReset();
    compactSessionMock.mockReset().mockResolvedValue({ status: 'compacted' });
    getNarrativeMock.mockReset();
    getBlocksMock.mockReset();
    getNarrativeFailureCountMock.mockReset().mockReturnValue(0);
    saveNarrativeMock.mockReset();
    getIndexMock.mockReset().mockReturnValue({ narrativeCompactions: [], blocks: [] });
    loggerWarnMock.mockReset();
  });

  it('devuelve blocks como metadata liviana ({id, title, subject}), sin el content completo', async () => {
    getNarrativeMock.mockReturnValue('resumen de la sesión');
    getBlocksMock.mockReturnValue([
      { id: 'b1', title: 'Derivadas', subject: 'Cálculo', content: 'contenido completo largo...', extractedAt: '2026-07-18', confidence: 0.9 },
    ]);

    const { req, res } = mockReqRes({ sessionId: '11111111-1111-4111-8111-111111111111' });
    await summarizeSessionHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      summary: 'resumen de la sesión',
      blocks: [{ id: 'b1', title: 'Derivadas', subject: 'Cálculo' }],
    });
  });

  it('devuelve blocks como [] cuando la sesión no tiene bloques (no undefined, no ausente)', async () => {
    getNarrativeMock.mockReturnValue('solo narrativa');
    getBlocksMock.mockReturnValue([]);

    const { req, res } = mockReqRes({ sessionId: '11111111-1111-4111-8111-111111111111' });
    await summarizeSessionHandler(req, res);

    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.blocks).toEqual([]);
    expect('blocks' in payload).toBe(true);
  });

  it('summary se comporta igual que antes', async () => {
    getNarrativeMock.mockReturnValue(null);
    getBlocksMock.mockReturnValue([]);

    const { req, res } = mockReqRes({ sessionId: '11111111-1111-4111-8111-111111111111' });
    await summarizeSessionHandler(req, res);

    expect(compactSessionMock).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', 'user-1', true);
    expect(res.json).toHaveBeenCalledWith({ summary: null, blocks: [] });
  });

  it('loggea warning si compactSession falla, pero igual responde 200 con summary null/blocks []', async () => {
    compactSessionMock.mockResolvedValue({ status: 'failed_segmentation' });
    getNarrativeMock.mockReturnValue(null);
    getBlocksMock.mockReturnValue([]);

    const { req, res } = mockReqRes({ sessionId: '11111111-1111-4111-8111-111111111111' });
    await summarizeSessionHandler(req, res);

    expect(loggerWarnMock).toHaveBeenCalledWith(
      'Comando /resumen no pudo compactar',
      expect.objectContaining({ outcome: { status: 'failed_segmentation' } }),
    );
    expect(res.json).toHaveBeenCalledWith({ summary: null, blocks: [] });
  });

  it('no loggea warning cuando compactSession compacta u omite por falta de mensajes nuevos', async () => {
    compactSessionMock.mockResolvedValue({ status: 'skipped_no_new_messages' });
    getNarrativeMock.mockReturnValue(null);
    getBlocksMock.mockReturnValue([]);

    const { req, res } = mockReqRes({ sessionId: '11111111-1111-4111-8111-111111111111' });
    await summarizeSessionHandler(req, res);

    expect(loggerWarnMock).not.toHaveBeenCalled();
  });

  it('devuelve 403 si el usuario no tiene acceso a la sesión (sin regresión)', async () => {
    assertOwnershipMock.mockImplementation(() => {
      throw new Error('forbidden');
    });

    const { req, res } = mockReqRes({ sessionId: '11111111-1111-4111-8111-111111111111' });
    await summarizeSessionHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'No tienes acceso a esta sesión' });
    expect(compactSessionMock).not.toHaveBeenCalled();
    expect(getNarrativeMock).not.toHaveBeenCalled();
  });
});

describe('getSessionSummaryHandler (GET /api/chat/summary — Fase 4)', () => {
  const validSessionId = '11111111-1111-4111-8111-111111111111';

  // Cada describe necesita su propio reset — el beforeEach de arriba está
  // scoped al describe de summarizeSessionHandler, no aplica acá (si no se
  // resetea, un mockImplementation que tira de un test anterior se filtra).
  beforeEach(() => {
    assertOwnershipMock.mockReset();
    compactSessionMock.mockReset();
    getNarrativeMock.mockReset();
    getBlocksMock.mockReset();
    getNarrativeFailureCountMock.mockReset().mockReturnValue(0);
  });

  it('sesión sin resumen todavía: narrative null, blocks []', async () => {
    getNarrativeMock.mockReturnValue(null);
    getBlocksMock.mockReturnValue([]);

    const { req, res } = mockReqResQuery({ session_id: validSessionId });
    await getSessionSummaryHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({ narrative: null, blocks: [], failedRecently: false });
  });

  it('sesión con narrativa y bloques devuelve el content COMPLETO por bloque (a diferencia de /tutor/summary)', async () => {
    getNarrativeMock.mockReturnValue('narrativa completa de la sesión');
    getBlocksMock.mockReturnValue([
      {
        id: 'block_1', title: 'Derivadas', subject: 'Cálculo', content: 'contenido completo largo del bloque',
        extractedFromMessages: [], extractedAt: '2026-07-18', extractionModel: 'x', confidence: 'high',
      },
    ]);

    const { req, res } = mockReqResQuery({ session_id: validSessionId });
    await getSessionSummaryHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      narrative: 'narrativa completa de la sesión',
      blocks: [{ id: 'block_1', title: 'Derivadas', subject: 'Cálculo', content: 'contenido completo largo del bloque' }],
      failedRecently: false,
    });
  });

  it('session_id ausente → 400', async () => {
    const { req, res } = mockReqResQuery({});
    await getSessionSummaryHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(getNarrativeMock).not.toHaveBeenCalled();
  });

  it('session_id con formato inválido → 400', async () => {
    const { req, res } = mockReqResQuery({ session_id: 'no-es-un-uuid' });
    await getSessionSummaryHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(getNarrativeMock).not.toHaveBeenCalled();
  });

  it('sesión de otro usuario → 403', async () => {
    assertOwnershipMock.mockImplementation(() => { throw new Error('forbidden'); });

    const { req, res } = mockReqResQuery({ session_id: validSessionId });
    await getSessionSummaryHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'No tienes acceso a esta sesión' });
    expect(getNarrativeMock).not.toHaveBeenCalled();
  });

  it('failedRecently es true cuando getNarrativeFailureCount > 0', async () => {
    getNarrativeMock.mockReturnValue('algo');
    getBlocksMock.mockReturnValue([]);
    getNarrativeFailureCountMock.mockReturnValue(2);

    const { req, res } = mockReqResQuery({ session_id: validSessionId });
    await getSessionSummaryHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({ narrative: 'algo', blocks: [], failedRecently: true });
  });

  it('NUNCA llama a compactSession — es un endpoint de solo lectura', async () => {
    getNarrativeMock.mockReturnValue(null);
    getBlocksMock.mockReturnValue([]);

    const { req, res } = mockReqResQuery({ session_id: validSessionId });
    await getSessionSummaryHandler(req, res);

    expect(compactSessionMock).not.toHaveBeenCalled();
  });
});

describe('updateSessionSummaryHandler (PUT /api/chat/summary — Fase 4)', () => {
  const validSessionId = '11111111-1111-4111-8111-111111111111';

  beforeEach(() => {
    assertOwnershipMock.mockReset();
    compactSessionMock.mockReset();
    saveNarrativeMock.mockReset();
  });

  it('edición válida sobrescribe la narrativa vía SessionSummaryService.saveNarrative con meta.model=user_edit', async () => {
    const { req, res } = mockReqRes({ sessionId: validSessionId, content: 'narrativa editada a mano' });
    await updateSessionSummaryHandler(req, res);

    expect(saveNarrativeMock).toHaveBeenCalledWith(
      validSessionId,
      'narrativa editada a mano',
      expect.objectContaining({ model: 'user_edit' }),
    );
    expect(res.json).toHaveBeenCalledWith({ narrative: 'narrativa editada a mano' });
  });

  it('sesión de otro usuario → 403, no escribe nada', async () => {
    assertOwnershipMock.mockImplementation(() => { throw new Error('forbidden'); });

    const { req, res } = mockReqRes({ sessionId: validSessionId, content: 'intento ajeno' });
    await updateSessionSummaryHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(saveNarrativeMock).not.toHaveBeenCalled();
  });

  it('nunca dispara ninguna llamada a IA ni a compactSession/verificación', async () => {
    const { req, res } = mockReqRes({ sessionId: validSessionId, content: 'texto manual' });
    await updateSessionSummaryHandler(req, res);

    expect(compactSessionMock).not.toHaveBeenCalled();
  });
});
