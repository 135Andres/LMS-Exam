import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./ai/index.js', () => ({
  generateFromAI: vi.fn().mockResolvedValue({
    content: '¡Bienvenido, Andrés! Vamos con tu pregunta.',
    usage: { promptTokens: 10, completionTokens: 10 },
  }),
}));

import { OnboardingService, isRealFirstMessage } from './onboarding.service.js';
import { generateFromAI } from './ai/index.js';
import { UserProfileService } from './user-profile.service.js';
import { getTestDb, resetDb } from '../../test/setup.js';

const USER_A = 'user-a';
const SESSION_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function createUser(id = USER_A, username: string | null = 'andres99') {
  getTestDb().prepare('INSERT INTO users (id, email, username) VALUES (?, ?, ?)').run(id, `${id}@test.com`, username);
}

function userRow(id = USER_A) {
  return getTestDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
}

describe('isRealFirstMessage', () => {
  it('mensaje corto y sin cuestionario → false', () => {
    expect(isRealFirstMessage('hola, cómo estás')).toBe(false);
  });

  it('mensaje de más de 300 caracteres → true', () => {
    expect(isRealFirstMessage('a'.repeat(301))).toBe(true);
  });

  it('bloque de cuestionario (2+ líneas numeradas) → true', () => {
    expect(isRealFirstMessage('1. ¿Qué es una derivada?\n2. Calcula la integral de x')).toBe(true);
  });

  it('una sola línea numerada no cuenta como cuestionario', () => {
    expect(isRealFirstMessage('1. hola')).toBe(false);
  });
});

