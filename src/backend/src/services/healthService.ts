import { checkDatabaseConnection } from '../config/db';
import { checkRedisConnection } from '../config/redis';

export interface ReadinessStatus {
  status: 'ok' | 'degraded' | 'error';
  timestamp: string;
  uptimeSeconds: number;
  services: {
    postgres: { healthy: boolean };
    redis: { healthy: boolean };
  };
}

export async function getLivenessStatus() {
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptimeSeconds: process.uptime(),
  };
}

export async function getReadinessStatus(): Promise<ReadinessStatus> {
  const [dbHealthy, redisHealthy] = await Promise.all([
    checkDatabaseConnection(),
    checkRedisConnection(),
  ]);

  const allHealthy = dbHealthy && redisHealthy;
  const partiallyHealthy = dbHealthy || redisHealthy;

  return {
    status: allHealthy ? 'ok' : partiallyHealthy ? 'degraded' : 'error',
    timestamp: new Date().toISOString(),
    uptimeSeconds: process.uptime(),
    services: {
      postgres: { healthy: dbHealthy },
      redis: { healthy: redisHealthy },
    },
  };
}
