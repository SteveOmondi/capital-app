import { Prisma } from '@prisma/client';
import { config } from '../config';
import { prisma } from '../config/db';
import { logger } from '../middlewares/logger';
import { getSyncGeneration, markSyncComplete, scheduleBackgroundSync } from '../utils/backgroundSync';
import { clampInt, deleteCache, fetchUpstream, readCache, toInt, upstreamError, writeCache } from '../utils/upstream';

export interface PresenterQuery {
  search?: string;
  fields?: 'summary' | 'full';
  page?: number;
  per_page?: number;
}

export interface PresenterListResponseDTO {
  data: any[];
  meta: {
    total: number;
    page: number;
    per_page: number;
  };
}

// Upstream cache guidance (API doc section 7): /presenters 15 min.
const PRESENTER_TTL_SECONDS = 900;
const PRESENTER_RESYNC_MS = PRESENTER_TTL_SECONDS * 1000;
const ROSTER_SYNC_PAGE_SIZE = 100;
const ROSTER_SYNC_MAX_PAGES = 10;
const ROSTER_SYNC_KEY = 'presenters:roster';

// API doc: `?fields=full` inlines these for every presenter; summary lists omit them.
const PRESENTER_FULL_ONLY_FIELDS = ['bio', 'shows', 'articles'];

function toPresenterListItem(profile: Prisma.JsonValue, fields: 'summary' | 'full'): Prisma.JsonValue {
  if (fields === 'full' || !profile || typeof profile !== 'object' || Array.isArray(profile)) return profile;
  return Object.fromEntries(Object.entries(profile).filter(([key]) => !PRESENTER_FULL_ONLY_FIELDS.includes(key)));
}

function presenterLookup(idOrSlug: string): Prisma.PresenterWhereUniqueInput {
  return /^\d+$/.test(idOrSlug) ? { id: parseInt(idOrSlug, 10) } : { slug: idOrSlug };
}

/**
 * Upserts upstream presenter records into Postgres. List (summary) records are merged over any
 * stored full profile instead of replacing it.
 */
async function savePresenters(records: any[], isFull: boolean, sortOffset?: number): Promise<void> {
  for (const [index, record] of records.entries()) {
    const id = toInt(record?.id);
    const slug = typeof record?.slug === 'string' && record.slug ? record.slug : undefined;
    if (id === undefined || !slug) continue;
    try {
      const existing = await prisma.presenter.findUnique({ where: { id } });
      const previous = existing?.profile && typeof existing.profile === 'object' ? (existing.profile as Record<string, unknown>) : {};
      const data = {
        slug,
        name: typeof record.name === 'string' && record.name ? record.name : slug,
        profile: { ...previous, ...record } as Prisma.InputJsonValue,
        sortOrder: sortOffset !== undefined ? sortOffset + index : existing?.sortOrder ?? 0,
        isFull: isFull || existing?.isFull || false,
      };
      await prisma.presenter.upsert({ where: { id }, create: { id, ...data }, update: data });
    } catch (error) {
      logger.warn({ error, presenterId: id }, 'Failed to store presenter profile in PostgreSQL');
    }
  }
}

async function fetchPresentersFromWebsite(
  page: number,
  perPage: number,
  fields: 'summary' | 'full',
  search?: string,
): Promise<{ items: any[]; total: number; totalPages: number }> {
  const queryParams = new URLSearchParams({ page: String(page), per_page: String(perPage), fields });
  if (search) queryParams.set('search', search);

  const url = `${config.services.capitalFmApiBaseUrl}/presenters?${queryParams.toString()}`;
  const response = await fetchUpstream(url);
  if (!response.ok) {
    throw upstreamError(`Presenters API returned status ${response.status}`);
  }

  const totalHeader = response.headers.get('X-WP-Total');
  const totalPagesHeader = response.headers.get('X-WP-TotalPages');
  const json = (await response.json()) as any;
  const items = Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : [];
  const total = json.meta?.total !== undefined ? json.meta.total : totalHeader ? parseInt(totalHeader, 10) : items.length;
  const totalPages =
    json.meta?.total_pages !== undefined ? json.meta.total_pages : totalPagesHeader ? parseInt(totalPagesHeader, 10) : 1;

  // Only an unfiltered page reflects the website's roster order.
  await savePresenters(items, fields === 'full', search ? undefined : (page - 1) * perPage);
  return { items, total, totalPages };
}

/**
 * Re-syncs the full presenter roster (with bios, shows and articles) from the website into Postgres.
 * Only a sync that stored every page and saw as many presenters as the website reports drops presenters the website no longer lists and marks the
 * roster complete, which lets list requests be answered from Postgres.
 */
async function syncPresenterRoster(): Promise<void> {
  let totalPages = 1;
  let total = 0;
  const seenIds = new Set<number>();
  for (let page = 1; page <= totalPages; page++) {
    if (page > ROSTER_SYNC_MAX_PAGES) return;
    const result = await fetchPresentersFromWebsite(page, ROSTER_SYNC_PAGE_SIZE, 'full');
    for (const item of result.items) {
      const id = toInt(item?.id);
      if (id !== undefined) seenIds.add(id);
    }
    total = Number(result.total) || 0;
    totalPages = result.totalPages || 1;
  }
  if (seenIds.size < total) return;
  await prisma.presenter.deleteMany({ where: { id: { notIn: [...seenIds] } } });
  await markSyncComplete(ROSTER_SYNC_KEY);
}

