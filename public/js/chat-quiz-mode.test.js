import test from 'node:test';
import assert from 'node:assert/strict';

// chat-quiz-mode.js importa desde chat.js (addMessage/showTyping/etc.), que
// a su vez importa desde lib/settings-modal.js y onboarding.js y toca el DOM
// al cargar (document.querySelectorAll, sessionStorage) — stub mínimo
// suficiente para que el import no truene bajo node:test, mismo patrón que
// utils.test.js. stripQuizMarker (la función pura que este test ejercita) no
// usa nada de esto.
globalThis.sessionStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
globalThis.document = {
  querySelectorAll() { return []; },
  addEventListener() {},
  getElementById() { return null; },
};
globalThis.window = { addEventListener() {}, location: {} };
globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });

const { stripQuizMarker } = await import('./chat-quiz-mode.js');

test('stripQuizMarker quita [[QUIZ_DETECTED]] y devuelve el marcador sin corchetes', () => {
  const result = stripQuizMarker('¿Quieres que los responda todos o vamos por partes?[[QUIZ_DETECTED]]');
  assert.equal(result.text, '¿Quieres que los responda todos o vamos por partes?');
  assert.equal(result.marker, 'QUIZ_DETECTED');
});

test('stripQuizMarker quita [[QUIZ_EXPLAIN_DONE]]', () => {
  const result = stripQuizMarker('Listo, terminamos todos los ejercicios.[[QUIZ_EXPLAIN_DONE]]');
  assert.equal(result.text, 'Listo, terminamos todos los ejercicios.');
  assert.equal(result.marker, 'QUIZ_EXPLAIN_DONE');
});

test('stripQuizMarker deja el texto intacto y marker null si no hay marcador', () => {
  const result = stripQuizMarker('una respuesta normal sin marcador');
  assert.equal(result.text, 'una respuesta normal sin marcador');
  assert.equal(result.marker, null);
});
