import { Router } from 'express';
import { listUsers, listExams, getUsage } from '../controllers/admin.controller.js';
import { authenticate } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';

const router = Router();

router.use(authenticate, requireAdmin);

router.get('/users', listUsers);
router.get('/exams', listExams);
router.get('/usage', getUsage);

export default router;
