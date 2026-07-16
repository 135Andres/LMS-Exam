# Plan Maestro — LMS Exam + Multi-Agente + Memoria Persistente

## Stack Tecnológico (sin cambios)

| Capa | Tecnología |
|------|-----------|
| Backend | Node.js 18+ / Express 4 (ES Modules, TypeScript) |
| DB principal | SQLite via better-sqlite3 (WAL mode) |
| Auth | OTP 6 dígitos + Lista Blanca + JWT (httpOnly cookie, 24h) |
| Frontend | Vanilla JS (ES Modules) + CSS custom properties |
| AI Provider | NVIDIA API (MiniMax M2.7, DeepSeek V4 Flash, MiniMax M3) |
| OCR ecuaciones | pix2tex — microservicio Python Flask aparte (puerto 4000) |
| OCR texto general | pdf-parse (npm) para PDFs sin ecuaciones |
| Análisis nocturno | DeepSeek V4 Flash vía cron/setInterval (2 AM) |

## Hardware del Servidor

- Intel i7-8850H (6 cores, 12 threads)
- 32 GB RAM
- NVIDIA Quadro P1000 (4 GB VRAM)
- pix2tex corre en GPU sin problemas (<2GB VRAM en inferencia)

---

## 1. OCR para Ecuaciones (pix2tex)

**Problema**: Tesseract.js no reconoce ecuaciones matemáticas. Las rompe por completo.

**Solución**: pix2tex (LaTeX-OCR, 16.5k estrellas GitHub). Usa ViT Encoder + ResNet backbone + Transformer Decoder. Convierte imágenes de ecuaciones a código LaTeX.

**Pipeline**:
```
Usuario sube foto/PDF con ecuación
       ↓
Backend Node.js envía imagen al microservicio Python
       ↓
pix2tex procesa → devuelve LaTeX (ej: \frac{-b \pm \sqrt{b^2 - 4ac}}{2a})
       ↓
Backend inyecta el LaTeX como contexto en el prompt de la IA
```

**Instalación**: `pip install pix2tex` + microservicio Flask en puerto 4000.

---

## 2. Pipeline Multi-Agente

Actualmente: 1 prompt → 1 respuesta. El nuevo pipeline:

```
Usuario envía temario
       ↓
[Agente Planificador] — MiniMax M3 (barato)
  "Analiza el temario, ¿qué orden de estudio tiene sentido?
   ¿qué subtemas son prerrequisito? ¿qué nivel tiene el usuario?"
       ↓
[Agente Investigador] — MiniMax M3
  "Para cada subtema, extrae conceptos clave, fórmulas,
   definiciones importantes del contexto (documentos + memoria)"
       ↓
[Agente Generador] — MiniMax M2.7
  "Genera N preguntas balanceadas según nivel de dominio del usuario"
       ↓
[Agente Validador] — DeepSeek V4 Flash
  "Revisa calidad, claridad, dificultad, consistencia, formato JSON"
       ↓
Examen listo
```

Cada agente es una llamada separada a la API de NVIDIA. Node.js orquesta todo con async/await.

### Progreso en Tiempo Real con SSE

El pipeline multi-agente toma varios segundos (4+ llamadas consecutivas a APIs). Para mantener al usuario informado, usamos **Server-Sent Events (SSE)** — no WebSockets, porque la comunicación es unidireccional (server → client) y SSE es más simple, funciona con Express nativo sin dependencias extra.

**Flujo SSE:**
```
1. Cliente hace POST a /api/exams/generate
2. Express establece conexión SSE en el mismo request
3. Server emite eventos a medida que cada agente completa:
   → event: "step"  data: {"step":"plan","status":"done"}
   → event: "step"  data: {"step":"research","status":"done"}
   → event: "step"  data: {"step":"generate","status":"done"}
   → event: "step"  data: {"step":"validate","status":"done"}
   → event: "complete"  data: { exam objeto }
4. Frontend escucha EventSource y actualiza UI:
   [✓] Planificando...
   [✓] Investigando...
   [→] Generando preguntas...  ← animación de carga
   [ ] Validando...
```

**Implementación en Express:**
```ts
// Sin dependencias — Response nativo de Express
res.writeHead(200, {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
});

// Emitir progreso
res.write(`event: step\ndata: ${JSON.stringify({ step: 'plan', status: 'done' })}\n\n`);

// Al terminar
res.write(`event: complete\ndata: ${JSON.stringify({ exam })}\n\n`);
res.end();
```

