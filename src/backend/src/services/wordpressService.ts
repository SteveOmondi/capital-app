import { config } from '../config';
import { stripHtml } from '../utils/htmlStripper';
import { prisma } from '../config/db';
import { redis } from '../config/redis';
import { logger } from '../middlewares/logger';

export interface AuthorDTO {
  id?: number;
  name: string;
  slug?: string;
  bio?: string;
  avatarUrl?: string;
  archiveUrl?: string;
  presenter?: {
    id?: number;
    slug?: string;
    name?: string;
  } | null;
}

export interface ArticleDTO {
  id: number;
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  categorySlug: string;
  author: string;
  authorDetails?: AuthorDTO;
  coverImageUrl?: string;
  publishedAt: string;
  publishedAtTimestamp: number;
  views?: { total: number; last_7_days: number };
  wordCount?: number;
  readingTimeMinutes?: number;
  trending?: { rank: number; views_in_window: number; window_days: number };
  seo?: any;
  share?: any;
  related?: any[];
}

export interface CategoryDTO {
  id: number;
  name: string;
  slug: string;
  count: number;
  description?: string;
  isVertical?: boolean;
  children?: CategoryDTO[];
}

export interface FetchArticlesQuery {
  category?: string;
  page?: number;
  limit?: number;
  search?: string;
  tag?: string;
  author?: string;
  from?: string;
  to?: string;
  exclude?: string;
  orderby?: string;
  order?: string;
  fields?: 'summary' | 'full';
}

const DEFAULT_CATEGORIES: CategoryDTO[] = [
  { id: 8, name: 'News', slug: 'news', count: 450, isVertical: true, description: 'Latest breaking news and national updates' },
  { id: 2, name: 'Sports', slug: 'sports', count: 210, isVertical: true, description: 'Football, athletics and sports coverage' },
  { id: 3, name: 'Business', slug: 'business', count: 180, isVertical: true, description: 'Finance, markets, and economic news' },
  { id: 4, name: 'Lifestyle', slug: 'lifestyle', count: 150, isVertical: true, description: 'Health, travel, food, and culture' },
  { id: 5, name: 'Entertainment', slug: 'entertainment', count: 120, isVertical: true, description: 'Music, movies, and celebrity news' },
  { id: 6, name: 'Capital Campus', slug: 'capital-campus', count: 90, isVertical: true, description: 'Student, university, and youth feature stories' },
  { id: 7, name: 'Opinion', slug: 'opinion', count: 65, isVertical: true, description: 'Commentary, columns, and editorial pieces' },
];

/**
 * Parses author object from WordPress / Capital FM API response into AuthorDTO.
 */
function parseAuthorDetails(rawAuthor: any, embeddedAuthor?: any): AuthorDTO {
  const authorObj = typeof rawAuthor === 'object' && rawAuthor !== null ? rawAuthor : embeddedAuthor || {};
  const name = typeof rawAuthor === 'string'
    ? rawAuthor
    : authorObj.name || authorObj.display_name || 'Capital Digital';

  const id = authorObj.id ? parseInt(String(authorObj.id), 10) : undefined;
  const slug = authorObj.slug || authorObj.nicename || (id ? `author-${id}` : undefined);
  const rawBio = authorObj.bio || authorObj.description;
  const bio = rawBio ? stripHtml(rawBio) : undefined;
  const avatarUrl = authorObj.photo || authorObj.avatar || authorObj.avatar_urls?.['96'] || authorObj.avatar_urls?.['48'] || undefined;
  const archiveUrl = authorObj.archive_url || authorObj.url || authorObj.link || undefined;
  const presenter = authorObj.presenter || null;

  return {
    id,
    name,
    slug,
    bio,
    avatarUrl,
    archiveUrl,
    presenter,
  };
}

/**
 * Transforms raw Capital FM API article JSON into ArticleDTO.
 */
