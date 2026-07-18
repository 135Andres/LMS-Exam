import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('../../models/user.model.js', () => ({
  UserModel: { findById: () => undefined },
}));
vi.mock('../profile.service.js', () => ({
  ProfileService: { getProfile: () => null },
}));
vi.mock('../session-summary.service.js', () => ({
  SessionSummaryService: { getNarrative: () => null, getBlocks: () => [] },
}));

import { ChatPromptService } from './chat.prompt.service.js';
import { ChatQuizModeService } from './chat.quiz-mode.service.js';
import { SessionSummaryService, type KnowledgeBlock } from '../session-summary.service.js';

const SESSION_ID = 'prompt-swap-test-session';

describe('ChatPromptService modo Explicar', () => {
  afterEach(() => {
    ChatQuizModeService.deactivate(SESSION_ID);
  });

  it('usa SYSTEM_PROMPT_TUTOR cuando el modo Explicar no está activo', () => {
    const service = new ChatPromptService();
    const prompt = service.buildSystemPrompt('Modelo X', '', 'user-1', undefined, SESSION_ID);
    expect(prompt).not.toContain('QUIZ_EXPLAIN_DONE');
  });

  it('usa SYSTEM_PROMPT_QUIZ_EXPLAIN cuando el modo Explicar está activo', () => {
    ChatQuizModeService.activate(SESSION_ID);
    const service = new ChatPromptService();
    const prompt = service.buildSystemPrompt('Modelo X', '', 'user-1', undefined, SESSION_ID);
    expect(prompt).toContain('[[QUIZ_EXPLAIN_DONE]]');
  });
});

function makeBlock(overrides: Partial<KnowledgeBlock>): KnowledgeBlock {
  return {
    id: 'block_1',
    subject: 'matematicas',
    extractedFromMessages: [],
    extractedAt: '2026-01-01T00:00:00.000Z',
    extractionModel: 'test-model',
    confidence: 'high',
    title: 'Bloque de prueba',
    content: 'Contenido de prueba',
    ...overrides,
  };
}

describe('ChatPromptService inyección de bloques de conocimiento', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('no agrega sección de bloques cuando no hay bloques', () => {
    vi.spyOn(SessionSummaryService, 'getBlocks').mockReturnValue([]);
    const service = new ChatPromptService();
    const prompt = service.buildSystemPrompt('Modelo X', '', 'user-1', undefined, SESSION_ID);
    expect(prompt).not.toContain('Contenido técnico ya extraído');
  });

  it('incluye el contenido completo de todos los bloques cuando entran en el presupuesto', () => {
    const blocks = [
      makeBlock({ id: 'block_a', title: 'Derivada de x^2', content: 'd/dx x^2 = 2x', extractedAt: '2026-01-01T00:00:00.000Z' }),
      makeBlock({ id: 'block_b', title: 'Integral de 2x', content: 'integral de 2x = x^2 + C', extractedAt: '2026-01-02T00:00:00.000Z' }),
    ];
    vi.spyOn(SessionSummaryService, 'getBlocks').mockReturnValue(blocks);
    const service = new ChatPromptService();
    const prompt = service.buildSystemPrompt('Modelo X', '', 'user-1', undefined, SESSION_ID);
    expect(prompt).toContain('Derivada de x^2');
    expect(prompt).toContain('d/dx x^2 = 2x');
    expect(prompt).toContain('Integral de 2x');
    expect(prompt).toContain('integral de 2x = x^2 + C');
  });

  it('cuando excede el presupuesto, prioriza los bloques más recientes y descarta los más viejos', () => {
    const bigContent = 'X'.repeat(5000);
    const blocks = [
      makeBlock({ id: 'block_old', title: 'BLOQUE_VIEJO', content: bigContent, extractedAt: '2026-01-01T00:00:00.000Z' }),
      makeBlock({ id: 'block_new', title: 'BLOQUE_NUEVO', content: bigContent, extractedAt: '2026-01-03T00:00:00.000Z' }),
      makeBlock({ id: 'block_mid', title: 'BLOQUE_MEDIO', content: bigContent, extractedAt: '2026-01-02T00:00:00.000Z' }),
    ];
    vi.spyOn(SessionSummaryService, 'getBlocks').mockReturnValue(blocks);
    const service = new ChatPromptService();
    const prompt = service.buildSystemPrompt('Modelo X', '', 'user-1', undefined, SESSION_ID);
    expect(prompt).toContain('BLOQUE_NUEVO');
    expect(prompt).not.toContain('BLOQUE_VIEJO');
  });
});
