# ARQUITECTURA #2: Sin Tests Automatizados

---

## AUDITORÍA (2026-07-12)

**VEREDICTO: ⚠️ PARCIAL**

| Ítem del plan | Estado | Ubicación / Evidencia |
|---|---|---|
| Instalar vitest + @vitest/coverage-v8 + supertest + @types/supertest | ✅ COMPLETO | `backend/package.json:35,37,40,33` — todas instaladas |
| `vitest.config.ts` con environment node + setupFiles | ✅ COMPLETO | `backend/vitest.config.ts:1-25` |
| Coverage thresholds `lines:80, functions:80, branches:70, statements:80` | ❌ NO IMPLEMENTADO | `backend/vitest.config.ts` — sección `thresholds` ausente |
| `test/setup.ts` DB en memoria + vi.mock + resetDb | ✅ COMPLETO | `backend/test/setup.ts` |
| Tests unitarios `vector.test.ts` (cosine + findTopK) | ✅ COMPLETO | `backend/src/utils/vector.test.ts` (10 tests) |
| Tests `chat.profile-detection.test.ts` (regex + whitelist) | ✅ COMPLETO | `backend/src/services/chat.profile-detection.test.ts` (18 tests) |
| Tests `embedding.model.test.ts` (roundtrip DB) | ✅ COMPLETO | `backend/src/models/embedding.model.test.ts` (3 tests) |
| Tests `embedding-outbox.model.test.ts` (enqueue/markFailed) | ✅ COMPLETO | `backend/src/models/embedding-outbox.model.test.ts` (6 tests) |
| Tests `chat.model.test.ts` | ✅ COMPLETO | `backend/src/models/chat.model.test.ts` (8 tests) |
| Tests `chat.service.test.ts` (fachada) | ✅ COMPLETO | `backend/src/services/chat.service.test.ts` (6 tests) |
| Tests `chat.validator.ts` | ✅ COMPLETO | `backend/src/validators/chat.test.ts` (13 tests) |
| Tests integración `chat.routes.test.ts` con supertest | ❌ NO IMPLEMENTADO | `backend/test/integration/` no existe; supertest instalado pero no usado |
| CI/CD gate workflow `.github/workflows/test.yml` | ❌ NO IMPLEMENTADO | `.github/` no existe en el repo |
| Scripts `test`, `test:watch`, `test:coverage`, `typecheck` en package.json | ✅ COMPLETO | `backend/package.json:19-22` |
| Script `test:ui` (vitest --ui) | ❌ NO IMPLEMENTADO | no presente en package.json |
| Codecov upload | ❌ NO IMPLEMENTADO | sin workflow CI |
| PR required checks | ❌ NO IMPLEMENTADO | sin workflow CI |
| Coverage real ≥80% | ❌ NO IMPLEMENTADO | Stmts 29.18%, Branch 16.17%, Funcs 40.5%, Lines 29.62% (medido 2026-07-12) |
| Total: 64 tests / 7 suites pasando | ✅ COMPLETO | verificado |

**Resumen:**
- ✅ 10 ítems completos
- ❌ 7 ítems no implementados (thresholds, tests integración, CI/CD completo, coverage real, test:ui, codecov, PR checks)
- ⚠️ PARCIAL — infraestructura de tests base lista, cobertura insuficiente y sin gate CI/CD

---

## ESTADO (histórico)
Bug confirmado en código (`package.json:6-8` — script placeholder)

## OBJETIVO ESPECÍFICO
Establecer suite de tests (unit + integration) con Vitest, cobertura >=80% en lógica crítica, CI/CD gate en GitHub Actions.

## PROBLEMA ACTUAL

**`backend/package.json:6-8`:**
```json
"scripts": {
  "test": "echo \"Error: no test specified\" && exit 1"
}
```

**Dependencias:** Ninguna de testing instalada (ni vitest, ni jest, ni mocha, ni supertest).

**Riesgos:**
- Refactors (como dividir `chat.service`) = regresiones indetectadas
- Bugs en `vector.ts`, `embedding.model.ts`, RAG scoring → silenciosos
- No CI/CD gate → código roto llega a producción
- Onboarding nuevo dev = miedo a romper cosas
- Fix #4 (regex false positives) no tiene donde ejecutar casos de prueba

