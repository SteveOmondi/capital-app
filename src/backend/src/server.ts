import app from './app';
import { config } from './config';
import { logger } from './middlewares/logger';
import { prisma } from './config/db';
import { redis } from './config/redis';

const server = app.listen(config.port, '0.0.0.0', () => {
  logger.info(`🚀 Capital FM Backend Gateway listening on 0.0.0.0:${config.port} [${config.env}]`);
});

async function gracefulShutdown(signal: string) {
  logger.info(`Received ${signal}. Initiating graceful shutdown...`);

  server.close(async () => {
    logger.info('HTTP server closed.');

    try {
      await prisma.$disconnect();
      logger.info('PostgreSQL connection pool closed.');

      if (redis.status === 'ready') {
        await redis.quit();
        logger.info('Redis connection closed.');
      }
    } catch (err) {
      logger.error({ err }, 'Error during resource cleanup');
    }

    process.exit(0);
  });

  setTimeout(() => {
    logger.error('Forced shutdown timeout reached. Exiting immediately.');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
