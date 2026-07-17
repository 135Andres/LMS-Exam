// backend/src/services/chat/chat.quiz.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const generateFromAIMock = vi.fn();
vi.mock('../ai/index.js', () => ({
  generateFromAI: (...args: unknown[]) => generateFromAIMock(...args),
}));

import { resolveQuiz } from './chat.quiz.service.js';

function aiResponse(content: string) {
  return { content, usage: { promptTokens: 10, completionTokens: 10 } };
}

const SOLVED_OK = JSON.stringify([
  { num: 1, pregunta: '¿Cuánto es 2+2?', desarrollo: '2+2 = 4', respuesta: '4' },
]);
const VERIFY_OK = JSON.stringify([{ num: 1, correcto: true, motivo: 'Suma correcta' }]);
const VERIFY_FAIL = JSON.stringify([{ num: 1, correcto: false, motivo: 'Error de suma' }]);

describe('resolveQuiz', () => {
  beforeEach(() => {
    generateFromAIMock.mockReset();
  });

  it('resuelve y verifica dos veces exitosamente, arma el mensaje final', async () => {
    generateFromAIMock
      .mockResolvedValueOnce(aiResponse(SOLVED_OK)) // solve
      .mockResolvedValueOnce(aiResponse(VERIFY_OK)) // verify 1
      .mockResolvedValueOnce(aiResponse(VERIFY_OK)); // verify 2

    const result = await resolveQuiz('¿Cuánto es 2+2?');

    expect(generateFromAIMock).toHaveBeenCalledTimes(3);
    expect(result).toContain('¿Cuánto es 2+2?');
    expect(result).toContain('2+2 = 4');
    expect(result).toContain('4');
    expect(result).not.toContain('No pude verificar');
  });

  it('reintenta resolver si la primera verificación falla, hasta un máximo de 3 intentos de resolución', async () => {
    generateFromAIMock
      .mockResolvedValueOnce(aiResponse(SOLVED_OK)) // solve intento 1
      .mockResolvedValueOnce(aiResponse(VERIFY_FAIL)) // verify falla
      .mockResolvedValueOnce(aiResponse(SOLVED_OK)) // solve intento 2
      .mockResolvedValueOnce(aiResponse(VERIFY_OK)) // verify 1 ok
      .mockResolvedValueOnce(aiResponse(VERIFY_OK)); // verify 2 ok

    const result = await resolveQuiz('¿Cuánto es 2+2?');

    expect(generateFromAIMock).toHaveBeenCalledTimes(5);
    expect(result).not.toContain('No pude verificar');
  });

  it('tras 3 intentos de resolución sin verificar, manda la última versión con nota de advertencia', async () => {
    generateFromAIMock
      .mockResolvedValueOnce(aiResponse(SOLVED_OK)) // solve intento 1
      .mockResolvedValueOnce(aiResponse(VERIFY_FAIL))
      .mockResolvedValueOnce(aiResponse(SOLVED_OK)) // solve intento 2
      .mockResolvedValueOnce(aiResponse(VERIFY_FAIL))
      .mockResolvedValueOnce(aiResponse(SOLVED_OK)) // solve intento 3
      .mockResolvedValueOnce(aiResponse(VERIFY_FAIL));

    const result = await resolveQuiz('¿Cuánto es 2+2?');

    expect(generateFromAIMock).toHaveBeenCalledTimes(6);
    expect(result).toContain('No pude verificar');
  });
});
