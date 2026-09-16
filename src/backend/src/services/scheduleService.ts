import { config } from '../config';
import { redis } from '../config/redis';
import { logger } from '../middlewares/logger';

export interface PresenterMetaDTO {
  id: number;
  slug: string;
  name: string;
  role?: string;
  image?: any;
}

export interface ShowSlot {
  id: string;
  title: string;
  slug?: string;
  presenters: string[];
  presenterRecords?: PresenterMetaDTO[];
  startTime: string; // e.g. "06:00"
  endTime: string;   // e.g. "10:00"
  displayTime?: string; // e.g. "10:00 AM – 2:00 PM"
  dayOfWeek: string; // "monday", "tuesday", etc.
  dayIndex?: number;
  description: string;
  coverImageUrl?: string;
  isLiveNow?: boolean;
}

export interface ScheduleNowDTO {
  meta: {
    timezone: string;
    generated_at: string;
    api_version?: string;
  };
  data: {
    now: string;
    timezone: string;
    on_air: {
      show: string;
      slug: string;
      host: string;
      hosts: string[];
      presenters: PresenterMetaDTO[];
      day: number;
      day_name: string;
      start: string;
      end: string;
      display: string;
      started_at: string;
      ends_at: string;
      seconds_elapsed: number;
      seconds_remaining: number;
      progress: number;
      image?: any;
    } | null;
    up_next: {
      show: string;
      slug?: string;
      host?: string;
      hosts?: string[];
      starts_at: string;
      ends_at?: string;
      display?: string;
    } | null;
    live: {
      stream_url: string | null;
      youtube_live: boolean;
      youtube_id: string | null;
      youtube_url: string | null;
    };
  };
}

/**
 * Helper to get current Date object offset to East Africa Time (EAT: UTC+3).
 */
export function getEatDate(date: Date = new Date()): Date {
  const utcMs = date.getTime() + date.getTimezoneOffset() * 60 * 1000;
  return new Date(utcMs + 3 * 60 * 60 * 1000);
}

export function formatEatIsoString(date: Date = new Date()): string {
  const eat = getEatDate(date);
  const year = eat.getFullYear();
  const month = String(eat.getMonth() + 1).padStart(2, '0');
  const day = String(eat.getDate()).padStart(2, '0');
  const hours = String(eat.getHours()).padStart(2, '0');
  const minutes = String(eat.getMinutes()).padStart(2, '0');
  const seconds = String(eat.getSeconds()).padStart(2, '0');
  const millis = String(eat.getMilliseconds()).padStart(3, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${millis}+03:00`;
}

export function getTodayName(): string {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const eatDate = getEatDate();
  return days[eatDate.getDay()];
}

export interface LiveStateDTO {
  meta: {
    timezone: string;
    generated_at: string;
    api_version?: string;
  };
  data: {
    radio: {
      is_live: boolean;
      stream_url: string;
      show: string;
      host: string;
      ends_at: string;
    };
    youtube: {
      is_live: boolean;
      video_id: string | null;
      channel_id: string | null;
      title: string | null;
      watch_url: string | null;
      embed_url: string | null;
    };
    checked_at: string;
  };
}

/**
 * Fetches real-time live radio state (/schedule/now) from Capital FM Public API.
 * Live calculation (seconds_remaining, progress, on_air, up_next) is performed server-side in EAT.
 */
export async function getScheduleNow(): Promise<ScheduleNowDTO> {
  const cacheKey = 'schedule:now';

  if (redis.status === 'ready') {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (_) {}
  }

  const url = `${config.services.capitalFmApiBaseUrl}/schedule/now`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Schedule NOW API returned status ${response.status}`);
    }

    const payload = (await response.json()) as ScheduleNowDTO;

    // Cache for 30s (must not exceed current show remaining time or 60s max)
    const remainingSeconds = payload.data?.on_air?.seconds_remaining;
    const ttl = Math.min(30, remainingSeconds && remainingSeconds > 0 ? remainingSeconds : 30);

    if (redis.status === 'ready') {
      redis.setex(cacheKey, ttl, JSON.stringify(payload)).catch(() => {});
    }

    return payload;
  } catch (error) {
    logger.warn({ error, url }, 'Failed to fetch /schedule/now from Capital FM API. Returning fallback state.');
    const nowIso = formatEatIsoString();

    return {
      meta: { timezone: 'Africa/Nairobi', generated_at: nowIso, api_version: '2.1.1' },
      data: {
        now: nowIso,
        timezone: 'Africa/Nairobi',
        on_air: {
          show: 'Capital FM Live',
          slug: 'capital-fm-live',
          host: 'Capital FM Presenters',
          hosts: ['Capital FM Presenters'],
          presenters: [],
          day: getEatDate().getDay(),
          day_name: getTodayName(),
          start: '00:00',
          end: '23:59',
          display: '12:00 AM – 11:59 PM',
          started_at: nowIso,
          ends_at: nowIso,
          seconds_elapsed: 0,
          seconds_remaining: 3600,
          progress: 0.5,
        },
        up_next: null,
        live: {
          stream_url: config.services.liveStreamPrimaryUrl,
          youtube_live: false,
          youtube_id: null,
          youtube_url: null,
        },
      },
    };
  }
}