## SOLUCIÓN: Vitest + Coverage + CI

### 1. Instalar dependencias

```bash
cd backend && npm i -D vitest @vitest/coverage-v8 supertest @types/supertest
```

### 2. vitest.config.ts

```typescript
// backend/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
      exclude: [
        '**/migrate.ts',
        '**/seed.ts',
        '**/server.ts',
        '**/config/**',
        '**/*.d.ts',
        '**/types/**',
        '**/workers/**',            // Workers son integration tests
        'src/**/*.test.ts',         // No medir el código de tests
      ],
    },
    setupFiles: ['./test/setup.ts'],
    testTimeout: 10000,
  },
});
```

### 3. test/setup.ts — DB en memoria + helpers

```typescript
// backend/test/setup.ts
import { beforeAll, beforeEach, afterAll, vi } from 'vitest';
import Database from 'better-sqlite3';

let testDb: Database.Database;

export function getTestDb(): Database.Database {
  if (!testDb) {
    testDb = new Database(':memory:');
    testDb.pragma('journal_mode = WAL');
    testDb.pragma('foreign_keys = ON');
  }
  return testDb;
}

// Replicar el schema mínimo para tests de unit
export function setupTestSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, username TEXT,
      password_hash TEXT, role TEXT DEFAULT 'user',
      created_at TEXT DEFAULT (datetime('now')),
      exams_generated INTEGER DEFAULT 0, total_api_cost REAL DEFAULT 0.0
    );
    CREATE TABLE IF NOT EXISTS chat_logs (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
      session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL,
      subject TEXT, tokens INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS chat_sessions (
      session_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
      is_archived INTEGER DEFAULT 0, archived_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS chat_embeddings (
      id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES chat_logs(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL, vector_text TEXT NOT NULL, model TEXT NOT NULL,
      dimensions INTEGER NOT NULL, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS embedding_outbox (
      id TEXT PRIMARY KEY, message_id TEXT NOT NULL, user_id TEXT NOT NULL,
      text_content TEXT NOT NULL, role TEXT DEFAULT 'user',
      status TEXT DEFAULT 'pending', attempts INTEGER DEFAULT 0,
      max_attempts INTEGER DEFAULT 3, error TEXT,
      created_at TEXT DEFAULT (datetime('now')), processed_at TEXT,
      next_retry_at TEXT
    );
  `);
}

// Mockear getDb() a nivel global para tests de modelos
beforeAll(async () => {
  const db = getTestDb();
  setupTestSchema(db);

  // Mock del módulo de conexión
  vi.mock('../src/db/connection.js', () => ({
    getDb: () => db,
  }));
});

beforeEach(() => {
  const db = getTestDb();
  // Limpiar todas las tablas entre tests
  const tables = ['chat_embeddings', 'embedding_outbox', 'chat_logs', 'chat_sessions', 'users'];
  for (const table of tables) {
    db.exec(`DELETE FROM ${table}`);
  }
});

afterAll(() => {
  if (testDb) testDb.close();
});
```

### 4. Tests Unitarios Críticos (prioridad por valor)

#### 4a. vector.test.ts — lógica matemática pura

```typescript
// backend/src/utils/vector.test.ts
import { describe, it, expect } from 'vitest';
import { cosineSimilarity, findTopK } from './vector.js';

describe('cosineSimilarity', () => {
  it('vectores idénticos → 1.0', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1.0);
  });
  it('ortogonales → 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });
  it('opuestos → -1', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });
  it('dimensiones distintas → 0', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });
  it('vector cero → 0', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });
});

describe('findTopK', () => {
  const items = [
    { vector: [1, 0], content: 'a' },
    { vector: [0.9, 0.1], content: 'b' },
    { vector: [0, 1], content: 'c' },
    { vector: [0.01, 0.99], content: 'd' },
  ];

  it('retorna top K ordenados por score', () => {
    const r = findTopK([1, 0], items, 2, 0);
    expect(r[0].content).toBe('a');  // coseno = 1.0
    expect(r[1].content).toBe('b');  // coseno ≈ 0.99
  });
  it('filtra por umbral mínimo', () => {
    const r = findTopK([1, 0], items, 5, 0.5);
    expect(r).toHaveLength(2);  // solo 'a' y 'b' pasan
  });
  it('retorna vacío si nada pasa umbral', () => {
    const r = findTopK([1, 0], items, 5, 0.999);
    expect(r).toHaveLength(0);
  });
  it('retorna vacío si items vacío', () => {
    expect(findTopK([1, 0], [], 3, 0.5)).toHaveLength(0);
  });
});
```

#### 4b. profile-edit.test.ts — lógica de filtros

```typescript
// backend/src/services/chat.profile-detection.test.ts
import { describe, it, expect } from 'vitest';
import { isProfileEditIntent } from './chat.profile-detection.service.js';

