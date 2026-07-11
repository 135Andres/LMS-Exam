# ARQUITECTURA #1: Chat Service - Acoplamiento Fuerte (God Class)

## ESTADO
Bug confirmado en código (`chat.service.ts` = 288 líneas, 7+ responsabilidades)

## OBJETIVO ESPECÍFICO
Dividir `chat.service.ts` (288 líneas, 7 responsabilidades) en servicios cohesivos. Hacer la fachada testable con mínimo de mocks.

## PROBLEMA ACTUAL

**Responsabilidades mezcladas en UN archivo:**
| Responsabilidad | Líneas actuales | Debería estar en |
|-----------------|-----------------|------------------|
| Persistencia mensajes | 146-148, 234-236, 279-280 | `ChatPersistenceService` |
| Generación embeddings | 150-156, 239-244 | `EmbeddingService` |
| Construcción contexto RAG | 50-69, 159, 247 | `RAGService` |
| Detección edición perfil | 103-131, 172, 260 | `ProfileDetectionService` |
| Selección/routing modelos | 39-48, 140, 221 | `ModelRouter` |
| Streaming + timeout + persistencia respuesta | 133-212 | `StreamingService` |
| Non-streaming + error handling | 214-288 | `CompletionService` |
| System prompt building | 71-84 | `PromptService` |
| Content building (multimodal) | 86-100 | `PromptService` |
| Variable regex (PROFILE_EDIT_REGEX) | 17, 103 | `ProfileDetectionService` |

**Acoplamientos problemáticos (imports actuales):**
```
chat.service importa: generateFromAI, callNvidiaStream, parseNvidiaStream,
generateEmbedding, config, modelRegistry, SYSTEM_PROMPT_TUTOR, ChatModel,
EmbeddingModel, ProfileService, findTopK, logger
```

**Consecuencias:**
- Cambiar proveedor embedding → tocar chat.service
- Cambiar lógica RAG → tocar chat.service
- Testear chat.service = mockear 12+ dependencias
- Difícil entender el flujo: 288 líneas mezclando DB, API, RAG, promtps, streaming

## SOLUCIÓN: Arquitectura por Servicios + Fachada

### Estructura nueva

```
backend/src/services/chat/
├── chat.persistence.service.ts      # Solo DB: save/get messages, sessions
├── chat.embedding.service.ts        # Embeddings: generate, save, outbox enqueue
├── chat.rag.service.ts              # RAG: buildContext, findSimilar
├── chat.profile-detection.service.ts # Profile edit: regex, classify, append
├── chat.model-router.ts             # Models: resolve, validate, fallback
├── chat.prompt.service.ts           # System prompts + content arrays
├── chat.streaming.service.ts        # Stream: callNvidiaStream, SSE, persist chunks
├── chat.completion.service.ts       # Non-stream: generateFromAI, handle errors
└── chat.service.ts                  # FACHADA: orquesta los servicios arriba
```

### 1. ChatPersistenceService

```typescript
// chat.persistence.service.ts
import { ChatModel } from '../../models/chat.model.js';
import { EmbeddingOutboxModel } from '../../models/embedding-outbox.model.js';
import { v4 as uuidv4 } from 'uuid';

export class ChatPersistenceService {
  saveUserMessage(msgId: string, userId: string, sessionId: string, content: string) {
    ChatModel.saveMessage(msgId, userId, sessionId, 'user', content);
  }

  saveAssistantMessage(msgId: string, userId: string, sessionId: string, content: string) {
    ChatModel.saveMessage(msgId, userId, sessionId, 'assistant', content);
  }

  // Guardar mensaje + encolar embedding a outbox (transaccional)
  saveUserMessageWithOutbox(userId: string, sessionId: string, content: string): string {
    const msgId = uuidv4();
    this.saveUserMessage(msgId, userId, sessionId, content);
    EmbeddingOutboxModel.enqueue(uuidv4(), msgId, userId, content, 'user');
    return msgId;
  }

  saveAssistantMessageWithOutbox(userId: string, sessionId: string, content: string): string {
    const msgId = uuidv4();
    this.saveAssistantMessage(msgId, userId, sessionId, content);
    EmbeddingOutboxModel.enqueue(uuidv4(), msgId, userId, content, 'assistant');
    return msgId;
  }

  getSessionMessages(sessionId: string, limit?: number) {
    return ChatModel.getSessionMessages(sessionId, limit);
  }
}
```

