import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';

const PROFILES_DIR = path.resolve('data/profiles');
const MAX_PROFILE_BYTES = 1536;

const cache = new Map<string, { content: string }>();

function profilePath(userId: string): string {
  return path.join(PROFILES_DIR, `user_${userId}.md`);
}

function semanticTruncate(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf-8') <= maxBytes) return text;

  let truncated = text.slice(0, maxBytes);

  // Buscar último corte en un punto semántico: '.\n- ' o '. ' o '\n- '
  const lastBullet = truncated.lastIndexOf('\n- ');
  const lastSentence = truncated.lastIndexOf('. ');
  const lastNewline = truncated.lastIndexOf('\n');

  // Elegir el mejor punto de corte: bullet > sentence > newline > raw byte
  const cutAt = Math.max(lastBullet >= 0 ? lastBullet + 1 : -1,
                         lastSentence >= 0 ? lastSentence + 1 : -1,
                         lastNewline >= 0 ? lastNewline : -1);

  if (cutAt > 0) {
    truncated = text.slice(0, cutAt + 1);
    // Si después del corte aún excede, fallback a raw byte
    while (Buffer.byteLength(truncated, 'utf-8') > maxBytes) {
      truncated = truncated.slice(0, -100);
    }
  }

  return truncated.trimEnd() + '\n';
}

export const ProfileService = {
  getProfile(userId: string): string | null {
    const cached = cache.get(userId);
    if (cached) return cached.content;

    const filePath = profilePath(userId);
    try {
      if (!fs.existsSync(filePath)) return null;
      const content = fs.readFileSync(filePath, 'utf-8');
      cache.set(userId, { content });
      return content;
    } catch (err) {
      logger.warn('Error leyendo perfil', { userId, error: (err as Error).message });
      return null;
    }
  },

  saveProfile(userId: string, content: string): void {
    const truncated = semanticTruncate(content, MAX_PROFILE_BYTES);

    const filePath = profilePath(userId);
    if (!fs.existsSync(PROFILES_DIR)) {
      fs.mkdirSync(PROFILES_DIR, { recursive: true });
    }
    fs.writeFileSync(filePath, truncated, 'utf-8');

    // Actualizar caché
    cache.set(userId, { content: truncated });
    logger.info('Perfil guardado', { userId, bytes: Buffer.byteLength(truncated, 'utf-8') });
  },

  appendToProfile(userId: string, change: string): void {
    const current = this.getProfile(userId) || '# Perfil de Estudiante\n';
    const timestamp = new Date().toISOString().slice(0, 10);
    const updated = `${current.trimEnd()}\n- [${timestamp}] ${change.trim()}\n`;
    this.saveProfile(userId, updated);
  },

  resetProfile(userId: string): void {
    const filePath = profilePath(userId);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (err) {
      logger.warn('Error eliminando perfil', { userId, error: (err as Error).message });
    }
    cache.delete(userId);
  },

  invalidateCache(userId: string): void {
    cache.delete(userId);
  },
};