async function readPresentersFromPostgres(
  fields: 'summary' | 'full',
  page: number,
  perPage: number,
  search?: string,
): Promise<PresenterListResponseDTO | null> {
  try {
    const where: Prisma.PresenterWhereInput = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { slug: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {};
    const [rows, total] = await Promise.all([
      prisma.presenter.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      prisma.presenter.count({ where }),
    ]);

    // A `fields=full` request needs full records for every presenter on the page.
    if (total > 0 && (fields === 'summary' || rows.every((row) => row.isFull))) {
      return { data: rows.map((row) => toPresenterListItem(row.profile, fields)), meta: { total, page, per_page: perPage } };
    }
  } catch (dbError) {
    logger.warn({ dbError }, 'PostgreSQL presenter lookup skipped or failed');
  }
  return null;
}

/**
 * Fetches on-air presenters. Redis (15 min) → Postgres → website once a full roster sync has
 * completed; the roster is re-synced from the website in the background every 15 minutes while the
 * server is active. Before that sync, and for searches (the website also matches role, tagline and
 * aliases, Postgres only name and slug), the website answers first and Postgres is the downtime fallback.
 * Handles empty list `[]` gracefully while profiles are being entered in wp-admin.
 */
export async function getPresenters(query: PresenterQuery): Promise<PresenterListResponseDTO> {
  const page = clampInt(query.page, 1, 1, Number.MAX_SAFE_INTEGER);
  const perPage = clampInt(query.per_page, 20, 1, 100);
  const fields = query.fields === 'full' ? 'full' : 'summary';
  const search = query.search?.trim();

  const generation = await getSyncGeneration(ROSTER_SYNC_KEY);
  const cacheKey = `presenters:list:${generation ?? 'unsynced'}:${fields}:page:${page}:limit:${perPage}:search:${search || ''}`;
  const resync = () => scheduleBackgroundSync(ROSTER_SYNC_KEY, PRESENTER_RESYNC_MS, syncPresenterRoster);

  const cached = await readCache<PresenterListResponseDTO>(cacheKey);
  if (cached) {
    resync();
    return cached;
  }

  const postgresFirst = generation !== null && !search;
  if (postgresFirst) {
    const stored = await readPresentersFromPostgres(fields, page, perPage);
    if (stored) {
      writeCache(cacheKey, PRESENTER_TTL_SECONDS, stored);
      resync();
      return stored;
    }
  }

  try {
    const { items, total } = await fetchPresentersFromWebsite(page, perPage, fields, search);
    const result: PresenterListResponseDTO = { data: items, meta: { total, page, per_page: perPage } };
    writeCache(cacheKey, PRESENTER_TTL_SECONDS, result);
    resync();
    return result;
  } catch (error) {
    const stored = postgresFirst ? null : await readPresentersFromPostgres(fields, page, perPage, search);
    if (stored) {
      logger.warn({ error }, 'Website unavailable; serving stored presenters from PostgreSQL');
      resync();
      return stored;
    }
    logger.warn({ error }, 'Failed to fetch presenters from Capital FM API. Returning empty presenter list.');
    return {
      data: [],
      meta: { total: 0, page, per_page: perPage },
    };
  }
}

async function fetchPresenterFromWebsite(idOrSlug: string): Promise<any | null> {
  const url = `${config.services.capitalFmApiBaseUrl}/presenters/${encodeURIComponent(idOrSlug)}`;
  const response = await fetchUpstream(url);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw upstreamError(`Presenter detail API returned status ${response.status}`);
  }
  const json = (await response.json()) as any;
  const presenter = json.data || json;
  if (presenter) {
    await savePresenters([presenter], true);
  }
  return presenter;
}

/**
 * Fetches the full presenter profile by ID or slug (bio.html, bio.text, shows[], articles[], socials).
 * Redis (15 min) → Postgres (full profile) → website, with a background re-sync every 15 minutes.
 */
export async function getPresenterBySlug(idOrSlug: string): Promise<any | null> {
  const cacheKey = `presenters:detail:${idOrSlug}`;
  const resync = () =>
    scheduleBackgroundSync(`presenters:profile:${idOrSlug}`, PRESENTER_RESYNC_MS, async () => {
      const presenter = await fetchPresenterFromWebsite(idOrSlug);
      if (presenter) {
        writeCache(cacheKey, PRESENTER_TTL_SECONDS, presenter);
      } else {
        await prisma.presenter.deleteMany({ where: presenterLookup(idOrSlug) as Prisma.PresenterWhereInput });
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
    stored = await prisma.presenter.findUnique({ where: presenterLookup(idOrSlug) });
    if (stored?.isFull) {
      writeCache(cacheKey, PRESENTER_TTL_SECONDS, stored.profile);
      resync();
      return stored.profile;
    }
  } catch (dbError) {
    logger.warn({ dbError, idOrSlug }, 'PostgreSQL presenter lookup skipped or failed');
  }

  try {
    const presenter = await fetchPresenterFromWebsite(idOrSlug);
    if (presenter) {
      writeCache(cacheKey, PRESENTER_TTL_SECONDS, presenter);
    }
    return presenter;
  } catch (error) {
    if (stored) {
      logger.warn({ error, idOrSlug }, 'Website unavailable; serving stored partial presenter profile');
      return stored.profile;
    }
    logger.error({ error, idOrSlug }, 'Failed to fetch single presenter detail from Capital FM API');
    return null;
  }
}
