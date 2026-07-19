import { findTopK } from '../utils/vector.js';
import { EmbeddingModel } from '../models/embedding.model.js';
import { KnowledgeEmbeddingModel } from '../models/knowledge-embedding.model.js';
import { SUBJECT_KEYWORDS } from '../utils/subject-keywords.js';

interface SearchResult {
  content: string;
  score: number;
  source: 'personal' | 'collective';
  metadata: {
    id: string;
    subject?: string;
    topic?: string;
    created_at?: string;
    upvotes?: number;
  };
  finalScore: number;
}

interface HybridRAGOptions {
  userId: string;
  queryVector: number[];
  excludeMessageId?: string;
  subject?: string;
  personalWeight?: number;
  collectiveWeight?: number;
  personalLimit?: number;
  collectiveLimit?: number;
  finalTopK?: number;
  minPersonalScore?: number;
  minCollectiveScore?: number;
  verifiedOnly?: boolean;
}

export interface HybridRAGResult {
  context: string;
  hadCollectiveMatch: boolean;
}

const DEFAULTS = {
  personalWeight: 0.7,
  collectiveWeight: 0.3,
  personalLimit: 50,
  collectiveLimit: 50,
  finalTopK: 5,
  minPersonalScore: 0.25,
  minCollectiveScore: 0.35,
  verifiedOnly: true,
};

export class HybridRAGService {
  async buildContext(options: HybridRAGOptions): Promise<HybridRAGResult> {
    const opts = { ...DEFAULTS, ...options };

    if (opts.queryVector.length === 0) return { context: '', hadCollectiveMatch: false };

    const [personalResults, collectiveResults] = await Promise.all([
      this.searchPersonal(opts as Required<HybridRAGOptions>),
      this.searchCollective(opts as Required<HybridRAGOptions>),
    ]);

    const filteredPersonal = personalResults.filter(r => r.score >= opts.minPersonalScore);
    const filteredCollective = collectiveResults.filter(r => r.score >= opts.minCollectiveScore);
    const hadCollectiveMatch = filteredCollective.length > 0;

    const merged = [
      ...filteredPersonal.map(r => ({ ...r, finalScore: r.score * opts.personalWeight })),
      ...filteredCollective.map(r => ({ ...r, finalScore: r.score * opts.collectiveWeight })),
    ];

    merged.sort((a, b) => b.finalScore - a.finalScore);
    const topK = merged.slice(0, opts.finalTopK);

    if (topK.length === 0) return { context: '', hadCollectiveMatch };

    return { context: this.formatContext(topK), hadCollectiveMatch };
  }

  private async searchPersonal(opts: Required<HybridRAGOptions>): Promise<SearchResult[]> {
    const embeddings = EmbeddingModel.getUserEmbeddings(opts.userId, opts.personalLimit)
      .filter(e => e.messageId !== opts.excludeMessageId);
    if (embeddings.length < 2) return [];

    const topK = findTopK(opts.queryVector, embeddings as any, opts.finalTopK * 2, opts.minPersonalScore);
    return topK.map(item => ({
      content: item.content,
      score: item.score,
      source: 'personal' as const,
      metadata: { id: (item as any).messageId || '' },
      finalScore: 0,
    }));
  }

  private async searchCollective(opts: Required<HybridRAGOptions>): Promise<SearchResult[]> {
    const results = KnowledgeEmbeddingModel.searchSimilar(opts.queryVector, {
      subject: opts.subject,
      minScore: opts.minCollectiveScore,
      limit: opts.collectiveLimit,
      verifiedOnly: opts.verifiedOnly,
    });

    return results.map(item => ({
      content: item.content,
      score: item.score,
      source: 'collective' as const,
      metadata: {
        id: item.knowledge_id,
        subject: item.subject,
        topic: item.topic || undefined,
        upvotes: item.upvotes,
        created_at: item.created_at,
      },
      finalScore: 0,
    }));
  }

  private formatContext(results: SearchResult[]): string {
    const parts = results.map((item, i) => {
      const badge = item.source === 'personal' ? 'Tu historial' : 'Conocimiento colectivo';
      const meta = item.metadata;
      let metaStr = '';
      if (meta.subject) metaStr += ` | Materia: ${meta.subject}`;
      if (meta.topic) metaStr += ` | Tema: ${meta.topic}`;
      if (meta.upvotes !== undefined) metaStr += ` | Upvotes: ${meta.upvotes}`;
      return `[Contexto ${i + 1}] (${badge}, relevancia: ${(item.finalScore * 100).toFixed(0)}%${metaStr})\n${item.content}`;
    });
    return `\n\n--- Contexto Hibrido (Personal + Colectivo) ---\n${parts.join('\n\n')}\n---`;
  }

  static detectSubject(query: string): string | undefined {
    const lower = query.toLowerCase();
    for (const [subject, keywords] of Object.entries(SUBJECT_KEYWORDS)) {
      if (keywords.some(k => lower.includes(k))) return subject;
    }
    return undefined;
  }
}

export const hybridRAG = new HybridRAGService();