**Frontend:**
```js
const source = new EventSource(`/api/exams/generate-stream`);
source.addEventListener('step', e => {
  const { step, status } = JSON.parse(e.data);
  actualizarSpinner(step, status);
});
source.addEventListener('complete', e => {
  source.close();
  mostrarExamen(JSON.parse(e.data).exam);
});
```

---

## 3. Memoria Persistente

### Base de datos (SQLite) — tablas nuevas:

```sql
CREATE TABLE study_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  start_time TEXT NOT NULL DEFAULT (datetime('now')),
  end_time TEXT,
  summary TEXT                  -- resumen generado por IA al cerrar
);

CREATE TABLE session_interactions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES study_sessions(id),
  type TEXT NOT NULL CHECK(type IN (
    'exam_generated','question_answered','chat_message',
    'document_uploaded','analysis_generated'
  )),
  subtopics TEXT,              -- JSON array de subtemas relacionados
  metadata TEXT,               -- JSON con datos específicos
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE user_subtopic_mastery (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  subtopic TEXT NOT NULL,
  mastery_level REAL DEFAULT 0.0,  -- 0.0 a 1.0
  total_attempts INTEGER DEFAULT 0,
  correct_attempts INTEGER DEFAULT 0,
  last_practiced TEXT,
  UNIQUE(user_id, subtopic)
);
```

### Archivos JSON por sesión — para análisis 1x1 de la IA:

```
backend/data/
├── database.sqlite              ← DB principal
├── sessions/
│   └── {userId}/
│       ├── 2026-06-26.json      ← Log completo del día
│       └── 2026-06-27.json
├── analyses/
│   └── {userId}/
│       ├── 2026-06-26.json      ← Análisis generado por IA
│       └── 2026-06-27.json
└── uploads/
    └── {userId}/
        ├── apuntes.pdf
        └── formula.jpg
```

- **DB** guarda datos estructurados (scores, mastery, metadata)
- **Archivos JSON** guardan el contexto completo de cada sesión (cada interacción, cada mensaje del chat, cada examen)
- La IA puede leer el archivo completo de un usuario y hacer análisis 1x1

### Política de Retención y Resúmenes

Para evitar que usuarios hiperactivos generen sesiones enormes que desborden el contexto de DeepSeek en el análisis nocturno:

**Dos niveles de archivo por sesión:**
```
sessions/{userId}/
├── 2026-06-26.full.json    ← Log completo (cada interacción, cada mensaje)
└── 2026-06-26.summary.json ← Resumen generado por IA al cerrar sesión (~500 tokens)
```

**Reglas:**
1. Al cerrar sesión → se genera un `summary.json` automático con: subtemas visitados, score promedio, errores frecuentes, dudas no resueltas
2. El **Agente Analista nocturno** lee:
   - `summary.json` de los últimos 7 días
   - `full.json` solo del día actual (para análisis detallado)
3. Archivos `full.json` con más de 7 días se comprimen a `.full.json.gz`
4. Archivos con más de 30 días se eliminan (el summary permanece indefinido)
5. Si un `full.json` supera los 500KB, se trunca al cierre guardando solo:
   - Metadata de la sesión
   - Errores del usuario
   - Últimos 20 mensajes del chat
   - Scores de cada examen

---

## 4. Análisis Diario Automático (Nocturno)

- A las **2:00 AM**, un cron job (o setInterval si no hay usuarios activos) ejecuta el **Agente Analista**
- Para cada usuario con actividad del día:
  1. Lee `sessions/{userId}/2026-06-26.json`
  2. Lee `user_subtopic_mastery` de la DB
  3. DeepSeek V4 Flash genera:
     - Temas fuertes del día
     - Temas débiles del día
     - Progreso vs días anteriores
     - Sugerencias personalizadas
  4. Guarda resultado en `analyses/{userId}/2026-06-26.json`
  5. Actualiza `user_subtopic_mastery` en DB

---

## 5. Dificultad Adaptativa

Fórmula: Al generar un examen, el **Agente Generador** recibe:
- El nivel de dominio del usuario por cada subtema (`mastery_level`)
- Si `mastery_level < 0.3`: genera preguntas fáciles
- Si `mastery_level 0.3-0.6`: genera preguntas medias
- Si `mastery_level > 0.6`: genera preguntas difíciles
- Distribuye más preguntas a subtemas con menor mastery

---

## 6. Frontend — Vistas a Diseñar

### 1. Home (existe) — Login con OTP
### 2. Dashboard (rediseñar)
- Info del usuario
- Progreso del día (barra)
- Lista de exámenes con scores
- Análisis de hoy (sugerencias)
- Botones: Nuevo examen, Subir documentos

