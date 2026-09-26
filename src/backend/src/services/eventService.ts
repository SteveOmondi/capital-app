import { config } from '../config';
import { redis } from '../config/redis';
import { logger } from '../middlewares/logger';

export interface EventQuery {
  status?: 'upcoming' | 'today' | 'past' | 'all';
  from?: string;
  to?: string;
  search?: string;
  city?: string;
  venue?: string;
  category?: string;
  tag?: string;
  featured?: boolean | string;
  free?: boolean | string;
  orderby?: 'start' | 'title' | 'published' | 'modified';
  order?: 'asc' | 'desc';
  fields?: 'summary' | 'full';
  page?: number;
  per_page?: number;
}

export interface EventListResponseDTO {
  data: any[];
  meta: {
    total: number;
    total_pages: number;
    page: number;
    per_page: number;
    status?: string;
  };
}

/**
 * Fetches What's On events list with filtering & pagination from Capital FM Public API.
 * Cached in Redis for 5 minutes (300s).
 */
export async function getEvents(query: EventQuery): Promise<EventListResponseDTO> {
  const page = Math.max(1, query.page || 1);
  const perPage = Math.min(100, Math.max(1, query.per_page || 20));
  const status = query.status || 'upcoming';
  const fields = query.fields || 'summary';

  const cacheKey = `events:list:${status}:${fields}:page:${page}:limit:${perPage}:search:${query.search || ''}:cat:${query.category || ''}:city:${query.city || ''}`;

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
  queryParams.set('status', status);
  queryParams.set('fields', fields);

  if (query.from) queryParams.set('from', query.from);
  if (query.to) queryParams.set('to', query.to);
  if (query.search) queryParams.set('search', query.search);
  if (query.city) queryParams.set('city', query.city);
  if (query.venue) queryParams.set('venue', query.venue);
  if (query.category) queryParams.set('category', query.category);
  if (query.tag) queryParams.set('tag', query.tag);
  if (query.featured !== undefined) queryParams.set('featured', String(query.featured));
  if (query.free !== undefined) queryParams.set('free', String(query.free));
  if (query.orderby) queryParams.set('orderby', query.orderby);
  if (query.order) queryParams.set('order', query.order);

  const url = `${config.services.capitalFmApiBaseUrl}/events?${queryParams.toString()}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Events API returned status ${response.status}`);
    }

    const totalHeader = response.headers.get('X-WP-Total');
    const totalPagesHeader = response.headers.get('X-WP-TotalPages');

    const json = (await response.json()) as any;
    const items = Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : [];

    const total = json.meta?.total !== undefined ? json.meta.total : totalHeader ? parseInt(totalHeader, 10) : items.length;
    const totalPages = json.meta?.total_pages !== undefined ? json.meta.total_pages : totalPagesHeader ? parseInt(totalPagesHeader, 10) : Math.ceil(total / perPage);

    const result: EventListResponseDTO = {
      data: items,
      meta: {
        total,
        total_pages: totalPages,
        page,
        per_page: perPage,
        status,
      },
    };

    if (redis.status === 'ready') {
      redis.setex(cacheKey, 900, JSON.stringify(result)).catch(() => {});
    }

    return result;
  } catch (error) {
    logger.error({ error, url }, 'Failed to fetch events from Capital FM API');
    return {
      data: [],
      meta: { total: 0, total_pages: 0, page, per_page: perPage, status },
    };
  }
}

/**
 * Fetches single What's On event detail by ID or Slug.
 * Preserves content.html, tickets, organiser, venue, videos, and coverage[].
 */
export async function getEventBySlug(idOrSlug: string): Promise<any | null> {
  const cacheKey = `events:detail:${idOrSlug}`;

  if (redis.status === 'ready') {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (_) {}
  }

  const url = `${config.services.capitalFmApiBaseUrl}/events/${encodeURIComponent(idOrSlug)}`;

  try {
    const response = await fetch(url);
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`Event detail API returned status ${response.status}`);
    }

    const json = (await response.json()) as any;
    const eventData = json.data || json;

    if (redis.status === 'ready' && eventData) {
      redis.setex(cacheKey, 900, JSON.stringify(eventData)).catch(() => {});
    }

    return eventData;
  } catch (error) {
    logger.error({ error, url, idOrSlug }, 'Failed to fetch single event detail from Capital FM API');
    return null;
  }
}