function transformApiArticle(item: any): ArticleDTO {
  const rawTitle = typeof item.title === 'object' ? item.title?.rendered || item.title?.text || '' : item.title || 'Untitled';
  const title = stripHtml(rawTitle);

  const rawExcerpt = typeof item.excerpt === 'object' ? item.excerpt?.rendered || '' : item.excerpt || '';
  const rawContent = typeof item.content === 'object' ? item.content?.html || item.content?.rendered || '' : item.content || '';

  const excerpt = stripHtml(rawExcerpt);
  const content = typeof item.content === 'object' && item.content?.html ? item.content.html : stripHtml(rawContent);

  let coverImageUrl: string | undefined = item.image?.url || item.coverImageUrl;
  if (!coverImageUrl && item._embedded && item._embedded['wp:featuredmedia']?.[0]?.source_url) {
    coverImageUrl = item._embedded['wp:featuredmedia'][0].source_url;
  }

  const embeddedAuthor = item._embedded && Array.isArray(item._embedded['author']) ? item._embedded['author'][0] : undefined;
  const authorDetails = parseAuthorDetails(item.author, embeddedAuthor);
  const authorName = authorDetails.name || 'Capital Digital';
  const pubDateStr = item.published_at || item.publishedAt || item.date_gmt || item.date || new Date().toISOString();
  const publishedAtTimestamp = new Date(pubDateStr).getTime() || Date.now();

  const categorySlug = item.primary_category?.slug || item.categorySlug || (Array.isArray(item.categories) && item.categories[0]?.slug) || 'news';

  return {
    id: item.id,
    slug: item.slug || `article-${item.id}`,
    title,
    excerpt: excerpt || title,
    content,
    categorySlug,
    author: authorName,
    authorDetails,
    coverImageUrl,
    publishedAt: new Date(publishedAtTimestamp).toISOString(),
    publishedAtTimestamp,
    views: item.views,
    wordCount: item.word_count || item.wordCount,
    readingTimeMinutes: item.reading_time_minutes || item.readingTimeMinutes,
    trending: item.trending,
    seo: item.seo,
    share: item.share,
    related: item.related,
  };
}

/**
 * Syncs posts to PostgreSQL in background for Full-Text Search.
 * Uses bulk createMany with skipDuplicates for high performance.
 */
async function syncArticlesToPostgres(articles: ArticleDTO[]): Promise<void> {
  if (!articles || articles.length === 0) return;
  try {
    const data = articles.map((article) => ({
      id: article.id,
      slug: article.slug,
      title: article.title,
      excerpt: article.excerpt || article.title,
      content: article.content,
      categorySlug: article.categorySlug,
      author: article.author || 'Capital Digital',
      coverImageUrl: article.coverImageUrl || null,
      publishedAt: new Date(article.publishedAtTimestamp),
    }));

    await prisma.article.createMany({
      data,
      skipDuplicates: true,
    });
  } catch (error) {
    logger.warn({ error }, 'Background PostgreSQL FTS sync skipped or failed');
  }
}

/**
 * Fetches main navigation category verticals (/categories) from Capital FM Public API.
 * Cached in Redis for 1 hour (3600s).
 */
export async function getNewsCategories(): Promise<CategoryDTO[]> {
  const cacheKey = 'news:categories:verticals';

  if (redis.status === 'ready') {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (_) {}
  }

  const url = `${config.services.capitalFmApiBaseUrl}/categories`;

  try {
    const response = await fetch(url);
    if (response.ok) {
      const rawCategories = (await response.json()) as any[];
      const categoriesArray = Array.isArray(rawCategories) ? rawCategories : (rawCategories as any).data || [];

      if (categoriesArray.length > 0) {
        const mapped: CategoryDTO[] = categoriesArray.map((cat: any) => ({
          id: cat.id,
          name: stripHtml(cat.name || ''),
          slug: cat.slug || '',
          count: cat.count || 0,
          isVertical: cat.is_vertical ?? true,
          description: cat.description ? stripHtml(cat.description) : undefined,
          children: Array.isArray(cat.children)
            ? cat.children.map((child: any) => ({
                id: child.id,
                name: stripHtml(child.name || ''),
                slug: child.slug || '',
                count: child.count || 0,
                isVertical: child.is_vertical ?? false,
              }))
            : undefined,
        }));

        if (redis.status === 'ready') {
          redis.setex(cacheKey, 3600, JSON.stringify(mapped)).catch(() => {});
        }
        return mapped;
      }
    }
  } catch (error) {
    logger.warn({ error }, 'Failed to fetch categories from Capital FM Public API. Serving default categories.');
  }

  return DEFAULT_CATEGORIES;
}

/**
 * Helper to fetch directly from WordPress REST API, update Postgres, and update Redis.
 */
