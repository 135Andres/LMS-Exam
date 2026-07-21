// La IA a veces mete un salto de línea real (Enter) dentro de un valor
// string en vez del escape \n de dos caracteres que pide el prompt — un
// salto de línea literal dentro de una string JSON es inválido por spec,
// JSON.parse tira "Bad control character in string literal". Reparamos
// escapándolo, pero solo mientras estamos DENTRO de una string (no toca el
// whitespace de formato entre tokens JSON) — trackea el estado con un scan
// lineal que respeta comillas escapadas (\").
function escapeRawNewlinesInStrings(json: string): string {
  let result = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < json.length; i++) {
    const ch = json[i];
    if (!inString) {
      if (ch === '"') inString = true;
      result += ch;
      continue;
    }
    if (escaped) {
      result += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      result += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = false;
      result += ch;
      continue;
    }
    if (ch === '\n') { result += '\\n'; continue; }
    if (ch === '\r') { result += '\\r'; continue; }
    result += ch;
  }
  return result;
}

// La IA mete LaTeX (\sqrt, \frac, \sum, etc.) dentro de strings JSON — pese a
// que el prompt pide escapar backslashes como \\, no siempre lo hace, y un
// \s/\f(letra)/\l/etc. no es un escape JSON válido: JSON.parse tira "Bad
// escaped character" en cada intento con contenido matemático real.
// Reparamos duplicando cualquier backslash que no preceda a un escape JSON
// válido — se corre DESPUÉS de escapeRawNewlinesInStrings a propósito: los
// \n que esa pasada inserta ya son un escape válido (backslash seguido de
// "n"), así que esta regex los deja intactos en vez de duplicarlos.
export function repairBackslashEscapes(json: string): string {
  const withEscapedNewlines = escapeRawNewlinesInStrings(json);
  return withEscapedNewlines.replace(/\\(?!["\\/bfnrtu])/g, '\\\\');
}
