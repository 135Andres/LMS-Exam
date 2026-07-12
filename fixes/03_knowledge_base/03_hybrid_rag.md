# KNOWLEDGE BASE #3: RAG Híbrido (Personal + Colectivo)

---

## AUDITORÍA (2026-07-12)

**VEREDICTO: ⚠️ PARCIAL**

| Sub-ítem del plan | Estado | Ubicación / Evidencia |
|---|---|---|
| `HybridRAGService` clase con `buildContext()` | ✅ COMPLETO (en archivo) | `backend/src/services/hybrid-rag.service.ts:44` |
| Pesos 0.7/0.3 configurables vía `HybridRAGOptions` | ✅ COMPLETO (en archivo) | `backend/src/services/hybrid-rag.service.ts:33-42` (`DEFAULTS.personalWeight:0.7`, `collectiveWeight:0.3`) |
| Búsqueda paralela `Promise.all([searchPersonal, searchCollective])` | ✅ COMPLETO (en archivo) | `backend/src/services/hybrid-rag.service.ts:50-53` |
| Filtros por umbrales `minPersonalScore` / `minCollectiveScore` | ✅ COMPLETO (en archivo) | `backend/src/services/hybrid-rag.service.ts:55-56` |
| Merge ponderado `finalScore = score * weight` | ✅ COMPLETO (en archivo) | `backend/src/services/hybrid-rag.service.ts:58-61` |
| TopK final (`finalTopK` configurable, default 5) | ✅ COMPLETO (en archivo) | `backend/src/services/hybrid-rag.service.ts:64` |
| `formatContext` con badges (Personal/Colectivo) | ✅ COMPLETO (en archivo) | `backend/src/services/hybrid-rag.service.ts:108-119` |
| `detectSubject(query)` keyword-based | ✅ COMPLETO (en archivo) | `backend/src/services/hybrid-rag.service.ts:121-137` (7 materias) |
| `hybridRAG` singleton exportado | ✅ COMPLETO (en archivo) | `backend/src/services/hybrid-rag.service.ts:140` |
| Cache de resultados (plan menciona implícitamente "cache 5 min") | ❌ NO IMPLEMENTADO | sin cache en `hybrid-rag.service.ts` |
| Pesos configurables por env (`RAG_PERSONAL_WEIGHT`, etc.) en `buildHybridRagContext` | ❌ NO IMPLEMENTADO | plan muestra `parseFloat(process.env.RAG_PERSONAL_WEIGHT \|\| '0.7')` en integración que no existe |
| Tabla `user_rag_preferences` (futuro) | ❌ NO IMPLEMENTADO | plan marcado como "Futuro" — no aplica |
| Métricas para ajuste de pesos (latencia, satisfacción, etc.) | ❌ NO IMPLEMENTADO | sin telemetría |
| **INTEGRACIÓN EN CHAT**: importar `hybridRAG` desde `chat.streaming.service.ts` o `chat.service.ts` | ❌ NO IMPLEMENTADO | grep `hybridRAG\|HybridRAGService\|hybrid-rag` en `backend/src/` → solo auto-referencias en `hybrid-rag.service.ts`. **Cero imports externos.** Servicio es código muerto. |
| `buildHybridRagContext(message, userId, excludeMsgId)` reemplazando `buildRagContext` actual | ❌ NO IMPLEMENTADO | `backend/src/services/chat/chat.rag.service.ts` sigue usando RAG personal únicamente (`EmbeddingModel.getUserEmbeddings` + `findTopK`) |
| `KnowledgeEmbeddingModel.searchSimilar` con sqlite-vec virtual table | ⚠️ PARCIAL | existe `searchSimilar` (`backend/src/models/knowledge-embedding.model.ts:33`) pero usa in-memory `findTopK`, no virtual table `vec_knowledge_embeddings` (no existe) |
| `searchSimilarFallback` (fallback sin sqlite-vec) | ✅ COMPLETO (en archivo) | la implementación actual ES el fallback (in-memory findTopK) |

