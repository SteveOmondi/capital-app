import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  env: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',
  corsOrigin: process.env.CORS_ORIGIN || '*',

  db: {
    url: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/capitalfm_db?schema=public',
  },

  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },

  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID || undefined,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL || undefined,
    privateKey: process.env.FIREBASE_PRIVATE_KEY
      ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      : undefined,
  },

  security: {
    wpWebhookSecret: process.env.WP_WEBHOOK_SECRET || 'capital_fm_secret_webhook_key_2026',
  },

  streamguys: {
    host: process.env.STREAMGUYS_HOST || 'https://atunwadigital-recast.streamguys1.com',
    clientId: process.env.STREAMGUYS_CLIENT_ID,
    clientSecret: process.env.STREAMGUYS_CLIENT_SECRET,
    username: process.env.STREAMGUYS_USERNAME,
    password: process.env.STREAMGUYS_PASSWORD,
    primaryHlsUrl: process.env.STREAMGUYS_PRIMARY_HLS_URL || 'https://atunwadigital.streamguys1.com/capitalfm',
    fallbackAacUrl: process.env.STREAMGUYS_FALLBACK_AAC_URL || 'https://atunwadigital.streamguys1.com/capitalfm',
    icyStreamUrl: process.env.STREAMGUYS_ICY_STREAM_URL || 'https://atunwadigital.streamguys1.com/capitalfm',
  },

  services: {
    wpCmsBaseUrl: process.env.WP_CMS_BASE_URL || 'https://www.capitalfm.africa/wp-json/wp/v2',
    podcastRssUrl: process.env.PODCAST_RSS_URL || 'https://www.capitalfm.africa/feed/podcast/',
    liveStreamPrimaryUrl: process.env.LIVE_STREAM_PRIMARY_URL || 'https://atunwadigital.streamguys1.com/capitalfm',
    liveStreamFallbackUrl: process.env.LIVE_STREAM_FALLBACK_URL || 'https://atunwadigital.streamguys1.com/capitalfm',
    icyStreamUrl: process.env.ICY_STREAM_URL || 'https://atunwadigital.streamguys1.com/capitalfm',
  },
};
