import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { sendChatMessage, sendChatMessageStream, regenerateChatMessageStream } from '../services/chat.service.js';
import { compactSession } from '../services/chat/chat.compaction.service.js';
import { exportSessionMarkdown, SessionForbiddenError, SessionNotFoundError } from '../services/chat/chat.export.service.js';
import { AiRetryError } from '../services/ai/index.js';
import { SessionSummaryService } from '../services/session-summary.service.js';
import { ChatModel } from '../models/chat.model.js';
import { logger } from '../utils/logger.js';
import type { Attachment } from '../validators/chat.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { resolveQuiz } from '../services/chat/chat.quiz.service.js';
import { ChatQuizModeService } from '../services/chat/chat.quiz-mode.service.js';
import { ChatPersistenceService } from '../services/chat/chat.persistence.service.js';
import { OnboardingService } from '../services/onboarding.service.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const reportsDir = join(__dirname, '..', 'data');
const reportsFile = join(reportsDir, 'reports.json');
const persistence = new ChatPersistenceService();

// No hay preview/fetch de enlaces (fetchLinkPreview nunca se implementó en el
// frontend) — se le pasan las URLs a la IA como texto para que las tenga en
// contexto, no como adjunto multimodal real.
function appendLinks(message: string, links?: string[]): string {
  if (!links || links.length === 0) return message;
  return `${message}\n\nEnlaces adjuntos:\n${links.map(l => `- ${l}`).join('\n')}`;
}

// El cliente puede desconectarse (cambia de chat, cierra la pestaña, navega)
// mientras la IA sigue generando — la generación y el guardado en DB deben
// continuar en segundo plano de todas formas. Escribir en un socket muerto
// dispara un evento 'error' sin listener, que tumba TODO el proceso Node
// (no solo esta petición); este guard evita escribir tras la desconexión y
// nunca deja un 'error' sin manejar.
function guardStreamResponse(res: Response): (data: string) => void {
  let closed = false;
  res.on('close', () => { closed = true; });
  res.on('error', () => { closed = true; });
  return (data: string) => {
    if (closed) return;
    try {
      res.write(data);
    } catch {
      closed = true;
    }
  };
}

export async function sendChatMessageHandler(req: Request, res: Response): Promise<void> {
  const { message, modelId, attachments, links, sessionId } = req.validatedBody as {
    message: string;
    modelId?: string;
    attachments?: Attachment[];
    links?: string[];
    sessionId?: string;
  };

  const userId = req.user!.id;
  const sid = sessionId || randomUUID();

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
    linksCount: links?.length || 0,
    sessionId: sid,
  });

  // Plan 04 — antes de llamar a la IA: si el wizard de personalización está
  // pendiente para este usuario, intercepta y devuelve el paso en vez de
  // generar una respuesta (cero llamadas a IA durante los pasos).
  const interception = OnboardingService.intercept(userId, message, sid);
  if (interception.type !== 'passthrough') {
    res.json(interception);
    return;
  }

  const result = await sendChatMessage(appendLinks(message, links), modelId, attachments, userId, sid);

  res.json({ response: result.response, sessionId: sid });
}

