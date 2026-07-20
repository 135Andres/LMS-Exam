import { describe, it, expect } from 'vitest';
import { composeSystemPrompt } from './prompt-composer.js';
import { compileProfileLine, type UserProfile } from '../services/user-profile.service.js';

const BASE = 'Eres un tutor. Responde en español.';

function fullProfile(): UserProfile {
  const profile: UserProfile = {
    userId: 'u1',
    displayName: 'Andrés',
    level: 'uni',
    field: 'ing. software',
    subjects: ['cálculo', 'física'],
    goal: 'examenes',
    depth: 'detallado',
    register: 'formal',
    studyMethods: ['práctica'],
    profileLine: null,
    version: 1,
  };
  profile.profileLine = compileProfileLine(profile);
  return profile;
}

describe('composeSystemPrompt', () => {
  describe('mode "none"', () => {
    it('devuelve base tal cual con perfil lleno', () => {
      expect(composeSystemPrompt(BASE, fullProfile(), 'none')).toBe(BASE);
    });

    it('devuelve base tal cual con perfil null', () => {
      expect(composeSystemPrompt(BASE, null, 'none')).toBe(BASE);
    });

    it('no contiene [PERFIL — guardián para salidas JSON (quiz-solve/verify)', () => {
      const composed = composeSystemPrompt(BASE, fullProfile(), 'none');
      expect(composed).not.toContain('[PERFIL');
    });
  });

  describe('mode "full"', () => {
    it('agrega la profile_line completa al final', () => {
      const profile = fullProfile();
      const composed = composeSystemPrompt(BASE, profile, 'full');

      expect(composed.startsWith(BASE)).toBe(true);
      expect(composed).toContain(profile.profileLine as string);
      expect(composed.endsWith(profile.profileLine as string)).toBe(true);
      expect(composed).toContain('materias: cálculo, física');
      expect(composed).toContain('objetivo: pasar exámenes');
    });

    it('perfil null → devuelve base tal cual', () => {
      expect(composeSystemPrompt(BASE, null, 'full')).toBe(BASE);
    });

    it('profile_line vacía → devuelve base tal cual', () => {
      const profile: UserProfile = {
        userId: 'u1', subjects: [], depth: 'auto',
        register: undefined as unknown as UserProfile['register'],
        studyMethods: [], profileLine: '', version: 1,
      };
      expect(composeSystemPrompt(BASE, profile, 'full')).toBe(BASE);
    });
  });

  describe('mode "format-only"', () => {
    it('agrega solo nombre + líneas de FORMATO, sin contexto académico', () => {
      const composed = composeSystemPrompt(BASE, fullProfile(), 'format-only');

      expect(composed.startsWith(BASE)).toBe(true);
      expect(composed).toContain('Andrés');
      expect(composed).toContain('Trato: de usted.');
      expect(composed).toContain('Respuestas: siempre detalladas y completas, sin recortar por brevedad.');
      expect(composed).not.toContain('materias:');
      expect(composed).not.toContain('objetivo:');
      expect(composed).not.toContain('estudia con:');
      expect(composed).not.toContain('uni:');
    });

    it('perfil null → devuelve base tal cual', () => {
      expect(composeSystemPrompt(BASE, null, 'format-only')).toBe(BASE);
    });

    it('sin nombre ni formato explícito (depth auto, sin register) → devuelve base tal cual', () => {
      const profile: UserProfile = {
        userId: 'u1', subjects: [], depth: 'auto',
        register: undefined as unknown as UserProfile['register'],
        studyMethods: [], profileLine: null, version: 1,
      };
      expect(composeSystemPrompt(BASE, profile, 'format-only')).toBe(BASE);
    });
  });

  it('la profile line queda siempre al final (posición), nunca al inicio o en medio', () => {
    const profile = fullProfile();
    const composedFull = composeSystemPrompt(BASE, profile, 'full');
    const composedFormatOnly = composeSystemPrompt(BASE, profile, 'format-only');

    expect(composedFull.indexOf(BASE)).toBe(0);
    expect(composedFormatOnly.indexOf(BASE)).toBe(0);
  });
});
