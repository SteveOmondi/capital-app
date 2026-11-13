/**
 * Capital FM Videos gateway coverage: /api/v1/videos, /api/v1/videos/:idOrSlug, and the `video` /
 * `isVideo` fields on every news response. Upstream is stubbed via global fetch, and Redis/Postgres
 * are stubbed so the tests are hermetic.
 */
jest.mock('../config/redis', () => ({
  redis: { status: 'end', get: jest.fn(), setex: jest.fn(), call: jest.fn(), on: jest.fn() },
  checkRedisConnection: jest.fn().mockResolvedValue(false),
}));
jest.mock('../config/db', () => {
  const model = () => ({
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    upsert: jest.fn(),
    deleteMany: jest.fn(),
  });
  return {
    prisma: {
      article: model(),
      author: model(),
      presenter: model(),
      $queryRaw: jest.fn(),
      $disconnect: jest.fn(),
    },
  };
});

import request from 'supertest';
import { Prisma } from '@prisma/client';
import app from '../app';
import { dbArticleToDTO, transformApiArticle, withVideoFields } from '../services/wordpressService';
import { prisma } from '../config/db';
import { resetBackgroundSyncThrottle } from '../utils/backgroundSync';

const db = prisma as any;

function resetDb() {
  for (const name of ['article', 'author', 'presenter']) {
    const m = db[name];
    m.findUnique.mockReset().mockResolvedValue(null);
    m.findFirst.mockReset().mockResolvedValue(null);
    m.findMany.mockReset().mockResolvedValue([]);
    m.count.mockReset().mockResolvedValue(0);
    m.create.mockReset().mockResolvedValue({});
    m.update.mockReset().mockResolvedValue({});
    m.updateMany.mockReset().mockResolvedValue({ count: 0 });
    m.upsert.mockReset().mockResolvedValue({});
    m.deleteMany.mockReset().mockResolvedValue({ count: 0 });
  }
  db.$queryRaw.mockReset().mockResolvedValue([]);
}

/** Lets setImmediate background re-syncs run. */
const flushBackground = () => new Promise((resolve) => setTimeout(resolve, 20));

const BASE = 'https://capitalfm.africa/wp-json/capitalfm/v1';

function youtube(id: string, isShort = false) {
  return {
    provider: 'youtube',
    id,
    url: `https://youtu.be/${id}?si=abc`,
    watch_url: `https://www.youtube.com/watch?v=${id}`,
    embed_url: `https://www.youtube.com/embed/${id}`,
    thumbnail: {
      default: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      medium: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
      max: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
    },
    is_short: isShort,
  };
}

function rawArticle(id: number, video: any = null, extra: Record<string, unknown> = {}) {
  return {
    id,
    slug: `story-${id}`,
    title: `Story ${id}`,
    excerpt: 'Excerpt',
    published: '2026-11-05T09:12:00+03:00',
    primary_category: { slug: 'news' },
    author: { id: 1, name: 'Jane Writer', slug: 'jane-writer' },
    video,
    ...extra,
  };
}

function storedRow(id: number, video: any, content = 'Excerpt') {
  return {
    id,
    slug: `story-${id}`,
    title: `Story ${id}`,
    excerpt: 'Excerpt',
    content,
    categorySlug: 'news',
    author: 'Jane Writer',
    authors: null,
    authorIds: [],
    authorSlugs: [],
    coverImageUrl: null,
    video,
    publishedAt: new Date(`2026-11-0${Math.min(9, id)}T06:00:00Z`),
  };
}

const FULL_BODY = `<p>${'A long story body. '.repeat(10)}</p>`;

type Stub = { status?: number; body: any; headers?: Record<string, string> };

let routes: Record<string, Stub> = {};
const fetchMock = jest.fn(async (input: any) => {
  const url = String(input);
  const key = Object.keys(routes)
    .sort((a, b) => b.length - a.length)
    .find((k) => url.startsWith(`${BASE}${k}`));
  if (!key) throw new Error(`unexpected fetch ${url}`);
  const stub = routes[key];
  return new Response(JSON.stringify(stub.body), {
    status: stub.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(stub.headers || {}) },
  });
});

