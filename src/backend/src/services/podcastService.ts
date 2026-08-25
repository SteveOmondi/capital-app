import { config } from '../config';
import { parsePodcastRssXml, PodcastChannel } from '../utils/rssParser';
import { redis } from '../config/redis';
import { logger } from '../middlewares/logger';

export async function getPodcastChannel(): Promise<PodcastChannel> {
  const cacheKey = 'podcasts:channel:all';

  // Redis cache check
  if (redis.status === 'ready') {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (_) {
      // Ignore cache error
    }
  }

  try {
    const response = await fetch(config.services.podcastRssUrl);
    if (!response.ok) {
      throw new Error(`Podcast RSS feed returned status ${response.status}`);
    }

    const xmlData = await response.text();
    const channel = parsePodcastRssXml(xmlData);

    // Cache in Redis for 15 minutes (900 seconds)
    if (redis.status === 'ready') {
      redis.setex(cacheKey, 900, JSON.stringify(channel)).catch(() => {});
    }

    return channel;
  } catch (error) {
    logger.error({ error, url: config.services.podcastRssUrl }, 'Failed to fetch Podcast RSS feed');
    
    // Return graceful fallback channel payload if RSS is unreachable
    return {
      title: 'Capital FM Podcasts',
      description: 'Tune into Capital FM Kenya top podcasts, interviews, and shows.',
      link: 'https://www.capitalfm.africa',
      episodes: [],
    };
  }
}
