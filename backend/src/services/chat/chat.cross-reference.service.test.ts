import { describe, it, expect, vi, beforeEach } from 'vitest';

const { generateFromAIMock, getUserSessionsMock, getNarrativeMock, compactSessionMock } = vi.hoisted(() => ({
  generateFromAIMock: vi.fn(),
  getUserSessionsMock: vi.fn(),
  getNarrativeMock: vi.fn(),
  compactSessionMock: vi.fn(),
}));

vi.mock('../ai/index.js', () => ({
  generateFromAI: (...args: unknown[]) => generateFromAIMock(...args),
}));

vi.mock('../../models/chat.model.js', () => ({
  ChatModel: { getUserSessions: (...args: unknown[]) => getUserSessionsMock(...args) },
}));

vi.mock('../session-summary.service.js', () => ({
  SessionSummaryService: { getNarrative: (...args: unknown[]) => getNarrativeMock(...args) },
}));

vi.mock('./chat.compaction.service.js', () => ({
  compactSession: (...args: unknown[]) => compactSessionMock(...args),
}));

import { buildCrossChatContext, mightReferenceOtherChat } from './chat.cross-reference.service.js';

function aiResponse(content: string) {
  return { content, usage: { promptTokens: 1, completionTokens: 1 } };
}

const CANDIDATES = [
  { session_id: 's1', created_at: 'x', updated_at: 'x', message_count: 3, preview: 'sobre derivadas', title: 'Derivadas' },
  { session_id: 's2', created_at: 'x', updated_at: 'x', message_count: 2, preview: 'sobre integrales', title: null },
];

describe('mightReferenceOtherChat', () => {
  it('detecta frases que sugieren referenciar otro chat', () => {
    expect(mightReferenceOtherChat('añade el de matemáticas')).toBe(true);
    expect(mightReferenceOtherChat('revisa mi otro chat sobre física')).toBe(true);
  });

  it('no detecta un mensaje normal', () => {
    expect(mightReferenceOtherChat('¿qué es una derivada?')).toBe(false);
  });
});

describe('buildCrossChatContext', () => {
  beforeEach(() => {
    generateFromAIMock.mockReset();
    getUserSessionsMock.mockReset().mockReturnValue(CANDIDATES);
    getNarrativeMock.mockReset().mockReturnValue('Resumen narrativo de la sesión.');
    compactSessionMock.mockReset();
  });

  it('repara un backslash de LaTeX suelto (\\sqrt) en la respuesta de match, sin tirar SyntaxError (FIX consolidado)', async () => {
    // Un \sqrt sin escapar rompería un JSON.parse ingenuo con "Bad escaped character".
    generateFromAIMock.mockResolvedValueOnce(aiResponse(
      '{"sessionIds": ["s1"], "note": "coincide por \\sqrt{4}"}',
    ));

    const context = await buildCrossChatContext('añade el de matemáticas', 'user-1', 'current-session');

    expect(context).toContain('Derivadas');
    expect(context).toContain('Resumen narrativo de la sesión.');
  });

  it('sin sesiones candidatas, devuelve string vacío sin llamar a la IA', async () => {
    getUserSessionsMock.mockReturnValue([]);

    const context = await buildCrossChatContext('añade el de matemáticas', 'user-1', 'current-session');

    expect(context).toBe('');
    expect(generateFromAIMock).not.toHaveBeenCalled();
  });

  it('ignora sessionIds devueltos que no están entre los candidatos', async () => {
    generateFromAIMock.mockResolvedValueOnce(aiResponse(JSON.stringify({ sessionIds: ['s-inventado'] })));

    const context = await buildCrossChatContext('añade el de matemáticas', 'user-1', 'current-session');

    expect(context).toBe('');
  });

  it('si la IA falla, devuelve string vacío en vez de lanzar', async () => {
    generateFromAIMock.mockRejectedValueOnce(new Error('timeout'));

    const context = await buildCrossChatContext('añade el de matemáticas', 'user-1', 'current-session');

    expect(context).toBe('');
  });
});
