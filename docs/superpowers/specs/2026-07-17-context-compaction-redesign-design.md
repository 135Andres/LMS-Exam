# Sistema de compactación de contexto robusto (cero pérdida)

**Proyecto:** LMS-Exam
**Contexto:** rediseño de `backend/src/services/chat/chat.compaction.service.ts` y `session-summary.service.ts`
**Estado:** diseño aprobado — listo para plan de implementación
**Fecha:** 2026-07-17

---

## 0. Resumen ejecutivo del problema

El sistema actual de compactación tiene 5 fallas confirmadas leyendo el código:

| # | Falla | Archivo |
|---|---|---|
| 1 | El resumen se **sobrescribe completo** cada vez (`writeFileSync`), con tope de ~400 palabras — resumen-de-resumen-de-resumen, pérdida acumulativa | `session-summary.service.ts` |
| 2 | Se usa el modelo más barato del sistema (`oc/deepseek-v4-flash-free`) para una tarea que exige fidelidad | `config/index.ts` (`models.insights`) |
| 3 | El prompt pide preservar lo "relevante" sin definir el criterio — juicio subjetivo delegado a un modelo débil | `prompts/system.ts` (`SYSTEM_PROMPT_COMPACTOR`) |
| 4 | Cero verificación: no se chequea `finish_reason`, no hay segunda pasada, no se compara contra el original | `chat.compaction.service.ts` + `nineRouter.ts` |
| 5 | Los fallos se registran en log pero son invisibles para el usuario | `chat.compaction.service.ts` (catch → `logger.warn`) |

**Punto a favor:** los mensajes crudos en `chat_logs` nunca se borran al compactar. La pérdida ocurre solo en la capa de resumen, no en la fuente de verdad. Esto simplifica la solución: no hay que "recuperar" datos perdidos, hay que dejar de perderlos en la capa derivada, y dar forma de auditar/reconstruir cuando haga falta.

---

## 1. Principios de diseño (no negociables)

1. **La compactación nunca es la única copia.** El texto crudo original siempre debe ser recuperable, indexado y enlazado desde el resumen. El resumen es una vista de conveniencia, no el registro.
2. **Dos pistas separadas, no una mezclada:**
   - **Pista narrativa** (compresible, con pérdida aceptable): "de qué se habló", nivel del estudiante, dudas resueltas/pendientes, tono de la conversación. Esto SÍ se puede resumir agresivamente porque no hay una "respuesta correcta" que preservar.
   - **Pista de contenido verificable** (NO compresible): explicaciones académicas completas, definiciones, derivaciones, fórmulas, código. Esto se preserva **verbatim o casi-verbatim**, nunca se re-resume a partir de un resumen previo — siempre se extrae directo del mensaje original.
3. **Nunca resumir un resumen de una pieza de contenido verificable.** Si un bloque ya fue clasificado como "contenido verificable", en compactaciones futuras se referencia por ID, no se vuelve a pasar por el modelo para comprimirlo más.
4. **Ante la duda, conservar — no lo contrario.** El default del sistema debe ser conservador: si el clasificador de relevancia no está seguro, el contenido se marca para revisión humana, nunca se descarta en silencio.
5. **Todo resumen debe ser auditable.** Cada resumen generado debe declarar de qué mensajes/rango de tiempo salió, con qué modelo, y con qué nivel de confianza — para que un humano o una IA que lo lea después pueda rastrear hacia el original si algo no cuadra.
6. **Formato legible para humano y para IA sin ambigüedad.** Estructura fija (secciones con encabezados predecibles), no prosa libre. Nada de "resumen en texto plano" sin esquema, como está ahora.

---

## 2. Modelo de datos propuesto

Reemplazar el archivo único `data/session-summaries/{sessionId}.md` (que se sobrescribe) por una estructura **append-only** con capas:

