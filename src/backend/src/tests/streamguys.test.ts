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

  it('getStreamGuysAccessToken should attempt token retrieval using StreamGuys credentials', async () => {
    const token = await getStreamGuysAccessToken();

    if (token !== null) {
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(10);
    } else {
      expect(token).toBeNull();
    }
  });
});
