import { describe, it, expect } from 'vitest';
import { repairBackslashEscapes } from './json-repair.js';

describe('repairBackslashEscapes', () => {
  it('duplica un backslash de LaTeX sin escapar (\\sqrt) para que JSON.parse no falle', () => {
    const raw = '{"desarrollo": "\\sqrt{4} = 2"}';
    expect(() => JSON.parse(raw)).toThrow();

    const repaired = repairBackslashEscapes(raw);
    const parsed = JSON.parse(repaired) as { desarrollo: string };
    expect(parsed.desarrollo).toBe('\\sqrt{4} = 2');
  });

  it('repara múltiples comandos LaTeX distintos (\\sum, \\int) en el mismo string', () => {
    const raw = '{"a": "\\sum_{i=0}^n y \\int_0^1"}';
    const parsed = JSON.parse(repairBackslashEscapes(raw)) as { a: string };
    expect(parsed.a).toBe('\\sum_{i=0}^n y \\int_0^1');
  });

  it('no toca escapes JSON válidos ya presentes (\\n, \\", \\\\)', () => {
    const raw = String.raw`{"a": "linea1\nlinea2 \"cita\" fin\\"}`;
    const parsed = JSON.parse(repairBackslashEscapes(raw)) as { a: string };
    expect(parsed.a).toBe('linea1\nlinea2 "cita" fin\\');
  });

  it('deja JSON ya válido intacto en su valor parseado', () => {
    const raw = JSON.stringify({ ok: true, n: 1 });
    expect(JSON.parse(repairBackslashEscapes(raw))).toEqual({ ok: true, n: 1 });
  });

  it('repara un salto de línea real dentro de un string (JSON.parse lo rechaza por spec)', () => {
    const raw = '{"desarrollo": "primera línea\nsegunda línea"}';
    expect(() => JSON.parse(raw)).toThrow();

    const repaired = repairBackslashEscapes(raw);
    const parsed = JSON.parse(repaired) as { desarrollo: string };
    expect(parsed.desarrollo).toBe('primera línea\nsegunda línea');
  });

  it('repara LaTeX sin escapar y un salto de línea real combinados en el mismo string (fixture del plan 11)', () => {
    const raw = '{"num": 1, "pregunta": "Resuelve \\sqrt{16}", "desarrollo": "Buscamos el número que al cuadrado da 16.\nComo 4^2 = 16, la raíz es 4.", "respuesta": "4"}';
    expect(() => JSON.parse(raw)).toThrow();

    const repaired = repairBackslashEscapes(raw);
    const parsed = JSON.parse(repaired) as { pregunta: string; desarrollo: string };
    expect(parsed.pregunta).toBe('Resuelve \\sqrt{16}');
    expect(parsed.desarrollo).toBe('Buscamos el número que al cuadrado da 16.\nComo 4^2 = 16, la raíz es 4.');
  });

  it('no toca saltos de línea reales que quedan FUERA de un string (whitespace de formato entre tokens)', () => {
    const raw = '{\n  "ok": true\n}';
    expect(JSON.parse(raw)).toEqual({ ok: true }); // ya válido sin reparar
    expect(JSON.parse(repairBackslashEscapes(raw))).toEqual({ ok: true });
  });
});
