import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.sessionStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
globalThis.document = {
  getElementById() { return null; },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  addEventListener() {},
};
globalThis.window = { addEventListener() {}, location: {} };
globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });

const { formatStopwatch, parseStopwatchInput } = await import('./chat-context-panel.js');

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