```
data/session-summaries/{sessionId}/
  ├── narrative.md          # pista narrativa, SÍ se regenera/comprime en cada pasada
  ├── blocks/                # pista de contenido verificable, NUNCA se regenera
  │   ├── block_<uuid>.md    # una explicación/derivación/concepto completo, verbatim
  │   └── ...
  ├── index.json             # metadatos: qué mensajes cubre cada block, timestamps, confianza, estado
  └── pending_review.json    # candidatos descartados con duda — para revisión humana (ELIMINADO, ver 4.4)
```

### 2.1 `narrative.md` (pista narrativa — comprimible)

Reemplaza el `summary` actual. Formato estructurado (no prosa libre):

```markdown
## Estado de la sesión
- Materia(s): [cálculo, física...]
- Nivel percibido del estudiante: [...]
- Última actualización: 2026-07-17T14:32:00Z
- Cubre mensajes hasta: <cursor>

## Temas cubiertos
- [tema 1] — resuelto / en progreso / pendiente
- [tema 2] — ...

## Dudas pendientes
- ...

## Bloques de contenido verificable relacionados
- block_ab12: "Integración por partes — derivación completa" (ver blocks/block_ab12.md)
- block_cd34: "..."
```

Esta pista SÍ se puede volver a comprimir con cada compactación (es la única parte con pérdida aceptable), porque nunca contiene el contenido académico en sí — solo referencias a los `blocks/`.

### 2.2 `blocks/*.md` (pista de contenido verificable — NUNCA comprimida)

Cada vez que el compactador detecta una explicación académica completa (definición, derivación, ejemplo resuelto, código con explicación), se extrae como bloque independiente:

```markdown
---
id: block_ab12
subject: calculo
extracted_from_messages: [msg_101, msg_102]
extracted_at: 2026-07-17T14:32:00Z
extraction_model: <modelo usado>
confidence: high
---

# Integración por partes

[contenido extraído casi-verbatim del mensaje original, con mínima edición
 solo para quitar muletillas conversacionales — NO se parafrasea el contenido
 técnico ni se comprime]
```

Reglas para bloques:
- Se crean con el **texto del mensaje original**, no con lo que el modelo "recuerda" haber entendido. Esto elimina el riesgo de alucinación por reconstrucción.
- Una vez creado, un bloque es inmutable. Si aparece una explicación mejor/más completa del mismo tema más adelante en la conversación, se crea un bloque nuevo y se enlazan (`supersedes: block_ab12`), no se edita el original.
- Estos son exactamente el tipo de contenido candidato a `kbCandidates` (base de conocimiento colectiva) — el pipeline actual de KB puede consumir `blocks/` directamente en vez de que el modelo lo regenere en cada pasada.

### 2.3 `index.json` (metadatos auditables)

```json
{
  "sessionId": "...",
  "narrativeCompactions": [
    { "coveredUntil": "...", "model": "...", "confidence": "...", "timestamp": "..." }
  ],
  "blocks": [
    { "id": "block_ab12", "coveredMessages": ["msg_101","msg_102"], "confidence": "high" }
  ]
}
```

### 2.4 `pending_review.json` — ELIMINADO del diseño

Ver sección 4.4: con la verificación obligatoria (4.3) y el resumen visible/editable por el estudiante (sección 7), esta cola separada no aporta valor y se elimina de la estructura de datos.

---

## 3. Pipeline de compactación propuesto (reemplaza `compactSession`)

Cambio clave respecto al actual: **de una sola llamada monolítica a un pipeline de 3 pasos**, cada uno con una responsabilidad clara.

### Paso 1 — Segmentación y clasificación (por mensaje, no por sesión completa)
- Recorre los mensajes nuevos desde el cursor.
- Para cada mensaje (o grupo pregunta-respuesta), clasifica: `contenido_verificable` | `narrativo` | `ambiguo`.
- Esta clasificación puede ser heurística primero (longitud, presencia de LaTeX/código/bloques de "desarrollo paso a paso", palabras clave de explicación) y solo escalar al modelo de IA cuando la heurística no es concluyente — reduce carga y hace el comportamiento más predecible/testeable.
- **Regla de default conservador:** si la heurística y el modelo no coinciden, o el modelo devuelve confianza baja/media → clasificar como `ambiguo`, nunca como "descartar".

