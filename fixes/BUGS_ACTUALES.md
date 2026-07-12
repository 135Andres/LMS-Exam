# Bugs Actuales Confirmados (Post-Auditoría 2026-07-12)

Auditoría de `fixes/` contra código real. Estado del repo: `tsc --noEmit` limpio, 64/64 tests pasando (7 suites).

---

## CRÍTICA

### BUG-A1: API key de 9router expuesta en historia de git

**Severidad:** CRÍTICA — credencial real commiteada en texto plano.

**Ubicación:** Commit `4e76c77` (REPORTE_CAMBIOS.txt, removido luego en `29cf636` pero sigue en `git log --all`).

**Impacto:** Cualquiera con acceso al repo (o a un fork/push remoto) puede leer la API key de 9router en `git show 4e76c77:REPORTE_CAMBIOS.txt`. Si el repo fue pushed a un remote público o semi-público, la key ya está comprometida y debe rotarse inmediatamente en el panel de 9router.

**Evidencia:**
```
git show 4e76c77:REPORTE_CAMBIOS.txt | grep -E 'sk-[a-zA-Z0-9]'
```
Produce dos ocurrencias de la key real (`sk-f7b6a3eaea16665b-c9gyxw-512378bf`).

**Fix (irreversible — requiere decisión humana):**
1. Rotar la key en el panel de 9router ANTES de cualquier otra acción (no se reproduce la key aquí).
2. Opciones de limpieza de historia:
   - `git filter-repo --invert-paths --path REPORTE_CAMBIOS.txt` (si el repo aún es local-only)
   - `BFG --delete-files REPORTE_CAMBIOS.txt`
   - Si ya pushed a remote: `git push --force` tras el filter + coordinate con cualquier clone
3. Verificar `.env` esté en `.gitignore` (lo está, línea 3 de `.gitignore`) y que `REPORTE_CAMBIOS.txt` se mantenga sin commitear.

**Estado actual del filtro:** La key NO aparece en HEAD ni en archivos tracked en el árbol de trabajo — solo en el commit histórico `4e76c77`.

---

## ALTA

### BUG-A2: `HybridRAGService` es código muerto — no integrado en el flujo de chat

**Severidad:** Alta — feature esperada ausente en producción.

**Ubicación:** `backend/src/services/hybrid-rag.service.ts` (existente, 140 líneas).

**Evidencia:**
```
grep -r "hybridRAG\|HybridRAGService\|hybrid-rag" backend/src/
```
Solo 2 resultados, ambos auto-referencias dentro de `hybrid-rag.service.ts` (la exportación de la clase y el singleton). **Cero imports externos.**

**Impacto real:** El chat NO usa RAG híbrido. `ChatRAGService` (`backend/src/services/chat/chat.rag.service.ts`) sigue usando solo embeddings personales (`EmbeddingModel.getUserEmbeddings` + `findTopK`). La KB colectiva (tabla `knowledge_base` + `knowledge_embeddings`) nunca se consulta durante las respuestas del tutor.

No es un crash — es una feature ausente. El chat funciona con RAG personal, pero el plan prometía combinar conocimiento personal + colectivo con pesos 0.7/0.3. Si el negocio esperaba RAG híbrido en producción, esto es un incumplimiento de feature.

**Fix:**
- En `backend/src/services/chat/chat.rag.service.ts` (o `chat.streaming.service.ts`), reemplazar la llamada a `buildContext` personal por `hybridRAG.buildContext({ userId, queryVector, subject: HybridRAGService.detectSubject(message) })`.
- Validar que `KnowledgeEmbeddingModel.searchSimilar` no rompa cuando la KB está vacía (caso inicial).

---

### BUG-A3: `KnowledgeDetectionService` es código muerto — KB nunca recibe contribuciones automáticas

**Severidad:** Alta — la KB no se alimenta automáticamente del chat.