### 2. ChatEmbeddingService

```typescript
// chat.embedding.service.ts
import { generateEmbedding } from '../../utils/ai.js';
import { EmbeddingModel } from '../../models/embedding.model.js';
import { EmbeddingOutboxModel } from '../../models/embedding-outbox.model.js';
import { EmbeddingWorker } from '../../workers/embedding-worker.js';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';

export class ChatEmbeddingService {
  // Generar embedding inline (best-effort para RAG inmediato)
  async generate(text: string): Promise<number[] | null> {
    try {
      return await generateEmbedding(text);
    } catch (err) {
      logger.warn('Embedding inline falló', { error: (err as Error).message });
      return null;
    }
  }

  // Generar y guardar embedding (si success, marcar outbox como done)
  async generateAndSave(msgId: string, userId: string, text: string, outboxId?: string): Promise<number[] | null> {
    const vector = await this.generate(text);
    if (vector) {
      try {
        EmbeddingModel.saveEmbedding(uuidv4(), msgId, userId, vector, config.embeddings.model, config.embeddings.dimensions);
        // Si vino del outbox, marcar como done (no procesar de nuevo)
        if (outboxId) EmbeddingOutboxModel.markDone(outboxId);
      } catch (err) {
        logger.warn('Error guardando embedding inline', { error: (err as Error).message });
      }
    }
    return vector;
  }

  // Delegar al worker (para tests.manuales o admin)
  async processOutboxBatch(): Promise<number> {
    return await EmbeddingWorker.processOutbox();
  }
}
```

### 3. ChatRAGService

```typescript
// chat.rag.service.ts
import { EmbeddingModel } from '../../models/embedding.model.js';
import { findTopK } from '../../utils/vector.js';
import { logger } from '../../utils/logger.js';

const RAG_MIN_EMBEDDINGS = 2;
const RAG_TOP_K = 3;
const RAG_MIN_SIMILARITY = parseFloat(process.env.RAG_MIN_SIMILARITY || '0.35');

export class ChatRAGService {
  async buildContext(userId: string, excludeMessageId: string, queryVector: number[]): Promise<string> {
    try {
      const pastEmbeddings = EmbeddingModel.getUserEmbeddings(userId, 100);
      const filtered = pastEmbeddings.filter(e => e.messageId !== excludeMessageId);
      if (filtered.length < RAG_MIN_EMBEDDINGS) return '';

      const topK = findTopK(queryVector, filtered, RAG_TOP_K, RAG_MIN_SIMILARITY);
      if (topK.length === 0) return '';

      logger.debug('RAG context recuperado', {
        total_embeddings: filtered.length,
        items_used: topK.length,
        min_score: topK[topK.length - 1].score.toFixed(3),
        max_score: topK[0].score.toFixed(3),
      });

      const contextParts = topK.map((item, i) => {
        const role = (item as any).role === 'assistant' ? 'Tu explicación anterior' : 'Pregunta anterior';
        return `[Contexto ${i + 1}] (${role}, relevancia: ${(item.score * 100).toFixed(0)}%)\n${item.content}`;
      });

      return `\n\n--- Contexto de conversaciones anteriores ---\n${contextParts.join('\n\n')}\n---`;
    } catch (err) {
      logger.warn('Error generando RAG context', { error: (err as Error).message });
      return '';
    }
  }
}
```

### 4. ChatProfileDetectionService

