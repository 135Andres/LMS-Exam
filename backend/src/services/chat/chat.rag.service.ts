import { logger } from '../../utils/logger.js';
import { hybridRAG, HybridRAGService, type HybridRAGResult } from '../hybrid-rag.service.js';

export class ChatRAGService {
  async buildContext(
    userId: string,
    excludeMessageId: string,
    queryVector: number[],
    message: string,
  ): Promise<HybridRAGResult> {
    try {
      const subject = HybridRAGService.detectSubject(message);
      const result = await hybridRAG.buildContext({ userId, queryVector, excludeMessageId, subject });
      logger.debug('RAG hibrido recuperado', {
        hadContext: !!result.context,
        hadCollectiveMatch: result.hadCollectiveMatch,
        subject,
      });
      return result;
    } catch (err) {
      logger.warn('Error generando RAG context', { error: (err as Error).message });
      return { context: '', hadCollectiveMatch: false };
    }
  }
}
