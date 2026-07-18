import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('../../models/user.model.js', () => ({
  UserModel: { findById: () => undefined },
}));
vi.mock('../profile.service.js', () => ({
  ProfileService: { getProfile: () => null },
}));
vi.mock('../session-summary.service.js', () => ({
  SessionSummaryService: { getNarrative: () => null },
}));

import { ChatPromptService } from './chat.prompt.service.js';
import { ChatQuizModeService } from './chat.quiz-mode.service.js';

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
