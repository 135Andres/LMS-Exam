import rateLimit from 'express-rate-limit';
import { config } from '../config/index.js';

export const globalLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes, intente más tarde' },
});

export const generateLimiter = rateLimit({
  windowMs: config.rateLimit.generateWindowHours * 60 * 60 * 1000,
  max: config.rateLimit.generateMax,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user?.id || req.ip) as string,
  message: { error: `Límite de ${config.rateLimit.generateMax} generaciones por hora alcanzado` },
});
