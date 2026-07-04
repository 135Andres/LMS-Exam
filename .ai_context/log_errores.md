# Bitácora de Lecciones Aprendidas — LMS Exam

> Registro indexado de micro-lecciones. Consultar ANTES de implementar cualquier cambio.
> Formato: `[LECCIÓN-XXX][Módulo] Causa -> Solución | Qué NO repetir`

## Categorías

| Tag | Módulo |
|-----|--------|
| [AUTH] | Autenticación / JWT / Cookies / Sesión |
| [EXAM] | Generación / CRUD / Ad-tokens |
| [AI] | NVIDIA API / Prompts / Parsing de respuestas |
| [DB] | SQLite / Migraciones / Queries |
| [FRONT] | UI / Render / API client |
| [ADMIN] | Panel admin / Estadísticas |
| [CONFIG] | Middleware / Rate-limit / Seguridad |
| [BUILD] | Deploy / Docker / CI |

---

## Registro de Lecciones

| ID | Módulo | Problema | Causa Raíz | Solución | No Repetir |
|----|--------|----------|------------|----------|------------|
| LECCIÓN-005 | AI | Reintentos en AI service: múltiples temperaturas + timeout + parse retry | Sin reintentos, un solo error de API o parse dejaba al usuario sin examen. | Implementar 2 capas: (1) en `ai/index.ts` retry con temps [0.3, 0.5, 0.7] + AbortController timeout 30s para errores de red/HTTP/timeout; (2) en `exam.service.ts` retry de parse con mismo prompt + `IMPORTANTE: Responde SOLO con un array JSON`. Throw `AiRetryError` con contador de intentos. | No confiar en un solo intento de IA. Proveer fallback con temperatura variada. El parse error es del contenido, no del transporte — retry separado. |
| LECCIÓN-004 | AI | Prompts genéricos producían preguntas repetitivas, poco KaTeX, y formato JSON inconsistente | Prompt original tenía reglas genéricas sin ejemplos concretos de KaTeX ni especificación de dificultad. | Agregar instrucciones específicas: escape de \\\\, $$ vs $, dificultad 30/40/30, opciones autónomas, sin markdown fences. Agregar `SYSTEM_PROMPT_CORRECCION` como respaldo. | No asumir que la IA entiende "buen formato" sin ejemplos explícitos. |
| LECCIÓN-003 | FRONT | Timer de anuncio no respetaba cambio de pestaña | `setInterval` seguía corriendo aunque el usuario cambiara de pestaña, consumiendo CPU y engañando el contador. | Implementar timer con Page Visibility API: pausar con `clearTimeout` al ocultar, reanudar con `tickTimer()` al mostrar. Usar `setTimeout` recursivo en vez de `setInterval`. | No usar `setInterval` para timers que deben pausarse por visibilidad. Usar `setTimeout` recursivo + `document.hidden`. |
| LECCIÓN-002 | FRONT | Flujo ad-token bypass: generar sin ver anuncio | `manejarGenerarExamen()` llamaba `API.generateExam()` inmediatamente después de obtener el token, sin mostrar anuncio al usuario. | Separar en 2 fases: (1) requestAdToken → mostrar overlay con timer de 8s, (2) botón "Continuar" → generateExam(token). Estado pendiente en variables `pendingAdToken`/`pendingExamParams`. | No generar el examen inmediatamente tras obtener el token. Siempre mostrar un paso intermedio de anuncio. |
| LECCIÓN-001 | AUTH | Login 401 + servidor crasheado | 1) Admin fue creado con email `admin@exies.com` (seed anterior), pero doc y seed actual usan `admin@lmsexam.com`. 2) Errores async en Express 4 no se capturan automáticamente, crasheando el proceso. | 1) Actualizar email en DB vía UPDATE. 2) Instalar `express-async-errors` e importar al inicio de server.js. 3) Cambiar `throw` en validate.js por `next(err)`. | No asumir que el email en DB coincide con seed/doc; siempre verificar. No usar `throw` en middleware async sin `express-async-errors`. |
| <!-- Insertar nuevas lecciones al INICIO de la tabla, manteniendo IDs secuenciales --> |