**Resumen:**
- ✅ 10 sub-ítems completos **dentro del archivo del servicio**
- ❌ 5 sub-ítems no implementados (cache, env config, user prefs, métricas, integración en chat)
- ⚠️ 1 sub-ítem parcial (searchSimilar in-memory en vez de virtual table)
- ⚠️ PARCIAL — servicio completamente implementado internamente, **pero NUNCA integrado en el flujo de chat real → código muerto**. El chat sigue usando RAG personal solo (`ChatRAGService` sin componente colectivo). Ver `BUGS_ACTUALES.md`.

---

## OBJETIVO ESPECÍFICO
Combinar embeddings personales (historial usuario) + colectivos (KB verificada) en contexto RAG con pesos configurables.

## ARQUITECTURA DE BÚSQUEDA HÍBRIDA

```
┌─────────────────────────────────────────────────────────────────┐
│                      QUERY USUARIO                              │
│                    "¿Cómo hago integrales?"                     │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │  generateEmbedding()   │
                    │  nv-embed-v1 (4096d)   │
                    └────────────────────────┘
                                 │
                                 ▼
              ┌────────────────────────────────────────┐
              │        BÚSQUEDA PARALELA               │
              ├──────────────────────┬─────────────────┤
              │   PERSONAL (user)    │   COLECTIVO (KB)│
              ├──────────────────────┼─────────────────┤
              │ chat_embeddings      │ knowledge_base  │
              │ WHERE user_id = ?    │ WHERE is_verified=1│
              │ LIMIT 100            │   AND subject=? │
              │                      │   LIMIT 200     │
              └──────────┬───────────┴────────┬──────────┘
                         │                    │
                         ▼                    ▼
              ┌────────────────────────────────────────┐
              │      findTopK(vector, items, k)        │
              │   cosineSimilarity(query, item.vector) │
              └──────────────────────┬─────────────────┘
                                     │
                    ┌────────────────┼────────────────┐
                    ▼                ▼                ▼
            Personal Top-K      Colectivo Top-K    MERGE PONDERADO
            (k=3, weight=0.7)   (k=3, weight=0.3)  score = w_p * s_p + w_c * s_c
                    │                │                │
                    └────────────────┴────────────────┘
                                     │
                                     ▼
                         ┌───────────────────────┐
                         │   TOP 5 FINAL         │
                         │   Format para prompt  │
                         └───────────────────────┘
```

## IMPLEMENTACIÓN: HybridRAGService

