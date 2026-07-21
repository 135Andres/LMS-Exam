import { randomUUID } from 'node:crypto';
import { generateFromAI } from './ai/index.js';
import { generateEmbedding } from './ai/embeddings.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { KnowledgeModel } from '../models/knowledge.model.js';
import { KnowledgeEmbeddingModel } from '../models/knowledge-embedding.model.js';
import { repairBackslashEscapes } from '../utils/json-repair.js';

const VALIDATION_PROMPT = `Eres un curador de una base de conocimiento colectiva para estudiantes. Recibes un intercambio de pregunta-respuesta detectado automáticamente en un chat de tutoría. Decide si vale la pena guardarlo como conocimiento reusable para otros estudiantes.

Evalúa:
1. VALIOSO: ¿es información general reutilizable (definición, concepto, fórmula, explicación), no algo específico de una tarea puntual del usuario?
2. CORRECTO: ¿el contenido es correcto académicamente, sin errores evidentes?
3. Si ambos son ciertos, clasifica la materia, el tema específico, etiquetas relevantes y la dificultad.

Responde ÚNICAMENTE con JSON, sin markdown:
{
  "valuable": true o false,
  "correct": true o false,
  "subject": "materia (ej: matematicas, fisica, quimica, biologia, historia, lenguaje, informatica, general)",
  "topic": "tema especifico corto",
  "tags": ["tag1", "tag2"],
  "difficulty": "basico" o "intermedio" o "avanzado",
  "reason": "razon breve de la decision"
}`;

interface ValidationResult {
  valuable: boolean;
  correct: boolean;
  subject: string;
  topic?: string;
  tags?: string[];
  difficulty?: string;
  reason?: string;
}

export async function validatePendingKnowledge(limit = 20): Promise<void> {
  const pending = KnowledgeModel.getPendingReview(limit);
  if (pending.length === 0) return;

  logger.info('KB validator: procesando candidatos pendientes', { count: pending.length });

  for (const item of pending) {
    try {
      const result = await generateFromAI('nineRouter', VALIDATION_PROMPT, item.content, null, {
        model: config.models.kbValidator,
        temperature: 0.2,
        // deepseek-v4-flash-free razona pesado en reasoning_content antes del
        // JSON final — probado en vivo con insights.service.ts: contenido más
        // largo puede necesitar ~1800 tokens solo de razonamiento.
        max_tokens: 3000,
      });

      const parsed = JSON.parse(repairBackslashEscapes(result.content)) as ValidationResult;

      if (parsed.valuable && parsed.correct) {
        KnowledgeModel.publishWithAiVerification(item.id, {
          subject: parsed.subject,
          topic: parsed.topic,
          tags: parsed.tags,
          difficulty: parsed.difficulty,
          verifiedByAi: config.models.kbValidator,
        });

        const vector = await generateEmbedding(item.content);
        KnowledgeEmbeddingModel.save(
          randomUUID(), item.id, new Float32Array(vector), config.embeddings.model, vector.length,
        );

        logger.info('KB validator: candidato aprobado y publicado', { id: item.id, subject: parsed.subject });
      } else {
        KnowledgeModel.reject(item.id);
        logger.info('KB validator: candidato rechazado', { id: item.id, reason: parsed.reason });
      }
    } catch (err) {
      logger.warn('KB validator: error validando candidato', { id: item.id, error: (err as Error).message });
    }
  }
}
