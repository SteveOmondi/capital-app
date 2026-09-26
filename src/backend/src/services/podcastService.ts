import { config } from '../config';
import { parsePodcastRssXml, PodcastChannel, PodcastEpisode } from '../utils/rssParser';
import { redis } from '../config/redis';
import { logger } from '../middlewares/logger';

const DEFAULT_IMAGE_URL = 'https://www.capitalfm.africa/wp-content/uploads/2026/05/cropped-cfmlogo-1-150x150.jpg';

export interface PodcastGroupDTO {
  id: number;
  slug: string;
  name: string;
  podcastCount?: number;
  episodeCount?: number;
  apiUrl?: string;
}

export interface FetchPodcastEpisodesQuery {
  group?: string;
  search?: string;
  page?: number;
  limit?: number;
}

/**
 * Fetches podcast sections/groups (/podcasts/groups) from WordPress Public API v2.3.1.
 * Cached in Redis for 1 hour (3600s).
 */
export async function getPodcastGroups(): Promise<PodcastGroupDTO[]> {
  const cacheKey = 'podcasts:wp:groups:v1';

  if (redis.status === 'ready') {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (_) {}
  }

  const url = `${config.services.capitalFmApiBaseUrl}/podcasts/groups`;

  try {
    const response = await fetch(url);
    if (response.ok) {
      const json = (await response.json()) as any;
      const rawGroups = Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : [];

      const groups: PodcastGroupDTO[] = rawGroups.map((g: any) => ({
        id: g.id,
        slug: g.slug,
        name: g.name,
        podcastCount: g.podcast_count,
        episodeCount: g.episode_count,
        apiUrl: g.api_url,
      }));

      if (redis.status === 'ready' && groups.length > 0) {
        redis.setex(cacheKey, 3600, JSON.stringify(groups)).catch(() => {});
      }

      return groups;
    }
  } catch (error) {
    logger.warn({ error, url }, 'Failed to fetch podcast groups from WordPress Public API');
  }

  // Fallback default groups as defined in WordPress API v2.3.1 docs
  return [
    { id: 232, slug: 'catch-up-radio', name: 'Catch Up Radio' },
    { id: 234, slug: 'mixmasters', name: 'Mixmasters' },
    { id: 233, slug: 'capital-podcasts', name: 'Capital Podcasts' },
    { id: 122, slug: 'capital-fm', name: 'Capital FM' },
  ];
}

/**
 * Transforms WordPress API episode JSON object to PodcastEpisode interface.
 * Preserves audio.url including StreamGuys analytics parameters (?awCollectionId=...).
 */
function transformWpEpisode(ep: any): PodcastEpisode {
  const pubDateStr = ep.published_at || ep.publishedAt || ep.published || ep.date_gmt || ep.date || new Date().toISOString();
  const publishedTimestamp = new Date(pubDateStr).getTime() || Date.now();

  const audioUrl = typeof ep.audio === 'object' ? ep.audio?.url || '' : ep.audio || ep.audioUrl || '';

  return {
    guid: String(ep.guid || ep.id || Math.random()),
    title: ep.title || 'Capital FM Podcast Episode',
    description: ep.description || ep.title || 'Capital FM Podcast',
    audioUrl,
    duration: ep.duration || (ep.duration_seconds ? `${Math.floor(ep.duration_seconds / 60)}:${String(ep.duration_seconds % 60).padStart(2, '0')}` : '45:00'),
    publishedAt: new Date(publishedTimestamp).toISOString(),
    publishedTimestamp,
    imageUrl: ep.image || ep.podcast?.image || DEFAULT_IMAGE_URL,
  };
}

/**
 * Helper to fetch directly from WordPress API + Atunwa RSS feeds, save to Postgres, and write to Redis.
 */
