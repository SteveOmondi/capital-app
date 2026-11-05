import { redis } from '../config/redis';
import { logger } from '../middlewares/logger';

const lastRunByKey = new Map<string, number>();
const MAX_TRACKED_KEYS = 1000;
const completedSyncs = new Map<string, string>();

/**
 * Records that a full website sync for `key` finished. The returned generation changes on every
 * completion, so callers can put it in their cache keys and drop pre-sync cached lists.
 */
export async function markSyncComplete(key: string): Promise<string> {
  const generation = String(Date.now());
  completedSyncs.set(key, generation);
  if (redis.status === 'ready') {
    await redis.set(`sync:complete:${key}`, generation).catch(() => {});
  }
  return generation;
}

/** Generation of the last completed full sync for `key` (shared across replicas via Redis), or null if none. */
export async function getSyncGeneration(key: string): Promise<string | null> {
  if (redis.status === 'ready') {
    try {
      const stored = await redis.get(`sync:complete:${key}`);
      if (stored) {
        completedSyncs.set(key, stored);
        return stored;
      }
    } catch (_) {
      // Redis unavailable: fall back to this process's record.
    }
  }
  return completedSyncs.get(key) ?? null;
}

/**
 * Runs `task` in the background at most once per `intervalMs` for a given key, so content served
 * from Postgres is re-synced from the website periodically while the server is handling traffic.
 * A Redis NX lock keeps multiple gateway replicas from re-syncing the same key at once.
 * Failures are logged and swallowed: the caller has already answered from Postgres or Redis.
 */
export function scheduleBackgroundSync(
  key: string,
  intervalMs: number,
  task: () => Promise<void>,
): void {
  const now = Date.now();
  if (now - (lastRunByKey.get(key) || 0) < intervalMs) {
    return;
  }
  if (lastRunByKey.size >= MAX_TRACKED_KEYS) {
    lastRunByKey.clear();
  }
  lastRunByKey.set(key, now);

  setImmediate(async () => {
    if (redis.status === 'ready') {
      try {
        const acquired = await redis.set(
          `sync:lock:${key}`,
          '1',
          'EX',
          Math.max(1, Math.ceil(intervalMs / 1000)),
          'NX',
        );
        if (!acquired) return;
      } catch (_) {
        // Lock unavailable: proceed; the in-process throttle still bounds the work.
      }
    }
    try {
      await task();
    } catch (err) {
      logger.warn({ err, key }, 'Background website re-sync failed; serving last stored copy');
    }
  });
}

/** Test helper: forget throttle and sync-completion state so each test starts fresh. */
export function resetBackgroundSyncThrottle(): void {
  lastRunByKey.clear();
  completedSyncs.clear();
}