describe('isProfileEditIntent', () => {
  const cases: Array<[string, boolean]> = [
    // Positivos (debe detectar)
    ['quiero que me expliques más sencillo', true],
    ['cambia mi perfil a modo sargento', true],
    ['actualiza mi preferencia: nada de física', true],
    ['prefiero que me des solo la respuesta', true],
    ['configura mi tutor para oposiciones', true],
    ['ajusta mi nivel de detalle', true],
    ['modifica mi estilo de feedback', true],
    // Negativos (NO debe detectar)
    ['explícame la regla de la cadena', false],
    ['ahora entiendo, gracias', false],
    ['¿en modo examen o práctica?', false],
    ['evita los errores comunes en integrales', false],
    ['habla más despacio por favor', false],
    ['modo sargento activado', false],
    ['qué es una derivada', false],
    ['cómo resuelvo una ecuación cuadrática', false],
    ['gracias, me ayudó mucho', false],
    ['ok perfecto', false],
    ['vale, entendido', false],
  ];

  for (const [msg, expected] of cases) {
    it(`${msg} → ${expected}`, () => {
      expect(isProfileEditIntent(msg)).toBe(expected);
    });
  }
});
```

#### 4c. embedding.model.test.ts — roundtrip DB

```typescript
// backend/src/models/embedding.model.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { EmbeddingModel } from './embedding.model.js';
import { getTestDb } from '../../test/setup.js';

describe('EmbeddingModel', () => {
  beforeEach(() => {
    const db = getTestDb();
    // Insertar user y chat_log necesarios para FK
    db.prepare('INSERT INTO users (id, email) VALUES (?, ?)').run('u1', 'test@test.com');
    db.prepare('INSERT INTO chat_logs (id, user_id, session_id, role, content) VALUES (?, ?, ?, ?, ?)').run('m1', 'u1', 's1', 'user', 'Hola');
  });

  it('saveEmbedding + getUserEmbeddings roundtrip', () => {
    const vec = new Array(4096).fill(0).map(() => Math.random());
    EmbeddingModel.saveEmbedding('e1', 'm1', 'u1', vec, 'nv-embed', 4096);
    const r = EmbeddingModel.getUserEmbeddings('u1', 100);
    expect(r).toHaveLength(1);
    expect(r[0].vector).toHaveLength(4096);
    expect(r[0].messageId).toBe('m1');
    expect(r[0].content).toBe('Hola');
    expect(r[0].role).toBe('user');
  });

  it('getUserEmbeddings retorna vacío si no hay', () => {
    expect(EmbeddingModel.getUserEmbeddings('no-existe')).toHaveLength(0);
  });
});
```

#### 4d. embedding-outbox.model.test.ts

```typescript
describe('EmbeddingOutboxModel', () => {
  it('enqueue + getPending + markDone roundtrip', () => {
    EmbeddingOutboxModel.enqueue('o1', 'm1', 'u1', 'texto de prueba');
    const pending = EmbeddingOutboxModel.getPending(10);
    expect(pending).toHaveLength(1);
    expect(pending[0].text_content).toBe('texto de prueba');

    EmbeddingOutboxModel.markDone('o1');
    expect(EmbeddingOutboxModel.getPending(10)).toHaveLength(0);
  });

  it('markFailed + getPending respeta next_retry_at', () => {
    EmbeddingOutboxModel.enqueue('o2', 'm1', 'u1', 'texto');
    EmbeddingOutboxModel.markProcessing('o2');
    EmbeddingOutboxModel.markFailed('o2', 'API timeout');
    // next_retry_at está en el futuro → no aparece en pending
    expect(EmbeddingOutboxModel.getPending(10)).toHaveLength(0);
  });
});
```

### 5. Test de integración (API con supertest)

```typescript
// backend/test/integration/chat.routes.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { getTestDb } from './setup.js';

