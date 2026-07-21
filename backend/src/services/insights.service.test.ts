import { describe, it, expect, vi, beforeEach } from 'vitest';

const { generateFromAIMock } = vi.hoisted(() => ({
  generateFromAIMock: vi.fn(),
}));

vi.mock('./ai/index.js', () => ({
  generateFromAI: (...args: unknown[]) => generateFromAIMock(...args),
}));

// insights.service.ts usa getDb() directamente (sin capa de modelo) — se
// mockea con un fake mínimo en vez de la DB real en memoria de test/setup.ts,
// que no tiene la tabla chat_insights (fuera de alcance de este FIX).
const runMock = vi.fn();
const allMock = vi.fn();
const prepareMock = vi.fn((sql: string) => {
  if (/SELECT content, role FROM chat_logs/.test(sql)) {
    return { all: allMock };
  }
  return { run: runMock };
});
vi.mock('../db/connection.js', () => ({
  getDb: () => ({ prepare: prepareMock }),
}));

import { generateDailyInsights } from './insights.service.js';

function aiResponse(content: string) {
  return { content, usage: { promptTokens: 10, completionTokens: 10 } };
}

const MESSAGES = [
  { content: '¿Qué es una derivada?', role: 'user' },
  { content: 'Es la tasa de cambio instantánea de una función.', role: 'assistant' },
  { content: 'Gracias, ahora entiendo.', role: 'user' },
];

describe('generateDailyInsights', () => {
  beforeEach(() => {
    generateFromAIMock.mockReset();
    runMock.mockReset();
    allMock.mockReset().mockReturnValue(MESSAGES);
    prepareMock.mockClear();
  });

  it('repara un backslash de LaTeX suelto (\\sqrt) en la respuesta de la IA, sin tirar SyntaxError (FIX consolidado)', async () => {
    // Un \sqrt sin escapar rompería un JSON.parse ingenuo con "Bad escaped character".
    generateFromAIMock.mockResolvedValueOnce(aiResponse(
      '{"fortalezas": ["resuelve \\sqrt{4} bien"], "debilidades": [], "recomendaciones": "sigue practicando", "calificacion": 80}',
    ));

    await expect(generateDailyInsights('user-1', '2026-01-01')).resolves.not.toThrow();

    expect(runMock).toHaveBeenCalled();
    const savedJson = runMock.mock.calls[0][4] as string;
    expect(JSON.parse(savedJson).fortalezas).toEqual(['resuelve \\sqrt{4} bien']);
  });

  it('con menos de 3 mensajes en el día, no llama a la IA ni escribe insights', async () => {
    allMock.mockReturnValue(MESSAGES.slice(0, 2));

    await generateDailyInsights('user-1', '2026-01-01');

    expect(generateFromAIMock).not.toHaveBeenCalled();
    expect(runMock).not.toHaveBeenCalled();
  });

  it('si la IA falla, no lanza (se loguea como warning y sigue)', async () => {
    generateFromAIMock.mockRejectedValueOnce(new Error('proveedor caído'));

    await expect(generateDailyInsights('user-1', '2026-01-01')).resolves.not.toThrow();
    expect(runMock).not.toHaveBeenCalled();
  });
});
