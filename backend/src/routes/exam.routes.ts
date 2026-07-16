import { Router } from 'express';
import {
  getExams,
  getPublicExams,
  getExamById,
  updateExam,
  deleteExam,
  generateExamHandler,
  suggestSubtopicsHandler,
  saveQuestions,
  publishExam,
  unpublishExam,
  sendPolishMessage,
  getPolishMessagesHandler,
} from '../controllers/exam.controller.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { generateLimiter } from '../middleware/rateLimiter.js';
import {
  generateSchema,
  suggestSchema,
  updateExamSchema,
  saveQuestionsSchema,
  polishMessageSchema,
} from '../validators/exam.js';

const router = Router();

router.use(authenticate);

router.get('/', getExams);
router.get('/public', getPublicExams);
router.post('/suggest', validate(suggestSchema), suggestSubtopicsHandler);
router.post('/generate', generateLimiter, validate(generateSchema), generateExamHandler);
router.get('/:id', getExamById);
router.put('/:id', validate(updateExamSchema), updateExam);
router.put('/:id/questions', validate(saveQuestionsSchema), saveQuestions);
router.post('/:id/publish', publishExam);
router.post('/:id/unpublish', unpublishExam);
router.post('/:id/polish/message', validate(polishMessageSchema), sendPolishMessage);
router.get('/:id/polish/messages', getPolishMessagesHandler);
router.delete('/:id', deleteExam);

export default router;
