import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';

const SUMMARIES_DIR = path.resolve('data/session-summaries');

function summaryPath(sessionId: string): string {
  return path.join(SUMMARIES_DIR, `${sessionId}.md`);
}

// Resumen incremental por sesión — el archivo que "va creciendo" a medida que
// se compacta la conversación. Mismo patrón de storage que ProfileService,
// pero por sesión en vez de por usuario (el perfil de tono es aparte).
export const SessionSummaryService = {
  getSummary(sessionId: string): string | null {
    const filePath = summaryPath(sessionId);
    try {
      if (!fs.existsSync(filePath)) return null;
      return fs.readFileSync(filePath, 'utf-8');
    } catch (err) {
      logger.warn('Error leyendo resumen de sesión', { sessionId, error: (err as Error).message });
      return null;
    }
  },

  saveSummary(sessionId: string, content: string): void {
    if (!fs.existsSync(SUMMARIES_DIR)) {
      fs.mkdirSync(SUMMARIES_DIR, { recursive: true });
    }
    fs.writeFileSync(summaryPath(sessionId), content, 'utf-8');
    logger.info('Resumen de sesión actualizado', { sessionId, bytes: Buffer.byteLength(content, 'utf-8') });
  },

  deleteSummary(sessionId: string): void {
    try {
      const filePath = summaryPath(sessionId);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (err) {
      logger.warn('Error eliminando resumen de sesión', { sessionId, error: (err as Error).message });
    }
  },
};
