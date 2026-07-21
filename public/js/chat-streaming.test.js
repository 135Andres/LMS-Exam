import test from 'node:test';
import assert from 'node:assert/strict';

// chat-streaming.js importa (indirectamente, vía chat.js) settings-modal.js
// y onboarding.js, que tocan el DOM al cargar — stub mínimo suficiente para
// que la cadena de imports no truene bajo node:test, mismo patrón que
// utils.test.js/chat-quiz-mode.test.js. Las funciones que este test ejercita
// (enterReExplicarMode/exitReExplicarMode) no dependen de nada más que esto.
globalThis.sessionStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };

function fakeClassList() {
  const classes = new Set();
  return {
    add(...c) { c.forEach(x => classes.add(x)); },
    remove(...c) { c.forEach(x => classes.delete(x)); },
    contains(c) { return classes.has(c); },
    toggle(c) { classes.has(c) ? classes.delete(c) : classes.add(c); },
  };
}

function fakeEl() {
  return { classList: fakeClassList(), placeholder: '', focus() {}, style: {} };
}

const elements = {
  '.chat-input-wrapper': fakeEl(),
  reexplicarBar: fakeEl(),
  messageInput: fakeEl(),
  reexplicarSuggestions: null, // sin sugerencias montadas — cubre el "if (!box) return"
};

globalThis.document = {
  querySelector(sel) { return elements[sel] || null; },
  getElementById(id) { return elements[id] !== undefined ? elements[id] : null; },
  querySelectorAll() { return []; },
  addEventListener() {},
  createElement() { return fakeEl(); },
};
globalThis.window = { addEventListener() {}, location: {} };
globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });

const { enterReExplicarMode, exitReExplicarMode } = await import('./chat-streaming.js');

test('enterReExplicarMode activa la barra y cambia el placeholder del input', () => {
  const msgRow = {};
  enterReExplicarMode(msgRow);
  assert.equal(elements['.chat-input-wrapper'].classList.contains('reexplicar-active'), true);
  assert.equal(elements.reexplicarBar.classList.contains('hidden'), false);
  assert.equal(elements.messageInput.placeholder, '¿Cómo quieres que te lo expliquen?');
});

test('exitReExplicarMode desactiva la barra y oculta el input de nuevo', () => {
  exitReExplicarMode();
  assert.equal(elements['.chat-input-wrapper'].classList.contains('reexplicar-active'), false);
  assert.equal(elements.reexplicarBar.classList.contains('hidden'), true);
});
