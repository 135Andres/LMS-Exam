import test from 'node:test';
import assert from 'node:assert/strict';
import { renderAvatarInto, isValidAvatarDataUrl } from './utils.js';

// No hay DOM real disponible bajo node:test — stub mínimo suficiente para
// ejercitar el path de renderAvatarInto (createElement + appendChild/textContent).
function fakeDocument() {
  return {
    createElement(tag) {
      return { tagName: tag, src: undefined, alt: undefined };
    },
  };
}

function fakeEl() {
  const children = [];
  return {
    _textContent: '',
    get textContent() { return this._textContent; },
    set textContent(v) { this._textContent = v; children.length = 0; },
    children,
    appendChild(child) { children.push(child); },
  };
}

test.beforeEach(() => {
  globalThis.document = fakeDocument();
});

test.after(() => {
  delete globalThis.document;
});

test('avatarData con data:image/png;base64 válido inserta un <img>', () => {
  const el = fakeEl();
  renderAvatarInto(el, 'data:image/png;base64,aGVsbG8=', 'Ana');

  assert.equal(el.children.length, 1);
  assert.equal(el.children[0].tagName, 'img');
  assert.equal(el.children[0].src, 'data:image/png;base64,aGVsbG8=');
  assert.equal(el.children[0].alt, 'avatar');
  assert.equal(el.textContent, '');
});

test('avatarData con javascript: cae a la inicial, sin insertar el string crudo', () => {
  const el = fakeEl();
  renderAvatarInto(el, 'javascript:alert(1)', 'Ana');

  assert.equal(el.children.length, 0);
  assert.equal(el.textContent, 'A');
});

test('avatarData con markup malicioso (<img src=x onerror=...>) cae a la inicial', () => {
  const el = fakeEl();
  renderAvatarInto(el, '<img src=x onerror=alert(1)>', 'Ana');

  assert.equal(el.children.length, 0);
  assert.equal(el.textContent, 'A');
});

test('avatarData con data:text/html (mismo esquema data: pero no imagen) cae a la inicial', () => {
  const el = fakeEl();
  renderAvatarInto(el, 'data:text/html;base64,PHNjcmlwdD4=', 'Ana');

  assert.equal(el.children.length, 0);
  assert.equal(el.textContent, 'A');
});

test('sin avatarData muestra la inicial en mayúscula, igual que antes', () => {
  const el = fakeEl();
  renderAvatarInto(el, null, 'bruno');

  assert.equal(el.children.length, 0);
  assert.equal(el.textContent, 'B');
});

test('sin avatarData ni name, usa "?" como fallback', () => {
  const el = fakeEl();
  renderAvatarInto(el, null, null);

  assert.equal(el.textContent, '?');
});

test('isValidAvatarDataUrl acepta png/jpeg/jpg/webp/gif en base64 y rechaza el resto', () => {
  assert.equal(isValidAvatarDataUrl('data:image/png;base64,aGVsbG8='), true);
  assert.equal(isValidAvatarDataUrl('data:image/webp;base64,aGVsbG8='), true);
  assert.equal(isValidAvatarDataUrl('javascript:alert(1)'), false);
  assert.equal(isValidAvatarDataUrl('data:text/html;base64,PHNjcmlwdD4='), false);
  assert.equal(isValidAvatarDataUrl('https://evil.example/x.png'), false);
  assert.equal(isValidAvatarDataUrl(null), false);
  assert.equal(isValidAvatarDataUrl(undefined), false);
});
