# CONOCIMIENTO COLECTIVO #1: Esquema DB Completo

## Tablas Principales

### knowledge_base
```sql
CREATE TABLE IF NOT EXISTS knowledge_base (
  id TEXT PRIMARY KEY,                              -- UUID v4
  content TEXT NOT NULL,                            -- Texto completo (Q+A, explicación, recurso)
  summary TEXT,                                     -- Resumen <200 chars para listados
  subject TEXT NOT NULL,                            -- matematicas, fisica, quimica, historia, lenguaje, biologia, informatica, otros
  topic TEXT,                                       -- Subtema: derivadas, cinematica, tabla-periodica, revolucion-francesa...
  difficulty TEXT CHECK(difficulty IN ('basico','intermedio','avanzado')) DEFAULT 'intermedio',
  source_type TEXT CHECK(source_type IN ('user_qa','user_explanation','verified_content','imported')) DEFAULT 'user_qa',
  source_user_id TEXT REFERENCES users(id),         -- NULL = anónimo
  is_verified INTEGER DEFAULT 0,                    -- 1 = revisado por admin/profesor
  verified_by TEXT REFERENCES users(id),
  verified_at TEXT,                                 -- datetime ISO
  upvotes INTEGER DEFAULT 0,
  downvotes INTEGER DEFAULT 0,
  view_count INTEGER DEFAULT 0,
  tags TEXT DEFAULT '[]',                           -- JSON array: ["calculo", "regla-cadena", "ejercicio"]
  language TEXT DEFAULT 'es',
  embedding_model TEXT NOT NULL DEFAULT 'nvidia/nv-embed-v1',
  embedding_dims INTEGER NOT NULL DEFAULT 4096,
  content_hash TEXT NOT NULL,                       -- SHA256 para dedup
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Índices críticos
CREATE INDEX idx_kb_subject_topic ON knowledge_base(subject, topic);
CREATE INDEX idx_kb_verified ON knowledge_base(is_verified);
CREATE INDEX idx_kb_source_user ON knowledge_base(source_user_id);
CREATE INDEX idx_kb_created ON knowledge_base(created_at);
CREATE INDEX idx_kb_content_hash ON knowledge_base(content_hash); -- Unique constraint implícito
```

### knowledge_embeddings (sqlite-vec virtual table)
```sql
-- Tabla física para metadatos + BLOB vector
CREATE TABLE IF NOT EXISTS knowledge_embeddings (
  id TEXT PRIMARY KEY,
  knowledge_id TEXT NOT NULL REFERENCES knowledge_base(id) ON DELETE CASCADE,
  embedding BLOB NOT NULL,                          -- Float32Array binario (4096 * 4 = 16KB)
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Virtual table para búsqueda vectorial (sqlite-vec)
CREATE VIRTUAL TABLE IF NOT EXISTS vec_knowledge_embeddings USING vec0(
  embedding float[4096]
);

-- Trigger para sincronizar (sqlite-vec requiere insert manual en virtual table)
CREATE TRIGGER sync_vec_knowledge_after_insert
AFTER INSERT ON knowledge_embeddings
BEGIN
  INSERT INTO vec_knowledge_embeddings(rowid, embedding)
  VALUES (new.id, new.embedding);
END;

CREATE TRIGGER sync_vec_knowledge_after_delete
AFTER DELETE ON knowledge_embeddings
BEGIN
  DELETE FROM vec_knowledge_embeddings WHERE rowid = old.id;
END;
```

### knowledge_contributions (Gamificación)
```sql
CREATE TABLE IF NOT EXISTS knowledge_contributions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  knowledge_id TEXT NOT NULL REFERENCES knowledge_base(id),
  contribution_type TEXT CHECK(contribution_type IN ('created','edited','upvoted','reported')),
  points INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_kc_user ON knowledge_contributions(user_id);
CREATE INDEX idx_kc_knowledge ON knowledge_contributions(knowledge_id);
```

### knowledge_votes (Anti-duplicados)
```sql
CREATE TABLE IF NOT EXISTS knowledge_votes (
  id TEXT PRIMARY KEY,
  knowledge_id TEXT NOT NULL REFERENCES knowledge_base(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  vote_type INTEGER CHECK(vote_type IN (1, -1)),    -- 1 = upvote, -1 = downvote
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(knowledge_id, user_id)
);

CREATE INDEX idx_kv_knowledge ON knowledge_votes(knowledge_id);
```

