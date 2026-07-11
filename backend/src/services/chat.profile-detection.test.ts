import { describe, it, expect } from 'vitest';
import { isProfileEditIntent } from './chat.service.js';

describe('isProfileEditIntent', () => {
  const positives = [
    'quiero que me expliques más sencillo',
    'cambia mi perfil a modo sargento',
    'actualiza mi preferencia: nada de física',
    'prefiero que me des solo la respuesta',
    'configura mi tutor para oposiciones',
    'ajusta mi nivel de detalle',
    'modifica mi estilo de feedback',
  ];

  const negatives = [
    'explícame la regla de la cadena',
    'ahora entiendo, gracias',
    '¿en modo examen o práctica?',
    'evita los errores comunes en integrales',
    'habla más despacio por favor',
    'modo sargento activado',
    'qué es una derivada',
    'cómo resuelvo una ecuación cuadrática',
    'gracias, me ayudó mucho',
    'ok perfecto',
    'vale, entendido',
  ];

  for (const msg of positives) {
    it(`detects: "${msg}"`, () => {
      expect(isProfileEditIntent(msg)).toBe(true);
    });
  }

  for (const msg of negatives) {
    it(`rejects: "${msg}"`, () => {
      expect(isProfileEditIntent(msg)).toBe(false);
    });
  }
});
