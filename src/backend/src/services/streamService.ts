import { config } from '../config';
import { parseIcyMetadataString, extractIcyStreamTitle } from '../utils/icyScraper';
import { fetchAlbumArtwork, EnrichedTrackDetails } from './enrichmentService';
import { getStreamGuysAccessToken } from './streamGuysService';
import { getCurrentLiveShow, getTodayName, formatEatIsoString, ShowSlot } from './scheduleService';
import { redis } from '../config/redis';
import { logger } from '../middlewares/logger';

export interface StreamConfigDTO {
  proxyStreamUrl: string;
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
  show?: ShowSlot | null;
  streamUrl: string;
  fallbackStreamUrl?: string;
  proxyStreamUrl?: string;
  provider?: string;
  timestamp: string;
}

const STREAM_CANDIDATES = [
  'https://atunwadigital.streamguys1.com/capitalfm',
  'https://atunwadigital.streamguys1.com/capitalfm/playlist.m3u8',
];

/**
 * Live audio stream proxy optimized for Mobile Browsers (iOS Safari / Android Chrome) and Flutter Audio Players.
 * Strips ICY metadata frames to prevent browser HTML5 audio decoder stalls and handles auto-recycling.
 */
export async function proxyLiveAudioStream(req: any, res: any): Promise<void> {
  const httpModule = await import('http');
  const httpsModule = await import('https');
  const { URL } = await import('url');

  // Handle HEAD preflight requests from mobile browser HTML5 <audio> tags
  if (req.method === 'HEAD') {
    res.writeHead(200, {
      'Content-Type': 'audio/mpeg',
      'Accept-Ranges': 'none',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Access-Control-Allow-Origin': '*',
    });
    res.end();
    return;
  }

  let isClientConnected = true;
  let candidateIndex = 0;
  let currentUpstreamReq: any = null;
  let headersSent = false;

  req.on('close', () => {
    isClientConnected = false;
    if (currentUpstreamReq) {
      try {
        currentUpstreamReq.destroy();
      } catch (_) {}
    }
  });

  const connectToUpstream = () => {
    if (!isClientConnected) return;

    const streamUrl = STREAM_CANDIDATES[candidateIndex % STREAM_CANDIDATES.length];
    logger.info({ streamUrl, candidateIndex }, 'Proxying audio stream to active candidate');

    try {
      const parsedUrl = new URL(streamUrl);
      const isHttps = streamUrl.startsWith('https');
      const clientLib = isHttps ? httpsModule : httpModule;

      const requestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          'Icy-MetaData': '0', // Force clean audio stream without ICY metadata frames that break HTML5 audio decoders
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
          'Accept': '*/*',
          'Connection': 'keep-alive',
        },
      };

      currentUpstreamReq = clientLib.request(requestOptions, (upstreamRes: any) => {
        if (upstreamRes.statusCode && upstreamRes.statusCode >= 400) {
          logger.warn({ status: upstreamRes.statusCode, streamUrl }, 'Upstream stream returned error status, recycling candidate...');
          candidateIndex++;
          setTimeout(connectToUpstream, 1000);
          return;
        }

        if (!headersSent && isClientConnected) {
          const contentType = upstreamRes.headers['content-type'] || 'audio/mpeg';
          res.writeHead(200, {
            'Content-Type': contentType,
            'Accept-Ranges': 'none',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
          });
          headersSent = true;
        }

        upstreamRes.on('data', (chunk: Buffer) => {
          if (isClientConnected) {
            try {
              res.write(chunk);
            } catch (_) {
              isClientConnected = false;
            }
          }
        });

        upstreamRes.on('end', () => {
          if (isClientConnected) {
            logger.warn({ streamUrl }, 'Upstream audio stream ended unexpectedly. Auto-recycling stream connection...');
            candidateIndex++;
            setTimeout(connectToUpstream, 1000);
          }
        });

        upstreamRes.on('error', (err: any) => {
          if (isClientConnected) {
            logger.warn({ err, streamUrl }, 'Upstream stream error encountered. Auto-recycling connection...');
            candidateIndex++;
            setTimeout(connectToUpstream, 1000);
          }
        });
      });

      currentUpstreamReq.on('error', (err: any) => {
        if (isClientConnected) {
          logger.warn({ err, streamUrl }, 'Failed to connect to upstream stream candidate. Trying next candidate...');
          candidateIndex++;
          setTimeout(connectToUpstream, 1000);
        }
      });

      currentUpstreamReq.end();
    } catch (err) {
      logger.error({ err, streamUrl }, 'Error creating upstream request options');
      candidateIndex++;
      setTimeout(connectToUpstream, 1000);
    }
  };

  connectToUpstream();
}

