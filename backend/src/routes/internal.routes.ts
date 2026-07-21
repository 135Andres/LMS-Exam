import { Router } from 'express';
import { timingSafeEqual } from 'crypto';
import { config } from '../config/index.js';
import { revokeJti } from '../utils/session-revocation.js';
import { logger } from '../utils/logger.js';

const router = Router();

function secretMatches(provided: string | undefined): boolean {
  if (!provided) return false;
  const expected = Buffer.from(config.internal.apiSecret);
  const actual = Buffer.from(provided);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

// Llamado por el servicio Python desde /auth/logout para revocar de inmediato
// el JWT de sesión activo (un JWT firmado no se puede invalidar sin estado
// server-side). Autenticado con un secreto compartido dedicado, no con el
// JWT_SECRET de firma de tokens — ver nota en config/index.ts.
router.post('/session/invalidate', (req, res) => {
  const provided = req.headers['x-internal-secret'];
  if (!secretMatches(typeof provided === 'string' ? provided : undefined)) {
    res.status(401).json({ error: 'No autorizado' });
    return;
  }

  const { jti, exp } = req.body ?? {};
  if (typeof jti !== 'string' || !jti || typeof exp !== 'number') {
    res.status(400).json({ error: 'jti y exp son requeridos' });
    return;
  }

  revokeJti(jti, exp);
  logger.info('Sesión JWT revocada vía endpoint interno', { jti });
  res.status(200).json({ revoked: true });
});

export default router;
