import { Prisma } from '@prisma/client';
import { config } from '../config';
import { prisma } from '../config/db';
import { logger } from '../middlewares/logger';
import { getSyncGeneration, markSyncComplete, scheduleBackgroundSync } from '../utils/backgroundSync';
import {
  clampInt,
  deleteCache,
  fetchUpstream,
  readCache,
  readUpstreamPagination,
  toInt,
  upstreamError,
  writeCache,
} from '../utils/upstream';
import { ArticleDTO, AuthorDTO, dbArticleToDTO, hasFullContent, syncArticlesToPostgres, transformApiArticle } from './wordpressService';

/**
 * Capital FM Public API v2.4.0 Authors gateway.
 *
 * Upstream: /authors, /authors/{id-or-slug}, /authors/{id-or-slug}/articles.
 *
 * Read order (same as /news): Redis → PostgreSQL → website. Whatever is served from Redis or
 * Postgres triggers a throttled background re-sync from the website, so the app keeps working
 * through website downtime and the stored copy converges while the server is active.
 *
 * Author records are stored and returned as the upstream sends them (stable, null-not-absent keys);
 * articles are mapped to the gateway's ArticleDTO so they match /api/v1/news.
 */

// Upstream cache guidance (API doc section 7): /authors and /authors/{id} 15 min, author articles 5 min.
const AUTHOR_PROFILE_TTL_SECONDS = 900;
const AUTHOR_ARTICLES_TTL_SECONDS = 300;
const DIRECTORY_RESYNC_MS = AUTHOR_PROFILE_TTL_SECONDS * 1000;
const PROFILE_RESYNC_MS = AUTHOR_PROFILE_TTL_SECONDS * 1000;
const ARTICLES_RESYNC_MS = AUTHOR_ARTICLES_TTL_SECONDS * 1000;
const DIRECTORY_SYNC_PAGE_SIZE = 100;
const DIRECTORY_SYNC_MAX_PAGES = 50;
const DIRECTORY_SYNC_KEY = 'authors:directory';

export interface AuthorListQuery {
  search?: string;
  orderby?: 'stories' | 'name' | 'recent';
  page?: number;
  per_page?: number;
}

export interface AuthorArticlesQuery {
  page?: number;
  per_page?: number;
  fields?: 'summary' | 'full';
}

export interface PaginationMetaDTO {
  total: number;
  total_pages: number;
  page: number;
  per_page: number;
}

export interface AuthorListResponseDTO {
  data: any[];
  meta: PaginationMetaDTO;
}

export interface AuthorArticlesResponseDTO {
  author: any | null;
  articles: ArticleDTO[];
  meta: PaginationMetaDTO;
}

const AUTHOR_ORDERBY = new Set(['stories', 'name', 'recent']);

function buildMeta(total: number, page: number, perPage: number): PaginationMetaDTO {
  return { total, total_pages: Math.ceil(total / perPage), page, per_page: perPage };
}

