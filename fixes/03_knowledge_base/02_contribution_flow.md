# KNOWLEDGE BASE #2: Flujo de Contribución Automático

---

## AUDITORÍA (2026-07-12)

**VEREDICTO: ⚠️ PARCIAL**

| Ítem del plan | Estado | Ubicación / Evidencia |
|---|---|---|
| `knowledge-detection.service.ts` con `DETECTION_RULES` (qa_pair, explanation, resource_share) | ✅ COMPLETO | `backend/src/services/knowledge-detection.service.ts:1` — reglas + triggers + antiTriggers |
| `detectKnowledgeOpportunity(messages)` heurística | ✅ COMPLETO | `backend/src/services/knowledge-detection.service.ts:65` |
| `detectAndSuggestKnowledge(userId, sessionId, userMsgId, aiMsgId)` | ✅ COMPLETO | `backend/src/services/knowledge-detection.service.ts:94` |
| Integración en `chat.streaming.service.ts` (llamada fire-and-forget tras guardar respuesta IA) | ❌ NO IMPLEMENTADO | grep `detectAndSuggestKnowledge\|knowledge-detection` en `chat.streaming.service.ts` → 0 resultados. Servicio existe pero **nadie lo llama** desde el flujo de chat. Código muerto. Ver `BUGS_ACTUALES.md`. |
| `KnowledgeModel.createDraft()` con `status: 'draft'`, `tags`, `message_refs` | ⚠️ PARCIAL | `backend/src/models/knowledge.model.ts:56-64` — `createDraft` no recibe `message_refs`, solo `id/content/summary/subject/topic/tags/contentHash/status` |
| Notificación al usuario via WebSocket/SSE/NotificationService | ⚠️ PARCIAL | `knowledgeNotificationModel.queue()` existe y se usa en rutas, pero `detectAndSuggestKnowledge` no lo llama — función existe pero flujo automático conectado a `createDraft` |
| Ruta `GET /api/knowledge/suggestions` | ✅ COMPLETO | `backend/src/routes/knowledge.routes.ts:40` |
| Ruta `POST /api/knowledge/contribute` (publicar draft + embedding + +10 pts + badge seed) | ✅ COMPLETO | `backend/src/routes/knowledge.routes.ts:46-92` |
| Ruta `POST /api/knowledge/discard` | ✅ COMPLETO | `backend/src/routes/knowledge.routes.ts:94-100` |
| Frontend Toast no intrusivo (`knowledge-toast.js`) | ❌ NO IMPLEMENTADO | `public/js/features/knowledge-toast.js` no existe |
| Frontend Modal de revisión (`openKnowledgeReviewModal`) | ❌ NO IMPLEMENTADO | no existe |
| Frontend `features/knowledge/` integrado en `welcome.html` | ❌ NO IMPLEMENTADO | `welcome.html` no referencia `knowledge.js` ni `knowledge-ui.js` |
| Modelo de datos `status: draft/pending_review/published/rejected` | ✅ COMPLETO | `backend/src/db/migrate.ts:180` (CHECK constraint) |
| Vista `v_user_drafts` | ❌ NO IMPLEMENTADO | ya marcado en `01_database_schema.md` |
| Gamificación: `GamificationService.awardPoints` centralizado | ⚠️ PARCIAL | no existe clase centralizada — puntos otorgados ad-hoc en rutas (+10 contribute, +50 verify, +2 vote) |

**Resumen:**
- ✅ 5 ítems completos (servicio de detección, ruta suggestions, ruta contribute, ruta discard, modelo de datos)
- ⚠️ 3 ítems parciales (createDraft sin message_refs, notificaciones desde detección no conectada, gamificación ad-hoc)
- ❌ 6 ítems no implementados (integración en flujo chat, toast, modal, integración HTML, vista v_user_drafts, GamificationService)
- ⚠️ PARCIAL — **heurísticas y detección implementadas pero código muerto** (nadie las llama desde chat), frontend ausente

---

## OBJETIVO ESPECÍFICO
Detectar interacciones valiosas en chat y sugerir guardado a Knowledge Base con 1-click.