### Paso 2 — Extracción (solo para `contenido_verificable`)
- Para cada mensaje/grupo clasificado como contenido verificable, se extrae como bloque nuevo en `blocks/` (texto casi-verbatim del original, sin pasar por resumen).
- No requiere que el modelo "entienda todo el chat" — cada extracción es local a ese mensaje, lo que reduce drásticamente el riesgo de que el contexto grande diluya un dato puntual.

### Paso 3 — Compactación narrativa (para `narrativo`, y referencia a bloques)
- Acá sí se llama al modelo con el patrón actual (resumen previo + mensajes nuevos), pero:
  - Solo trabaja sobre la pista narrativa, nunca sobre contenido verificable.
  - El prompt se reescribe (ver sección 3.1) para eliminar la ambigüedad de "relevante".
  - El límite de palabras deja de ser un tope duro ciego — ver sección 3.2.

### Paso 4 (nuevo) — Verificación
- Ver sección 4 completa. No es opcional.

### 3.1 Rediseño del prompt del compactor

Problemas del prompt actual a corregir explícitamente:
- Reemplazar "resumen de toda la conversación **relevante**" por una instrucción sin ambigüedad: *"Resume TODO lo narrativo. Cualquier explicación técnica, derivación, definición o ejemplo resuelto NO se resume aquí — se extrae aparte, tu única obligación con eso es listarlo por referencia, nunca omitirlo."*
- Instrucción explícita anti-alucinación de ausencia: *"Si no encontrás contenido académico, tu respuesta debe listar explícitamente cuántos mensajes revisaste y por qué ninguno calificó — nunca afirmes ausencia sin mostrar el conteo."*
- Pedir que el modelo devuelva, junto al resumen, una **autoevaluación de confianza** (`confidence: high/medium/low` + lista de fragmentos que dudó en incluir/excluir). Este campo alimenta la verificación de la sección 4.3.

### 3.2 Reemplazar el tope ciego de "~400 palabras"

El tope de palabras fue diseñado para controlar costo/tamaño de contexto, pero es la causa directa de la pérdida acumulativa. Confirmado: los modelos usados son gratuitos y la prioridad es calidad, no ahorro de tokens (ver sección 9) — así que el tope deja de tener sentido como mecanismo de control de costo. Se reemplaza por:
- **Sin límite artificial de palabras.** La pista narrativa se deja crecer lo que necesite para ser fiel — el único límite real es el tamaño de contexto que cada modelo soporta técnicamente (no un costo), y eso se maneja con jerarquía (ver sección 6), no comprimiendo a la fuerza.
- Si la narrativa de una sesión individual se vuelve larga, la señal correcta sigue sin ser "comprimir más fuerte" sino dividir en más bloques con fecha — igual que antes, pero sin la presión artificial de un tope de palabras forzando la pérdida.

### 3.3 Modelo a usar — decidido dinámicamente por el modelo activo de la sesión

Se elimina `config.models.insights` como modelo fijo para compactación. En su lugar, la compactación la ejecuta la misma familia de modelo que está activa en esa sesión cuando esa familia tiene una variante liviana propia; cuando no la tiene, usa Gemini Flash como compactador cross-familia.

Justificación: el modelo activo ya demostró en esa conversación que entiende el nivel y el vocabulario específico del estudiante (fórmulas, jerga de la materia, estilo). Usar un modelo distinto para comprimir introduce una traducción innecesaria entre "cómo lo explicó el tutor" y "cómo lo entiende el compactor".

**Mapa de familia → modelo de compactación** (a partir de `AVAILABLE_MODELS` en `config/models.ts` y `DELEGATE_MODEL_MAP` en `chat.orchestrator.service.ts`):

