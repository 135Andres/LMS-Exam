import { describe, it, expect } from 'vitest';
import {
  SYSTEM_PROMPT_TUTOR,
  SYSTEM_PROMPT_QUIZ_SOLVE,
  SYSTEM_PROMPT_QUIZ_VERIFY,
  SYSTEM_PROMPT_QUIZ_EXPLAIN,
  SYSTEM_PROMPT_COMPACTOR,
  SYSTEM_PROMPT_NARRATIVE_COMPACTOR,
} from './system.js';

describe('prompts de cuestionario', () => {
  it('SYSTEM_PROMPT_TUTOR instruye detectar cuestionario y usar el marcador', () => {
    expect(SYSTEM_PROMPT_TUTOR).toContain('[[QUIZ_DETECTED]]');
    expect(SYSTEM_PROMPT_TUTOR).toContain('¿Quieres que los responda todos o vamos por partes?');
  });

  it('SYSTEM_PROMPT_QUIZ_SOLVE pide JSON con num/pregunta/desarrollo/respuesta', () => {
    expect(SYSTEM_PROMPT_QUIZ_SOLVE).toContain('"num"');
    expect(SYSTEM_PROMPT_QUIZ_SOLVE).toContain('"pregunta"');
    expect(SYSTEM_PROMPT_QUIZ_SOLVE).toContain('"desarrollo"');
    expect(SYSTEM_PROMPT_QUIZ_SOLVE).toContain('"respuesta"');
  });

  it('SYSTEM_PROMPT_QUIZ_VERIFY pide JSON con num/correcto/motivo', () => {
    expect(SYSTEM_PROMPT_QUIZ_VERIFY).toContain('"num"');
    expect(SYSTEM_PROMPT_QUIZ_VERIFY).toContain('"correcto"');
    expect(SYSTEM_PROMPT_QUIZ_VERIFY).toContain('"motivo"');
  });

  it('SYSTEM_PROMPT_QUIZ_EXPLAIN instruye ir paso a paso sin adelantarse y usa el marcador de fin', () => {
    expect(SYSTEM_PROMPT_QUIZ_EXPLAIN).toContain('[[QUIZ_EXPLAIN_DONE]]');
    expect(SYSTEM_PROMPT_QUIZ_EXPLAIN.toLowerCase()).toContain('paso a paso');
  });
});

describe('SYSTEM_PROMPT_COMPACTOR', () => {
  it('no impone un tope de palabras', () => {
    expect(SYSTEM_PROMPT_COMPACTOR).not.toMatch(/máximo.*palabras/i);
    expect(SYSTEM_PROMPT_COMPACTOR).not.toContain('400 palabras');
  });

  it('no usa "relevante" sin definir el criterio', () => {
    expect(SYSTEM_PROMPT_COMPACTOR).not.toMatch(/conversación relevante/i);
  });

  it('exige declarar conteo de mensajes revisados antes de afirmar ausencia de contenido académico', () => {
    expect(SYSTEM_PROMPT_COMPACTOR).toMatch(/cuántos mensajes/i);
  });

  it('pide autoevaluación de confianza junto al resumen', () => {
    expect(SYSTEM_PROMPT_COMPACTOR).toMatch(/confidence/i);
    expect(SYSTEM_PROMPT_COMPACTOR).toMatch(/high\/medium\/low|high.*medium.*low/i);
  });

  it('mantiene el contrato JSON summary + kbCandidates', () => {
    expect(SYSTEM_PROMPT_COMPACTOR).toContain('"summary"');
    expect(SYSTEM_PROMPT_COMPACTOR).toContain('"kbCandidates"');
  });
});

describe('SYSTEM_PROMPT_NARRATIVE_COMPACTOR', () => {
  it('no pide reviewedMessageCount ni kbCandidates (Fase 1, ya no se usan)', () => {
    expect(SYSTEM_PROMPT_NARRATIVE_COMPACTOR).not.toContain('reviewedMessageCount');
    expect(SYSTEM_PROMPT_NARRATIVE_COMPACTOR).not.toContain('kbCandidates');
  });

  it('el contrato JSON de respuesta es solo summary + confidence', () => {
    expect(SYSTEM_PROMPT_NARRATIVE_COMPACTOR).toContain('"summary"');
    expect(SYSTEM_PROMPT_NARRATIVE_COMPACTOR).toMatch(/"confidence"/);
    expect(SYSTEM_PROMPT_NARRATIVE_COMPACTOR).toMatch(/high.*medium.*low/i);
  });

  it('menciona referenciar bloques por id/título en vez de repetir contenido', () => {
    expect(SYSTEM_PROMPT_NARRATIVE_COMPACTOR.toLowerCase()).toContain('bloques');
    expect(SYSTEM_PROMPT_NARRATIVE_COMPACTOR.toLowerCase()).toMatch(/referenc/);
  });
});