const realFetch = global.fetch;

beforeAll(() => {
  global.fetch = fetchMock as any;
});
afterAll(() => {
  global.fetch = realFetch;
});
beforeEach(() => {
  routes = {};
  fetchMock.mockClear();
  resetDb();
  resetBackgroundSyncThrottle();
});

describe('Article video fields', () => {
  it('carries the upstream video object and sets isVideo true when the story has a video', () => {
    const article = transformApiArticle(rawArticle(1, youtube('U9x-X1Un5sw', true)));

    expect(article.video).toEqual(youtube('U9x-X1Un5sw', true));
    expect(article.isVideo).toBe(true);
  });

  it('sets video null and isVideo false when the story has no video', () => {
    expect(transformApiArticle(rawArticle(2, null))).toMatchObject({ video: null, isVideo: false });

    const legacy: any = rawArticle(3);
    delete legacy.video;
    expect(transformApiArticle(legacy)).toMatchObject({ video: null, isVideo: false });
  });

  it('restores video and isVideo from a stored Postgres row', () => {
    expect(dbArticleToDTO(storedRow(4, youtube('abc')) as any)).toMatchObject({
      video: youtube('abc'),
      isVideo: true,
    });
    expect(dbArticleToDTO(storedRow(5, null) as any)).toMatchObject({
      video: null,
      isVideo: false,
    });
  });

  it('withVideoFields upgrades payloads cached before the fields existed', () => {
    expect(withVideoFields({ id: 6 })).toEqual({ id: 6, video: null, isVideo: false });
    expect(withVideoFields({ id: 7, video: youtube('xyz') })).toMatchObject({ isVideo: true });
  });

  it('stores the video in Postgres, and clears it when the story has none', async () => {
    routes['/articles?'] = {
      body: { meta: { total: 2 }, data: [rawArticle(1, youtube('vid1')), rawArticle(2, null)] },
    };

    await request(app).get('/api/v1/news?limit=2');

    const created = db.article.create.mock.calls.map((c: any[]) => c[0].data);
    expect(created.find((d: any) => d.id === 1).video).toEqual(youtube('vid1'));
    expect(created.find((d: any) => d.id === 2).video).toBe(Prisma.DbNull);
  });
});

/** A listed story as the website sends it, with the optional fields the gateway maps. */
function listedArticle(id: number, video: any) {
  return rawArticle(id, video, {
    image: { url: `https://capitalfm.africa/story-${id}.jpg` },
    views: { total: 10, last_7_days: 4 },
    word_count: 420,
    reading_time_minutes: 2,
    share: { whatsapp: `https://wa.me/?text=story-${id}` },
  });
}

/**
 * The news listing item fields the gateway returned before videos (see MOBILE_APP_INTEGRATION_GUIDE
 * section 1.2) for listedArticle(): listings may only gain `isVideo`, never `video` or other fields.
 */
const PRE_VIDEO_LISTING_KEYS = [
  'id',
  'slug',
  'title',
  'excerpt',
  'content',
  'categorySlug',
  'author',
  'authorDetails',
  'authors',
  'coverImageUrl',
  'publishedAt',
  'publishedAtTimestamp',
  'views',
  'wordCount',
  'readingTimeMinutes',
  'share',
];

function expectListing(items: any[], expectedIsVideo: boolean[]) {
  expect(items.map((a) => a.isVideo)).toEqual(expectedIsVideo);
  for (const item of items) {
    expect(Object.keys(item).sort()).toEqual([...PRE_VIDEO_LISTING_KEYS, 'isVideo'].sort());
  }
}

