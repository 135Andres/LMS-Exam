import 'express-async-errors';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import cron from 'node-cron';
import { config } from './src/config/index.js';
import { getDb } from './src/db/connection.js';
import { errorHandler } from './src/utils/errors.js';
import { logger } from './src/utils/logger.js';
import { globalLimiter } from './src/middleware/rateLimiter.js';
import examRoutes from './src/routes/exam.routes.js';
import adminRoutes from './src/routes/admin.routes.js';
import chatRoutes from './src/routes/chat.routes.js';
import userRoutes from './src/routes/user.routes.js';
import { generateDailyInsights } from './src/services/insights.service.js';
import { updateProfileForUser } from './src/services/profile-update.service.js';
import { startEmbeddingWorker, stopEmbeddingWorker, processEmbeddingOutbox } from './src/workers/embedding-worker.js';

const app = express();

app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://cdn.jsdelivr.net", "https://pagead2.googlesyndication.com"],
      styleSrc: ["'self'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com", "'unsafe-inline'"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:"],
      frameSrc: ["'none'"],
      connectSrc: ["'self'"],
    },
  },
}));

app.use(cors({
  origin: config.cors.origin,
  credentials: true,
}));

app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());

// Redirect / to login.html
app.get('/', (_req, res) => res.redirect('/login.html'));

app.use(express.static('../public'));

app.use(globalLimiter);

// Proxy /auth/* to Python Auth Service (port 3001)
app.use('/auth', async (req, res, _next) => {
  try {
    const targetUrl = `http://localhost:3001/auth${req.url}`;

    const headers: Record<string, string> = {
      'Content-Type': req.headers['content-type'] as string || 'application/json',
    };

    // Forward Cloudflare headers for correct rate-limiting
    if (req.headers['cf-connecting-ip']) {
      headers['CF-Connecting-IP'] = req.headers['cf-connecting-ip'] as string;
    }
    if (req.headers['x-forwarded-for']) {
      headers['X-Forwarded-For'] = req.headers['x-forwarded-for'] as string;
    }

    // Forward cookies (session_token)
    if (req.headers.cookie) {
      headers['Cookie'] = req.headers.cookie as string;
    }

    const body = req.method !== 'GET' && req.method !== 'HEAD'
      ? JSON.stringify(req.body)
      : undefined;

    const response = await fetch(targetUrl, { method: req.method, headers, body });

    // Forward Set-Cookie from Python to client
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) {
      res.setHeader('Set-Cookie', setCookie);
    }

    const data = await response.text();
    res.status(response.status).type('application/json').send(data);
  } catch (err: any) {
    logger.error('Auth proxy error:', err.message);
    res.status(502).json({ detail: 'Servicio de autenticación no disponible' });
  }
});
app.use('/api/exams', examRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/user', userRoutes);

app.get('/api/status', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use(errorHandler);

// Embedding outbox worker: procesa embeddings pendientes en background
startEmbeddingWorker();

// Recuperar outbox pendiente tras restart/crash
processEmbeddingOutbox().catch(err => logger.error('Outbox recovery failed', { error: (err as Error).message }));

getDb();

app.listen(config.port, () => {
  logger.info(`Servidor iniciado en puerto ${config.port}`);
});

// Cron: generar insights cada día a las 2 AM
cron.schedule('0 2 * * *', async () => {
  logger.info('Cron: iniciando generación de insights diarios');
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const date = yesterday.toISOString().slice(0, 10);

  try {
    const users = getDb().prepare('SELECT id FROM users').all() as Array<{ id: string }>;
    for (const user of users) {
      await generateDailyInsights(user.id, date);
    }
    logger.info('Cron: insights diarios completados', { users: users.length, date });
  } catch (err) {
    logger.error('Cron: error en generación de insights', { error: (err as Error).message });
  }
});

// Cron: actualizar perfiles cada noche a las 3 AM (después de insights)
cron.schedule('0 3 * * *', async () => {
  logger.info('Cron: iniciando actualización de perfiles');
  try {
    const users = getDb().prepare('SELECT id FROM users').all() as Array<{ id: string }>;
    let updated = 0;
    for (const user of users) {
      const ok = await updateProfileForUser(user.id);
      if (ok) updated++;
    }
    logger.info('Cron: actualización de perfiles completada', { total: users.length, updated });
  } catch (err) {
    logger.error('Cron: error en actualización de perfiles', { error: (err as Error).message });
  }
});

// Graceful shutdown para embedding worker
process.on('SIGTERM', () => { stopEmbeddingWorker(); process.exit(0); });
process.on('SIGINT', () => { stopEmbeddingWorker(); process.exit(0); });
