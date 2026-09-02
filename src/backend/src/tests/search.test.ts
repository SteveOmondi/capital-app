import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { redis } from '../config/redis';

describe('Global Search API Integration Tests', () => {
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

  it('GET /api/v1/search without search query should return 400 Bad Request', async () => {
    const response = await request(app).get('/api/v1/search');

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('status', 'fail');
    expect(response.body).toHaveProperty('message');
    expect(response.body.message).toContain('required');
  });

  it('GET /api/v1/search?q=kenya should return 200 OK with news and podcast results', async () => {
    const response = await request(app).get('/api/v1/search?q=kenya');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status', 'success');
    expect(response.body).toHaveProperty('data');
    expect(response.body.data).toHaveProperty('query', 'kenya');
    expect(response.body.data).toHaveProperty('totalResults');
    expect(response.body.data).toHaveProperty('news');
    expect(response.body.data).toHaveProperty('podcasts');

    expect(Array.isArray(response.body.data.news.articles)).toBe(true);
    expect(Array.isArray(response.body.data.podcasts.episodes)).toBe(true);
  });

  it('GET /api/v1/search?q=mix&type=podcasts should return podcasts results', async () => {
    const response = await request(app).get('/api/v1/search?q=mix&type=podcasts');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status', 'success');
    expect(response.body.data.news.articles.length).toBe(0);
    expect(response.body.data).toHaveProperty('podcasts');
    expect(Array.isArray(response.body.data.podcasts.episodes)).toBe(true);
  });

  it('GET /api/v1/search?q=sports&type=news&category=sports should return news articles', async () => {
    const response = await request(app).get('/api/v1/search?q=sports&type=news&category=sports');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status', 'success');
    expect(response.body.data).toHaveProperty('news');
    expect(response.body.data.podcasts.episodes.length).toBe(0);
  });
});