describe('Chat Routes Integration', () => {
  let authCookie: string;

  beforeAll(async () => {
    // Crear usuario + sesión de test
    const db = getTestDb();
    db.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').run('test-u1', 'test@test.com', 'hash');
    // Login (mock o seed directo del cookie)
    authCookie = 'session=test-session-token';
  });

  it('POST /api/chat/tutor → 200 + response + sessionId', async () => {
    const res = await request(app)
      .post('/api/chat/tutor')
      .set('Cookie', authCookie)
      .send({ message: 'Hola', sessionId: 'test-sess-1' });

    expect(res.status).toBe(200);
    expect(res.body.response).toBeDefined();
    expect(res.body.sessionId).toBe('test-sess-1');
  });

  it('POST /api/chat/tutor → 403 si sessionId ajeno', async () => {
    const res = await request(app)
      .post('/api/chat/tutor')
      .set('Cookie', authCookie)
      .send({ message: 'Hola', sessionId: 'otro-usuario-uuid' });

    expect(res.status).toBe(403);
  });

  it('GET /api/chat/tutor/history?session_id=invalid → 400', async () => {
    const res = await request(app)
      .get('/api/chat/tutor/history?session_id=invalid-uuid')
      .set('Cookie', authCookie);

    expect(res.status).toBe(400);
  });
});
```

### 6. CI/CD Gate

```yaml
# .github/workflows/test.yml
name: Test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: cd backend && npm ci
      - run: cd backend && npm run test -- --run
      - run: cd backend && npm run typecheck
      - name: Coverage upload
        uses: codecov/codecov-action@v4
        with:
          files: ./backend/coverage/lcov.info
```

### 7. Scripts en package.json

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:ui": "vitest --ui",
    "typecheck": "tsc --noEmit"
  }
}
```

## PRIORIZACIÓN DE TESTS

**Sprint 1 (inmediato):** Tests de lógica pura — sin DB, sin mocks
- `vector.test.ts` — coseno y findTopK (valida fix #5)
- `profile-edit.test.ts` — regex y whitelist (valida fix #4)

**Sprint 2:** Tests de modelos — DB en memoria
- `embedding.model.test.ts`
- `embedding-outbox.model.test.ts`
- `chat.model.test.ts`

**Sprint 3:** Tests de integración
- `chat.routes.test.ts` — supertest + app completa
- Tests de ownership (fix #7)

**Sprint 4:** CI/CD + coverage gate
- GitHub Actions workflow
- Codecov upload
- PR required checks

## MEJORAS ADICIONALES DETECTADAS

1. **Mocking de la API de IA:** Funciones como `generateFromAI` y `generateEmbedding` hacen llamadas HTTP a NVIDIA API. En tests, mockearlas con `vi.mock`:

```typescript
vi.mock('../src/utils/ai.js', () => ({
  generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, ...]),
  generateFromAI: vi.fn().mockResolvedValue({ content: 'mocked response' }),
}));
```

2. **Test de property-based:** Para `cosineSimilarity`, usar tests de propiedades matemáticas (siempre en [-1, 1], simétrico):

```typescript
import { fc, test } from '@fast-check/vitest';
test.prop('cosineSimilarity总是在[-1,1]内', ([a, b]) => {
  const result = cosineSimilarity(a, b);
  return result >= -1 && result <= 1;
});
```

3. **Test snapshots:** Para funciones que generan strings complejos como `buildSystemPrompt`, usar snapshots:

```typescript
it('buildSystemPrompt genera formato correcto', () => {
  const prompt = promptService.buildSystemPrompt('DeepSeek', 'rag ctx', 'user-1');
  expect(prompt).toMatchSnapshot();
});
```

## ARCHIVOS A CREAR

```
backend/
├── vitest.config.ts
├── test/
│   ├── setup.ts
│   └── integration/
│       └── chat.routes.test.ts
├── src/
│   ├── utils/vector.test.ts
│   ├── models/
│   │   ├── embedding.model.test.ts
│   │   ├── embedding-outbox.model.test.ts
│   │   └── chat.model.test.ts
│   └── services/chat/
│       ├── chat.profile-detection.test.ts
│       └── chat.rag.service.test.ts
└── .github/workflows/test.yml
```
