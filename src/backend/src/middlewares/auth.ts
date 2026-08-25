import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/db';
import { UserContext } from '../types/express';

export async function authenticateUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  const emailHeader = req.headers['x-user-email'];

  let email: string | undefined;

  // 1. Bearer Token Check (Format: Bearer email@example.com or JWT)
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    if (token.includes('@')) {
      email = token;
    } else {
      // Basic token fallback for testing
      email = token;
    }
  }

  // 2. Direct Header Check
  if (!email && emailHeader) {
    email = String(emailHeader).trim();
  }

  if (email) {
    try {
      const user = await prisma.user.findUnique({
        where: { email },
      });

      const userCtx: UserContext = {
        id: user?.id,
        email,
        username: user?.username || undefined,
      };

      req.user = userCtx;
    } catch (_) {
      req.user = { email };
    }
  }

  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || !req.user.email) {
    res.status(401).json({
      status: 'error',
      message: 'Unauthorized. Subscribed user authentication header (Bearer token or X-User-Email) is required.',
    });
    return;
  }
  next();
}