| Modelo activo en la sesión | Modelo usado para compactar | Motivo |
|---|---|---|
| `ag/gemini-3-flash` (Gemini Flash) | `ag/gemini-3-flash` | ya es la variante liviana, se usa igual |
| `ag/gemini-3.1-pro-low` (Gemini Pro) | `ag/gemini-3-flash` | siempre la variante flash para compactar, aunque el chat esté corriendo en Pro |
| `ag/claude-sonnet-4-6` (Sonnet) | `ag/gemini-3-flash` | Sonnet no tiene variante liviana propia en el catálogo; se usa Gemini Flash cross-familia |
| `nvidia/z-ai/glm-5.2` (GLM) | `nvidia/z-ai/glm-5.2` | ídem, no hay variante liviana disponible |
| `nvidia/thinkingmachines/inkling` (Inkling, modelo base) | `nvidia/thinkingmachines/inkling` | **confirmado por el dueño del proyecto**: Inkling compacta sus propias sesiones, consistente con la regla general — aunque es el modelo más lento del catálogo, esto corre en la compactación de fondo (no bloqueante salvo cambio de modelo, ver `ensureContextForModel`), así que la latencia no afecta la respuesta al estudiante |
| `oc/deepseek-v4-flash-free` (fallback) | `oc/deepseek-v4-flash-free` | ya es flash |

**Implementación:** este mapa reemplaza el uso fijo de `config.models.insights` en `chat.compaction.service.ts`. La sesión ya guarda el último modelo usado (`ChatModel.getLastAssistantModel(sessionId)`), así que la función de compactación puede resolver el modelo correspondiente sin pedir información nueva al usuario — solo agregar la tabla de mapeo (`COMPACTION_MODEL_MAP`) junto al `DELEGATE_MODEL_MAP` existente.

- Como los modelos son gratuitos, ya no hay razón de costo para mantener un modelo fijo barato "por defecto" — la única razón real detrás del compactador actual (`deepseek-v4-flash-free`) era el costo, y esa razón ya no aplica.

---

## 4. Verificación y salvaguardas (Paso 4 del pipeline)

Esta es la pieza que el sistema actual no tiene en absoluto.

### 4.1 Verificación de truncamiento (barata, siempre activa)
- Revisar `finish_reason` de la respuesta del modelo. Si es `length` (se cortó por `max_tokens`) → **nunca aceptar esa salida como final**. Reintentar con presupuesto mayor o dividir el trabajo en un lote más chico.
- Fix más barato y de mayor impacto: hoy el sistema no lo chequea en absoluto (`nineRouter.ts`).

### 4.2 Verificación de cobertura (chequeo mecánico, sin IA)
- Antes de aceptar un resultado de compactación, comparar: ¿el número de mensajes de entrada coincide con lo que el modelo dice haber revisado? ¿El resumen narrativo menciona al menos un tema por cada mensaje largo (>N caracteres) de la entrada, o lo justifica explícitamente como descartado?
- Si no hay correspondencia → no se acepta el resultado, se reintenta.

### 4.3 Segunda opinión — obligatoria en TODA compactación

Dado que no hay presupuesto de tokens ni restricción de costo, esta salvaguarda no es condicional: **cada compactación pasa siempre por una segunda llamada de verificación**.

- La segunda llamada la hace un modelo de **otra familia** distinta a la que compactó (si Gemini Flash compactó, verifica GLM o Sonnet, no Gemini de nuevo).
- Pregunta específica al verificador: *"Acá está la conversación original y este es el resumen que otro modelo generó. ¿Falta algo? ¿Hay alguna explicación, derivación o dato técnico del original que no está reflejado ni en la narrativa ni en los bloques extraídos?"*
- Si el verificador señala algo faltante → se agrega directo (no se descarta ni se manda a cola de revisión separada, ver 4.4).

### 4.4 Nunca borrar, siempre dejar corregible

Se elimina `pending_review.json` como cola separada de moderación. Con la verificación obligatoria de 4.3 y el resumen visible/editable directamente por el estudiante (sección 7), una cola de revisión aparte deja de tener sentido: el propio estudiante detecta y corrige cualquier cosa que el sistema haya dejado afuera al leer su resumen.

