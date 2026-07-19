import { randomUUID } from 'node:crypto';
import { logger } from '../utils/logger.js';
import { detectSubjectByKeywords } from '../utils/subject-keywords.js';
import { KnowledgeModel, hashKnowledgeContent } from '../models/knowledge.model.js';

interface ChatLogRow {
  id: string;
  role: string;
  content: string;
  subject?: string | null;
}

interface MessagePair {
  userMessage: ChatLogRow;
  assistantMessage: ChatLogRow;
}

interface DetectionResult {
  type: 'qa_pair' | 'explanation';
  pair: MessagePair;
  confidence: number;
}

const DETECTION_RULES = {
  qa_pair: {
    minUserLength: 20,
    minAssistantLength: 150,
    maxAssistantLength: 3000,
    triggers: [
      /^(qué es|qué son|define|definición de|explica|cómo se)/i,
      /^(cuál es la|cuáles son las)/i,
      /^(para qué sirve|para qué se usa)/i,
    ],
    antiTriggers: [
      /^(hola|gracias|ok|vale|entendido|perfecto)/i,
      /^(sí|no|tal vez|quizás)/i,
    ],
  },
  explanation: {
    minAssistantLength: 400,
    triggers: [
      /^(aquí te explico|te explico|voy a explicar|paso a paso)/i,
      /^(la clave es|el truco es|lo importante es)/i,
    ],
  },
};

export function detectSubject(text: string): string {
  return detectSubjectByKeywords(text).subject ?? 'general';
}

export function detectKnowledgeOpportunity(messages: ChatLogRow[]): DetectionResult | null {
  for (let i = messages.length - 2; i >= 0; i--) {
    const userMsg = messages[i];
    const assistantMsg = messages[i + 1];

    if (userMsg.role !== 'user' || assistantMsg.role !== 'assistant') continue;

    const qaRules = DETECTION_RULES.qa_pair;
    if (
      qaRules.triggers.some(r => r.test(userMsg.content)) &&
      !qaRules.antiTriggers.some(r => r.test(userMsg.content)) &&
      userMsg.content.length >= qaRules.minUserLength &&
      assistantMsg.content.length >= qaRules.minAssistantLength &&
      assistantMsg.content.length <= qaRules.maxAssistantLength
    ) {
      return { type: 'qa_pair', pair: { userMessage: userMsg, assistantMessage: assistantMsg }, confidence: 0.85 };
    }

    const explRules = DETECTION_RULES.explanation;
    if (
      assistantMsg.content.length >= explRules.minAssistantLength &&
      explRules.triggers.some(r => r.test(assistantMsg.content))
    ) {
      return { type: 'explanation', pair: { userMessage: userMsg, assistantMessage: assistantMsg }, confidence: 0.7 };
    }
  }
  return null;
}

export async function detectAndSuggestKnowledge(
  userId: string,
  sessionId: string,
  messages: ChatLogRow[],
  hadCollectiveMatch: boolean,
): Promise<void> {
  try {
    if (hadCollectiveMatch) return; // la KB ya tenía algo útil para este tema, no hay vacío que llenar

    const opportunity = detectKnowledgeOpportunity(messages);
    if (!opportunity) return;

    const { pair } = opportunity;
    const content = `${pair.userMessage.content}\n\n---\n\n${pair.assistantMessage.content}`;
    const summary = pair.userMessage.content.slice(0, 180) + '...';
    const subject = detectSubject(content);

    if (KnowledgeModel.existsByHash(hashKnowledgeContent(content))) return;

    const knowledgeId = randomUUID();
    KnowledgeModel.create({
      id: knowledgeId,
      content,
      summary,
      subject,
      source_type: 'user_qa',
      source_user_id: userId,
      tags: ['auto-detectado', subject],
      status: 'pending_review',
    });

    logger.info('Knowledge detection: candidato encolado para validacion IA', {
      knowledgeId, userId, sessionId, type: opportunity.type,
    });
  } catch (err) {
    logger.warn('Knowledge detection failed', { error: (err as Error).message });
  }
}
