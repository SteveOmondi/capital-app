import { config } from '../config';
import { stripHtml } from '../utils/htmlStripper';
import { Prisma, Article as DbArticle } from '@prisma/client';
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
  /** Upstream `/authors/{id}` record for this author (capitalfm/v1 `api_url`). */
  apiUrl?: string;
  presenter?: {
    id?: number;
    slug?: string;
    name?: string;
    api_url?: string;
  } | null;
}

/**
 * The story's YouTube video as the capitalfm/v1 API sends it (`video` on every article, null when
 * there is none). Keys are kept exactly as upstream sends them, like the other nested upstream objects.
 */
export interface VideoDTO {
  provider: string;
  id: string;
  /** The link as the editor pasted it. */
  url?: string;
  watch_url: string;
  embed_url: string;
  thumbnail?: { default?: string; medium?: string; max?: string };
  /** True for /shorts/ links: render in a vertical layout. */
  is_short: boolean;
}

/** Another story that uses the same video (`also_in[]` on /videos items), as upstream sends it. */
export interface VideoStoryRefDTO {
  id: number;
  slug: string;
  title: string;
  url?: string;
  api_url?: string;
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
  /** Every author on the story, main author first, then co-authors. Use this for bylines. */
  authors?: AuthorDTO[];
  coverImageUrl?: string;
  /** The story's YouTube video, or null when it has none. */
  video: VideoDTO | null;
  /** True when the story has a video (`video` is not null), so the app renders it as a video story. */
  isVideo: boolean;
  /** On /videos items only: other stories that use the same video. */
  alsoIn?: VideoStoryRefDTO[];
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
export function parseAuthorDetails(rawAuthor: any, embeddedAuthor?: any): AuthorDTO {
  const authorObj = typeof rawAuthor === 'object' && rawAuthor !== null ? rawAuthor : embeddedAuthor || {};
  const name = typeof rawAuthor === 'string'
    ? rawAuthor
    : authorObj.name || authorObj.display_name || 'Capital Digital';

  const id = authorObj.id ? parseInt(String(authorObj.id), 10) : undefined;
  const slug = authorObj.slug || authorObj.nicename || (id ? `author-${id}` : undefined);
  const rawBio = authorObj.bio || authorObj.description;
  const bio = rawBio ? stripHtml(rawBio) : undefined;
  const image = authorObj.image;
  const imageUrl = typeof image === 'string' ? image : image?.url || image?.src;
  const avatarUrl =
    imageUrl || authorObj.avatarUrl || authorObj.photo || authorObj.avatar || authorObj.avatar_urls?.['96'] || authorObj.avatar_urls?.['48'] || undefined;
  const archiveUrl = authorObj.archive_url || authorObj.archiveUrl || authorObj.url || authorObj.link || undefined;
  const apiUrl = authorObj.api_url || authorObj.apiUrl || undefined;
  const presenter = authorObj.presenter || null;

  return {
    id,
    name,
    slug,
    bio,
    avatarUrl,
    archiveUrl,
    apiUrl,
    presenter,
  };
}

/**
 * Maps the capitalfm/v1 `authors[]` byline array (main author first, then co-authors).
 * Falls back to the single main author when the upstream predates v2.4.0.
 */
function parseAuthorsList(item: any, mainAuthor: AuthorDTO): AuthorDTO[] {
  if (Array.isArray(item.authors) && item.authors.length > 0) {
    return item.authors
      .filter((a: any) => a !== null && a !== undefined)
      .map((a: any) => parseAuthorDetails(a));
  }
  return [mainAuthor];
}

/** Returns the upstream `video` object, or null when the story has no (usable) video. */
export function parseVideo(raw: unknown): VideoDTO | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const video = raw as Record<string, unknown>;
  const hasPlayableId = typeof video.id === 'string' && video.id.length > 0;
  const hasEmbed = typeof video.embed_url === 'string' && video.embed_url.length > 0;
  return hasPlayableId || hasEmbed ? (video as unknown as VideoDTO) : null;
}