## Triggers para Contadores
```sql
-- Actualizar upvotes/downvotes en knowledge_base
CREATE TRIGGER update_kb_votes_after_vote_insert
AFTER INSERT ON knowledge_votes
BEGIN
  UPDATE knowledge_base SET 
    upvotes = upvotes + (CASE WHEN new.vote_type = 1 THEN 1 ELSE 0 END),
    downvotes = downvotes + (CASE WHEN new.vote_type = -1 THEN 1 ELSE 0 END)
  WHERE id = new.knowledge_id;
END;

CREATE TRIGGER update_kb_votes_after_vote_delete
AFTER DELETE ON knowledge_votes
BEGIN
  UPDATE knowledge_base SET 
    upvotes = upvotes - (CASE WHEN old.vote_type = 1 THEN 1 ELSE 0 END),
    downvotes = downvotes - (CASE WHEN old.vote_type = -1 THEN 1 ELSE 0 END)
  WHERE id = old.knowledge_id;
END;

-- Actualizar view_count
CREATE TRIGGER increment_kb_view
AFTER INSERT ON knowledge_views  -- tabla auxiliar si se trackea
BEGIN
  UPDATE knowledge_base SET view_count = view_count + 1 WHERE id = new.knowledge_id;
END;
```

## Vistas Útiles
```sql
-- Vista para frontend: items verificados + populares
CREATE VIEW v_knowledge_public AS
SELECT 
  id, summary, subject, topic, difficulty, 
  upvotes, downvotes, view_count, tags,
  (upvotes - downvotes) as net_score,
  created_at
FROM knowledge_base
WHERE is_verified = 1
ORDER BY net_score DESC, view_count DESC;

-- Vista para admin: pendientes de verificación
CREATE VIEW v_knowledge_pending AS
SELECT 
  id, content, summary, subject, topic, source_type,
  source_user_id, tags, created_at,
  (SELECT username FROM users WHERE id = source_user_id) as contributor
FROM knowledge_base
WHERE is_verified = 0
ORDER BY created_at ASC;
```

## Migración desde Datos Existentes (chat_logs → knowledge_base)
```sql
-- Script one-time para poblar KB inicial desde conversaciones valiosas
INSERT INTO knowledge_base (id, content, summary, subject, topic, source_type, tags, embedding_model, embedding_dims, content_hash)
SELECT 
  lower(hex(randomblob(16))) as id,
  c.content || '\n\n---\n\n' || a.content as content,
  substr(c.content, 1, 180) || '...' as summary,
  c.subject as subject,
  -- Extraer topic via keywords (simplificado)
  CASE 
    WHEN c.content LIKE '%deriv%' THEN 'derivadas'
    WHEN c.content LIKE '%integral%' THEN 'integrales'
    WHEN c.content LIKE '%fuerza%' OR c.content LIKE '%newton%' THEN 'dinamica'
    ELSE 'general'
  END as topic,
  'user_qa' as source_type,
  '["importado", "chat-history"]' as tags,
  'nvidia/nv-embed-v1' as embedding_model,
  4096 as embedding_dims,
  lower(hex(sha256(c.content || a.content))) as content_hash
FROM chat_logs c
JOIN chat_logs a ON a.session_id = c.session_id 
  AND a.role = 'assistant' 
  AND a.created_at > c.created_at
WHERE c.role = 'user'
  AND c.subject IS NOT NULL
  AND length(c.content) > 50
  AND length(a.content) > 100
  AND NOT EXISTS (SELECT 1 FROM knowledge_base kb WHERE kb.content_hash = lower(hex(sha256(c.content || a.content))));
```

## Tipos TypeScript
```typescript
// backend/src/types/knowledge.ts
export interface KnowledgeBaseItem {
  id: string;
  content: string;
  summary: string | null;
  subject: string;
  topic: string | null;
  difficulty: 'basico' | 'intermedio' | 'avanzado';
  source_type: 'user_qa' | 'user_explanation' | 'verified_content' | 'imported';
  source_user_id: string | null;
  is_verified: boolean;
  verified_by: string | null;
  verified_at: string | null;
  upvotes: number;
  downvotes: number;
  view_count: number;
  tags: string[];
  language: string;
  embedding_model: string;
  embedding_dims: number;
  content_hash: string;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeSearchParams {
  query?: string;
  subject?: string;
  topic?: string;
  difficulty?: string;
  verified_only?: boolean;
  min_score?: number;           // net_score = upvotes - downvotes
  tags?: string[];
  limit?: number;
  offset?: number;
}
```