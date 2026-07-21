import { UserModel } from '../models/user.model.js';
import { UserProfileService, type UserProfileInput } from './user-profile.service.js';
import { composeSystemPrompt } from '../prompts/prompt-composer.js';
import { SYSTEM_PROMPT_TUTOR } from '../prompts/system.js';
import { getStepPayload, matchChipAnswer, matchChipExact, ONBOARDING_TOTAL_STEPS, type OnboardingStepPayload } from '../prompts/onboarding.steps.js';
import { generateFromAI } from './ai/index.js';
import { config } from '../config/index.js';
import { ChatPersistenceService } from './chat/chat.persistence.service.js';
import { logger } from '../utils/logger.js';

const LONG_MESSAGE_THRESHOLD = 300;
const persistence = new ChatPersistenceService();

// Nota efímera de un solo uso — no forma parte del perfil ni se repite en
// mensajes futuros, solo orienta la primera respuesta tras cerrar el wizard.
const WELCOME_APPENDIX = '\n\n--- Nota de cierre de onboarding (efímera, un solo uso — no la menciones ni la repitas) ---\nEste es el primer mensaje del usuario tras configurar su perfil. Da una bienvenida de una línea usando su nombre y responde su mensaje.\n---';

function looksLikeQuizBlock(message: string): boolean {
  const numberedLines = message.split('\n').filter(line => /^\s*\d+[.):-]\s+/.test(line));
  return numberedLines.length >= 2;
}

// El usuario vino a trabajar, no a saludar — no interrumpir con el wizard.
export function isRealFirstMessage(message: string): boolean {
  return message.length > LONG_MESSAGE_THRESHOLD || looksLikeQuizBlock(message);
}

export type OnboardingInterceptResult =
  | { type: 'passthrough' }
  | OnboardingStepPayload;

export type OnboardingAnswerResult =
  | OnboardingStepPayload
  | { type: 'onboarding_complete'; response: string; sessionId: string | null };

export type OnboardingSkipResult =
  | { type: 'onboarding_skipped' }
  | { type: 'chat_passthrough'; message: string; sessionId: string };

export interface OnboardingStateResult {
  state: 'pending' | 'skipped' | 'completed';
  step: OnboardingStepPayload | null;
}

const FIELD_MAP: Record<string, keyof UserProfileInput> = {
  display_name: 'displayName',
  level: 'level',
  field: 'field',
  subjects: 'subjects',
  goal: 'goal',
  depth: 'depth',
  register: 'register',
};

function resolveStepValues(payload: OnboardingStepPayload, values: Record<string, unknown>): UserProfileInput | null {
  const patch: Record<string, unknown> = {};

  for (const input of payload.inputs) {
    const raw = values[input.id];
    const profileField = FIELD_MAP[input.id];

    if (input.kind === 'multi') {
      if (!Array.isArray(raw) || raw.length === 0) return null;
      const resolved: string[] = [];
      for (const item of raw) {
        if (typeof item !== 'string') return null;
        const matched = matchChipAnswer(item, input.options ?? []);
        if (matched && matched !== 'otra') { resolved.push(matched); continue; }
        if (matched === 'otra') continue; // placeholder de "Otra…", no es una materia real
        if (input.allowFreeText && item.trim()) { resolved.push(item.trim()); continue; }
        return null;
      }
      if (resolved.length === 0) return null;
      patch[profileField] = resolved;
      continue;
    }

    if (typeof raw !== 'string' || !raw.trim()) return null;

    if (input.kind === 'single') {
      const matched = matchChipAnswer(raw, input.options ?? []);
      if (!matched) return null;
      patch[profileField] = matched;
      continue;
    }

    // kind === 'text': solo resuelve al chip sugerido (p.ej. "Así está bien")
    // con match EXACTO — nunca por "contains", así un nombre real no se
    // confunde con el nombre de cuenta sugerido solo por contenerlo. Si no
    // matchea, cae a texto libre (siempre permitido en 'text').
    const matched = matchChipExact(raw, input.options ?? []);
    patch[profileField] = matched ?? raw.trim();
  }

  return patch as UserProfileInput;
}

async function generateWelcome(profile: ReturnType<typeof UserProfileService.getProfile>, pendingMessage: string | null): Promise<string> {
  const systemPrompt = composeSystemPrompt(SYSTEM_PROMPT_TUTOR, profile, 'full') + WELCOME_APPENDIX;
  const userPrompt = pendingMessage || '(El estudiante no tenía un mensaje pendiente — solo dale la bienvenida.)';
  const result = await generateFromAI('nineRouter', systemPrompt, userPrompt, null, { model: config.models.chat });
  return result.content;
}