/**
 * Ensures an article carries `video` (null when absent) and `isVideo`. Idempotent, so it also
 * upgrades article payloads cached before these fields existed.
 */
export function withVideoFields<T extends object>(article: T): T & Pick<ArticleDTO, 'video' | 'isVideo'> {
  const video = parseVideo((article as { video?: unknown }).video);
  return { ...article, video, isVideo: video !== null };
}

/**
 * Shapes an article for a news listing (feed, search, trending, author stories): the listing payload
 * is unchanged apart from the added `isVideo` flag. The `video` object itself is served on the
 * single-article and /videos responses, where the app plays it.
 */
export function toListingItem<T extends object>(article: T): Omit<T, 'video'> & { isVideo: boolean } {
  const { video, ...rest } = article as T & { video?: unknown };
  return { ...rest, isVideo: parseVideo(video) !== null };
}

/**
 * Transforms raw Capital FM API article JSON into ArticleDTO.
 */
export function transformApiArticle(item: any): ArticleDTO {
  const rawTitle = typeof item.title === 'object' ? item.title?.rendered || item.title?.text || '' : item.title || 'Untitled';
  const title = stripHtml(rawTitle);

  const rawExcerpt = typeof item.excerpt === 'object' ? item.excerpt?.rendered || '' : item.excerpt || '';
  const rawContent = typeof item.content === 'object' ? item.content?.html || item.content?.rendered || '' : item.content || '';

  const excerpt = stripHtml(rawExcerpt);
  const content = typeof item.content === 'object'
    ? item.content?.html || item.content?.rendered || rawContent
    : (rawContent || excerpt);

  let coverImageUrl: string | undefined = item.image?.url || item.coverImageUrl;
  if (!coverImageUrl && item._embedded && item._embedded['wp:featuredmedia']?.[0]?.source_url) {
    coverImageUrl = item._embedded['wp:featuredmedia'][0].source_url;
  }

  const embeddedAuthor = item._embedded && Array.isArray(item._embedded['author']) ? item._embedded['author'][0] : undefined;
  const authorDetails = parseAuthorDetails(item.author, embeddedAuthor);
  const authorName = authorDetails.name || 'Capital Digital';
  const authors = parseAuthorsList(item, authorDetails);
  // capitalfm/v1 sends the post date as `published` (ISO 8601 with offset); the other keys cover wp/v2 and cached DTOs.
  const pubDateStr =
    item.published || item.published_at || item.publishedAt || (item.date_gmt ? `${item.date_gmt}Z` : undefined) || item.date;
  const sourceTimestamp = pubDateStr ? new Date(pubDateStr).getTime() : NaN;
  const hasSourceDate = Number.isFinite(sourceTimestamp);
  // The response still needs a date, but a fallback "now" must never be persisted over the website's real date.
  const publishedAtTimestamp = hasSourceDate ? sourceTimestamp : Date.now();

  const video = parseVideo(item.video);
  const categorySlug = item.primary_category?.slug || item.categorySlug || (Array.isArray(item.categories) && item.categories[0]?.slug) || 'news';

  const article: ArticleDTO = {
    id: item.id,
    slug: item.slug || `article-${item.id}`,
    title,
    excerpt: excerpt || title,
    content,
    categorySlug,
    author: authorName,
    authorDetails,
    authors,
    coverImageUrl,
    video,
    isVideo: video !== null,
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

  if (!hasSourceDate) {
    articlesWithoutSourceDate.add(article);
  }
  return article;
}

/**
 * Articles whose upstream payload had no usable publish date (their publishedAt is a fallback "now").
 * Tracked out-of-band so the API response shape is unchanged.
 */
const articlesWithoutSourceDate = new WeakSet<ArticleDTO>();

/**
 * Byline columns for the articles table: the mapped authors[] plus flat id/slug arrays so an
 * author's stories (co-written included) can be listed from Postgres.
 */
function bylineColumns(authors: AuthorDTO[] | undefined): {
  authors?: Prisma.InputJsonValue;
  authorIds?: number[];
  authorSlugs?: string[];
} {
  if (!Array.isArray(authors) || authors.length === 0) return {};
  return {
    authors: JSON.parse(JSON.stringify(authors)) as Prisma.InputJsonValue,
    authorIds: authors.map((a) => a.id).filter((id): id is number => typeof id === 'number' && Number.isFinite(id)),
    authorSlugs: authors.map((a) => a.slug).filter((slug): slug is string => typeof slug === 'string' && slug.length > 0),
  };
}

/** True when a stored row holds the article body rather than only its list excerpt. */
export function hasFullContent(item: Pick<DbArticle, 'content' | 'excerpt'>): boolean {
  return !!item.content && item.content.length > (item.excerpt?.length || 0) + 30;
}

/**
 * Maps a Postgres article row back to ArticleDTO, restoring the stored byline when present.
 */
export function dbArticleToDTO(item: DbArticle): ArticleDTO {
  const authors = Array.isArray(item.authors) ? (item.authors as unknown as AuthorDTO[]) : undefined;
  const video = parseVideo(item.video);
  return {
    id: item.id,
    slug: item.slug,
    title: item.title,
    excerpt: item.excerpt || item.title,
    content: item.content,
    categorySlug: item.categorySlug,
    author: item.author || 'Capital Digital',
    ...(authors && authors.length > 0 ? { authorDetails: authors[0], authors } : {}),
    coverImageUrl: item.coverImageUrl || undefined,
    video,
    isVideo: video !== null,
    publishedAt: item.publishedAt.toISOString(),
    publishedAtTimestamp: item.publishedAt.getTime(),
  };
}

/**
 * Syncs posts to PostgreSQL in background for Full-Text Search and local caching.
 * Updates existing entries if new content is fuller/longer, avoiding downgrading full articles to list summaries.
 */
export async function syncArticlesToPostgres(articles: ArticleDTO[], isFullContent: boolean = false): Promise<void> {
  if (!articles || articles.length === 0) return;
  try {
    for (const article of articles) {
      const data = {
        id: article.id,
        slug: article.slug,
        title: article.title,
        excerpt: article.excerpt || article.title,
        content: article.content,
        categorySlug: article.categorySlug,
        author: article.author || 'Capital Digital',
        coverImageUrl: article.coverImageUrl || null,
        // Always written, so a video removed on the website is cleared here too.
        video: article.video
          ? (JSON.parse(JSON.stringify(article.video)) as Prisma.InputJsonValue)
          : Prisma.DbNull,
        publishedAt: new Date(article.publishedAtTimestamp),
        ...bylineColumns(article.authors),
      };

      const existing = await prisma.article.findUnique({
        where: { id: article.id },
      });

      if (!existing) {
        await prisma.article.create({ data });
      } else {
        const existingContentLen = existing.content?.length || 0;
        const incomingContentLen = article.content?.length || 0;
        const shouldUpdateContent = isFullContent || incomingContentLen >= existingContentLen;
        // Keep the stored website date when the incoming payload carried no real date of its own.
        const publishedAt = articlesWithoutSourceDate.has(article) ? existing.publishedAt : data.publishedAt;

        await prisma.article.update({
          where: { id: article.id },
          data: {
            ...data,
            publishedAt,
            content: shouldUpdateContent ? article.content : existing.content,
          },
        });
      }
    }
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
  const fields = params.fields || 'full';

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
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  const response = await fetch(url, { signal: controller.signal });
  clearTimeout(timeoutId);

  if (!response.ok) {
    throw new Error(`Capital FM Articles API returned status ${response.status}`);
  }

  const totalHeader = response.headers.get('X-WP-Total') || response.headers.get('meta.total');
  const json = (await response.json()) as any;

  const rawPosts = Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : [];
  const total = json.meta?.total !== undefined ? json.meta.total : totalHeader ? parseInt(totalHeader, 10) : rawPosts.length;

  const articles = rawPosts.map((post: any) => {
    const art = transformApiArticle(post);
    if (category !== 'all' && (art.categorySlug === 'news' || !art.categorySlug)) {
      art.categorySlug = category;
    }
    return art;
  });

  // Sync to PostgreSQL DB
  await syncArticlesToPostgres(articles, fields === 'full');

  const result = { articles, total: total || articles.length, page, limit };

  // Write to Redis with 15 min TTL (900s)
  if (redis.status === 'ready') {
    await redis.setex(cacheKey, 900, JSON.stringify(result)).catch(() => {});
  }

  return result;
}

// Global in-memory sync throttling: 3 minutes (180,000 ms)
let lastWordPressSyncTimestamp = 0;
const WP_SYNC_INTERVAL_MS = 3 * 60 * 1000;

/**
 * Triggers an asynchronous refetch of content from WordPress API in the background.
 * Throttled to execute at most ONCE every 3 minutes to optimize CPU & database resources.
 */
async function triggerBackgroundWordPressSync(params: FetchArticlesQuery, cacheKey: string): Promise<void> {
  const now = Date.now();
  if (now - lastWordPressSyncTimestamp < WP_SYNC_INTERVAL_MS) {
    return; // Less than 3 minutes since last sync; serve cached/DB data cleanly
  }

  lastWordPressSyncTimestamp = now;

  const lockKey = `sync:lock:news:${params.category || 'all'}:${params.page || 1}`;
  if (redis.status === 'ready') {
    try {
      const acquired = await redis.set(lockKey, '1', 'EX', 180, 'NX');
      if (!acquired) {
        return;
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
  const fields = params.fields || 'full';

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
      const articles: ArticleDTO[] = items.map(dbArticleToDTO);

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

const articleSyncTimestamps = new Map<string, number>();

/**
 * Triggers an asynchronous refetch of single article from WordPress API in the background.
 * Throttled per article to once every 3 minutes.
 */
function triggerBackgroundArticleSync(idOrSlug: string, cacheKey: string): void {
  const now = Date.now();
  const lastSync = articleSyncTimestamps.get(idOrSlug) || 0;
  if (now - lastSync < WP_SYNC_INTERVAL_MS) {
    return;
  }

  articleSyncTimestamps.set(idOrSlug, now);
  if (articleSyncTimestamps.size > 500) {
    articleSyncTimestamps.clear();
  }

  setImmediate(async () => {
    try {
      const url = `${config.services.capitalFmApiBaseUrl}/articles/${encodeURIComponent(idOrSlug)}?fields=full`;
      const response = await fetch(url);
      if (response.ok) {
        const json = (await response.json()) as any;
        const rawData = json.data || json;
        const article = transformApiArticle(rawData);
        if (article) {
          await syncArticlesToPostgres([article], true);
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
 * 2. Return PostgreSQL DB (if present and holds full content) + update Redis with refreshed TTL + trigger background WP refetch
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
      if (hasFullContent(dbArticle)) {
        const article: ArticleDTO = dbArticleToDTO(dbArticle);

        // Update Redis content and reset TTL to 900s (15 mins)
        if (redis.status === 'ready') {
          redis.setex(cacheKey, 900, JSON.stringify(article)).catch(() => {});
        }

        // Trigger background refetch from WordPress
        triggerBackgroundArticleSync(idOrSlug, cacheKey);

        return article;
      }
    }
  } catch (dbErr) {
    logger.warn({ dbErr, idOrSlug }, 'PostgreSQL article lookup skipped or failed');
  }

  // 3. Fallback: Query WordPress API synchronously if neither Redis nor DB has full data
  const url = `${config.services.capitalFmApiBaseUrl}/articles/${encodeURIComponent(idOrSlug)}?fields=full`;

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
      await syncArticlesToPostgres([article], true);
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

