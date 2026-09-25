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

let authFailureCooldownUntil = 0;

/**
 * Obtains an OAuth Bearer token from StreamGuys Recast API using Password grant (`grant_type: "password"`).
 * Caches the token in Redis to minimize authentication roundtrips.
 */
export async function getStreamGuysAccessToken(customConfig?: StreamGuysConfig): Promise<string | null> {
  // If authentication failed recently, enforce 60s cooldown to prevent API spamming
  if (Date.now() < authFailureCooldownUntil) {
    return null;
  }

  const host = customConfig?.host || config.streamguys.host;
  const clientId = customConfig?.clientId || config.streamguys.clientId;
  const clientSecret = customConfig?.clientSecret || config.streamguys.clientSecret;
  const username = customConfig?.username || config.streamguys.username;
  const password = customConfig?.password || config.streamguys.password;

  if (!clientId || !clientSecret || !username || !password) {
    logger.debug('StreamGuys Client ID, Secret, Username, or Password missing. Skipping StreamGuys OAuth authentication.');
    return null;
  }

  const cacheKey = `streamguys:token:${clientId}:${username}`;

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

  // 2. Request new Bearer Token from StreamGuys OAuth endpoint using Password Grant
  try {
    const tokenUrl = `${host.replace(/\/$/, '')}/oauth/token`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1500);

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'password',
        client_id: clientId,
        client_secret: clientSecret,
        username: username,
        password: password,
        scope: '*',
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn({ status: response.status, errorText }, 'StreamGuys OAuth token request failed. Enforcing 60s retry cooldown.');
      authFailureCooldownUntil = Date.now() + 60000;
      return null;
    }

    const data = (await response.json()) as StreamGuysTokenResponse;
    const accessToken = data.access_token;
    const expiresIn = data.expires_in || 3600;

    // Cache token in Redis (subtract 60s safety buffer)
    if (redis.status === 'ready' && accessToken) {
      redis.setex(cacheKey, Math.max(60, expiresIn - 60), accessToken).catch(() => {});
    }

    authFailureCooldownUntil = 0;
    logger.info('Successfully authenticated with StreamGuys Recast API via Password Grant');
    return accessToken;
  } catch (error) {
    logger.error({ error }, 'Error connecting to StreamGuys OAuth API');
    return null;
  }
}

/**
 * Authenticates with StreamGuys Recast web session portal using username/password.
 * Returns Cookie header string e.g. "sgrecast_session=..."
 */
export async function getStreamGuysSessionCookie(): Promise<string | null> {
  const host = config.streamguys.host || 'https://atunwadigital-recast.streamguys1.com';
  const username = config.streamguys.username || 'kenkipkorir';
  const password = config.streamguys.password || '$P$BauGLJ5MZftON3OF1/';

  const cacheKey = 'streamguys:session_cookie';

  if (redis.status === 'ready') {
    try {
      const cachedCookie = await redis.get(cacheKey);
      if (cachedCookie) {
        return cachedCookie;
      }
    } catch (_) {}
  }

  try {
    const loginUrl = `${host.replace(/\/$/, '')}/login`;
    const response = await fetch(loginUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        username,
        password,
      }).toString(),
      redirect: 'manual',
    });

    const setCookie = response.headers.get('set-cookie');
    if (setCookie) {
      const match = setCookie.match(/sgrecast_session=[^;]+/);
      const cookieStr = match ? match[0] : setCookie.split(';')[0];

      if (redis.status === 'ready' && cookieStr) {
        redis.setex(cacheKey, 7200, cookieStr).catch(() => {});
      }
      return cookieStr;
    }
  } catch (error) {
    logger.warn({ error }, 'Failed to authenticate StreamGuys Recast session cookie');
  }

  return null;
}
