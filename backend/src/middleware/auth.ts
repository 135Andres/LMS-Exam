import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/index.js';
import { UserModel } from '../models/user.model.js';
import { UnauthorizedError } from '../utils/errors.js';
import { isJtiRevoked } from '../utils/session-revocation.js';
import { logger } from '../utils/logger.js';

interface SessionJwtPayload {
  email: string;
  jti: string;
  iat: number;
  exp: number;
}

// Heurística de formato: los JWT son 3 segmentos separados por '.'. Los
// tokens de sesión "legacy" (pre-JWT) son un secrets.token_urlsafe() de
// Python — base64url sin puntos. Mientras dure la migración, un cookie con
// el formato viejo sigue validándose contra Python (camino con red); uno
// con forma de JWT se valida localmente, sin red.
function looksLikeJwt(token: string): boolean {
  return token.split('.').length === 3;
}

function isSessionJwtPayload(payload: unknown): payload is SessionJwtPayload {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as Record<string, unknown>).email === 'string' &&
    typeof (payload as Record<string, unknown>).jti === 'string'
  );
}

async function resolveUser(email: string): Promise<{ id: string; email: string; name: string; role: 'admin' | 'user' }> {
  let user = UserModel.findByEmail(email);
  if (!user) {
    UserModel.create({
      id: uuidv4(),
      email,
      username: email.split('@')[0],
      role: 'user',
    });
    user = UserModel.findByEmail(email);
  }
  if (!user) {
    throw new UnauthorizedError('No se pudo crear el usuario');
  }
  return { id: user.id, email: user.email, name: user.username || email.split('@')[0], role: user.role };
}

// Renovación "rara": si el JWT está por vencer, se intenta canjearlo por uno
// nuevo contra Python. Es la única llamada de red que puede quedar en este
// archivo, y solo ocurre cerca del vencimiento (config.jwt.refreshGraceWindowMs),
// nunca en el camino normal. Con timeout corto y sin bloquear la request si
// falla: el JWT actual sigue siendo válido hasta su exp real.
async function tryRefresh(currentToken: string, res: Response): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetch(`${config.authServiceUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_token: currentToken }),
      signal: controller.signal,
    });
    if (!response.ok) return;
    const data = (await response.json()) as { session_token?: string };
    if (data.session_token) {
      res.cookie('session_token', data.session_token, {
        httpOnly: true,
        secure: config.isProd,
        sameSite: 'lax',
        path: '/',
      });
    }
  } catch (err) {
    logger.warn('Refresh de sesión JWT falló (no bloqueante)', { error: (err as Error).message });
  } finally {
    clearTimeout(timeout);
  }
}

async function authenticateViaJwt(token: string, res: Response, req: Request, next: NextFunction): Promise<void> {
  let payload: SessionJwtPayload;
  try {
    const decoded = jwt.verify(token, config.jwt.secret, {
      algorithms: ['HS256'],
      clockTolerance: 30, // segundos — tolera reloj desincronizado entre Node y Python
    });
    if (!isSessionJwtPayload(decoded)) {
      throw new UnauthorizedError('Sesión inválida');
    }
    payload = decoded;
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err;
    throw new UnauthorizedError('Sesión inválida o expirada');
  }

  if (isJtiRevoked(payload.jti)) {
    throw new UnauthorizedError('Sesión revocada');
  }

  const msUntilExpiry = payload.exp * 1000 - Date.now();
  if (msUntilExpiry < config.jwt.refreshGraceWindowMs) {
    // Fire-and-forget: no se espera esto para responder la request actual.
    void tryRefresh(token, res);
  }

  req.user = await resolveUser(payload.email);
  next();
}

// Camino legacy (pre-JWT): igual que el authenticate original, valida contra
// Python vía HTTP en cada request. Se mantiene solo para no invalidar de
// golpe las sesiones ya emitidas antes de este cambio — se retira cuando
// termine la ventana de migración (ver plan 09).
async function authenticateViaLegacySession(token: string, req: Request, next: NextFunction): Promise<void> {
  let email: string;
  try {
    const response = await fetch(`${config.authServiceUrl}/auth/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_token: token }),
    });
    if (!response.ok) {
      throw new UnauthorizedError('Sesión inválida o expirada');
    }
    const data = (await response.json()) as { email: string };
    email = data.email;
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err;
    throw new UnauthorizedError('Error al validar sesión');
  }

  req.user = await resolveUser(email);
  next();
}

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const sessionToken = req.cookies?.session_token as string | undefined;

  if (!sessionToken) {
    throw new UnauthorizedError('Sesión requerida');
  }

  if (looksLikeJwt(sessionToken)) {
    await authenticateViaJwt(sessionToken, res, req, next);
  } else {
    await authenticateViaLegacySession(sessionToken, req, next);
  }
}
