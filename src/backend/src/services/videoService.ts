import { Article as DbArticle, Prisma } from '@prisma/client';
import { config } from '../config';
import { prisma } from '../config/db';
import { logger } from '../middlewares/logger';
import { scheduleBackgroundSync } from '../utils/backgroundSync';
import {
  clampInt,
  deleteCache,
  fetchUpstream,
  readCache,
  readUpstreamPagination,
  upstreamError,
  writeCache,
} from '../utils/upstream';
import {
  ArticleDTO,
  VideoStoryRefDTO,
  dbArticleToDTO,
  hasFullContent,
  isDetectedVideo,
  syncArticlesToPostgres,
  transformApiArticle,
} from './wordpressService';

/**
 * Capital FM Public API Videos gateway.
 *
 * Upstream: /videos (stories with a playable YouTube video, newest first, one entry per video, the
 * other stories using the same video in `also_in[]`) and /videos/{youtube-id, story-id or slug}.
 *
 * Every story the website returns is stored in Postgres (with its `video`), like /news.
 * - One video: Redis → Postgres (a stored story with that video and its full body) → website.
 * - The list: Redis → website, with Postgres as the downtime fallback. Postgres cannot answer the
 *   list first because the website's `section` filter includes subcategories and its one-entry-per-
 *   video grouping spans stories the gateway may not have stored.
 * Whatever is served from Redis or Postgres triggers a throttled background re-sync from the website.
 *
 * /videos is upstream-only: stored videos the gateway detected in a story body (`source: "detected"`)
 * are never served, grouped or cleared here. The list fallback excludes them in raw SQL (`IS
 * DISTINCT FROM`) before its scan limit, and every lookup also filters them in code, because a
 * Prisma JSON-path "not equals" also drops rows whose video has no `source` key.
 */

// Upstream cache guidance (API doc section 7): /videos/* 5 min.
const VIDEO_TTL_SECONDS = 300;
const VIDEO_RESYNC_MS = VIDEO_TTL_SECONDS * 1000;
// Downtime fallback: how many stored website video stories are grouped into the one-entry-per-video list.
const FALLBACK_SCAN_LIMIT = 500;

export interface VideoListQuery {
  section?: string;
  search?: string;
  /** true = Shorts only, false = no Shorts, undefined = both. */
  shorts?: boolean;
  fields?: 'summary' | 'full';
  page?: number;
  limit?: number;
}

export interface VideoListResponseDTO {
  articles: ArticleDTO[];
  total: number;
  page: number;
  limit: number;
}

function parseAlsoIn(raw: unknown): VideoStoryRefDTO[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((ref) => ref && typeof ref === 'object') as VideoStoryRefDTO[];
}

function toVideoItem(raw: any): ArticleDTO {
  return { ...transformApiArticle(raw), alsoIn: parseAlsoIn(raw?.also_in) };
}

function toStoryRef(row: Pick<DbArticle, 'id' | 'slug' | 'title'>): VideoStoryRefDTO {
  return { id: row.id, slug: row.slug, title: row.title };
}

const HAS_VIDEO: Prisma.ArticleWhereInput = { video: { not: Prisma.DbNull } };

/** True for a stored row whose video came from the website (not detected in its body). */
function hasUpstreamVideo(row: Pick<DbArticle, 'video'>): boolean {
  return row.video !== null && !isDetectedVideo(row.video);
}

function sameVideo(videoId: string): Prisma.ArticleWhereInput {
  return { video: { path: ['id'], equals: videoId } };
}

// ---------------------------------------------------------------------------
// Website fetchers (also used by the background re-sync)
// ---------------------------------------------------------------------------

async function fetchVideosFromWebsite(
  query: Required<Pick<VideoListQuery, 'fields' | 'page' | 'limit'>> & VideoListQuery,
): Promise<VideoListResponseDTO> {
  const params = new URLSearchParams({
    page: String(query.page),
    per_page: String(query.limit),
    fields: query.fields,
  });
  if (query.section) params.set('section', query.section);
  if (query.search) params.set('search', query.search);
  if (query.shorts !== undefined) params.set('shorts', String(query.shorts));

  const url = `${config.services.capitalFmApiBaseUrl}/videos?${params.toString()}`;
  const response = await fetchUpstream(url);
  if (!response.ok) {
    throw upstreamError(`Videos API returned status ${response.status}`);
  }

  const json = (await response.json()) as any;
  const rawItems = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
  const articles = rawItems.map(toVideoItem);
  await syncArticlesToPostgres(articles, query.fields === 'full');

  const meta = readUpstreamPagination(json, response, articles.length, query.page, query.limit);
  return { articles, total: meta.total, page: query.page, limit: query.limit };
}

