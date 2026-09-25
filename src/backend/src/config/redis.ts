import Redis from 'ioredis';
import { config } from './index';

export const redis = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  lazyConnect: true,
  connectTimeout: 500, // Strict 500ms connection timeout to prevent 20s request hangs
  commandTimeout: 300, // Strict 300ms command execution timeout
  enableOfflineQueue: false, // Do not queue commands when Redis is offline
  maxRetriesPerRequest: 1,
  retryStrategy(times) {
    if (times > 3) return null;
    return Math.min(times * 100, 500);
  },
});

redis.on('error', (err) => {
  // Silent fail / log warnings so app doesn't crash if Redis is temporarily unreachable
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
