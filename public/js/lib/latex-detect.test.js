import test from 'node:test';
import assert from 'node:assert/strict';
import { wrapBareLatex } from './latex-detect.js';

test('wraps a bare LaTeX command with no delimiter', () => {
  const out = wrapBareLatex('La integral es \\int_0^1 x dx.');
  assert.match(out, /\$\$\\int_0\^1\$\$/);
});

test('wraps multiple distinct bare LaTeX expressions', () => {
  const out = wrapBareLatex('\\frac{a}{b} y tambien \\sum_{i=1}^n');
  assert.match(out, /\$\$\\frac\{a\}\{b\}\$\$/);
  assert.match(out, /\$\$\\sum_\{i=1\}\^n\$\$/);
});

test('detects bare LaTeX inside already-formatted HTML (inside <p>, next to <strong>)', () => {
  const out = wrapBareLatex('<p>El resultado es <strong>importante</strong>: \\frac{a}{b}</p>');
  assert.match(out, /<p>El resultado es <strong>importante<\/strong>: \$\$\\frac\{a\}\{b\}\$\$<\/p>/);
});

test('does not re-wrap text that already has $$...$$ delimiters', () => {
  const input = 'Formula: $$\\frac{a}{b}$$ ya delimitada.';
  const out = wrapBareLatex(input);
  assert.equal(out, input);
});

test('does not re-wrap text that already has $...$ delimiters', () => {
  const input = 'Valor: $\\pi$ ya delimitado.';
  const out = wrapBareLatex(input);
  assert.equal(out, input);
});

test('does not re-wrap text that already has \\(...\\) or \\[...\\] delimiters', () => {
  const input = 'Inline \\(\\alpha + \\beta\\) y bloque \\[\\int_0^1 x dx\\]';
  const out = wrapBareLatex(input);
  assert.equal(out, input);
});

test('does not wrap non-LaTeX backslashes (Windows path)', () => {
  const input = 'La ruta es C:\\Users\\foo\\bar.txt';
  const out = wrapBareLatex(input);
  assert.equal(out, input);
});

test('does not wrap markdown escape backslashes', () => {
  const input = 'Esto \\*no es cursiva\\* en markdown.';
  const out = wrapBareLatex(input);
  assert.equal(out, input);
});

test('does not partially match a longer word starting with a command name', () => {
  const input = 'El \\integer no es un comando LaTeX real.';
  const out = wrapBareLatex(input);
  assert.equal(out, input);
});
