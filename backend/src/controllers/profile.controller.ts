import type { Request, Response } from 'express';
import { UserModel } from '../models/user.model.js';
import { UserProfileService, type UserProfileInput } from '../services/user-profile.service.js';
import { getProfileFieldOptions } from '../prompts/onboarding.steps.js';
import { logger } from '../utils/logger.js';

// Settings → Perfil de estudio (plan 06) — mismos campos que el wizard,
// editables en cualquier momento post-onboarding.
export async function getProfileHandler(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;
  const user = UserModel.findById(userId);
  const profile = UserProfileService.getProfile(userId);

  res.json({
    profile,
    onboardingState: user?.onboarding_state ?? 'pending',
  });
}

// Mismas opciones que ve el wizard (onboarding.steps.ts) — fuente única,
// evita una lista de materias/niveles duplicada y desincronizable en el frontend.
export async function getProfileOptionsHandler(_req: Request, res: Response): Promise<void> {
  res.json(getProfileFieldOptions());
}

export async function updateProfileHandler(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;
  const patch = req.validatedBody as UserProfileInput;

  const profile = UserProfileService.saveProfile(userId, patch);
  logger.info('Perfil actualizado desde Settings', { userId, version: profile.version });

  res.json({ profile });
}

// "Iniciar configuración guiada" (usuarios skipped sin perfil) — única vía
// legítima de re-mostrar el wizard: vuelve a poner onboarding_state='pending',
// el chat lo recoge en el próximo mensaje corto (ver onboarding.service.ts).
export async function restartWizardHandler(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;
  UserModel.updateOnboarding(userId, { state: 'pending', step: 0, pendingMessage: null, pendingSessionId: null });
  logger.info('Wizard de onboarding re-disparado desde Settings', { userId });
  res.json({ success: true });
}