/** Returns the video story with full content, or null when the website reports `cfm_video_not_found`. */
async function fetchVideoFromWebsite(idOrSlug: string): Promise<ArticleDTO | null> {
  const url = `${config.services.capitalFmApiBaseUrl}/videos/${encodeURIComponent(idOrSlug)}`;
  const response = await fetchUpstream(url);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw upstreamError(`Video detail API returned status ${response.status}`);
  }
  const json = (await response.json()) as any;
  const raw = json?.data ?? json;
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const article = toVideoItem(raw);
  await syncArticlesToPostgres([article], true);
  return article;
}

// ---------------------------------------------------------------------------
// Postgres reads
// ---------------------------------------------------------------------------

/**
 * Downtime fallback for the list: the newest stored video stories, one entry per video (under its
 * newest story, the others in `alsoIn`), filtered like the website as far as stored data allows
 * (`section` matches the story's primary section slug only).
 */
async function readVideosFromPostgres(
  query: VideoListQuery,
  page: number,
  limit: number,
): Promise<VideoListResponseDTO | null> {
  try {
    const conditions = [
      Prisma.sql`video IS NOT NULL`,
      Prisma.sql`video->>'source' IS DISTINCT FROM 'detected'`,
    ];
    if (query.section) conditions.push(Prisma.sql`category_slug = ${query.section}`);
    if (query.search) conditions.push(Prisma.sql`title ILIKE '%' || ${query.search} || '%'`);
    if (query.shorts !== undefined) {
      conditions.push(Prisma.sql`video->'is_short' = ${JSON.stringify(query.shorts)}::jsonb`);
    }

    const rows = await prisma.$queryRaw<DbArticle[]>`
      SELECT id, slug, title, excerpt, content, category_slug AS "categorySlug", author, authors,
        author_ids AS "authorIds", author_slugs AS "authorSlugs",
        cover_image_url AS "coverImageUrl", video, published_at AS "publishedAt",
        created_at AS "createdAt", updated_at AS "updatedAt"
      FROM articles
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY published_at DESC, id DESC
      LIMIT ${FALLBACK_SCAN_LIMIT}`;

    const byVideo = new Map<string, ArticleDTO>();
    for (const row of rows.filter(hasUpstreamVideo)) {
      const article = dbArticleToDTO(row);
      if (!article.video) continue;
      const primary = byVideo.get(article.video.id);
      if (primary) {
        primary.alsoIn?.push(toStoryRef(row));
      } else {
        byVideo.set(article.video.id, { ...article, alsoIn: [] });
      }
    }

    const items = [...byVideo.values()];
    if (items.length === 0) return null;
    return {
      articles: items.slice((page - 1) * limit, page * limit),
      total: items.length,
      page,
      limit,
    };
  } catch (dbError) {
    logger.warn({ dbError }, 'PostgreSQL video list lookup skipped or failed');
    return null;
  }
}

function videoLookup(idOrSlug: string): Prisma.ArticleWhereInput {
  if (/^\d+$/.test(idOrSlug)) {
    return { id: parseInt(idOrSlug, 10) };
  }
  return { OR: [{ slug: idOrSlug }, sameVideo(idOrSlug)] };
}

