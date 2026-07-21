import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';
import { validate } from '../middleware/validate.js';
import { contributeSchema, discardSchema, voteSchema, notificationsReadSchema, rejectSchema } from '../validators/knowledge.js';
import { KnowledgeModel } from '../models/knowledge.model.js';
import { knowledgeVoteModel } from '../models/knowledge-vote.model.js';
import { knowledgeContributionModel } from '../models/knowledge-contribution.model.js';
import { userKbStatsModel } from '../models/user-kb-stats.model.js';
import { knowledgeNotificationModel } from '../models/knowledge-notification.model.js';
import { KnowledgeEmbeddingModel } from '../models/knowledge-embedding.model.js';
import { generateEmbedding } from '../services/ai/embeddings.js';

const router = Router();

router.use(authenticate);

router.get('/items', async (req, res) => {
  const items = KnowledgeModel.search({
    query: req.query.query as string | undefined,
    subject: req.query.subject as string | undefined,
    topic: req.query.topic as string | undefined,
    verified_only: req.query.verified_only !== 'false',
    limit: parseInt(req.query.limit as string) || 20,
    offset: parseInt(req.query.offset as string) || 0,
  });
  res.json({ items });
});

router.get('/items/:id', async (req, res) => {
  const user = req.user!;
  const item = KnowledgeModel.getById(req.params.id);
  if (!item) return res.status(404).json({ error: 'No encontrado' });
  KnowledgeModel.incrementView(item.id);
  const userVote = knowledgeVoteModel.getUserVote(item.id, user.id);
  res.json({ item, userVote });
});

router.get('/suggestions', async (req, res) => {
  const user = req.user!;
  const drafts = KnowledgeModel.getDraftsByUser(user.id);
  res.json({ suggestions: drafts });
});

router.post('/contribute', validate(contributeSchema), async (req, res) => {
  const user = req.user!;
  const { knowledgeId, tags } = req.validatedBody as { knowledgeId: string; tags?: string[] };
  const draft = KnowledgeModel.getById(knowledgeId);
  if (!draft || draft.source_user_id !== user.id || draft.status !== 'draft') {
    return res.status(404).json({ error: 'Borrador no encontrado' });
  }

  KnowledgeModel.publish(knowledgeId, tags);
  
  try {
    const vector = await generateEmbedding(draft.content);
    KnowledgeEmbeddingModel.save(
      randomUUID(), knowledgeId,
      new Float32Array(vector), 'nvidia/nv-embed-v1', vector.length
    );
  } catch {
    // Embedding failure is not fatal — item is published, embedding can be generated later
  }

  knowledgeContributionModel.record({
    userId: user.id,
    knowledgeId,
    contributionType: 'created',
    points: 10,
  });

  const stats = userKbStatsModel.getForUser(user.id);
  if (stats.contributions_count === 1) {
    userKbStatsModel.addBadge(user.id, 'seed');
    knowledgeNotificationModel.queue({
      userId: user.id,
      type: 'badge_earned',
      knowledgeId,
      data: { badge: 'seed', emoji: '🌱', name: 'Semilla' },
    });
  }

  knowledgeNotificationModel.queue({
    userId: user.id,
    type: 'kb_published',
    knowledgeId,
    data: { points: 10 },
  });

  res.json({ success: true, knowledge: KnowledgeModel.getById(knowledgeId) });
});

router.post('/discard', validate(discardSchema), async (req, res) => {
  const user = req.user!;
  const { knowledgeId } = req.validatedBody as { knowledgeId: string };
  const deleted = KnowledgeModel.deleteDraft(knowledgeId, user.id);
  if (!deleted) return res.status(404).json({ error: 'No encontrado' });
  res.json({ success: true });
});

router.post('/vote', validate(voteSchema), async (req, res) => {
  const user = req.user!;
  const { knowledgeId, voteType } = req.validatedBody as { knowledgeId: string; voteType: 1 | -1 };

  const item = KnowledgeModel.getById(knowledgeId);
  if (!item) return res.status(404).json({ error: 'No encontrado' });

  // Block self-voting
  if (item.source_user_id === user.id) {
    return res.status(400).json({ error: 'No puedes votar tu propia contribución' });
  }

  knowledgeVoteModel.vote(knowledgeId, user.id, voteType);
  const counts = knowledgeVoteModel.countByKnowledge(knowledgeId);

  if (voteType === 1 && item.source_user_id && item.source_user_id !== user.id) {
    knowledgeContributionModel.record({
      userId: item.source_user_id,
      knowledgeId,
      contributionType: 'upvoted',
      points: 2,
    });
    userKbStatsModel.incrementUpvotesReceived(item.source_user_id);
  }

  res.json({ success: true, upvotes: counts.upvotes, downvotes: counts.downvotes });
});

router.get('/leaderboard', async (req, res) => {
  const limit = parseInt(req.query.limit as string) || 20;
  const leaders = userKbStatsModel.getLeaderboard(limit);
  res.json({ leaders });
});

router.get('/stats', async (req, res) => {
  const user = req.user!;
  const stats = userKbStatsModel.getForUser(user.id);
  res.json({ stats });
});

router.get('/notifications', async (req, res) => {
  const user = req.user!;
  const notifications = knowledgeNotificationModel.getUnread(user.id);
  res.json({ notifications });
});

router.post('/notifications/read', validate(notificationsReadSchema), async (req, res) => {
  const user = req.user!;
  const { all, id } = req.validatedBody as { all?: boolean; id?: string };
  if (all) {
    knowledgeNotificationModel.markAllRead(user.id);
  } else if (id) {
    knowledgeNotificationModel.markRead(id, user.id);
  }
  res.json({ success: true });
});

// Admin moderation
router.get('/admin/pending', authenticate, requireAdmin, async (_req, res) => {
  const pending = KnowledgeModel.getPendingReview(50, 0);
  res.json({ items: pending });
});

router.post('/admin/:id/verify', authenticate, requireAdmin, async (req, res) => {
  const admin = req.user!;
  const item = KnowledgeModel.getById(req.params.id as string);
  if (!item) return res.status(404).json({ error: 'No encontrado' });
  
  KnowledgeModel.verify(item.id, admin.id);
  
  if (item.source_user_id) {
    knowledgeContributionModel.record({
      userId: item.source_user_id,
      knowledgeId: item.id,
      contributionType: 'verified',
      points: 50,
    });
    knowledgeNotificationModel.queue({
      userId: item.source_user_id,
      type: 'kb_verified',
      knowledgeId: item.id,
      data: { points: 50 },
    });
  }
  
  res.json({ success: true, item: KnowledgeModel.getById(item.id) });
});

router.post('/admin/:id/reject', authenticate, requireAdmin, validate(rejectSchema), async (req, res) => {
  const item = KnowledgeModel.getById(req.params.id as string);
  if (!item) return res.status(404).json({ error: 'No encontrado' });
  
  KnowledgeModel.reject(item.id);
  
  if (item.source_user_id) {
    const { reason } = req.validatedBody as { reason?: string };
    knowledgeNotificationModel.queue({
      userId: item.source_user_id,
      type: 'kb_rejected',
      knowledgeId: item.id,
      data: { reason: reason || 'No cumple estándares de calidad' },
    });
  }
  
  res.json({ success: true });
});

router.delete('/admin/:id', authenticate, requireAdmin, async (req, res) => {
  const deleted = KnowledgeModel.deleteById(req.params.id as string);
  if (!deleted) return res.status(404).json({ error: 'No encontrado' });
  KnowledgeEmbeddingModel.deleteByKnowledgeId(req.params.id as string);
  res.json({ success: true });
});

export default router;
