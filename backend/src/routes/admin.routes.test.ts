import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { resetDb } from '../../test/setup.js';

// Mock authenticate and requireAdmin before importing the routes
vi.mock('../middleware/auth.js', () => ({
  authenticate: vi.fn((req: any, _res: any, next: any) => {
    req.user = req.user ?? { id: 'user-1', email: 'test@example.com', name: 'Test', role: 'user' };
    next();
  }),
}));

vi.mock('../middleware/admin.js', () => ({
  requireAdmin: vi.fn((req: any, _res: any, next: any) => {
    if (req.user?.role !== 'admin') {
      const err = Object.assign(new Error('Se requieren permisos de administrador'), { statusCode: 403 });
      throw err;
    }
    next();
  }),
}));

// Now import routes (the mocked middleware is used)
import adminRoutes from './admin.routes.js';

function buildApp(role: 'admin' | 'user' = 'user') {
  const app = express();
  app.use(express.json());
  // Override the user before the router runs
  app.use((req: any, _res, next) => {
    req.user = { id: 'user-1', email: 'test@example.com', name: 'Test', role };
    next();
  });
  app.use('/api/admin', adminRoutes);
  // Simple error handler to catch thrown errors
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode ?? 500).json({ error: err.message });
  });
  return app;
}

describe('Admin routes — 403 para no-admin', () => {
  beforeEach(() => {
    resetDb();
    vi.clearAllMocks();
  });

  it('GET /api/admin/users → 403 si role=user', async () => {
    const app = buildApp('user');
    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(403);
  });

  it('GET /api/admin/users/:userId/profile → 403 si role=user', async () => {
    const app = buildApp('user');
    const res = await request(app).get('/api/admin/users/any-user/profile');
    expect(res.status).toBe(403);
  });

  it('GET /api/admin/users/:userId/sessions → 403 si role=user', async () => {
    const app = buildApp('user');
    const res = await request(app).get('/api/admin/users/any-user/sessions');
    expect(res.status).toBe(403);
  });

  it('GET /api/admin/sessions/:sessionId/detail → 403 si role=user', async () => {
    const app = buildApp('user');
    const res = await request(app).get('/api/admin/sessions/any-session/detail');
    expect(res.status).toBe(403);
  });
});

describe('Admin routes — 200 para admin', () => {
  beforeEach(() => {
    resetDb();
    vi.clearAllMocks();
  });

  it('GET /api/admin/users → 200 si role=admin', async () => {
    const app = buildApp('admin');
    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(200);
    expect(res.body.users).toBeDefined();
  });

  it('GET /api/admin/users/:userId/profile → 200 si role=admin', async () => {
    const app = buildApp('admin');
    const res = await request(app).get('/api/admin/users/any-user/profile');
    expect(res.status).toBe(200);
    expect(res.body.profile).toBeDefined();
  });

  it('GET /api/admin/users/:userId/sessions → 200 si role=admin', async () => {
    const app = buildApp('admin');
    const res = await request(app).get('/api/admin/users/any-user/sessions');
    expect(res.status).toBe(200);
    expect(res.body.active).toBeDefined();
    expect(res.body.archived).toBeDefined();
  });

  it('GET /api/admin/sessions/:sessionId/detail → 200 si role=admin', async () => {
    const app = buildApp('admin');
    const res = await request(app).get('/api/admin/sessions/any-session/detail');
    expect(res.status).toBe(200);
    expect(res.body.messages).toBeDefined();
    expect(res.body.narrative).toBeDefined();
    expect(res.body.blocks).toBeDefined();
    expect(res.body.index).toBeDefined();
  });
});
