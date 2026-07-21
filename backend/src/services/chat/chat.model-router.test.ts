import { describe, it, expect } from 'vitest';
import { ChatModelRouter } from './chat.model-router.js';

describe('ChatModelRouter.resolve', () => {
  it('resuelve el modelo explícito pedido', () => {
    const router = new ChatModelRouter();
    const resolved = router.resolve('nvidia/z-ai/glm-5.2');
    expect(resolved.model).toBe('nvidia/z-ai/glm-5.2');
    expect(resolved.multimodal).toBe(false);
  });

  it('sin modelId, cae al modelo default de config', () => {
    const router = new ChatModelRouter();
    const resolved = router.resolve(undefined);
    expect(resolved.model).toBeTruthy();
  });
});

describe('ChatModelRouter.validateMultimodal — nunca exponer un modelo no elegido explícitamente (FIX 3 consolidado)', () => {
  const router = new ChatModelRouter();
  const nonMultimodal = { model: 'nvidia/z-ai/glm-5.2', label: 'glm-5.2', multimodal: false };

  it('con isExplicitModel=true, el error nombra el modelo con su label bonito (GLM 5.2, no glm-5.2)', () => {
    expect(() => router.validateMultimodal(nonMultimodal, [{ type: 'image' }], true))
      .toThrowError(/GLM 5\.2/);
  });

  it('con isExplicitModel=false (posible delegación automática), el error dice "Inkling", nunca el modelo real', () => {
    let thrown: Error | undefined;
    try {
      router.validateMultimodal(nonMultimodal, [{ type: 'file' }], false);
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown?.message).toContain('Inkling');
    expect(thrown?.message).not.toContain('glm-5.2');
    expect(thrown?.message).not.toContain('GLM 5.2');
  });

  it('modelo multimodal: no lanza sin importar isExplicitModel', () => {
    const multimodal = { model: 'nvidia/thinkingmachines/inkling', label: 'Inkling', multimodal: true };
    expect(() => router.validateMultimodal(multimodal, [{ type: 'image' }], false)).not.toThrow();
    expect(() => router.validateMultimodal(multimodal, [{ type: 'image' }], true)).not.toThrow();
  });

  it('sin adjuntos, no lanza sin importar el modelo', () => {
    expect(() => router.validateMultimodal(nonMultimodal, undefined, false)).not.toThrow();
    expect(() => router.validateMultimodal(nonMultimodal, [], true)).not.toThrow();
  });
});
