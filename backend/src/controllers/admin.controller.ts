import type { Request, Response } from 'express';
import { UserModel } from '../models/user.model.js';
import { ExamModel } from '../models/exam.model.js';
import { UsageModel } from '../models/usage.model.js';

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
