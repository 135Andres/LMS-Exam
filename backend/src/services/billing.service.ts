import { UsageModel } from '../models/usage.model.js';
import { UserModel } from '../models/user.model.js';
import { v4 as uuidv4 } from 'uuid';
import type { AIResponse } from '../types/db.js';

export function recordUsage(
  userId: string,
  examId: string,
  provider: string,
  model: string,
  usage: AIResponse['usage'],
  cost: number,
): void {
  UsageModel.create({
    id: uuidv4(),
    userId,
    examId,
    provider,
    model,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    cost,
  });

  UserModel.incrementExamsGenerated(userId, cost);
}