## FLUJO COMPLETO

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐     ┌──────────────────┐
│ Usuario pregunta│     │ Asistente responde│     │ Heurística detecta │     │ Toast: "¿Guardar  │
│ "¿Qué es deriv?"│────▶│ Explicación 500c │────▶│ Q&A valioso        │────▶│ para comunidad?"  │
└─────────────────┘     └──────────────────┘     └─────────────────────┘     └──────────────────┘
                                                                              │
                                                                              ▼
                                                                    ┌──────────────────┐
                                                                    │ Usuario click    │
                                                                    │ "Sí, guardar"    │
                                                                    └──────────────────┘
                                                                              │
                                                                              ▼
                                                                    ┌──────────────────┐
                                                                    │ POST /kb/suggest │
                                                                    │ {sessionId,      │
                                                                    │  messageIds:     │
                                                                    │  [userMsgId,     │
                                                                    │   assistantMsgId]│
                                                                    │  reason: 'qa_pair'}│
                                                                    └──────────────────┘
                                                                              │
                                                                              ▼
                                                                    ┌──────────────────┐
                                                                    │ Backend crea     │
                                                                    │ KB entry borrador│
                                                                    │ + embedding      │
                                                                    │ Devuelve preview │
                                                                    └──────────────────┘
                                                                              │
                                                                              ▼
                                                                    ┌──────────────────┐
                                                                    │ Modal confirma:  │
                                                                    │ Editar tags,     │
                                                                    │ atribución,      │
                                                                    │ "Contribuir"     │
                                                                    └──────────────────┘
                                                                              │
                                                                              ▼
                                                                    ┌──────────────────┐
                                                                    │ POST /kb/contribute│
                                                                    │ {knowledgeId,    │
                                                                    │  tags,           │
                                                                    │  allowAttribution}│
                                                                    └──────────────────┘
                                                                              │
                                                                              ▼
                                                                    ┌──────────────────┐
                                                                    │ KB entry live    │
                                                                    │ +10 pts usuario  │
                                                                    │ Badge "Semilla"  │
                                                                    └──────────────────┘
```

## HEURÍSTICAS DE DETECCIÓN (Backend)

```typescript
// backend/src/services/knowledge-detection.service.ts

interface MessagePair {
  userMessage: ChatLogRow;
  assistantMessage: ChatLogRow;
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
  resource_share: {
    // Detectar si usuario comparte link/archivo útil
    userHasAttachment: true,
    assistantAcknowledges: /^(gracias|buen recurso|útil|interesante|guardaré)/i,
  },
};

export function detectKnowledgeOpportunity(
  messages: ChatLogRow[]
): { type: 'qa_pair' | 'explanation' | 'resource_share'; pair: MessagePair; confidence: number } | null {
  // Buscar pares user->assistant consecutivos en últimos 10 mensajes
  for (let i = messages.length - 2; i >= 0; i--) {
    const userMsg = messages[i];
    const assistantMsg = messages[i + 1];
    
    if (userMsg.role !== 'user' || assistantMsg.role !== 'assistant') continue;
    
    // Q&A Pair
    if (DETECTION_RULES.qa_pair.triggers.some(r => r.test(userMsg.content)) &&
        !DETECTION_RULES.qa_pair.antiTriggers.some(r => r.test(userMsg.content)) &&
        userMsg.content.length >= DETECTION_RULES.qa_pair.minUserLength &&
        assistantMsg.content.length >= DETECTION_RULES.qa_pair.minAssistantLength &&
        assistantMsg.content.length <= DETECTION_RULES.qa_pair.maxAssistantLength) {
      
      return {
        type: 'qa_pair',
        pair: { userMessage: userMsg, assistantMessage: assistantMsg },
        confidence: 0.85,
      };
    }
    
    // Explanation (assistant da explicación larga sin pregunta explícita)
    if (assistantMsg.content.length >= DETECTION_RULES.explanation.minAssistantLength &&
        DETECTION_RULES.explanation.triggers.some(r => r.test(assistantMsg.content))) {
      return {
        type: 'explanation',
        pair: { userMessage: userMsg, assistantMessage: assistantMsg },
        confidence: 0.7,
      };
    }
  }
  return null;
}
```

## INTEGRACIÓN EN CHAT SERVICE

```typescript
// chat.service.ts - dentro de sendChatMessageStream (después de guardar respuesta IA)

} finally {
  if (fullResponse) {
    const aiMsgId = uuidv4();
    ChatModel.saveMessage(aiMsgId, userId, sessionId, 'assistant', fullResponse);
    
    // NUEVO: Detectar oportunidad de conocimiento (async, no bloquea)
    detectAndSuggestKnowledge(userId, sessionId, userMsgId, aiMsgId)
      .catch(err => logger.warn('Knowledge detection failed', { error: err.message }));
  }
}

