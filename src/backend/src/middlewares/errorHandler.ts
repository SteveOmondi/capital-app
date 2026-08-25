import { Request, Response, NextFunction } from 'express';
import { logger } from './logger';
import { config } from '../config';

export interface AppError extends Error {
  statusCode?: number;
  details?: unknown;
}

export function errorHandler(
  err: AppError,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
): void {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  logger.error(
    {
      err,
      url: req.originalUrl,
      method: req.method,
      statusCode,
    },
    `Unhandled Exception: ${message}`
  );

  res.status(statusCode).json({
    status: 'error',
    statusCode,
    message,
    ...(config.env === 'development' && { stack: err.stack, details: err.details }),
  });
}
