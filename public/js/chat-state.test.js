import test from 'node:test';
import assert from 'node:assert/strict';

// sessionStorage no existe bajo node:test — stub mínimo suficiente para el
// valor inicial de state.sessionId (mismo patrón que fakeDocument en utils.test.js).
globalThis.sessionStorage = {
  getItem() { return null; },
};

const { state } = await import('./chat-state.js');

test('state trae la forma y los defaults esperados', () => {
  assert.equal(state.sessionId, '');
  assert.equal(state.selectedModelId, '');
  assert.deepEqual(state.availableModels, []);
  assert.deepEqual(state.pendingAttachments, []);
  assert.deepEqual(state.activeLinks, []);
  assert.equal(state.currentMode, 'chat');
  assert.equal(state.sessionState.provider, 'NVIDIA');
  assert.equal(state.sessionState.contextLength, 128000);
});

test('state es un único objeto compartido — mutar una propiedad es visible en la misma referencia', () => {
  state.sessionId = 'abc-123';
  assert.equal(state.sessionId, 'abc-123');
  state.sessionState.chatCreated = '10:00';
  assert.equal(state.sessionState.chatCreated, '10:00');
});