function authorLookup(idOrSlug: string): Prisma.AuthorWhereUniqueInput {
  const id = /^\d+$/.test(idOrSlug) ? parseInt(idOrSlug, 10) : undefined;
  return id !== undefined ? { id } : { slug: idOrSlug };
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * Upserts upstream author records into Postgres. List records are partial, so they are merged
 * over any stored full profile instead of replacing it.
 */
async function saveAuthorProfiles(records: any[], isFull: boolean): Promise<void> {
  for (const record of records) {
    const id = toInt(record?.id);
    const slug = typeof record?.slug === 'string' && record.slug ? record.slug : undefined;
    if (id === undefined || !slug) continue;
    try {
      const existing = await prisma.author.findUnique({ where: { id } });
      const previous = existing?.profile && typeof existing.profile === 'object' ? (existing.profile as Record<string, unknown>) : {};
      const data = {
        slug,
        name: typeof record.name === 'string' && record.name ? record.name : slug,
        storyCount: toInt(record.story_count) ?? existing?.storyCount ?? 0,
        latestStory: parseDate(record.latest_story) ?? existing?.latestStory ?? null,
        profile: { ...previous, ...record } as Prisma.InputJsonValue,
        isFull: isFull || existing?.isFull || false,
      };
      await prisma.author.upsert({ where: { id }, create: { id, ...data }, update: data });
    } catch (error) {
      logger.warn({ error, authorId: id }, 'Failed to store author profile in PostgreSQL');
    }
  }
}

// ---------------------------------------------------------------------------
// Website fetchers (also used by the background re-sync)
// ---------------------------------------------------------------------------

async function fetchAuthorsPageFromWebsite(params: URLSearchParams, page: number, perPage: number): Promise<AuthorListResponseDTO> {
  const url = `${config.services.capitalFmApiBaseUrl}/authors?${params.toString()}`;
  const response = await fetchUpstream(url);
  if (!response.ok) {
    throw upstreamError(`Authors API returned status ${response.status}`);
  }
  const json = (await response.json()) as any;
  const items = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
  await saveAuthorProfiles(items, false);
  return { data: items, meta: readUpstreamPagination(json, response, items.length, page, perPage) };
}

/**
 * Re-syncs the whole author directory from the website into Postgres. Only a sync that stored every
 * page drops authors the website no longer lists and marks the directory complete, which lets list
 * requests be answered from Postgres.
 */
async function syncAuthorDirectory(): Promise<void> {
  let totalPages = 1;
  const seenIds: number[] = [];
  for (let page = 1; page <= totalPages; page++) {
    if (page > DIRECTORY_SYNC_MAX_PAGES) return;
    const params = new URLSearchParams({ page: String(page), per_page: String(DIRECTORY_SYNC_PAGE_SIZE) });
    const result = await fetchAuthorsPageFromWebsite(params, page, DIRECTORY_SYNC_PAGE_SIZE);
    seenIds.push(...result.data.map((item) => toInt(item?.id)).filter((id): id is number => id !== undefined));
    totalPages = result.meta.total_pages || 1;
  }
  await prisma.author.deleteMany({ where: { id: { notIn: seenIds } } });
  await markSyncComplete(DIRECTORY_SYNC_KEY);
}

/** Returns the full profile, or null when the website reports `cfm_author_not_found`. */
async function fetchAuthorProfileFromWebsite(idOrSlug: string): Promise<any | null> {
  const url = `${config.services.capitalFmApiBaseUrl}/authors/${encodeURIComponent(idOrSlug)}`;
  const response = await fetchUpstream(url);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw upstreamError(`Author detail API returned status ${response.status}`);
  }
  const json = (await response.json()) as any;
  const author = json?.data ?? null;
  if (author) {
    await saveAuthorProfiles([author], true);
  }
  return author;
}

async function fetchAuthorArticlesFromWebsite(
  idOrSlug: string,
  page: number,
  perPage: number,
  fields: 'summary' | 'full',
): Promise<AuthorArticlesResponseDTO | null> {
  const params = new URLSearchParams({ page: String(page), per_page: String(perPage), fields });
  const url = `${config.services.capitalFmApiBaseUrl}/authors/${encodeURIComponent(idOrSlug)}/articles?${params.toString()}`;

  const response = await fetchUpstream(url);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw upstreamError(`Author articles API returned status ${response.status}`);
  }

  const json = (await response.json()) as any;
  const rawItems = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
  const articles: ArticleDTO[] = rawItems.map((item: any) => transformApiArticle(item));
  const author = json?.meta?.author ?? null;

  await syncArticlesToPostgres(articles, fields === 'full');
  if (author) {
    await saveAuthorProfiles([author], true);
  }

  return { author, articles, meta: readUpstreamPagination(json, response, articles.length, page, perPage) };
}

// ---------------------------------------------------------------------------
// Public service API
// ---------------------------------------------------------------------------

/**
 * Lists every author with at least one published story (main author or co-author).
 * Redis (15 min) → Postgres → website once a full directory sync has completed; before that, rows
 * stored by single-author lookups are not a directory, so the website answers first and Postgres is
 * only the downtime fallback. The directory is re-synced in the background every 15 minutes.
 */
