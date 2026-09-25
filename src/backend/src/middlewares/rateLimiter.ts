import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { redis } from '../config/redis';
import { logger } from './logger';

export const apiRateLimiter = rateLimit({
  skip: () => process.env.DISABLE_RATE_LIMIT === 'true',
  windowMs: 60 * 1000, // 1 minute window
  max: 60, // Limit each IP to 60 requests per windowMs
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  validate: { trustProxy: false },
  message: {
    status: 'error',
    statusCode: 429,
    message: 'Too Many Requests. Rate limit of 60 requests per minute exceeded.',
  },
  store:
    redis.status === 'ready'
      ? new RedisStore({
          sendCommand: async (...args: string[]) => {
            try {
              return await (redis.call as any)(...args);
            } catch (_) {
              return null;
            }
          },
          prefix: 'rl:bff:',
        })
      : undefined,
  handler: (req, res, next, options) => {
    logger.warn({ ip: req.ip, url: req.originalUrl }, 'API rate limit exceeded by client IP');
    res.status(options.statusCode).json(options.message);
  },
});
