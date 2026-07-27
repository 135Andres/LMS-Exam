import { Router } from 'express';
import { getProfileHandler, getProfileOptionsHandler, updateProfileHandler, restartWizardHandler, resetProfileHandler } from '../controllers/profile.controller.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { updateProfileSchema } from '../validators/profile.js';

const router = Router();

router.use(authenticate);

router.get('/', getProfileHandler);
router.get('/options', getProfileOptionsHandler);
router.put('/', validate(updateProfileSchema), updateProfileHandler);
router.post('/restart-wizard', restartWizardHandler);
router.post('/reset', resetProfileHandler);

export default router;
