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

export interface CategoryDTO {
  id: number;
  name: string;
  slug: string;
  count: number;
  description?: string;
}

export interface FetchArticlesQuery {
  category?: string;
  page?: number;
  limit?: number;
  search?: string;
}

const DEFAULT_CATEGORIES: CategoryDTO[] = [
  { id: 1, name: 'News', slug: 'news', count: 450, description: 'Latest breaking news and national updates' },
  { id: 2, name: 'Sports', slug: 'sports', count: 210, description: 'Football, athletics and sports coverage' },
  { id: 3, name: 'Business', slug: 'business', count: 180, description: 'Finance, markets, and economic news' },
  { id: 4, name: 'Lifestyle', slug: 'lifestyle', count: 150, description: 'Health, travel, food, and culture' },
  { id: 5, name: 'Entertainment', slug: 'entertainment', count: 120, description: 'Music, movies, and celebrity news' },
  { id: 6, name: 'Capital Campus', slug: 'capital-campus', count: 90, description: 'Student, university, and youth feature stories' },
  { id: 7, name: 'Opinion', slug: 'opinion', count: 65, description: 'Commentary, columns, and editorial pieces' },
];

/**
 * Transforms raw WordPress Post DTO into sanitized ArticleDTO.
 */
function transformWpPost(post: any): ArticleDTO {
  const title = post.title?.rendered ? stripHtml(post.title.rendered) : 'Untitled';
  const rawExcerpt = post.excerpt?.rendered || '';
  const rawContent = post.content?.rendered || '';

  const excerpt = stripHtml(rawExcerpt);
  const content = stripHtml(rawContent);

  let coverImageUrl: string | undefined;
  if (post._embedded && post._embedded['wp:featuredmedia']?.[0]?.source_url) {
    coverImageUrl = post._embedded['wp:featuredmedia'][0].source_url;
  }

  const authorName = post._embedded?.author?.[0]?.name || 'Capital Digital';
  const dateGmt = post.date_gmt ? `${post.date_gmt}Z` : post.date || new Date().toISOString();
  const publishedAtTimestamp = new Date(dateGmt).getTime() || Date.now();

  // Dynamically extract primary category slug from embedded terms
  let categorySlug = 'news';
  const embeddedTerms = post._embedded?.['wp:term']?.[0];
  if (Array.isArray(embeddedTerms) && embeddedTerms.length > 0) {
    const matchedTerm = embeddedTerms.find((t: any) =>
      ['sports', 'business', 'lifestyle', 'entertainment', 'africa', 'capital-campus', 'opinion', 'technology', 'capital-health', 'county-news'].includes(t.slug)
    ) || embeddedTerms[0];

    if (matchedTerm && matchedTerm.slug) {
      categorySlug = matchedTerm.slug;
    }
  } else if (post.category_slug) {
    categorySlug = post.category_slug;
  }

  return {
    id: post.id,
    slug: post.slug || `article-${post.id}`,
    title,
    excerpt: excerpt || title,
    content,
    categorySlug,
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
 * List of primary editorial category slugs prioritized for mobile app navigation.
 */
const PRIORITY_CATEGORY_SLUGS = [
  'news',
  'sports',
  'business',
  'lifestyle',
  'entertainment',
  'lowdown-capital-campus',
  'capital-campus',
  'opinion',
  'africa',
  'capital-health',
  'technology',
];

/**
 * Fetches available news categories with 1-hour Redis caching.
 * Filters out raw WordPress archive tags (such as election years, historical tags).
 */
export async function getNewsCategories(): Promise<CategoryDTO[]> {
  const cacheKey = 'news:categories';

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
    const wpUrl = `${config.services.wpCmsBaseUrl}/categories?per_page=100&hide_empty=true`;
    const response = await fetch(wpUrl);
    if (response.ok) {
      const rawCategories = (await response.json()) as any[];
      if (Array.isArray(rawCategories) && rawCategories.length > 0) {
        // Filter out numeric election years, tags starting with numbers or uppercase acronyms
        const filtered = rawCategories
          .map((cat) => ({
            id: cat.id,
            name: stripHtml(cat.name || ''),
            slug: cat.slug || '',
            count: cat.count || 0,
            description: cat.description ? stripHtml(cat.description) : undefined,
          }))
          .filter((c) => {
            if (!c.slug || !c.name || c.count < 5) return false;
            // Exclude tags starting with numbers (e.g. 2016-us-election, 2027-kenya-elections, 9-11)
            if (/^\d/.test(c.slug) || /^\d/.test(c.name)) return false;
            // Exclude common archived tag patterns
            if (/election/i.test(c.slug) || /afcon/i.test(c.slug) || /auc-race/i.test(c.slug)) return false;
            return true;
          });

        // Sort priority categories first
        filtered.sort((a, b) => {
          const indexA = PRIORITY_CATEGORY_SLUGS.indexOf(a.slug);
          const indexB = PRIORITY_CATEGORY_SLUGS.indexOf(b.slug);
          if (indexA !== -1 && indexB !== -1) return indexA - indexB;
          if (indexA !== -1) return -1;
          if (indexB !== -1) return 1;
          return b.count - a.count;
        });

        if (filtered.length > 0) {
          if (redis.status === 'ready') {
            redis.setex(cacheKey, 3600, JSON.stringify(filtered)).catch(() => {});
          }
          return filtered;
        }
      }
    }
  } catch (error) {
    logger.warn({ error }, 'Failed to fetch categories from WordPress REST API. Serving default categories.');
  }

  return DEFAULT_CATEGORIES;
}

/**
 * Helper to get WordPress Category ID by category slug.
 */
async function getCategoryIdBySlug(slug: string): Promise<number | undefined> {
  const categories = await getNewsCategories();
  const found = categories.find((c) => c.slug.toLowerCase() === slug.toLowerCase());
  return found?.id;
}

/**
 * Fetches news articles with support for Category filtering, Pagination, Redis Caching, and Full-Text Search.
 */
export async function getArticles(params: FetchArticlesQuery): Promise<{ articles: ArticleDTO[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, params.page || 1);
  const limit = Math.min(50, Math.max(1, params.limit || 10));
  const category = params.category || 'all';
  const search = params.search?.trim();

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

  let wpUrl = `${config.services.wpCmsBaseUrl}/posts?_embed=true&page=${page}&per_page=${limit}`;

  if (category !== 'all') {
    const catId = await getCategoryIdBySlug(category);
    if (catId) {
      wpUrl += `&categories=${catId}`;
    }
  }

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
    const articles = rawPosts.map((post) => transformWpPost(post));

    syncArticlesToPostgres(articles);

    const result = { articles, total: total || articles.length, page, limit };

    if (!search && redis.status === 'ready') {
      redis.setex(cacheKey, 300, JSON.stringify(result)).catch(() => {});
    }

    return result;
  } catch (error) {
    logger.error({ error, wpUrl }, 'Failed to fetch articles from WordPress API');

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
