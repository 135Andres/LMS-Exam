import { describe, it, expect } from 'vitest';
import { looksLikeQuizBlock } from './quiz-block-detector.js';

describe('looksLikeQuizBlock', () => {
  it('returns true for 3+ numbered items', () => {
    const msg = `1. ¿Cuánto es 2+2?
2. ¿Capital de Francia?
3. Resuelve la integral de x^2 dx.`;
    expect(looksLikeQuizBlock(msg)).toBe(true);
  });

  it('returns true for 3+ bullet items', () => {
    const msg = `- Ejercicio 1: derivada de sin(x)
- Ejercicio 2: límite cuando x→0
- Ejercicio 3: área bajo la curva`;
    expect(looksLikeQuizBlock(msg)).toBe(true);
  });

  it('returns true for message with 3+ question marks spread across text', () => {
    const msg = '¿Cuánto es 2+2? ¿Y 3+3? ¿Y la raíz de 16?';
    expect(looksLikeQuizBlock(msg)).toBe(true);
  });

  it('returns false for a single question with lettered sub-items (a, b, c of same stem)', () => {
    const msg = `Resuelve la siguiente ecuación cuadrática:
a) Encuentra las raíces
b) Grafica la parábola
c) Determina el vértice`;
    expect(looksLikeQuizBlock(msg)).toBe(false);
  });

  it('returns false for a normal conversational message', () => {
    expect(looksLikeQuizBlock('Hola, me puedes ayudar con derivadas?')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(looksLikeQuizBlock('')).toBe(false);
  });

  it('returns false for message with only 2 numbered items', () => {
    const msg = `1. Primera pregunta
2. Segunda pregunta`;
    expect(looksLikeQuizBlock(msg)).toBe(false);
  });
});