### 3. Generar Examen (nuevo)
- Input de temario + botón sugerir subtemas
- Subida de PDFs / fotos (con barra de progreso)
- Selector de número de preguntas
- Selector de dificultad (Fácil/Media/Difícil/Adaptativa)
- Botón "Generar Examen" con spinner multi-paso que muestre:
  - [✓] Planificando...
  - [✓] Investigando...
  - [✓] Generando preguntas...
  - [✓] Validando...
  - [✓] Listo

### 4. Tomar Examen (nuevo)
- Una pregunta a la vez
- 4 opciones clickeables
- Navegación anterior/siguiente
- Barra de progreso (3/10)
- Al terminar: enviar respuestas

### 5. Resultados (nuevo)
- Score (X/Y - porcentaje)
- Lista de aciertos y fallos por subtema
- Recomendación generada por IA
- Botón: "Preguntar al tutor" (va al chat con contexto)

### 6. Chat con Tutor (nuevo)
- Interfaz de chat estilo WhatsApp/messenger
- El tutor tiene contexto del examen actual y del historial del usuario
- Soporta LaTeX renderizado (KaTeX)
- Historial de conversación guardado en session_interactions

### 7. Perfil / Progreso (nuevo)
- Análisis diario legible
- Gráfica de progreso por día/semana
- Mapa de calor de subtemas (verde/amarillo/rojo)
- Plan de estudio sugerido

---

## 7. Flujo Completo del Usuario

```
1. Home → Login con OTP
2. Dashboard
   ↓
3. "Nuevo Examen"
   ↓
4. Input temario + [Sugerir subtemas]
   ↓
5. Subir PDF/foto (opcional)
   ↓
6. Configurar (preguntas, dificultad)
   ↓
7. [Generar] → Pipeline multi-agente:
   Planificador → Investigador → Generador → Validador
   ↓
8. Tomar examen (una pregunta a la vez)
   ↓
9. Resultados + recomendaciones
   ↓
10. [Opcional] Preguntar al tutor
    ↓
11. [Opcional] Cerrar sesión
    ↓
12. 2 AM → Análisis automático del día
```

---

## 8. Prioridad de Implementación

| Fase | Qué | Depende de |
|------|-----|------------|
| **0** | Frontend completo (maquetar todas las vistas) | Nada |
| **1** | DB: nuevas tablas + migración | Fase 0 |
| **2** | Multi-Agente pipeline (planificador/investigador/generador/validador) | Fase 1 |
| **3** | Microservicio pix2tex (OCR ecuaciones) + subida de archivos | Fase 2 |
| **4** | Sesiones en archivos JSON + guardar interacciones | Fase 1 |
| **5** | Análisis nocturno automático | Fase 4 |
| **6** | Dificultad adaptativa + planes de aprendizaje | Fase 2 + 5 |

---

## 9. Modelos AI a Usar

| Agente | Modelo | Costo | Propósito |
|--------|--------|-------|-----------|
| Planificador | `minimaxai/minimax-m3` | Bajo | Análisis de temarios, planes |
| Investigador | `minimaxai/minimax-m3` | Bajo | Extraer conceptos clave |
| Generador | `minimaxai/minimax-m2.7` | Medio | Crear preguntas |
| Validador | `deepseek-ai/deepseek-v4-flash` | Bajo | Revisar calidad/JSON |
| Chat Tutor | `deepseek-ai/deepseek-v4-flash` | Bajo | Responder dudas |
| Analista nocturno | `deepseek-ai/deepseek-v4-flash` | Bajo | Análisis de sesión |
| Pulir preguntas | `deepseek-ai/deepseek-v4-flash` | Bajo | Editar preguntas |

---

## 10. Notas para el Siguiente Desarrollador/Agente

- El proyecto está en `C:\Users\WinterOS\Desktop\webfinal`
- Backend en `backend/`, frontend en `public/`
- El servidor arranca con `cd backend && npm run dev` (puerto 3000)
- La DB está en `backend/data/database.sqlite`
- Ya hay auth funcional (OTP + whitelist + JWT)
- El frontend actual es SPA vanilla JS con login y dashboard básico
- Archivo de contexto principal: `AGENTS.md`
- Log de errores pasados: `.ai_context/log_errores.md`
- No modificar archivos en `old/` (intentos anteriores archivados)
- Referencia de diseño: `public/referencia/Dia.html` (estilo Dia de The Browser Company)
- Fondo `#b8c0da`, tarjetas blancas, tipografía system-ui
- El usuario es mexicano — todo en español mexicano