describe('News listings keep their payload and only add isVideo', () => {
  it('GET /api/v1/news', async () => {
    routes['/articles?'] = {
      body: {
        meta: { total: 2 },
        data: [listedArticle(1, youtube('vid1')), listedArticle(2, null)],
      },
    };

    const res = await request(app).get('/api/v1/news?limit=2');

    expect(res.status).toBe(200);
    expectListing(res.body.data.articles, [true, false]);
    expect(res.body.data.articles[0]).toMatchObject({
      id: 1,
      coverImageUrl: 'https://capitalfm.africa/story-1.jpg',
      views: { total: 10, last_7_days: 4 },
      wordCount: 420,
      readingTimeMinutes: 2,
    });
    expect(Object.keys(res.body.data).sort()).toEqual(['articles', 'limit', 'page', 'total']);
  });

  it('GET /api/v1/news served from Postgres', async () => {
    db.article.findMany.mockResolvedValue([storedRow(1, youtube('vid1')), storedRow(2, null)]);
    db.article.count.mockResolvedValue(2);
    routes['/articles?'] = { body: { meta: { total: 0 }, data: [] } };

    const res = await request(app).get('/api/v1/news?limit=2');

    expect(res.body.data.articles.map((a: any) => a.isVideo)).toEqual([true, false]);
    expect(res.body.data.articles.some((a: any) => 'video' in a)).toBe(false);
    await flushBackground();
  });

  it('GET /api/v1/news/trending', async () => {
    routes['/articles/trending'] = {
      body: { data: [listedArticle(1, youtube('vid1')), listedArticle(2, null)] },
    };

    const res = await request(app).get('/api/v1/news/trending');

    expectListing(res.body.data.articles, [true, false]);
  });

  it('GET /api/v1/authors/:idOrSlug/articles and legacy /news/author/:idOrSlug', async () => {
    routes['/authors/jane-writer/articles'] = {
      body: {
        meta: { total: 2, total_pages: 1 },
        data: [listedArticle(1, youtube('vid1')), listedArticle(2, null)],
      },
    };

    const res = await request(app).get('/api/v1/authors/jane-writer/articles');
    const legacy = await request(app).get('/api/v1/news/author/jane-writer');

    expectListing(res.body.data.articles, [true, false]);
    expectListing(legacy.body.data.articles, [true, false]);
  });

  it('GET /api/v1/search', async () => {
    routes['/articles?'] = {
      body: { meta: { total: 1 }, data: [listedArticle(1, youtube('vid1'))] },
    };

    const res = await request(app).get('/api/v1/search?q=story&type=news');

    expect(res.status).toBe(200);
    expectListing(res.body.data.news.articles, [true]);
  });
});

describe('Single article carries video and isVideo', () => {
  it('GET /api/v1/news/:idOrSlug', async () => {
    routes['/articles/story-1'] = {
      body: { data: rawArticle(1, youtube('vid1'), { content: { html: FULL_BODY } }) },
    };
    routes['/articles/story-2'] = {
      body: { data: rawArticle(2, null, { content: { html: FULL_BODY } }) },
    };

    const withVideo = await request(app).get('/api/v1/news/story-1');
    const without = await request(app).get('/api/v1/news/story-2');

    expect(withVideo.body.data).toMatchObject({ isVideo: true, video: youtube('vid1') });
    expect(without.body.data).toMatchObject({ isVideo: false, video: null });
  });
});

