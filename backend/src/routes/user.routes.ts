import { Router } from 'express';
import { getProfile, getSetupStatus, completeSetup, resetSetup, getDashboardSummary, updateUsername, getSettings, updateSettings, updateAvatar, importMemory } from '../controllers/user.controller.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { setupSchema, usernameSchema, settingsSchema, avatarSchema, memoryImportSchema } from '../validators/user.js';

const router = Router();

router.use(authenticate);

router.get('/profile', getProfile);
router.get('/dashboard-summary', getDashboardSummary);
router.get('/setup/status', getSetupStatus);
router.post('/setup', validate(setupSchema), completeSetup);
router.post('/setup/reset', resetSetup);
router.patch('/username', validate(usernameSchema), updateUsername);
router.get('/settings', getSettings);
router.patch('/settings', validate(settingsSchema), updateSettings);
router.patch('/avatar', validate(avatarSchema), updateAvatar);
router.post('/memory-import', validate(memoryImportSchema), importMemory);

export default router;
