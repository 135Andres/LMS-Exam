# Plan — Fixes pendientes (deuda técnica y bug conocido)

**Contexto:** este plan cubre 3 puntos independientes entre sí, listados como pendientes en el roadmap maestro del proyecto (`LMS-Exam`). No son features nuevas, son limpieza/corrección de cosas ya identificadas. Se pueden ejecutar en cualquier orden, pero se recomienda el orden de abajo porque va de menor a mayor riesgo.

Baseline confirmada antes de empezar: `npm test` en `backend/` da 176 passed / 1 failed (el fallo es exactamente el de la Tarea 1). `npm run typecheck` limpio.

---

## Task 1 — Arreglar test roto de `isProfileEditIntent`

**Prioridad:** primera, es la más chica y aislada.

**Archivo:** `backend/src/**/chat.profile-detection.test.ts` (ubicar con `grep -r "isProfileEditIntent" backend/src --include="*.ts" -l`)

**Pasos:**
1. Correr el test específico en aislado (`npx vitest run chat.profile-detection.test.ts`) y capturar el output completo del fallo — qué devuelve `isProfileEditIntent("habla más despacio por favor")` vs. qué se esperaba.
2. Ubicar la implementación de `isProfileEditIntent` (probablemente en `chat.profile-detection.service.ts` o similar) y entender la lógica de detección (heurística por keywords, regex, o llamada a IA).
3. Diagnosticar la causa raíz: ¿la frase no matchea ningún patrón de "editar preferencia de tono/velocidad"? ¿el test tiene una expectativa incorrecta? ¿hay un keyword faltante tipo "despacio", "lento", "velocidad"?
4. Decidir el fix correcto:
   - Si la intención real del usuario ("habla más despacio") SÍ debería detectarse como edición de perfil/preferencia → agregar el patrón/keyword faltante a la función de detección.
   - Si el test tiene una expectativa mal escrita (bug del test, no del código) → corregir el test, dejando comentario de por qué.
5. Correr el test de nuevo y confirmar que pasa. Correr la suite completa de `chat.profile-detection.test.ts` para confirmar que no rompiste otros casos ya cubiertos.
6. Documentar en el commit/PR cuál era la causa raíz (código vs. test) para que quede registrado.

**Criterio de éxito:** `npm test` pasa sin fallos en este archivo, y ningún otro test se rompe.

---

## Task 2 — Verificar y, si hace falta, migrar serialización de embeddings a BLOB Float32LE — ✅ CERRADA (confirmado, sin fix necesario)

**Hallazgo:** `chat_embeddings_vec.embedding` y `knowledge_embeddings.embedding` ya son `BLOB NOT NULL` (`backend/src/db/migrate.ts`), serializados/deserializados vía `Float32Array` + `Buffer` en `vectorToBlob`/`blobToVector` (`backend/src/models/embedding.model.ts:3-9`) y en `backend/src/models/knowledge-embedding.model.ts:25-26,55` — nada de `JSON.stringify`/`JSON.parse` en esas rutas. Las lecturas (`getVectorByMessageId`, `getUserEmbeddings`, `countByUser`) ya priorizan la tabla BLOB (`chat_embeddings_vec`) sobre la legacy `chat_embeddings` (columna `vector_text`, JSON), que solo queda como fallback de lectura para filas viejas si la tabla BLOB está vacía para esa clave. `backend/src/db/backfill-embeddings.ts` ya existe para migrar filas legacy JSON → BLOB. El gap ya estaba cerrado desde antes en main; esta tarea era investigación, no fix.

Nota de deuda técnica no accionada aquí (fuera de alcance): `saveEmbedding()` en `embedding.model.ts` sigue haciendo dual-write a la tabla legacy JSON en cada mensaje nuevo (overhead real, no solo filas viejas) — candidato a limpieza futura una vez confirmado que el backfill terminó.

**Prioridad:** segunda — es investigación primero, fix solo si aplica.

**Paso 0 — Investigar el estado real (no asumir):**
1. Ubicar dónde se guardan embeddings: `grep -r "embedding" backend/src/db backend/src/services --include="*.ts" -l`.
2. Revisar el schema de la tabla relevante (columna `embedding` o similar) — ¿es `TEXT`/`JSON` o `BLOB`?
3. Revisar el código que escribe (`INSERT`/`UPDATE`) y lee (`SELECT` + parseo) esos embeddings — confirmar si ya usa `Buffer`/`Float32Array` o si sigue usando `JSON.stringify`/`JSON.parse`.
4. Documentar el hallazgo real en un comentario o nota de retorno antes de decidir si hace falta migrar algo.

