import type { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/index.js';
import { UserModel } from '../models/user.model.js';
import { UnauthorizedError } from '../utils/errors.js';

export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const sessionToken = req.cookies?.session_token as string | undefined;

  if (!sessionToken) {
    throw new UnauthorizedError('Sesión requerida');
  }

  try {
    const response = await fetch(`${config.authServiceUrl}/auth/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_token: sessionToken }),
    });

    if (!response.ok) {
      throw new UnauthorizedError('Sesión inválida o expirada');
    }

    const data = await response.json();
    const email: string = data.email;

    // Auto-create user in SQLite on first authentication
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

    req.user = {
      id: user.id,
      email: user.email,
      name: user.username || email.split('@')[0],
      role: user.role,
    };

    next();
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err;
    throw new UnauthorizedError('Error al validar sesión');
  }
}
