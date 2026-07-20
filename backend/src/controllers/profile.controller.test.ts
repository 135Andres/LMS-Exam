import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const findByIdMock = vi.fn();
const updateOnboardingMock = vi.fn();
vi.mock('../models/user.model.js', () => ({
  UserModel: {
    findById: (...args: unknown[]) => findByIdMock(...args),
    updateOnboarding: (...args: unknown[]) => updateOnboardingMock(...args),
  },
}));

const getProfileMock = vi.fn();
const saveProfileMock = vi.fn();
vi.mock('../services/user-profile.service.js', () => ({
  UserProfileService: {
    getProfile: (...args: unknown[]) => getProfileMock(...args),
    saveProfile: (...args: unknown[]) => saveProfileMock(...args),
  },
}));

import { getProfileHandler, getProfileOptionsHandler, updateProfileHandler, restartWizardHandler } from './profile.controller.js';

function mockReqRes(body: Record<string, unknown> = {}) {
  const req = { validatedBody: body, user: { id: 'user-1' } } as unknown as Request;
  const res = {
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { req, res };
}

describe('profile.controller', () => {
  beforeEach(() => {
    findByIdMock.mockReset();
    updateOnboardingMock.mockReset();
    getProfileMock.mockReset();
    saveProfileMock.mockReset();
  });

  it('getProfileHandler devuelve el perfil y el estado de onboarding', async () => {
    findByIdMock.mockReturnValue({ onboarding_state: 'completed' });
    getProfileMock.mockReturnValue({ userId: 'user-1', depth: 'detallado' });

    const { req, res } = mockReqRes();
    await getProfileHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      profile: { userId: 'user-1', depth: 'detallado' },
      onboardingState: 'completed',
    });
  });

  it('getProfileHandler usa "pending" si el usuario no existe', async () => {
    findByIdMock.mockReturnValue(undefined);
    getProfileMock.mockReturnValue(null);

    const { req, res } = mockReqRes();
    await getProfileHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({ profile: null, onboardingState: 'pending' });
  });

  it('getProfileOptionsHandler devuelve las mismas opciones que el wizard', async () => {
    const { req, res } = mockReqRes();
    await getProfileOptionsHandler(req, res);

    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.levels.map((o: any) => o.value)).toEqual(['prepa', 'uni', 'posgrado', 'otro']);
    expect(payload.depths.map((o: any) => o.value)).toEqual(['breve', 'detallado', 'auto']);
    expect(payload.registers.map((o: any) => o.value)).toEqual(['tuteo', 'formal', 'neutro']);
    expect(payload.subjects.length).toBe(20); // 19 materias + "Otra…"
  });

  it('updateProfileHandler delega en saveProfile y devuelve el perfil actualizado', async () => {
    saveProfileMock.mockReturnValue({ userId: 'user-1', depth: 'detallado', version: 2 });

    const { req, res } = mockReqRes({ depth: 'detallado' });
    await updateProfileHandler(req, res);

    expect(saveProfileMock).toHaveBeenCalledWith('user-1', { depth: 'detallado' });
    expect(res.json).toHaveBeenCalledWith({ profile: { userId: 'user-1', depth: 'detallado', version: 2 } });
  });

  it('restartWizardHandler pone onboarding_state en pending y limpia el estado pendiente', async () => {
    const { req, res } = mockReqRes();
    await restartWizardHandler(req, res);

    expect(updateOnboardingMock).toHaveBeenCalledWith('user-1', {
      state: 'pending',
      step: 0,
      pendingMessage: null,
      pendingSessionId: null,
    });
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });
});