export async function getAuthors(query: AuthorListQuery): Promise<AuthorListResponseDTO> {
  const page = clampInt(query.page, 1, 1, Number.MAX_SAFE_INTEGER);
  const perPage = clampInt(query.per_page, 20, 1, 100);
  const search = query.search?.trim();
  const orderby = query.orderby && AUTHOR_ORDERBY.has(query.orderby) ? query.orderby : 'stories';

  const generation = await getSyncGeneration(DIRECTORY_SYNC_KEY);
  const cacheKey = `authors:list:${generation ?? 'unsynced'}:page:${page}:limit:${perPage}:orderby:${orderby}:search:${search || ''}`;
  const resync = () => scheduleBackgroundSync(DIRECTORY_SYNC_KEY, DIRECTORY_RESYNC_MS, syncAuthorDirectory);

  const cached = await readCache<AuthorListResponseDTO>(cacheKey);
  if (cached) {
    resync();
    return cached;
  }

  if (generation) {
    const stored = await readAuthorsFromPostgres(search, orderby, page, perPage);
    if (stored) {
      writeCache(cacheKey, AUTHOR_PROFILE_TTL_SECONDS, stored);
      resync();
      return stored;
    }
  }

  const params = new URLSearchParams({ page: String(page), per_page: String(perPage), orderby });
  if (search) params.set('search', search);

  try {
    const result = await fetchAuthorsPageFromWebsite(params, page, perPage);
    writeCache(cacheKey, AUTHOR_PROFILE_TTL_SECONDS, result);
    resync();
    return result;
  } catch (error) {
    const stored = generation ? null : await readAuthorsFromPostgres(search, orderby, page, perPage);
    if (stored) {
      logger.warn({ error }, 'Website unavailable; serving stored authors from PostgreSQL');
      resync();
      return stored;
    }
    logger.warn({ error }, 'Failed to fetch authors from Capital FM API. Returning empty author list.');
    return { data: [], meta: { total: 0, total_pages: 0, page, per_page: perPage } };
  }
}