```typescript
// chat.profile-detection.service.ts
import { generateFromAI } from '../../utils/ai.js';
import { ProfileService } from './profile.service.js';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { SYSTEM_PROMPT_CLASSIFIER } from '../prompts/classifier-prompts.js';

const PROFILE_EDIT_REGEX = /\b(?:quiero que|cambia mi|actualiza mi|prefiero que|configura mi|ajusta mi|modifica mi)\b/i;

const PROFILE_EDIT_WHITELIST = [
  /^explícame /i, /^qué es /i, /^qué son /i, /^cómo /i, /^por qué /i,
  /^dame /i, /^muestra /i, /^ayuda/i, /^gracias/i, /^ok/i, /^vale/i,
  /^entendido/i, /^perfecto/i, /^ahora (entiendo|veo|sí|comprendo)/i,
  /modo (examen|práctica|estudio|sargento)/i, /^evita /i, /^habla /i,
];

function isProfileEditIntent(message: string): boolean {
  if (PROFILE_EDIT_WHITELIST.some(r => r.test(message))) return false;
  return PROFILE_EDIT_REGEX.test(message);
}

export class ChatProfileDetectionService {
  async detectAndApply(message: string, userId: string): Promise<string | null> {
    if (!isProfileEditIntent(message)) return null;

    try {
      const result = await generateFromAI('nvidia', SYSTEM_PROMPT_CLASSIFIER, message, {
        type: 'json_object',
        json_schema: {
          type: 'object',
          properties: {
            update_profile: { type: 'boolean' },
            change: { type: 'string' },
          },
          required: ['update_profile'],
        },
      }, { model: config.models.chat, temperature: 0.1, max_tokens: 150 });

      const parsed = JSON.parse(result.content) as { update_profile: boolean; change?: string };
      if (parsed.update_profile && parsed.change) {
        logger.info('Perfil actualizado desde chat', { userId, change: parsed.change });
        ProfileService.appendToProfile(userId, parsed.change);
        ProfileService.invalidateCache(userId);
        return parsed.change;
      }
    } catch (err) {
      logger.warn('Error en clasificador de perfil', { error: (err as Error).message });
    }
    return null;
  }
}
```

### 5. ChatModelRouter

```typescript
// chat.model-router.ts
import { modelRegistry, config, ModelEntry } from '../../config/index.js';

export interface ResolvedModel {
  model: string;
  apiKey?: string;
  baseUrl?: string;
  label: string;
  multimodal: boolean;
  contextLength?: number;
}

export class ChatModelRouter {
  resolve(modelId?: string): ResolvedModel {
    const entry = modelId && modelRegistry[modelId] ? modelRegistry[modelId] : null;
    return {
      model: entry?.model || config.models.chat,
      apiKey: entry?.apiKey,
      baseUrl: entry?.baseUrl,
      label: entry?.label || entry?.model || config.models.chat,
      multimodal: !!entry?.multimodal,
      contextLength: entry?.contextLength,
    };
  }

  validateMultimodal(resolved: ResolvedModel, attachments?: Attachment[]): void {
    if (attachments?.length && !resolved.multimodal) {
      throw new Error(`Modelo ${resolved.label} no soporta archivos`);
    }
  }
}
```

### 6. ChatPromptService

```typescript
// chat.prompt.service.ts
import { ProfileService } from './profile.service.js';
import { SYSTEM_PROMPT_TUTOR } from '../prompts/tutor-prompts.js';
import type { Attachment } from '../../validators/chat.js';
import { v4 as uuidv4 } from 'uuid';

export class ChatPromptService {
  buildSystemPrompt(modelLabel: string, ragContext: string, userId: string): string {
    const profile = ProfileService.getProfile(userId);
    const profileText = profile
      ? `\n\n## Perfil del estudiante\n- Arquetipo: ${profile.archetype}\n- Ámbito: ${profile.examType}\n- Estilo de feedback: ${profile.feedbackStyle}\n- Nivel de exigencia: ${profile.strictness}`
      : '';
    return SYSTEM_PROMPT_TUTOR.replace('{profile}', profileText).replace('{rag}', ragContext);
  }

  buildContent(message: string, attachments?: Attachment[]) {
    const content: Array<Record<string, unknown>> = [{ type: 'text', text: message }];
    if (attachments) {
      for (const att of attachments) {
        content.push({
          type: att.type === 'image' ? 'image_url' : 'input_audio',
          image_url: { url: `data:${att.mime};base64,${att.data}` },
        });
      }
    }
    return content;
  }
}
```

### 7. StreamingService + CompletionService

```typescript
// chat.streaming.service.ts
import { callNvidiaStream } from '../../utils/ai.js';
// ... imports ...
export class ChatStreamingService {
  constructor(
    private persistence: ChatPersistenceService,
    private embedding: ChatEmbeddingService,
    private rag: ChatRAGService,
    private prompt: ChatPromptService,
    private router: ChatModelRouter,
  ) {}

