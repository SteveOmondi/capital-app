import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config';
import { httpLogger } from './middlewares/logger';
import { errorHandler } from './middlewares/errorHandler';
import { apiRateLimiter } from './middlewares/rateLimiter';
import routes from './routes';

export function createApp(): Express {
  const app = express();

  // Security Headers & CORS
  app.use(helmet());
  app.use(
    cors({
      origin: config.corsOrigin,
      credentials: true,
    })
  );

  // Request Logging & Body Parsing
  app.use(httpLogger);
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Apply Rate Limiting on API Endpoints
  app.use('/api/v1', apiRateLimiter);

  // Routes & Swagger Docs
  app.use(routes);

  // Global Error Handler
  app.use(errorHandler);

  return app;
}

export default createApp();
