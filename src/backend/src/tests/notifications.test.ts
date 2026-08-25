import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { redis } from '../config/redis';
import { config } from '../config';

describe('Push Notifications & Webhooks Integration Tests', () => {
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

  describe('POST /api/v1/notifications/register', () => {
    it('should register FCM token for topics (breaking_news, podcasts, favorite shows)', async () => {
      const response = await request(app)
        .post('/api/v1/notifications/register')
        .send({
          token: 'mock-fcm-device-token-123',
          topics: ['breaking_news', 'podcast_episodes', 'podcast_financial_fitness', 'show_jam-984-mon'],
          action: 'subscribe',
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'success');
      expect(response.body.data).toHaveProperty('registeredTopics');
      expect(response.body.data.registeredTopics).toContain('breaking_news');
      expect(response.body.data.registeredTopics).toContain('podcast_episodes');
      expect(response.body.data.registeredTopics).toContain('show_jam-984-mon');
    });

    it('should return 400 Bad Request if token or topics are missing', async () => {
      const response = await request(app)
        .post('/api/v1/notifications/register')
        .send({ token: '' });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/v1/webhooks/wordpress/post-published', () => {
    it('should reject webhook request with 401 if x-webhook-secret is invalid', async () => {
      const response = await request(app)
        .post('/api/v1/webhooks/wordpress/post-published')
        .set('x-webhook-secret', 'invalid-secret')
        .send({ postId: 101, title: 'Breaking News' });

      expect(response.status).toBe(401);
    });

    it('should accept valid breaking news webhook request and trigger push dispatch', async () => {
      const response = await request(app)
        .post('/api/v1/webhooks/wordpress/post-published')
        .set('x-webhook-secret', config.security.wpWebhookSecret)
        .send({
          postId: 10452,
          title: 'Breaking News: Nairobi Traffic Flow Restored',
          excerpt: 'Expressway toll stations reporting clear lanes.',
          category: 'breaking_news',
          slug: 'nairobi-traffic-restored',
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'success');
      expect(response.body.data).toHaveProperty('success', true);
    });
  });

  describe('POST /api/v1/webhooks/podcasts/episode-published', () => {
    it('should accept valid podcast upload webhook request and trigger episode push notification', async () => {
      const response = await request(app)
        .post('/api/v1/webhooks/podcasts/episode-published')
        .set('x-webhook-secret', config.security.wpWebhookSecret)
        .send({
          podcastId: 'financial-fitness',
          episodeId: 'ep-42',
          title: 'The Financial Fitness Masterclass Ep 42',
          description: 'Expert advice on personal wealth management.',
          audioUrl: 'https://stream.capitalfm.africa/podcasts/ep42.mp3',
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'success');
      expect(response.body.data).toHaveProperty('success', true);
    });
  });
});
