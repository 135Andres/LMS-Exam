import { z } from 'zod';

const id = z.string().uuid();
export const createProjectSchema = z.object({ name: z.string().trim().min(1).max(100) });
export const updateProjectSchema = z.object({ name: z.string().trim().min(1).max(100) });
export const createFolderSchema = z.object({ name: z.string().trim().min(1).max(100), parentId: id.nullable().optional(), kind: z.enum(['normal', 'important']).default('normal'), isContentFolder: z.boolean().default(false), resourceScope: z.enum(['general', 'per_chat']).nullable().optional() }).superRefine((v, ctx) => { if (v.isContentFolder !== (v.resourceScope != null)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Las carpetas de contenido requieren resourceScope' }); });
export const updateFolderSchema = z.object({ name: z.string().trim().min(1).max(100).optional(), parentId: id.nullable().optional(), isContentFolder: z.boolean().optional(), resourceScope: z.enum(['general', 'per_chat']).nullable().optional() });
export const moveSessionSchema = z.object({ folderId: id });