/**
 * Fetches concise real-time live radio & YouTube broadcast state (/live) from Capital FM Public API.
 * Cached in Redis for 30 seconds.
 */
export async function getLiveState(): Promise<LiveStateDTO> {
  const cacheKey = 'live:state';

  if (redis.status === 'ready') {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (_) {}
  }

  const url = `${config.services.capitalFmApiBaseUrl}/live`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Live state API returned status ${response.status}`);
    }

    const payload = (await response.json()) as LiveStateDTO;

    if (redis.status === 'ready') {
      redis.setex(cacheKey, 30, JSON.stringify(payload)).catch(() => {});
    }

    return payload;
  } catch (error) {
    logger.warn({ error, url }, 'Failed to fetch /live from Capital FM API. Returning fallback live state.');
    const nowIso = formatEatIsoString();

    return {
      meta: { timezone: 'Africa/Nairobi', generated_at: nowIso, api_version: '2.2.0' },
      data: {
        radio: {
          is_live: true,
          stream_url: config.services.liveStreamPrimaryUrl,
          show: 'Capital FM Live',
          host: 'Capital FM Presenters',
          ends_at: nowIso,
        },
        youtube: {
          is_live: false,
          video_id: null,
          channel_id: null,
          title: null,
          watch_url: null,
          embed_url: null,
        },
        checked_at: nowIso,
      },
    };
  }
}

/**
 * Fetches weekly radio show schedule grid from Capital FM Public API.
 * Supports filtering by day (`today`, `monday`, `0`-`6`).
 */
export async function getWeeklySchedules(day?: string): Promise<{ day: string; schedule: ShowSlot[]; rawData?: any }> {
  const targetDay = (day || 'today').toLowerCase();
  const cacheKey = `schedule:grid:${targetDay}`;

  if (redis.status === 'ready') {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (_) {}
  }

  let url = `${config.services.capitalFmApiBaseUrl}/schedule`;
  if (day) {
    url += `?day=${encodeURIComponent(day)}`;
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Schedule API returned status ${response.status}`);
    }

    const json = (await response.json()) as any;
    const slotsData: any[] = json.data?.slots || json.data || [];

    const schedule: ShowSlot[] = slotsData.map((slot: any, idx: number) => ({
      id: slot.slug ? `${slot.slug}-${slot.day}` : `slot-${idx}`,
      title: slot.show || 'Capital FM Show',
      slug: slot.slug || undefined,
      presenters: Array.isArray(slot.hosts) ? slot.hosts : slot.host ? [slot.host] : [],
      presenterRecords: slot.presenters || [],
      startTime: slot.start || '00:00',
      endTime: slot.end || '00:00',
      displayTime: slot.display || undefined,
      dayOfWeek: slot.day_name ? slot.day_name.toLowerCase() : getTodayName(),
      dayIndex: slot.day,
      description: slot.about || `${slot.show} on Capital FM`,
      coverImageUrl: slot.image?.url || slot.image?.src || undefined,
      isLiveNow: slot.is_live || false,
    }));

    const result = {
      day: targetDay,
      schedule,
      rawData: json.data,
    };

    if (redis.status === 'ready') {
      redis.setex(cacheKey, 900, JSON.stringify(result)).catch(() => {});
    }

    return result;
  } catch (error) {
    logger.error({ error, url }, 'Failed to fetch schedule from Capital FM API');
    return {
      day: targetDay,
      schedule: [],
    };
  }
}

/**
 * Returns current live show slot from /schedule/now API.
 */
export async function getCurrentLiveShow(): Promise<ShowSlot | null> {
  const scheduleNow = await getScheduleNow();
  const onAir = scheduleNow.data?.on_air;

  if (!onAir) {
    return null;
  }

  return {
    id: onAir.slug ? `${onAir.slug}-${onAir.day}` : 'live-show',
    title: onAir.show,
    slug: onAir.slug,
    presenters: onAir.hosts || [onAir.host],
    presenterRecords: onAir.presenters,
    startTime: onAir.start,
    endTime: onAir.end,
    displayTime: onAir.display,
    dayOfWeek: onAir.day_name.toLowerCase(),
    dayIndex: onAir.day,
    description: `Currently live on Capital FM: ${onAir.show}`,
    coverImageUrl: onAir.image?.url || undefined,
    isLiveNow: true,
  };
}
