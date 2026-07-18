import { generateFromAI } from '../ai/index.js';
import { logger } from '../../utils/logger.js';
import { ChatModel } from '../../models/chat.model.js';
import { SessionSummaryService, type KnowledgeBlock } from '../session-summary.service.js';
import { segmentMessages, VERIFICABLE_MARKERS, type SegmentationResult } from './chat.segmentation.service.js';
import { extractBlocks } from './chat.block-extraction.service.js';
import { pickVerifierModel, verifyCompaction, type MissingContentItem } from './chat.compaction-verifier.service.js';
import { SYSTEM_PROMPT_NARRATIVE_COMPACTOR } from '../../prompts/system.js';
import { INKLING_MODEL_ID } from '../../config/models.js';

// Tope de pasadas de narrativa fallidas consecutivas (mismo rango) antes de
// forzar el avance del cursor sin narrativa actualizada — evita gastar IA
// (segmentación + narrativa + verificación) sin límite en un rango que nunca
// compacta con éxito. Los bloques del Paso 2 nunca se pierden de todos modos.
const MAX_NARRATIVE_FAILURES = 3;

// Umbral para compactación automática en segundo plano (además del disparador
// explícito por cambio de modelo, que siempre compacta sin importar cuántos
// mensajes nuevos haya).
const MIN_MESSAGES_TO_COMPACT = 6;

// El modelo activo de la sesión ya demostró que entiende el vocabulario y
// nivel específico del estudiante — compactar con un modelo distinto agrega
// una traducción innecesaria. Cuando la familia activa no tiene variante
// liviana propia, se usa Gemini Flash como compactador cross-familia.
const COMPACTION_MODEL_MAP: Record<string, string> = {
  'ag/gemini-3-flash': 'ag/gemini-3-flash',
  'ag/gemini-3.1-pro-low': 'ag/gemini-3-flash',
  'ag/claude-sonnet-4-6': 'ag/gemini-3-flash',
  'nvidia/z-ai/glm-5.2': 'nvidia/z-ai/glm-5.2',
  [INKLING_MODEL_ID]: INKLING_MODEL_ID,
  'oc/deepseek-v4-flash-free': 'oc/deepseek-v4-flash-free',
};

function resolveCompactionModel(sessionId: string): string {
  const lastModel = ChatModel.getLastAssistantModel(sessionId);
  if (lastModel && COMPACTION_MODEL_MAP[lastModel]) return COMPACTION_MODEL_MAP[lastModel];
  // Sesión nueva sin modelo previo aún — Inkling es el default del chat.
  return INKLING_MODEL_ID;
}

interface NarrativeMessage {
  id: string;
  role: string;
  content: string;
}

interface NarrativeResult {
  summary: string;
  confidence: 'high' | 'medium' | 'low';
}

const INITIAL_MAX_TOKENS = 3000;
const RETRY_MAX_TOKENS = 6000;

function buildNarrativePrompt(priorNarrative: string, narrativeMessages: NarrativeMessage[], blockRefs: string): string {
  const transcript = narrativeMessages.map(m => `[${m.role}] ${m.content}`).join('\n\n') || '(sin mensajes narrativos nuevos en esta pasada)';
  const blocksSection = blockRefs
    ? `\n\n--- Bloques de conocimiento ya extraídos (solo referencia, no repitas su contenido) ---\n${blockRefs}`
    : '';
  return `--- Resumen previo ---\n${priorNarrative}\n\n--- Mensajes nuevos (narrativo) ---\n${transcript}${blocksSection}`;
}

