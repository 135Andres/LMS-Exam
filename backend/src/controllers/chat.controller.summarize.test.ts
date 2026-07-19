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
vi.mock('../services/session-summary.service.js', () => ({
  SessionSummaryService: {
    getNarrative: (...args: unknown[]) => getNarrativeMock(...args),
    getBlocks: (...args: unknown[]) => getBlocksMock(...args),
  },
}));

import { summarizeSessionHandler } from './chat.controller.js';

function mockReqRes(body: Record<string, unknown>) {
  const req = { validatedBody: body, user: { id: 'user-1' } } as unknown as Request;
  const res = {
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { req, res };
}

describe('summarizeSessionHandler', () => {
  beforeEach(() => {
    assertOwnershipMock.mockReset();
    compactSessionMock.mockReset();
    getNarrativeMock.mockReset();
    getBlocksMock.mockReset();
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
