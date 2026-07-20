import { getDb } from '../db/connection.js';
import { logger } from '../utils/logger.js';
import type { UserProfileRow } from '../types/db.js';

export type ProfileLevel = 'prepa' | 'uni' | 'posgrado' | 'otro';
export type ProfileGoal = 'examenes' | 'entender' | 'tareas' | 'repaso' | 'mixto';
export type ProfileDepth = 'breve' | 'detallado' | 'auto';
export type ProfileRegister = 'tuteo' | 'formal' | 'neutro';

export interface UserProfile {
  userId: string;
  displayName?: string;
  level?: ProfileLevel;
  field?: string;
  subjects: string[];
  goal?: ProfileGoal;
  depth: ProfileDepth;
  register: ProfileRegister;
  studyMethods: string[];
  profileLine: string | null;
  version: number;
}

export type UserProfileInput = Partial<Omit<UserProfile, 'userId' | 'profileLine' | 'version'>>;

const DEPTH_LINES: Record<'detallado' | 'breve', string> = {
  detallado: 'Respuestas: siempre detalladas y completas, sin recortar por brevedad.',
  breve: 'Respuestas: siempre breves y al grano.',
};

const REGISTER_LINES: Record<ProfileRegister, string> = {
  tuteo: 'Trato: de tú.',
  formal: 'Trato: de usted.',
  neutro: 'Trato: impersonal; no te dirijas al usuario directamente, entrega la información sin apelaciones ("se observa que…", no "tú puedes ver que…").',
};

const GOAL_LABELS: Record<ProfileGoal, string> = {
  examenes: 'pasar exámenes',
  entender: 'entender los temas',
  tareas: 'hacer tareas',
  repaso: 'repasar',
  mixto: 'un poco de todo',
};

// Recorta a 60 chars, colapsa whitespace y quita caracteres que podrían
// romper la delimitación del profile_line dentro del system prompt.
export function sanitizeFreeText(input: string): string {
  const collapsed = input
    .replace(/[\r\n]+/g, ' ')
    .replace(/[[\]|`]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
  // Array.from en vez de .slice(): recorta por code point, no por code unit
  // UTF-16 — un emoji u otro carácter fuera del BMP justo en el límite no
  // termina partido en un surrogate huérfano.
  return Array.from(collapsed).slice(0, 60).join('').trim();
}

export function compileProfileLine(profile: UserProfile): string {
  const headerSegs: string[] = [];
  if (profile.displayName) headerSegs.push(profile.displayName);

  if (profile.level && profile.field) headerSegs.push(`${profile.level}: ${profile.field}`);
  else if (profile.level) headerSegs.push(profile.level);
  else if (profile.field) headerSegs.push(profile.field);

  if (profile.subjects.length > 0) headerSegs.push(`materias: ${profile.subjects.join(', ')}`);
  if (profile.goal) headerSegs.push(`objetivo: ${GOAL_LABELS[profile.goal]}`);
  if (profile.studyMethods.length > 0) headerSegs.push(`estudia con: ${profile.studyMethods.join(', ')}`);

  // depth 'auto' delega la decisión a la IA — no se emite línea.
  const formatLines: string[] = [];
  if (profile.depth === 'detallado' || profile.depth === 'breve') {
    formatLines.push(DEPTH_LINES[profile.depth]);
  }
  if (profile.register) formatLines.push(REGISTER_LINES[profile.register]);

  const blocks: string[] = [];
  if (headerSegs.length > 0) {
    blocks.push('[PERFIL DEL ESTUDIANTE]');
    blocks.push(headerSegs.join(' | '));
  }
  if (formatLines.length > 0) {
    blocks.push('[FORMATO ELEGIDO POR EL USUARIO — obligatorio]');
    blocks.push(...formatLines);
  }

  return blocks.join('\n');
}

function toDomain(row: UserProfileRow): UserProfile {
  return {
    userId: row.user_id,
    displayName: row.display_name ?? undefined,
    level: (row.level as ProfileLevel | null) ?? undefined,
    field: row.field ?? undefined,
    subjects: JSON.parse(row.subjects) as string[],
    goal: (row.goal as ProfileGoal | null) ?? undefined,
    depth: row.depth as ProfileDepth,
    register: row.register as ProfileRegister,
    studyMethods: JSON.parse(row.study_methods) as string[],
    profileLine: row.profile_line,
    version: row.version,
  };
}

export const UserProfileService = {
  getProfile(userId: string): UserProfile | null {
    const row = getDb().prepare('SELECT * FROM user_profile WHERE user_id = ?').get(userId) as UserProfileRow | undefined;
    return row ? toDomain(row) : null;
  },

  // Único punto donde se recompila profile_line — el chat solo lee (SELECT por PK).
  saveProfile(userId: string, input: UserProfileInput): UserProfile {
    const existing = this.getProfile(userId);

    const displayName = input.displayName !== undefined ? input.displayName : existing?.displayName;
    const field = input.field !== undefined ? input.field : existing?.field;
    const subjects = (input.subjects ?? existing?.subjects ?? []).map(sanitizeFreeText).filter(Boolean);
    const studyMethods = (input.studyMethods ?? existing?.studyMethods ?? []).map(sanitizeFreeText).filter(Boolean);

    const merged: UserProfile = {
      userId,
      displayName: displayName ? sanitizeFreeText(displayName) : undefined,
      level: input.level !== undefined ? input.level : existing?.level,
      field: field ? sanitizeFreeText(field) : undefined,
      subjects,
      goal: input.goal !== undefined ? input.goal : existing?.goal,
      depth: input.depth ?? existing?.depth ?? 'auto',
      register: input.register ?? existing?.register ?? 'tuteo',
      studyMethods,
      profileLine: null,
      version: (existing?.version ?? 0) + 1,
    };

    merged.profileLine = compileProfileLine(merged) || null;

    getDb().prepare(`
      INSERT INTO user_profile (user_id, display_name, level, field, subjects, goal, depth, register, study_methods, profile_line, version, updated_at)
      VALUES (@user_id, @display_name, @level, @field, @subjects, @goal, @depth, @register, @study_methods, @profile_line, @version, @updated_at)
      ON CONFLICT(user_id) DO UPDATE SET
        display_name = excluded.display_name,
        level = excluded.level,
        field = excluded.field,
        subjects = excluded.subjects,
        goal = excluded.goal,
        depth = excluded.depth,
        register = excluded.register,
        study_methods = excluded.study_methods,
        profile_line = excluded.profile_line,
        version = excluded.version,
        updated_at = excluded.updated_at
    `).run({
      user_id: userId,
      display_name: merged.displayName ?? null,
      level: merged.level ?? null,
      field: merged.field ?? null,
      subjects: JSON.stringify(merged.subjects),
      goal: merged.goal ?? null,
      depth: merged.depth,
      register: merged.register,
      study_methods: JSON.stringify(merged.studyMethods),
      profile_line: merged.profileLine,
      version: merged.version,
      updated_at: Date.now(),
    });

    logger.info('Perfil de usuario guardado', { userId, version: merged.version });

    return merged;
  },
};
