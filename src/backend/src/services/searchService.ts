import { getArticles, ArticleDTO } from './wordpressService';
import { getPodcastChannel, getWebsiteRssPodcastChannel } from './podcastService';
import { PodcastEpisode } from '../utils/rssParser';
import { redis } from '../config/redis';
import { logger } from '../middlewares/logger';

export interface GlobalSearchQuery {
  query: string;
  category?: string;
  type?: string;
  page?: number;
  limit?: number;
}

export interface GlobalSearchResultDTO {
  query: string;
  totalResults: number;
  news: {
    total: number;
    page: number;
    limit: number;
    articles: ArticleDTO[];
  };
  podcasts: {
    total: number;
    page: number;
    limit: number;
    episodes: PodcastEpisode[];
  };
}

/**
 * Searches podcast episodes by title or description matching query terms.
 */
async function searchPodcastEpisodes(
  query: string,
  page: number,
  limit: number
): Promise<{ episodes: PodcastEpisode[]; total: number; page: number; limit: number }> {
  try {
    const [sgChannel, webChannel] = await Promise.all([
      getPodcastChannel().catch(() => ({ episodes: [] })),
      getWebsiteRssPodcastChannel().catch(() => ({ episodes: [] })),
    ]);

    const allEpisodes = [...(sgChannel.episodes || []), ...(webChannel.episodes || [])];

    // Deduplicate by guid or title+audioUrl
    const seen = new Set<string>();
    const uniqueEpisodes: PodcastEpisode[] = [];
    for (const ep of allEpisodes) {
      const key = ep.guid || `${ep.title}-${ep.audioUrl}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueEpisodes.push(ep);
      }
    }

    const searchTerm = query.toLowerCase().trim();
    const matchedEpisodes = uniqueEpisodes.filter((ep) => {
      const titleMatch = ep.title ? ep.title.toLowerCase().includes(searchTerm) : false;
      const descMatch = ep.description ? ep.description.toLowerCase().includes(searchTerm) : false;
      return titleMatch || descMatch;
    });

    // Sort by latest published date first
    matchedEpisodes.sort((a, b) => b.publishedTimestamp - a.publishedTimestamp);

    const startIndex = (page - 1) * limit;
    const paginatedEpisodes = matchedEpisodes.slice(startIndex, startIndex + limit);

    return {
      episodes: paginatedEpisodes,
      total: matchedEpisodes.length,
      page,
      limit,
    };
  } catch (error) {
    logger.warn({ error, query }, 'Failed to fetch or search podcast episodes');
    return { episodes: [], total: 0, page, limit };
  }
}

/**
 * Executes a global search across all news categories and podcasts.
 */
export async function performGlobalSearch(params: GlobalSearchQuery): Promise<GlobalSearchResultDTO> {
  const query = (params.query || '').trim();
  const category = (params.category || 'all').toLowerCase();
  const type = (params.type || 'all').toLowerCase();
  const page = Math.max(1, params.page || 1);
  const limit = Math.min(50, Math.max(1, params.limit || 10));

  if (!query) {
    return {
      query: '',
      totalResults: 0,
      news: { total: 0, page, limit, articles: [] },
      podcasts: { total: 0, page, limit, episodes: [] },
    };
  }

  const cacheKey = `search:v1:${type}:${category}:${encodeURIComponent(query.toLowerCase())}:p${page}:l${limit}`;

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

  const shouldSearchNews = type === 'all' || type === 'news';
  const shouldSearchPodcasts =
    (type === 'all' || type === 'podcast' || type === 'podcasts') &&
    (category === 'all' || category === 'podcast' || category === 'podcasts');

  const newsPromise = shouldSearchNews
    ? getArticles({
        category: category !== 'podcasts' && category !== 'podcast' ? category : 'all',
        page,
        limit,
        search: query,
      }).catch((err) => {
        logger.warn({ err }, 'News search failed in global search');
        return { articles: [], total: 0, page, limit };
      })
    : Promise.resolve({ articles: [], total: 0, page, limit });

  const podcastsPromise = shouldSearchPodcasts
    ? searchPodcastEpisodes(query, page, limit)
    : Promise.resolve({ episodes: [], total: 0, page, limit });

  const [newsResult, podcastsResult] = await Promise.all([newsPromise, podcastsPromise]);

  const result: GlobalSearchResultDTO = {
    query,
    totalResults: newsResult.total + podcastsResult.total,
    news: {
      total: newsResult.total,
      page: newsResult.page,
      limit: newsResult.limit,
      articles: newsResult.articles,
    },
    podcasts: {
      total: podcastsResult.total,
      page: podcastsResult.page,
      limit: podcastsResult.limit,
      episodes: podcastsResult.episodes,
    },
  };

  if (redis.status === 'ready') {
    redis.setex(cacheKey, 300, JSON.stringify(result)).catch(() => {});
  }

  return result;
}
