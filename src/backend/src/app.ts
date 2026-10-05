import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs';
import { config } from './config';
import { httpLogger } from './middlewares/logger';
import { errorHandler } from './middlewares/errorHandler';
import { apiRateLimiter } from './middlewares/rateLimiter';
import routes from './routes';

export function createApp(): Express {
  const app = express();

  // Trust reverse proxy (Azure Container Apps / NGINX / Cloudflare)
  app.set('trust proxy', true);

  // Security Headers & CORS
  const allowedOrigins = config.corsOrigin && config.corsOrigin.includes(',')
    ? config.corsOrigin.split(',').map((o) => o.trim())
    : config.corsOrigin || '*';

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(
    cors({
      origin: allowedOrigins,
      credentials: true,
    })
  );

  // Request Logging & Body Parsing
  app.use(httpLogger);
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Static File Serving
  app.use(express.static(path.join(__dirname, '../public')));
  app.use(express.static(path.join(__dirname, 'public')));

  // Account Deletion HTML Page Routes
  app.get(['/delete-account', '/account-deletion', '/user/delete-account'], (_req, res) => {
    const rootPublic = path.join(__dirname, '../public/account-deletion.html');
    const srcPublic = path.join(__dirname, 'public/account-deletion.html');
    if (fs.existsSync(rootPublic)) {
      res.sendFile(rootPublic);
    } else {
      res.sendFile(srcPublic);
    }
  });

  // Apply Rate Limiting on API Endpoints
  app.use('/api/v1', apiRateLimiter);

  // Routes & Swagger Docs
  app.use(routes);

  // Global Error Handler
  app.use(errorHandler);

  return app;
}

export default createApp();

