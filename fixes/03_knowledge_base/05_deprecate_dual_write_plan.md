# Plan: Deprecar Dual-Write de Embeddings

## Estado actual
- `embedding.model.ts` hace dual-write: JSON en `chat_embeddings` + BLOB en `chat_embeddings_vec`
- `getUserEmbeddings` prefiere `chat_embeddings_vec` (BLOB) y fallback a `chat_embeddings` (JSON)
- El dual-write existe como safety net desde la migración del Plan #6

## Fase 1: Verificar estabilidad (actual)
- Confirmar que `chat_embeddings_vec` (BLOB) funciona estable en producción
- Monitorear que no hay errores de lectura/escritura en BLOB
- Verificar que todas las rutas de código usan `chat_embeddings_vec` como fuente primaria

## Fase 2: Stop dual-write (futuro, post-verificación)
- Modificar `EmbeddingModel.saveEmbedding` para solo escribir en `chat_embeddings_vec`
- Mantener `chat_embeddings` (JSON) como fallback de lectura temporal
- Script de backfill para any embedding que solo exista en JSON

## Fase 3: Drop tabla JSON (futuro, post-migración completa)
- Migrar cualquier embedding restante de `chat_embeddings` a `chat_embeddings_vec`
- `DROP TABLE chat_embeddings`
- Remover fallback de `getUserEmbeddings`
- Remover `chat_embeddings` de `migrate.ts`

## Riesgo
- Si se dropea `chat_embeddings` antes de asegurar que todo embedding fue migrado, se pierden vectores
- Los embeddings son costosos (API call NVIDIA nv-embed-v1) — pérdida implica regenerar

## Recomendacion
No ejecutar Fase 2-3 en este ciclo. Documentar y dejar para post-deploy con datos reales.
