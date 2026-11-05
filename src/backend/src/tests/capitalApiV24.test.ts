/**
 * Capital FM Public API v2.4.0 gateway coverage: Authors, article bylines (authors[]),
 * presenter profiles and the /live YouTube block. Upstream is stubbed via global fetch,
 * and Redis/Postgres are stubbed so the tests are hermetic.
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
    upsert: jest.fn(),
    deleteMany: jest.fn(),
  });
  return { prisma: { article: model(), author: model(), presenter: model(), $disconnect: jest.fn() } };
});

import request from 'supertest';
import app from '../app';
import { transformApiArticle } from '../services/wordpressService';
import { normalizeLiveState } from '../services/scheduleService';
import { prisma } from '../config/db';
import { resetBackgroundSyncThrottle } from '../utils/backgroundSync';

const db = prisma as any;

/** Default: Postgres is empty, so requests fall through to the (stubbed) website. */
function resetDb() {
  for (const name of ['article', 'author', 'presenter']) {
    const m = db[name];
    m.findUnique.mockReset().mockResolvedValue(null);
    m.findFirst.mockReset().mockResolvedValue(null);
    m.findMany.mockReset().mockResolvedValue([]);
    m.count.mockReset().mockResolvedValue(0);
    m.create.mockReset().mockResolvedValue({});
    m.update.mockReset().mockResolvedValue({});
    m.upsert.mockReset().mockResolvedValue({});
    m.deleteMany.mockReset().mockResolvedValue({ count: 0 });
  }
}

/** Lets setImmediate background re-syncs run. */
const flushBackground = () => new Promise((resolve) => setTimeout(resolve, 20));

const BASE = 'https://capitalfm.africa/wp-json/capitalfm/v1';

const mainAuthor = {
  id: 13671,
  name: 'Jane Writer',
  slug: 'jane-writer',
  bio: 'Senior reporter',
  image: 'https://capitalfm.africa/jane.jpg',
  url: 'https://capitalfm.africa/author/jane-writer/',
  api_url: `${BASE}/authors/13671`,
  presenter: null,
};
const coAuthor = {
  id: 42,
  name: 'Anne Mwaura',
  slug: 'anne-mwaura',
  bio: null,
  image: 'https://capitalfm.africa/anne.jpg',
  url: 'https://capitalfm.africa/author/anne-mwaura/',
  api_url: `${BASE}/authors/42`,
  presenter: { id: 1471508, slug: 'anne-mwaura', name: 'Anne Mwaura', api_url: `${BASE}/presenters/anne-mwaura` },
};

function rawArticle(id: number, authors: any[] = [mainAuthor, coAuthor]) {
  return {
    id,
    slug: `story-${id}`,
    title: `Story ${id}`,
    excerpt: 'Excerpt',
    published: '2026-11-05T09:12:00+03:00',
    primary_category: { slug: 'news' },
    author: authors[0],
    authors,
  };
}

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

