import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { redis } from '../config/redis';

describe('Health Endpoints Integration Tests', () => {
  jest.setTimeout(15000);

  afterAll(async () => {
    try {
      await prisma.$disconnect();
      if (redis.status === 'ready' || redis.status === 'connecting') {
        redis.disconnect();
      }
    } catch (_) {
      // Ignore cleanup
    }
  });

  describe('GET /healthz (Liveness Check)', () => {
    it('should return 200 OK with liveness status details', async () => {
      const response = await request(app).get('/healthz');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('uptimeSeconds');
      expect(typeof response.body.uptimeSeconds).toBe('number');
    });
  });

  describe('GET /readyz (Readiness Check)', () => {
    it('should return health status payload', async () => {
      const response = await request(app).get('/readyz');

      expect([200, 503]).toContain(response.status);
      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('services');
      expect(response.body.services).toHaveProperty('postgres');
      expect(response.body.services).toHaveProperty('redis');
    });
  });
});
