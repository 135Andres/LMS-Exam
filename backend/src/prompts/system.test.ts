import { describe, it, expect } from 'vitest';
import {
  SYSTEM_PROMPT_TUTOR,
  SYSTEM_PROMPT_QUIZ_SOLVE,
  SYSTEM_PROMPT_QUIZ_VERIFY,
  SYSTEM_PROMPT_QUIZ_EXPLAIN,
  SYSTEM_PROMPT_COMPACTOR,
  SYSTEM_PROMPT_NARRATIVE_COMPACTOR,
  SYSTEM_PROMPT_EXAM,
  FORMAT_MATH_RULES_SIMPLE,
  FORMAT_MATH_RULES_ESCAPED,
  FORMAT_JSON_NEWLINE_RULE,
} from './system.js';

describe('prompts de cuestionario', () => {
  it('SYSTEM_PROMPT_TUTOR instruye detectar cuestionario y usar el marcador', () => {
    expect(SYSTEM_PROMPT_TUTOR).toContain('[[QUIZ_DETECTED]]');
    expect(SYSTEM_PROMPT_TUTOR).toContain('¿Quieres que los responda todos o vamos por partes?');
  });

  it('SYSTEM_PROMPT_QUIZ_SOLVE pide JSON con num/pregunta/desarrollo/respuesta', () => {
    expect(SYSTEM_PROMPT_QUIZ_SOLVE).toContain('"num"');
    expect(SYSTEM_PROMPT_QUIZ_SOLVE).toContain('"pregunta"');
    expect(SYSTEM_PROMPT_QUIZ_SOLVE).toContain('"desarrollo"');
    expect(SYSTEM_PROMPT_QUIZ_SOLVE).toContain('"respuesta"');
  });

  it('SYSTEM_PROMPT_QUIZ_VERIFY pide JSON con num/correcto/motivo', () => {
    expect(SYSTEM_PROMPT_QUIZ_VERIFY).toContain('"num"');
    expect(SYSTEM_PROMPT_QUIZ_VERIFY).toContain('"correcto"');
    expect(SYSTEM_PROMPT_QUIZ_VERIFY).toContain('"motivo"');
  });

  it('SYSTEM_PROMPT_QUIZ_EXPLAIN instruye ir paso a paso sin adelantarse y usa el marcador de fin', () => {
    expect(SYSTEM_PROMPT_QUIZ_EXPLAIN).toContain('[[QUIZ_EXPLAIN_DONE]]');
    expect(SYSTEM_PROMPT_QUIZ_EXPLAIN.toLowerCase()).toContain('paso a paso');
  });
});

describe('identidad del tutor (plan 02) — nunca exponer el modelo real', () => {
  it('SYSTEM_PROMPT_TUTOR no contiene el placeholder {MODEL_NAME}', () => {
    expect(SYSTEM_PROMPT_TUTOR).not.toContain('{MODEL_NAME}');
  });

  it('SYSTEM_PROMPT_TUTOR instruye responder "Inkling" ante preguntas de identidad, sin mencionar proveedores', () => {
    expect(SYSTEM_PROMPT_TUTOR).toContain('eres Inkling');
    expect(SYSTEM_PROMPT_TUTOR.toLowerCase()).not.toMatch(/claude|gemini|glm|deepseek|nvidia|anthropic|google|z-ai/);
  });

  it('ningún prompt de sistema expone nombres de proveedores o modelos de terceros', () => {
    const prompts = {
      SYSTEM_PROMPT_TUTOR,
      SYSTEM_PROMPT_QUIZ_SOLVE,
      SYSTEM_PROMPT_QUIZ_VERIFY,
      SYSTEM_PROMPT_QUIZ_EXPLAIN,
      SYSTEM_PROMPT_COMPACTOR,
      SYSTEM_PROMPT_NARRATIVE_COMPACTOR,
      SYSTEM_PROMPT_EXAM,
    };
    for (const [name, prompt] of Object.entries(prompts)) {
      expect(prompt, `${name} no debe contener {MODEL_NAME}`).not.toContain('{MODEL_NAME}');
      expect(prompt.toLowerCase(), `${name} no debe mencionar proveedores/modelos reales`).not.toMatch(
        /claude|gemini|glm|deepseek|nvidia|anthropic|google|z-ai|sonnet/,
      );
    }
  });
});

