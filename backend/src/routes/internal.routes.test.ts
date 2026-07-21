import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { config } from '../config/index.js';
import internalRoutes from './internal.routes.js';
import { isJtiRevoked, _clearRevocationListForTests } from '../utils/session-revocation.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/internal', internalRoutes);
  return app;
}

describe('POST /internal/session/invalidate', () => {
  beforeEach(() => {
    _clearRevocationListForTests();
  });

  it('con el secreto correcto, revoca el jti', async () => {
    const app = buildApp();
    const exp = Math.floor(Date.now() / 1000) + 3600;

    const res = await request(app)
      .post('/internal/session/invalidate')
      .set('X-Internal-Secret', config.internal.apiSecret)
      .send({ jti: 'jti-to-revoke', exp });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ revoked: true });
    expect(isJtiRevoked('jti-to-revoke')).toBe(true);
  });

  it('sin el secreto (o con uno incorrecto) → 401, no revoca nada', async () => {
    const app = buildApp();
    const exp = Math.floor(Date.now() / 1000) + 3600;

    const resMissing = await request(app)
      .post('/internal/session/invalidate')
      .send({ jti: 'jti-x', exp });
    expect(resMissing.status).toBe(401);

    const resWrong = await request(app)
      .post('/internal/session/invalidate')
      .set('X-Internal-Secret', 'secreto-incorrecto')
      .send({ jti: 'jti-x', exp });
    expect(resWrong.status).toBe(401);

    expect(isJtiRevoked('jti-x')).toBe(false);
  });

  it('sin jti o sin exp → 400', async () => {
    const app = buildApp();

    const noJti = await request(app)
      .post('/internal/session/invalidate')
      .set('X-Internal-Secret', config.internal.apiSecret)
      .send({ exp: Math.floor(Date.now() / 1000) + 3600 });
    expect(noJti.status).toBe(400);

    const noExp = await request(app)
      .post('/internal/session/invalidate')
      .set('X-Internal-Secret', config.internal.apiSecret)
      .send({ jti: 'jti-y' });
    expect(noExp.status).toBe(400);
  });
});
