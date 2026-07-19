import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { SessionSummaryService } from './session-summary.service.js';

const SUMMARIES_DIR = path.resolve('data/session-summaries');
const SESSION_ID = 'session-summary-test-session';

function sessionDir(id: string): string {
  return path.join(SUMMARIES_DIR, id);
}
function legacyPath(id: string): string {
  return path.join(SUMMARIES_DIR, `${id}.md`);
}

describe('SessionSummaryService', () => {
  afterEach(() => {
    SessionSummaryService.deleteSummary(SESSION_ID);
    const legacy = legacyPath(SESSION_ID);
    if (fs.existsSync(legacy)) fs.unlinkSync(legacy);
  });

  it('getNarrative devuelve null si no existe nada', () => {
    expect(SessionSummaryService.getNarrative(SESSION_ID)).toBeNull();
  });

  it('getNarrative migra automáticamente el archivo .md viejo y lo borra', () => {
    if (!fs.existsSync(SUMMARIES_DIR)) fs.mkdirSync(SUMMARIES_DIR, { recursive: true });
    fs.writeFileSync(legacyPath(SESSION_ID), 'resumen viejo', 'utf-8');

    const narrative = SessionSummaryService.getNarrative(SESSION_ID);

    expect(narrative).toBe('resumen viejo');
    expect(fs.existsSync(legacyPath(SESSION_ID))).toBe(false);
    expect(fs.existsSync(path.join(sessionDir(SESSION_ID), 'narrative.md'))).toBe(true);
    const index = JSON.parse(fs.readFileSync(path.join(sessionDir(SESSION_ID), 'index.json'), 'utf-8'));
    expect(index.blocks).toEqual([]);
  });

  it('getNarrative al migrar preserva blocks preexistentes en index.json (no lo pisa con uno vacío)', () => {
    const block = SessionSummaryService.addBlock(SESSION_ID, {
      subject: 'matematicas',
      extractedFromMessages: ['msg-1'],
      extractedAt: new Date().toISOString(),
      extractionModel: 'test-model',
      confidence: 'high',
      title: 'Bloque preexistente',
      content: 'contenido verbatim',
    });
    fs.writeFileSync(legacyPath(SESSION_ID), 'resumen viejo', 'utf-8');

    const narrative = SessionSummaryService.getNarrative(SESSION_ID);

    expect(narrative).toBe('resumen viejo');
    expect(fs.existsSync(legacyPath(SESSION_ID))).toBe(false);
    expect(fs.existsSync(path.join(sessionDir(SESSION_ID), 'narrative.md'))).toBe(true);

    const blocks = SessionSummaryService.getBlocks(SESSION_ID);
    expect(blocks.map(b => b.id)).toContain(block.id);
  });

  it('saveNarrative + getNarrative', () => {
    SessionSummaryService.saveNarrative(SESSION_ID, 'contenido nuevo', { model: 'test-model', confidence: 'high' });
    expect(SessionSummaryService.getNarrative(SESSION_ID)).toBe('contenido nuevo');
  });

  it('saveNarrative no toca blocks/', () => {
    SessionSummaryService.saveNarrative(SESSION_ID, 'contenido', { model: 'test-model', confidence: 'high' });
    expect(SessionSummaryService.getBlocks(SESSION_ID)).toEqual([]);
  });

  it('getBlocks devuelve lista vacía si no hay carpeta', () => {
    expect(SessionSummaryService.getBlocks(SESSION_ID)).toEqual([]);
  });

  it('addBlock crea archivo + entrada en index.json con id incremental', () => {
    const block1 = SessionSummaryService.addBlock(SESSION_ID, {
      subject: 'matematicas',
      extractedFromMessages: ['msg-1'],
      extractedAt: new Date().toISOString(),
      extractionModel: 'test-model',
      confidence: 'high',
      title: 'Bloque 1',
      content: 'contenido verbatim 1',
    });
    const block2 = SessionSummaryService.addBlock(SESSION_ID, {
      subject: 'matematicas',
      extractedFromMessages: ['msg-2'],
      extractedAt: new Date().toISOString(),
      extractionModel: 'test-model',
      confidence: 'medium',
      title: 'Bloque 2',
      content: 'contenido verbatim 2',
    });

    expect(block1.id).toMatch(/^block_/);
    expect(block2.id).toMatch(/^block_/);
    expect(block1.id).not.toBe(block2.id);

    const blocks = SessionSummaryService.getBlocks(SESSION_ID);
    expect(blocks).toHaveLength(2);
    expect(blocks.map(b => b.title)).toEqual(['Bloque 1', 'Bloque 2']);

    const index = SessionSummaryService.getIndex(SESSION_ID);
    expect(index.blocks).toHaveLength(2);

    const blockFile = path.join(sessionDir(SESSION_ID), 'blocks', `${block1.id}.json`);
    expect(fs.existsSync(blockFile)).toBe(true);
  });

  it('getNarrativeFailureCount devuelve 0 si no hay index aún', () => {
    expect(SessionSummaryService.getNarrativeFailureCount(SESSION_ID)).toBe(0);
  });

  it('recordNarrativeFailure incrementa el contador y lo persiste en index.json', () => {
    expect(SessionSummaryService.recordNarrativeFailure(SESSION_ID)).toBe(1);
    expect(SessionSummaryService.recordNarrativeFailure(SESSION_ID)).toBe(2);
    expect(SessionSummaryService.getNarrativeFailureCount(SESSION_ID)).toBe(2);

    const index = SessionSummaryService.getIndex(SESSION_ID);
    expect(index.narrativeFailureCount).toBe(2);
  });

  it('resetNarrativeFailureCount vuelve el contador a 0', () => {
    SessionSummaryService.recordNarrativeFailure(SESSION_ID);
    SessionSummaryService.recordNarrativeFailure(SESSION_ID);

    SessionSummaryService.resetNarrativeFailureCount(SESSION_ID);

    expect(SessionSummaryService.getNarrativeFailureCount(SESSION_ID)).toBe(0);
  });

  it('deleteSummary borra la carpeta completa incluyendo blocks/', () => {
    SessionSummaryService.saveNarrative(SESSION_ID, 'contenido', { model: 'test-model', confidence: 'high' });
    SessionSummaryService.addBlock(SESSION_ID, {
      subject: 'matematicas',
      extractedFromMessages: ['msg-1'],
      extractedAt: new Date().toISOString(),
      extractionModel: 'test-model',
      confidence: 'high',
      title: 'Bloque 1',
      content: 'contenido verbatim',
    });

    SessionSummaryService.deleteSummary(SESSION_ID);

    expect(fs.existsSync(sessionDir(SESSION_ID))).toBe(false);
    expect(SessionSummaryService.getNarrative(SESSION_ID)).toBeNull();
    expect(SessionSummaryService.getBlocks(SESSION_ID)).toEqual([]);
  });
});