async function detectAndSuggestKnowledge(
  userId: string, 
  sessionId: string, 
  userMsgId: string, 
  aiMsgId: string
): Promise<void> {
  // Obtener últimos 10 mensajes de la sesión
  const messages = ChatModel.getSessionMessages(sessionId, 10);
  const opportunity = detectKnowledgeOpportunity(messages);
  
  if (!opportunity) return;
  
  // Crear borrador en KB (status: 'draft')
  const knowledgeId = uuidv4();
  const content = `${opportunity.pair.userMessage.content}\n\n---\n\n${opportunity.pair.assistantMessage.content}`;
  const summary = opportunity.pair.userMessage.content.slice(0, 180) + '...';
  const subject = detectSubject(content); // keywords -> materia
  
  KnowledgeModel.createDraft({
    id: knowledgeId,
    content,
    summary,
    subject,
    source_type: 'user_qa',
    source_user_id: userId,
    tags: ['auto-detectado', subject],
    message_refs: JSON.stringify([userMsgId, aiMsgId]),
  });
  
  // Notificar al usuario via WebSocket/SSE (si conectado) o guardar para próximo poll
  NotificationService.queue(userId, {
    type: 'knowledge_suggestion',
    knowledgeId,
    preview: { summary, subject, type: opportunity.type },
    expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24h para decidir
  });
}
```

## ENDPOINTS API

```typescript
// GET /api/knowledge/suggestions - Obtener sugerencias pendientes
router.get('/suggestions', authenticate, async (req, res) => {
  const suggestions = KnowledgeModel.getDraftsByUser(req.user.id);
  res.json({ suggestions });
});

// POST /api/knowledge/contribute - Confirmar contribución
router.post('/contribute', authenticate, validate(contributeSchema), async (req, res) => {
  const { knowledgeId, tags, allowAttribution } = req.body;
  
  const draft = KnowledgeModel.getDraft(knowledgeId);
  if (!draft || draft.source_user_id !== req.user.id) {
    return res.status(404).json({ error: 'No encontrado' });
  }
  
  // Publicar: is_verified = 0 (pendiente revisión) o 1 si auto-aprobado
  const published = KnowledgeModel.publish(knowledgeId, {
    tags: [...new Set([...draft.tags, ...tags])],
    allow_attribution: allowAttribution,
  });
  
  // Generar embedding
  const vector = await generateEmbedding(published.content);
  KnowledgeEmbeddingModel.save(published.id, vector);
  
  // Gamificación
  await GamificationService.awardPoints(req.user.id, 'knowledge_created', 10);
  
  res.json({ success: true, knowledge: published });
});

// POST /api/knowledge/discard - Descartar sugerencia
router.post('/discard', authenticate, validate(z.object({ knowledgeId: z.string().uuid() })), async (req, res) => {
  KnowledgeModel.deleteDraft(req.body.knowledgeId, req.user.id);
  res.json({ success: true });
});
```

## FRONTEND: Toast No Intrusivo

```javascript
// features/knowledge/knowledge-toast.js
export function showKnowledgeSuggestion(knowledge) {
  const toast = document.createElement('div');
  toast.className = 'kb-toast';
  toast.innerHTML = `
    <div class="kb-toast-icon">💡</div>
    <div class="kb-toast-content">
      <strong>¿Guardar para la comunidad?</strong>
      <span>Detectamos una buena explicación sobre <em>${knowledge.subject}</em></span>
    </div>
    <div class="kb-toast-actions">
      <button class="btn-secondary" data-action="dismiss">Ahora no</button>
      <button class="btn-primary" data-action="review">Revisar y guardar</button>
    </div>
  `;
  
  toast.querySelector('[data-action="review"]').addEventListener('click', () => {
    openKnowledgeReviewModal(knowledge.knowledgeId);
    toast.remove();
  });
  
  toast.querySelector('[data-action="dismiss"]').addEventListener('click', () => {
    discardKnowledgeSuggestion(knowledge.knowledgeId);
    toast.remove();
  });
  
  document.body.appendChild(toast);
  // Auto-dismiss después de 15s
  setTimeout(() => toast.remove(), 15000);
}
```

## MODELO DE DATOS: Draft vs Published
```sql
-- knowledge_base tiene columna status
ALTER TABLE knowledge_base ADD COLUMN status TEXT DEFAULT 'published' 
  CHECK(status IN ('draft','pending_review','published','rejected'));

-- Drafts solo visibles para autor
CREATE VIEW v_user_drafts AS
SELECT * FROM knowledge_base 
WHERE status = 'draft' AND source_user_id = ?;
```

## AGENTE RECOMENDADO
`general` - Backend service + API + Frontend modal + gamificación.