Lo que sí se mantiene: nada se borra nunca como resultado de una compactación. Si un fragmento no calificó como contenido verificable, simplemente no genera un bloque — pero el mensaje original sigue intacto en `chat_logs` y siempre es la fuente de verdad si hay que reconstruir algo.

- El pipeline de `kbCandidates` (base de conocimiento colectiva) mantiene su propio `status: 'pending_review'` como está hoy — eso es aparte, contenido compartido con otros estudiantes que amerita moderación explícita antes de publicarse. No confundir los dos flujos.

### 4.5 Visibilidad para el usuario
- El endpoint `/resumen` deja de devolver solo el texto del resumen. Debe devolver también: cuántos bloques verificables se extrajeron y si la última compactación falló en el pasado.
- La visibilidad principal es la sección nueva en el sidebar de la sesión (sección 7).

---

## 5. Detectar alucinación de ausencia vs. genuinamente no hay contenido

1. El prompt nunca debe permitir una respuesta tipo "no había nada académico" sin acompañarla de: cuántos mensajes había, y una clasificación explícita mensaje por mensaje (aunque sea breve) de por qué ninguno calificó.
2. Si eso no se puede producir, el sistema lo trata como fallo, no como resultado válido — reintenta.
3. (Fase 2, opcional) Chequeo heurístico previo sin IA: ¿hay bloques de código, LaTeX (`$...$`, `$$...$$`), o mensajes de más de N palabras del asistente? Si sí, y el modelo dice "no hay nada académico", eso es contradicción mecánicamente detectable → forzar reintento, sin gastar una llamada adicional a IA para la primera señal de alarma.

---

## 6. Compatibilidad con foldering jerárquico futuro (estilo Obsidian)

No se implementa ahora, pero el diseño ya es compatible:

- La separación narrativa/verificable es la misma en cualquier nivel del árbol. Una carpeta que contiene 10 chats agrega sus `blocks/` por referencia (no por copia) y compacta solo la capa narrativa de nivel-carpeta a partir de las narrativas de nivel-chat, no de los mensajes crudos.
- Evita "compactar la compactación" en cascada: cada nivel jerárquico comprime la narrativa del nivel de abajo (ya liviana y estructurada), nunca vuelve a tocar el contenido verificable original.
- Estructura futura sugerida (sin implementar todavía):

```
data/session-summaries/
  folder_<uuid>/
    narrative.md          # compactación de las narrativas de los chats/subcarpetas hijas
    index.json             # qué chats/subcarpetas cubre, con sus propios cursores
    # blocks/ a nivel carpeta NO se generan de cero — es un índice que
    # referencia blocks/ de los chats hijos, evitando duplicación
```

- `index.json` a nivel sesión usa IDs estables (`block_<uuid>`) para que sean referenciables desde un nivel superior sin necesidad de reescritura.

---

## 7. UI: resumen de sesión visible y editable en el sidebar

Encaja con el patrón existente en `public/js/chat.js`: el panel lateral de información de sesión (`contextPanel`, donde vive "Notas rápidas" / mensajes fijados, alrededor de `renderPinnedSection` y `session-info-grid`) ya tiene el patrón de sección desplegable a replicar.

Sección nueva, **"Resumen de la sesión"**, al mismo nivel que "Notas rápidas" dentro de `contextPanel`.

### 7.1 Comportamiento
- Desplegable igual que "Notas rápidas": colapsada por default, se expande al click, con un contador (bloques de contenido verificable) igual que `pinnedMessagesCount`.
- Al expandir, muestra `narrative.md` renderizado (Markdown → HTML, reusar renderer existente de KaTeX/Markdown) más la lista de `blocks/*.md` como sub-ítems clickeables — click en un bloque lo muestra completo, igual patrón a `jumpToPinnedMessage` pero mostrando contenido en vez de saltar al mensaje.
- Botón "Editar" que convierte el área en `<textarea>` editable (Markdown plano) con "Guardar"/"Cancelar".

