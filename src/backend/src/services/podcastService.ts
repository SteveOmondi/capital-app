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

  const rawTargetUrl = config.streamguys.podcastRssUrl || config.services.podcastRssUrl;
  const urls = rawTargetUrl.split(',').map((u) => u.trim()).filter(Boolean);

  const aggregatedEpisodes: any[] = [];
  const defaultImageUrl = 'https://www.capitalfm.africa/wp-content/uploads/2026/05/cropped-cfmlogo-1-150x150.jpg';
  const fallbackStreamUrl = config.streamguys.primaryHlsUrl || config.services.liveStreamPrimaryUrl;

  await Promise.all(
    urls.map(async (url) => {
      try {
        const response = await fetch(url);
        if (response.ok) {
          const xmlData = await response.text();
          const channel = parsePodcastRssXml(xmlData);

          if (channel.episodes && channel.episodes.length > 0) {
            aggregatedEpisodes.push(...channel.episodes);
          } else {
            // Create a show episode entry from the RSS channel metadata if no item enclosures exist yet
            aggregatedEpisodes.push({
              guid: url,
              title: channel.title,
              description: channel.description || `${channel.title} on Capital FM Kenya`,
              audioUrl: fallbackStreamUrl,
              duration: '45:00',
              publishedAt: new Date().toISOString(),
              publishedTimestamp: Date.now(),
              imageUrl: channel.imageUrl || defaultImageUrl,
            });
          }
        }
      } catch (error) {
        logger.warn({ url, error }, 'Failed to fetch individual podcast RSS feed');
      }
    })
  );

  if (aggregatedEpisodes.length > 0) {
    const resultChannel: PodcastChannel = {
      title: 'Capital FM Kenya Podcasts',
      description: 'Tune into Capital FM Kenya top podcasts, interviews, and audio shows.',
      link: 'https://www.capitalfm.africa',
      imageUrl: defaultImageUrl,
      episodes: aggregatedEpisodes,
    };

    if (redis.status === 'ready') {
      redis.setex(cacheKey, 900, JSON.stringify(resultChannel)).catch(() => {});
    }

    return resultChannel;
  }

  // Graceful fallback channel payload if all RSS fetches failed
  const fallbackChannel: PodcastChannel = {
    title: 'Capital FM Kenya Podcasts',
    description: 'Tune into Capital FM Kenya top podcasts, interviews, and audio shows.',
    link: 'https://www.capitalfm.africa',
    imageUrl: defaultImageUrl,
    episodes: [
      {
        guid: 'capital-fm-podcast-jam-984',
        title: 'The Jam 98.4 Highlights',
        description: 'Daily highlights and interviews from The Jam 98.4 on Capital FM Kenya.',
        audioUrl: fallbackStreamUrl,
        duration: '45:00',
        publishedAt: new Date().toISOString(),
        publishedTimestamp: Date.now(),
        imageUrl: defaultImageUrl,
      },
      {
        guid: 'capital-fm-podcast-breakfast',
        title: 'Capital FM Breakfast Show Highlights',
        description: 'Catch up on news, discussion, and top commentary from the morning team.',
        audioUrl: fallbackStreamUrl,
        duration: '60:00',
        publishedAt: new Date(Date.now() - 86400000).toISOString(),
        publishedTimestamp: Date.now() - 86400000,
        imageUrl: defaultImageUrl,
      },
    ],
  };

  return fallbackChannel;
}
