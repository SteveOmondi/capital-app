/**
 * One-off backfill: restores each cached news article's real publish date from the website.
 *
 * Before the fix in wordpressService.transformApiArticle, the capitalfm/v1 `published` field was
 * never read, so every synced article was stored with the sync time instead of its publish date.
 * This script looks up the true dates in batches of 100 via the standard WordPress endpoint
 * (/wp-json/wp/v2/posts?include=...&_fields=id,date_gmt), corrects rows whose date differs,
 * and then clears the cached article responses in Redis.
 *
 * Podcast rows (slug "podcast-*") share the table but do not come from WordPress, so they are skipped.
 *
 * Safe to rerun: rows that already hold the website's date are left untouched.
 *
 * Usage (development, ts-node):
 *   npm run backfill:article-dates              # dry run: report what would change, write nothing
 *   npm run backfill:article-dates -- --apply   # write corrected dates and clear the article cache
 *
 * Usage (production image, compiled):
 *   node dist/jobs/backfillArticleDates.js [--apply]
 *   Run automatically by scripts/deploy-ssh.sh when BACKFILL_ON_DEPLOY=on.
 */
import { prisma } from '../config/db';
import { redis } from '../config/redis';
import { config } from '../config';

const BATCH_SIZE = 100; // WordPress REST per_page maximum
const REQUEST_DELAY_MS = 250;
const REQUEST_TIMEOUT_MS = 30000;

const apply = process.argv.includes('--apply');

function wpPostsUrl(ids: number[]): string {
  const apiRoot = config.services.capitalFmApiBaseUrl.replace(/\/capitalfm\/v1\/?$/, '');
  const params = new URLSearchParams({
    include: ids.join(','),
    per_page: String(BATCH_SIZE),
    _fields: 'id,date_gmt',
  });
  return `${apiRoot}/wp/v2/posts?${params.toString()}`;
}

async function fetchPublishDates(ids: number[]): Promise<Map<number, Date>> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(wpPostsUrl(ids), { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`WordPress posts endpoint returned status ${response.status}`);
    }
    const posts = (await response.json()) as Array<{ id: number; date_gmt?: string }>;
    const dates = new Map<number, Date>();
    for (const post of posts) {
      if (!post.date_gmt) continue;
      // date_gmt has no timezone suffix; it is UTC by definition.
      const date = new Date(`${post.date_gmt}Z`);
      if (Number.isFinite(date.getTime())) dates.set(post.id, date);
    }
    return dates;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function clearArticleCache(): Promise<void> {
  if (redis.status !== 'ready' && redis.status !== 'connecting') {
    console.log('ℹ️ Redis client not connected, skipping cache clear. Cached responses expire within 15 minutes.');
    return;
  }
  let cursor = '0';
  let deleted = 0;
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', 'articles:*', 'COUNT', 500);
    cursor = next;
    if (keys.length > 0) deleted += await redis.del(...keys);
  } while (cursor !== '0');
  console.log(`✅ Cleared ${deleted} cached article responses from Redis.`);
}

async function backfill(): Promise<void> {
  console.log(apply ? '✏️  APPLY mode: corrected dates will be written.' : '🔍 DRY RUN: no changes will be written (pass --apply to write).');

  const rows = await prisma.article.findMany({
    where: { NOT: { slug: { startsWith: 'podcast-' } } },
    select: { id: true, publishedAt: true },
    orderBy: { id: 'asc' },
  });
  console.log(`Found ${rows.length} news articles in PostgreSQL.`);

  let corrected = 0;
  let alreadyCorrect = 0;
  const notFound: number[] = [];
  const failedBatches: string[] = [];

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const label = `${i + 1}-${i + batch.length}`;

    let dates: Map<number, Date>;
    try {
      dates = await fetchPublishDates(batch.map((row) => row.id));
    } catch (error: any) {
      console.warn(`⚠️ Batch ${label} skipped: ${error.message || error}`);
      failedBatches.push(label);
      continue;
    }

    for (const row of batch) {
      const realDate = dates.get(row.id);
      if (!realDate) {
        notFound.push(row.id);
        continue;
      }
      if (realDate.getTime() === row.publishedAt.getTime()) {
        alreadyCorrect++;
        continue;
      }
      if (apply) {
        await prisma.article.update({ where: { id: row.id }, data: { publishedAt: realDate } });
      } else if (corrected < 10) {
        console.log(`  would fix ${row.id}: ${row.publishedAt.toISOString()} -> ${realDate.toISOString()}`);
      }
      corrected++;
    }

    console.log(`Batch ${label}: processed.`);
    await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS));
  }

  console.log('');
  console.log(`${apply ? 'Corrected' : 'Would correct'}: ${corrected}`);
  console.log(`Already correct: ${alreadyCorrect}`);
  console.log(`Not found on the website (left unchanged): ${notFound.length}${notFound.length ? ` [${notFound.slice(0, 20).join(', ')}${notFound.length > 20 ? ', ...' : ''}]` : ''}`);
  if (failedBatches.length) {
    console.log(`Failed batches (rerun to retry): ${failedBatches.join(', ')}`);
  }

  if (apply && corrected > 0) {
    await clearArticleCache();
  }
}

backfill()
  .catch((err) => {
    console.error('❌ Backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    redis.disconnect();
  });
