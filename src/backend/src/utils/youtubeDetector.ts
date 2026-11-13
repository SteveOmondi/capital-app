/**
 * Finds the YouTube video a story's body plays, for stories whose editor embedded the video in the
 * text but left the website's YouTube box empty (so upstream `video` is null).
 *
 * Counted (YouTube only):
 * - an embedded player: `<iframe src=".../embed/ID">` (youtube.com or youtube-nocookie.com),
 * - a WordPress embed block (`wp-block-embed` figure, `<!-- wp:embed -->` / `wp:core-embed/youtube`
 *   comment, or an `[embed]` shortcode) holding a YouTube video link,
 * - a bare YouTube video URL on its own line (alone in its paragraph, or as the only thing in a
 *   paragraph that is a link whose text is that same URL, which is how WordPress auto-links it).
 *
 * Not counted: a YouTube link inside running text (`watch <a href="...">here</a>`), and links that
 * are not one video (channels, handles, playlists, search).
 */

/** The video shape the API serves (same keys as the website's `video` object), marked as detected. */
export interface DetectedYouTubeVideo {
  provider: 'youtube';
  id: string;
  url: string;
  watch_url: string;
  embed_url: string;
  thumbnail: { default: string; medium: string; max: string };
  is_short: boolean;
  source: 'detected';
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
// Path segments under /embed/ that are players for something other than one video.
const NON_VIDEO_EMBEDS = new Set(['videoseries', 'live_stream']);

const URL_IN_TEXT = /https?:\/\/[^\s"'<>\]]+/gi;

function decodeEntities(text: string): string {
  return text
    .replace(/&#0*38;|&#x0*26;|&amp;/gi, '&')
    .replace(/&#0*61;|&#x0*3d;/gi, '=')
    .replace(/&#0*63;|&#x0*3f;/gi, '?')
    .replace(/&#0*47;|&#x0*2f;/gi, '/')
    .replace(/&quot;|&#0*34;/gi, '"');
}

/** Parses one YouTube video link; null for anything that is not a single YouTube video. */
export function parseYouTubeUrl(rawUrl: string): { id: string; isShort: boolean } | null {
  let url: URL;
  try {
    url = new URL(decodeEntities(rawUrl.trim()).replace(/\\\//g, '/'));
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
  const segments = url.pathname.split('/').filter(Boolean);
  let id: string | undefined;
  let isShort = false;

  if (host === 'youtu.be') {
    id = segments[0];
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const [first, second] = segments;
    if (first === 'watch' && segments.length === 1) {
      id = url.searchParams.get('v') ?? undefined;
    } else if (first === 'embed' || first === 'v' || first === 'e' || first === 'live') {
      if (second && !NON_VIDEO_EMBEDS.has(second)) id = second;
    } else if (first === 'shorts') {
      id = second;
      isShort = true;
    }
  }

  if (!id || !YOUTUBE_ID.test(id)) return null;
  return { id, isShort };
}

interface Candidate {
  index: number;
  url: string;
}

/** `<iframe src|data-src="...">` players. */
function iframeCandidates(html: string): Candidate[] {
  const found: Candidate[] = [];
  const iframe = /<iframe\b[^>]*>/gi;
  for (let m = iframe.exec(html); m; m = iframe.exec(html)) {
    const attrs = /\s(?:data-)?src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
    for (let a = attrs.exec(m[0]); a; a = attrs.exec(m[0])) {
      found.push({ index: m.index, url: a[1] ?? a[2] ?? a[3] ?? '' });
    }
  }
  return found;
}

/**
 * WordPress embed blocks given as source: the block comment and the [embed] shortcode. A rendered
 * embed figure is covered by its iframe or by its wrapper's bare URL line; its caption is not.
 */
function embedBlockCandidates(html: string): Candidate[] {
  const found: Candidate[] = [];
  const containers = [
    /<!--\s*wp:(?:core-)?embed(?:\/youtube)?\b([\s\S]*?)-->/gi,
    /\[embed\b[^\]]*\]([\s\S]*?)\[\/embed\]/gi,
  ];
  for (const container of containers) {
    for (let m = container.exec(html); m; m = container.exec(html)) {
      // Block comments carry JSON attributes, where slashes may be escaped (`https:\/\/youtu.be\/…`).
      const urls = m[1].replace(/\\\//g, '/').match(URL_IN_TEXT) ?? [];
      for (const url of urls) found.push({ index: m.index, url });
    }
  }
  return found;
}

const BLOCK_BOUNDARY =
  /<\/?(?:p|div|br|figure|figcaption|blockquote|li|ul|ol|h[1-6]|section|article|pre|table|tr|td|th)\b[^>]*>/gi;

/**
 * A YouTube URL that is the whole of its line: alone in its paragraph (or between line breaks), or
 * the only thing there being a link whose visible text is that same URL.
 */
function ownLineCandidates(html: string): Candidate[] {
  const found: Candidate[] = [];
  // Mark block boundaries as line breaks, keeping each line's position in the original HTML.
  const marked = html.replace(BLOCK_BOUNDARY, (tag) => '\n'.padEnd(tag.length, ' '));
  let offset = 0;
  for (const line of marked.split('\n')) {
    const index = offset;
    offset += line.length + 1;
    const trimmed = line.trim();
    if (!trimmed) continue;

    const anchor = /^<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>$/i.exec(
      trimmed,
    );
    if (anchor) {
      const href = decodeEntities(anchor[1] ?? anchor[2] ?? '').trim();
      const text = decodeEntities(anchor[3].replace(/<[^>]+>/g, '')).trim();
      if (text === href) found.push({ index, url: href });
      continue;
    }
    // Inline formatting around a bare URL (e.g. <strong>) does not make it running text.
    const text = trimmed
      .replace(/<\/?(?:span|strong|b|em|i)\b[^>]*>/gi, '')
      .replace(/&nbsp;|\u00a0/g, ' ')
      .trim();
    if (/^https?:\/\/\S+$/i.test(text) && !text.includes('<')) found.push({ index, url: text });
  }
  return found;
}

/**
 * Returns the first YouTube video the body embeds or carries as a bare own-line URL, in the
 * website's `video` shape with `source: "detected"`, or null when there is none.
 */
export function detectYouTubeVideo(html: unknown): DetectedYouTubeVideo | null {
  if (typeof html !== 'string' || !/youtu\.?be/i.test(html)) return null;

  const candidates = [
    ...iframeCandidates(html),
    ...embedBlockCandidates(html),
    ...ownLineCandidates(html),
  ].sort((a, b) => a.index - b.index);

  for (const candidate of candidates) {
    const parsed = parseYouTubeUrl(candidate.url);
    if (!parsed) continue;
    const { id, isShort } = parsed;
    return {
      provider: 'youtube',
      id,
      url: decodeEntities(candidate.url.trim()),
      watch_url: `https://www.youtube.com/watch?v=${id}`,
      embed_url: `https://www.youtube.com/embed/${id}`,
      thumbnail: {
        default: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        medium: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
        max: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
      },
      is_short: isShort,
      source: 'detected',
    };
  }
  return null;
}
