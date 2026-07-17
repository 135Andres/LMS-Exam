# Detección de cuestionario + flujo Responder/Explicar

## Objetivo

Cuando el usuario manda un bloque de ejercicios/cuestionario al tutor, la IA
en vez de resolver de una vez pregunta "¿Quieres que los responda todos o
vamos por partes?" y el frontend ofrece dos botones: **Responder** (resuelve
todo, verificado) y **Explicar** (paso a paso, sin adelantarse).

## 1. Detección y marcador

`SYSTEM_PROMPT_TUTOR` gana una directriz nueva: si el mensaje del usuario es
un bloque de ejercicios/cuestionario, responde ÚNICAMENTE con la pregunta
"¿Quieres que los responda todos o vamos por partes?" seguida del marcador
oculto `[[QUIZ_DETECTED]]` al final del texto.

Frontend (`chat.js`):
- Al renderizar un mensaje de IA, si contiene `[[QUIZ_DETECTED]]`, lo recorta
  del texto visible y en el footer de ese mensaje muestra dos botones extra
  — **Responder** / **Explicar** — en vez de (o junto a) copiar/pin/reportar.
- Guarda referencia al `userMsgId` del mensaje del usuario que contenía el
  cuestionario (ya se trackea igual que en `reexplicar`).

## 2. Flujo "Responder"

Nuevo endpoint `POST /api/chat/tutor/quiz/resolve` — no streaming (como
`sendChatMessageHandler`). Body: `{ sessionId, userMsgId }`.

Nuevo servicio `backend/src/services/chat/chat.quiz.service.ts`:

1. Recupera el texto original del cuestionario (mensaje de usuario referenciado).
2. Llama `SYSTEM_PROMPT_QUIZ_SOLVE` → la IA devuelve JSON:
   `[{ "num": 1, "pregunta": "...", "desarrollo": "...", "respuesta": "..." }, ...]`
3. Llama `SYSTEM_PROMPT_QUIZ_VERIFY` con el JSON completo → la IA devuelve
   `[{ "num": 1, "correcto": true|false, "motivo": "..." }, ...]` evaluando
   cada ítem de forma independiente.
4. Si algún ítem sale `correcto: false`: vuelve a resolver (paso 2) solo
   para esos ítems, máximo 3 intentos totales de resolución.
5. Tras un intento que pasa verificación completa, se corre la verificación
   una SEGUNDA vez (misma lógica, pasada limpia) antes de dar por bueno.
6. Si tras 3 intentos de resolución sigue habiendo ítems no verificados:
   se manda igual la última versión, agregando a esos ítems una nota
   "⚠️ No pude verificar esta respuesta con certeza, revísala con cuidado."
7. Mensaje final se arma en texto plano con formato:
   `**N.** pregunta\n\nDesarrollo: ...\n\nRespuesta: ...` por cada ítem,
   se persiste como turno normal de IA en la sesión (mismo modelo/tabla que
   cualquier respuesta del tutor) y se devuelve al frontend.

Límite de reintentos: 3 intentos de resolución total (no 3 rondas de
verify/retry infinitas) — evita loops largos/caros.

## 3. Flujo "Explicar"

No hay endpoint de stream nuevo — reusa `POST /api/chat/tutor/stream` (el
stream normal existente) con mensajes VISIBLES normales (nada de mensajes
ocultos: es más simple y es una conversación perfectamente natural que el
estudiante vea "Quiero que vayamos por partes." / "Siguiente paso." como
sus propios mensajes).

Nuevo servicio pequeño `backend/src/services/chat/chat.quiz-mode.service.ts`
(mismo patrón file-based que `SessionSummaryService`):
- `activate(sessionId)` / `isActive(sessionId)` / `deactivate(sessionId)`
- Guarda `data/quiz-mode/<sessionId>.json { active: true }`

Flujo:
1. Click en **Explicar** → frontend llama `POST /api/chat/tutor/quiz/explain-start { sessionId }`
   (activa el flag) y entonces manda, por el flujo normal de envío de
   mensaje (mismo código que si el usuario lo hubiera escrito), el texto
   "Quiero que vayamos por partes.".
2. `chat.prompt.service.ts`: si `ChatQuizModeService.isActive(sessionId)`
   es true, usa `SYSTEM_PROMPT_QUIZ_EXPLAIN` en vez de `SYSTEM_PROMPT_TUTOR`
   para ese turno (y los siguientes mientras el flag siga activo).
3. `SYSTEM_PROMPT_QUIZ_EXPLAIN`: instruye a la IA a identificar los
   ejercicios del bloque, empezar por el primero, explicar el ejercicio y
   guiar al estudiante paso a paso SIN resolverlo de un jalón — un paso por
   respuesta, sin adelantarse. El estudiante resuelve en su libreta; la IA
   NO espera que le conteste, solo continúa si el usuario dice "Siguiente
   paso." o corrige si el usuario comenta algo que se resolvió diferente.
   Al terminar los pasos de un ejercicio, el siguiente turno empieza
   automáticamente el próximo ejercicio.
4. Botón **"Siguiente paso"** aparece en cada respuesta de IA mientras el
   flag esté activo (frontend lo sabe porque activó el flag y no ha visto
   `[[QUIZ_EXPLAIN_DONE]]` todavía) → manda, por el flujo normal de envío,
   el texto "Siguiente paso.".
5. Cuando la IA terminó todos los ejercicios, agrega marcador
   `[[QUIZ_EXPLAIN_DONE]]` al final → frontend lo recorta del texto visible,
   quita el botón "Siguiente paso", y llama
   `POST /api/chat/tutor/quiz/explain-end { sessionId }` para limpiar el flag.

## Prompts nuevos (`backend/src/prompts/system.ts`)

- `SYSTEM_PROMPT_QUIZ_SOLVE`
- `SYSTEM_PROMPT_QUIZ_VERIFY`
- `SYSTEM_PROMPT_QUIZ_EXPLAIN`

## Archivos tocados/creados

- `backend/src/prompts/system.ts` — 3 prompts nuevos + directriz de detección en `SYSTEM_PROMPT_TUTOR`
- `backend/src/services/chat/chat.quiz.service.ts` — nuevo, orquesta solve/verify/retry
- `backend/src/services/chat/chat.quiz-mode.service.ts` — nuevo, flag por sesión (explicar)
- `backend/src/services/chat/chat.prompt.service.ts` — swap de system prompt si flag activo
- `backend/src/controllers/chat.controller.ts` — 3 handlers nuevos: `resolveQuizHandler`, `startQuizExplainHandler`, `endQuizExplainHandler` (frontend lo llama al detectar `[[QUIZ_EXPLAIN_DONE]]` para limpiar el flag server-side)
- `backend/src/routes/chat.routes.ts` — rutas nuevas
- `public/js/chat.js` — detección de marcadores, botones Responder/Explicar, botón Siguiente paso, mensajes ocultos

## Errores / edge cases

- `resolveQuizHandler` reusa `ChatModel.assertSessionOwnership` como los demás endpoints de chat.
- Si `userMsgId` no existe o no pertenece a la sesión → 404/403 igual que patrones existentes.
- Verificación nunca cuenta como "confirmada" si el modelo devuelve JSON malformado — se trata como fallo y cuenta como intento agotado (no crashea, cae al mensaje de "no pude verificar").
