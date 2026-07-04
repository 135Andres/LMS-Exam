# Progreso — LMS Exams

## ✅ Implementado
- Login con OTP + whitelist + HMAC-SHA256
- Chatbot con tutor IA (DeepSeek V4 Flash / Nemotron)
- Streaming de respuestas del chat
- KaTeX para fórmulas matemáticas
- Selector de modelo con registro por API key separada
- Archivos adjuntos (imagen/audio) con multimodal
- Lightbox para imágenes con animación FLIP
- Barra superior oculta al inicio, visible al abrir chat
- Botón "LMS Exams" regresa a la página principal (hero)
- Panel de contexto con datos reales (sesión, mensajes, tokens, exámenes)
- Polling de datos cada 10s + actualización en cada cambio
- Context ring con uso de tokens estimado
- Endpoint `/api/user/profile` con datos completos del usuario
- Navegación hero → chat → hero sin pérdida de estado

## 🔜 Implementado parcialmente / Pendiente

### Panel de contexto
- [x] Datos de sesión (email, rol, modelo, proveedor)
- [x] Conteo de mensajes real desde DOM
- [x] Tokens estimados desde longitud de texto
- [x] Exámenes disponibles desde `/api/exams`
- [x] Límite de contexto: 128K
- [x] Chat creado: hora de primera apertura
- [ ] Última actividad: actualización en tiempo real
- [ ] Botón para cerrar sesión
- [ ] Vinculación con exams reales (click para abrir)

### Generación de exámenes
- [ ] Botón/modal para generar examen desde el chat
- [ ] Vista de lista de exámenes disponibles
- [ ] Vista de detalle de examen con preguntas
- [ ] Responder examen y guardar score

### Monetización
- [ ] Google AdSense (pendiente aprobación)
- [ ] Ad token system (backend listo, frontend pendiente)

### Adjuntos (Fase 2b)
- [x] Subida de imágenes
- [x] Subida de audio
- [ ] Vista previa de archivos en mensajes
- [ ] Soporte para PDF/documentos

### UX / UI
- [x] Animación de typing indicator
- [x] FLIP animation en lightbox
- [x] Hero con fade-in secuencial
- [x] Transición hero → chat con erase + morph
- [x] Anti-DevTools: detección y bloqueo de herramientas de desarrollo
- [ ] Modo oscuro
- [ ] Responsive para móvil
- [ ] Tooltips y estados vacíos

### Backend
- [x] Endpoint `/api/user/profile`
- [ ] Rate limiting por usuario en chat (actualmente solo en generate)
- [ ] Logging a archivo con rotación
- [ ] Tests unitarios (vitest)
- [ ] Migración a PostgreSQL (si escala)

### Varios
- [ ] Página de Dashboard (actualmente link roto)
- [ ] Página de administración
- [ ] Recuperación de contraseña
