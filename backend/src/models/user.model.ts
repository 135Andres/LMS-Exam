import { getDb } from '../db/connection.js';
import type { UserRow } from '../types/db.js';

interface CreateUserParams {
  id: string;
  email: string;
  username?: string | null;
  passwordHash?: string | null;
  role?: string;
}

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

  listAll(): UserRow[] {
    return getDb().prepare(
      'SELECT id, email, username, role, created_at, exams_generated, total_api_cost FROM users ORDER BY created_at DESC',
    ).all() as UserRow[];
  },
};
