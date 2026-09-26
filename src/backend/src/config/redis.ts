import Redis from 'ioredis';
import { config } from './index';

export const redis = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  connectTimeout: 3000,
  commandTimeout: 2000,
  enableOfflineQueue: true,
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    if (times > 10) return null;
    return Math.min(times * 100, 2000);
  },
});

redis.on('connect', () => {
  // Redis connected successfully
});

redis.on('error', (_) => {
  // Silent catch
});

export async function checkRedisConnection(): Promise<boolean> {
  try {
    if (redis.status !== 'ready') {
      await redis.connect();
    }
    const pong = await redis.ping();
    return pong === 'PONG';
  } catch (error) {
    return false;
  }
}