```typescript
// backend/src/services/hybrid-rag.service.ts
import { findTopK } from '../utils/vector.js';
import { EmbeddingModel } from '../models/embedding.model.js';
import { KnowledgeEmbeddingModel } from '../models/knowledge-embedding.model.js';
import { config } from '../config/index.js';

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
}

interface HybridRAGOptions {
  userId: string;
  queryVector: number[];
  subject?: string;              // Detectado del query
  personalWeight?: number;       // Default 0.7
  collectiveWeight?: number;     // Default 0.3
  personalLimit?: number;        // Default 50 (cargar de DB)
  collectiveLimit?: number;      // Default 50
  finalTopK?: number;            // Default 5
  minPersonalScore?: number;     // Default 0.25
  minCollectiveScore?: number;   // Default 0.35 (más estricto)
  verifiedOnly?: boolean;        // Default true
}

const DEFAULT_OPTS: Required<HybridRAGOptions> = {
  userId: '',
  queryVector: [],
  personalWeight: 0.7,
  collectiveWeight: 0.3,
  personalLimit: 50,
  collectiveLimit: 50,
  finalTopK: 5,
  minPersonalScore: 0.25,
  minCollectiveScore: 0.35,
  verifiedOnly: true,
  subject: undefined,
};

export class HybridRAGService {
  async buildContext(options: HybridRAGOptions): Promise<string> {
    const opts = { ...DEFAULT_OPTS, ...options };
    
    if (opts.queryVector.length === 0) return '';
    
    // 1. BÚSQUEDA PARALELA
    const [personalResults, collectiveResults] = await Promise.all([
      this.searchPersonal(opts),
      this.searchCollective(opts),
    ]);
    
    // 2. FILTRAR POR UMBRALES
    const filteredPersonal = personalResults.filter(r => r.score >= opts.minPersonalScore);
    const filteredCollective = collectiveResults.filter(r => r.score >= opts.minCollectiveScore);
    
    // 3. MERGE PONDERADO
    const merged = [
      ...filteredPersonal.map(r => ({
        ...r,
        finalScore: r.score * opts.personalWeight,
      })),
      ...filteredCollective.map(r => ({
        ...r,
        finalScore: r.score * opts.collectiveWeight,
      })),
    ];
    
    // 4. ORDENAR Y TOMAR TOP-K
    merged.sort((a, b) => b.finalScore - a.finalScore);
    const topK = merged.slice(0, opts.finalTopK);
    
    if (topK.length === 0) return '';
    
    // 5. FORMATEAR CONTEXTO
    return this.formatContext(topK);
  }
  
  private async searchPersonal(opts: Required<HybridRAGOptions>): Promise<SearchResult[]> {
    const embeddings = EmbeddingModel.getUserEmbeddings(opts.userId, opts.personalLimit);
    if (embeddings.length < 2) return []; // Mínimo 2 para RAG personal
    
    const topK = findTopK(opts.queryVector, embeddings, opts.finalTopK * 2);
    return topK.map(item => ({
      content: item.content,
      score: item.score,
      source: 'personal' as const,
      metadata: {
        id: item.messageId,
        created_at: undefined, // Se podría añadir join
      },
    }));
  }
  
  private async searchCollective(opts: Required<HybridRAGOptions>): Promise<SearchResult[]> {
    // Usar sqlite-vec si disponible, sino fallback a carga en memoria
    const results = await KnowledgeEmbeddingModel.searchSimilar(
      opts.queryVector,
      {
        subject: opts.subject,
        minScore: opts.minCollectiveScore,
        limit: opts.collectiveLimit,
        verifiedOnly: opts.verifiedOnly,
      }
    );
    
    return results.map(item => ({
      content: item.content,
      score: item.score,
      source: 'collective' as const,
      metadata: {
        id: item.id,
        subject: item.subject,
        topic: item.topic,
        upvotes: item.upvotes,
        created_at: item.created_at,
      },
    }));
  }
  
  private formatContext(results: SearchResult[]): string {
    const parts = results.map((item, i) => {
      const badge = item.source === 'personal' ? '📝 Tu historial' : '🌍 Conocimiento colectivo';
      const meta = item.metadata;
      let metaStr = '';
      if (meta.subject) metaStr += ` | Materia: ${meta.subject}`;
      if (meta.topic) metaStr += ` | Tema: ${meta.topic}`;
      if (meta.upvotes !== undefined) metaStr += ` | 👍 ${meta.upvotes}`;
      
      return `[Contexto ${i + 1}] (${badge}, relevancia: ${(item.finalScore * 100).toFixed(0)}%${metaStr})\n${item.content}`;
    });
    
    return `\n\n--- Contexto Híbrido (Personal + Colectivo) ---\n${parts.join('\n\n')}\n---`;
  }
  
  // Detectar materia del query (simple keyword-based)
  static detectSubject(query: string): string | undefined {
    const subjects: Record<string, string[]> = {
      matematicas: ['derivada', 'integral', 'límite', 'ecuación', 'función', 'matriz', 'vector', 'probabilidad', 'estadística', 'geometría', 'trigonometría', 'cálculo', 'álgebra'],
      fisica: ['fuerza', 'energía', 'velocidad', 'aceleración', 'newton', 'cinemática', 'dinámica', 'termodinámica', 'electricidad', 'magnetismo', 'óptica', 'ondas'],
      quimica: ['molécula', 'átomo', 'reacción', 'enlace', 'ácido', 'base', 'pH', 'estequiometría', 'tabla periódica', 'orbital'],
      biologia: ['célula', 'ADN', 'gen', 'proteína', 'evolución', 'ecosistema', 'fotosíntesis', 'mitosis', 'meiosis'],
      historia: ['guerra', 'revolución', 'imperio', 'siglo', 'año', 'tratado', 'independencia', 'constitución'],
      lenguaje: ['sintaxis', 'gramática', 'verbo', 'sustantivo', 'adjetivo', 'oración', 'texto', 'lectura', 'escritura'],
      informatica: ['algoritmo', 'código', 'programa', 'función', 'variable', 'bucle', 'array', 'objeto', 'clase', 'API', 'base de datos'],
    };
    
    const lower = query.toLowerCase();
    for (const [subject, keywords] of Object.entries(subjects)) {
      if (keywords.some(k => lower.includes(k))) return subject;
    }
    return undefined;
  }
}

export const hybridRAG = new HybridRAGService();
```