export async function sendChatMessageStreamHandler(req: Request, res: Response): Promise<void> {
  const { message, modelId, attachments, links, sessionId } = req.validatedBody as {
    message: string;
    modelId?: string;
    attachments?: Attachment[];
    links?: string[];
    sessionId?: string;
  };

  const userId = req.user!.id;
  const sid = sessionId || randomUUID();

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
    linksCount: links?.length || 0,
    sessionId: sid,
  });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const write = guardStreamResponse(res);

  // Enviar sessionId como primer evento para que el frontend lo capture
  write(`data: ${JSON.stringify({ sessionId: sid })}\n\n`);

  // Plan 04 — mismo interceptor que el endpoint sin streaming, pero emitido
  // como único evento SSE seguido de [DONE] para no romper el parseo del cliente.
  const interception = OnboardingService.intercept(userId, message, sid);
  if (interception.type !== 'passthrough') {
    write(`data: ${JSON.stringify(interception)}\n\n`);
    write('data: [DONE]\n\n');
    res.end();
    return;
  }

  try {
    const stream = await sendChatMessageStream(appendLinks(message, links), modelId, attachments, userId, sid);
    for await (const chunk of stream) {
      if (chunk.type === 'reasoning') {
        write(`data: ${JSON.stringify({ reasoning: chunk.content })}\n\n`);
      } else if (chunk.type === 'done') {
        write(`data: ${JSON.stringify({ done: true, msgId: chunk.msgId, userMsgId: chunk.userMsgId, quizGoal: chunk.quizGoal })}\n\n`);
      } else {
        write(`data: ${JSON.stringify({ content: chunk.content })}\n\n`);
      }
    }
    write('data: [DONE]\n\n');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error desconocido';
    logger.error('Error en chat streaming', { error: msg });
    write(`data: ${JSON.stringify({ error: msg })}\n\n`);
    write('data: [DONE]\n\n');
  } finally {
    try { res.end(); } catch { /* socket ya cerrado */ }
  }
}

