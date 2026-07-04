import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ChatModel } from '../models/chat.model.js';
import { ProfileService } from '../services/profile.service.js';
import { generateFromAI } from './ai/index.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USERS_DIR = path.resolve(__dirname, '../../../users');
const PROMPT = 'Actúa como un Analista de Aprendizaje. Te proporcionaré el Perfil Actual en Markdown de un alumno y la transcripción de sus últimos chats. Tu tarea es devolverme un NUEVO archivo Markdown actualizado. Reglas estrictas: 1) Deja INTACTA la sección de \'PREFERENCIAS FIJAS\'. 2) Actualiza las secciones de \'ESTADO DE CONOCIMIENTO\' e \'HISTORIAL DE COMPORTAMIENTO\' agregando lo que aprendió, lo que falló o cómo se comportó en este chat. Sé conciso, usa viñetas y mantén el archivo corto para no saturar el contexto del tutor principal. Devuelve SOLO el Markdown limpio.';

function userProfilePath(userId: string): string {
  return path.join(USERS_DIR, `${userId}.md`);
}

function formatChatTranscript(messages: { role: string; content: string }[]): string {
  return messages
    .slice()
    .reverse()
    .map(m => `[${m.role === 'user' ? 'Alumno' : 'Tutor'}]\n${m.content}`)
    .join('\n\n');
}

export async function updateProfileForUser(userId: string): Promise<boolean> {
  const profilePath = userProfilePath(userId);

  if (!fs.existsSync(profilePath)) {
    logger.debug('Profile update: sin perfil aún', { userId });
    return false;
  }

  const currentProfile = fs.readFileSync(profilePath, 'utf-8').trim();
  if (!currentProfile) return false;

  const recentMessages = ChatModel.getRecentMessages(userId, 50);
  if (recentMessages.length < 2) {
    logger.debug('Profile update: pocos mensajes para actualizar', { userId, count: recentMessages.length });
    return false;
  }

  const transcript = formatChatTranscript(recentMessages);
  const userPrompt = `--- Perfil Actual ---\n${currentProfile}\n\n--- Últimos Chats ---\n${transcript}\n---`;

  try {
    const result = await generateFromAI('nvidia', PROMPT, userPrompt, null, {
      model: config.models.chat,
      temperature: 0.3,
      max_tokens: 2048,
    });

    const newProfile = result.content.trim();
    if (!newProfile) return false;

    fs.writeFileSync(profilePath, newProfile, 'utf-8');
    ProfileService.saveProfile(userId, newProfile);

    logger.info('Perfil actualizado por cron', { userId, bytes: Buffer.byteLength(newProfile, 'utf-8') });
    return true;
  } catch (err) {
    logger.warn('Error actualizando perfil por cron', { userId, error: (err as Error).message });
    return false;
  }
}