async function fetchFromWordPressApiAndSave(
  params: FetchArticlesQuery,
  cacheKey: string
): Promise<{ articles: ArticleDTO[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, params.page || 1);
  const limit = Math.min(50, Math.max(1, params.limit || 10));
  const category = params.category || 'all';
  const search = params.search?.trim();
  const fields = params.fields || 'summary';

  const queryParams = new URLSearchParams();
  queryParams.set('page', String(page));
  queryParams.set('per_page', String(limit));
  queryParams.set('fields', fields);

  if (category !== 'all') queryParams.set('category', category);
  if (search) queryParams.set('search', search);
  if (params.tag) queryParams.set('tag', params.tag);
  if (params.author) queryParams.set('author', params.author);
  if (params.from) queryParams.set('from', params.from);
  if (params.to) queryParams.set('to', params.to);
  if (params.exclude) queryParams.set('exclude', params.exclude);
  if (params.orderby) queryParams.set('orderby', params.orderby);
  if (params.order) queryParams.set('order', params.order);

  const url = `${config.services.capitalFmApiBaseUrl}/articles?${queryParams.toString()}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);

  const response = await fetch(url, { signal: controller.signal });
  clearTimeout(timeoutId);

  if (!response.ok) {
    throw new Error(`Capital FM Articles API returned status ${response.status}`);
  }

  const totalHeader = response.headers.get('X-WP-Total') || response.headers.get('meta.total');
  const json = (await response.json()) as any;

  const rawPosts = Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : [];
  const total = json.meta?.total !== undefined ? json.meta.total : totalHeader ? parseInt(totalHeader, 10) : rawPosts.length;

  const articles = rawPosts.map((post: any) => transformApiArticle(post));

  // Sync to PostgreSQL DB
  await syncArticlesToPostgres(articles);

  const result = { articles, total: total || articles.length, page, limit };

  // Write to Redis with 15 min TTL (900s)
  if (redis.status === 'ready') {
    await redis.setex(cacheKey, 900, JSON.stringify(result)).catch(() => {});
  }

  return result;
}

/**
 * Triggers an asynchronous refetch of content from WordPress API in the background.
 * Uses a Redis lock (TTL 300s) to prevent concurrent background sync spams.
 */
async function triggerBackgroundWordPressSync(params: FetchArticlesQuery, cacheKey: string): Promise<void> {
  const lockKey = `sync:lock:news:${params.category || 'all'}:${params.page || 1}`;
  if (redis.status === 'ready') {
    try {
      const acquired = await redis.set(lockKey, '1', 'EX', 300, 'NX');
      if (!acquired) {
        return; // Sync already in progress or completed within 5 mins
      }
    } catch (_) {}
  }

  setImmediate(() => {
    fetchFromWordPressApiAndSave(params, cacheKey).catch((err) => {
      logger.warn({ err }, 'Background WordPress refetch failed silently');
    });
  });
}

/**
 * Fetches articles collection with 3-tier fallback & background revalidation:
 * 1. Return Redis Cache (if present) + trigger background WP refetch
 * 2. Return PostgreSQL DB (if present) + trigger background WP refetch
 * 3. Fetch from WordPress API synchronously + populate DB & Redis
 */
export async function getArticles(params: FetchArticlesQuery): Promise<{ articles: ArticleDTO[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, params.page || 1);
  const limit = Math.min(50, Math.max(1, params.limit || 10));
  const category = params.category || 'all';
  const search = params.search?.trim();
  const fields = params.fields || 'summary';

  const cacheKey = `articles:${category}:page:${page}:limit:${limit}:${fields}:${search || ''}`;

  // 1. Check Redis Cache
  if (redis.status === 'ready') {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        const result = JSON.parse(cached);
        // Trigger background refetch from WordPress API to keep Postgres & Redis fresh
        triggerBackgroundWordPressSync(params, cacheKey);
        return result;
      }
    } catch (_) {}
  }

  // 2. Check PostgreSQL Database (Prisma)
  try {
    const skip = (page - 1) * limit;
    const whereCondition: any = {};

    if (category !== 'all') {
      whereCondition.categorySlug = category;
    }
    if (search && search.length > 0) {
      whereCondition.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { content: { contains: search, mode: 'insensitive' } },
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

      const result = { articles, total, page, limit };

      // Cache result in Redis for subsequent hits with 15 min TTL (900s)
      if (redis.status === 'ready') {
        redis.setex(cacheKey, 900, JSON.stringify(result)).catch(() => {});
      }

      // Trigger background refetch from WordPress API to keep Postgres & Redis updated
      triggerBackgroundWordPressSync(params, cacheKey);

      return result;
    }
  } catch (dbError) {
    logger.warn({ dbError }, 'PostgreSQL query skipped or empty, attempting direct WordPress fetch');
  }

  // 3. Fallback: Query WordPress API synchronously if neither Redis nor Postgres has data
  try {
    return await fetchFromWordPressApiAndSave(params, cacheKey);
  } catch (error) {
    logger.error({ error }, 'Failed to fetch articles from WordPress API');
    return { articles: [], total: 0, page, limit };
  }
}

/**
 * Fetches trending articles (/articles/trending) based on rolling views window.
 * Cached in Redis for 10 minutes (600s).
 */
export async function getTrendingArticles(days: number = 7, category?: string): Promise<ArticleDTO[]> {
  const cacheKey = `articles:trending:days:${days}:cat:${category || 'all'}`;

  if (redis.status === 'ready') {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (_) {}
  }

  let url = `${config.services.capitalFmApiBaseUrl}/articles/trending?days=${days}`;
  if (category) {
    url += `&category=${encodeURIComponent(category)}`;
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Trending Articles API returned status ${response.status}`);
    }

    const json = (await response.json()) as any;
    const rawItems = Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : [];

    const articles = rawItems.map((item: any) => transformApiArticle(item));

    if (redis.status === 'ready' && articles.length > 0) {
      redis.setex(cacheKey, 900, JSON.stringify(articles)).catch(() => {});
    }

    return articles;
  } catch (error) {
    logger.error({ error, url }, 'Failed to fetch trending articles');
    return [];
  }
}

