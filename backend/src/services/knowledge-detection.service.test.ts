// backend/src/services/knowledge-detection.service.test.ts
import { describe, it, expect } from 'vitest';
import { detectSubject } from './knowledge-detection.service.js';

describe('detectSubject', () => {
  it('detecta materia con texto acentuado (via stripAccents sobre keywords sin tilde)', () => {
    expect(detectSubject('necesito ayuda con cálculo')).toBe('matematicas');
  });

  it('detecta materia con texto sin tildes', () => {
    expect(detectSubject('explica la fotosintesis en las plantas')).toBe('biologia');
  });

  it('devuelve general si no matchea ninguna keyword', () => {
    expect(detectSubject('hola, ¿cómo estás?')).toBe('general');
  });

  it('no confunde "base de datos" con quimica via keyword ambigua "base"', () => {
    expect(detectSubject('consulta la base de datos')).toBe('informatica');
  });

  it('no confunde "balance general" con biologia via keyword ambigua "gen"', () => {
    expect(detectSubject('el balance general de la empresa')).toBe('contaduria');
  });

  it('no matchea "api" como substring dentro de "terapia" (match de palabra completa)', () => {
    expect(detectSubject('necesito terapia para manejar la ansiedad')).toBe('psicologia');
  });
});
