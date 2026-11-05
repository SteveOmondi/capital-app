import { redis } from '../config/redis';

const DEFAULT_TIMEOUT_MS = 10000;

/** Upstream failures surface as 502 Bad Gateway through the shared error handler. */
export function upstreamError(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode: 502 });
}

/**
 * Fetches a Capital FM API URL with a timeout, so a hanging website never hangs the gateway.
 * Network failures and timeouts become 502 errors; HTTP statuses are returned to the caller.
 */
export async function fetchUpstream(url: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } catch (error) {
    throw upstreamError(`Capital FM API unreachable: ${(error as Error)?.message || 'fetch failed'}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Reads `{ data, meta }` pagination the way the Capital FM API reports it (meta first, then X-WP-* headers). */
export function readUpstreamPagination(
  json: any,
  response: Response,
  itemCount: number,
  page: number,
  perPage: number,
): { total: number; total_pages: number; page: number; per_page: number } {
  const totalHeader = response.headers.get('X-WP-Total');
  const totalPagesHeader = response.headers.get('X-WP-TotalPages');
  const total =
    json?.meta?.total !== undefined && json?.meta?.total !== null
      ? Number(json.meta.total)
      : totalHeader
        ? parseInt(totalHeader, 10)
        : itemCount;
  const totalPages =
    json?.meta?.total_pages !== undefined && json?.meta?.total_pages !== null
      ? Number(json.meta.total_pages)
      : totalPagesHeader
        ? parseInt(totalPagesHeader, 10)
        : Math.max(1, Math.ceil(total / perPage));
  return { total, total_pages: totalPages, page, per_page: perPage };
}

export async function readCache<T>(key: string): Promise<T | null> {
  if (redis.status !== 'ready') return null;
  try {
    const cached = await redis.get(key);
    return cached ? (JSON.parse(cached) as T) : null;
  } catch (_) {
    return null;
  }
}

export function writeCache(key: string, ttlSeconds: number, value: unknown): void {
  if (redis.status !== 'ready') return;
  redis.setex(key, ttlSeconds, JSON.stringify(value)).catch(() => {});
}

export function deleteCache(key: string): void {
  if (redis.status !== 'ready') return;
  redis.del(key).catch(() => {});
}

export function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  const n = Number.isFinite(value) ? Math.trunc(value as number) : fallback;
  return Math.min(max, Math.max(min, n));
}

export function toInt(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : undefined;
}
