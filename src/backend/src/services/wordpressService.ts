import { config } from '../config';
import { stripHtml } from '../utils/htmlStripper';
import { prisma } from '../config/db';
import { redis } from '../config/redis';
import { logger } from '../middlewares/logger';

export interface ArticleDTO {
  id: number;
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  categorySlug: string;
  author: string;
  coverImageUrl?: string;
  publishedAt: string;
  publishedAtTimestamp: number;
}

export interface FetchArticlesQuery {
  category?: string;
  page?: number;
  limit?: number;
  search?: string;
}

/**
 * Transforms raw WordPress Post DTO into sanitized ArticleDTO.
 */
function transformWpPost(post: any): ArticleDTO {
  const title = post.title?.rendered ? stripHtml(post.title.rendered) : 'Untitled';
  const rawExcerpt = post.excerpt?.rendered || '';
  const rawContent = post.content?.rendered || '';

  const excerpt = stripHtml(rawExcerpt);
  const content = stripHtml(rawContent);

  // Extract featured image from _embedded if available
  let coverImageUrl: string | undefined;
  if (post._embedded && post._embedded['wp:featuredmedia']?.[0]?.source_url) {
    coverImageUrl = post._embedded['wp:featuredmedia'][0].source_url;
  }

  // Extract author name if available
  const authorName = post._embedded?.author?.[0]?.name || 'Capital Digital';

  // Parse GMT date into timestamp
  const dateGmt = post.date_gmt ? `${post.date_gmt}Z` : post.date || new Date().toISOString();
  const publishedAtTimestamp = new Date(dateGmt).getTime() || Date.now();

  return {
    id: post.id,
    slug: post.slug || `article-${post.id}`,
    title,
    excerpt: excerpt || title,
    content,
    categorySlug: post.category_slug || 'news',
    author: authorName,
    coverImageUrl,
    publishedAt: new Date(publishedAtTimestamp).toISOString(),
    publishedAtTimestamp,
  };
}

/**
 * Syncs posts to PostgreSQL in background for Full-Text Search.
 */
async function syncArticlesToPostgres(articles: ArticleDTO[]): Promise<void> {
  try {
    for (const article of articles) {
      await prisma.article.upsert({
        where: { id: article.id },
        update: {
          title: article.title,
          slug: article.slug,
          excerpt: article.excerpt,
          content: article.content,
          categorySlug: article.categorySlug,
          author: article.author,
          coverImageUrl: article.coverImageUrl,
          publishedAt: new Date(article.publishedAtTimestamp),
        },
        create: {
          id: article.id,
          title: article.title,
          slug: article.slug,
          excerpt: article.excerpt,
          content: article.content,
          categorySlug: article.categorySlug,
          author: article.author,
          coverImageUrl: article.coverImageUrl,
          publishedAt: new Date(article.publishedAtTimestamp),
        },
      });
    }
  } catch (error) {
    logger.warn({ error }, 'Background PostgreSQL FTS sync skipped or failed');
  }
}

/**
 * Fetches news articles with support for Category filtering, Pagination, Redis Caching, and Full-Text Search.
 */
export async function getArticles(params: FetchArticlesQuery): Promise<{ articles: ArticleDTO[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, params.page || 1);
  const limit = Math.min(50, Math.max(1, params.limit || 10));
  const category = params.category || 'all';
  const search = params.search?.trim();

  // 1. Full-Text Search via PostgreSQL if search term is provided
  if (search && search.length > 0) {
    try {
      const skip = (page - 1) * limit;
      const whereCondition: any = {
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { content: { contains: search, mode: 'insensitive' } },
          { excerpt: { contains: search, mode: 'insensitive' } },
        ],
      };

      if (category !== 'all') {
        whereCondition.categorySlug = category;
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
        const articles: ArticleDTO[] = items.map((item) => ({
          id: item.id,
          slug: item.slug,
          title: item.title,
          excerpt: item.excerpt || item.title,
          content: item.content,
          categorySlug: item.categorySlug,
          author: item.author || 'Capital Digital',
          coverImageUrl: item.coverImageUrl || undefined,
          publishedAt: item.publishedAt.toISOString(),
          publishedAtTimestamp: item.publishedAt.getTime(),
        }));

        return { articles, total, page, limit };
      }
    } catch (dbError) {
      logger.warn({ dbError }, 'PostgreSQL FTS query failed, falling back to WP API');
    }
  }

  // 2. Redis Caching Check for non-search listings
  const cacheKey = `articles:${category}:page:${page}:limit:${limit}`;
  if (!search && redis.status === 'ready') {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (_) {
      // Ignore cache read error
    }
  }

  // 3. Upstream WordPress REST API Call
  let wpUrl = `${config.services.wpCmsBaseUrl}/posts?_embed=true&page=${page}&per_page=${limit}`;
  if (search) {
    wpUrl += `&search=${encodeURIComponent(search)}`;
  }

  try {
    const response = await fetch(wpUrl);
    if (!response.ok) {
      throw new Error(`WordPress API returned status ${response.status}`);
    }

    const totalHeader = response.headers.get('X-WP-Total');
    const total = totalHeader ? parseInt(totalHeader, 10) : 0;

    const rawPosts = (await response.json()) as any[];
    const articles = rawPosts.map((post) => {
      const dto = transformWpPost(post);
      if (category !== 'all') {
        dto.categorySlug = category;
      }
      return dto;
    });

    // Async sync to Postgres for future FTS queries
    syncArticlesToPostgres(articles);

    const result = { articles, total: total || articles.length, page, limit };

    // Cache in Redis for 5 minutes (300 seconds)
    if (!search && redis.status === 'ready') {
      redis.setex(cacheKey, 300, JSON.stringify(result)).catch(() => {});
    }

    return result;
  } catch (error) {
    logger.error({ error, wpUrl }, 'Failed to fetch articles from WordPress API');

    // Fallback: Query local PostgreSQL if WP API is down
    try {
      const skip = (page - 1) * limit;
      const dbArticles = await prisma.article.findMany({
        orderBy: { publishedAt: 'desc' },
        skip,
        take: limit,
      });

      const fallbackDtos: ArticleDTO[] = dbArticles.map((item) => ({
        id: item.id,
        slug: item.slug,
        title: item.title,
        excerpt: item.excerpt || item.title,
        content: item.content,
        categorySlug: item.categorySlug,
        author: item.author || 'Capital Digital',
        coverImageUrl: item.coverImageUrl || undefined,
        publishedAt: item.publishedAt.toISOString(),
        publishedAtTimestamp: item.publishedAt.getTime(),
      }));

      return { articles: fallbackDtos, total: fallbackDtos.length, page, limit };
    } catch (_) {
      throw error;
    }
  }
}