// Reintenta con más presupuesto de tokens si la primera respuesta viene
// truncada (misma lógica de Fase 1) — nunca se acepta una respuesta truncada
// ni sin "summary" como resultado final; se descarta el intento en vez de
// guardar una narrativa a medias.
async function runNarrativeCompaction(sessionId: string, userPrompt: string, model: string): Promise<NarrativeResult | null> {
  let result = await generateFromAI('nineRouter', SYSTEM_PROMPT_NARRATIVE_COMPACTOR, userPrompt, null, {
    model,
    temperature: 0.3,
    max_tokens: INITIAL_MAX_TOKENS,
  });

  if (result.finishReason === 'length') {
    logger.warn('Compactación truncada por max_tokens, reintentando con presupuesto mayor', { sessionId, model });
    result = await generateFromAI('nineRouter', SYSTEM_PROMPT_NARRATIVE_COMPACTOR, userPrompt, null, {
      model,
      temperature: 0.3,
      max_tokens: RETRY_MAX_TOKENS,
    });
  }

  if (result.finishReason === 'length') {
    logger.warn('Compactación sigue truncada tras reintento, se descarta este intento', { sessionId, model });
    return null;
  }

  try {
    const parsed = JSON.parse(result.content) as { summary?: string; confidence?: 'high' | 'medium' | 'low' };
    if (!parsed.summary) return null;
    return { summary: parsed.summary, confidence: parsed.confidence || 'high' };
  } catch (err) {
    logger.warn('Error parseando respuesta de compactación narrativa', { sessionId, model, error: (err as Error).message });
    return null;
  }
}

// Frases que la IA de compactación narrativa a veces usa para descartar todo
// el contenido de la pasada como "no hay nada verificable/académico".
const ABSENCE_MARKERS = [
  /no hay contenido (acad[eé]mico|relevante|verificable)/i,
  /nada (que destacar|relevante)/i,
  /sin contenido (acad[eé]mico|relevante|verificable)/i,
  /no se (encontr[oó]|identific[oó]) contenido/i,
];

// Contradicción mecánica (spec 5.2): la narrativa dice "no hay nada" pero
// newMessages sí trae marcadores verificables (código, LaTeX, explicación
// larga de asistente) — mismo umbral y regex que el heurístico de Task 2,
// reusados vía VERIFICABLE_MARKERS en vez de duplicarlos.
function hasAbsenceHallucination(summary: string, messages: NarrativeMessage[]): boolean {
  if (!ABSENCE_MARKERS.some(re => re.test(summary))) return false;
  return messages.some(m =>
    VERIFICABLE_MARKERS.some(re => re.test(m.content)) ||
    (m.role === 'assistant' && m.content.length > 400),
  );
}

// Agrega directo al texto de la narrativa el contenido que la verificación
// cruzada marcó como faltante — no hay cola de revisión separada (spec 4.4):
// lo que no está reflejado en narrativa ni bloques, se anexa así, nunca se
// descarta en silencio.
function appendMissingContent(narrative: string, missing: MissingContentItem[]): string {
  if (missing.length === 0) return narrative;
  const section = missing.map(m => `- ${m.description}`).join('\n');
  return `${narrative}\n\n--- Contenido detectado como faltante en verificación cruzada ---\n${section}`;
}

