import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';

const MEMORY_DIR = path.resolve('data/imported-memory');
const MAX_MEMORY_BYTES = 6000;

function memoryPath(userId: string): string {
  return path.join(MEMORY_DIR, `user_${userId}.md`);
}

// Memoria que el estudiante pega desde otro proveedor de IA (ej. export de
// memoria de ChatGPT/Claude) — distinto de ProfileService (que guarda solo
// directrices cortas de tono, con un cap de 1536 bytes que truncaría casi
// todo un export real). Mismo patrón file-based que session-summary.service.ts,
// pero por usuario y con un cap más generoso.
export const ImportedMemoryService = {
  getMemory(userId: string): string | null {
    const filePath = memoryPath(userId);
    try {
      if (!fs.existsSync(filePath)) return null;
      return fs.readFileSync(filePath, 'utf-8');
    } catch (err) {
      logger.warn('Error leyendo memoria importada', { userId, error: (err as Error).message });
      return null;
    }
  },

  saveMemory(userId: string, content: string): void {
    if (!fs.existsSync(MEMORY_DIR)) {
      fs.mkdirSync(MEMORY_DIR, { recursive: true });
    }
    const truncated = Buffer.byteLength(content, 'utf-8') > MAX_MEMORY_BYTES
      ? content.slice(0, MAX_MEMORY_BYTES)
      : content;
    fs.writeFileSync(memoryPath(userId), truncated, 'utf-8');
    logger.info('Memoria importada guardada', { userId, bytes: Buffer.byteLength(truncated, 'utf-8') });
  },
};
