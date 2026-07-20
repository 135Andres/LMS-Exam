import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const interceptMock = vi.fn();
const answerMock = vi.fn();
const skipMock = vi.fn();
vi.mock('../services/onboarding.service.js', () => ({
  OnboardingService: {
    intercept: (...args: unknown[]) => interceptMock(...args),
    answer: (...args: unknown[]) => answerMock(...args),
    skip: (...args: unknown[]) => skipMock(...args),
  },
}));

const sendChatMessageMock = vi.fn();
vi.mock('../services/chat.service.js', () => ({
  sendChatMessage: (...args: unknown[]) => sendChatMessageMock(...args),
  sendChatMessageStream: vi.fn(),
  regenerateChatMessageStream: vi.fn(),
}));

const assertOwnershipMock = vi.fn();
vi.mock('../models/chat.model.js', () => ({
  ChatModel: {
    assertSessionOwnership: (...args: unknown[]) => assertOwnershipMock(...args),
  },
}));

import { sendChatMessageHandler, onboardingAnswerHandler, onboardingSkipHandler } from './chat.controller.js';

function mockReqRes(body: Record<string, unknown>) {
  const req = { validatedBody: body, user: { id: 'user-1' } } as unknown as Request;
  const res = {
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { req, res };
}

describe('interceptor de onboarding en sendChatMessageHandler', () => {
  beforeEach(() => {
    interceptMock.mockReset();
    sendChatMessageMock.mockReset();
    assertOwnershipMock.mockReset();
  });

  it('cuando el interceptor devuelve un paso, responde el paso y NUNCA llama a la IA', async () => {
    const stepPayload = { type: 'onboarding_step', step: 1, total: 5, prompt: '¿Cómo te llamas?', inputs: [] };
    interceptMock.mockReturnValue(stepPayload);

    const { req, res } = mockReqRes({ message: 'hola' });
    await sendChatMessageHandler(req, res);

    expect(res.json).toHaveBeenCalledWith(stepPayload);
    expect(sendChatMessageMock).not.toHaveBeenCalled();
  });

  it('cuando el interceptor devuelve passthrough, procede a llamar a la IA normalmente', async () => {
    interceptMock.mockReturnValue({ type: 'passthrough' });
    sendChatMessageMock.mockResolvedValue({ response: 'respuesta normal' });

    const { req, res } = mockReqRes({ message: 'hola' });
    await sendChatMessageHandler(req, res);

    expect(sendChatMessageMock).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ response: 'respuesta normal' }));
  });
});

describe('onboardingAnswerHandler', () => {
  beforeEach(() => {
    answerMock.mockReset();
  });

  it('delega en OnboardingService.answer y devuelve su resultado tal cual', async () => {
    const result = { type: 'onboarding_step', step: 2, total: 5, prompt: '...', inputs: [] };
    answerMock.mockResolvedValue(result);

    const { req, res } = mockReqRes({ step: 1, values: { display_name: 'Andrés' } });
    await onboardingAnswerHandler(req, res);

    expect(answerMock).toHaveBeenCalledWith('user-1', 1, { display_name: 'Andrés' });
    expect(res.json).toHaveBeenCalledWith(result);
  });
});

describe('onboardingSkipHandler', () => {
  beforeEach(() => {
    skipMock.mockReset();
    sendChatMessageMock.mockReset();
  });

  it('sin mensaje pendiente, devuelve onboarding_skipped sin tocar la IA', async () => {
    skipMock.mockReturnValue({ type: 'onboarding_skipped' });

    const { req, res } = mockReqRes({});
    await onboardingSkipHandler(req, res);

    expect(sendChatMessageMock).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ type: 'onboarding_skipped' });
  });

  it('con mensaje pendiente, responde por el canal normal de chat', async () => {
    skipMock.mockReturnValue({ type: 'chat_passthrough', message: 'hola', sessionId: 'sess-1' });
    sendChatMessageMock.mockResolvedValue({ response: 'respuesta normal' });

    const { req, res } = mockReqRes({});
    await onboardingSkipHandler(req, res);

    expect(sendChatMessageMock).toHaveBeenCalledWith('hola', undefined, undefined, 'user-1', 'sess-1');
    expect(res.json).toHaveBeenCalledWith({ response: 'respuesta normal', sessionId: 'sess-1' });
  });
});
