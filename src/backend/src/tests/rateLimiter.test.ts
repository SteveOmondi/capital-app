import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { redis } from '../config/redis';

describe('Rate Limiter & Swagger UI Integration Tests', () => {
  jest.setTimeout(15000);

  afterAll(async () => {
    try {
      await prisma.$disconnect();
      if (redis.status === 'ready' || redis.status === 'connecting') {
        redis.disconnect();
      }
    } catch (_) {
      // Ignore teardown
    }
  });

  it('GET /docs should return 200 OK with Swagger UI HTML page', async () => {
    const response = await request(app).get('/docs/');

    expect([200, 301, 302]).toContain(response.status);
    if (response.status === 200) {
      expect(response.text).toContain('swagger');
    }
  });

  it('GET /api/v1/news should include RateLimit headers', async () => {
    const response = await request(app).get('/api/v1/news?page=1&limit=2');

    expect(response.status).toBe(200);
    expect(response.headers).toHaveProperty('ratelimit-limit');
    expect(response.headers['ratelimit-limit']).toBe('60');
  });
});
