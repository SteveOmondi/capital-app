import { config } from '../config';
import { parseIcyMetadataString, extractIcyStreamTitle } from '../utils/icyScraper';
import { fetchAlbumArtwork, EnrichedTrackDetails } from './enrichmentService';
import { getStreamGuysAccessToken } from './streamGuysService';
import { redis } from '../config/redis';
import { logger } from '../middlewares/logger';

export interface StreamConfigDTO {
  primaryHlsUrl: string;
  fallbackAacUrl: string;
  icyStreamUrl: string;
  provider: 'StreamGuys Recast' | 'Default';
  bitrateKbps: {
    primary: number;
    fallback: number;
  };
  audioFormats: {
    primary: string;
    fallback: string;
  };
  status: 'online' | 'degraded' | 'offline';
  metadataPollingIntervalSeconds: number;
  streamGuysAccessToken?: string;
}

export interface NowPlayingDTO {
  isLive: boolean;
  track: EnrichedTrackDetails;
  timestamp: string;
}

/**
 * Returns stream resolution configuration for Flutter mobile audio players.
 * Authenticates with StreamGuys Recast API if credentials are provided.
 */
export async function getStreamConfig(): Promise<StreamConfigDTO> {
  const sgToken = await getStreamGuysAccessToken();

  return {
    primaryHlsUrl: config.services.liveStreamPrimaryUrl,
    fallbackAacUrl: config.services.liveStreamFallbackUrl,
    icyStreamUrl: config.services.icyStreamUrl,
    provider: sgToken ? 'StreamGuys Recast' : 'Default',
    bitrateKbps: {
      primary: 128,
      fallback: 64,
    },
    audioFormats: {
      primary: 'HLS (AAC)',
      fallback: 'HE-AACv2',
    },
    status: 'online',
    metadataPollingIntervalSeconds: 5,
    streamGuysAccessToken: sgToken || undefined,
  };
}

/**
 * Returns the currently playing track with album cover art enrichment.
 */
export async function getNowPlayingTrack(): Promise<NowPlayingDTO> {
  const cacheKey = 'stream:nowplaying';

  // Redis cache check (short TTL: 5 seconds)
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

  let rawMetadataString = 'Capital FM - Live Radio Stream';

  // Attempt lightweight ICY header poll from ICY stream endpoint
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    const response = await fetch(config.services.icyStreamUrl, {
      headers: { 'Icy-MetaData': '1' },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const icyMetaHeader = response.headers.get('icy-name') || response.headers.get('icy-description');
    if (icyMetaHeader) {
      rawMetadataString = icyMetaHeader;
    }
  } catch (error) {
    // If live ICY connection times out, use default/cached track string
  }

  const parsed = parseIcyMetadataString(rawMetadataString);
  const enriched = await fetchAlbumArtwork(parsed.artist, parsed.title);

  const payload: NowPlayingDTO = {
    isLive: true,
    track: enriched,
    timestamp: new Date().toISOString(),
  };

  // Cache state in Redis for 5 seconds
  if (redis.status === 'ready') {
    redis.setex(cacheKey, 5, JSON.stringify(payload)).catch(() => {});
  }

  return payload;
}
