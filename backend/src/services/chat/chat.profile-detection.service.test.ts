import { describe, it, expect, vi, beforeEach } from 'vitest';

const { generateFromAIMock, appendToProfileMock, invalidateCacheMock } = vi.hoisted(() => ({
  generateFromAIMock: vi.fn(),
  appendToProfileMock: vi.fn(),
  invalidateCacheMock: vi.fn(),
}));

vi.mock('../ai/index.js', () => ({
  generateFromAI: (...args: unknown[]) => generateFromAIMock(...args),
}));

vi.mock('../profile.service.js', () => ({
  ProfileService: {
    appendToProfile: (...args: unknown[]) => appendToProfileMock(...args),
    invalidateCache: (...args: unknown[]) => invalidateCacheMock(...args),
  },
}));

import { ChatProfileDetectionService, isProfileEditIntent } from './chat.profile-detection.service.js';

function aiResponse(content: string) {
  return { content, usage: { promptTokens: 1, completionTokens: 1 } };
}

describe('isProfileEditIntent', () => {
  it('detecta frases de cambio de preferencia', () => {
    expect(isProfileEditIntent('quiero que seas más directo')).toBe(true);
    expect(isProfileEditIntent('sé menos formal conmigo')).toBe(true);
  });

  it('no detecta una pregunta normal', () => {
    expect(isProfileEditIntent('¿qué es una derivada?')).toBe(false);
  });
});

describe('ChatProfileDetectionService.detectAndApply', () => {
  let service: ChatProfileDetectionService;

  beforeEach(() => {
    generateFromAIMock.mockReset();
    appendToProfileMock.mockReset();
    invalidateCacheMock.mockReset();
    service = new ChatProfileDetectionService();
  });

  it('repara un backslash de LaTeX suelto (\\sqrt) en el campo "change", sin tirar SyntaxError (FIX consolidado)', async () => {
    // Un \sqrt sin escapar rompería un JSON.parse ingenuo con "Bad escaped character".
    generateFromAIMock.mockResolvedValueOnce(aiResponse(
      '{"update_profile": true, "change": "Prefiere ver \\sqrt{4} resuelto paso a paso"}',
    ));

    const result = await service.detectAndApply('quiero que expliques con más detalle', 'user-1');

    expect(result).toBe('Prefiere ver \\sqrt{4} resuelto paso a paso');
    expect(appendToProfileMock).toHaveBeenCalledWith('user-1', 'Prefiere ver \\sqrt{4} resuelto paso a paso');
    expect(invalidateCacheMock).toHaveBeenCalledWith('user-1');
  });

  it('mensaje sin intención de cambio de perfil: no llama a la IA', async () => {
    const result = await service.detectAndApply('¿qué es una derivada?', 'user-1');

    expect(result).toBeNull();
    expect(generateFromAIMock).not.toHaveBeenCalled();
  });

  it('la IA descarta la intención (update_profile: false): no actualiza el perfil', async () => {
    generateFromAIMock.mockResolvedValueOnce(aiResponse(JSON.stringify({ update_profile: false })));

    const result = await service.detectAndApply('quiero que me expliques esto', 'user-1');

    expect(result).toBeNull();
    expect(appendToProfileMock).not.toHaveBeenCalled();
  });

  it('si la IA falla, devuelve null en vez de lanzar', async () => {
    generateFromAIMock.mockRejectedValueOnce(new Error('timeout'));

    const result = await service.detectAndApply('quiero que seas más directo', 'user-1');

    expect(result).toBeNull();
  });
});
