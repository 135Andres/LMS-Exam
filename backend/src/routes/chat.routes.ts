import { Router } from 'express';
import { sendChatMessageHandler, sendChatMessageStreamHandler, getChatHistoryHandler, getSessionsHandler, reportMessageHandler, archiveSessionHandler, unarchiveSessionHandler, deleteSessionHandler, getArchivedSessionsHandler } from '../controllers/chat.controller.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { chatMessageSchema } from '../validators/chat.js';
import { modelRegistry } from '../config/index.js';

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

router.get('/models', (_req, res) => {
  const models = Object.entries(modelRegistry).map(([id, entry]) => ({
    id,
    label: entry.label,
    model: entry.model,
    multimodal: !!entry.multimodal,
    contextLength: entry.contextLength || 128000,
  }));
  res.json({ models });
});

export default router;