// Compacta lo nuevo desde el último corte (cursor) de una sesión en 4 pasos:
// 1) segmenta verificable/narrativo, 2) extrae bloques verbatim (persiste
// independiente de lo que pase después), 3) compacta la narrativa (excluye
// contenido verificable, solo lo referencia), 4) verifica cruzado con un
// modelo de otra familia y agrega directo lo que falte. El cursor de
// narrativa solo avanza si el paso 3 guardó con éxito.
export async function compactSession(sessionId: string, userId: string, force = false): Promise<void> {
  const cursor = ChatModel.getSummaryCursor(sessionId);
  const newMessages = ChatModel.getMessagesSince(sessionId, cursor)
    .filter(m => m.role === 'user' || m.role === 'assistant');

  if (newMessages.length === 0) return;
  if (!force && newMessages.length < MIN_MESSAGES_TO_COMPACT) return;

  const model = resolveCompactionModel(sessionId);

  try {
    // Paso 1 — Segmentación
    const segments: SegmentationResult[] = await segmentMessages(newMessages, model);

    // Chequeo de cobertura mecánico — sin esto no se avanza al paso 2.
    if (segments.length !== newMessages.length) {
      logger.warn('Segmentación incompleta, se aborta esta pasada', {
        sessionId, expected: newMessages.length, got: segments.length,
      });
      return; // no avanza cursor, se reintentará en la próxima pasada
    }

    // Paso 2 — Extracción de bloques verbatim. Siempre se ejecuta y persiste,
    // independiente de si el Paso 3 falla o trunca más adelante — esto es lo
    // que resuelve el stall permanente documentado como "ponytail" en Fase 1.
    // extractBlocks ya es idempotente por messageId, así que reintentar el
    // mismo rango (si el cursor no avanzó) no duplica bloques.
    const blocks: KnowledgeBlock[] = await extractBlocks(sessionId, newMessages, segments, model, userId);

    // Paso 3 — Compactación narrativa (reusa retry/finishReason de Fase 1),
    // el prompt excluye contenido verificable — solo lo referencia por bloque.
    const narrativeMessages = newMessages.filter(
      m => segments.find(s => s.messageId === m.id)?.class === 'narrativo',
    );
    const priorNarrative = SessionSummaryService.getNarrative(sessionId) || '(sin resumen previo, es el inicio de la conversación)';
    const blockRefs = blocks.map(b => `- ${b.id}: "${b.title}"`).join('\n');
    const userPrompt = buildNarrativePrompt(priorNarrative, narrativeMessages, blockRefs);

    let narrativeResult = await runNarrativeCompaction(sessionId, userPrompt, model);

    // Chequeo mecánico de "alucinación de ausencia" (spec 5.2) — un solo
    // reintento, sin gastar otra llamada de verificación separada; el
    // reintento mismo es la corrección.
    if (narrativeResult && hasAbsenceHallucination(narrativeResult.summary, newMessages)) {
      logger.warn('Narrativa reporta ausencia de contenido pero newMessages trae marcadores verificables, reintentando', { sessionId, model });
      narrativeResult = await runNarrativeCompaction(sessionId, userPrompt, model);
      if (narrativeResult && hasAbsenceHallucination(narrativeResult.summary, newMessages)) {
        logger.warn('Alucinación de ausencia persiste tras reintento, se descarta este intento', { sessionId, model });
        narrativeResult = null;
      }
    }

    if (!narrativeResult) {
      // Los bloques del Paso 2 ya quedaron guardados. Por defecto el cursor NO
      // avanza para que estos mismos mensajes se reintenten en la narrativa la
      // próxima pasada — pero si esto ya falló MAX_NARRATIVE_FAILURES veces
      // seguidas sobre el mismo rango, dejar de reintentar para siempre y
      // forzar el avance: la narrativa queda desactualizada esta pasada, pero
      // nunca se pierde contenido (los bloques ya están a salvo) y el
      // pipeline no se queda gastando IA sin límite.
      const failureCount = SessionSummaryService.recordNarrativeFailure(sessionId);
      if (failureCount >= MAX_NARRATIVE_FAILURES) {
        logger.warn('Narrativa falló repetidamente, se fuerza el avance del cursor sin actualizarla — revisar sesión manualmente', {
          sessionId, model, failureCount,
        });
        ChatModel.setSummaryCursor(sessionId, newMessages[newMessages.length - 1].created_at);
        return;
      }
      logger.warn('Narrativa truncada o inválida tras reintento, bloques ya persistidos, narrativa pendiente', { sessionId, model, failureCount });
      return;
    }

    // Paso 4 — Verificación cruzada OBLIGATORIA, sin excepción por presupuesto.
    const verifierModel = pickVerifierModel(model);
    const verification = await verifyCompaction(newMessages, narrativeResult.summary, blocks, verifierModel);
    const finalNarrative = appendMissingContent(narrativeResult.summary, verification.missing);

    SessionSummaryService.saveNarrative(sessionId, finalNarrative, { model, confidence: narrativeResult.confidence });
    SessionSummaryService.resetNarrativeFailureCount(sessionId);
    ChatModel.setSummaryCursor(sessionId, newMessages[newMessages.length - 1].created_at);

    logger.info('Sesión compactada (dos pistas)', {
      sessionId, model, messagesCompacted: newMessages.length,
      blocksExtracted: blocks.length, verificationGaps: verification.missing.length,
    });
  } catch (err) {
    logger.warn('Error compactando sesión', { sessionId, model, error: (err as Error).message });
  }
}
