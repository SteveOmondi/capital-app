import { config } from '../config';
import { redis } from '../config/redis';
import { logger } from '../middlewares/logger';

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

/**
 * Fetches on-air presenters from Capital FM Public API.
 * Handles empty list `[]` gracefully while profiles are being entered in wp-admin.
 * Cached in Redis for 15 minutes (900s).
 */
export async function getPresenters(query: PresenterQuery): Promise<PresenterListResponseDTO> {
  const page = Math.max(1, query.page || 1);
  const perPage = Math.min(100, Math.max(1, query.per_page || 20));
  const fields = query.fields || 'summary';
  const search = query.search?.trim();

  const cacheKey = `presenters:list:${fields}:page:${page}:limit:${perPage}:search:${search || ''}`;

  if (redis.status === 'ready') {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (_) {}
  }

  const queryParams = new URLSearchParams();
  queryParams.set('page', String(page));
  queryParams.set('per_page', String(perPage));
  queryParams.set('fields', fields);

  if (search) queryParams.set('search', search);

  const url = `${config.services.capitalFmApiBaseUrl}/presenters?${queryParams.toString()}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Presenters API returned status ${response.status}`);
    }

    const totalHeader = response.headers.get('X-WP-Total');
    const json = (await response.json()) as any;

    const items = Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : [];
    const total = json.meta?.total !== undefined ? json.meta.total : totalHeader ? parseInt(totalHeader, 10) : items.length;

    const result: PresenterListResponseDTO = {
      data: items,
      meta: {
        total,
        page,
        per_page: perPage,
      },
    };

    if (redis.status === 'ready') {
      redis.setex(cacheKey, 900, JSON.stringify(result)).catch(() => {});
    }

    return result;
  } catch (error) {
    logger.warn({ error, url }, 'Failed to fetch presenters from Capital FM API. Returning empty presenter list.');
    return {
      data: [],
      meta: { total: 0, page, per_page: perPage },
    };
  }
}

/**
 * Fetches single presenter record by ID or Slug.
 * Preserves bio.html, bio.text, shows[], articles[], and socials.
 */
export async function getPresenterBySlug(idOrSlug: string): Promise<any | null> {
  const cacheKey = `presenters:detail:${idOrSlug}`;

  if (redis.status === 'ready') {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (_) {}
  }

  const url = `${config.services.capitalFmApiBaseUrl}/presenters/${encodeURIComponent(idOrSlug)}`;

  try {
    const response = await fetch(url);
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`Presenter detail API returned status ${response.status}`);
    }

    const json = (await response.json()) as any;
    const presenterData = json.data || json;

    if (redis.status === 'ready' && presenterData) {
      redis.setex(cacheKey, 900, JSON.stringify(presenterData)).catch(() => {});
    }

    return presenterData;
  } catch (error) {
    logger.error({ error, url, idOrSlug }, 'Failed to fetch single presenter detail from Capital FM API');
    return null;
  }
}
