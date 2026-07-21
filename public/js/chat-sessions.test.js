import test from 'node:test';
import assert from 'node:assert/strict';

// Misma cadena de stubs mínimos que chat-streaming.test.js — chat-sessions.js
// importa (vía chat.js) settings-modal.js/onboarding.js, que tocan el DOM al
// cargar.
globalThis.sessionStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };

function fakeEl() {
  return { dataset: {}, innerHTML: '', textContent: '' };
}

const elements = {
  chatTitleText: fakeEl(),
};

globalThis.document = {
  getElementById(id) { return elements[id] !== undefined ? elements[id] : null; },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  addEventListener() {},
  createElement() { return fakeEl(); },
};
globalThis.window = { addEventListener() {}, location: {} };
globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });

const { setChatTitleRaw } = await import('./chat-sessions.js');

test('setChatTitleRaw escapa HTML y aplica **negrita**/*cursiva* como markdown mínimo', () => {
  setChatTitleRaw('**Álgebra** y *geometría* <script>');
  assert.equal(elements.chatTitleText.dataset.raw, '**Álgebra** y *geometría* <script>');
  assert.equal(
    elements.chatTitleText.innerHTML,
    '<strong>Álgebra</strong> y <em>geometría</em> &lt;script&gt;'
  );
});

test('setChatTitleRaw no hace nada si el elemento del título no existe en el DOM', () => {
  elements.chatTitleText = undefined;
  assert.doesNotThrow(() => setChatTitleRaw('cualquier cosa'));
});
