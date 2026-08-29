import { getStreamGuysAccessToken } from '../services/streamGuysService';
import { redis } from '../config/redis';

describe('StreamGuys API Integration Tests', () => {
  jest.setTimeout(15000);

  afterAll(async () => {
    try {
      if (redis.status === 'ready' || redis.status === 'connecting') {
        redis.disconnect();
      }
    } catch (_) {
      // Ignore cleanup
    }
  });

  it('getStreamGuysAccessToken should obtain a valid Bearer token using StreamGuys credentials', async () => {
    const token = await getStreamGuysAccessToken();

    expect(token).not.toBeNull();
    expect(typeof token).toBe('string');
    expect(token!.length).toBeGreaterThan(50);
  });
});
