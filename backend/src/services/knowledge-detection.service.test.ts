// backend/src/services/knowledge-detection.service.test.ts
import { describe, it, expect } from 'vitest';
import { detectSubject } from './knowledge-detection.service.js';

describe('detectSubject', () => {
  it('detecta materia con texto acentuado (via stripAccents sobre keywords sin tilde)', () => {
    expect(detectSubject('¿Cómo se resuelve una derivada en cálculo?')).toBe('matematicas');
  });

  it('detecta materia con texto sin tildes', () => {
    expect(detectSubject('explica la fotosintesis en las plantas')).toBe('biologia');
  });

  it('devuelve general si no matchea ninguna keyword', () => {
    expect(detectSubject('hola, ¿cómo estás?')).toBe('general');
  });
});
