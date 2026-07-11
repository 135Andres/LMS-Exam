import type { Request, Response } from 'express';
import { sendChatMessage, sendChatMessageStream } from '../services/chat.service.js';
import { ChatModel } from '../models/chat.model.js';
import { logger } from '../utils/logger.js';
import type { Attachment } from '../validators/chat.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const reportsDir = join(__dirname, '..', 'data');
const reportsFile = join(reportsDir, 'reports.json');

export async function sendChatMessageHandler(req: Request, res: Response): Promise<void> {
  const { message, modelId, attachments, sessionId } = req.validatedBody as {
    message: string;
    modelId?: string;
    attachments?: Attachment[];
    sessionId?: string;
  };

  const userId = req.user!.id;
  const sid = sessionId || crypto.randomUUID();

  if (sessionId) {
    try {
      ChatModel.assertSessionOwnership(sid, userId);
    } catch {
      res.status(403).json({ error: 'No tienes acceso a esta sesión' });
      return;
    }
  }

  logger.info('Petición de chat', {
    userId,
    messageLength: message.length,
    modelId: modelId || 'default',
    attachmentsCount: attachments?.length || 0,
    sessionId: sid,
  });

  const result = await sendChatMessage(message, modelId, attachments, userId, sid);

  res.json({ response: result.response, sessionId: sid });
}

export async function sendChatMessageStreamHandler(req: Request, res: Response): Promise<void> {
  const { message, modelId, attachments, sessionId } = req.validatedBody as {
    message: string;
    modelId?: string;
    attachments?: Attachment[];
    sessionId?: string;
  };

  const userId = req.user!.id;
  const sid = sessionId || crypto.randomUUID();

  if (sessionId) {
    try {
      ChatModel.assertSessionOwnership(sid, userId);
    } catch {
      res.status(403).json({ error: 'No tienes acceso a esta sesión' });
      return;
    }
  }

  logger.info('Petición de chat streaming', {
    userId,
    messageLength: message.length,
    modelId: modelId || 'default',
    attachmentsCount: attachments?.length || 0,
    sessionId: sid,
  });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // Enviar sessionId como primer evento para que el frontend lo capture
  res.write(`data: ${JSON.stringify({ sessionId: sid })}\n\n`);

  try {
    const stream = await sendChatMessageStream(message, modelId, attachments, userId, sid);
    for await (const chunk of stream) {
      if (chunk.type === 'reasoning') {
        res.write(`data: ${JSON.stringify({ reasoning: chunk.content })}\n\n`);
      } else {
        res.write(`data: ${JSON.stringify({ content: chunk.content })}\n\n`);
      }
    }
    res.write('data: [DONE]\n\n');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error desconocido';
    logger.error('Error en chat streaming', { error: msg });
    res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
    res.write('data: [DONE]\n\n');
  } finally {
    res.end();
  }
}

export async function getChatHistoryHandler(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  const reqSessionId = req.query.session_id as string | undefined;

  let sessionId: string | null;

  if (reqSessionId) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reqSessionId)) {
      res.status(400).json({ error: 'session_id inválido' });
      return;
    }
    try {
      ChatModel.assertSessionOwnership(reqSessionId, userId);
    } catch {
      res.status(403).json({ error: 'No tienes acceso a esta sesión' });
      return;
    }
    sessionId = reqSessionId;
  } else {
    sessionId = ChatModel.getLastSessionId(userId);
  }

  if (!sessionId) {
    res.json({ messages: [], sessionId: null });
    return;
  }

  const messages = ChatModel.getSessionMessages(sessionId, limit);

  res.json({ messages, sessionId });
}

export async function getSessionsHandler(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;
  const sessions = ChatModel.getUserSessions(userId);
  res.json({ sessions });
}

export async function reportMessageHandler(req: Request, res: Response): Promise<void> {
  const { aiMessage, userPrompt, sessionId } = req.body as { aiMessage: string; userPrompt: string; sessionId: string };
  const userId = req.user!.id;

  if (!aiMessage) {
    res.status(400).json({ error: 'aiMessage es requerido' });
    return;
  }

  if (!existsSync(reportsDir)) {
    mkdirSync(reportsDir, { recursive: true });
  }

  let reports: any[] = [];
  if (existsSync(reportsFile)) {
    try {
      reports = JSON.parse(readFileSync(reportsFile, 'utf8'));
    } catch {}
  }

  reports.push({
    id: crypto.randomUUID(),
    userId,
    sessionId: sessionId || null,
    aiMessage: aiMessage.slice(0, 2000),
    userPrompt: userPrompt?.slice(0, 2000) || '',
    timestamp: new Date().toISOString(),
  });

  writeFileSync(reportsFile, JSON.stringify(reports, null, 2));

  logger.info('Mensaje reportado', { userId, sessionId });
  res.json({ success: true });
}

export async function archiveSessionHandler(req: Request, res: Response): Promise<void> {
  const { sessionId } = req.body as { sessionId: string };
  const userId = req.user!.id;
  if (!sessionId) { res.status(400).json({ error: 'sessionId requerido' }); return; }
  ChatModel.archiveSession(sessionId, userId);
  res.json({ success: true });
}

export async function unarchiveSessionHandler(req: Request, res: Response): Promise<void> {
  const { sessionId } = req.body as { sessionId: string };
  const userId = req.user!.id;
  if (!sessionId) { res.status(400).json({ error: 'sessionId requerido' }); return; }
  ChatModel.unarchiveSession(sessionId, userId);
  res.json({ success: true });
}

export async function deleteSessionHandler(req: Request, res: Response): Promise<void> {
  const { sessionId } = req.body as { sessionId: string };
  const userId = req.user!.id;
  if (!sessionId) { res.status(400).json({ error: 'sessionId requerido' }); return; }
  ChatModel.deleteSession(sessionId, userId);
  res.json({ success: true });
}

export async function getArchivedSessionsHandler(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;
  const sessions = ChatModel.getUserSessions(userId, true);
  res.json({ sessions });
}
