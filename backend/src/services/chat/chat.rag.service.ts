import { EmbeddingModel } from '../../models/embedding.model.js';
import { findTopK } from '../../utils/vector.js';
import { logger } from '../../utils/logger.js';

const RAG_MIN_EMBEDDINGS = 2;
const RAG_TOP_K = 3;

export class ChatRAGService {
  async buildContext(userId: string, excludeMessageId: string, queryVector: number[]): Promise<string> {
    try {
      const pastEmbeddings = EmbeddingModel.getUserEmbeddings(userId, 100);
      const filtered = pastEmbeddings.filter(e => e.messageId !== excludeMessageId);

      if (filtered.length < RAG_MIN_EMBEDDINGS) return '';

      const topK = findTopK(queryVector, filtered, RAG_TOP_K);
      logger.debug('RAG context recuperado', {
        total_embeddings: filtered.length,
        above_threshold: topK.length,
        min_score: topK.length > 0 ? topK[topK.length - 1].score.toFixed(3) : 'N/A',
        max_score: topK.length > 0 ? topK[0].score.toFixed(3) : 'N/A',
      });
      if (topK.length === 0) return '';

      const contextParts = topK.map((item, i) => {
        const roleLabel = item.role === 'assistant' ? 'Tu explicación anterior' : 'Pregunta anterior';
        return `[Contexto ${i + 1}] (${roleLabel}, relevancia: ${(item.score * 100).toFixed(0)}%)\n${item.content}`;
      });

      return `\n\n--- Contexto de conversaciones anteriores ---\n${contextParts.join('\n\n')}\n---`;
    } catch (err) {
      logger.warn('Error generando RAG context', { error: (err as Error).message });
      return '';
    }
  }
}
