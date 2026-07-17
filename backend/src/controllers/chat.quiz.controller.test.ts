import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const resolveQuizMock = vi.fn();
vi.mock('../services/chat/chat.quiz.service.js', () => ({
  resolveQuiz: (...args: unknown[]) => resolveQuizMock(...args),
}));

const assertOwnershipMock = vi.fn();
const getMessageByIdMock = vi.fn();
vi.mock('../models/chat.model.js', () => ({
  ChatModel: {
    assertSessionOwnership: (...args: unknown[]) => assertOwnershipMock(...args),
    getMessageById: (...args: unknown[]) => getMessageByIdMock(...args),
  },
}));

const activateMock = vi.fn();
const deactivateMock = vi.fn();
vi.mock('../services/chat/chat.quiz-mode.service.js', () => ({
  ChatQuizModeService: {
    activate: (...args: unknown[]) => activateMock(...args),
    deactivate: (...args: unknown[]) => deactivateMock(...args),
  },
}));

const saveAssistantMock = vi.fn((..._args: unknown[]) => 'new-msg-id');
vi.mock('../services/chat/chat.persistence.service.js', () => ({
  ChatPersistenceService: vi.fn().mockImplementation(function () {
    return { saveAssistantMessageWithOutbox: (...args: unknown[]): unknown => saveAssistantMock(...args) };
  }),
}));

import { resolveQuizHandler, startQuizExplainHandler, endQuizExplainHandler } from './chat.controller.js';

function mockReqRes(body: Record<string, unknown>) {
  const req = { validatedBody: body, user: { id: 'user-1' } } as unknown as Request;
  const res = {
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { req, res };
}

describe('quiz endpoints', () => {
  beforeEach(() => {
    resolveQuizMock.mockReset();
    assertOwnershipMock.mockReset();
    getMessageByIdMock.mockReset();
    activateMock.mockReset();
    deactivateMock.mockReset();
    saveAssistantMock.mockClear();
  });

  it('resolveQuizHandler resuelve, persiste y devuelve la respuesta', async () => {
    getMessageByIdMock.mockReturnValue({ id: 'm1', content: '¿Cuánto es 2+2?' });
    resolveQuizMock.mockResolvedValue('**1.** ¿Cuánto es 2+2?\n\nDesarrollo: ...\n\nRespuesta: 4');

    const { req, res } = mockReqRes({ sessionId: '11111111-1111-4111-8111-111111111111', userMsgId: 'm1' });
    await resolveQuizHandler(req, res);

    expect(assertOwnershipMock).toHaveBeenCalled();
    expect(resolveQuizMock).toHaveBeenCalledWith('¿Cuánto es 2+2?');
    expect(saveAssistantMock).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ response: expect.stringContaining('4') }));
  });

  it('resolveQuizHandler devuelve 404 si el mensaje original no existe', async () => {
    getMessageByIdMock.mockReturnValue(undefined);

    const { req, res } = mockReqRes({ sessionId: '11111111-1111-4111-8111-111111111111', userMsgId: 'nope' });
    await resolveQuizHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(resolveQuizMock).not.toHaveBeenCalled();
  });

  it('startQuizExplainHandler activa el flag', async () => {
    const { req, res } = mockReqRes({ sessionId: '11111111-1111-4111-8111-111111111111' });
    await startQuizExplainHandler(req, res);

    expect(activateMock).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('endQuizExplainHandler desactiva el flag', async () => {
    const { req, res } = mockReqRes({ sessionId: '11111111-1111-4111-8111-111111111111' });
    await endQuizExplainHandler(req, res);

    expect(deactivateMock).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });
});