describe('SYSTEM_PROMPT_COMPACTOR', () => {
  it('no impone un tope de palabras', () => {
    expect(SYSTEM_PROMPT_COMPACTOR).not.toMatch(/máximo.*palabras/i);
    expect(SYSTEM_PROMPT_COMPACTOR).not.toContain('400 palabras');
  });

  it('no usa "relevante" sin definir el criterio', () => {
    expect(SYSTEM_PROMPT_COMPACTOR).not.toMatch(/conversación relevante/i);
  });

  it('exige declarar conteo de mensajes revisados antes de afirmar ausencia de contenido académico', () => {
    expect(SYSTEM_PROMPT_COMPACTOR).toMatch(/cuántos mensajes/i);
  });

  it('pide autoevaluación de confianza junto al resumen', () => {
    expect(SYSTEM_PROMPT_COMPACTOR).toMatch(/confidence/i);
    expect(SYSTEM_PROMPT_COMPACTOR).toMatch(/high\/medium\/low|high.*medium.*low/i);
  });

  it('mantiene el contrato JSON summary + kbCandidates', () => {
    expect(SYSTEM_PROMPT_COMPACTOR).toContain('"summary"');
    expect(SYSTEM_PROMPT_COMPACTOR).toContain('"kbCandidates"');
  });
});

describe('SYSTEM_PROMPT_NARRATIVE_COMPACTOR', () => {
  it('no pide reviewedMessageCount ni kbCandidates (Fase 1, ya no se usan)', () => {
    expect(SYSTEM_PROMPT_NARRATIVE_COMPACTOR).not.toContain('reviewedMessageCount');
    expect(SYSTEM_PROMPT_NARRATIVE_COMPACTOR).not.toContain('kbCandidates');
  });

  it('el contrato JSON de respuesta es solo summary + confidence', () => {
    expect(SYSTEM_PROMPT_NARRATIVE_COMPACTOR).toContain('"summary"');
    expect(SYSTEM_PROMPT_NARRATIVE_COMPACTOR).toMatch(/"confidence"/);
    expect(SYSTEM_PROMPT_NARRATIVE_COMPACTOR).toMatch(/high.*medium.*low/i);
  });

  it('menciona referenciar bloques por id/título en vez de repetir contenido', () => {
    expect(SYSTEM_PROMPT_NARRATIVE_COMPACTOR.toLowerCase()).toContain('bloques');
    expect(SYSTEM_PROMPT_NARRATIVE_COMPACTOR.toLowerCase()).toMatch(/referenc/);
  });
});

describe('LaTeX escape directives (Task 1 fix)', () => {
  it('SYSTEM_PROMPT_TUTOR debe instruir backslash simple, NO doble escape', () => {
    expect(SYSTEM_PROMPT_TUTOR).toContain('Backslash simple en comandos LaTeX');
    expect(SYSTEM_PROMPT_TUTOR).not.toContain('Escapa dobles barras invertidas');
    // Verificar que no hay instrucción de doblar (el patrón \\\\ en la fuente se evalúa a \\)
    expect(SYSTEM_PROMPT_TUTOR).not.toMatch(/escapa.*dobles/i);
    // El ejemplo debe contener backslash simple literal, no un control char de template literal roto
    expect(SYSTEM_PROMPT_TUTOR).toContain('\\frac{a}{b}');
    expect(SYSTEM_PROMPT_TUTOR).toContain('\\int');
    expect(SYSTEM_PROMPT_TUTOR).toContain('\\sum');
  });

  it('SYSTEM_PROMPT_QUIZ_SOLVE debe conservar instrucción de doble escape (output JSON)', () => {
    // Este prompt genera JSON que será parseado, necesita double escape
    expect(SYSTEM_PROMPT_QUIZ_SOLVE).toContain('Escapa backslashes dobles en comandos LaTeX');
  });

  it('SYSTEM_PROMPT_EXAM debe conservar instrucción de doble escape (output JSON)', () => {
    // Este prompt genera JSON que será parseado, necesita double escape
    expect(SYSTEM_PROMPT_EXAM).toContain('Escapa backslashes dobles en comandos LaTeX');
  });

  it('SYSTEM_PROMPT_QUIZ_EXPLAIN NO debe contener instrucción de doble escape (control test)', () => {
    // Este prompt ya está limpio: es tutorización conversacional, no JSON
    // Este test documenta el estado actual para detectar si alguien lo rompe a futuro
    expect(SYSTEM_PROMPT_QUIZ_EXPLAIN).not.toContain('Escapa dobles barras');
    expect(SYSTEM_PROMPT_QUIZ_EXPLAIN).not.toContain('escapa backslashes dobles');
  });
});

