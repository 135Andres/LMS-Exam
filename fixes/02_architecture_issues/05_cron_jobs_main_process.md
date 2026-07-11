# ARQUITECTURA #5: Cron Jobs en Proceso Principal (No Escalable)

## OBJETIVO ESPECÍFICO
Mover cron jobs a worker separado con lock distribuido para multi-instancia.

## PROBLEMA ACTUAL

**server.ts:111-142:**
```typescript
// Cron: generar insights cada día a las 2 AM
cron.schedule('0 2 * * *', async () => {
  const users = getDb().prepare('SELECT id FROM users').all() as Array<{ id: string }>;
  for (const user of users) {
    await generateDailyInsights(user.id, date);
  }
});

// Cron: actualizar perfiles cada noche a las 3 AM
cron.schedule('0 3 * * *', async () => {
  const users = getDb().prepare('SELECT id FROM users').all() as Array<{ id: string }>;
  for (const user of users) {
    await updateProfileForUser(user.id);
  }
});
```

**Problemas en producción:**
| Escenario | Qué pasa |
|-----------|----------|
| 2 instancias Node (PM2 cluster, K8s, Docker Swarm) | **Cron se ejecuta 2x** → Insights duplicados, perfil actualizado 2x, costo API 2x |
| Deploy rolling update | Cron puede ejecutarse durante deploy → fallos parciales |
| Proceso principal bloqueado | Requests HTTP lentos durante cron (CPU/IO contention) |
| Sin observabilidad | No hay logs centralizados, métricas, alerting |
| Crash del cron = crash del server | Uncaught exception en cron tira todo el proceso |

## SOLUCIÓN: Worker Separado + Lock Distribuido

### Opción A: Redis Lock (Recomendado si hay Redis)
```typescript
// backend/src/workers/insights.worker.ts
import { createClient } from 'redis';
import { generateDailyInsights } from '../services/insights.service.js';
import { getDb } from '../db/connection.js';
import { logger } from '../utils/logger.js';

const redis = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
await redis.connect();

const LOCK_KEY = 'cron:daily-insights:lock';
const LOCK_TTL = 30 * 60 * 1000; // 30 min

async function acquireLock(): Promise<boolean> {
  return await redis.set(LOCK_KEY, process.pid.toString(), {
    NX: true,
    PX: LOCK_TTL,
  });
}

async function releaseLock() {
  await redis.del(LOCK_KEY);
}

export async function runDailyInsights() {
  const lock = await acquireLock();
  if (!lock) {
    logger.info('Daily insights: lock held by another instance, skipping');
    return;
  }
  
  try {
    logger.info('Daily insights: lock acquired, starting');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const date = yesterday.toISOString().slice(0, 10);
    
    const users = getDb().prepare('SELECT id FROM users').all() as Array<{ id: string }>;
    let success = 0, failed = 0;
    
    for (const user of users) {
      try {
        await generateDailyInsights(user.id, date);
        success++;
      } catch (e) {
        failed++;
        logger.error('Insights failed for user', { userId: user.id, error: (e as Error).message });
      }
    }
    
    logger.info('Daily insights completed', { success, failed, date });
  } finally {
    await releaseLock();
  }
}

// Entry point para worker
if (import.meta.url === `file://${process.argv[1]}`) {
  runDailyInsights().then(() => process.exit(0)).catch(() => process.exit(1));
}
```

### Opción B: SQLite-based Lock (Si no hay Redis)
```typescript
// backend/src/utils/distributed-lock.ts
import { getDb } from '../db/connection.js';

export async function tryAcquireLock(lockName: string, ttlMinutes: number = 30): Promise<boolean> {
  const db = getDb();
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
  
  try {
    db.exec('BEGIN IMMEDIATE');
    const result = db.prepare(`
      INSERT INTO cron_locks (name, owner_pid, acquired_at, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(lockName, process.pid, now, expires);
    db.exec('COMMIT');
    return result.changes > 0;
  } catch (e) {
    db.exec('ROLLBACK');
    return false;
  }
}

export async function releaseLock(lockName: string): Promise<void> {
  getDb().prepare('DELETE FROM cron_locks WHERE name = ? AND owner_pid = ?')
    .run(lockName, process.pid);
}

// Migración: añadir tabla
// CREATE TABLE cron_locks (name TEXT PRIMARY KEY, owner_pid INTEGER, acquired_at TEXT, expires_at TEXT);
```

### 3. Package.json Scripts Separados
```json
{
  "scripts": {
    "start": "node dist/server.js",
    "dev": "tsx watch server.ts",
    "worker:insights": "tsx src/workers/insights.worker.ts",
    "worker:profiles": "tsx src/workers/profiles.worker.ts",
    "worker:all": "concurrently -n insights,profiles \"npm run worker:insights\" \"npm run worker:profiles\""
  }
}
```

### 4. Systemd / PM2 / Kubernetes Deployment

**systemd (insights-worker.service):**
```ini
[Unit]
Description=LMS Exam Insights Worker
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/lms-exam/backend
ExecStart=/usr/bin/node dist/workers/insights.worker.js
Environment=NODE_ENV=production
Environment=REDIS_URL=redis://localhost:6379
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

**Cron systemd timer (insights-worker.timer):**
```ini
[Unit]
Description=Run Daily Insights at 2 AM

[Timer]
OnCalendar=*-*-* 02:00:00
Persistent=true
RandomizedDelaySec=15m

[Install]
WantedBy=timers.target
```

**Kubernetes CronJob:**
```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: daily-insights
spec:
  schedule: "0 2 * * *"
  concurrencyPolicy: Forbid
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: worker
            image: lms-exam:latest
            command: ["node", "dist/workers/insights.worker.js"]
            env:
            - name: REDIS_URL
              valueFrom:
                secretKeyRef:
                  name: redis-secret
                  key: url
          restartPolicy: OnFailure
```

### 5. Observabilidad Añadida
```typescript
// En cada worker
import { metrics } from '../utils/metrics.js';

metrics.increment('cron.insights.started');
const timer = metrics.timer('cron.insights.duration');
// ... trabajo ...
timer.stop();
metrics.increment('cron.insights.completed', { status: 'success' });
```

## MIGRACIÓN ZERO-DOWNTIME
1. Crear workers + lock mechanism
2. Deploy workers + cron timers (systemd/k8s)
3. Verificar logs: "lock acquired" solo en 1 instancia
4. **Desactivar** cron en `server.ts` (comentar líneas 111-142)
5. Deploy server sin cron

## ARCHIVOS
- `backend/src/workers/insights.worker.ts` (NUEVO)
- `backend/src/workers/profiles.worker.ts` (NUEVO)
- `backend/src/utils/distributed-lock.ts` (NUEVO)
- `backend/src/db/migrate.ts` (AÑADIR tabla cron_locks si SQLite lock)
- `backend/package.json` (SCRIPTS)
- `backend/server.ts` (REMOVER cron lines 111-142)

## AGENTE RECOMENDADO
`general` - Workers + infra + migración segura.