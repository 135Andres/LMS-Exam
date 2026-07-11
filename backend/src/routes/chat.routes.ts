import { Router } from 'express';
import { sendChatMessageHandler, sendChatMessageStreamHandler, getChatHistoryHandler, getSessionsHandler, reportMessageHandler, archiveSessionHandler, unarchiveSessionHandler, deleteSessionHandler, getArchivedSessionsHandler } from '../controllers/chat.controller.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { chatMessageSchema } from '../validators/chat.js';
import { fetchAvailableModels } from '../services/ai/nineRouter.js';

const router = Router();

router.use(authenticate);

router.post('/tutor', validate(chatMessageSchema), sendChatMessageHandler);
router.post('/tutor/stream', validate(chatMessageSchema), sendChatMessageStreamHandler);
router.get('/tutor/history', getChatHistoryHandler);
router.get('/tutor/sessions', getSessionsHandler);
router.post('/report', reportMessageHandler);
router.post('/archive', archiveSessionHandler);
router.post('/unarchive', unarchiveSessionHandler);
router.post('/delete', deleteSessionHandler);
router.get('/sessions/archived', getArchivedSessionsHandler);

router.get('/models', async (_req, res) => {
  const models = await fetchAvailableModels();
  res.json({
    models: models.map(m => ({
      id: m.id,
      label: m.label,
      model: m.id,
      multimodal: m.id.includes('nemotron') || m.id.includes('gemma') || m.id.includes('multimodal'),
      contextLength: 128000,
    })),
  });
});

export default router;