describe('FORMAT_MATH_RULES_SIMPLE / FORMAT_MATH_RULES_ESCAPED (Task 3 consolidation)', () => {
  it('FORMAT_MATH_RULES_SIMPLE tiene backslash simple en runtime (no doble)', () => {
    expect(FORMAT_MATH_RULES_SIMPLE).toContain('\\frac{a}{b}');
    expect(FORMAT_MATH_RULES_SIMPLE).not.toContain('\\\\frac');
  });

  it('FORMAT_MATH_RULES_ESCAPED tiene backslash doble en runtime', () => {
    expect(FORMAT_MATH_RULES_ESCAPED).toContain('\\\\frac{a}{b}');
  });

  it('SYSTEM_PROMPT_TUTOR interpola FORMAT_MATH_RULES_SIMPLE', () => {
    expect(SYSTEM_PROMPT_TUTOR).toContain(FORMAT_MATH_RULES_SIMPLE);
  });

  it('SYSTEM_PROMPT_EXAM y SYSTEM_PROMPT_QUIZ_SOLVE interpolan FORMAT_MATH_RULES_ESCAPED', () => {
    expect(SYSTEM_PROMPT_EXAM).toContain(FORMAT_MATH_RULES_ESCAPED);
    expect(SYSTEM_PROMPT_QUIZ_SOLVE).toContain(FORMAT_MATH_RULES_ESCAPED);
  });
});

describe('regla de saltos de línea en JSON + few-shot (plan 11)', () => {
  it('FORMAT_JSON_NEWLINE_RULE instruye escapar saltos de línea como \\n dentro de strings', () => {
    expect(FORMAT_JSON_NEWLINE_RULE).toContain('\\n');
    expect(FORMAT_JSON_NEWLINE_RULE.toLowerCase()).toContain('salto de línea');
  });

  it('SYSTEM_PROMPT_EXAM, SYSTEM_PROMPT_QUIZ_SOLVE y SYSTEM_PROMPT_QUIZ_VERIFY interpolan la regla de \\n', () => {
    expect(SYSTEM_PROMPT_EXAM).toContain(FORMAT_JSON_NEWLINE_RULE);
    expect(SYSTEM_PROMPT_QUIZ_SOLVE).toContain(FORMAT_JSON_NEWLINE_RULE);
    expect(SYSTEM_PROMPT_QUIZ_VERIFY).toContain(FORMAT_JSON_NEWLINE_RULE);
  });

  it('los 3 prompts JSON estrictos traen un few-shot que combina LaTeX escapado y \\n en un mismo campo', () => {
    for (const prompt of [SYSTEM_PROMPT_EXAM, SYSTEM_PROMPT_QUIZ_SOLVE, SYSTEM_PROMPT_QUIZ_VERIFY]) {
      expect(prompt.toLowerCase()).toContain('ejemplo');
      expect(prompt).toContain('\\\\sqrt');
      // "\n" aparece al menos 2 veces: una vez descrito en la regla, otra vez
      // usado de verdad dentro del JSON del few-shot.
      const occurrences = prompt.split('\\n').length - 1;
      expect(occurrences).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('directiva 4 de SYSTEM_PROMPT_TUTOR — criterio numérico de "bloque de ejercicios" (plan 11)', () => {
  it('define "bloque de ejercicios" como 3 o más preguntas diferenciables', () => {
    expect(SYSTEM_PROMPT_TUTOR).toMatch(/3 o más/);
  });

  it('aclara que una sola pregunta con varios incisos NO cuenta como bloque', () => {
    expect(SYSTEM_PROMPT_TUTOR.toLowerCase()).toContain('incisos');
    expect(SYSTEM_PROMPT_TUTOR).toMatch(/incisos.*no cuenta como bloque/i);
  });
});
