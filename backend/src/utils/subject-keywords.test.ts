// backend/src/utils/subject-keywords.test.ts
import { describe, it, expect } from 'vitest';
import { detectSubjectByKeywords } from './subject-keywords.js';

describe('detectSubjectByKeywords', () => {
  it('Diógenes con "siglo" da filosofia, no historia (una keyword weak no le gana a varias core)', () => {
    const result = detectSubjectByKeywords(
      'Diógenes fue un filósofo griego del siglo V, contemporáneo de Aristóteles, y su enfoque de la filosofia cínica.',
    );
    expect(result.subject).toBe('filosofia');
    expect(result.confidence).toBe('high');
  });

  it('"Movimiento Romántico" da artes, no fisica (frase específica le gana a palabra suelta genérica)', () => {
    const result = detectSubjectByKeywords('Quiero entender las características del Movimiento Romántico en la pintura.');
    expect(result.subject).toBe('artes');
    expect(result.confidence).toBe('high');
  });

  it('un solo match weak sin competencia igual devuelve esa materia, pero con confianza baja', () => {
    const result = detectSubjectByKeywords('el clima cambió el movimiento de las corrientes marinas');
    expect(result.subject).toBe('fisica');
    expect(result.confidence).toBe('low');
  });

  it('texto sin ninguna keyword devuelve undefined con confianza baja', () => {
    const result = detectSubjectByKeywords('hola, ¿cómo estás?');
    expect(result.subject).toBeUndefined();
    expect(result.confidence).toBe('low');
  });

  it('varias keywords core de la misma materia dan confianza alta', () => {
    const result = detectSubjectByKeywords('necesito ayuda con la derivada de esta ecuacion');
    expect(result.subject).toBe('matematicas');
    expect(result.confidence).toBe('high');
  });
});
