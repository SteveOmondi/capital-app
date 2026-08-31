import { redis } from '../config/redis';
import { logger } from '../middlewares/logger';
import { config } from '../config';

export interface StreamGuysTokenResponse {
  token_type: string;
  expires_in: number;
  access_token: string;
}

export interface StreamGuysConfig {
  host?: string;
  clientId?: string;
  clientSecret?: string;
  username?: string;
  password?: string;
}

/**
 * Obtains an OAuth Bearer token from StreamGuys Recast API using Client Credentials grant.
 * Caches the token in Redis to minimize authentication roundtrips.
 */
export async function getStreamGuysAccessToken(customConfig?: StreamGuysConfig): Promise<string | null> {
  const host = customConfig?.host || config.streamguys.host;
  const clientId = customConfig?.clientId || config.streamguys.clientId;
  const clientSecret = customConfig?.clientSecret || config.streamguys.clientSecret;

  if (!clientId || !clientSecret) {
    logger.debug('StreamGuys Client ID or Secret missing. Skipping StreamGuys OAuth authentication.');
    return null;
  }

  const cacheKey = `streamguys:token:${clientId}`;

  // 1. Check Redis Cache
  if (redis.status === 'ready') {
    try {
      const cachedToken = await redis.get(cacheKey);
      if (cachedToken) {
        return cachedToken;
      }
    } catch (_) {
      // Ignore cache error
    }
  }

  // 2. Request new Bearer Token from StreamGuys OAuth endpoint
  try {
    const tokenUrl = `${host.replace(/\/$/, '')}/oauth/token`;
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: '*',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn({ status: response.status, errorText }, 'StreamGuys OAuth token request failed');
      return null;
    }

    const data = (await response.json()) as StreamGuysTokenResponse;
    const accessToken = data.access_token;
    const expiresIn = data.expires_in || 3600;

    // Cache token in Redis (subtract 60s safety buffer)
    if (redis.status === 'ready' && accessToken) {
      redis.setex(cacheKey, Math.max(60, expiresIn - 60), accessToken).catch(() => {});
    }

    logger.info('Successfully authenticated with StreamGuys Recast API');
    return accessToken;
  } catch (error) {
    logger.error({ error }, 'Error connecting to StreamGuys OAuth API');
    return null;
  }
}