  async *execute(message, modelId, attachments, userId, sessionId): AsyncGenerator<{type; content}> {
    // ... lógica extraída de sendChatMessageStream actual
  }
}

// chat.completion.service.ts
import { generateFromAI } from '../../utils/ai.js';
// ...
export class ChatCompletionService {
  constructor(same deps) {}

  async execute(message, modelId, attachments, userId, sessionId): Promise<{response: string}> {
    // ... extraído de sendChatMessage actual
  }
}
```

### 8. Fachada chat.service.ts (refactor)

```typescript
// chat.service.ts — SOLO ORQUESTA
import { ChatPersistenceService } from './chat/chat.persistence.service.js';
import { ChatEmbeddingService } from './chat/chat.embedding.service.js';
import { ChatRAGService } from './chat/chat.rag.service.js';
import { ChatProfileDetectionService } from './chat/chat.profile-detection.service.js';
import { ChatModelRouter } from './chat/chat.model-router.js';
import { ChatPromptService } from './chat/chat.prompt.service.js';
import { ChatStreamingService } from './chat/chat.streaming.service.js';
import { ChatCompletionService } from './chat/chat.completion.service.js';

const persistence = new ChatPersistenceService();
const embedding = new ChatEmbeddingService();
const rag = new ChatRAGService();
const profileDetection = new ChatProfileDetectionService();
const router = new ChatModelRouter();
const prompt = new ChatPromptService();
const streaming = new ChatStreamingService(persistence, embedding, rag, prompt, router);
const completion = new ChatCompletionService(persistence, embedding, rag, prompt, router);

export async function sendChatMessageStream(...args) {
  return streaming.execute(...args);
}

export async function sendChatMessage(...args) {
  return completion.execute(...args);
}
```

## MIGRACIÓN PASO A PASO (Sin romper)

**Importante:** Implementar DESPUÉS de los fixes críticos 1-5 (esos son cambios quirúrgicos sobre el archivo actual). Una vez dividido, futuros cambios son más simples.

1. **Crear** servicios nuevos en `services/chat/` (vacio, solo skeleton + imports)
2. **Mover** `buildRagContext` → `chat.rag.service.ts` (junto con fix #5 threshold)
3. **Mover** `detectProfileEdit` + regex + whitelist → `chat.profile-detection.service.ts` (junto con fix #4)
4. **Mover** `resolveModel` → `chat.model-router.ts`
5. **Mover** `buildSystemPrompt` + `buildContent` → `chat.prompt.service.ts`
6. **Mover** lógica streaming → `chat.streaming.service.ts`
7. **Mover** lógica non-streaming → `chat.completion.service.ts`
8. **Refactor** `chat.service.ts` → fachada que instancía e inyecta servicios
9. **Verificar** exports (`sendChatMessageStream`, `sendChatMessage`) mantienen misma signature
10. **Tests** unitarios por servicio (mocks mínimos)

## BENEFICIOS

| Aspecto | Antes | Después |
|---------|-------|---------|
| Líneas por archivo | 288 | ~50-80 cada uno |
| Mocks por test | 12+ | 1-2 |
| Cambio proveedor embedding | Toca 288 líneas | Toca 1 archivo |
| Añadir metadata a RAG | Riesgo de romper streaming | Aislado en rag.service |
| Onboarding nuevo dev | 288 líneas para entender flujo | Fachada de 30 líneas |

## ARCHIVOS A CREAR (8 nuevos) + 1 REFACTOR

```
backend/src/services/chat/
├── chat.persistence.service.ts      (NUEVO)
├── chat.embedding.service.ts        (NUEVO)
├── chat.rag.service.ts              (NUEVO)
├── chat.profile-detection.service.ts (NUEVO)
├── chat.model-router.ts             (NUEVO)
├── chat.prompt.service.ts           (NUEVO)
├── chat.streaming.service.ts        (NUEVO)
├── chat.completion.service.ts       (NUEVO)
└── chat.service.ts                  (REFACTOR: fachada)
```

## ARCHIVOS ADICIONALES (prompts extraídos)

```
backend/src/services/prompts/
├── tutor-prompts.ts                 (NUEVO: SYSTEM_PROMPT_TUTOR)
└── classifier-prompts.ts            (NUEVO: SYSTEM_PROMPT_CLASSIFIER)
```