describe('GET /api/v1/videos', () => {
  it('forwards filters and pagination and returns video items with alsoIn', async () => {
    const alsoIn = [
      {
        id: 7,
        slug: 'story-7',
        title: 'Story 7',
        url: 'https://capitalfm.africa/story-7/',
        api_url: `${BASE}/articles/story-7`,
      },
    ];
    routes['/videos?'] = {
      body: {
        meta: { total: 12, total_pages: 6 },
        data: [
          rawArticle(9, youtube('vid9', true), { also_in: alsoIn }),
          rawArticle(8, youtube('vid8', true), { also_in: [] }),
        ],
      },
    };

    const res = await request(app).get(
      '/api/v1/videos?section=business&search=tax&shorts=true&page=2&limit=2',
    );

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data).toMatchObject({ total: 12, page: 2, limit: 2 });
    expect(res.body.data.articles[0]).toMatchObject({
      id: 9,
      isVideo: true,
      video: { id: 'vid9', is_short: true },
      alsoIn,
    });
    expect(res.body.data.articles[1].alsoIn).toEqual([]);

    const calledUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(calledUrl.pathname.endsWith('/videos')).toBe(true);
    expect(calledUrl.searchParams.get('section')).toBe('business');
    expect(calledUrl.searchParams.get('search')).toBe('tax');
    expect(calledUrl.searchParams.get('shorts')).toBe('true');
    expect(calledUrl.searchParams.get('page')).toBe('2');
    expect(calledUrl.searchParams.get('per_page')).toBe('2');
    expect(calledUrl.searchParams.get('fields')).toBe('summary');
    expect(db.article.create).toHaveBeenCalledTimes(2);
  });

  it('caps per_page at 50, accepts per_page, fields=full and shorts=false, and drops an unknown shorts value', async () => {
    routes['/videos?'] = { body: { meta: { total: 0 }, data: [] } };

    await request(app).get('/api/v1/videos?per_page=500&fields=full&shorts=false');
    await request(app).get('/api/v1/videos?shorts=maybe');

    const first = new URL(String(fetchMock.mock.calls[0][0]));
    expect(first.searchParams.get('per_page')).toBe('50');
    expect(first.searchParams.get('fields')).toBe('full');
    expect(first.searchParams.get('shorts')).toBe('false');
    const second = new URL(String(fetchMock.mock.calls[1][0]));
    expect(second.searchParams.has('shorts')).toBe(false);
  });

  it('serves stored video stories from Postgres, one entry per video, when the website is down', async () => {
    routes['/videos?'] = { status: 500, body: {} };
    db.$queryRaw.mockResolvedValue([
      storedRow(9, youtube('shared')),
      storedRow(8, youtube('solo')),
      storedRow(7, youtube('shared')),
    ]);

    const res = await request(app).get('/api/v1/videos');

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(2);
    expect(res.body.data.articles.map((a: any) => a.id)).toEqual([9, 8]);
    expect(res.body.data.articles[0].alsoIn).toEqual([
      { id: 7, slug: 'story-7', title: 'Story 7' },
    ]);
    expect(res.body.data.articles.every((a: any) => a.isVideo)).toBe(true);
    await flushBackground();
  });

  it('returns an empty list when the website is down and nothing is stored', async () => {
    routes['/videos?'] = { status: 500, body: {} };

    const res = await request(app).get('/api/v1/videos');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ articles: [], total: 0, page: 1, limit: 10 });
  });
});

describe('GET /api/v1/videos/:idOrSlug', () => {
  it('fetches the video story with full content from the website and stores it', async () => {
    const alsoIn = [{ id: 7, slug: 'story-7', title: 'Story 7' }];
    routes['/videos/U9x-X1Un5sw'] = {
      body: {
        meta: {},
        data: rawArticle(9, youtube('U9x-X1Un5sw'), {
          content: { html: FULL_BODY },
          also_in: alsoIn,
        }),
      },
    };

    const res = await request(app).get('/api/v1/videos/U9x-X1Un5sw');

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: 9,
      isVideo: true,
      video: { id: 'U9x-X1Un5sw' },
      alsoIn,
      content: FULL_BODY,
    });
    expect(db.article.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ id: 9 }) }),
    );
  });

  it('returns 404 when upstream reports cfm_video_not_found', async () => {
    routes['/videos/nope'] = { status: 404, body: { code: 'cfm_video_not_found' } };

    const res = await request(app).get('/api/v1/videos/nope');

    expect(res.status).toBe(404);
    expect(res.body.status).toBe('fail');
  });

  it('surfaces upstream outages as 502 when nothing is stored', async () => {
    routes['/videos/vid1'] = { status: 500, body: {} };

    const res = await request(app).get('/api/v1/videos/vid1');

    expect(res.status).toBe(502);
  });

  it('answers from Postgres when the stored story has its full body, then re-syncs in the background', async () => {
    db.article.findMany
      .mockResolvedValueOnce([storedRow(9, youtube('vid1'), FULL_BODY)])
      .mockResolvedValueOnce([
        { id: 7, slug: 'story-7', title: 'Story 7', video: youtube('vid1') },
      ]);
    routes['/videos/vid1'] = {
      body: { data: rawArticle(9, youtube('vid1'), { content: { html: FULL_BODY } }) },
    };

    const res = await request(app).get('/api/v1/videos/vid1');

    expect(res.status).toBe(200);
    // alsoIn comes from the stored stories: the website stub carries none.
    expect(res.body.data).toMatchObject({
      id: 9,
      isVideo: true,
      alsoIn: [{ id: 7, slug: 'story-7', title: 'Story 7' }],
    });

    await flushBackground();
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([`${BASE}/videos/vid1`]);
  });

  it('clears the stored video when the background re-sync finds the website no longer has it', async () => {
    db.article.findMany.mockResolvedValue([storedRow(9, youtube('vid1'), FULL_BODY)]);
    routes['/videos/story-9'] = { status: 404, body: { code: 'cfm_video_not_found' } };

    await request(app).get('/api/v1/videos/story-9');
    await flushBackground();

    expect(db.article.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [9] } },
      data: { video: Prisma.DbNull },
    });
  });

  it('serves a stored summary when the website is down', async () => {
    db.article.findMany.mockResolvedValueOnce([storedRow(9, youtube('vid1'))]);
    routes['/videos/9'] = { status: 500, body: {} };

    const res = await request(app).get('/api/v1/videos/9');

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: 9, isVideo: true });
    expect(db.article.findMany.mock.calls[0][0].where.AND[1]).toEqual({ id: 9 });
  });
});

