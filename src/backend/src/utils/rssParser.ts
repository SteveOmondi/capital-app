import { XMLParser } from 'fast-xml-parser';
import { stripHtml } from './htmlStripper';

export interface PodcastEpisode {
  guid: string;
  title: string;
  description: string;
  audioUrl: string;
  duration?: string;
  publishedAt: string;
  publishedTimestamp: number;
  imageUrl?: string;
}

export interface PodcastChannel {
  title: string;
  description: string;
  link: string;
  imageUrl?: string;
  episodes: PodcastEpisode[];
}

export function parsePodcastRssXml(xmlData: string): PodcastChannel {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseAttributeValue: true,
  });

  const jsonObj = parser.parse(xmlData);
  const channel = jsonObj?.rss?.channel || {};

  const title = channel.title ? String(channel.title) : 'Capital FM Podcasts';
  const description = channel.description ? stripHtml(String(channel.description)) : '';
  const link = channel.link ? String(channel.link) : '';
  const imageUrl = channel['itunes:image']?.['@_href'] || channel.image?.url || undefined;

  const rawItems = Array.isArray(channel.item) ? channel.item : channel.item ? [channel.item] : [];

  const episodes: PodcastEpisode[] = rawItems.map((item: any) => {
    const guid = item.guid ? (typeof item.guid === 'object' ? item.guid['#text'] : String(item.guid)) : String(Math.random());
    const episodeTitle = item.title ? String(item.title) : 'Untitled Episode';
    const rawDesc = item.description || item['content:encoded'] || '';
    const episodeDesc = stripHtml(String(rawDesc));

    // Audio Enclosure extraction
    const enclosure = item.enclosure;
    const audioUrl = enclosure?.['@_url'] || enclosure?.url || '';

    // Duration extraction
    const duration = item['itunes:duration'] ? String(item['itunes:duration']) : undefined;

    // Image extraction
    const epImageUrl = item['itunes:image']?.['@_href'] || imageUrl;

    // Date parsing
    const pubDateStr = item.pubDate ? String(item.pubDate) : new Date().toISOString();
    const publishedTimestamp = new Date(pubDateStr).getTime() || Date.now();

    return {
      guid,
      title: episodeTitle,
      description: episodeDesc,
      audioUrl,
      duration,
      publishedAt: new Date(publishedTimestamp).toISOString(),
      publishedTimestamp,
      imageUrl: epImageUrl,
    };
  });

  return {
    title,
    description,
    link,
    imageUrl,
    episodes,
  };
}
