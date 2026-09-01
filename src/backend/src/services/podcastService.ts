import { config } from '../config';
import { parsePodcastRssXml, PodcastChannel } from '../utils/rssParser';
import { redis } from '../config/redis';
import { logger } from '../middlewares/logger';

const STREAMGUYS_DEFAULT_RSS_FEEDS = [
  'https://atunwadigital-rss.streamguys1.com/content/capitalfmmixmasters/kdeja-thedj-mix.xml',
  'https://atunwadigital-rss.streamguys1.com/content/capitalfmmixmasters/dj-schwaz-mix.xml',
  'https://atunwadigital-rss.streamguys1.com/content/capitalfmmixmasters/dj-pikachu-mix.xml',
  'https://atunwadigital-rss.streamguys1.com/content/capitalfmmixmasters/dj-uv-mix.xml',
  'https://atunwadigital-rss.streamguys1.com/content/capitalfmmixmasters/dj-slick-mix.xml',
  'https://atunwadigital-rss.streamguys1.com/content/capitalfmmixmasters/dj-tony-mix.xml',
  'https://atunwadigital-rss.streamguys1.com/content/capitalfmmixmasters/dj-adrian-mix.xml',
];

export async function getPodcastChannel(): Promise<PodcastChannel> {
  const cacheKey = 'podcasts:streamguys:channel:v4';

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
  const urls = rawTargetUrl
    ? rawTargetUrl.split(',').map((u) => u.trim()).filter(Boolean)
    : STREAMGUYS_DEFAULT_RSS_FEEDS;

  const aggregatedEpisodes: any[] = [];
  const defaultImageUrl = 'https://www.capitalfm.africa/wp-content/uploads/2026/05/cropped-cfmlogo-1-150x150.jpg';
  const fallbackStreamUrl = config.streamguys.primaryHlsUrl || config.services.liveStreamPrimaryUrl;

  await Promise.all(
    urls.map(async (url) => {
      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
        });
        if (response.ok) {
          const xmlData = await response.text();
          const channel = parsePodcastRssXml(xmlData);

          if (channel.episodes && channel.episodes.length > 0) {
            const validEpisodes = channel.episodes.filter((ep) => ep.audioUrl && ep.audioUrl.trim().length > 0);
            if (validEpisodes.length > 0) {
              aggregatedEpisodes.push(...validEpisodes);
            }
          } else if (channel.title) {
            aggregatedEpisodes.push({
              guid: url,
              title: channel.title,
              description: channel.description || `${channel.title} Mixmaster Podcast on StreamGuys`,
              audioUrl: 'https://atunwadigital.streamguys1.com/capitalfm',
              duration: '45:00',
              publishedAt: new Date().toISOString(),
              publishedTimestamp: Date.now(),
              imageUrl: channel.imageUrl || defaultImageUrl,
            });
          }
        }
      } catch (error) {
        logger.warn({ url, error }, 'Failed to fetch individual StreamGuys podcast RSS feed');
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
        audioUrl: 'https://atunwadigital.streamguys1.com/capitalfm',
        duration: '45:00',
        publishedAt: new Date().toISOString(),
        publishedTimestamp: Date.now(),
        imageUrl: defaultImageUrl,
      },
    ],
  };

  return fallbackChannel;
}
export async function getWebsiteRssPodcastChannel(): Promise<PodcastChannel> {
  const cacheKey = 'podcasts:channel:rss';

  if (redis.status === 'ready') {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (_) {
      // Ignore cache read error
    }
  }

  const websiteRssUrl = 'https://capitalfm.africa/podcasts/feed/';
  const defaultImageUrl = 'https://www.capitalfm.africa/wp-content/uploads/2026/05/cropped-cfmlogo-1-150x150.jpg';

  try {
    const response = await fetch(websiteRssUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (response.ok) {
      const xmlData = await response.text();
      const channel = parsePodcastRssXml(xmlData);

      if (redis.status === 'ready') {
        redis.setex(cacheKey, 900, JSON.stringify(channel)).catch(() => {});
      }

      return channel;
    }
  } catch (error) {
    logger.warn({ error, url: websiteRssUrl }, 'Failed to fetch website RSS podcast feed');
  }

  return {
    title: 'Capital FM Website Podcasts',
    description: 'Latest audio shows and interview podcasts from Capital FM Kenya.',
    link: 'https://capitalfm.africa',
    imageUrl: defaultImageUrl,
    episodes: [],
  };
}
