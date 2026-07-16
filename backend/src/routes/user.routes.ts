import { Router } from 'express';
import { getProfile, getSetupStatus, completeSetup, resetSetup, getDashboardSummary, updateUsername } from '../controllers/user.controller.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { setupSchema, usernameSchema } from '../validators/user.js';

const router = Router();

router.use(authenticate);

router.get('/profile', getProfile);
router.get('/dashboard-summary', getDashboardSummary);
router.get('/setup/status', getSetupStatus);
router.post('/setup', validate(setupSchema), completeSetup);
router.post('/setup/reset', resetSetup);
router.patch('/username', validate(usernameSchema), updateUsername);

export default router;
