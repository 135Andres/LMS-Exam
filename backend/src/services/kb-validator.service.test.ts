import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { KnowledgeBaseItem } from '../models/knowledge.model.js';

const generateFromAIMock = vi.fn();
vi.mock('./ai/index.js', () => ({
  generateFromAI: (...args: unknown[]) => generateFromAIMock(...args),
}));

const generateEmbeddingMock = vi.fn();
vi.mock('./ai/embeddings.js', () => ({
  generateEmbedding: (...args: unknown[]) => generateEmbeddingMock(...args),
}));

const getPendingReviewMock = vi.fn();
const publishWithAiVerificationMock = vi.fn();
const rejectMock = vi.fn();
vi.mock('../models/knowledge.model.js', () => ({
  KnowledgeModel: {
    getPendingReview: (...args: unknown[]) => getPendingReviewMock(...args),
    publishWithAiVerification: (...args: unknown[]) => publishWithAiVerificationMock(...args),
    reject: (...args: unknown[]) => rejectMock(...args),
  },
}));

const saveEmbeddingMock = vi.fn();
vi.mock('../models/knowledge-embedding.model.js', () => ({
  KnowledgeEmbeddingModel: {
    save: (...args: unknown[]) => saveEmbeddingMock(...args),
  },
}));

import { validatePendingKnowledge } from './kb-validator.service.js';

function aiResponse(content: string) {
  return { content, usage: { promptTokens: 10, completionTokens: 10 } };
}

function pendingItem(overrides: Partial<KnowledgeBaseItem> = {}): KnowledgeBaseItem {
  return {
    id: 'item-1',
    content: '¿Qué es una derivada? Es la tasa de cambio instantánea de una función.',
    summary: null,
    subject: 'matematicas',
    topic: null,
    difficulty: 'basico',
    source_type: 'chat',
    source_user_id: 'user-1',
    is_verified: false,
    verified_by: null,
    verified_by_ai: null,
    verified_at: null,
    upvotes: 0,
    downvotes: 0,
    view_count: 0,
    tags: [],
    language: 'es',
    content_hash: 'hash',
    status: 'pending_review',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('validatePendingKnowledge', () => {
  beforeEach(() => {
    generateFromAIMock.mockReset();
    generateEmbeddingMock.mockReset();
    getPendingReviewMock.mockReset();
    publishWithAiVerificationMock.mockReset();
    rejectMock.mockReset();
    saveEmbeddingMock.mockReset();
  });

  it('publica un candidato válido y correcto con JSON bien formado', async () => {
    getPendingReviewMock.mockReturnValue([pendingItem()]);
    generateFromAIMock.mockResolvedValue(aiResponse(JSON.stringify({
      valuable: true, correct: true, subject: 'matematicas', topic: 'derivadas', tags: ['calculo'], difficulty: 'basico',
    })));
    generateEmbeddingMock.mockResolvedValue([0.1, 0.2, 0.3]);

    await validatePendingKnowledge();

    expect(publishWithAiVerificationMock).toHaveBeenCalledTimes(1);
    expect(rejectMock).not.toHaveBeenCalled();
  });

  it('no lanza SyntaxError cuando result.content trae un backslash de LaTeX suelto', async () => {
    getPendingReviewMock.mockReturnValue([pendingItem()]);
    // Un \sqrt sin escapar rompería un JSON.parse ingenuo con "Bad escaped character".
    generateFromAIMock.mockResolvedValue(aiResponse(
      '{"valuable": true, "correct": true, "subject": "matematicas", "topic": "\\sqrt{4}", "tags": [], "difficulty": "basico", "reason": "ok"}',
    ));
    generateEmbeddingMock.mockResolvedValue([0.1]);

    await expect(validatePendingKnowledge()).resolves.not.toThrow();

    expect(publishWithAiVerificationMock).toHaveBeenCalledTimes(1);
    expect(publishWithAiVerificationMock.mock.calls[0][1].topic).toBe('\\sqrt{4}');
    expect(rejectMock).not.toHaveBeenCalled();
  });

  it('rechaza el candidato cuando valuable o correct es false', async () => {
    getPendingReviewMock.mockReturnValue([pendingItem()]);
    generateFromAIMock.mockResolvedValue(aiResponse(JSON.stringify({
      valuable: false, correct: true, subject: 'matematicas', reason: 'muy específico de la tarea',
    })));

    await validatePendingKnowledge();

    expect(rejectMock).toHaveBeenCalledTimes(1);
    expect(publishWithAiVerificationMock).not.toHaveBeenCalled();
  });

  it('un candidato con JSON irreparable no interrumpe el resto del batch', async () => {
    getPendingReviewMock.mockReturnValue([pendingItem({ id: 'item-broken' }), pendingItem({ id: 'item-ok' })]);
    generateFromAIMock
      .mockResolvedValueOnce(aiResponse('esto no es JSON'))
      .mockResolvedValueOnce(aiResponse(JSON.stringify({ valuable: true, correct: true, subject: 'matematicas' })));
    generateEmbeddingMock.mockResolvedValue([0.1]);

    await validatePendingKnowledge();

    expect(publishWithAiVerificationMock).toHaveBeenCalledTimes(1);
    expect(publishWithAiVerificationMock.mock.calls[0][0]).toBe('item-ok');
  });

  it('no hace nada si no hay candidatos pendientes', async () => {
    getPendingReviewMock.mockReturnValue([]);

    await validatePendingKnowledge();

    expect(generateFromAIMock).not.toHaveBeenCalled();
  });
});
