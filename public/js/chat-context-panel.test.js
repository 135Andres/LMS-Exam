import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.sessionStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };

function fakeClassList(initial = []) {
  const classes = new Set(initial);
  return {
    add(...c) { c.forEach(x => classes.add(x)); },
    remove(...c) { c.forEach(x => classes.delete(x)); },
    contains(c) { return classes.has(c); },
    toggle(c) { const had = classes.has(c); had ? classes.delete(c) : classes.add(c); return !had; },
  };
}

// Simula un <div class="summary-block-item" data-block-id="..."> ya "parseado" —
// sin jsdom no podemos parsear innerHTML de verdad, así que el stub de
// querySelectorAll('.summary-block-item') devuelve directamente estos fakes
// en vez de derivarlos del HTML seteado.
function fakeBlockEl(blockId) {
  const contentEl = { classList: fakeClassList(['hidden']), innerHTML: '', dataset: {} };
  let clickHandler = null;
  const el = {
    dataset: { blockId },
    addEventListener(type, fn) { if (type === 'click') clickHandler = fn; },
    querySelector(sel) { return sel === '.summary-block-content' ? contentEl : null; },
    click() { clickHandler?.(); },
  };
  return { el, contentEl };
}

let blockEls = [];

function fakeBody() {
  return {
    _html: '',
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = v; },
    querySelectorAll(sel) {
      if (sel === '.summary-block-item') return blockEls.map(b => b.el);
      return [];
    },
  };
}

const elements = {};

globalThis.document = {
  getElementById(id) {
    if (id === 'sessionSummaryBody') return elements.body ?? (elements.body = fakeBody());
    if (id === 'sessionSummaryBlockCount') return elements.countEl ?? (elements.countEl = { textContent: '' });
    if (id === 'summaryEditBtn') {
      return { addEventListener() {} };
    }
    return elements[id] ?? null;
  },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  addEventListener() {},
};
globalThis.window = { addEventListener() {}, location: {} };
globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });

const { formatStopwatch, parseStopwatchInput, renderSessionSummary } = await import('./chat-context-panel.js');

test('formatStopwatch usa MM:SS bajo 100 minutos y H:MM:SS arriba de eso', () => {
  assert.equal(formatStopwatch(0), '00:00');
  assert.equal(formatStopwatch(65), '01:05');
  assert.equal(formatStopwatch(99 * 60 + 5), '99:05');
  assert.equal(formatStopwatch(100 * 60), '1:40:00');
  assert.equal(formatStopwatch(3661), '61:01');
  assert.equal(formatStopwatch(6000 + 61), '1:41:01');
});

test('parseStopwatchInput acepta MM:SS y H:MM:SS, rechaza formatos inválidos', () => {
  assert.equal(parseStopwatchInput('10:00'), 600);
  assert.equal(parseStopwatchInput('1:02:03'), 3723);
  assert.equal(parseStopwatchInput('abc'), null);
  assert.equal(parseStopwatchInput('1:2:3:4'), null);
  assert.equal(parseStopwatchInput('1'), null);
});

test('renderSessionSummary sin narrativa ni bloques muestra el estado "aún no hay resumen"', () => {
  blockEls = [];
  renderSessionSummary({ narrative: null, blocks: [], failedRecently: false });
  assert.match(elements.body.innerHTML, /Aún no hay resumen/);
  assert.equal(elements.countEl.textContent, 0);
});

test('renderSessionSummary con bloques: el contador coincide con blocks.length', () => {
  blockEls = [fakeBlockEl('b1'), fakeBlockEl('b2')];
  renderSessionSummary({
    narrative: 'una narrativa cualquiera',
    blocks: [
      { id: 'b1', title: 'Derivadas', subject: 'Cálculo', content: 'contenido 1' },
      { id: 'b2', title: 'Integrales', subject: 'Cálculo', content: 'contenido 2' },
    ],
    failedRecently: false,
  });
  assert.equal(elements.countEl.textContent, 2);
});

test('failedRecently: true muestra el aviso, false no lo muestra', () => {
  blockEls = [];
  renderSessionSummary({ narrative: 'x', blocks: [], failedRecently: true });
  assert.match(elements.body.innerHTML, /problema técnico/);

  renderSessionSummary({ narrative: 'x', blocks: [], failedRecently: false });
  assert.doesNotMatch(elements.body.innerHTML, /problema técnico/);
});

test('clic en un bloque expande su contenido (primera vez, renderiza) y un segundo clic lo colapsa sin re-renderizar', () => {
  const b1 = fakeBlockEl('b1');
  blockEls = [b1];
  const data = {
    narrative: 'x',
    blocks: [{ id: 'b1', title: 'Derivadas', subject: 'Cálculo', content: 'contenido **completo**' }],
    failedRecently: false,
  };
  renderSessionSummary(data);

  // Primer clic: expande y renderiza formatAIResponse(content) una sola vez.
  b1.el.click();
  assert.equal(b1.contentEl.classList.contains('hidden'), false);
  assert.equal(b1.contentEl.dataset.rendered, '1');
  const renderedOnce = b1.contentEl.innerHTML;
  assert.ok(renderedOnce.length > 0);

  // Segundo clic: colapsa (vuelve a "hidden"), NO vuelve a tocar innerHTML.
  b1.el.click();
  assert.equal(b1.contentEl.classList.contains('hidden'), true);
  assert.equal(b1.contentEl.innerHTML, renderedOnce);
});
