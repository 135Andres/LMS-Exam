# LMS Exam

Plataforma modular de estudio universal impulsada por agentes de IA. Web multimodal para chatear, procesar apuntes/imágenes y generar tests dinámicos mediante NVIDIA AI y RAG con SQLite + embeddings vectoriales. Backend en TypeScript y auth OTP en Python/FastAPI. Con el objetivo de crear una base de conocimiento colectiva.

## Qué es

Un tutor de IA conversacional (chat multimodal: texto, imágenes, audio) que además:

- Genera exámenes de opción múltiple con KaTeX, RAG híbrido (historial personal + conocimiento colectivo validado por IA) y orquestación de modelos (Inkling como base, delegación a GLM/Sonnet/Gemini Pro según complejidad del mensaje).
- Detecta cuestionarios pegados en el chat y ofrece resolverlos completos (con verificación doble) o guiar paso a paso sin adelantarse.
- Recuerda perfil, preferencias de tono y resúmenes comprimidos de cada conversación para no perder contexto.
- Dashboard con progreso, adjuntos por drag-drop, modo examen.

## Stack

- **`backend/`** — Node/TypeScript, Express, better-sqlite3, vitest. API principal: chat, embeddings, exámenes, KB colectiva, cron jobs.
- **`backend-python/`** — FastAPI. Solo auth: login por OTP (correo), whitelist, sesión.
- **`public/`** — frontend vanilla JS, sin build step. Una página HTML por feature (`login.html`, `dashboard.html`, `chat.html`).
- IA vía 9router (NVIDIA NIM / multi-provider), embeddings NVIDIA, SQLite como vector store.

## Instalación

Requisitos: Node ≥20, Python 3.10+, `pip`.

```bash
# backend Node
cd backend
npm install
cp .env.example .env   # rellenar NINE_ROUTER_API_KEY, NVIDIA_API_KEY_EMBEDDINGS, JWT_SECRET
npm run migrate

# backend Python (auth)
cd ../backend-python
pip install -r requirements.txt
```

Variables mínimas en `backend/.env` (ver `.env.example` para el resto, todo lo demás tiene default):

```
NINE_ROUTER_API_KEY=
NVIDIA_API_KEY_EMBEDDINGS=
JWT_SECRET=
```

## Correrlo

```bash
cd backend
npm run dev:all      # levanta Python (auth, :3001) + Node (API, :3000) juntos
```

O por separado: `npm run dev` (Node) / `npm run dev:python` (auth).

Frontend: servir `public/` estático (o abrir directo si el backend ya sirve esa carpeta) — entra por `login.html`.

Tests: `npm test` (backend). Typecheck: `npm run typecheck`.

## Log rápido (lo último que hice)

- **Clasificación de materia por especificidad**: `detectSubjectByKeywords` pasó de "primera materia que matchee, en orden de diccionario" a un score ponderado (frase de 2+ palabras > keyword técnica > keyword suelta genérica marcada `weak`), con `confidence: 'high'|'low'` expuesto. Arregla falsos positivos reales (ej. "Movimiento Romántico" caía en física por la palabra suelta "movimiento" antes de llegar a artes). El routing por mensaje (`chat.orchestrator.service.ts`) solo usa la heurística mejorada, sigue síncrono. La extracción de bloques de conocimiento (`chat.block-extraction.service.ts`) ahora sí manda la materia a la IA cuando la heurística viene con `confidence: 'low'` o sin materia — reusando el mismo batch que ya generaba títulos, sin llamada extra — dejando de ser aspiracional ("IA solo para casos ambiguos" ya es real, pero limitado a block-extraction, no al routing).
- **Orquestador de IA**: Inkling (`nvidia/thinkingmachines/inkling`) como modelo base con effort dinámico, delegación automática a GLM 5.2 (código), Claude Sonnet (alta complejidad) o Gemini Pro (alta complejidad + contexto RAG largo). Clasificador heurístico sin llamadas de red, extendido a 19 materias.
- **Fix de timeout**: Inkling tarda ~40s en el primer byte y hasta 150s+ en respuestas reales (modelo de razonamiento pesado) — el timeout de 30s lo abortaba siempre. Subido a 120s. De paso salió un segundo bug: el fallback a modelo de respaldo reusaba el mismo `AbortController` ya abortado y moría instantáneo también — cada intento ahora tiene el suyo.
- **Cuestionarios**: detección automática de bloques de ejercicios pegados en el chat, con dos flujos — **Responder** (resuelve todo, verifica dos veces, reintenta hasta 3 veces, nunca da error duro) y **Explicar** (guía paso a paso sin adelantarse, botón "Siguiente paso").
- **Bugs de producción cerrados**: la respuesta de la IA se cancelaba al cambiar de chat (crash de proceso por escribir en un socket cerrado sin manejar el error), el formato del mensaje del usuario no respetaba saltos de línea, y el LaTeX sin escapar rompía el parseo JSON de los cuestionarios resueltos.
- **Prompt del tutor recortado**: de 13 directrices a solo formato (KaTeX, backticks, párrafos/negritas obligatorios) + detección de cuestionarios. Se quitaron tono, identidad forzada, estrategia pedagógica y el filtro de contenido — Inkling ya trae su propia seguridad, no hacía falta duplicarla en el prompt.
- **Modo admin**: sin restricciones de contenido para la cuenta de administrador (ahora, sin filtro para nadie — ver punto anterior).
