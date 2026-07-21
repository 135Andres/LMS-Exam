import test from 'node:test';
import assert from 'node:assert/strict';

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
  return { classList: fakeClassList(), style: {}, dataset: {} };
}

const elements = { slashMenu: fakeEl() };

globalThis.document = {
  getElementById(id) { return elements[id] !== undefined ? elements[id] : null; },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  addEventListener() {},
  createElement() { return fakeEl(); },
};
globalThis.window = { addEventListener() {}, location: {} };
globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });

const { SLASH_COMMANDS, closeSlashMenu } = await import('./chat-input.js');

test('SLASH_COMMANDS trae /resumen, /exportar y /help con sus alias', () => {
  const primaries = SLASH_COMMANDS.map(c => c.primary);
  assert.deepEqual(primaries, ['/resumen', '/exportar', '/help']);
  const resumen = SLASH_COMMANDS.find(c => c.primary === '/resumen');
  assert.ok(resumen.aliases.includes('/resume'));
});

test('closeSlashMenu oculta el menú', () => {
  elements.slashMenu.classList.remove('hidden');
  closeSlashMenu();
  assert.equal(elements.slashMenu.classList.contains('hidden'), true);
});