**Ubicación:** `backend/src/services/knowledge-detection.service.ts` (existente, ~140 líneas).

**Evidencia:**
```
grep -r "detectAndSuggestKnowledge\|knowledge-detection" backend/src/
```
La función `detectAndSuggestKnowledge` existe en el archivo pero **nadie la invoca** desde `chat.streaming.service.ts` ni desde ningún otro archivo del flujo de chat.

**Impacto real:** El flujo "Detectar Q&A valioso → crear draft → notificar usuario → usuario contribuye con 1-click" NO funciona. Los usuarios solo pueden acceder a la KB vía la API `/api/knowledge/items` (búsqueda), pero la contribución nunca se sugiere automáticamente — depende de que el usuario sepa Endpoint y haga POST `/contribute` manualmente con un `knowledgeId` que nadie creó.

Las rutas `/suggestions` (`backend/src/routes/knowledge.routes.ts:40`) y `/contribute` (`:46`) existen y funcionan, pero `/suggestions` retorna vacío porque ningún draft se crea en background.

**Fix:**
- En `backend/src/services/chat/chat.streaming.service.ts`, después de guardar la respuesta del assistant, llamar:
  ```typescript
  detectAndSuggestKnowledge(userId, sessionId, userMsgId, aiMsgId)
    .catch(err => logger.warn('Knowledge detection failed', { error: err.message }));
  ```
  (fire-and-forget, mismo patrón que `detectProfileEdit` corregido en BUG-6).

---

## MEDIA

### BUG-A4: Frontend de Knowledge Base no integrado en `welcome.html`

**Severidad:** Media — la feature de KB es inalcanzable para el usuario final vía UI.

**Ubicación:** `public/js/features/knowledge.js` y `public/js/features/knowledge-ui.js` existen pero no se cargan.

**Evidencia:**
```
grep -n "knowledge" public/welcome.html
```
Sin resultados — `welcome.html` no referencia ninguno de los dos archivos KB. Solo carga `welcome.js` como script normal (no `type="module"`).

**Impacto:** Consecuencia directa de BUG-A2 y BUG-A3. Aunque las rutas backend funcionan, el usuario final no tiene forma de:
- Ver sugerencias de contribución (no hay toast, no hay `openKnowledgeReviewModal`)
- Buscar/contribuir a la KB (no hay UI que llame a `GET /api/knowledge/items`)
- Ver su perfil KB / badges / leaderboard
- Votar contenido

La API funciona para quien sepa los endpoints, pero la UI es inexistente.

**Fix:** Requiere integrar `knowledge.js` + `knowledge-ui.js` en `welcome.html` (vía `<script type="module" src="...">` o reescribiendo los bindings en `welcome.js`). Bloqueado también por BUG-A5 (frontend monolítico).

---

### BUG-A5: Coverage real 29% vs meta 80% — sin gate de CI/CD

**Severidad:** Media — sin red de seguridad para futuros refactors.

**Ubicación:** `backend/vitest.config.ts` (sin `thresholds`), no existe `.github/workflows/`.

**Evidencia:**
- `npx vitest run --coverage` mide: Stmts 29.18%, Branch 16.17%, Funcs 40.5%, Lines 29.62%
- `vitest.config.ts:7-21` — sección `coverage` no incluye `thresholds` (el plan pedía `lines:80, functions:80, branches:70, statements:80`)
- `.github/` no existe en el repo
- `supertest` instalado pero sin tests de integración

64 tests pasan pero cubren solo lógica crítica (vector, profile-detection, modelos de DB, fachada). Sin tests de rutas, sin tests de nineRouter, sin tests de los servicios HybridRAG/KnowledgeDetection, sin CI que los corra en cada PR.

