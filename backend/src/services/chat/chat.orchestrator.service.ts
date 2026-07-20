// backend/src/services/chat/chat.orchestrator.service.ts
import { INKLING_MODEL_ID } from '../../config/models.js';
import { logger } from '../../utils/logger.js';
import { classifyMessage, type Complexity, type ClassificationResult, type DelegateTarget } from './chat.classifier.service.js';
import type { Attachment } from './chat.prompt.service.js';

const EFFORT_BY_COMPLEXITY: Record<Complexity, number> = {
  low: 0.3,
  medium: 0.6,
  high: 0.9,
};

const DELEGATE_MODEL_MAP: Record<Exclude<DelegateTarget, null>, string> = {
  glm: 'nvidia/z-ai/glm-5.2',
  sonnet: 'ag/claude-sonnet-4-6',
  'gemini-pro': 'ag/gemini-3.1-pro-low',
};

export interface OrchestrationDecision {
  model: string;
  effort?: number;
  classification: ClassificationResult;
}

const MULTIMODAL_CLASSIFICATION: ClassificationResult = {
  complexity: 'medium',
  delegateTo: null,
  hasCode: false,
  method: 'heuristic',
};

export class ChatOrchestratorService {
  // boostSubjects: profile.subjects del usuario (plan 07) — desempata el
  // clasificador heurístico de materias, nunca lo secuestra (ver
  // detectSubjectByKeywords en subject-keywords.ts).
  decide(message: string, ragContextLength: number, attachments?: Attachment[], boostSubjects?: string[]): OrchestrationDecision {
    // Inkling es el único modelo con visión + audio nativo de la lista — un
    // adjunto de imagen/audio nunca se delega, se manda directo.
    if (attachments?.some(a => a.type === 'image' || a.type === 'audio')) {
      const decision: OrchestrationDecision = { model: INKLING_MODEL_ID, effort: 0.6, classification: MULTIMODAL_CLASSIFICATION };
      this.log(decision);
      return decision;
    }

    const classification = classifyMessage(message, ragContextLength, boostSubjects);

    const decision: OrchestrationDecision = classification.delegateTo
      ? { model: DELEGATE_MODEL_MAP[classification.delegateTo], classification }
      : { model: INKLING_MODEL_ID, effort: EFFORT_BY_COMPLEXITY[classification.complexity], classification };

    this.log(decision);
    return decision;
  }

  private log(decision: OrchestrationDecision): void {
    logger.info('Decisión de orquestación', {
      subject: decision.classification.subject,
      complexity: decision.classification.complexity,
      hasCode: decision.classification.hasCode,
      delegateTo: decision.classification.delegateTo,
      modelUsed: decision.model,
      effort: decision.effort,
      method: decision.classification.method,
    });
  }
}

// 9router no confirma (aún, sin credenciales para probar) un parámetro nativo
// de "reasoning effort" para Inkling — se inyecta como instrucción de texto
// en el system prompt. ponytail: si 9router expone un campo real del body
// más adelante, mover el effort ahí y borrar esto.
export function buildEffortInstruction(effort: number): string {
  const level = effort <= 0.4 ? 'mínimo' : effort <= 0.7 ? 'moderado' : 'extenso';
  return `\n\n--- Nivel de razonamiento ---\nUsa razonamiento ${level} para esta respuesta, acorde a la complejidad de la pregunta.\n---`;
}
