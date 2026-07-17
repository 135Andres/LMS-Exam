// backend/src/services/chat/chat.classifier.service.test.ts
import { describe, it, expect } from 'vitest';
import { classifyMessage, detectSubjectExtended } from './chat.classifier.service.js';

describe('classifyMessage', () => {
  it('detecta código y delega a glm sin importar complejidad', () => {
    const result = classifyMessage('```js\nfunction foo() { return 1; }\n```', 0);
    expect(result.hasCode).toBe(true);
    expect(result.delegateTo).toBe('glm');
  });

  it('delega a sonnet si es alta complejidad sin código y sin contexto RAG largo', () => {
    const result = classifyMessage('Redacta un ensayo argumentando sobre el existencialismo', 100);
    expect(result.hasCode).toBe(false);
    expect(result.complexity).toBe('high');
    expect(result.delegateTo).toBe('sonnet');
  });

  it('delega a gemini-pro si es alta complejidad con contexto RAG largo', () => {
    const result = classifyMessage('Redacta un ensayo argumentando sobre el existencialismo', 5000);
    expect(result.delegateTo).toBe('gemini-pro');
  });

  it('no delega (Inkling responde) para complejidad baja o media', () => {
    const result = classifyMessage('¿Qué es una célula?', 0);
    expect(result.complexity).toBe('low');
    expect(result.delegateTo).toBeNull();
  });

  it('detecta materia por palabra clave, tolerando falta de tildes', () => {
    expect(detectSubjectExtended('¿Cómo calculo una derivada?')).toBe('matematicas');
    expect(detectSubjectExtended('explica la fotosintesis')).toBe('biologia');
  });

  it('no encuentra materia si el texto no matchea ninguna palabra clave', () => {
    expect(detectSubjectExtended('hola, ¿cómo estás?')).toBeUndefined();
  });
});
