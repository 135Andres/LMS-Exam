import { Router } from 'express';
import { sendChatMessageHandler, sendChatMessageStreamHandler, getChatHistoryHandler, getSessionsHandler, reportMessageHandler, archiveSessionHandler, unarchiveSessionHandler, deleteSessionHandler, getArchivedSessionsHandler, regenerateMessageStreamHandler, summarizeSessionHandler, pinMessageHandler, unpinMessageHandler, getPinnedMessagesHandler, renameSessionHandler, exportSessionHandler } from '../controllers/chat.controller.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { chatMessageSchema, regenerateSchema, summarySchema, exportSchema } from '../validators/chat.js';
import { AVAILABLE_MODELS } from '../config/models.js';

const router = Router();

router.use(authenticate);

router.post('/tutor', validate(chatMessageSchema), sendChatMessageHandler);
router.post('/tutor/stream', validate(chatMessageSchema), sendChatMessageStreamHandler);
router.post('/tutor/regenerate', validate(regenerateSchema), regenerateMessageStreamHandler);
router.post('/tutor/summary', validate(summarySchema), summarizeSessionHandler);
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