**Fix:**
1. Añadir `thresholds` a `vitest.config.ts` (paso 1 — fallará hasta subir coverage)
2. Tests de integración con supertest para rutas de chat (`POST /api/chat/tutor/stream`, `GET /api/chat/tutor/history`)
3. Tests unitarios para `nineRouter.ts` (mockear fetch)
4. Tests para `knowledge.routes.ts` (contribute, vote, verify, reject)
5. Workflow `.github/workflows/test.yml`: push/PR → `npm ci && npm test && npm run typecheck`
6. Subir coverage gradualmente al 80%

---

## BAJA

### BUG-A6: `nvidia.ts` es código muerto — no eliminado tras migración a 9router

**Severidad:** Baja — solo deuda técnica. No rompe nada, ocupa espacio confuso.

**Ubicación:** `backend/src/services/ai/nvidia.ts` (5252 bytes).

**Evidencia:**
```
grep -r "from.*ai/nvidia" backend/src/
```
Sin resultados. Nadie importa `nvidia.ts`. Toda la funcionalidad de chat pasó a `nineRouter.ts`. El archivo define `callNvidia`, `callNvidiaStream`, `parseNvidiaStream` que ya no se usan.

**Impacto:** Confusión para nuevos devs ("¿usamos nvidia.ts o nineRouter.ts?"). Ocupa 5KB sin función.

**Fix:** `git rm backend/src/services/ai/nvidia.ts` en un commit limpio. Validar que `tsc --noEmit` sigue limpio tras la eliminación (debería — no hay imports rotos porque no hay importers).

---

## ACLARACIÓN (no es bug — es error del plan original)

### `embeddings.ts` no fue eliminado — el plan 9router estaba equivocado

El plan `07_nine_router_migration.md` línea 87 decía "ELIMINAR `backend/src/services/ai/embeddings.ts`". **El código actual no elimina el archivo y eso es correcto.**

**Razón:** `embeddings.ts` define `generateEmbedding(text)` que llama directo a NVIDIA nv-embed-v1 (4096维度). 9router NO expone un endpoint `/embeddings` — solo enruta modelos de chat/completions. Por eso `nineRouter.ts` no incluye una función `generateEmbedding`. Los embeddings siguen yendo directo a NVIDIA API con su key separada (`NVIDIA_API_KEY_EMBEDDINGS`).

El archivo `embeddings.ts` sigue siendo importado por:
- `backend/src/routes/knowledge.routes.ts:13` (al contribuir a KB)
- `backend/src/services/chat/chat.embedding.service.ts:2`
- `backend/src/workers/embedding-worker.ts`
- `backend/src/services/knowledge-detection.service.ts`

**Acción:** No eliminar `embeddings.ts`. Corregir el plan original (marcado como ⚠️ en `07_nine_router_migration.md`) para que futuros lectores no lo confundan con un bug.

---

## RESUMEN

| ID | Severidad | Tipo | Fix recomendado |
|---|---|---|---|
| BUG-A1 | CRÍTICA | Seguridad — key expuesta en git history | Rotar key + git filter-repo |
| BUG-A2 | Alta | Feature ausente — HybridRAG código muerto | Integrar hybridRAG en chat.streaming.service.ts |
| BUG-A3 | Alta | Feature ausente — KnowledgeDetection código muerto | Llamar detectAndSuggestKnowledge en chat.streaming.service.ts |
| BUG-A4 | Media | UI ausente — KB no integrada en welcome.html | Integrar scripts KB en HTML |
| BUG-A5 | Media | Deuda técnica — coverage 29% sin CI/CD | Añadir thresholds + workflow + tests de integración |
| BUG-A6 | Baja | Deuda técnica — nvidia.ts muerto | `git rm nvidia.ts` |

**Total:** 6 bugs confirmados (1 crítica, 2 altas, 2 medias, 1 baja) + 1 aclaración.

**Prioridad de fix:** BUG-A1 (inmediato — rotar key) → BUG-A2/A3 (seguridad funcional + feature) → BUG-A5 (calidad) → BUG-A4 (UI) → BUG-A6 (cleanup).
