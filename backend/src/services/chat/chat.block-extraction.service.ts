// backend/src/services/chat/chat.block-extraction.service.ts
import { randomUUID } from 'node:crypto';
import { generateFromAI } from '../ai/index.js';
import { SUBJECT_KEYWORDS, detectSubjectByKeywords } from '../../utils/subject-keywords.js';
import { SessionSummaryService, type KnowledgeBlock } from '../session-summary.service.js';
import { KnowledgeModel, hashKnowledgeContent } from '../../models/knowledge.model.js';
import { UserProfileService } from '../user-profile.service.js';
import { logger } from '../../utils/logger.js';
import { repairBackslashEscapes } from '../../utils/json-repair.js';
import type { SegmentationResult } from './chat.segmentation.service.js';

const VALID_SUBJECTS = [...Object.keys(SUBJECT_KEYWORDS), 'general'];

export interface ExtractableMessage {
  id: string;
  content: string;
  role: string;
}

// Muletillas conversacionales conocidas al inicio del mensaje — se recortan,
// el resto del contenido queda verbatim (spec: no reformular).
const LEADING_FILLERS = [
  /^claro,?\s*(que\s*s[ií])?,?\s*te\s*explico:?\s*/i,
  /^por\s*supuesto,?\s*/i,
  /^entendido,?\s*/i,
  /^ok,?\s*/i,
];

function trimLeadingFillers(content: string): string {
  let result = content.trim();
  for (const re of LEADING_FILLERS) {
    result = result.replace(re, '');
  }
  return result.trim();
}

const SYSTEM_PROMPT_TITLES_BATCH = `Genera un título corto (máximo 8 palabras) para cada uno de los siguientes fragmentos de contenido académico. Responde con un título por fragmento, en el mismo orden, identificado por su id. Para los fragmentos marcados con "(requiere materia)", además clasifica la materia usando exactamente uno de estos valores: ${VALID_SUBJECTS.join(', ')}.`;

interface TitleBatchItem {
  id: string;
  title: string;
  subject?: string;
}

interface TitleBatchResult {
  title: string;
  subject?: string;
}

// Una sola llamada de IA para todos los títulos pendientes de la pasada,
// nunca una por bloque (mismo patrón que classifyBatch en
// chat.segmentation.service.ts). Se le pide materia solo para los ítems
// donde la heurística (Tarea 1) no vino segura — no se le pide reclasificar
// lo que ya se resolvió con confianza. Ante fallo total de la IA, cada ítem
// cae al fallback (título truncado, sin materia — el caller usa la
// heurística en ese caso).
async function generateTitlesAndSubjectsBatch(
  items: Array<{ id: string; content: string; needsSubject: boolean }>,
  model: string,
): Promise<Record<string, TitleBatchResult>> {
  if (items.length === 0) return {};

  const userPrompt = items
    .map(i => `(id: ${i.id}${i.needsSubject ? ', requiere materia' : ''})\n${i.content}`)
    .join('\n\n---\n\n');

  try {
    const result = await generateFromAI('nineRouter', SYSTEM_PROMPT_TITLES_BATCH, userPrompt, {
      type: 'json_object',
      json_schema: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                subject: { type: 'string' },
              },
              required: ['id', 'title'],
            },
          },
        },
        required: ['items'],
      },
    }, { model, temperature: 0.3, max_tokens: 800 });

    const parsed = JSON.parse(repairBackslashEscapes(result.content)) as { items?: TitleBatchItem[] };
    const byId = new Map((parsed.items || []).map(t => [t.id, t]));

    const out: Record<string, TitleBatchResult> = {};
    for (const item of items) {
      const found = byId.get(item.id);
      const subject = item.needsSubject && found?.subject && VALID_SUBJECTS.includes(found.subject)
        ? found.subject
        : undefined;
      out[item.id] = { title: found?.title || item.content.slice(0, 60).trim(), subject };
    }
    return out;
  } catch (err) {
    logger.warn('Error en batch de títulos/materia de bloques, se usa fallback', { error: (err as Error).message });
    const out: Record<string, TitleBatchResult> = {};
    for (const item of items) out[item.id] = { title: item.content.slice(0, 60).trim() };
    return out;
  }
}

