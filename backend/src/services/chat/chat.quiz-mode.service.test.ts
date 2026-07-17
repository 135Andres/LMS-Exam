import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { ChatQuizModeService } from './chat.quiz-mode.service.js';

const SESSION_ID = 'quiz-mode-test-session';
const STATE_DIR = path.resolve('data/quiz-mode');

describe('ChatQuizModeService', () => {
  afterEach(() => {
    ChatQuizModeService.deactivate(SESSION_ID);
  });

  it('isActive es false por defecto', () => {
    expect(ChatQuizModeService.isActive(SESSION_ID)).toBe(false);
  });

  it('activate + isActive', () => {
    ChatQuizModeService.activate(SESSION_ID);
    expect(ChatQuizModeService.isActive(SESSION_ID)).toBe(true);
  });

  it('deactivate limpia el flag', () => {
    ChatQuizModeService.activate(SESSION_ID);
    ChatQuizModeService.deactivate(SESSION_ID);
    expect(ChatQuizModeService.isActive(SESSION_ID)).toBe(false);
    expect(fs.existsSync(path.join(STATE_DIR, `${SESSION_ID}.json`))).toBe(false);
  });
});