async function fetchPodcastsFromUpstreamAndSave(
  query: FetchPodcastEpisodesQuery,
  cacheKey: string
): Promise<{ episodes: PodcastEpisode[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, query.page || 1);
  const limit = Math.min(50, Math.max(1, query.limit || 10));
  const group = query.group;
  const search = query.search?.trim();

  let episodes: PodcastEpisode[] = [];
  let total = 0;

  // A. Try WordPress Podcast API
  try {
    const queryParams = new URLSearchParams();
    queryParams.set('page', String(page));
    queryParams.set('per_page', String(limit));
    if (group) queryParams.set('group', group);
    if (search) queryParams.set('search', search);

    const url = `${config.services.capitalFmApiBaseUrl}/podcasts/episodes?${queryParams.toString()}`;
    const response = await fetch(url);

    if (response.ok) {
      const json = (await response.json()) as any;
      const rawEpisodes = Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : [];
      const totalHeader = response.headers.get('X-WP-Total');
      total = json.meta?.total !== undefined ? json.meta.total : totalHeader ? parseInt(totalHeader, 10) : rawEpisodes.length;

      episodes = rawEpisodes.map((ep: any) => transformWpEpisode(ep));
    }
  } catch (err) {
    logger.warn({ err }, 'WordPress podcast fetch failed, falling back to Atunwa RSS Step');
  }

  // B. Fallback / Augment with Atunwa RSS & Website RSS Step if WP API was empty
  if (episodes.length === 0) {
    const fallbackChannel = await getWebsiteRssPodcastChannel();
    const filtered = search ? fallbackChannel.episodes.filter((ep) => ep.title.toLowerCase().includes(search.toLowerCase())) : fallbackChannel.episodes;
    const startIndex = (page - 1) * limit;

    episodes = filtered.slice(startIndex, startIndex + limit);
    total = filtered.length;
  }

  // C. Sync fetched episodes to PostgreSQL database
  try {
    const { prisma } = require('../config/db');
    for (const ep of episodes) {
      const epId = Math.abs(hashCode(ep.guid)) || (Date.now() % 2147483647);
      await prisma.article.upsert({
        where: { id: epId },
        update: {
          title: ep.title,
          slug: `podcast-${ep.guid}`,
          excerpt: ep.description,
          content: ep.description,
          categorySlug: group || 'podcasts',
          author: 'Capital FM Podcasts',
          coverImageUrl: ep.imageUrl,
          publishedAt: new Date(ep.publishedTimestamp),
        },
        create: {
          id: epId,
          title: ep.title,
          slug: `podcast-${ep.guid}`,
          excerpt: ep.description,
          content: ep.description,
          categorySlug: group || 'podcasts',
          author: 'Capital FM Podcasts',
          coverImageUrl: ep.imageUrl,
          publishedAt: new Date(ep.publishedTimestamp),
        },
      });
    }
  } catch (_) {}

  const result = { episodes, total, page, limit };

  // Write to Redis with refreshed TTL (900 seconds)
  if (redis.status === 'ready' && episodes.length > 0) {
    await redis.setex(cacheKey, 900, JSON.stringify(result)).catch(() => {});
  }

  return result;
}

/**
 * Triggers background podcast refetch from Atunwa API & RSS feeds.
 */
function triggerBackgroundPodcastSync(query: FetchPodcastEpisodesQuery, cacheKey: string): void {
  setImmediate(() => {
    fetchPodcastsFromUpstreamAndSave(query, cacheKey).catch((err) => {
      logger.warn({ err }, 'Background podcast sync failed silently');
    });
  });
}

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0;
  }
  return hash;
}

/**
 * Fetches podcast episodes collection with 3-tier fallback:
 * 1. Redis Cache (if present) + trigger background Atunwa/RSS refetch
 * 2. PostgreSQL DB (if present) + update Redis with refreshed 900s TTL + trigger background Atunwa/RSS refetch
 * 3. Atunwa API & RSS Feeds (Upstream) + update Postgres & Redis with refreshed 900s TTL
 */
