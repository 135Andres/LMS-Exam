import fs from 'fs';
import path from 'path';
import { logger } from '../../utils/logger.js';

const STATE_DIR = path.resolve('data/quiz-mode');

function statePath(sessionId: string): string {
  return path.join(STATE_DIR, `${sessionId}.json`);
}

// Flag por sesión para el modo "Explicar" de cuestionarios — mismo patrón
// file-based que SessionSummaryService, pero solo un booleano de presencia.
export const ChatQuizModeService = {
  activate(sessionId: string): void {
    if (!fs.existsSync(STATE_DIR)) {
      fs.mkdirSync(STATE_DIR, { recursive: true });
    }
    fs.writeFileSync(statePath(sessionId), JSON.stringify({ active: true }), 'utf-8');
    logger.info('Modo explicar cuestionario activado', { sessionId });
  },

  isActive(sessionId: string): boolean {
    return fs.existsSync(statePath(sessionId));
  },

  deactivate(sessionId: string): void {
    try {
      const filePath = statePath(sessionId);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (err) {
      logger.warn('Error desactivando modo explicar cuestionario', { sessionId, error: (err as Error).message });
    }
  },
};