/**
 * Triggers an asynchronous refetch of single article from WordPress API in the background.
 */
function triggerBackgroundArticleSync(idOrSlug: string, cacheKey: string): void {
  setImmediate(async () => {
    try {
      const url = `${config.services.capitalFmApiBaseUrl}/articles/${encodeURIComponent(idOrSlug)}`;
      const response = await fetch(url);
      if (response.ok) {
        const json = (await response.json()) as any;
        const rawData = json.data || json;
        const article = transformApiArticle(rawData);
        if (article) {
          await syncArticlesToPostgres([article]);
          if (redis.status === 'ready') {
            await redis.setex(cacheKey, 900, JSON.stringify(article)).catch(() => {});
          }
        }
      }
    } catch (err) {
      logger.warn({ err, idOrSlug }, 'Background single article refetch failed silently');
    }
  });
}

/**
 * Fetches single article by ID or Slug (/articles/{id-or-slug}) with 3-tier fallback:
 * 1. Return Redis Cache (if present) + trigger background WP refetch
 * 2. Return PostgreSQL DB (if present) + update Redis with refreshed TTL + trigger background WP refetch
 * 3. Fetch from WordPress API + update Postgres & Redis with refreshed TTL
 */
export async function getArticleBySlug(idOrSlug: string): Promise<ArticleDTO | null> {
  const cacheKey = `articles:detail:${idOrSlug}`;

  // 1. Check Redis Cache
  if (redis.status === 'ready') {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        const article = JSON.parse(cached);
        triggerBackgroundArticleSync(idOrSlug, cacheKey);
        return article;
      }
    } catch (_) {}
  }

  // 2. Check PostgreSQL DB
  try {
    const parsedId = parseInt(idOrSlug, 10);
    const whereCondition = isNaN(parsedId) ? { slug: idOrSlug } : { id: parsedId };

    const dbArticle = await prisma.article.findFirst({
      where: whereCondition,
    });

    if (dbArticle) {
      const article: ArticleDTO = {
        id: dbArticle.id,
        slug: dbArticle.slug,
        title: dbArticle.title,
        excerpt: dbArticle.excerpt || dbArticle.title,
        content: dbArticle.content,
        categorySlug: dbArticle.categorySlug,
        author: dbArticle.author || 'Capital Digital',
        coverImageUrl: dbArticle.coverImageUrl || undefined,
        publishedAt: dbArticle.publishedAt.toISOString(),
        publishedAtTimestamp: dbArticle.publishedAt.getTime(),
      };

      // Update Redis content and reset TTL to 900s (15 mins)
      if (redis.status === 'ready') {
        redis.setex(cacheKey, 900, JSON.stringify(article)).catch(() => {});
      }

      // Trigger background refetch from WordPress
      triggerBackgroundArticleSync(idOrSlug, cacheKey);

      return article;
    }
  } catch (dbErr) {
    logger.warn({ dbErr, idOrSlug }, 'PostgreSQL article lookup skipped or failed');
  }

  // 3. Fallback: Query WordPress API synchronously if neither Redis nor DB has data
  const url = `${config.services.capitalFmApiBaseUrl}/articles/${encodeURIComponent(idOrSlug)}`;

  try {
    const response = await fetch(url);
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`Article detail API returned status ${response.status}`);
    }

    const json = (await response.json()) as any;
    const rawData = json.data || json;

    const article = transformApiArticle(rawData);

    if (article) {
      await syncArticlesToPostgres([article]);
      if (redis.status === 'ready') {
        redis.setex(cacheKey, 900, JSON.stringify(article)).catch(() => {});
      }
    }

    return article;
  } catch (error) {
    logger.error({ error, url, idOrSlug }, 'Failed to fetch single article detail from Capital FM API');
    return null;
  }
}
