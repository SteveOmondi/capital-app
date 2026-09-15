import { config } from '../config';
import { parsePodcastRssXml, PodcastChannel } from '../utils/rssParser';
import { redis } from '../config/redis';
import { logger } from '../middlewares/logger';

import { getStreamGuysAccessToken } from './streamGuysService';

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
  const cacheKey = 'podcasts:streamguys:channel:v5';

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

  const defaultImageUrl = 'https://www.capitalfm.africa/wp-content/uploads/2026/05/cropped-cfmlogo-1-150x150.jpg';

  // ----------------------------------------------------
  // TIER 1: StreamGuys OAuth REST API (Primary Option)
  // ----------------------------------------------------
  try {
    const token = await getStreamGuysAccessToken();
    if (token) {
      const host = config.streamguys.host || 'https://atunwadigital-recast.streamguys1.com';
      const listApiUrl = `${host.replace(/\/$/, '')}/api/v1/sgrecast/podcasts/feeds`;

      const response = await fetch(listApiUrl, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
        },
      });

      if (response.ok) {
        const apiData: any = await response.json();
        const items = Array.isArray(apiData) ? apiData : apiData.data || apiData.podcasts || [];
        if (items.length > 0) {
          logger.info({ count: items.length }, 'Successfully retrieved podcasts from StreamGuys REST API (Tier 1)');

          const episodes = await Promise.all(
            items.map(async (item: any) => {
              let audioUrl = item.audio_url || item.stream_url || item.url || 'https://atunwadigital.streamguys1.com/capitalfm';
              let duration = item.duration || '45:00';
              let description = item.description || item.summary || `${item.name || 'Capital FM Podcast'} Show`;

              // If podcast item has an associated RSS feed URL, attempt to parse live audio enclosure
              if (item.rssFeed) {
                try {
                  const feedRes = await fetch(item.rssFeed, {
                    headers: { 'User-Agent': 'CapitalFM-App/1.0' },
                  });
                  if (feedRes.ok) {
                    const xml = await feedRes.text();
                    const parsedChannel = parsePodcastRssXml(xml);
                    if (parsedChannel.episodes && parsedChannel.episodes.length > 0) {
                      const topEp = parsedChannel.episodes[0];
                      if (topEp.audioUrl) audioUrl = topEp.audioUrl;
                      if (topEp.duration) duration = topEp.duration;
                      if (topEp.description) description = topEp.description;
                    }
                  }
                } catch (_) {
                  // Fall back to API default properties
                }
              }

              return {
                guid: String(item.id || item.guid || Math.random()),
                title: item.name || item.title || 'Capital FM Podcast',
                description,
                audioUrl,
                duration,
                publishedAt: item.createdAt || item.created_at || new Date().toISOString(),
                publishedTimestamp: item.createdAtTimestamp ? item.createdAtTimestamp * 1000 : Date.now(),
                imageUrl: item.image || item.image_url || item.artwork || defaultImageUrl,
              };
            })
          );

          const resultChannel: PodcastChannel = {
            title: 'Capital FM Kenya Podcasts',
            description: 'Tune into Capital FM Kenya top podcasts, interviews, and audio shows.',
            link: 'https://www.capitalfm.africa',
            imageUrl: defaultImageUrl,
            episodes,
          };

          if (redis.status === 'ready') {
            redis.setex(cacheKey, 900, JSON.stringify(resultChannel)).catch(() => {});
          }
          return resultChannel;
        }
      }
    }
  } catch (error) {
    logger.warn({ error }, 'StreamGuys REST API Tier 1 call failed, falling back to Tier 2 RSS Gateway');
  }

  // ----------------------------------------------------
  // TIER 2: StreamGuys Recast RSS Feeds Gateway
  // ----------------------------------------------------
  const rawTargetUrl = config.streamguys.podcastRssUrl || config.services.podcastRssUrl;
  const urls = rawTargetUrl
    ? rawTargetUrl.split(',').map((u) => u.trim()).filter(Boolean)
    : STREAMGUYS_DEFAULT_RSS_FEEDS;

  const aggregatedEpisodes: any[] = [];

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

  // ----------------------------------------------------
  // TIER 3: Fallback Channel Payload
  // ----------------------------------------------------
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
