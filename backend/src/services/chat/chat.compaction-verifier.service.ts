// backend/src/services/chat/chat.compaction-verifier.service.ts
import { generateFromAI } from '../ai/index.js';
import { logger } from '../../utils/logger.js';
import type { KnowledgeBlock } from '../session-summary.service.js';

export interface ChatMessage {
  id: string;
  content: string;
  role: string;
}

export interface MissingContentItem {
  description: string;
  suggestedBlock?: boolean;
}

export interface VerificationResult {
  missing: MissingContentItem[];
}

// Modelo de otra FAMILIA al que compactó — no el mismo proveedor con otro
// nombre. Mapa simple invertido respecto a COMPACTION_MODEL_MAP
// (chat.compaction.service.ts).
export function pickVerifierModel(compactionModel: string): string {
  if (compactionModel.startsWith('nvidia/')) return 'ag/gemini-3-flash';
  return 'nvidia/z-ai/glm-5.2';
}

const SYSTEM_PROMPT_VERIFIER = `Eres un auditor de compactación de conversaciones académicas. Acá está la conversación original y el resumen (narrativa + bloques) que otro modelo generó a partir de ella.
¿Falta alguna explicación, derivación, definición o dato técnico del original que no está reflejado ni en la narrativa ni en los bloques?
Responde ÚNICAMENTE con JSON: {"missing": [{"description": "...", "suggestedBlock": true|false}]}. Si no falta nada, "missing": [].`;

function buildUserPrompt(originalMessages: ChatMessage[], narrative: string, blocks: KnowledgeBlock[]): string {
  const conversation = originalMessages.map(m => `[${m.role}] ${m.content}`).join('\n\n');
  const blocksText = blocks.map(b => `- (${b.subject}) ${b.title}: ${b.content}`).join('\n') || '(sin bloques)';

  return `--- Conversación original ---\n${conversation}\n\n--- Narrativa generada ---\n${narrative || '(sin narrativa)'}\n\n--- Bloques generados ---\n${blocksText}`;
}

export async function verifyCompaction(
  originalMessages: ChatMessage[],
  narrative: string,
  blocks: KnowledgeBlock[],
  verifierModel: string,
): Promise<VerificationResult> {
  const userPrompt = buildUserPrompt(originalMessages, narrative, blocks);

  try {
    const result = await generateFromAI('nineRouter', SYSTEM_PROMPT_VERIFIER, userPrompt, {
      type: 'json_object',
      json_schema: {
        type: 'object',
        properties: {
          missing: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                description: { type: 'string' },
                suggestedBlock: { type: 'boolean' },
              },
              required: ['description'],
            },
          },
        },
        required: ['missing'],
      },
    }, { model: verifierModel, temperature: 0.1, max_tokens: 1500 });

    const parsed = JSON.parse(result.content) as { missing?: MissingContentItem[] };
    if (!parsed || !Array.isArray(parsed.missing)) return { missing: [] };
    return { missing: parsed.missing };
  } catch (err) {
    logger.warn('Error en verificación cruzada de compactación, se asume sin contenido faltante', {
      error: (err as Error).message,
    });
    return { missing: [] };
  }
}