export async function getPodcastEpisodes(query: FetchPodcastEpisodesQuery = {}): Promise<{ episodes: PodcastEpisode[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, query.page || 1);
  const limit = Math.min(50, Math.max(1, query.limit || 10));
  const group = query.group;
  const search = query.search?.trim();

  const cacheKey = `podcasts:episodes:group:${group || 'all'}:search:${search || ''}:p:${page}:l:${limit}`;

  // 1. Check Redis Cache
  if (redis.status === 'ready') {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        const result = JSON.parse(cached);
        triggerBackgroundPodcastSync(query, cacheKey);
        return result;
      }
    } catch (_) {}
  }

  // 2. Check PostgreSQL Database (Prisma)
  try {
    const { prisma } = require('../config/db');
    const skip = (page - 1) * limit;
    const whereCondition: any = {
      categorySlug: group || 'podcasts',
    };
    if (search && search.length > 0) {
      whereCondition.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { excerpt: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.article.findMany({
        where: whereCondition,
        orderBy: { publishedAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.article.count({ where: whereCondition }),
    ]);

    if (total > 0) {
      const episodes: PodcastEpisode[] = items.map((item: any) => ({
        guid: item.slug.replace(/^podcast-/, ''),
        title: item.title,
        description: item.excerpt || item.title,
        audioUrl: '',
        duration: '45:00',
        publishedAt: item.publishedAt.toISOString(),
        publishedTimestamp: item.publishedAt.getTime(),
        imageUrl: item.coverImageUrl || DEFAULT_IMAGE_URL,
      }));

      const result = { episodes, total, page, limit };

      // Update Redis content and reset/extend TTL to 900s
      if (redis.status === 'ready') {
        redis.setex(cacheKey, 900, JSON.stringify(result)).catch(() => {});
      }

      // Trigger background refetch from Atunwa API / RSS feeds
      triggerBackgroundPodcastSync(query, cacheKey);

      return result;
    }
  } catch (dbErr) {
    logger.warn({ dbErr }, 'PostgreSQL podcast query skipped or empty');
  }

  // 3. Fallback: Query Atunwa API & RSS feeds synchronously if neither Redis nor DB has data
  try {
    return await fetchPodcastsFromUpstreamAndSave(query, cacheKey);
  } catch (error) {
    logger.error({ error }, 'Failed to fetch podcast episodes from Atunwa & RSS API');
    return { episodes: [], total: 0, page, limit };
  }
}

/**
 * High-level Podcast Channel retriever.
 * Primary (Tier 1): WordPress Public API v2.3.1 (/podcasts/episodes)
 * Fallback (Tier 2): StreamGuys Recast RSS feeds / Website RSS
 */
export async function getPodcastChannel(group?: string): Promise<PodcastChannel> {
  const cacheKey = `podcasts:channel:wp:v2.3.1:${group || 'all'}`;

  if (redis.status === 'ready') {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (_) {}
  }

  // ----------------------------------------------------
  // TIER 1: WordPress Public API v2.3.1 (Primary Source)
  // ----------------------------------------------------
  try {
    const epResult = await getPodcastEpisodes({ group, page: 1, limit: 50 });
    if (epResult.episodes && epResult.episodes.length > 0) {
      const channel: PodcastChannel = {
        title: 'Capital FM Kenya Podcasts',
        description: 'Tune into Capital FM Kenya top podcasts, interviews, and audio shows.',
        link: 'https://www.capitalfm.africa',
        imageUrl: DEFAULT_IMAGE_URL,
        episodes: epResult.episodes,
      };

      if (redis.status === 'ready') {
        redis.setex(cacheKey, 900, JSON.stringify(channel)).catch(() => {});
      }

      return channel;
    }
  } catch (error) {
    logger.warn({ error }, 'Tier 1 WP API call failed for getPodcastChannel, falling back to Tier 2 RSS');
  }

  // ----------------------------------------------------
  // TIER 2: Website RSS / StreamGuys RSS Fallback
  // ----------------------------------------------------
  const fallbackChannel = await getWebsiteRssPodcastChannel();
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
    } catch (_) {}
  }

  const websiteRssUrl = 'https://capitalfm.africa/podcasts/feed/';

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
    imageUrl: DEFAULT_IMAGE_URL,
    episodes: [],
  };
}
