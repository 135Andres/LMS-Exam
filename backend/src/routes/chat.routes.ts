import { Router } from 'express';
import { sendChatMessageHandler, sendChatMessageStreamHandler, getChatHistoryHandler, getSessionsHandler, reportMessageHandler, archiveSessionHandler, unarchiveSessionHandler, deleteSessionHandler, getArchivedSessionsHandler, regenerateMessageStreamHandler, summarizeSessionHandler, getSessionSummaryHandler, updateSessionSummaryHandler, pinMessageHandler, unpinMessageHandler, getPinnedMessagesHandler, renameSessionHandler, exportSessionHandler, resolveQuizHandler, startQuizExplainHandler, endQuizExplainHandler, onboardingAnswerHandler, onboardingSkipHandler, onboardingStateHandler } from '../controllers/chat.controller.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { chatMessageSchema, regenerateSchema, summarySchema, summaryUpdateSchema, exportSchema, quizResolveSchema, quizExplainSchema, onboardingAnswerSchema } from '../validators/chat.js';
import { AVAILABLE_MODELS } from '../config/models.js';

const router = Router();

router.use(authenticate);

router.post('/tutor', validate(chatMessageSchema), sendChatMessageHandler);
router.post('/tutor/stream', validate(chatMessageSchema), sendChatMessageStreamHandler);
router.post('/tutor/regenerate', validate(regenerateSchema), regenerateMessageStreamHandler);
router.post('/tutor/summary', validate(summarySchema), summarizeSessionHandler);
router.get('/summary', getSessionSummaryHandler);
router.put('/summary', validate(summaryUpdateSchema), updateSessionSummaryHandler);
router.post('/tutor/quiz/resolve', validate(quizResolveSchema), resolveQuizHandler);
router.post('/tutor/quiz/explain-start', validate(quizExplainSchema), startQuizExplainHandler);
router.post('/tutor/quiz/explain-end', validate(quizExplainSchema), endQuizExplainHandler);
router.post('/tutor/onboarding/answer', validate(onboardingAnswerSchema), onboardingAnswerHandler);
router.post('/tutor/onboarding/skip', onboardingSkipHandler);
router.get('/tutor/onboarding/state', onboardingStateHandler);
router.post('/export', validate(exportSchema), exportSessionHandler);
router.get('/tutor/history', getChatHistoryHandler);
router.get('/tutor/sessions', getSessionsHandler);
router.post('/report', reportMessageHandler);
router.post('/archive', archiveSessionHandler);
router.post('/unarchive', unarchiveSessionHandler);
router.post('/delete', deleteSessionHandler);
router.post('/rename', renameSessionHandler);
router.get('/sessions/archived', getArchivedSessionsHandler);
router.post('/pin', pinMessageHandler);
router.post('/unpin', unpinMessageHandler);
router.get('/pinned', getPinnedMessagesHandler);

router.get('/models', (_req, res) => {
  res.json({
    models: AVAILABLE_MODELS.map(m => ({
      id: m.id,
      label: m.label,
      model: m.id,
      multimodal: m.multimodal,
      contextLength: 128000,
    })),
  });
});

export default router;