### 7.2 Backend necesario (nuevo)
- `GET /api/chat/summary?sessionId=...` — devuelve `narrative.md` + lista de `blocks/` (id, título, subject) para esa sesión. Puede extender el `summarizeSessionHandler` existente en vez de ser endpoint nuevo.
- `PUT /api/chat/summary` — recibe `sessionId` + Markdown editado, sobrescribe `narrative.md`. Esta es la ÚNICA escritura directa sobre `narrative.md` sin pasar por el modelo — edición manual del estudiante es más confiable que cualquier compactación automática, no necesita verificación (4.3) ni pipeline de IA.
- La próxima compactación automática parte de ESE texto editado como "resumen previo" — `narrative.md` sigue siendo la única fuente para "resumen previo" en el Paso 3, ahora puede haber sido tocada por el estudiante además de por el modelo.

### 7.3 Por qué esto simplifica el resto del diseño
Ver 4.4: al ser el resumen visible y editable por el estudiante, no hace falta cola de revisión separada — el estudiante cumple ese rol la próxima vez que abre el panel.

---

## 8. Plan de implementación por fases

**Fase 1 — Fundamentos sin romper lo existente**
1. Chequeo de `finish_reason` en `nineRouter.ts`, rechazar/reintentar respuestas truncadas (4.1).
2. Reescribir `SYSTEM_PROMPT_COMPACTOR` con reglas anti-ambigüedad y anti-alucinación de ausencia (3.1, 5).
3. Reemplazar `config.models.insights` fijo por `COMPACTION_MODEL_MAP` dinámico (3.3) — Inkling confirmado, sin bloqueos.
4. Quitar el tope de "~400 palabras" del prompt (3.2).

**Fase 2 — Modelo de datos de dos pistas**

**Implementada** — ver `docs/superpowers/plans/2026-07-18-compaction-fase2-two-track.md` y commits `8edbe9b..242e685` en la rama `compaction-fase2-two-track`. Esa fase de implementación (llamada "Fase 2" en el plan) cubrió secciones 2, 3 y 4 de este spec de punta a punta, incluyendo los puntos 5-8 de abajo (el pipeline pasó de 3 a 4 pasos al integrar la verificación cruzada del punto 8 como paso obligatorio, no condicional). Pendiente de esa franja: el punto 9 (`summarizeSessionHandler`/`/resumen` devolviendo bloques) queda para Fase 4, junto con la UI.

5. Migrar `session-summary.service.ts` de archivo único a `narrative.md` + `blocks/` + `index.json` (sección 2). Migración de resúmenes existentes: quedan como `narrative.md` inicial, sin `blocks/` retroactivos.
6. Implementar pipeline de 3 pasos (segmentación → extracción → compactación narrativa) en `chat.compaction.service.ts` (sección 3).

**Fase 3 — Verificación activa (siempre, no condicional)**
7. Chequeo de cobertura mecánico (4.2).
8. Segunda opinión obligatoria con modelo de otra familia en TODA compactación (4.3).
9. Actualizar `summarizeSessionHandler` (`/resumen`) para devolver también los bloques extraídos (4.5).

**Fase 4 — UI del resumen editable**
10. Sección "Resumen de la sesión" en `contextPanel`, junto a "Notas rápidas" (7.1).
11. `GET /api/chat/summary` y `PUT /api/chat/summary` (7.2), incluyendo que edición manual nunca pasa por verificación de IA.

**Fase 5 (futuro, no ahora) — Foldering jerárquico**
12. `folder_<uuid>/` reutilizando el mismo esquema (sección 6), una vez exista la feature de carpetas.

---

## 9. Decisiones confirmadas

- **Costo/presupuesto:** sin límite — modelos gratuitos. Se prioriza calidad sobre ahorro de tokens (afecta 3.2, 3.3, 4.3).
- **Modelo de compactación:** dinámico según el modelo activo de la sesión (sección 3.3), incluyendo Inkling compactándose a sí mismo — confirmado.
- **Cola de revisión separada (`pending_review.json`):** eliminada del diseño. Reemplazada por el resumen visible/editable en el sidebar (sección 7). No confundir con el `pending_review` de la KB colectiva (`kbCandidates`), que se mantiene igual.
