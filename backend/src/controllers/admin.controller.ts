import type { Request, Response } from 'express';
import { UserModel } from '../models/user.model.js';
import { ExamModel } from '../models/exam.model.js';
import { UsageModel } from '../models/usage.model.js';
import { UserProfileService } from '../services/user-profile.service.js';
import { SessionSummaryService } from '../services/session-summary.service.js';
import { ChatModel } from '../models/chat.model.js';

export function listUsers(_req: Request, res: Response): void {
  const users = UserModel.listAll();
  res.json({ users });
}

export function listExams(_req: Request, res: Response): void {
  const exams = ExamModel.findAll();
  res.json({ exams });
}

export function getUsage(_req: Request, res: Response): void {
  const totals = UsageModel.getAllTotals();
  const recent = UsageModel.getRecent(50);
  res.json({ totals, recent });
}

export function getUserProfile(req: Request, res: Response): void {
  const userId = req.params.userId as string;
  const profile = UserProfileService.getProfile(userId);
  res.json({ profile });
}

export function getUserSessions(req: Request, res: Response): void {
  const userId = req.params.userId as string;
  const active = ChatModel.getUserSessions(userId, false);
  const archived = ChatModel.getUserSessions(userId, true);
  res.json({ active, archived });
}

export function getSessionDetail(req: Request, res: Response): void {
  const sessionId = req.params.sessionId as string;
  res.json({
    messages: ChatModel.getSessionMessages(sessionId, 200),
    narrative: SessionSummaryService.getNarrative(sessionId),
    blocks: SessionSummaryService.getBlocks(sessionId),
    index: SessionSummaryService.getIndex(sessionId),
  });
}
