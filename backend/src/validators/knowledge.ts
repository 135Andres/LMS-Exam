import { z } from 'zod';

const uuidString = z.string().uuid();

export const contributeSchema = z.object({
  knowledgeId: uuidString,
  tags: z.array(z.string()).optional(),
});

export const discardSchema = z.object({
  knowledgeId: uuidString,
});

export const voteSchema = z.object({
  knowledgeId: uuidString,
  voteType: z.union([z.literal(1), z.literal(-1)]),
});

export const notificationsReadSchema = z.object({
  all: z.boolean().optional(),
  id: uuidString.optional(),
});

export const rejectSchema = z.object({
  reason: z.string().optional(),
});
