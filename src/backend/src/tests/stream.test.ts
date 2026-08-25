import request from 'supertest';
import app from '../app';
import { prisma } from '../config/db';
import { redis } from '../config/redis';

describe('Stream API Integration Tests', () => {
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

  it('GET /api/v1/stream/config should return stream URLs and bitrate profiles', async () => {
    const response = await request(app).get('/api/v1/stream/config');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status', 'success');
    expect(response.body.data).toHaveProperty('primaryHlsUrl');
    expect(response.body.data).toHaveProperty('fallbackAacUrl');
    expect(response.body.data).toHaveProperty('bitrateKbps');
    expect(response.body.data.bitrateKbps.primary).toBe(128);
    expect(response.body.data.bitrateKbps.fallback).toBe(64);
  });

  it('GET /api/v1/stream/nowplaying should return live track metadata structure', async () => {
    const response = await request(app).get('/api/v1/stream/nowplaying');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status', 'success');
    expect(response.body.data).toHaveProperty('isLive', true);
    expect(response.body.data).toHaveProperty('track');
    expect(response.body.data.track).toHaveProperty('artist');
    expect(response.body.data.track).toHaveProperty('title');
  });
});
