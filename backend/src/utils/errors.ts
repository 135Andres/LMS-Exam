import type { Request, Response, NextFunction } from 'express';

export class AppError extends Error {
  statusCode: number;
  details: unknown;
  isOperational: boolean;

  constructor(statusCode: number, message: string, details: unknown = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Recurso') {
    super(404, `${resource} no encontrado`);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'No autorizado') {
    super(401, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Acceso denegado') {
    super(403, message);
  }
}

export class ValidationError extends AppError {
  constructor(details: unknown) {
    super(400, 'Error de validación', details);
  }
}

export function errorHandler(err: AppError, _req: Request, res: Response, _next: NextFunction): void {
  const statusCode = err.statusCode || 500;
  const message = err.isOperational ? err.message : 'Error interno del servidor';

  if (!err.isOperational) {
    console.error('Error inesperado:', err);
  }

  const responseBody: Record<string, unknown> = { error: message };
  if (err.details) {
    responseBody.details = err.details;
  }
  res.status(statusCode).json(responseBody);
}
