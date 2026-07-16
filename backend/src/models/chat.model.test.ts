import { describe, it, expect, beforeEach } from 'vitest';
import { ChatModel } from './chat.model.js';
import { getTestDb, resetDb } from '../../test/setup.js';

const USER_A = 'user-a';
const USER_B = 'user-b';
const SESSION_A = 'sess-a-uuid';
const SESSION_B = 'sess-b-uuid';

describe('ChatModel', () => {
  beforeEach(() => {
    resetDb();
    const db = getTestDb();
    db.prepare('INSERT INTO users (id, email) VALUES (?, ?)').run(USER_A, 'a@test.com');
    db.prepare('INSERT INTO users (id, email) VALUES (?, ?)').run(USER_B, 'b@test.com');
  });

  it('saveMessage + getSessionMessages', () => {
    ChatModel.saveMessage('m1', USER_A, SESSION_A, 'user', 'Hola');
    ChatModel.saveMessage('m2', USER_A, SESSION_A, 'assistant', '¡Hola!');
    const msgs = ChatModel.getSessionMessages(SESSION_A);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('user');
    expect(msgs[1].role).toBe('assistant');
  });

  it('assertSessionOwnership passes for owner', () => {
    ChatModel.saveMessage('m1', USER_A, SESSION_A, 'user', 'Hola');
    expect(() => ChatModel.assertSessionOwnership(SESSION_A, USER_A)).not.toThrow();
  });

  it('assertSessionOwnership throws for non-owner', () => {
    ChatModel.saveMessage('m1', USER_A, SESSION_A, 'user', 'Hola');
    expect(() => ChatModel.assertSessionOwnership(SESSION_A, USER_B)).toThrow('SESSION_OWNERSHIP_VIOLATION');
  });

  it('assertSessionOwnership does not throw for non-existent session', () => {
    expect(() => ChatModel.assertSessionOwnership('non-existent', USER_A)).not.toThrow();
  });

  it('archiveSession + unarchiveSession', () => {
    ChatModel.saveMessage('m1', USER_A, SESSION_A, 'user', 'Hola');
    ChatModel.archiveSession(SESSION_A, USER_A);
    const db = getTestDb();
    const row = db.prepare('SELECT is_archived FROM chat_sessions WHERE session_id = ?').get(SESSION_A) as { is_archived: number };
    expect(row.is_archived).toBe(1);

    ChatModel.unarchiveSession(SESSION_A, USER_A);
    const row2 = db.prepare('SELECT is_archived FROM chat_sessions WHERE session_id = ?').get(SESSION_A) as { is_archived: number };
    expect(row2.is_archived).toBe(0);
  });

  it('deleteSession removes messages and session', () => {
    ChatModel.saveMessage('m3', USER_B, SESSION_B, 'user', 'test');
    ChatModel.deleteSession(SESSION_B, USER_B);
    const db = getTestDb();
    const session = db.prepare('SELECT 1 FROM chat_sessions WHERE session_id = ?').get(SESSION_B);
    const msgs = db.prepare('SELECT 1 FROM chat_logs WHERE session_id = ?').get(SESSION_B);
    expect(session).toBeUndefined();
    expect(msgs).toBeUndefined();
  });

  it('deleteSession does not affect other users session', () => {
    ChatModel.saveMessage('m1', USER_A, SESSION_A, 'user', 'Hola');
    expect(() => ChatModel.deleteSession(SESSION_A, USER_B)).not.toThrow();
    const db = getTestDb();
    const session = db.prepare('SELECT 1 FROM chat_sessions WHERE session_id = ?').get(SESSION_A);
    expect(session).toBeDefined();
  });

  it('getLastSessionId returns most recent', () => {
    ChatModel.saveMessage('m1', USER_A, SESSION_A, 'user', 'Hola');
    const sid = ChatModel.getLastSessionId(USER_A);
    expect(sid).toBe(SESSION_A);
  });

  it('getMessageById returns message for owner', () => {
    ChatModel.saveMessage('m1', USER_A, SESSION_A, 'user', 'Enunciado del cuestionario');
    const msg = ChatModel.getMessageById('m1', USER_A);
    expect(msg?.content).toBe('Enunciado del cuestionario');
  });

  it('getMessageById returns undefined for non-owner', () => {
    ChatModel.saveMessage('m1', USER_A, SESSION_A, 'user', 'Enunciado del cuestionario');
    const msg = ChatModel.getMessageById('m1', USER_B);
    expect(msg).toBeUndefined();
  });

  it('getMessageById returns undefined for non-existent message', () => {
    const msg = ChatModel.getMessageById('nope', USER_A);
    expect(msg).toBeUndefined();
  });
});
