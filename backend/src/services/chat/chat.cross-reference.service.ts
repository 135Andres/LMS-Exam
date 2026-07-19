import { generateFromAI } from '../ai/index.js';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { ChatModel } from '../../models/chat.model.js';
import { SessionSummaryService } from '../session-summary.service.js';
import { compactSession } from './chat.compaction.service.js';
import { SYSTEM_PROMPT_CROSS_CHAT_MATCH } from '../../prompts/system.js';

// El modelo NO lee otros chats por defecto — solo cuando el mensaje del
// estudiante ya suena a que está pidiendo referenciar otra conversación
// ("añade el de X", "el chat de Y", "mis chats", etc.). Es un filtro barato
// para no gastar una llamada extra a la IA en cada mensaje normal.
// ponytail: heurística de palabras clave, no cubre toda frase posible —
// si se necesita más cobertura, ampliar esta lista.
const CROSS_CHAT_TRIGGER_RE = /\b(otro chat|otra conversaci[oó]n|otra sesi[oó]n|mis chats|todos mis chats|el chat de|la conversaci[oó]n de|el chat sobre|a[ñn]ade el de|incluye el de|agrega el de|combina (con|el)|junta (con|el)|revisa mi (otro )?chat|busca en mis chats)\b/i;

const MAX_CANDIDATE_SESSIONS = 30;

export function mightReferenceOtherChat(message: string): boolean {
  return CROSS_CHAT_TRIGGER_RE.test(message);
}

// Devuelve un bloque de texto listo para inyectar en el system prompt con el
// resumen de los otros chats que el estudiante mencionó, o '' si no aplica /
// no se encontró ninguno. Solo se debe llamar cuando mightReferenceOtherChat
// ya dio true — evita el costo de esta clasificación en mensajes normales.
export async function buildCrossChatContext(message: string, userId: string, currentSessionId: string): Promise<string> {
  const candidates = ChatModel.getUserSessions(userId)
    .filter(s => s.session_id !== currentSessionId)
    .slice(0, MAX_CANDIDATE_SESSIONS);

  if (candidates.length === 0) return '';

  const list = candidates
    .map(s => `- id:${s.session_id} título:"${(s.title || s.preview || 'sin título').slice(0, 80)}"`)
    .join('\n');
  const userPrompt = `Mensaje del estudiante: "${message}"\n\nOtros chats disponibles:\n${list}`;

  let sessionIds: string[] = [];
  try {
    const result = await generateFromAI('nineRouter', SYSTEM_PROMPT_CROSS_CHAT_MATCH, userPrompt, null, {
      model: config.models.insights,
      temperature: 0,
      max_tokens: 500,
    });
    const parsed = JSON.parse(result.content) as { sessionIds?: string[] };
    sessionIds = (parsed.sessionIds || []).filter(id => candidates.some(c => c.session_id === id));
  } catch (err) {
    logger.warn('Clasificación cross-chat falló', { error: (err as Error).message });
    return '';
  }

  if (sessionIds.length === 0) return '';

  const blocks: string[] = [];
  for (const sessionId of sessionIds) {
    let summary = SessionSummaryService.getNarrative(sessionId);
    if (!summary) {
      await compactSession(sessionId, userId, true);
      summary = SessionSummaryService.getNarrative(sessionId);
    }
    if (!summary) continue;
    const meta = candidates.find(c => c.session_id === sessionId);
    blocks.push(`\n\n--- Otro chat que el estudiante mencionó ("${meta?.title || meta?.preview || 'sin título'}") ---\n${summary}\n---`);
  }

  return blocks.join('');
}