const MIN_CONTENT_LENGTH_FOR_KB = 40;

// Mismo filtrado que el pipeline monolítico de Fase 1 (chat.compaction.service.ts):
// contenido demasiado corto o duplicado por hash no llega a la KB colectiva.
// Solo bloques con confianza high|medium son candidatos (spec Fase 2).
function maybeAddToCollectiveKB(block: KnowledgeBlock, userId?: string): void {
  if (block.confidence === 'low') return;
  if (!userId) return;
  if (block.content.trim().length < MIN_CONTENT_LENGTH_FOR_KB) return;
  if (KnowledgeModel.existsByHash(hashKnowledgeContent(block.content))) return;

  KnowledgeModel.create({
    id: randomUUID(),
    content: block.content,
    summary: block.title,
    subject: block.subject,
    source_type: 'session_compaction',
    source_user_id: userId,
    tags: ['auto-detectado', 'compactacion'],
    status: 'pending_review',
  });
}

// Extracción verbatim: convierte segmentos 'verificable' en KnowledgeBlock
// inmutables, casi-verbatim del mensaje original. La única llamada de IA es
// para el título — nunca reescribe el contenido. Idempotente: si ya existe
// un bloque para ese messageId (compactSession puede reintentar el mismo
// rango de mensajes tras un fallo posterior en el pipeline), se salta.
export async function extractBlocks(
  sessionId: string,
  messages: ExtractableMessage[],
  segments: SegmentationResult[],
  model: string,
  userId?: string,
): Promise<KnowledgeBlock[]> {
  const verificable = segments.filter(s => s.class === 'verificable');
  if (verificable.length === 0) return [];

  const existingBlocks = SessionSummaryService.getBlocks(sessionId);
  const alreadyExtracted = new Set(existingBlocks.flatMap(b => b.extractedFromMessages));

  const pending = verificable
    .filter(seg => !alreadyExtracted.has(seg.messageId))
    .map(seg => ({ seg, msg: messages.find(m => m.id === seg.messageId) }))
    .filter((x): x is { seg: SegmentationResult; msg: ExtractableMessage } => !!x.msg);

  if (pending.length === 0) return [];

  // Mismo boost del clasificador de chat (plan 07) — fuente unificada
  // (detectSubjectByKeywords), así routing y block-extraction razonan igual.
  const boostSubjects = userId ? UserProfileService.getProfile(userId)?.subjects : undefined;
  const heuristics = new Map(pending.map(({ msg }) => [msg.id, detectSubjectByKeywords(msg.content, boostSubjects)]));

  const results = await generateTitlesAndSubjectsBatch(
    pending.map(({ msg }) => ({
      id: msg.id,
      content: msg.content,
      needsSubject: heuristics.get(msg.id)!.confidence !== 'high',
    })),
    model,
  );

  const blocks: KnowledgeBlock[] = [];
  for (const { seg, msg } of pending) {
    const content = trimLeadingFillers(msg.content);
    const heuristic = heuristics.get(msg.id)!;
    const subject = heuristic.confidence === 'high'
      ? (heuristic.subject as string)
      : (results[msg.id]?.subject || heuristic.subject || 'general');

    const block = SessionSummaryService.addBlock(sessionId, {
      subject,
      extractedFromMessages: [msg.id],
      extractedAt: new Date().toISOString(),
      extractionModel: model,
      confidence: seg.confidence,
      title: results[msg.id]?.title ?? msg.content.slice(0, 60).trim(),
      content,
    });
    blocks.push(block);

    maybeAddToCollectiveKB(block, userId);
  }

  return blocks;
}
