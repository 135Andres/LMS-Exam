import { describe, it, expect } from 'vitest';
import { AVAILABLE_MODELS, getModelProvider, INKLING_MODEL_ID } from './models.js';

describe('AVAILABLE_MODELS', () => {
  it('every model has a non-empty provider', () => {
    for (const m of AVAILABLE_MODELS) {
      expect(m.provider, `Model ${m.id} has empty provider`).toBeTruthy();
      expect(typeof m.provider).toBe('string');
    }
  });

  it('getModelProvider returns correct value for representative models', () => {
    expect(getModelProvider(INKLING_MODEL_ID)).toBe('Nvidia');
    expect(getModelProvider('ag/gemini-3-flash')).toBe('Google');
    expect(getModelProvider('ag/claude-sonnet-4-6')).toBe('Anthropic');
    expect(getModelProvider('oc/deepseek-v4-flash-free')).toBe('Nvidia');
    expect(getModelProvider('nvidia/z-ai/glm-5.2')).toBe('Nvidia');
    expect(getModelProvider('ag/gemini-3.1-pro-low')).toBe('Google');
  });

  it('getModelProvider returns "Desconocido" for unknown model', () => {
    expect(getModelProvider('unknown/model-id')).toBe('Desconocido');
  });
});