import { getDb } from '../db/connection.js';

export type ResourceScope = 'general' | 'per_chat';
export type FolderKind = 'normal' | 'important';

export interface ProjectRow {
  id: string; user_id: string; name: string; is_active: number; is_archived: number;
  archived_at: string | null; main_session_id: string | null; created_at: string; updated_at: string;
}
export interface FolderRow {
  id: string; project_id: string; parent_id: string | null; name: string; kind: FolderKind;
  is_content_folder: number; resource_scope: ResourceScope | null; created_at: string; updated_at: string;
}

export const ProjectModel = {
  list(userId: string, includeArchived = false): ProjectRow[] {
    return getDb().prepare(`SELECT * FROM projects WHERE user_id = ? ${includeArchived ? '' : 'AND is_archived = 0'} ORDER BY is_active DESC, updated_at DESC`).all(userId) as ProjectRow[];
  },
  find(id: string, userId: string): ProjectRow | undefined {
    return getDb().prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(id, userId) as ProjectRow | undefined;
  },
  create(row: { id: string; userId: string; name: string; mainSessionId: string }): ProjectRow {
    const db = getDb();
    db.transaction(() => {
      db.prepare('UPDATE projects SET is_active = 0 WHERE user_id = ?').run(row.userId);
      db.prepare('INSERT INTO projects (id, user_id, name, is_active, main_session_id) VALUES (?, ?, ?, 1, ?)').run(row.id, row.userId, row.name, row.mainSessionId);
      db.prepare('INSERT INTO chat_sessions (session_id, user_id, project_id, is_main) VALUES (?, ?, ?, 1)').run(row.mainSessionId, row.userId, row.id);
    })();
    return this.find(row.id, row.userId)!;
  },
  activate(id: string, userId: string): ProjectRow | undefined {
    const db = getDb();
    db.transaction(() => { db.prepare('UPDATE projects SET is_active = 0 WHERE user_id = ?').run(userId); db.prepare("UPDATE projects SET is_active = 1, is_archived = 0, archived_at = NULL, updated_at = datetime('now') WHERE id = ? AND user_id = ?").run(id, userId); })();
    return this.find(id, userId);
  },
  archive(id: string, userId: string): void { getDb().prepare("UPDATE projects SET is_active = 0, is_archived = 1, archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND user_id = ?").run(id, userId); },
  rename(id: string, userId: string, name: string): void { getDb().prepare("UPDATE projects SET name = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?").run(name, id, userId); },
  folders(projectId: string): FolderRow[] { return getDb().prepare('SELECT * FROM folders WHERE project_id = ? ORDER BY name COLLATE NOCASE').all(projectId) as FolderRow[]; },
  folder(id: string, projectId: string): FolderRow | undefined { return getDb().prepare('SELECT * FROM folders WHERE id = ? AND project_id = ?').get(id, projectId) as FolderRow | undefined; },
  createFolder(row: { id: string; projectId: string; parentId: string | null; name: string; kind: FolderKind; isContentFolder: boolean; resourceScope: ResourceScope | null }): FolderRow {
    getDb().prepare('INSERT INTO folders (id, project_id, parent_id, name, kind, is_content_folder, resource_scope) VALUES (?, ?, ?, ?, ?, ?, ?)').run(row.id, row.projectId, row.parentId, row.name, row.kind, Number(row.isContentFolder), row.resourceScope);
    return this.folder(row.id, row.projectId)!;
  },
  updateFolder(id: string, projectId: string, patch: { name?: string; parentId?: string | null; isContentFolder?: boolean; resourceScope?: ResourceScope | null }): void {
    const current = this.folder(id, projectId); if (!current) return;
    getDb().prepare("UPDATE folders SET name = ?, parent_id = ?, is_content_folder = ?, resource_scope = ?, updated_at = datetime('now') WHERE id = ? AND project_id = ?").run(patch.name ?? current.name, patch.parentId === undefined ? current.parent_id : patch.parentId, patch.isContentFolder === undefined ? current.is_content_folder : Number(patch.isContentFolder), patch.resourceScope === undefined ? current.resource_scope : patch.resourceScope, id, projectId);
  },
  deleteFolder(id: string, projectId: string): void { getDb().prepare('DELETE FROM folders WHERE id = ? AND project_id = ?').run(id, projectId); },
  sessions(projectId: string, folderId: string | null): unknown[] { return getDb().prepare(`SELECT session_id, title, created_at, is_main FROM chat_sessions WHERE project_id = ? AND ${folderId === null ? 'is_main = 1' : 'folder_id = ?'} AND is_archived = 0 ORDER BY created_at DESC`).all(...(folderId === null ? [projectId] : [projectId, folderId])); },
  moveSession(sessionId: string, projectId: string, folderId: string): boolean { return getDb().prepare('UPDATE chat_sessions SET folder_id = ?, project_id = ? WHERE session_id = ? AND project_id = ? AND is_main = 0').run(folderId, projectId, sessionId, projectId).changes > 0; },
};
