import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { logger } from '../utils/logger.js';

const SUMMARIES_DIR = path.resolve('data/session-summaries');

export interface KnowledgeBlock {
  id: string; // block_<uuid>
  subject: string;
  extractedFromMessages: string[]; // ids de chat_logs
  extractedAt: string;
  extractionModel: string;
  confidence: 'high' | 'medium' | 'low';
  supersedes?: string; // id de bloque anterior, si aplica
  title: string;
  content: string; // casi-verbatim del original
}

interface SessionIndex {
  narrativeCompactions: Array<{ savedAt: string; model: string; confidence: string }>;
  blocks: Array<{ id: string; title: string; subject: string; extractedAt: string }>;
  narrativeFailureCount?: number;
}

function sessionDir(sessionId: string): string {
  return path.join(SUMMARIES_DIR, sessionId);
}
function narrativePath(sessionId: string): string {
  return path.join(sessionDir(sessionId), 'narrative.md');
}
function indexPath(sessionId: string): string {
  return path.join(sessionDir(sessionId), 'index.json');
}
function blocksDir(sessionId: string): string {
  return path.join(sessionDir(sessionId), 'blocks');
}
function legacyPath(sessionId: string): string {
  return path.join(SUMMARIES_DIR, `${sessionId}.md`);
}

function emptyIndex(): SessionIndex {
  return { narrativeCompactions: [], blocks: [] };
}

function readIndex(sessionId: string): SessionIndex {
  try {
    if (!fs.existsSync(indexPath(sessionId))) return emptyIndex();
    return JSON.parse(fs.readFileSync(indexPath(sessionId), 'utf-8'));
  } catch (err) {
    logger.warn('Error leyendo index de sesión', { sessionId, error: (err as Error).message });
    return emptyIndex();
  }
}

function writeIndex(sessionId: string, index: SessionIndex): void {
  fs.writeFileSync(indexPath(sessionId), JSON.stringify(index, null, 2), 'utf-8');
}

// Migración perezosa: si existe el archivo viejo `{sessionId}.md` y todavía no
// se migró a la carpeta nueva, mueve el contenido a narrative.md, crea un
// index.json vacío y borra el archivo viejo. El resumen viejo queda como
// narrativa inicial, sin blocks/ retroactivos (spec sección 8, Fase 2, punto 5).
function migrateLegacyIfNeeded(sessionId: string): void {
  if (fs.existsSync(narrativePath(sessionId))) return;
  const legacy = legacyPath(sessionId);
  if (!fs.existsSync(legacy)) return;

  try {
    const content = fs.readFileSync(legacy, 'utf-8');
    fs.mkdirSync(sessionDir(sessionId), { recursive: true });
    fs.writeFileSync(narrativePath(sessionId), content, 'utf-8');
    writeIndex(sessionId, readIndex(sessionId));
    fs.unlinkSync(legacy);
    logger.info('Resumen de sesión migrado a carpeta por sesión', { sessionId });
  } catch (err) {
    logger.warn('Error migrando resumen de sesión viejo', { sessionId, error: (err as Error).message });
  }
}

// Modelo de dos pistas por sesión: narrative.md (resumen incremental que "va
// creciendo", una pista) + blocks/ (fragmentos casi-verbatim extraídos,
// la otra pista), con index.json como índice de ambas. Mismo patrón de
// storage por-archivo que ProfileService, pero por sesión.
export const SessionSummaryService = {
  getNarrative(sessionId: string): string | null {
    migrateLegacyIfNeeded(sessionId);
    const filePath = narrativePath(sessionId);
    try {
      if (!fs.existsSync(filePath)) return null;
      return fs.readFileSync(filePath, 'utf-8');
    } catch (err) {
      logger.warn('Error leyendo resumen de sesión', { sessionId, error: (err as Error).message });
      return null;
    }
  },

  saveNarrative(sessionId: string, content: string, meta: { model: string; confidence: string }): void {
    if (!fs.existsSync(sessionDir(sessionId))) {
      fs.mkdirSync(sessionDir(sessionId), { recursive: true });
    }
    fs.writeFileSync(narrativePath(sessionId), content, 'utf-8');

    const index = readIndex(sessionId);
    index.narrativeCompactions.push({ savedAt: new Date().toISOString(), model: meta.model, confidence: meta.confidence });
    writeIndex(sessionId, index);

    logger.info('Resumen de sesión actualizado', { sessionId, bytes: Buffer.byteLength(content, 'utf-8') });
  },

  getBlocks(sessionId: string): KnowledgeBlock[] {
    const dir = blocksDir(sessionId);
    if (!fs.existsSync(dir)) return [];
    try {
      const index = readIndex(sessionId);
      return index.blocks
        .map(entry => {
          const filePath = path.join(dir, `${entry.id}.json`);
          if (!fs.existsSync(filePath)) return null;
          return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as KnowledgeBlock;
        })
        .filter((b): b is KnowledgeBlock => b !== null);
    } catch (err) {
      logger.warn('Error leyendo bloques de sesión', { sessionId, error: (err as Error).message });
      return [];
    }
  },

  addBlock(sessionId: string, block: Omit<KnowledgeBlock, 'id'>): KnowledgeBlock {
    const dir = blocksDir(sessionId);
    fs.mkdirSync(dir, { recursive: true });

    const fullBlock: KnowledgeBlock = { id: `block_${randomUUID()}`, ...block };
    fs.writeFileSync(path.join(dir, `${fullBlock.id}.json`), JSON.stringify(fullBlock, null, 2), 'utf-8');

    const index = readIndex(sessionId);
    index.blocks.push({ id: fullBlock.id, title: fullBlock.title, subject: fullBlock.subject, extractedAt: fullBlock.extractedAt });
    writeIndex(sessionId, index);

    logger.info('Bloque de conocimiento agregado', { sessionId, blockId: fullBlock.id, subject: fullBlock.subject });
    return fullBlock;
  },

  getIndex(sessionId: string): SessionIndex {
    return readIndex(sessionId);
  },

  // Contador simple de pasadas de narrativa fallidas consecutivas (truncamiento
  // tras retry, JSON inválido, alucinación de ausencia persistente) — evita
  // reintentar por siempre el mismo rango si la narrativa nunca compacta con
  // éxito; ver compactSession. Sin cola de reintentos con backoff, un contador.
  getNarrativeFailureCount(sessionId: string): number {
    return readIndex(sessionId).narrativeFailureCount ?? 0;
  },

  recordNarrativeFailure(sessionId: string): number {
    const index = readIndex(sessionId);
    index.narrativeFailureCount = (index.narrativeFailureCount ?? 0) + 1;
    if (!fs.existsSync(sessionDir(sessionId))) fs.mkdirSync(sessionDir(sessionId), { recursive: true });
    writeIndex(sessionId, index);
    return index.narrativeFailureCount;
  },

  resetNarrativeFailureCount(sessionId: string): void {
    const index = readIndex(sessionId);
    if (!index.narrativeFailureCount) return;
    index.narrativeFailureCount = 0;
    writeIndex(sessionId, index);
  },

  deleteSummary(sessionId: string): void {
    try {
      const dir = sessionDir(sessionId);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      const legacy = legacyPath(sessionId);
      if (fs.existsSync(legacy)) fs.unlinkSync(legacy);
    } catch (err) {
      logger.warn('Error eliminando resumen de sesión', { sessionId, error: (err as Error).message });
    }
  },
};
