import { getDb } from '../db/connection.js';
import type { UserRow } from '../types/db.js';

interface CreateUserParams {
  id: string;
  email: string;
  username?: string | null;
  passwordHash?: string | null;
  role?: string;
}

export interface UserSettingsPatch {
  language?: string;
  theme?: string;
  font?: string;
  reduced_motion?: boolean;
  notify_on_response?: boolean;
  cross_chat_enabled?: boolean;
}

const SETTINGS_COLUMNS = ['language', 'theme', 'font', 'reduced_motion', 'notify_on_response', 'cross_chat_enabled'] as const;

export const UserModel = {
  findByEmail(email: string): UserRow | undefined {
    return getDb().prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined;
  },

  findById(id: string): UserRow | undefined {
    return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  },

  create({ id, email, username = null, passwordHash = null, role = 'user' }: CreateUserParams): UserRow | undefined {
    const stmt = getDb().prepare(
      'INSERT INTO users (id, email, username, password_hash, role) VALUES (?, ?, ?, ?, ?)',
    );
    stmt.run(id, email, username, passwordHash, role);
    return this.findById(id);
  },

  incrementExamsGenerated(id: string, cost: number): void {
    getDb().prepare(
      'UPDATE users SET exams_generated = exams_generated + 1, total_api_cost = total_api_cost + ? WHERE id = ?',
    ).run(cost, id);
  },

  setRole(email: string, role: string): void {
    getDb().prepare('UPDATE users SET role = ? WHERE email = ?').run(role, email);
  },

  setUsername(id: string, username: string): void {
    getDb().prepare('UPDATE users SET username = ? WHERE id = ?').run(username, id);
  },

  getSettings(id: string): Pick<UserRow, typeof SETTINGS_COLUMNS[number] | 'avatar_data'> | undefined {
    return getDb().prepare(
      `SELECT ${SETTINGS_COLUMNS.join(', ')}, avatar_data FROM users WHERE id = ?`
    ).get(id) as Pick<UserRow, typeof SETTINGS_COLUMNS[number] | 'avatar_data'> | undefined;
  },

  // UPDATE dinámico solo de los campos presentes en el patch — whitelist
  // fija de columnas (SETTINGS_COLUMNS), nunca interpola nombres de columna
  // que vengan del cliente.
  updateSettings(id: string, patch: UserSettingsPatch): void {
    const entries = SETTINGS_COLUMNS
      .filter(col => patch[col] !== undefined)
      .map(col => [col, typeof patch[col] === 'boolean' ? (patch[col] ? 1 : 0) : patch[col]] as const);
    if (entries.length === 0) return;

    const setClause = entries.map(([col]) => `${col} = ?`).join(', ');
    const values = entries.map(([, val]) => val);
    getDb().prepare(`UPDATE users SET ${setClause} WHERE id = ?`).run(...values, id);
  },

  setAvatar(id: string, avatarDataUrl: string): void {
    getDb().prepare('UPDATE users SET avatar_data = ? WHERE id = ?').run(avatarDataUrl, id);
  },

  listAll(): UserRow[] {
    return getDb().prepare(
      'SELECT id, email, username, role, created_at, exams_generated, total_api_cost FROM users ORDER BY created_at DESC',
    ).all() as UserRow[];
  },
};
