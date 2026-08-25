import { redis } from '../config/redis';
import { logger } from '../middlewares/logger';

export interface EnrichedTrackDetails {
  artist: string;
  title: string;
  album?: string;
  coverImageUrl?: string;
  releaseYear?: string;
}

export async function fetchAlbumArtwork(artist: string, title: string): Promise<EnrichedTrackDetails> {
  const defaultPayload: EnrichedTrackDetails = {
    artist,
    title,
    coverImageUrl: undefined,
  };

  if (!artist || !title || artist === 'Capital FM') {
    return defaultPayload;
  }

  const query = `${artist} ${title}`;
  const cacheKey = `enrichment:track:${Buffer.from(query).toString('base64')}`;

  // Redis cache check
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

  try {
    const iTunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=1`;
    const response = await fetch(iTunesUrl);

    if (!response.ok) {
      return defaultPayload;
    }

    const data: any = await response.json();
    if (data.resultCount > 0 && data.results?.[0]) {
      const result = data.results[0];
      const rawArtUrl = result.artworkUrl100 || result.artworkUrl60;
      // Upgrade to 600x600 high quality cover art
      const coverImageUrl = rawArtUrl ? rawArtUrl.replace('100x100bb', '600x600bb') : undefined;

      const enriched: EnrichedTrackDetails = {
        artist: result.artistName || artist,
        title: result.trackName || title,
        album: result.collectionName || undefined,
        coverImageUrl,
        releaseYear: result.releaseDate ? result.releaseDate.substring(0, 4) : undefined,
      };

      // Cache lookups in Redis for 24 hours (86400 seconds)
      if (redis.status === 'ready') {
        redis.setex(cacheKey, 86400, JSON.stringify(enriched)).catch(() => {});
      }

      return enriched;
    }
  } catch (error) {
    logger.warn({ error, query }, 'Failed to fetch iTunes album artwork enrichment');
  }

  return defaultPayload;
}
