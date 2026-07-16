import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';

interface EmbeddingResponse {
  data: Array<{ embedding: number[] }>;
  usage: { prompt_tokens: number; total_tokens: number };
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const start = Date.now();

  const response = await fetch(`${config.embeddings.baseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.embeddings.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.embeddings.model,
      input: text,
      encoding_format: 'float',
    }),
  });

  const elapsed = Date.now() - start;

  if (!response.ok) {
    const errorText = await response.text();
    logger.error('Error en NVIDIA embeddings API', { status: response.status, error: errorText, elapsed });
    throw new Error(`Embeddings API error ${response.status}: ${errorText}`);
  }

  const data = (await response.json()) as EmbeddingResponse;
  const vector = data.data[0]?.embedding;

  if (!vector || !Array.isArray(vector)) {
    throw new Error('Respuesta de embeddings inválida: falta el vector');
  }

  logger.debug('Embedding generado', { dimensions: vector.length, model: config.embeddings.model, elapsed });
  return vector;
}