export const OnboardingService = {
  // Disparo: se llama ANTES de cualquier llamada a la IA en el controller de chat.
  intercept(userId: string, message: string, sessionId: string): OnboardingInterceptResult {
    const user = UserModel.findById(userId);
    if (!user || user.onboarding_state !== 'pending') return { type: 'passthrough' };

    if (user.onboarding_current_step === 0) {
      if (isRealFirstMessage(message)) {
        // Se queda 'pending' — el frontend (plan 05) ofrece el wizard después
        // vía banner, una sola vez por sesión.
        return { type: 'passthrough' };
      }
      UserModel.updateOnboarding(userId, { step: 1, pendingMessage: message, pendingSessionId: sessionId });
      return getStepPayload(1, { suggestedDisplayName: user.username ?? undefined });
    }

    // Wizard ya en curso (reconexión o el usuario escribió en el chat en vez
    // de responder vía UI) — se retoma en el paso guardado. Si esto es una
    // reconexión real (el frontend siempre abre una sesión nueva al cargar,
    // ver chat.js initHeroView), sessionId ya no es el mismo donde se guardó
    // pending_message. Sin realinear, el mensaje pendiente y la bienvenida
    // final se persistirían en la sesión vieja (invisible) mientras el
    // usuario ve el wizard en la nueva — re-apuntamos pending_session_id a
    // donde el wizard es visible AHORA, así el cierre queda consistente.
    if (user.onboarding_pending_session_id !== sessionId) {
      UserModel.updateOnboarding(userId, { pendingSessionId: sessionId });
    }
    return getStepPayload(user.onboarding_current_step, { suggestedDisplayName: user.username ?? undefined });
  },

  async answer(userId: string, step: number, values: Record<string, unknown>): Promise<OnboardingAnswerResult> {
    const user = UserModel.findById(userId);
    const ctx = { suggestedDisplayName: user?.username ?? undefined };

    if (!user || user.onboarding_state !== 'pending' || user.onboarding_current_step === 0) {
      // Estado inconsistente (doble submit tras completar/skip) — no hay
      // paso al que volver; re-emitir el paso 1 es más seguro que crashear.
      return getStepPayload(1, ctx);
    }

    const currentStep = user.onboarding_current_step;
    if (step !== currentStep) {
      // Paso desincronizado — reemitir el guardado, no corromper el estado.
      return getStepPayload(currentStep, ctx);
    }

    const payload = getStepPayload(currentStep, ctx);
    const patch = resolveStepValues(payload, values);
    if (!patch) {
      return getStepPayload(currentStep, ctx, 'Elige una opción.');
    }

    UserProfileService.saveProfile(userId, patch);

    if (currentStep >= ONBOARDING_TOTAL_STEPS) {
      UserModel.updateOnboarding(userId, { state: 'completed', step: 0 });
      const profile = UserProfileService.getProfile(userId);
      const pendingMessage = user.onboarding_pending_message;
      const pendingSessionId = user.onboarding_pending_session_id;

      // El perfil ya quedó guardado arriba (lo importante) — si la única
      // llamada a IA de todo el wizard falla acá, no se debe perder el
      // mensaje pendiente ni dejar al usuario con un 500 sin respuesta.
      let welcome: string;
      try {
        welcome = await generateWelcome(profile, pendingMessage);
      } catch (err) {
        logger.warn('Falló la IA en el cierre del onboarding, cae a bienvenida genérica', { userId, error: (err as Error).message });
        welcome = profile?.displayName
          ? `¡Listo, ${profile.displayName}! Tu perfil quedó configurado. ¿En qué te ayudo?`
          : '¡Listo! Tu perfil quedó configurado. ¿En qué te ayudo?';
      }

      if (pendingSessionId) {
        if (pendingMessage) {
          persistence.saveUserMessageWithOutbox(userId, pendingSessionId, pendingMessage);
        }
        persistence.saveAssistantMessageWithOutbox(userId, pendingSessionId, welcome, config.models.chat);
      }
      UserModel.updateOnboarding(userId, { pendingMessage: null, pendingSessionId: null });

      logger.info('Onboarding completado', { userId, hadPendingMessage: !!pendingMessage });
      return { type: 'onboarding_complete', response: welcome, sessionId: pendingSessionId };
    }

    const nextStep = currentStep + 1;
    UserModel.updateOnboarding(userId, { step: nextStep });
    return getStepPayload(nextStep, ctx);
  },

  // Lectura sin efectos secundarios — para que el frontend retome el paso
  // guardado al recargar la página (el backend es la fuente de verdad,
  // el frontend no persiste nada). No dispara IA ni toca la fila del usuario.
  getState(userId: string): OnboardingStateResult {
    const user = UserModel.findById(userId);
    if (!user) return { state: 'pending', step: null };

    if (user.onboarding_state === 'pending' && user.onboarding_current_step > 0) {
      return {
        state: 'pending',
        step: getStepPayload(user.onboarding_current_step, { suggestedDisplayName: user.username ?? undefined }),
      };
    }
    return { state: user.onboarding_state, step: null };
  },

  skip(userId: string): OnboardingSkipResult {
    const user = UserModel.findById(userId);
    const pendingMessage = user?.onboarding_pending_message ?? null;
    const pendingSessionId = user?.onboarding_pending_session_id ?? null;

    UserModel.updateOnboarding(userId, { state: 'skipped', step: 0, pendingMessage: null, pendingSessionId: null });
    logger.info('Onboarding saltado', { userId, hadPendingMessage: !!pendingMessage });

    if (pendingMessage && pendingSessionId) {
      return { type: 'chat_passthrough', message: pendingMessage, sessionId: pendingSessionId };
    }
    return { type: 'onboarding_skipped' };
  },
};
