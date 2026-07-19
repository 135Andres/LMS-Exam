// Known LaTeX commands worth auto-wrapping when they appear with no delimiter
// around them. Deliberately a whitelist (not "any backslash") so we don't
// false-positive on Windows paths (C:\Users\foo) or markdown escapes (\*text\*).
// Short, common-English-word commands (\bar, \hat, \vec, \dot, \to, \pm, \div,
// \cup, \cap) are intentionally left out — too likely to collide with real
// path segments or prose; add them back only if a real bug demands it.
const LATEX_COMMANDS = [
  'frac', 'sqrt', 'sum', 'int', 'iint', 'iiint', 'oint', 'prod', 'lim',
  'leq', 'geq', 'neq', 'approx', 'equiv', 'cdot', 'times',
  'infty', 'partial', 'nabla', 'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
  'log', 'ln', 'exp', 'rightarrow', 'leftarrow', 'Rightarrow', 'Leftarrow',
  'forall', 'exists', 'subset', 'subseteq', 'emptyset',
  'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta',
  'theta', 'vartheta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'omicron',
  'pi', 'varpi', 'rho', 'varrho', 'sigma', 'varsigma', 'tau', 'upsilon',
  'phi', 'varphi', 'chi', 'psi', 'omega',
  'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Upsilon', 'Phi', 'Psi', 'Omega',
];

const CMD_ALTERNATION = LATEX_COMMANDS.join('|');

// Subscript/superscript/argument tail that can follow a command, e.g.
// _{i=1}, ^n, {a}{b}.
const TAIL = String.raw`(?:\{[^{}]*\}|_\{[^{}]*\}|\^\{[^{}]*\}|_[A-Za-z0-9]|\^[A-Za-z0-9])`;

// (?![A-Za-z]) stops "\int" from swallowing part of "\integer" and leaving
// "eger" outside the match.
const BARE_LATEX_RE = new RegExp(String.raw`\\(?:${CMD_ALTERNATION})(?![A-Za-z])(?:${TAIL})*`, 'g');

// The 4 delimiter forms renderKaTeX() already understands. Used to carve out
// already-delimited spans so we never double-wrap them.
const DELIMITED_RE = /(\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$|\\\([\s\S]*?\\\)|\$[^$]*?\$)/g;

/**
 * Auto-wraps bare LaTeX commands (no surrounding delimiter) in `$$...$$` so
 * the existing 4 delimiter regexes in renderKaTeX() pick them up. Pure
 * function: string in, string out, no DOM access.
 */
export function wrapBareLatex(html) {
  return html
    .split(DELIMITED_RE)
    .map((chunk, i) => {
      // split() with a capturing group returns [nonMatch, match, nonMatch, ...]
      if (i % 2 === 1) return chunk; // already-delimited, leave untouched
      return chunk.replace(BARE_LATEX_RE, (match) => `$$${match}$$`);
    })
    .join('');
}
