import { Router } from 'express';
import { getProfile, getSetupStatus, completeSetup, resetSetup, saveOnboardingHandler } from '../controllers/user.controller.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { setupSchema, onboardingSchema } from '../validators/user.js';

const router = Router();

router.use(authenticate);

router.get('/profile', getProfile);
router.get('/setup/status', getSetupStatus);
router.post('/setup', validate(setupSchema), completeSetup);
router.post('/setup/reset', resetSetup);
router.post('/onboarding/save', validate(onboardingSchema), saveOnboardingHandler);

export default router;
