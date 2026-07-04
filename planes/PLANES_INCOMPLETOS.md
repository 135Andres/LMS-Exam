# Planes Incompletos — Pendientes por Implementar

## 1. Pre-flight Verification
Arrancar servidores y probar end-to-end: login, chat persistence, RAG, setup overlay, profile editing. Compila limpio pero no se ha corrido en vivo.

## 2. Fase 2b — Archivos Adjuntos
Soporte para que el usuario suba archivos (PDF, imágenes) al chat. Backend tiene estructura de `attachments` pero frontend no implementado.

## 3. Conectar Frontend con Endpoints de Exámenes
Los endpoints existen (`GET /api/exams`, `POST /api/exams/generate`, `POST /api/exams/suggest`, etc.) pero el frontend nuevo (welcome.html) no los consume. Falta UI de generación, listado, vista de examen.

## 4. Tests Unitarios (vitest)
Sin tests en todo el proyecto. Pendiente: validators, services (chat.service, profile.service, exam.service, billing.service), controllers, middleware.

## 5. Logging a Archivo (Winston Rotación)
Actualmente solo logs en consola. Pendiente: rotación diaria en `logs/`, niveles separados (error.log, combined.log).

## 6. Panel Admin (Frontend)
Los endpoints `/api/admin/*` existen. Falta interfaz web para: listar usuarios, ver exámenes, estadísticas de uso, costos de API.

## 7. Migración de Embeddings (Licencia)
`nv-embed-v1` usa CC-BY-NC-4.0 (no comercial). Si se adopta institucionalmente, migrar a `nvidia/llama-nemotron-embed-1b-v2` y re-vectorizar.

## 8. Migrar a PostgreSQL
Si el proyecto escala más allá de cientos de usuarios, migrar de SQLite a PostgreSQL.

## 9. Soporte Multi-Proveedor AI
OpenAI GPT-4o-mini como respaldo. Factory pattern ya soporta registrarlo (solo crear `openai.js`).

## 10. CI/CD + Docker
Sin pipeline de integración continua ni contenedorización.

## 11. Producción / Deploy
Sin dominio, sin HTTPS configurado, sin servidor de producción.

## 12. Refinamiento UI/UX
- Timing del overlay de setup vs carga del dashboard (race condition)
- Edición de perfil desde chat sin feedback visual para el usuario
- Selector de modelo en frontend mejorado
- Load states, error states, empty states

## 13. Pruebas Frontend
Setup overlay, edición de perfil desde chat, integración con exámenes, edge cases (sesión expirada, rate limiting, etc.)

---

## Resumen de lo que SÍ está completo

✅ DB schema (chat_logs, chat_embeddings, chat_insights, has_completed_setup)  
✅ Persistencia de chat (Opción C — user msg inmediato, AI msg al cerrar)  
✅ Embeddings + RAG (nv-embed-v1, 4096d, top-3 similitud coseno)  
✅ Setup mode (overlay con 3 preguntas) + Perfil adaptativo (.md 1.5KB + caché)  
✅ Edición de perfil desde el chat (regex + AI classifier + appendToProfile)  
✅ Cron de insights diarios (node-cron, 2 AM)  
✅ max_tokens configurable en NvidiaOptions  
✅ Compilación TypeScript limpia (tsc --noEmit)
