import { describe, it, expect, vi, beforeEach } from 'vitest';

const { generateFromAIMock } = vi.hoisted(() => ({ generateFromAIMock: vi.fn() }));
vi.mock('../ai/index.js', () => ({
  generateFromAI: (...args: unknown[]) => generateFromAIMock(...args),
}));

const { chatModelMock } = vi.hoisted(() => ({
  chatModelMock: {
    getSummaryCursor: vi.fn(() => null),
    getMessagesSince: vi.fn(() => []),
    getLastAssistantModel: vi.fn(() => null),
    getSessionMessages: vi.fn(() => []),
  },
}));
vi.mock('../../models/chat.model.js', () => ({ ChatModel: chatModelMock }));

vi.mock('../user-profile.service.js', () => ({
  UserProfileService: { getProfile: vi.fn(() => null) },
}));

vi.mock('../knowledge-detection.service.js', () => ({
  detectAndSuggestKnowledge: vi.fn(() => Promise.resolve()),
}));

vi.mock('./chat.compaction.service.js', () => ({
  compactSession: vi.fn(() => Promise.resolve({ status: 'compacted' })),
}));

import { ChatCompletionService } from './chat.completion.service.js';
import type { ResolvedModel } from './chat.model-router.js';

function buildService(resolved: ResolvedModel) {
  const persistence = {
    saveUserMessageWithOutbox: vi.fn(() => ({ msgId: 'm1', outboxId: 'o1' })),
    saveAssistantMessageWithOutbox: vi.fn(),
  };
  const embeddingService = { generateAndSave: vi.fn(() => Promise.resolve(null)) };
  const ragService = { buildContext: vi.fn() };
  const profileDetectionService = { detectAndApply: vi.fn(() => Promise.resolve(null)) };
  const modelRouter = {
    resolve: vi.fn(() => resolved),
    validateMultimodal: vi.fn(),
  };
  const promptService = {
    buildSystemPrompt: vi.fn(() => 'system prompt'),
    buildContent: vi.fn((message: string) => message),
  };
  const orchestrator = { decide: vi.fn() };

  const service = new ChatCompletionService(
    persistence as any, embeddingService as any, ragService as any,
    profileDetectionService as any, modelRouter as any, promptService as any, orchestrator as any,
  );

  return { service, modelRouter, orchestrator };
}

describe('ChatCompletionService — nunca exponer un modelo no elegido explícitamente (FIX 3 consolidado)', () => {
  beforeEach(() => {
    generateFromAIMock.mockReset();
  });

  it('timeout con modelId explícito: el error nombra el modelo elegido con su label bonito', async () => {
    const resolved: ResolvedModel = { model: 'nvidia/z-ai/glm-5.2', label: 'glm-5.2', multimodal: false };
    const { service, orchestrator } = buildService(resolved);
    generateFromAIMock.mockRejectedValueOnce(new Error('timeout'));

    const result = await service.execute('hola', 'nvidia/z-ai/glm-5.2', undefined, 'user-1', 'session-1');

    expect(result.response).toContain('GLM 5.2');
    expect(result.response).not.toContain('Inkling');
    // Con modelId explícito, no se orquesta (decide() nunca se llama).
    expect(orchestrator.decide).not.toHaveBeenCalled();
  });

  it('timeout SIN modelId explícito (posible delegación automática): el error dice "Inkling", nunca el subagente real', async () => {
    // decision.model simula que el orquestador delegó a GLM sin que el usuario lo pidiera.
    const resolved: ResolvedModel = { model: 'nvidia/z-ai/glm-5.2', label: 'glm-5.2', multimodal: false };
    const { service, orchestrator } = buildService(resolved);
    orchestrator.decide.mockReturnValue({ model: 'nvidia/z-ai/glm-5.2', classification: {} });
    generateFromAIMock.mockRejectedValueOnce(new Error('timeout'));

    const result = await service.execute('hola', undefined, undefined, 'user-1', 'session-1');

    expect(result.response).toContain('Inkling');
    expect(result.response).not.toContain('glm-5.2');
    expect(result.response).not.toContain('GLM 5.2');
  });

  it('camino feliz con modelId explícito: no hay mensaje de error, responde el contenido generado', async () => {
    const resolved: ResolvedModel = { model: 'ag/claude-sonnet-4-6', label: 'claude-sonnet-4-6', multimodal: false };
    const { service } = buildService(resolved);
    generateFromAIMock.mockResolvedValueOnce({ content: 'respuesta ok', usage: {} });

    const result = await service.execute('hola', 'ag/claude-sonnet-4-6', undefined, 'user-1', 'session-1');

    expect(result.response).toBe('respuesta ok');
  });
});
