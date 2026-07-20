import { describe, it, expect } from 'vitest';
import { getStepPayload, matchChipAnswer, matchChipExact, ONBOARDING_TOTAL_STEPS } from './onboarding.steps.js';

describe('getStepPayload', () => {
  it('paso 1 prellena con el nombre sugerido cuando hay uno', () => {
    const step = getStepPayload(1, { suggestedDisplayName: 'andres99' });
    expect(step.step).toBe(1);
    expect(step.total).toBe(ONBOARDING_TOTAL_STEPS);
    expect(step.inputs[0].options).toEqual([{ value: 'andres99', label: 'Así está bien' }]);
  });

  it('paso 1 sin nombre sugerido no ofrece chip', () => {
    const step = getStepPayload(1, {});
    expect(step.inputs[0].options).toEqual([]);
  });

  it('paso 3 genera 19 materias + "Otra…" desde subject-keywords', () => {
    const step = getStepPayload(3);
    const options = step.inputs[0].options!;
    expect(options).toHaveLength(20);
    expect(options[options.length - 1]).toEqual({ value: 'otra', label: 'Otra…' });
    expect(options.map(o => o.value)).toContain('matematicas');
  });

  it('paso 5 trae depth y register con las opciones del plan', () => {
    const step = getStepPayload(5);
    expect(step.inputs.map(i => i.id)).toEqual(['depth', 'register']);
    expect(step.inputs[0].options!.map(o => o.value)).toEqual(['breve', 'detallado', 'auto']);
    expect(step.inputs[1].options!.map(o => o.value)).toEqual(['tuteo', 'formal', 'neutro']);
  });

  it('agrega la nota cuando se pasa', () => {
    const step = getStepPayload(2, {}, 'Elige una opción.');
    expect(step.note).toBe('Elige una opción.');
  });

  it('sin nota, el campo note no aparece', () => {
    const step = getStepPayload(2);
    expect(step.note).toBeUndefined();
  });

  it('clampa pasos fuera de rango', () => {
    expect(getStepPayload(0).step).toBe(1);
    expect(getStepPayload(99).step).toBe(5);
  });
});

describe('matchChipAnswer', () => {
  const options = [
    { value: 'breve', label: 'Directas y breves' },
    { value: 'detallado', label: 'Detalladas siempre' },
    { value: 'auto', label: 'Según el tema' },
  ];

  it('matchea por value exacto', () => {
    expect(matchChipAnswer('breve', options)).toBe('breve');
  });

  it('matchea por label exacto, case-insensitive y sin acentos', () => {
    expect(matchChipAnswer('SEGUN EL TEMA', options)).toBe('auto');
  });

  it('matchea por contains parcial', () => {
    expect(matchChipAnswer('prefiero algo detallado por favor', options)).toBe('detallado');
  });

  it('sin match devuelve null', () => {
    expect(matchChipAnswer('no sé qué quiero', options)).toBeNull();
  });

  it('string vacío devuelve null', () => {
    expect(matchChipAnswer('   ', options)).toBeNull();
  });
});

describe('matchChipExact', () => {
  const options = [{ value: 'andres99', label: 'Así está bien' }];

  it('matchea valor exacto (normalizado)', () => {
    expect(matchChipExact('Andres99', options)).toBe('andres99');
  });

  it('matchea label exacto', () => {
    expect(matchChipExact('así está bien', options)).toBe('andres99');
  });

  it('NO matchea por contains — un nombre real que contiene la sugerencia no se confunde con ella', () => {
    expect(matchChipExact('Andrés', options)).toBeNull();
  });
});
