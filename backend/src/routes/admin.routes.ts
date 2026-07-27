import { Router } from 'express';
import { listUsers, listExams, getUsage, getUserProfile, getUserSessions, getSessionDetail } from '../controllers/admin.controller.js';
import { authenticate } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';

const router = Router();

router.use(authenticate, requireAdmin);

router.get('/users', listUsers);
router.get('/users/:userId/profile', getUserProfile);
router.get('/users/:userId/sessions', getUserSessions);
router.get('/sessions/:sessionId/detail', getSessionDetail);
router.get('/exams', listExams);
router.get('/usage', getUsage);

export default router;