describe('Authors (v2.4.0)', () => {
  it('GET /api/v1/authors fetches the website when Postgres is empty, forwarding params and pagination', async () => {
    routes['/authors?'] = {
      body: { meta: { total: 120, total_pages: 6 }, data: [{ id: 13671, name: 'Jane Writer', story_count: 1840 }] },
      headers: { 'X-WP-Total': '120', 'X-WP-TotalPages': '6' },
    };

    const res = await request(app).get('/api/v1/authors?search=jane&orderby=name&page=2&per_page=20');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data[0]).toMatchObject({ id: 13671, story_count: 1840 });
    expect(res.body.meta).toEqual({ total: 120, total_pages: 6, page: 2, per_page: 20 });

    const calledUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(calledUrl.pathname.endsWith('/authors')).toBe(true);
    expect(calledUrl.searchParams.get('search')).toBe('jane');
    expect(calledUrl.searchParams.get('orderby')).toBe('name');
    expect(calledUrl.searchParams.get('page')).toBe('2');
    expect(calledUrl.searchParams.get('per_page')).toBe('20');
  });

  it('caps per_page at the upstream maximum of 100 and replaces unknown orderby values with the default', async () => {
    routes['/authors?'] = { body: { meta: { total: 0, total_pages: 0 }, data: [] } };

    await request(app).get('/api/v1/authors?per_page=500&orderby=evil');

    const calledUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(calledUrl.searchParams.get('per_page')).toBe('100');
    expect(calledUrl.searchParams.get('orderby')).toBe('stories');
  });

  it('GET /api/v1/authors/:idOrSlug returns the full profile', async () => {
    routes['/authors/jane-writer'] = { body: { meta: {}, data: { ...mainAuthor, website: null, story_count: 1840 } } };

    const res = await request(app).get('/api/v1/authors/jane-writer');

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: 13671, slug: 'jane-writer', website: null, story_count: 1840 });
  });

  it('GET /api/v1/authors/:idOrSlug returns 404 when upstream reports cfm_author_not_found', async () => {
    routes['/authors/999'] = { status: 404, body: { code: 'cfm_author_not_found' } };

    const res = await request(app).get('/api/v1/authors/999');

    expect(res.status).toBe(404);
    expect(res.body.status).toBe('fail');
  });

  it('GET /api/v1/authors/:idOrSlug surfaces upstream outages as 502', async () => {
    routes['/authors/13671'] = { status: 500, body: {} };

    const res = await request(app).get('/api/v1/authors/13671');

    expect(res.status).toBe(502);
  });

  it('GET /api/v1/authors/:idOrSlug/articles maps articles, includes co-written stories and carries meta.author', async () => {
    routes['/authors/42/articles'] = {
      body: {
        meta: { total: 3, total_pages: 2, author: coAuthor },
        // Story 1 is co-written (Anne is second author), story 2 is Anne's own.
        data: [rawArticle(1, [mainAuthor, coAuthor]), rawArticle(2, [coAuthor])],
      },
    };

    const res = await request(app).get('/api/v1/authors/42/articles?page=1&per_page=2');

    expect(res.status).toBe(200);
    expect(res.body.data.author).toMatchObject({ id: 42, slug: 'anne-mwaura' });
    expect(res.body.data.articles).toHaveLength(2);
    expect(res.body.data.articles[0].authors.map((a: any) => a.slug)).toEqual(['jane-writer', 'anne-mwaura']);
    expect(res.body.meta).toEqual({ total: 3, total_pages: 2, page: 1, per_page: 2 });

    const calledUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(calledUrl.searchParams.get('per_page')).toBe('2');
    expect(calledUrl.searchParams.get('fields')).toBe('summary');
  });

  it('legacy GET /api/v1/news/author/:idOrSlug now uses the co-author-aware upstream and keeps its shape', async () => {
    routes['/authors/anne-mwaura/articles'] = {
      body: { meta: { total: 1, total_pages: 1, author: coAuthor }, data: [rawArticle(1, [mainAuthor, coAuthor])] },
    };

    const res = await request(app).get('/api/v1/news/author/anne-mwaura?limit=5');

    expect(res.status).toBe(200);
    expect(res.body.data.author).toMatchObject({ id: 42, name: 'Anne Mwaura', avatarUrl: 'https://capitalfm.africa/anne.jpg' });
    expect(res.body.data).toMatchObject({ total: 1, page: 1, limit: 5 });
    expect(res.body.data.articles[0].id).toBe(1);
  });
});

describe('Article bylines (authors[])', () => {
  it('maps every author, main first, with api_url and presenter link', () => {
    const article = transformApiArticle(rawArticle(7));

    expect(article.author).toBe('Jane Writer');
    expect(article.authors).toHaveLength(2);
    expect(article.authors?.[0]).toMatchObject({
      id: 13671,
      name: 'Jane Writer',
      avatarUrl: 'https://capitalfm.africa/jane.jpg',
      archiveUrl: 'https://capitalfm.africa/author/jane-writer/',
      apiUrl: `${BASE}/authors/13671`,
    });
    expect(article.authors?.[1].presenter).toMatchObject({ slug: 'anne-mwaura' });
    expect(article.authorDetails?.apiUrl).toBe(`${BASE}/authors/13671`);
  });

  it('falls back to the main author when the upstream has no authors[]', () => {
    const raw: any = rawArticle(8);
    delete raw.authors;

    const article = transformApiArticle(raw);

    expect(article.authors).toHaveLength(1);
    expect(article.authors?.[0].name).toBe('Jane Writer');
  });

  it('is stable when re-mapping an already-mapped article', () => {
    const once = transformApiArticle(rawArticle(9));
    const twice = transformApiArticle(JSON.parse(JSON.stringify(once)));

    expect(twice.authors).toEqual(once.authors);
  });
});