/** A video the gateway found in a story body, as it is stored and served. */
function detectedVideo(id: string, url = `https://youtu.be/${id}`) {
  return { ...youtube(id), url, source: 'detected' };
}

const EMBED_BODY = (id: string) =>
  `${FULL_BODY}<figure class="wp-block-embed is-provider-youtube"><div class="wp-block-embed__wrapper"><iframe src="https://www.youtube.com/embed/${id}?feature=oembed"></iframe></div></figure>`;

describe('Videos detected in the story body', () => {
  it('fills video/isVideo on a full article whose website video is null, and stores it', async () => {
    routes['/articles/story-1'] = {
      body: {
        data: rawArticle(1, null, {
          content: { html: `${FULL_BODY}<p>https://youtu.be/det1aaaaaaa</p>` },
        }),
      },
    };

    const res = await request(app).get('/api/v1/news/story-1');

    expect(res.body.data).toMatchObject({ isVideo: true, video: detectedVideo('det1aaaaaaa') });
    expect(db.article.create.mock.calls[0][0].data.video).toEqual(detectedVideo('det1aaaaaaa'));
  });

  it('keeps the website video when the body embeds a different one', () => {
    const article = transformApiArticle(
      rawArticle(1, youtube('upstreamAAA'), { content: { html: EMBED_BODY('bodyvidBBBB') } }),
    );

    expect(article.video).toEqual(youtube('upstreamAAA'));
    expect(article.video).not.toHaveProperty('source');
  });

  it('replaces a stored detected video with the website video once the editor fills the YouTube box', async () => {
    db.article.findUnique.mockResolvedValue(
      storedRow(1, detectedVideo('bodyvidBBBB'), EMBED_BODY('bodyvidBBBB')),
    );
    routes['/articles?'] = {
      body: { meta: { total: 1 }, data: [listedArticle(1, youtube('upstreamAAA'))] },
    };

    await request(app).get('/api/v1/news?limit=1');

    expect(db.article.update.mock.calls[0][0].data.video).toEqual(youtube('upstreamAAA'));
  });

  it('does not detect from text links or channel links in the body', () => {
    const html = `${FULL_BODY}<p>Watch <a href="https://youtu.be/det1aaaaaaa">the interview</a>.</p><p>https://www.youtube.com/@CapitalFMKenya</p>`;
    expect(transformApiArticle(rawArticle(1, null, { content: { html } }))).toMatchObject({
      video: null,
      isVideo: false,
    });
  });

  it('clears a stored detected video when the full body no longer embeds it', async () => {
    db.article.findUnique.mockResolvedValue(storedRow(1, detectedVideo('det1aaaaaaa'), FULL_BODY));
    routes['/articles/story-1'] = {
      body: { data: rawArticle(1, null, { content: { html: FULL_BODY } }) },
    };

    const res = await request(app).get('/api/v1/news/story-1');

    expect(res.body.data).toMatchObject({ isVideo: false, video: null });
    expect(db.article.update.mock.calls[0][0].data.video).toBe(Prisma.DbNull);
  });

  it('a listing from the website (no body) keeps the stored detected video and reports isVideo', async () => {
    db.article.findUnique.mockImplementation(async ({ where }: any) =>
      where.id === 1 ? storedRow(1, detectedVideo('det1aaaaaaa'), EMBED_BODY('det1aaaaaaa')) : null,
    );
    routes['/articles?'] = {
      body: { meta: { total: 2 }, data: [listedArticle(1, null), listedArticle(2, null)] },
    };

    const res = await request(app).get('/api/v1/news?limit=2');

    expectListing(res.body.data.articles, [true, false]);
    expect(db.article.update.mock.calls[0][0].data.video).toEqual(detectedVideo('det1aaaaaaa'));
    expect(db.article.create.mock.calls[0][0].data.video).toBe(Prisma.DbNull);
  });

  it('a listing still clears a stored website video the website has removed', async () => {
    db.article.findUnique.mockResolvedValue(storedRow(1, youtube('upstreamAAA')));
    routes['/articles?'] = { body: { meta: { total: 1 }, data: [listedArticle(1, null)] } };

    const res = await request(app).get('/api/v1/news?limit=1');

    expectListing(res.body.data.articles, [false]);
    expect(db.article.update.mock.calls[0][0].data.video).toBe(Prisma.DbNull);
  });

  it('a listing served from Postgres reads the stored detected flag', async () => {
    db.article.findMany.mockResolvedValue([
      storedRow(1, detectedVideo('det1aaaaaaa')),
      storedRow(2, null),
    ]);
    db.article.count.mockResolvedValue(2);
    routes['/articles?'] = { body: { meta: { total: 0 }, data: [] } };

    const res = await request(app).get('/api/v1/news?limit=2');

    expect(res.body.data.articles.map((a: any) => a.isVideo)).toEqual([true, false]);
    expect(res.body.data.articles.some((a: any) => 'video' in a)).toBe(false);
    await flushBackground();
  });

  it('trending and author listings read the stored detected flag', async () => {
    db.article.findMany.mockResolvedValue([{ id: 1, video: detectedVideo('det1aaaaaaa') }]);
    db.article.findUnique.mockImplementation(async ({ where }: any) =>
      where.id === 1 ? storedRow(1, detectedVideo('det1aaaaaaa'), EMBED_BODY('det1aaaaaaa')) : null,
    );
    routes['/articles/trending'] = {
      body: { data: [listedArticle(1, null), listedArticle(2, null)] },
    };
    routes['/authors/jane-writer/articles'] = {
      body: {
        meta: { total: 2, total_pages: 1 },
        data: [listedArticle(1, null), listedArticle(2, null)],
      },
    };

    const trending = await request(app).get('/api/v1/news/trending');
    const byAuthor = await request(app).get('/api/v1/authors/jane-writer/articles');

    expectListing(trending.body.data.articles, [true, false]);
    expectListing(byAuthor.body.data.articles, [true, false]);
  });

  it('are not served or cleared by /videos/:idOrSlug', async () => {
    db.article.findMany.mockResolvedValue([storedRow(1, detectedVideo('det1aaaaaaa'), FULL_BODY)]);
    routes['/videos/story-1'] = { status: 404, body: { code: 'cfm_video_not_found' } };

    const res = await request(app).get('/api/v1/videos/story-1');
    await flushBackground();

    expect(res.status).toBe(404);
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([`${BASE}/videos/story-1`]);
    expect(db.article.updateMany).not.toHaveBeenCalled();
  });
});
