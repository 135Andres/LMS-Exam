import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb, getTestDb } from '../../../test/setup.js';
import { ChatPersistenceService } from './chat.persistence.service.js';

const USER_ID = 'user-1';
const SESSION_ID = 'session-1';

describe('ChatPersistenceService', () => {
  beforeEach(() => {
    resetDb();
    getTestDb().prepare('INSERT INTO users (id, email) VALUES (?, ?)').run(USER_ID, 'u@test.com');
  });

  it('strips [[QUIZ_DETECTED]] from persisted assistant content', () => {
    const persistence = new ChatPersistenceService();
    persistence.saveAssistantMessage('m1', USER_ID, SESSION_ID, '¿Quieres que los responda todos? [[QUIZ_DETECTED]]');
    const row = getTestDb().prepare('SELECT content FROM chat_logs WHERE id = ?').get('m1') as { content: string };
    expect(row.content).toBe('¿Quieres que los responda todos?');
    expect(row.content).not.toContain('QUIZ_DETECTED');
  });

  it('strips [[QUIZ_EXPLAIN_DONE]] from persisted assistant content', () => {
    const persistence = new ChatPersistenceService();
    persistence.saveAssistantMessage('m2', USER_ID, SESSION_ID, 'Ya terminamos todos los ejercicios. [[QUIZ_EXPLAIN_DONE]]');
    const row = getTestDb().prepare('SELECT content FROM chat_logs WHERE id = ?').get('m2') as { content: string };
    expect(row.content).toBe('Ya terminamos todos los ejercicios.');
    expect(row.content).not.toContain('QUIZ_EXPLAIN_DONE');
  });

  it('leaves a normal assistant message without a marker unchanged', () => {
    const persistence = new ChatPersistenceService();
    persistence.saveAssistantMessage('m3', USER_ID, SESSION_ID, 'Esta es una respuesta normal.');
    const row = getTestDb().prepare('SELECT content FROM chat_logs WHERE id = ?').get('m3') as { content: string };
    expect(row.content).toBe('Esta es una respuesta normal.');
  });

  it('does not strip markers from user messages', () => {
    const persistence = new ChatPersistenceService();
    persistence.saveUserMessage('m4', USER_ID, SESSION_ID, 'texto con [[QUIZ_DETECTED]] literal');
    const row = getTestDb().prepare('SELECT content FROM chat_logs WHERE id = ?').get('m4') as { content: string };
    expect(row.content).toBe('texto con [[QUIZ_DETECTED]] literal');
  });
});
