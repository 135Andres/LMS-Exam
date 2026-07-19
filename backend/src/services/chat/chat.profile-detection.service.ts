import { generateFromAI } from '../ai/index.js';
import { ProfileService } from '../profile.service.js';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';

// Filtro barato antes de gastar una llamada IA (el clasificador de abajo).
// Frases sin acentos — el mensaje se normaliza (sin acentos, minúsculas) antes
// de probar, así "sé menos formal" y "se menos formal" matchean igual.
// Para agregar una frase nueva: solo agrégala a este array.
const PROFILE_EDIT_TRIGGERS = [
  'quiero que', 'cambia mi', 'actualiza mi', 'prefiero que', 'configura mi', 'ajusta mi', 'modifica mi',
  'se mas', 'se menos', 'seas mas', 'seas menos',
  'actua mas', 'actua menos',
  'explica mas', 'explica menos', 'explicame mas', 'explicame menos',
  'responde mas', 'responde menos',
  'tratame', 'no seas', 'deja de ser', 'evita ser', 'trata de ser',
];

const PROFILE_EDIT_REGEX = new RegExp(
  `\\b(?:${PROFILE_EDIT_TRIGGERS.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
  'i'
);

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function isProfileEditIntent(message: string): boolean {
  return PROFILE_EDIT_REGEX.test(normalize(message));
}

const SYSTEM_PROMPT_CLASSIFIER = `Eres un clasificador de intención. Analiza si el mensaje del estudiante contiene una instrucción para CAMBIAR o AJUSTAR la forma en que el tutor IA debe comportarse (preferencias de aprendizaje, tono, profundidad, temas, etc.).

Responde ÚNICAMENTE con JSON, sin markdown ni explicaciones extra:

- Si el mensaje SÍ expresa una preferencia o cambio: {"update_profile": true, "change": "descripción clara del cambio que pide"}
- Si el mensaje NO expresa una preferencia (es una pregunta normal, saludo, ejercicio, etc.): {"update_profile": false}

Ejemplos:
Mensaje: "explícame qué es una derivada" → {"update_profile": false}
Mensaje: "cambia tu forma de explicar, hazlo más sencillo" → {"update_profile": true, "change": "Prefiere explicaciones más sencillas"}
Mensaje: "ahora vamos a estudiar química orgánica" → {"update_profile": true, "change": "Cambiando enfoque a química orgánica"}
Mensaje: "evita usar ejemplos de física" → {"update_profile": true, "change": "No usar ejemplos de física"}
Mensaje: "hola" → {"update_profile": false}`;

export class ChatProfileDetectionService {
  async detectAndApply(message: string, userId: string): Promise<string | null> {
    if (!isProfileEditIntent(message)) return null;

    try {
      const result = await generateFromAI('nineRouter', SYSTEM_PROMPT_CLASSIFIER, message, {
        type: 'json_object',
        json_schema: {
          type: 'object',
          properties: {
            update_profile: { type: 'boolean' },
            change: { type: 'string' },
          },
          required: ['update_profile'],
        },
      }, { model: config.models.chat, temperature: 0.1, max_tokens: 150 });

      const parsed = JSON.parse(result.content) as { update_profile: boolean; change?: string };
      if (parsed.update_profile && parsed.change) {
        logger.info('Perfil actualizado desde chat', { userId, change: parsed.change });
        ProfileService.appendToProfile(userId, parsed.change);
        ProfileService.invalidateCache(userId);
        return parsed.change;
      }
      logger.debug('ProfileEdit: clasificador descartó (regex pasó pero IA dice no)', {
        message_preview: message.slice(0, 50)
      });
    } catch (err) {
      logger.warn('Error en clasificador de perfil', { error: (err as Error).message });
    }

    return null;
  }
}
