import { prisma } from '../src/config/db';
import { redis } from '../src/config/redis';

async function clearCache(): Promise<void> {
  console.log('🧹 Clearing cached news articles and podcasts from PostgreSQL database...');
  try {
    const deletedArticles = await prisma.article.deleteMany({});
    console.log(`✅ Cleared ${deletedArticles.count} articles from PostgreSQL database.`);
  } catch (error: any) {
    console.warn('⚠️ Could not clear PostgreSQL database (server offline or unreachable):', error.message || error);
  }

  if (redis.status === 'ready' || redis.status === 'connecting') {
    console.log('🧹 Clearing Redis cache keys for articles and podcasts...');
    try {
      const keys = await redis.keys('*articles*');
      const podcastKeys = await redis.keys('*podcast*');
      const lockKeys = await redis.keys('*sync:lock*');
      const allKeys = Array.from(new Set([...keys, ...podcastKeys, ...lockKeys]));

      if (allKeys.length > 0) {
        await redis.del(...allKeys);
        console.log(`✅ Flushed ${allKeys.length} Redis cache keys.`);
      } else {
        console.log('ℹ️ No matching Redis cache keys found.');
      }
    } catch (redisErr: any) {
      console.warn('⚠️ Could not flush Redis cache:', redisErr.message || redisErr);
    } finally {
      redis.disconnect();
    }
  } else {
    console.log('ℹ️ Redis client not connected, skipping Redis flush.');
  }

  await prisma.$disconnect();
  console.log('🎉 Cache purge complete! Next API requests will fetch fresh full content from WordPress API.');
}

clearCache().catch((err) => {
  console.error('❌ Cache clearing failed:', err);
  process.exit(1);
});
