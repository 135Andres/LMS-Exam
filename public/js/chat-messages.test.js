import test from 'node:test';
import assert from 'node:assert/strict';

// Misma cadena de stubs mínimos que los demás tests de chat-*.js — la
// cadena de imports (vía chat.js) toca el DOM al cargar.
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

function fakeChatMessages() {
  return {
    _children: [],
    classList: fakeClassList(),
    prepend(el) { this._children.unshift(el); },
    get scrollTop() { return this._scrollTop; },
    set scrollTop(v) { this._scrollTop = v; },
  };
}

const chatMessages = fakeChatMessages();
const elements = { chatMessages };

globalThis.document = {
  getElementById(id) { return elements[id] !== undefined ? elements[id] : null; },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  addEventListener() {},
  createElement() {
    return { className: '', style: {}, classList: fakeClassList(), appendChild() {}, dataset: {} };
  },
};
globalThis.window = { addEventListener() {}, location: {} };
globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });
globalThis.requestAnimationFrame = (cb) => cb();

const { addSessionDivider, renderPinnedSection } = await import('./chat-messages.js');

test('addSessionDivider agrega un div.session-divider con el label escapado al frente del chat', () => {
  addSessionDivider('Sesión compactada');
  assert.equal(chatMessages._children.length, 1);
  assert.equal(chatMessages._children[0].className, 'session-divider');
});

test('renderPinnedSection sin mensajes fijados muestra el estado vacío', () => {
  const list = { innerHTML: '', querySelectorAll() { return []; } };
  const countEl = { textContent: '' };
  elements.pinnedMessagesList = list;
  elements.pinnedMessagesCount = countEl;
  renderPinnedSection([]);
  assert.equal(countEl.textContent, 0);
  assert.match(list.innerHTML, /Todavía no has fijado ningún mensaje/);
});
