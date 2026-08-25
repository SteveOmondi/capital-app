import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { redis } from '../config/redis';

describe('User Profile & Favorites Sync Integration Tests', () => {
  jest.setTimeout(15000);
  const testEmail = 'stephen.test@capitalfm.africa';
  const testUsername = 'Stephen';

  afterAll(async () => {
    try {
      await prisma.userFavorite.deleteMany({
        where: { user: { email: testEmail } },
      });
      await prisma.user.deleteMany({
        where: { email: testEmail },
      });
      await prisma.$disconnect();
      if (redis.status === 'ready' || redis.status === 'connecting') {
        redis.disconnect();
      }
    } catch (_) {
      // Ignore cleanup error
    }
  });

  describe('POST /api/v1/user/profile', () => {
    it('should create or update subscribed user profile and return personalized welcome message', async () => {
      const response = await request(app)
        .post('/api/v1/user/profile')
        .send({
          email: testEmail,
          username: testUsername,
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'success');
      expect(response.body.data).toHaveProperty('email', testEmail);
      expect(response.body.data).toHaveProperty('username', testUsername);
      expect(response.body.data.welcomeMessage).toContain('Welcome to Capital FM, Stephen!');
    });

    it('should return 400 Bad Request if email is missing', async () => {
      const response = await request(app)
        .post('/api/v1/user/profile')
        .send({});

      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/v1/user/profile', () => {
    it('should return user profile when authenticated with X-User-Email header', async () => {
      const response = await request(app)
        .get('/api/v1/user/profile')
        .set('X-User-Email', testEmail);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveProperty('email', testEmail);
    });

    it('should return 401 Unauthorized if auth headers are missing', async () => {
      const response = await request(app).get('/api/v1/user/profile');
      expect(response.status).toBe(401);
    });
  });

  describe('Server Favorites Sync Endpoints', () => {
    let createdFavoriteId: string;

    it('POST /api/v1/user/favorites should save favorite article/show for user', async () => {
      const response = await request(app)
        .post('/api/v1/user/favorites')
        .set('X-User-Email', testEmail)
        .send({
          itemType: 'show',
          itemId: 'jam-984-mon',
          metadata: { title: 'Capital In The Morning', presenters: ['Fareed Khimani'] },
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('status', 'success');
      expect(response.body.data).toHaveProperty('itemType', 'show');
      expect(response.body.data).toHaveProperty('itemId', 'jam-984-mon');
      createdFavoriteId = response.body.data.id;
    });

    it('GET /api/v1/user/favorites should return saved user favorites', async () => {
      const response = await request(app)
        .get('/api/v1/user/favorites')
        .set('X-User-Email', testEmail);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveProperty('favorites');
      expect(response.body.data.favorites.length).toBeGreaterThan(0);
    });

    it('DELETE /api/v1/user/favorites/:id should delete favorite record', async () => {
      const response = await request(app)
        .delete(`/api/v1/user/favorites/${createdFavoriteId}`)
        .set('X-User-Email', testEmail);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'success');
    });
  });
});
