// backend/src/services/chat/chat.segmentation.service.ts
import { generateFromAI } from '../ai/index.js';
import { hasCode } from './chat.classifier.service.js';
import { logger } from '../../utils/logger.js';

export type SegmentClass = 'verificable' | 'narrativo';

export interface SegmentationResult {
  messageId: string;
  class: SegmentClass;
  confidence: 'high' | 'medium' | 'low';
  method: 'heuristic' | 'llm-batch';
}

export interface SegmentableMessage {
  id: string;
  content: string;
  role: string;
}

// Exportado para que chat.compaction.service.ts pueda reusar los mismos
// marcadores en su chequeo de "alucinación de ausencia" del Paso 3 (spec 5.2)
// sin duplicar la lista ni tocar la clasificación de este archivo.
export const VERIFICABLE_MARKERS = [
  /\$\$?[^$]+\$\$?/,                          // LaTeX inline o bloque
  /```/,                                       // código (reusa hasCode de chat.classifier.service.ts)
  /\b(por lo tanto|entonces|demostraci[oó]n|derivaci[oó]n|paso a paso|definici[oó]n de)\b/i,
];

const NARRATIVE_MARKERS = [
  /^(ok|gracias|entendido|listo|perfecto|dale)\b/i, // mensajes cortos de confirmación
];

function classifyHeuristic(message: SegmentableMessage): SegmentationResult | null {
  if (message.content.length < 30 && NARRATIVE_MARKERS.some(re => re.test(message.content))) {
    return { messageId: message.id, class: 'narrativo', confidence: 'high', method: 'heuristic' };
  }
  if (VERIFICABLE_MARKERS.some(re => re.test(message.content)) || hasCode(message.content)) {
    return { messageId: message.id, class: 'verificable', confidence: 'high', method: 'heuristic' };
  }
  if (message.content.length > 400 && message.role === 'assistant') {
    // explicación larga del asistente sin marcadores explícitos — probable
    // candidato, pero sin la certeza de un marcador explícito.
    return { messageId: message.id, class: 'verificable', confidence: 'medium', method: 'heuristic' };
  }
  return null; // inconcluso, escalar a batch de IA
}

const SYSTEM_PROMPT_SEGMENTATION = `Eres un clasificador de mensajes de una conversación de tutoría académica. Para cada mensaje decide si es "verificable" (contenido académico revisable: explicaciones, cálculos, definiciones, datos concretos) o "narrativo" (charla, confirmaciones, contexto conversacional sin sustancia verificable).

Responde ÚNICAMENTE con JSON: {"classifications": [{"messageId": "...", "class": "verificable"|"narrativo", "confidence": "high"|"medium"|"low"}, ...]}. Incluye exactamente un ítem por cada mensaje recibido, usando el mismo messageId.`;

interface BatchItem {
  messageId: string;
  class: SegmentClass;
  confidence: 'high' | 'medium' | 'low';
}

// Un solo batch para todos los mensajes ambiguos, nunca una llamada por
// mensaje. Ante cualquier duda (item ausente, no parseable, o confianza
// low) el default es 'verificable' — nunca 'narrativo' (spec: "ante la
// duda, se conserva").
async function classifyBatch(messages: SegmentableMessage[], model: string): Promise<SegmentationResult[]> {
  const userPrompt = messages.map(m => `[${m.role}] (id: ${m.id}) ${m.content}`).join('\n\n');

  let items: BatchItem[] = [];
  try {
    const result = await generateFromAI('nineRouter', SYSTEM_PROMPT_SEGMENTATION, userPrompt, {
      type: 'json_object',
      json_schema: {
        type: 'object',
        properties: {
          classifications: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                messageId: { type: 'string' },
                class: { type: 'string', enum: ['verificable', 'narrativo'] },
                confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
              },
              required: ['messageId', 'class', 'confidence'],
            },
          },
        },
        required: ['classifications'],
      },
    }, { model, temperature: 0.1, max_tokens: 2000 });

    const parsed = JSON.parse(result.content) as { classifications: BatchItem[] };
    items = parsed.classifications || [];
  } catch (err) {
    logger.warn('Error en batch de clasificación de mensajes, default conservador a verificable', {
      error: (err as Error).message,
    });
  }

  const byId = new Map(items.map(i => [i.messageId, i]));

  return messages.map(m => {
    const item = byId.get(m.id);
    const validClass = item && (item.class === 'verificable' || item.class === 'narrativo');
    if (!item || !validClass || item.confidence === 'low') {
      return { messageId: m.id, class: 'verificable', confidence: 'low', method: 'llm-batch' };
    }
    return { messageId: m.id, class: item.class, confidence: item.confidence, method: 'llm-batch' };
  });
}

export async function segmentMessages(
  messages: SegmentableMessage[],
  model: string,
): Promise<SegmentationResult[]> {
  const results: SegmentationResult[] = new Array(messages.length);
  const ambiguous: SegmentableMessage[] = [];
  const ambiguousIndexes: number[] = [];

  messages.forEach((m, idx) => {
    const heuristic = classifyHeuristic(m);
    if (heuristic) {
      results[idx] = heuristic;
    } else {
      ambiguous.push(m);
      ambiguousIndexes.push(idx);
    }
  });

  if (ambiguous.length > 0) {
    const batchResults = await classifyBatch(ambiguous, model);
    batchResults.forEach((r, i) => { results[ambiguousIndexes[i]] = r; });
  }

  return results;
}
