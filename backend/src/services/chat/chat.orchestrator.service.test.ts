// backend/src/services/chat/chat.orchestrator.service.test.ts
import { describe, it, expect } from 'vitest';
import { ChatOrchestratorService, buildEffortInstruction } from './chat.orchestrator.service.js';
import { INKLING_MODEL_ID } from '../../config/models.js';

describe('ChatOrchestratorService', () => {
  const orchestrator = new ChatOrchestratorService();

  it('manda directo a Inkling si hay adjunto de imagen o audio, sin clasificar', () => {
    const decision = orchestrator.decide('hola', 0, [{ type: 'image', mime: 'image/png', data: 'x' }]);
    expect(decision.model).toBe(INKLING_MODEL_ID);
    expect(decision.effort).toBe(0.6);
  });

  it('default: Inkling con effort acorde a la complejidad', () => {
    const decision = orchestrator.decide('¿Qué es una célula?', 0);
    expect(decision.model).toBe(INKLING_MODEL_ID);
    expect(decision.effort).toBe(0.3);
  });

  it('delega a GLM si detecta código', () => {
    const decision = orchestrator.decide('```js\nconst x = 1;\n```', 0);
    expect(decision.model).toBe('nvidia/z-ai/glm-5.2');
    expect(decision.effort).toBeUndefined();
  });

  it('delega a Sonnet si es alta complejidad sin contexto RAG largo', () => {
    const decision = orchestrator.decide('Redacta un ensayo argumentando sobre el existencialismo', 100);
    expect(decision.model).toBe('ag/claude-sonnet-4-6');
  });

  it('delega a Gemini Pro si es alta complejidad con contexto RAG largo', () => {
    const decision = orchestrator.decide('Redacta un ensayo argumentando sobre el existencialismo', 5000);
    expect(decision.model).toBe('ag/gemini-3.1-pro-low');
  });

  // Plan 07 — boostSubjects llega hasta la clasificación final.
  it('boostSubjects se propaga hasta classification.subject', () => {
    const text = 'necesito entender la velocidad y el elemento';
    expect(orchestrator.decide(text, 0).classification.subject).toBe('fisica');
    expect(orchestrator.decide(text, 0, undefined, ['quimica']).classification.subject).toBe('quimica');
  });
});

describe('buildEffortInstruction', () => {
  it('etiqueta el nivel correcto según el effort numérico', () => {
    expect(buildEffortInstruction(0.3)).toContain('mínimo');
    expect(buildEffortInstruction(0.6)).toContain('moderado');
    expect(buildEffortInstruction(0.9)).toContain('extenso');
  });
});
