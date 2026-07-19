// backend/src/services/chat/chat.block-extraction.service.ts
import { randomUUID } from 'node:crypto';
import { generateFromAI } from '../ai/index.js';
import { detectSubjectExtended } from './chat.classifier.service.js';
import { SessionSummaryService, type KnowledgeBlock } from '../session-summary.service.js';
import { KnowledgeModel, hashKnowledgeContent } from '../../models/knowledge.model.js';
import { logger } from '../../utils/logger.js';
import type { SegmentationResult } from './chat.segmentation.service.js';

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

const SYSTEM_PROMPT_TITLES_BATCH = 'Genera un título corto (máximo 8 palabras) para cada uno de los siguientes fragmentos de contenido académico. Responde con un título por fragmento, en el mismo orden, identificado por su id.';

interface TitleBatchItem {
  id: string;
  title: string;
}

// Una sola llamada de IA para todos los títulos pendientes de la pasada,
// nunca una por bloque (mismo patrón que classifyBatch en
// chat.segmentation.service.ts). Ante fallo, cada ítem cae al fallback de
// truncamiento, igual que la versión serial anterior.
async function generateShortTitlesBatch(
  items: Array<{ id: string; content: string }>,
  model: string,
): Promise<Record<string, string>> {
  if (items.length === 0) return {};

  const userPrompt = items.map(i => `(id: ${i.id})\n${i.content}`).join('\n\n---\n\n');

  try {
    const result = await generateFromAI('nineRouter', SYSTEM_PROMPT_TITLES_BATCH, userPrompt, {
      type: 'json_object',
      json_schema: {
        type: 'object',
        properties: {
          titles: {
            type: 'array',
            items: {
              type: 'object',
              properties: { id: { type: 'string' }, title: { type: 'string' } },
              required: ['id', 'title'],
            },
          },
        },
        required: ['titles'],
      },
    }, { model, temperature: 0.3, max_tokens: 800 });

    const parsed = JSON.parse(result.content) as { titles?: TitleBatchItem[] };
    const byId = new Map((parsed.titles || []).map(t => [t.id, t.title]));

    const out: Record<string, string> = {};
    for (const item of items) {
      out[item.id] = byId.get(item.id) || item.content.slice(0, 60).trim();
    }
    return out;
  } catch (err) {
    logger.warn('Error en batch de títulos de bloques, se usa fallback por truncamiento', { error: (err as Error).message });
    const out: Record<string, string> = {};
    for (const item of items) out[item.id] = item.content.slice(0, 60).trim();
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

  const titles = await generateShortTitlesBatch(
    pending.map(({ msg }) => ({ id: msg.id, content: msg.content })),
    model,
  );

  const blocks: KnowledgeBlock[] = [];
  for (const { seg, msg } of pending) {
    const content = trimLeadingFillers(msg.content);
    const subject = detectSubjectExtended(msg.content) || 'general';

    const block = SessionSummaryService.addBlock(sessionId, {
      subject,
      extractedFromMessages: [msg.id],
      extractedAt: new Date().toISOString(),
      extractionModel: model,
      confidence: seg.confidence,
      title: titles[msg.id],
      content,
    });
    blocks.push(block);

    maybeAddToCollectiveKB(block, userId);
  }

  return blocks;
}
