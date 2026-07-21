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

const { playHeroToChatMorph } = await import('./chat-hero.js');

test('playHeroToChatMorph llama onComplete de inmediato si el hero o el input del chat no están montados', () => {
  let called = false;
  playHeroToChatMorph(() => { called = true; });
  assert.equal(called, true);
});