function formatProxyUrl(baseUrl?: string, path: string = '/api/v1/stream/listen'): string {
  if (!baseUrl || baseUrl.trim().length === 0) {
    const defaultHost = process.env.PUBLIC_BASE_URL || 'https://ca-capital-backend-api.salmonwave-7494888b.eastus.azurecontainerapps.io';
    return `${defaultHost.replace(/\/$/, '')}${path}`;
  }

  let cleanBase = baseUrl.trim().replace(/\/$/, '');

  // Force HTTPS for all non-local domains (Azure Container Apps terminates SSL at ingress)
  if (!cleanBase.includes('localhost') && !cleanBase.includes('127.0.0.1')) {
    cleanBase = cleanBase.replace(/^http:\/\//i, 'https://');
    if (!/^https:\/\//i.test(cleanBase)) {
      cleanBase = `https://${cleanBase}`;
    }
  } else if (!/^https?:\/\//i.test(cleanBase)) {
    cleanBase = `http://${cleanBase}`;
  }

  return `${cleanBase}${path}`;
}

/**
 * Returns stream resolution configuration for Flutter mobile audio players.
 * Authenticates with StreamGuys Recast API if credentials are provided.
 */
export async function getStreamConfig(baseUrl?: string): Promise<StreamConfigDTO> {
  const sgToken = await getStreamGuysAccessToken();
  const isStreamGuysActive = Boolean(sgToken);

  return {
    proxyStreamUrl: formatProxyUrl(baseUrl, '/api/v1/stream/listen'),
    primaryHlsUrl: isStreamGuysActive
      ? config.streamguys.primaryHlsUrl
      : config.services.liveStreamPrimaryUrl,
    fallbackAacUrl: isStreamGuysActive
      ? config.streamguys.fallbackAacUrl
      : config.services.liveStreamFallbackUrl,
    icyStreamUrl: isStreamGuysActive
      ? config.streamguys.icyStreamUrl
      : config.services.icyStreamUrl,
    provider: isStreamGuysActive ? 'StreamGuys Recast' : 'Default',
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
export async function getNowPlayingTrack(baseUrl?: string): Promise<NowPlayingDTO> {
  const cacheKey = `stream:nowplaying:${baseUrl || 'default'}`;

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

    const targetIcyUrl = config.streamguys.icyStreamUrl || config.services.icyStreamUrl;
    const response = await fetch(targetIcyUrl, {
      headers: { 'Icy-MetaData': '1' },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const icyMetaHeader = response.headers.get('icy-name') || response.headers.get('icy-description');
    if (
      icyMetaHeader &&
      icyMetaHeader !== 'Unspecified description' &&
      icyMetaHeader !== 'various' &&
      icyMetaHeader.trim().length > 0
    ) {
      rawMetadataString = icyMetaHeader;
    }
  } catch (error) {
    // If live ICY connection times out, use default/cached track string
  }

  const parsed = parseIcyMetadataString(rawMetadataString);
  const enriched = await fetchAlbumArtwork(parsed.artist, parsed.title);
  const [streamConfig, currentShow] = await Promise.all([
    getStreamConfig(baseUrl),
    getCurrentLiveShow(),
  ]);

  const payload: NowPlayingDTO = {
    isLive: true,
    track: enriched,
    show: currentShow || {
      id: 'capital-fm-live',
      title: 'Capital FM Live Radio',
      presenters: ['Capital FM Crew'],
      startTime: '00:00',
      endTime: '23:59',
      dayOfWeek: getTodayName(),
      description: 'Capital FM Kenya - 98.4 FM Live Radio Broadcasting',
      isLiveNow: true,
    },
    streamUrl: streamConfig.primaryHlsUrl,
    fallbackStreamUrl: streamConfig.fallbackAacUrl,
    proxyStreamUrl: streamConfig.proxyStreamUrl,
    provider: streamConfig.provider,
    timestamp: formatEatIsoString(),
  };

  // Cache state in Redis for 5 seconds
  if (redis.status === 'ready') {
    redis.setex(cacheKey, 5, JSON.stringify(payload)).catch(() => {});
  }

  return payload;
}