**Si ya está en BLOB Float32LE:** no hay nada que hacer — reportarlo como confirmado y cerrado en el reporte de la tarea, y listo.

**Si sigue en JSON (fix necesario):**
1. Escribir funciones de serialización/deserialización explícitas: `embeddingToBlob(vector: number[]): Buffer` (usando `Float32Array` + `Buffer.from(...)`) y `blobToEmbedding(blob: Buffer): number[]`.
2. Actualizar el schema de la tabla (migración) para que la columna sea `BLOB` en vez de `TEXT`/`JSON`. Escribir la migración en el sistema de migraciones ya existente del proyecto (revisar `backend/src/db/migrations/` o equivalente) — no alterar tablas a mano.
3. Escribir un script de migración de datos existentes: leer cada fila con embedding en formato JSON, convertirlo a BLOB, y sobreescribir. Correrlo contra una copia de la DB de desarrollo primero, nunca directo sobre producción/datos reales sin backup.
4. Actualizar todos los call sites que escriben o leen embeddings (servicios de RAG, KB colectiva, `sqlite-vec` si aplica) para usar las nuevas funciones de serialización.
5. Si `sqlite-vec` ya maneja esto internamente (confirmar en su documentación/uso actual en `backend/src/db/connection.ts`), evaluar si conviene delegarle la serialización en vez de mantener funciones propias — evitar duplicar lógica que la librería ya resuelve.
6. Tests: agregar/actualizar tests que confirmen que un vector se guarda y se recupera exactamente igual (round-trip) después del cambio de formato.
7. Correr toda la suite de tests relacionados a embeddings/RAG/KB colectiva para confirmar que las búsquedas por similitud siguen funcionando igual (mismos resultados esperados antes/después).

**Criterio de éxito:** o se confirma que ya estaba resuelto (documentar y cerrar), o la migración corre limpia, los tests de round-trip pasan, y las búsquedas de similitud devuelven los mismos resultados que antes del cambio.

---

## Task 3 — Unificar `SUBJECT_KEYWORDS` entre `chat.classifier.service.ts` y `knowledge-detection.service.ts`

**Prioridad:** tercera — la de mayor superficie de cambio, hacerla al final.

**Pasos:**
1. Localizar ambas copias: `grep -rn "SUBJECT_KEYWORDS" backend/src --include="*.ts"`.
2. Diffear manualmente las dos listas (materia por materia, keyword por keyword) y anotar las diferencias: materias que están en una y no en la otra, keywords adicionales/faltantes por materia.
3. Decidir la fuente única de verdad: crear un archivo compartido, por ejemplo `backend/src/shared/subject-keywords.ts` (o ubicación que siga la convención de carpetas ya usada en el proyecto para constantes compartidas), que exporte `SUBJECT_KEYWORDS` como única fuente.
4. Al construir la versión unificada, tomar la unión de ambas listas (no la intersección) salvo que el diff revele que alguna de las dos tenía keywords claramente erróneos o de otra materia — en ese caso, señalarlo explícitamente en el reporte para que el usuario lo confirme antes de descartar nada.
5. Actualizar `chat.classifier.service.ts` y `knowledge-detection.service.ts` para importar desde el archivo compartido, eliminando ambas copias locales.
6. Correr los tests de clasificación (`chat.classifier.service.test.ts` o equivalente) y de detección de conocimiento (`knowledge-detection.service.test.ts` o equivalente) — confirmar que el comportamiento no cambió para los casos ya cubiertos, y que los casos nuevos que la unión agrega no rompen ninguna expectativa existente (ej. un keyword que antes solo activaba una materia en un servicio, ahora activa la misma materia también en el otro — confirmar que eso es deseable).
7. Si algún test falla por un keyword que ahora matchea en un servicio donde antes no matcheaba, evaluar caso por caso si es un comportamiento correcto (era la divergencia que se quería resolver) o si conviene mantener alguna exclusión específica por servicio (poco probable, pero a chequear).

**Criterio de éxito:** una sola fuente de `SUBJECT_KEYWORDS`, ambos servicios importándola, toda la suite de tests pasando, sin duplicación de la lista en el código.

---

## Al terminar las 3 tareas

- Correr `npm test` y `npm run typecheck` completos una vez más.
- Actualizar el documento maestro del proyecto (sección 6 "Riesgos/advertencias abiertas" y sección 2.5 "Bug no relacionado") marcando cada punto como resuelto, con una línea de qué se hizo y qué se encontró (especialmente importante en la Tarea 2, donde el resultado depende de lo que se encuentre).
