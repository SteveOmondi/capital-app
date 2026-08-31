import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { redis } from '../config/redis';

describe('News API Integration Tests', () => {
  jest.setTimeout(30000);

  afterAll(async () => {
    try {
      await prisma.$disconnect();
      if (redis.status === 'ready' || redis.status === 'connecting') {
        redis.disconnect();
      }
    } catch (_) {
      // Ignore teardown errors
    }
  });

  it('GET /api/v1/news/categories should return 200 OK with categories array', async () => {
    const response = await request(app).get('/api/v1/news/categories');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status', 'success');
    expect(response.body.data).toHaveProperty('categories');
    expect(Array.isArray(response.body.data.categories)).toBe(true);
    expect(response.body.data.categories.length).toBeGreaterThan(0);
    expect(response.body.data.categories[0]).toHaveProperty('slug');
    expect(response.body.data.categories[0]).toHaveProperty('name');
  });

  it('GET /api/v1/news should return 200 OK with news array structure', async () => {
    const response = await request(app).get('/api/v1/news?page=1&limit=5');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status', 'success');
    expect(response.body).toHaveProperty('data');
    expect(response.body.data).toHaveProperty('articles');
    expect(Array.isArray(response.body.data.articles)).toBe(true);
  });

  it('GET /api/v1/news with search parameter should respond gracefully', async () => {
    const response = await request(app).get('/api/v1/news?search=nairobi');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status', 'success');
    expect(response.body.data).toHaveProperty('articles');
  }, 15000);
});