describe('Presenters (full profile by slug)', () => {
  it('GET /api/v1/presenters/:slug returns the full upstream profile', async () => {
    const profile = {
      id: 1471508,
      slug: 'anne-mwaura',
      name: 'Anne Mwaura',
      bio: { html: '<p>Host</p>', text: 'Host' },
      shows: [{ show: 'The Fuse' }],
      articles: [{ id: 1 }],
      socials: { x: null },
    };
    routes['/presenters/anne-mwaura'] = { body: { meta: {}, data: profile } };

    const res = await request(app).get('/api/v1/presenters/anne-mwaura');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(profile);
  });

  it('GET /api/v1/presenters/:slug returns 404 for an unknown presenter', async () => {
    routes['/presenters/nobody'] = { status: 404, body: { code: 'cfm_presenter_not_found' } };

    const res = await request(app).get('/api/v1/presenters/nobody');

    expect(res.status).toBe(404);
  });
});

describe('Postgres-first reads with background re-sync', () => {
  const storedArticleRow = {
    id: 1,
    slug: 'story-1',
    title: 'Story 1',
    excerpt: 'Excerpt',
    content: 'Body',
    categorySlug: 'news',
    author: 'Jane Writer',
    authors: [
      { id: 13671, name: 'Jane Writer', slug: 'jane-writer' },
      { id: 42, name: 'Anne Mwaura', slug: 'anne-mwaura' },
    ],
    authorIds: [13671, 42],
    authorSlugs: ['jane-writer', 'anne-mwaura'],
    coverImageUrl: null,
    publishedAt: new Date('2026-11-05T06:12:00Z'),
  };

  it('answers /authors from the website until a full directory sync completes, then from Postgres', async () => {
    // Postgres holds one author stored by a profile lookup: that is not the directory.
    db.author.findMany.mockResolvedValue([{ id: 42, profile: { id: 42, name: 'Anne Mwaura' } }]);
    db.author.count.mockResolvedValue(1);
    routes['/authors?'] = {
      body: { meta: { total: 2, total_pages: 1 }, data: [{ id: 13671, slug: 'jane-writer', name: 'Jane Writer' }, { id: 42, slug: 'anne-mwaura', name: 'Anne Mwaura' }] },
    };

    const first = await request(app).get('/api/v1/authors');

    expect(first.status).toBe(200);
    expect(first.body.data.map((a: any) => a.id)).toEqual([13671, 42]);
    expect(first.body.meta).toEqual({ total: 2, total_pages: 1, page: 1, per_page: 20 });

    await flushBackground();
    const synced = new URL(String(fetchMock.mock.calls[1][0]));
    expect(synced.searchParams.get('per_page')).toBe('100');
    expect(db.author.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 13671 } }));

    db.author.findMany.mockResolvedValue([
      { id: 13671, profile: { id: 13671, name: 'Jane Writer' } },
      { id: 42, profile: { id: 42, name: 'Anne Mwaura' } },
    ]);
    db.author.count.mockResolvedValue(2);
    fetchMock.mockClear();

    const second = await request(app).get('/api/v1/authors');

    expect(second.status).toBe(200);
    expect(second.body.data.map((a: any) => a.id)).toEqual([13671, 42]);
    expect(second.body.meta).toEqual({ total: 2, total_pages: 1, page: 1, per_page: 20 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not mark the directory synced when the background sync fails part-way', async () => {
    db.author.findMany.mockResolvedValue([{ id: 42, profile: { id: 42, name: 'Anne Mwaura' } }]);
    db.author.count.mockResolvedValue(1);
    routes['/authors?page=1&per_page=20'] = { body: { meta: { total: 300, total_pages: 15 }, data: [{ id: 13671, slug: 'jane-writer', name: 'Jane Writer' }] } };
    routes['/authors?page=1&per_page=100'] = { body: { meta: { total: 300, total_pages: 3 }, data: [{ id: 13671, slug: 'jane-writer' }] } };
    routes['/authors?page=2&per_page=100'] = { status: 503, body: {} };

    await request(app).get('/api/v1/authors');
    await flushBackground();
    resetDb();
    db.author.findMany.mockResolvedValue([{ id: 42, profile: { id: 42, name: 'Anne Mwaura' } }]);
    db.author.count.mockResolvedValue(1);
    fetchMock.mockClear();

    const res = await request(app).get('/api/v1/authors');

    expect(res.body.meta.total).toBe(300);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('keeps serving /authors from Postgres while the website is down', async () => {
    db.author.findMany.mockResolvedValue([{ id: 13671, profile: { id: 13671, name: 'Jane Writer' } }]);
    db.author.count.mockResolvedValue(1);
    routes['/authors?'] = { status: 503, body: {} };

    const res = await request(app).get('/api/v1/authors');
    await flushBackground();

    expect(res.status).toBe(200);
    expect(res.body.data[0].name).toBe('Jane Writer');
  });

  it('serves a stored full author profile from Postgres', async () => {
    db.author.findUnique.mockResolvedValue({ id: 42, slug: 'anne-mwaura', isFull: true, profile: { ...coAuthor, website: null } });
    routes['/authors/anne-mwaura'] = { status: 503, body: {} };

    const res = await request(app).get('/api/v1/authors/anne-mwaura');

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: 42, slug: 'anne-mwaura', website: null });
    expect(db.author.findUnique).toHaveBeenCalledWith({ where: { slug: 'anne-mwaura' } });
  });

  it('falls back to a stored partial author profile when the website is down', async () => {
    db.author.findUnique.mockResolvedValue({ id: 42, slug: 'anne-mwaura', isFull: false, profile: { id: 42, name: 'Anne Mwaura' } });
    routes['/authors/42'] = { status: 500, body: {} };

    const res = await request(app).get('/api/v1/authors/42');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: 42, name: 'Anne Mwaura' });
    expect(db.author.findUnique).toHaveBeenCalledWith({ where: { id: 42 } });
  });

  it('lists co-written stories for an author from Postgres, restoring the byline', async () => {
    db.author.findUnique.mockResolvedValue({ id: 42, slug: 'anne-mwaura', storyCount: 25, profile: coAuthor });
    db.article.findMany.mockResolvedValue([storedArticleRow]);
    db.article.count.mockResolvedValue(1);
    routes['/authors/anne-mwaura/articles'] = { status: 503, body: {} };

    const res = await request(app).get('/api/v1/authors/anne-mwaura/articles?per_page=10');

    expect(res.status).toBe(200);
    expect(db.article.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ authorIds: { has: 42 } }, { authorSlugs: { has: 'anne-mwaura' } }] },
        orderBy: { publishedAt: 'desc' },
      }),
    );
    expect(res.body.data.author).toMatchObject({ id: 42 });
    expect(res.body.data.articles[0].authors.map((a: any) => a.slug)).toEqual(['jane-writer', 'anne-mwaura']);
    // The website's story count keeps paging going past what Postgres holds.
    expect(res.body.meta).toEqual({ total: 25, total_pages: 3, page: 1, per_page: 10 });
  });

  it('stores bylines in Postgres when author stories come from the website', async () => {
    routes['/authors/42/articles'] = {
      body: { meta: { total: 1, total_pages: 1, author: coAuthor }, data: [rawArticle(1, [mainAuthor, coAuthor])] },
    };

    const res = await request(app).get('/api/v1/authors/42/articles');

    expect(res.status).toBe(200);
    expect(db.article.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ id: 1, authorIds: [13671, 42], authorSlugs: ['jane-writer', 'anne-mwaura'] }),
    });
    expect(db.author.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 42 }, create: expect.objectContaining({ isFull: true }) }),
    );
  });

  it('serves a stored full presenter profile from Postgres and re-syncs it in the background', async () => {
    const profile = { id: 1471508, slug: 'anne-mwaura', name: 'Anne Mwaura', bio: { html: '<p>Host</p>', text: 'Host' }, shows: [] };
    db.presenter.findUnique.mockResolvedValue({ id: 1471508, slug: 'anne-mwaura', isFull: true, profile });
    routes['/presenters/anne-mwaura'] = { body: { meta: {}, data: { ...profile, name: 'Anne M.' } } };

    const res = await request(app).get('/api/v1/presenters/anne-mwaura');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(profile);

    await flushBackground();
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/presenters/anne-mwaura`, expect.anything());
    expect(db.presenter.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1471508 }, update: expect.objectContaining({ name: 'Anne M.', isFull: true }) }),
    );
  });

  it('answers /presenters from the website while Postgres holds only presenters seeded by profile lookups', async () => {
    db.presenter.findMany.mockResolvedValue([{ id: 1471508, isFull: true, profile: { id: 1471508, slug: 'anne-mwaura' } }]);
    db.presenter.count.mockResolvedValue(1);
    routes['/presenters?'] = {
      body: { meta: { total: 2, total_pages: 1 }, data: [{ id: 1, slug: 'adnan', name: 'Adnan' }, { id: 1471508, slug: 'anne-mwaura', name: 'Anne Mwaura' }] },
    };

    const res = await request(app).get('/api/v1/presenters');

    expect(res.status).toBe(200);
    expect(res.body.data.map((p: any) => p.slug)).toEqual(['adnan', 'anne-mwaura']);
  });

  it('serves /presenters from Postgres after a full roster sync, but sends searches to the website', async () => {
    routes['/presenters?'] = { body: { meta: { total: 1, total_pages: 1 }, data: [{ id: 1, slug: 'adnan', name: 'Adnan', role: 'Breakfast host' }] } };
    await request(app).get('/api/v1/presenters');
    await flushBackground();

    db.presenter.findMany.mockResolvedValue([{ id: 1, isFull: true, profile: { id: 1, slug: 'adnan', name: 'Adnan' } }]);
    db.presenter.count.mockResolvedValue(1);
    fetchMock.mockClear();

    const roster = await request(app).get('/api/v1/presenters');
    expect(roster.body.data).toEqual([{ id: 1, slug: 'adnan', name: 'Adnan' }]);
    expect(fetchMock).not.toHaveBeenCalled();

    // "breakfast" matches the website's role field, which Postgres does not search.
    db.presenter.findMany.mockResolvedValue([]);
    db.presenter.count.mockResolvedValue(0);
    const searched = await request(app).get('/api/v1/presenters?search=breakfast');
    expect(searched.body.data.map((p: any) => p.slug)).toEqual(['adnan']);
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('search')).toBe('breakfast');
  });

  it('fetches an author page from the website when Postgres holds only part of the archive', async () => {
    db.author.findUnique.mockResolvedValue({ id: 42, slug: 'anne-mwaura', storyCount: 1840, profile: coAuthor });
    db.article.findMany.mockResolvedValue([storedArticleRow]);
    db.article.count.mockResolvedValue(3);
    routes['/authors/anne-mwaura/articles'] = {
      body: { meta: { total: 1840, total_pages: 184, author: coAuthor }, data: [rawArticle(11), rawArticle(12)] },
    };

    const res = await request(app).get('/api/v1/authors/anne-mwaura/articles?per_page=10');

    expect(res.status).toBe(200);
    expect(res.body.data.articles.map((a: any) => a.id)).toEqual([11, 12]);
    expect(res.body.meta).toEqual({ total: 1840, total_pages: 184, page: 1, per_page: 10 });
  });

  it('serves a full author page from Postgres without waiting for the website', async () => {
    db.author.findUnique.mockResolvedValue({ id: 42, slug: 'anne-mwaura', storyCount: 25, profile: coAuthor });
    db.article.findMany.mockResolvedValue([storedArticleRow, { ...storedArticleRow, id: 2, slug: 'story-2' }]);
    db.article.count.mockResolvedValue(20);
    routes['/authors/anne-mwaura/articles'] = { body: { meta: { total: 25, total_pages: 13, author: coAuthor }, data: [] } };

    const res = await request(app).get('/api/v1/authors/anne-mwaura/articles?per_page=2');

    expect(res.status).toBe(200);
    expect(res.body.data.articles.map((a: any) => a.id)).toEqual([1, 2]);
    expect(res.body.meta).toEqual({ total: 25, total_pages: 13, page: 1, per_page: 2 });
  });

  it('serves the short last page from Postgres once it holds the whole archive', async () => {
    db.author.findUnique.mockResolvedValue({ id: 42, slug: 'anne-mwaura', storyCount: 3, profile: coAuthor });
    db.article.findMany.mockResolvedValue([storedArticleRow]);
    db.article.count.mockResolvedValue(3);
    routes['/authors/anne-mwaura/articles'] = {
      body: { meta: { total: 3, total_pages: 2, author: coAuthor }, data: [rawArticle(99)] },
    };

    const res = await request(app).get('/api/v1/authors/anne-mwaura/articles?page=2&per_page=2');

    expect(res.status).toBe(200);
    expect(res.body.data.articles.map((a: any) => a.id)).toEqual([1]);
    expect(res.body.meta).toEqual({ total: 3, total_pages: 2, page: 2, per_page: 2 });
  });

  it('fetches fields=full author pages from the website when stored rows hold only excerpts', async () => {
    db.author.findUnique.mockResolvedValue({ id: 42, slug: 'anne-mwaura', storyCount: 1, profile: coAuthor });
    db.article.findMany.mockResolvedValue([storedArticleRow]);
    db.article.count.mockResolvedValue(1);
    const fullBody = 'Full story body. '.repeat(10);
    routes['/authors/anne-mwaura/articles'] = {
      body: { meta: { total: 1, total_pages: 1, author: coAuthor }, data: [{ ...rawArticle(1), content: fullBody }] },
    };

    const res = await request(app).get('/api/v1/authors/anne-mwaura/articles?fields=full');

    expect(res.status).toBe(200);
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('fields')).toBe('full');
    expect(res.body.data.articles[0].content).not.toBe('Body');
  });

  it('restores stored bylines on /news articles served from Postgres', async () => {
    db.article.findMany.mockResolvedValue([storedArticleRow]);
    db.article.count.mockResolvedValue(1);

    const res = await request(app).get('/api/v1/news?category=news-pg-test');

    expect(res.status).toBe(200);
    expect(res.body.data.articles[0].authors).toHaveLength(2);
    expect(res.body.data.articles[0].authorDetails.slug).toBe('jane-writer');
  });
});

describe('Live (YouTube watch button)', () => {
  const liveUpstream = {
    meta: { timezone: 'Africa/Nairobi', generated_at: '2026-11-05T20:04:42+03:00', api_version: '2.4.0' },
    data: {
      radio: { is_live: true, stream_url: 'https://atunwadigital.streamguys1.com/capitalfm', show: 'The Hype', host: 'Adnan', ends_at: '2026-11-05T22:00:00+03:00' },
      youtube: {
        is_live: true,
        video_id: null,
        channel_id: 'UCsURxs8Kz_qzezpicj-STyw',
        title: null,
        watch_url: 'https://www.youtube.com/channel/UCsURxs8Kz_qzezpicj-STyw/live',
        embed_url: 'https://www.youtube.com/embed/live_stream?channel=UCsURxs8Kz_qzezpicj-STyw',
      },
      checked_at: '2026-11-05T20:04:42+03:00',
    },
  };

  it('GET /api/v1/live keeps youtube.is_live true even when video_id is null (channel embed)', async () => {
    routes['/live'] = { body: liveUpstream };

    const res = await request(app).get('/api/v1/live');

    expect(res.status).toBe(200);
    expect(res.body.data.youtube).toEqual(liveUpstream.data.youtube);
    expect(res.body.data.radio.show).toBe('The Hype');
  });

  it('normalizeLiveState fills every youtube key with null and never infers is_live', () => {
    const state = normalizeLiveState({ data: { radio: { is_live: true }, youtube: { is_live: 'yes', video_id: 'abc' } } });

    expect(state.data.youtube).toEqual({
      is_live: false,
      video_id: 'abc',
      channel_id: null,
      title: null,
      watch_url: null,
      embed_url: null,
    });
  });

  it('hides the watch button (youtube.is_live false) when the upstream is down', async () => {
    routes['/live'] = { status: 503, body: {} };

    const res = await request(app).get('/api/v1/live');

    expect(res.status).toBe(200);
    expect(res.body.data.youtube.is_live).toBe(false);
    expect(res.body.data.youtube.watch_url).toBeNull();
  });
});