## MODELO: KnowledgeEmbeddingModel (sqlite-vec)

```typescript
// backend/src/models/knowledge-embedding.model.ts
import { getDb } from '../db/connection.js';

interface SearchOptions {
  subject?: string;
  minScore: number;
  limit: number;
  verifiedOnly: boolean;
}

export const KnowledgeEmbeddingModel = {
  // Guardar embedding (binario Float32Array)
  save(id: string, knowledgeId: string, vector: Float32Array, model: string, dimensions: number): void {
    const db = getDb();
    const buffer = Buffer.from(vector.buffer);
    db.prepare(`
      INSERT INTO knowledge_embeddings (id, knowledge_id, embedding, model, dimensions)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, knowledgeId, buffer, model, dimensions);
    
    // También insertar en virtual table vec0
    db.prepare(`
      INSERT INTO vec_knowledge_embeddings(rowid, embedding)
      VALUES (?, ?)
    `).run(id, buffer);
  },
  
  // Búsqueda vectorial con filtros SQL
  async searchSimilar(queryVector: Float32Array, opts: SearchOptions) {
    const db = getDb();
    const queryBuffer = Buffer.from(queryVector.buffer);
    
    let sql = `
      SELECT 
        kb.id, kb.content, kb.summary, kb.subject, kb.topic, 
        kb.upvotes, kb.downvotes, kb.created_at,
        vec_distance_cosine(ve.embedding, ?) as distance
      FROM vec_knowledge_embeddings ve
      JOIN knowledge_embeddings ke ON ke.id = ve.rowid
      JOIN knowledge_base kb ON kb.id = ke.knowledge_id
      WHERE kb.is_verified = ?
    `;
    
    const params: any[] = [queryBuffer, opts.verifiedOnly ? 1 : 0];
    
    if (opts.subject) {
      sql += ` AND kb.subject = ?`;
      params.push(opts.subject);
    }
    
    // Filtrar por distancia (cosine distance = 1 - similarity)
    // similarity >= minScore  =>  distance <= 1 - minScore
    sql += ` AND vec_distance_cosine(ve.embedding, ?) <= ?`;
    params.push(queryBuffer, 1 - opts.minScore);
    
    sql += ` ORDER BY distance ASC LIMIT ?`;
    params.push(opts.limit);
    
    const rows = db.prepare(sql).all(...params) as any[];
    
    return rows.map(row => ({
      id: row.id,
      content: row.content,
      summary: row.summary,
      subject: row.subject,
      topic: row.topic,
      upvotes: row.upvotes,
      downvotes: row.downvotes,
      created_at: row.created_at,
      score: 1 - row.distance, // Convertir distance a similarity
    }));
  },
  
  // Fallback sin sqlite-vec (carga en memoria)
  searchSimilarFallback(queryVector: number[], opts: SearchOptions) {
    const db = getDb();
    let sql = `
      SELECT ke.id, ke.embedding, kb.content, kb.summary, kb.subject, kb.topic, kb.upvotes, kb.downvotes, kb.created_at
      FROM knowledge_embeddings ke
      JOIN knowledge_base kb ON kb.id = ke.knowledge_id
      WHERE kb.is_verified = ?
    `;
    const params: any[] = [opts.verifiedOnly ? 1 : 0];
    
    if (opts.subject) {
      sql += ` AND kb.subject = ?`;
      params.push(opts.subject);
    }
    
    sql += ` LIMIT ?`;
    params.push(opts.collectiveLimit);
    
    const rows = db.prepare(sql).all(...params) as any[];
    
    const items = rows.map(row => ({
      ...row,
      vector: new Float32Array(JSON.parse(row.embedding)),
    }));
    
    // findTopK reutilizado
    const topK = findTopK(queryVector, items.map(i => ({ vector: i.vector, content: i.content })), opts.limit);
    
    return topK.map((item, idx) => {
      const row = items.find(r => r.content === item.content);
      return { ...row, ...item, score: item.score };
    });
  },
  
  deleteByKnowledgeId(knowledgeId: string): void {
    const db = getDb();
    const ids = db.prepare('SELECT id FROM knowledge_embeddings WHERE knowledge_id = ?').all(knowledgeId) as { id: string }[];
    for (const { id } of ids) {
      db.prepare('DELETE FROM vec_knowledge_embeddings WHERE rowid = ?').run(id);
    }
    db.prepare('DELETE FROM knowledge_embeddings WHERE knowledge_id = ?').run(knowledgeId);
  },
};
```

## INTEGRACIÓN EN CHAT.SERVICE.TS

```typescript
// Reemplazar buildRagContext (línea 50-69) por:
import { hybridRAG } from './hybrid-rag.service.js';
import { generateEmbedding } from './ai/embeddings.js';

