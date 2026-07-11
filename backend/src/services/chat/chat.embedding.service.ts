import { v4 as uuidv4 } from 'uuid';
import { generateEmbedding } from '../ai/embeddings.js';
import { EmbeddingModel } from '../../models/embedding.model.js';
import { EmbeddingOutboxModel } from '../../models/embedding-outbox.model.js';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';

export class ChatEmbeddingService {
  async generate(text: string): Promise<number[] | null> {
    try {
      return await generateEmbedding(text);
    } catch (err) {
      logger.warn('Embedding inline falló', { error: (err as Error).message });
      return null;
    }
  }

  async generateAndSave(msgId: string, userId: string, text: string, outboxId?: string): Promise<number[] | null> {
    const vector = await this.generate(text);
    if (vector) {
      try {
        EmbeddingModel.saveEmbedding(uuidv4(), msgId, userId, vector, config.embeddings.model, config.embeddings.dimensions);
        if (outboxId) EmbeddingOutboxModel.markDone(outboxId);
      } catch (err) {
        logger.warn('Error guardando embedding inline', { error: (err as Error).message });
      }
    }
    return vector;
  }
}
