import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request, Response as ExpressResponse } from 'express';
import jwt from 'jsonwebtoken';
import { getTestDb, resetDb } from '../../test/setup.js';
import { config } from '../config/index.js';
import { authenticate } from './auth.js';
import { revokeJti, _clearRevocationListForTests } from '../utils/session-revocation.js';

function signSessionJwt(overrides: Partial<{ email: string; jti: string; expiresInSeconds: number }> = {}) {
  const email = overrides.email ?? 'student@example.com';
  const jti = overrides.jti ?? 'jti-1';
  const expiresInSeconds = overrides.expiresInSeconds ?? 24 * 3600;
  return jwt.sign({ email, jti }, config.jwt.secret, {
    algorithm: 'HS256',
    expiresIn: expiresInSeconds,
  });
}

function mockReqRes(cookieValue?: string) {
  const req = { cookies: cookieValue !== undefined ? { session_token: cookieValue } : {} } as unknown as Request;
  const res = { cookie: vi.fn() } as unknown as ExpressResponse;
  const next = vi.fn();
  return { req, res, next };
}

describe('authenticate — JWT path', () => {
  beforeEach(() => {
    resetDb();
    _clearRevocationListForTests();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('JWT válido autentica sin llamar a Python (sin fetch)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const token = signSessionJwt({ email: 'valid@example.com' });
    const { req, res, next } = mockReqRes(token);

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user?.email).toBe('valid@example.com');
    expect(fetchSpy).not.toHaveBeenCalled();

    const db = getTestDb();
    const row = db.prepare('SELECT * FROM users WHERE email = ?').get('valid@example.com');
    expect(row).toBeTruthy();
  });

  it('JWT expirado → 401, sin llamar a Python', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const token = signSessionJwt({ expiresInSeconds: -60 }); // ya vencido
    const { req, res, next } = mockReqRes(token);

    await expect(authenticate(req, res, next)).rejects.toMatchObject({ statusCode: 401 });
    expect(next).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('JWT con firma inválida/manipulado → 401', async () => {
    const token = signSessionJwt();
    const tampered = token.slice(0, -2) + (token.slice(-2) === 'aa' ? 'bb' : 'aa');
    const { req, res, next } = mockReqRes(tampered);

    await expect(authenticate(req, res, next)).rejects.toMatchObject({ statusCode: 401 });
    expect(next).not.toHaveBeenCalled();
  });

  it('JWT firmado con un secreto distinto → 401', async () => {
    const token = jwt.sign({ email: 'x@example.com', jti: 'j1' }, 'otro-secreto-totalmente-distinto', {
      algorithm: 'HS256',
      expiresIn: 3600,
    });
    const { req, res, next } = mockReqRes(token);

    await expect(authenticate(req, res, next)).rejects.toMatchObject({ statusCode: 401 });
    expect(next).not.toHaveBeenCalled();
  });

  it('revocación explícita (logout): un jti revocado rechaza un JWT que antes era válido', async () => {
    const token = signSessionJwt({ jti: 'revoke-me', expiresInSeconds: 3600 });
    const { req: req1, res: res1, next: next1 } = mockReqRes(token);
    await authenticate(req1, res1, next1);
    expect(next1).toHaveBeenCalledTimes(1);

    const decoded = jwt.decode(token) as { exp: number };
    revokeJti('revoke-me', decoded.exp);

    const { req: req2, res: res2, next: next2 } = mockReqRes(token);
    await expect(authenticate(req2, res2, next2)).rejects.toMatchObject({ statusCode: 401 });
    expect(next2).not.toHaveBeenCalled();
  });

  it('dispara una renovación (fire-and-forget) cuando el JWT está por vencer, y sigue autenticando igual', async () => {
    const newToken = signSessionJwt({ jti: 'jti-refreshed' });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ session_token: newToken }),
    } as Response);

    const almostExpired = signSessionJwt({ expiresInSeconds: 60 }); // dentro de la ventana de gracia (1h default)
    const { req, res, next } = mockReqRes(almostExpired);

    await authenticate(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);

    // Deja correr el fire-and-forget.
    await new Promise(resolve => setImmediate(resolve));
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/auth/refresh'),
      expect.objectContaining({ method: 'POST' })
    );
    expect(res.cookie).toHaveBeenCalledWith('session_token', newToken, expect.any(Object));
  });

  it('si la renovación falla (timeout/red), la request en curso no se ve afectada', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

    const almostExpired = signSessionJwt({ expiresInSeconds: 60 });
    const { req, res, next } = mockReqRes(almostExpired);

    await authenticate(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user?.email).toBe('student@example.com');

    await new Promise(resolve => setImmediate(resolve));
    expect(res.cookie).not.toHaveBeenCalled();
  });
});

describe('authenticate — camino legacy (migración)', () => {
  beforeEach(() => {
    resetDb();
    _clearRevocationListForTests();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('un cookie en formato viejo (token opaco, sin puntos) sigue funcionando validando contra Python', async () => {
    const legacyToken = 'opaque-legacy-session-token-abc123';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ email: 'legacy-user@example.com', valid: true }),
    } as Response);

    const { req, res, next } = mockReqRes(legacyToken);
    await authenticate(req, res, next);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/auth/validate'),
      expect.objectContaining({ method: 'POST' })
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user?.email).toBe('legacy-user@example.com');
  });

  it('token legacy inválido según Python → 401', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false } as Response);

    const { req, res, next } = mockReqRes('opaque-invalid-token');
    await expect(authenticate(req, res, next)).rejects.toMatchObject({ statusCode: 401 });
    expect(next).not.toHaveBeenCalled();
  });
});

describe('authenticate — sin cookie', () => {
  it('sin session_token → 401', async () => {
    const { req, res, next } = mockReqRes(undefined);
    await expect(authenticate(req, res, next)).rejects.toMatchObject({ statusCode: 401 });
    expect(next).not.toHaveBeenCalled();
  });
});
