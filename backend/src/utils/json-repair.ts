// La IA mete LaTeX (\sqrt, \frac, \sum, etc.) dentro de strings JSON — pese a
// que el prompt pide escapar backslashes como \\, no siempre lo hace, y un
// \s/\f(letra)/\l/etc. no es un escape JSON válido: JSON.parse tira "Bad
// escaped character" en cada intento con contenido matemático real.
// Reparamos duplicando cualquier backslash que no preceda a un escape JSON válido.
export function repairBackslashEscapes(json: string): string {
  return json.replace(/\\(?!["\\/bfnrtu])/g, '\\\\');
}
