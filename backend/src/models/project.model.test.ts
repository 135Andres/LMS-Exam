import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../db/connection.js';
import { ProjectModel } from './project.model.js';

const USER = 'project-user';
describe('ProjectModel', () => {
  beforeEach(() => {
    const db = getDb();
    db.exec('DELETE FROM folders; DELETE FROM projects; DELETE FROM chat_sessions; DELETE FROM users;');
    db.prepare("INSERT INTO users (id, email, role) VALUES (?, ?, 'user')").run(USER, 'project@test.local');
  });
  it('activa solo el proyecto recién creado y crea su chat raíz', () => {
    ProjectModel.create({ id: 'p1', userId: USER, name: 'Uno', mainSessionId: '11111111-1111-4111-8111-111111111111' });
    const p2 = ProjectModel.create({ id: 'p2', userId: USER, name: 'Dos', mainSessionId: '22222222-2222-4222-8222-222222222222' });
    expect(ProjectModel.list(USER)[0].id).toBe('p2');
    expect(ProjectModel.sessions(p2.id, null)).toHaveLength(1);
  });
  it('mueve únicamente chats no principales hacia una carpeta de contenido', () => {
    const p = ProjectModel.create({ id: 'p1', userId: USER, name: 'Uno', mainSessionId: '11111111-1111-4111-8111-111111111111' });
    const f = ProjectModel.createFolder({ id: 'f1', projectId: p.id, parentId: null, name: 'Materia', kind: 'normal', isContentFolder: true, resourceScope: 'general' });
    getDb().prepare('INSERT INTO chat_sessions (session_id, user_id, project_id) VALUES (?, ?, ?)').run('33333333-3333-4333-8333-333333333333', USER, p.id);
    expect(ProjectModel.moveSession('33333333-3333-4333-8333-333333333333', p.id, f.id)).toBe(true);
    expect(ProjectModel.moveSession(p.main_session_id!, p.id, f.id)).toBe(false);
  });
});