async function buildHybridRagContext(
  message: string, 
  userId: string, 
  excludeMsgId: string
): Promise<string> {
  // 1. Embedding del query
  let queryVector: number[] | null = null;
  try {
    queryVector = await generateEmbedding(message);
  } catch (err) {
    logger.warn('Embedding query failed', { error: err.message });
    return '';
  }
  
  if (!queryVector) return '';
  
  // 2. Detectar materia
  const subject = HybridRAGService.detectSubject(message);
  
  // 3. Construir contexto híbrido
  const context = await hybridRAG.buildContext({
    userId,
    queryVector,
    subject,
    // Pesos configurables por env
    personalWeight: parseFloat(process.env.RAG_PERSONAL_WEIGHT || '0.7'),
    collectiveWeight: parseFloat(process.env.RAG_COLLECTIVE_WEIGHT || '0.3'),
    finalTopK: parseInt(process.env.RAG_FINAL_TOP_K || '5'),
  });
  
  return context;
}

// En sendChatMessageStream / sendChatMessage:
// const ragContext = queryVector ? await buildHybridRagContext(message, userId, userMsgId) : '';
```

## CONFIGURACIÓN POR USUARIO (Futuro)
```sql
-- Tabla preferencias RAG por usuario
CREATE TABLE user_rag_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  personal_weight REAL DEFAULT 0.7,
  collective_weight REAL DEFAULT 0.3,
  min_personal_score REAL DEFAULT 0.25,
  min_collective_score REAL DEFAULT 0.35,
  enable_collective INTEGER DEFAULT 1,
  preferred_subjects TEXT DEFAULT '[]',  -- JSON array
  updated_at TEXT DEFAULT (datetime('now'))
);
```

## MÉTRICAS PARA AJUSTE DE PESOS
| Métrica | Target | Acción si no cumple |
|---------|--------|---------------------|
| % respuestas con contexto colectivo > 0 | > 30% | Bajar min_collective_score |
| Satisfacción usuario (thumbs up) | > 80% | A/B test pesos |
| Latencia RAG < 500ms | P95 | Reducir limits, usar sqlite-vec |
| Duplicación contenido (personal ≈ colectivo) | < 10% | Subir min_personal_score |

## AGENTE RECOMENDADO
`general` - Service + Model + sqlite-vec integration + config.