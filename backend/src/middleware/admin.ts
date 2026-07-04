import type { Request, Response, NextFunction } from 'express';
import { ForbiddenError } from '../utils/errors.js';

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin') {
    throw new ForbiddenError('Se requieren permisos de administrador');
  }
  next();
}
