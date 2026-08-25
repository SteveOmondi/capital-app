import request from 'supertest';
import app from '../app';
import { parsePodcastRssXml } from '../utils/rssParser';
import { prisma } from '../config/db';
import { redis } from '../config/redis';

describe('Podcast RSS Parser & API Integration Tests', () => {
  jest.setTimeout(15000);

  afterAll(async () => {
    try {
      await prisma.$disconnect();
      if (redis.status === 'ready' || redis.status === 'connecting') {
        redis.disconnect();
      }
    } catch (_) {
      // Ignore teardown errors
    }
  });

  it('should parse valid RSS XML with audio enclosures correctly', () => {
    const mockXml = `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
        <channel>
          <title>Capital FM Podcast</title>
          <description>The best show highlights</description>
          <link>https://www.capitalfm.africa</link>
          <item>
            <guid>ep-101</guid>
            <title>Morning Jam Highlight</title>
            <description>&lt;p&gt;Today&amp;#8217;s top interview.&lt;/p&gt;</description>
            <enclosure url="https://audio.capitalfm.africa/ep101.mp3" length="12345" type="audio/mpeg"/>
            <itunes:duration>45:20</itunes:duration>
            <pubDate>Mon, 24 Aug 2026 08:00:00 GMT</pubDate>
          </item>
        </channel>
      </rss>`;

    const channel = parsePodcastRssXml(mockXml);

    expect(channel.title).toBe('Capital FM Podcast');
    expect(channel.episodes.length).toBe(1);
    expect(channel.episodes[0].title).toBe('Morning Jam Highlight');
    expect(channel.episodes[0].audioUrl).toBe('https://audio.capitalfm.africa/ep101.mp3');
    expect(channel.episodes[0].duration).toBe('45:20');
    expect(channel.episodes[0].description).toBe("Today's top interview.");
  });

  it('GET /api/v1/podcasts should return 200 OK with podcast channel object', async () => {
    const response = await request(app).get('/api/v1/podcasts');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status', 'success');
    expect(response.body.data).toHaveProperty('title');
    expect(response.body.data).toHaveProperty('episodes');
    expect(Array.isArray(response.body.data.episodes)).toBe(true);
  });
});