describe('OnboardingService', () => {
  beforeEach(() => {
    resetDb();
    vi.clearAllMocks();
    createUser();
  });

  it('usuario completed nunca recibe onboarding_step', () => {
    getTestDb().prepare("UPDATE users SET onboarding_state = 'completed' WHERE id = ?").run(USER_A);
    const result = OnboardingService.intercept(USER_A, 'hola', SESSION_A);
    expect(result.type).toBe('passthrough');
  });

  it('usuario skipped nunca recibe onboarding_step', () => {
    getTestDb().prepare("UPDATE users SET onboarding_state = 'skipped' WHERE id = ?").run(USER_A);
    const result = OnboardingService.intercept(USER_A, 'hola', SESSION_A);
    expect(result.type).toBe('passthrough');
  });

  it('primer mensaje largo NO dispara el wizard (se queda pending, step 0)', () => {
    const result = OnboardingService.intercept(USER_A, 'a'.repeat(301), SESSION_A);
    expect(result.type).toBe('passthrough');
    const row = userRow();
    expect(row.onboarding_state).toBe('pending');
    expect(row.onboarding_current_step).toBe(0);
  });

  it('primer mensaje tipo cuestionario NO dispara el wizard', () => {
    const result = OnboardingService.intercept(USER_A, '1. pregunta uno\n2. pregunta dos', SESSION_A);
    expect(result.type).toBe('passthrough');
    expect(userRow().onboarding_current_step).toBe(0);
  });

  it('primer mensaje corto dispara el wizard en el paso 1, prellenado con el username', () => {
    const result = OnboardingService.intercept(USER_A, 'hola', SESSION_A) as any;
    expect(result.type).toBe('onboarding_step');
    expect(result.step).toBe(1);
    expect(result.total).toBe(5);
    expect(result.inputs[0].id).toBe('display_name');
    expect(result.inputs[0].options[0].value).toBe('andres99');

    const row = userRow();
    expect(row.onboarding_current_step).toBe(1);
    expect(row.onboarding_pending_message).toBe('hola');
    expect(row.onboarding_pending_session_id).toBe(SESSION_A);
  });

  it('reconexión a mitad del wizard reemite el paso guardado sin tocar el mensaje pendiente', async () => {
    OnboardingService.intercept(USER_A, 'hola', SESSION_A);
    await OnboardingService.answer(USER_A, 1, { display_name: 'Andrés' });

    const result = OnboardingService.intercept(USER_A, 'sigo aquí', SESSION_A) as any;
    expect(result.type).toBe('onboarding_step');
    expect(result.step).toBe(2);

    const row = userRow();
    expect(row.onboarding_pending_message).toBe('hola'); // no se pisó con "sigo aquí"
  });

  it('reconexión con sessionId distinto (reload real) realinea pending_session_id a la sesión visible', async () => {
    const SESSION_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    OnboardingService.intercept(USER_A, 'hola', SESSION_A);
    await OnboardingService.answer(USER_A, 1, { display_name: 'Andrés' });

    // El frontend siempre abre una sesión nueva al recargar — simula eso.
    const result = OnboardingService.intercept(USER_A, 'sigo aquí', SESSION_B) as any;
    expect(result.type).toBe('onboarding_step');
    expect(result.step).toBe(2);
    expect(userRow().onboarding_pending_session_id).toBe(SESSION_B);

    // Al completar, la bienvenida se guarda en la sesión donde el usuario
    // realmente está viendo el wizard (B), no en la vieja e invisible (A).
    await OnboardingService.answer(USER_A, 2, { level: 'uni', field: 'Ingeniería' });
    await OnboardingService.answer(USER_A, 3, { subjects: ['matematicas'] });
    await OnboardingService.answer(USER_A, 4, { goal: 'examenes' });
    const final = await OnboardingService.answer(USER_A, 5, { depth: 'detallado', register: 'formal' }) as any;
    expect(final.sessionId).toBe(SESSION_B);

    const messagesInB = getTestDb().prepare(
      "SELECT role FROM chat_logs WHERE session_id = ? ORDER BY created_at ASC"
    ).all(SESSION_B);
    expect(messagesInB).toHaveLength(2);
    const messagesInA = getTestDb().prepare(
      "SELECT role FROM chat_logs WHERE session_id = ?"
    ).all(SESSION_A);
    expect(messagesInA).toHaveLength(0);
  });

  it('máquina de pasos completa: pending → 5 respuestas → completed, perfil correcto en BD', async () => {
    OnboardingService.intercept(USER_A, 'hola', SESSION_A);

    const step2 = await OnboardingService.answer(USER_A, 1, { display_name: 'Andrés' }) as any;
    expect(step2.step).toBe(2);

    const step3 = await OnboardingService.answer(USER_A, 2, { level: 'uni', field: 'Ingeniería' }) as any;
    expect(step3.step).toBe(3);

    const step4 = await OnboardingService.answer(USER_A, 3, { subjects: ['matematicas', 'fisica'] }) as any;
    expect(step4.step).toBe(4);

    const step5 = await OnboardingService.answer(USER_A, 4, { goal: 'examenes' }) as any;
    expect(step5.step).toBe(5);

    const final = await OnboardingService.answer(USER_A, 5, { depth: 'detallado', register: 'formal' }) as any;
    expect(final.type).toBe('onboarding_complete');
    expect(final.sessionId).toBe(SESSION_A);
    expect(final.response).toContain('Bienvenido');

    expect(generateFromAI).toHaveBeenCalledTimes(1);

    const row = userRow();
    expect(row.onboarding_state).toBe('completed');
    expect(row.onboarding_current_step).toBe(0);
    expect(row.onboarding_pending_message).toBeNull();

    const profile = UserProfileService.getProfile(USER_A);
    expect(profile).not.toBeNull();
    expect(profile!.displayName).toBe('Andrés');
    expect(profile!.level).toBe('uni');
    expect(profile!.field).toBe('Ingeniería');
    expect(profile!.subjects).toEqual(['matematicas', 'fisica']);
    expect(profile!.goal).toBe('examenes');
    expect(profile!.depth).toBe('detallado');
    expect(profile!.register).toBe('formal');

    const messages = getTestDb().prepare(
      "SELECT role, content FROM chat_logs WHERE session_id = ? ORDER BY created_at ASC"
    ).all(SESSION_A) as Array<{ role: string; content: string }>;
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ role: 'user', content: 'hola' });
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].content).toContain('Bienvenido');
  });

  it('si la IA falla en el cierre, no revienta: perfil queda guardado y cae a una bienvenida genérica', async () => {
    (generateFromAI as any).mockRejectedValueOnce(new Error('AI down'));

    OnboardingService.intercept(USER_A, 'hola', SESSION_A);
    await OnboardingService.answer(USER_A, 1, { display_name: 'Andrés' });
    await OnboardingService.answer(USER_A, 2, { level: 'uni', field: 'Ingeniería' });
    await OnboardingService.answer(USER_A, 3, { subjects: ['matematicas'] });
    await OnboardingService.answer(USER_A, 4, { goal: 'examenes' });
    const final = await OnboardingService.answer(USER_A, 5, { depth: 'detallado', register: 'formal' }) as any;

    expect(final.type).toBe('onboarding_complete');
    expect(final.response).toContain('Andrés');
    expect(final.sessionId).toBe(SESSION_A);

    const row = userRow();
    expect(row.onboarding_state).toBe('completed');
    expect(row.onboarding_pending_message).toBeNull();
    expect(row.onboarding_pending_session_id).toBeNull();

    const profile = UserProfileService.getProfile(USER_A);
    expect(profile!.depth).toBe('detallado'); // el perfil se guarda igual, pase lo que pase con la IA

    const messages = getTestDb().prepare(
      "SELECT role, content FROM chat_logs WHERE session_id = ? ORDER BY created_at ASC"
    ).all(SESSION_A) as Array<{ role: string; content: string }>;
    expect(messages).toHaveLength(2);
    expect(messages[1].content).toContain('Andrés');
  });

  it('skip en el paso 3 → skipped + responde el mensaje pendiente por el canal normal', async () => {
    OnboardingService.intercept(USER_A, 'hola', SESSION_A);
    await OnboardingService.answer(USER_A, 1, { display_name: 'Andrés' });
    await OnboardingService.answer(USER_A, 2, { level: 'uni', field: 'Ingeniería' });

    const result = OnboardingService.skip(USER_A);
    expect(result).toEqual({ type: 'chat_passthrough', message: 'hola', sessionId: SESSION_A });

    const row = userRow();
    expect(row.onboarding_state).toBe('skipped');
    expect(row.onboarding_current_step).toBe(0);
    expect(row.onboarding_pending_message).toBeNull();
    expect(row.onboarding_pending_session_id).toBeNull();
  });

  it('skip sin mensaje pendiente (usuario nunca escribió) → onboarding_skipped', () => {
    getTestDb().prepare("UPDATE users SET onboarding_state = 'pending', onboarding_current_step = 1 WHERE id = ?").run(USER_A);
    const result = OnboardingService.skip(USER_A);
    expect(result).toEqual({ type: 'onboarding_skipped' });
  });

  it('answer inválido re-emite el paso con nota, no corrompe el estado', async () => {
    OnboardingService.intercept(USER_A, 'hola', SESSION_A);

    const result = await OnboardingService.answer(USER_A, 1, { display_name: '' }) as any;
    expect(result.type).toBe('onboarding_step');
    expect(result.step).toBe(1);
    expect(result.note).toBeTruthy();

    const row = userRow();
    expect(row.onboarding_current_step).toBe(1); // no avanzó
    expect(row.onboarding_state).toBe('pending');
  });

  it('single de chips con valor que no matchea ninguna opción → re-emite el paso', async () => {
    OnboardingService.intercept(USER_A, 'hola', SESSION_A);
    await OnboardingService.answer(USER_A, 1, { display_name: 'Andrés' });

    const result = await OnboardingService.answer(USER_A, 2, { level: 'xyz-no-existe', field: 'Ingeniería' }) as any;
    expect(result.type).toBe('onboarding_step');
    expect(result.step).toBe(2);
    expect(userRow().onboarding_current_step).toBe(2);
  });

  it('paso desincronizado (step distinto al guardado) reemite el paso guardado sin avanzar', async () => {
    OnboardingService.intercept(USER_A, 'hola', SESSION_A);
    const result = await OnboardingService.answer(USER_A, 3, { subjects: ['matematicas'] }) as any;
    expect(result.type).toBe('onboarding_step');
    expect(result.step).toBe(1);
  });

  it('getState: usuario sin wizard iniciado (step 0) → pending sin step', () => {
    expect(OnboardingService.getState(USER_A)).toEqual({ state: 'pending', step: null });
  });

  it('getState: wizard en curso → pending con el payload del paso guardado', () => {
    OnboardingService.intercept(USER_A, 'hola', SESSION_A);
    const result = OnboardingService.getState(USER_A) as any;
    expect(result.state).toBe('pending');
    expect(result.step.step).toBe(1);
  });

  it('getState: completed/skipped → sin step', () => {
    getTestDb().prepare("UPDATE users SET onboarding_state = 'completed', onboarding_current_step = 0 WHERE id = ?").run(USER_A);
    expect(OnboardingService.getState(USER_A)).toEqual({ state: 'completed', step: null });
  });

  it('respuesta en texto libre sobre chips matchea por contains (lowercase)', async () => {
    OnboardingService.intercept(USER_A, 'hola', SESSION_A);
    await OnboardingService.answer(USER_A, 1, { display_name: 'Andrés' });

    const result = await OnboardingService.answer(USER_A, 2, { level: 'universidad, ing en sistemas', field: 'ingenieria' }) as any;
    expect(result.step).toBe(3);

    const profile = UserProfileService.getProfile(USER_A);
    expect(profile!.level).toBe('uni');
  });
});