/** The stored story for a YouTube ID, story ID or slug, when it has a video; with `alsoIn` from stored stories. */
async function readVideoFromPostgres(
  idOrSlug: string,
): Promise<{ article: ArticleDTO; isFull: boolean } | null> {
  try {
    const matches = await prisma.article.findMany({
      where: { AND: [HAS_VIDEO, videoLookup(idOrSlug)] },
      orderBy: { publishedAt: 'desc' },
    });
    const row = matches.find(hasUpstreamVideo);
    if (!row) return null;
    const article = dbArticleToDTO(row);
    if (!article.video) return null;

    const others = await prisma.article.findMany({
      where: { AND: [sameVideo(article.video.id), { id: { not: row.id } }] },
      orderBy: { publishedAt: 'desc' },
      select: { id: true, slug: true, title: true, video: true },
    });
    return {
      article: { ...article, alsoIn: others.filter(hasUpstreamVideo).map(toStoryRef) },
      isFull: hasFullContent(row),
    };
  } catch (dbError) {
    logger.warn({ dbError, idOrSlug }, 'PostgreSQL video lookup skipped or failed');
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public service API
// ---------------------------------------------------------------------------

/**
 * Lists stories with a playable YouTube video, newest first, one entry per video.
 * Redis (5 min) → website → Postgres (only when the website is unavailable).
 */
export async function getVideos(query: VideoListQuery): Promise<VideoListResponseDTO> {
  const page = clampInt(query.page, 1, 1, Number.MAX_SAFE_INTEGER);
  const limit = clampInt(query.limit, 10, 1, 50);
  const fields = query.fields === 'full' ? 'full' : 'summary';
  const section = query.section?.trim() || undefined;
  const search = query.search?.trim() || undefined;
  const shorts = query.shorts;
  const request = { section, search, shorts, fields, page, limit } as const;

  const cacheKey = `videos:list:page:${page}:limit:${limit}:${fields}:section:${section || ''}:shorts:${shorts ?? ''}:search:${search || ''}`;
  const resync = () =>
    scheduleBackgroundSync(cacheKey, VIDEO_RESYNC_MS, async () => {
      writeCache(cacheKey, VIDEO_TTL_SECONDS, await fetchVideosFromWebsite(request));
    });

  const cached = await readCache<VideoListResponseDTO>(cacheKey);
  if (cached) {
    resync();
    return cached;
  }

  try {
    const result = await fetchVideosFromWebsite(request);
    writeCache(cacheKey, VIDEO_TTL_SECONDS, result);
    return result;
  } catch (error) {
    const stored = await readVideosFromPostgres(request, page, limit);
    if (stored) {
      logger.warn({ error }, 'Website unavailable; serving stored video stories from PostgreSQL');
      resync();
      return stored;
    }
    logger.error({ error }, 'Failed to fetch videos from Capital FM API');
    return { articles: [], total: 0, page, limit };
  }
}

/**
 * Fetches one video story by YouTube video ID, story ID or slug, with full content.
 * Redis (5 min) → Postgres (stored story with that video and its full body) → website.
 * Returns null when the website reports `cfm_video_not_found`.
 */
export async function getVideoByIdOrSlug(idOrSlug: string): Promise<ArticleDTO | null> {
  const cacheKey = `videos:detail:${idOrSlug}`;
  const resync = () =>
    scheduleBackgroundSync(cacheKey, VIDEO_RESYNC_MS, async () => {
      const article = await fetchVideoFromWebsite(idOrSlug);
      if (article) {
        writeCache(cacheKey, VIDEO_TTL_SECONDS, article);
        return;
      }
      // The website no longer has a playable video for this lookup: stop serving the stored one.
      deleteCache(cacheKey);
      const stale = await prisma.article.findMany({
        where: { AND: [HAS_VIDEO, videoLookup(idOrSlug)] },
        select: { id: true, video: true },
      });
      const ids = stale.filter(hasUpstreamVideo).map((row) => row.id);
      if (ids.length > 0) {
        await prisma.article.updateMany({
          where: { id: { in: ids } },
          data: { video: Prisma.DbNull },
        });
      }
    });

  const cached = await readCache<ArticleDTO>(cacheKey);
  if (cached) {
    resync();
    return cached;
  }

  const stored = await readVideoFromPostgres(idOrSlug);
  if (stored?.isFull) {
    writeCache(cacheKey, VIDEO_TTL_SECONDS, stored.article);
    resync();
    return stored.article;
  }

  try {
    const article = await fetchVideoFromWebsite(idOrSlug);
    if (article) {
      writeCache(cacheKey, VIDEO_TTL_SECONDS, article);
    }
    return article;
  } catch (error) {
    // Website down and only a list (summary) copy stored: serve it rather than fail.
    if (stored) {
      logger.warn({ error, idOrSlug }, 'Website unavailable; serving stored video story summary');
      return stored.article;
    }
    throw error;
  }
}