export async function regenerateMessageStreamHandler(req: Request, res: Response): Promise<void> {
  const { sessionId, modelId, instruction } = req.validatedBody as {
    sessionId: string; modelId?: string; instruction?: string;
  };
  const userId = req.user!.id;

  try {
    ChatModel.assertSessionOwnership(sessionId, userId);
  } catch {
    res.status(403).json({ error: 'No tienes acceso a esta sesión' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const write = guardStreamResponse(res);

  try {
    const stream = await regenerateChatMessageStream(sessionId, modelId, userId, instruction);
    for await (const chunk of stream) {
      if (chunk.type === 'reasoning') {
        write(`data: ${JSON.stringify({ reasoning: chunk.content })}\n\n`);
      } else if (chunk.type === 'done') {
        write(`data: ${JSON.stringify({ done: true, msgId: chunk.msgId, userMsgId: chunk.userMsgId, quizGoal: chunk.quizGoal })}\n\n`);
      } else {
        write(`data: ${JSON.stringify({ content: chunk.content })}\n\n`);
      }
    }
    write('data: [DONE]\n\n');
  } catch (err: unknown) {
    const isNotLast = err instanceof Error && err.message === 'NOT_LAST_EXCHANGE';
    const msg = isNotLast
      ? 'Solo puedes regenerar la última respuesta de la conversación.'
      : (err instanceof Error ? err.message : 'Error desconocido');
    logger.error('Error en regenerate', { error: msg });
    write(`data: ${JSON.stringify({ error: msg })}\n\n`);
    write('data: [DONE]\n\n');
  } finally {
    try { res.end(); } catch { /* socket ya cerrado */ }
  }
}

// Comando /resumen (/resume) — fuerza una compactación ya (sin esperar el
// umbral de fondo) y devuelve el resumen resultante.
export async function summarizeSessionHandler(req: Request, res: Response): Promise<void> {
  const { sessionId } = req.validatedBody as { sessionId: string };
  const userId = req.user!.id;

  try {
    ChatModel.assertSessionOwnership(sessionId, userId);
  } catch {
    res.status(403).json({ error: 'No tienes acceso a esta sesión' });
    return;
  }

  const outcome = await compactSession(sessionId, userId, true);
  if (outcome.status !== 'compacted' && outcome.status !== 'skipped_no_new_messages') {
    logger.warn('Comando /resumen no pudo compactar', { sessionId, userId, outcome });
  }
  const summary = SessionSummaryService.getNarrative(sessionId);
  const blocks = SessionSummaryService.getBlocks(sessionId).map(b => ({
    id: b.id,
    title: b.title,
    subject: b.subject,
  })); // solo metadata liviana — el contenido completo del bloque no se manda acá,
       // eso es para cuando exista la vista de detalle (Fase 4)

  res.json({ summary, blocks });
}

// Comando /exportar (/export) — descarga la conversación sintetizada como
// documento Markdown (los modelos detrás de 9router no generan PDF real,
// ver chat.export.service.ts).
export async function exportSessionHandler(req: Request, res: Response): Promise<void> {
  const { sessionId } = req.validatedBody as { sessionId: string };
  const userId = req.user!.id;

  try {
    const markdown = await exportSessionMarkdown(sessionId, userId);
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="chat-export.md"');
    res.send(markdown);
  } catch (err) {
    if (err instanceof SessionForbiddenError) { res.status(403).json({ error: err.message }); return; }
    if (err instanceof SessionNotFoundError) { res.status(404).json({ error: err.message }); return; }
    if (err instanceof AiRetryError) { res.status(502).json({ error: 'No se pudo generar el export: ' + err.message }); return; }
    logger.error('Error exportando sesión', { sessionId, error: (err as Error).message });
    res.status(500).json({ error: 'Error interno al exportar' });
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
    id: randomUUID(),
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

function requireOwnedSession(sessionId: string, userId: string, res: Response): boolean {
  try {
    ChatModel.assertSessionOwnership(sessionId, userId);
  } catch {
    res.status(403).json({ error: 'No tienes acceso a esta sesión' });
    return false;
  }
  if (!ChatModel.sessionExists(sessionId)) {
    res.status(404).json({ error: 'Sesión no encontrada' });
    return false;
  }
  return true;
}

export async function pinMessageHandler(req: Request, res: Response): Promise<void> {
  const { messageId } = req.body as { messageId: string };
  const userId = req.user!.id;
  if (!messageId) { res.status(400).json({ error: 'messageId requerido' }); return; }
  ChatModel.pinMessage(messageId, userId);
  res.json({ success: true });
}

export async function unpinMessageHandler(req: Request, res: Response): Promise<void> {
  const { messageId } = req.body as { messageId: string };
  const userId = req.user!.id;
  if (!messageId) { res.status(400).json({ error: 'messageId requerido' }); return; }
  ChatModel.unpinMessage(messageId, userId);
  res.json({ success: true });
}

export async function getPinnedMessagesHandler(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;
  const messages = ChatModel.getPinnedMessages(userId);
  res.json({ messages });
}

export async function archiveSessionHandler(req: Request, res: Response): Promise<void> {
  const { sessionId } = req.body as { sessionId: string };
  const userId = req.user!.id;
  if (!sessionId) { res.status(400).json({ error: 'sessionId requerido' }); return; }
  if (!requireOwnedSession(sessionId, userId, res)) return;
  ChatModel.archiveSession(sessionId, userId);
  res.json({ success: true });
}

export async function unarchiveSessionHandler(req: Request, res: Response): Promise<void> {
  const { sessionId } = req.body as { sessionId: string };
  const userId = req.user!.id;
  if (!sessionId) { res.status(400).json({ error: 'sessionId requerido' }); return; }
  if (!requireOwnedSession(sessionId, userId, res)) return;
  ChatModel.unarchiveSession(sessionId, userId);
  res.json({ success: true });
}

export async function renameSessionHandler(req: Request, res: Response): Promise<void> {
  const { sessionId, title } = req.body as { sessionId: string; title: string };
  const userId = req.user!.id;
  if (!sessionId) { res.status(400).json({ error: 'sessionId requerido' }); return; }
  const trimmed = (title || '').trim().slice(0, 100);
  if (!trimmed) { res.status(400).json({ error: 'title requerido' }); return; }
  // A diferencia de archive/delete, renombrar debe funcionar también para un
  // chat recién creado en el frontend que todavía no mandó su primer mensaje
  // (sessionId generado pero sin fila en chat_sessions todavía).
  ChatModel.ensureSession(sessionId, userId);
  if (!requireOwnedSession(sessionId, userId, res)) return;
  ChatModel.renameSession(sessionId, userId, trimmed);
  res.json({ success: true, title: trimmed });
}

export async function deleteSessionHandler(req: Request, res: Response): Promise<void> {
  const { sessionId } = req.body as { sessionId: string };
  const userId = req.user!.id;
  if (!sessionId) { res.status(400).json({ error: 'sessionId requerido' }); return; }
  if (!requireOwnedSession(sessionId, userId, res)) return;
  ChatModel.deleteSession(sessionId, userId);
  ChatQuizModeService.deactivate(sessionId);
  res.json({ success: true });
}

export async function getArchivedSessionsHandler(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;
  const sessions = ChatModel.getUserSessions(userId, true);
  res.json({ sessions });
}

export async function resolveQuizHandler(req: Request, res: Response): Promise<void> {
  const { sessionId, userMsgId } = req.validatedBody as { sessionId: string; userMsgId: string };
  const userId = req.user!.id;

  try {
    ChatModel.assertSessionOwnership(sessionId, userId);
  } catch {
    res.status(403).json({ error: 'No tienes acceso a esta sesión' });
    return;
  }

  const original = ChatModel.getMessageById(userMsgId, userId);
  if (!original) {
    res.status(404).json({ error: 'Mensaje original no encontrado' });
    return;
  }

  logger.info('Resolviendo cuestionario', { sessionId, userMsgId });

  try {
    const response = await resolveQuiz(original.content);
    persistence.saveAssistantMessageWithOutbox(userId, sessionId, response);
    res.json({ response });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error desconocido';
    logger.error('Error resolviendo cuestionario', { sessionId, userMsgId, error: msg });
    res.status(500).json({ error: 'Error interno al resolver el cuestionario' });
  }
}

export async function startQuizExplainHandler(req: Request, res: Response): Promise<void> {
  const { sessionId } = req.validatedBody as { sessionId: string };
  const userId = req.user!.id;

  try {
    ChatModel.assertSessionOwnership(sessionId, userId);
  } catch {
    res.status(403).json({ error: 'No tienes acceso a esta sesión' });
    return;
  }

  ChatQuizModeService.activate(sessionId);
  res.json({ success: true });
}

export async function endQuizExplainHandler(req: Request, res: Response): Promise<void> {
  const { sessionId } = req.validatedBody as { sessionId: string };
  const userId = req.user!.id;

  try {
    ChatModel.assertSessionOwnership(sessionId, userId);
  } catch {
    res.status(403).json({ error: 'No tienes acceso a esta sesión' });
    return;
  }

  ChatQuizModeService.deactivate(sessionId);
  res.json({ success: true });
}

// Plan 05 — lectura sin efectos secundarios, para que el frontend sepa al
// cargar la página si debe retomar un paso guardado o mostrar el banner
// diferido (primer mensaje fue un cuestionario/largo, wizard nunca inició).
export async function onboardingStateHandler(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;
  const result = OnboardingService.getState(userId);
  res.json(result);
}

// Plan 04 — cliente → servidor: { type: 'onboarding_answer', step, values }
export async function onboardingAnswerHandler(req: Request, res: Response): Promise<void> {
  const { step, values } = req.validatedBody as { step: number; values: Record<string, unknown> };
  const userId = req.user!.id;

  const result = await OnboardingService.answer(userId, step, values);
  res.json(result);
}

// Plan 04 — cliente → servidor: { type: 'onboarding_skip' }. Si había un
// mensaje pendiente, se responde por el canal normal de chat (sin wizard).
export async function onboardingSkipHandler(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;

  const result = OnboardingService.skip(userId);
  if (result.type === 'chat_passthrough') {
    const aiResult = await sendChatMessage(result.message, undefined, undefined, userId, result.sessionId);
    res.json({ response: aiResult.response, sessionId: result.sessionId });
    return;
  }
  res.json(result);
}