async function readAuthorsFromPostgres(
  search: string | undefined,
  orderby: string,
  page: number,
  perPage: number,
): Promise<AuthorListResponseDTO | null> {
  try {
    const where: Prisma.AuthorWhereInput = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { slug: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {};
    const orderBy: Prisma.AuthorOrderByWithRelationInput[] =
      orderby === 'name'
        ? [{ name: 'asc' }]
        : orderby === 'recent'
          ? [{ latestStory: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }]
          : [{ storyCount: 'desc' }, { name: 'asc' }];

    const [rows, total] = await Promise.all([
      prisma.author.findMany({ where, orderBy, skip: (page - 1) * perPage, take: perPage }),
      prisma.author.count({ where }),
    ]);

    return total > 0 ? { data: rows.map((row) => row.profile), meta: buildMeta(total, page, perPage) } : null;
  } catch (dbError) {
    logger.warn({ dbError }, 'PostgreSQL author lookup skipped or failed');
    return null;
  }
}

/**
 * Fetches one author profile by ID or slug. Redis (15 min) → Postgres (full profile) → website.
 * Returns null when the website reports `cfm_author_not_found` (no published story).
 */
export async function getAuthorByIdOrSlug(idOrSlug: string): Promise<any | null> {
  const cacheKey = `authors:detail:${idOrSlug}`;
  const resync = () =>
    scheduleBackgroundSync(`authors:profile:${idOrSlug}`, PROFILE_RESYNC_MS, async () => {
      const author = await fetchAuthorProfileFromWebsite(idOrSlug);
      if (author) {
        writeCache(cacheKey, AUTHOR_PROFILE_TTL_SECONDS, author);
      } else {
        // The website no longer lists this author (no published story): stop serving the stored copy.
        await prisma.author.deleteMany({ where: authorLookup(idOrSlug) as Prisma.AuthorWhereInput });
        deleteCache(cacheKey);
      }
    });

  const cached = await readCache<any>(cacheKey);
  if (cached) {
    resync();
    return cached;
  }

  let stored: { profile: Prisma.JsonValue; isFull: boolean } | null = null;
  try {
    stored = await prisma.author.findUnique({ where: authorLookup(idOrSlug) });
    if (stored?.isFull) {
      writeCache(cacheKey, AUTHOR_PROFILE_TTL_SECONDS, stored.profile);
      resync();
      return stored.profile;
    }
  } catch (dbError) {
    logger.warn({ dbError, idOrSlug }, 'PostgreSQL author profile lookup skipped or failed');
  }

  try {
    const author = await fetchAuthorProfileFromWebsite(idOrSlug);
    if (author) {
      writeCache(cacheKey, AUTHOR_PROFILE_TTL_SECONDS, author);
    }
    return author;
  } catch (error) {
    // Website down and only a directory (partial) record stored: serve it rather than fail.
    if (stored) {
      logger.warn({ error, idOrSlug }, 'Website unavailable; serving stored partial author profile');
      return stored.profile;
    }
    throw error;
  }
}

/**
 * Fetches an author's stories, newest first, including co-written ones.
 * Redis (5 min) → Postgres (articles whose byline includes the author) → website.
 * Postgres answers first only with a complete page: a full page, or any page once Postgres holds the
 * author's whole archive, and for `fields=full` only rows with full bodies. Otherwise the website
 * answers and the stored rows are the downtime fallback. Returns null when the author is unknown.
 */
export async function getAuthorArticles(idOrSlug: string, query: AuthorArticlesQuery): Promise<AuthorArticlesResponseDTO | null> {
  const page = clampInt(query.page, 1, 1, Number.MAX_SAFE_INTEGER);
  const perPage = clampInt(query.per_page, 10, 1, 50);
  const fields = query.fields === 'full' ? 'full' : 'summary';

  const cacheKey = `authors:articles:${idOrSlug}:page:${page}:limit:${perPage}:${fields}`;
  const resync = () =>
    scheduleBackgroundSync(cacheKey, ARTICLES_RESYNC_MS, async () => {
      const result = await fetchAuthorArticlesFromWebsite(idOrSlug, page, perPage, fields);
      if (result) {
        writeCache(cacheKey, AUTHOR_ARTICLES_TTL_SECONDS, result);
      } else {
        deleteCache(cacheKey);
      }
    });

  const cached = await readCache<AuthorArticlesResponseDTO>(cacheKey);
  if (cached) {
    resync();
    return cached;
  }

  let stored: AuthorArticlesResponseDTO | null = null;
  let storedIsComplete = false;
  try {
    const storedAuthor = await prisma.author.findUnique({ where: authorLookup(idOrSlug) });
    const numericId = /^\d+$/.test(idOrSlug) ? parseInt(idOrSlug, 10) : undefined;
    const authorId = storedAuthor?.id ?? numericId;
    const authorSlug = storedAuthor?.slug ?? (numericId === undefined ? idOrSlug : undefined);

    const byline: Prisma.ArticleWhereInput[] = [];
    if (authorId !== undefined) byline.push({ authorIds: { has: authorId } });
    if (authorSlug) byline.push({ authorSlugs: { has: authorSlug } });
    const where: Prisma.ArticleWhereInput = { OR: byline };

    const [rows, count] = await Promise.all([
      prisma.article.findMany({ where, orderBy: { publishedAt: 'desc' }, skip: (page - 1) * perPage, take: perPage }),
      prisma.article.count({ where }),
    ]);

    if (rows.length > 0) {
      const articles = rows.map(dbArticleToDTO);
      const bylineMatch = articles[0].authors?.find((a: AuthorDTO) => a.id === authorId || a.slug === authorSlug);
      const storyCount = storedAuthor?.storyCount ?? 0;
      const holdsWholeArchive = storyCount > 0 && count >= storyCount;
      stored = {
        author: storedAuthor?.profile ?? bylineMatch ?? null,
        articles,
        meta: buildMeta(Math.max(count, storyCount), page, perPage),
      };
      storedIsComplete =
        (rows.length === perPage || holdsWholeArchive) && (fields === 'summary' || rows.every(hasFullContent));
    }
  } catch (dbError) {
    logger.warn({ dbError, idOrSlug }, 'PostgreSQL author articles lookup skipped or failed, fetching from website');
  }

  if (stored && storedIsComplete) {
    writeCache(cacheKey, AUTHOR_ARTICLES_TTL_SECONDS, stored);
    resync();
    return stored;
  }

  try {
    const result = await fetchAuthorArticlesFromWebsite(idOrSlug, page, perPage, fields);
    if (result) {
      writeCache(cacheKey, AUTHOR_ARTICLES_TTL_SECONDS, result);
    }
    return result;
  } catch (error) {
    if (stored) {
      logger.warn({ error, idOrSlug }, 'Website unavailable; serving stored author stories from PostgreSQL');
      return stored;
    }
    throw error;
  }
}
