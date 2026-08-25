/**
 * Utility to parse ICY stream metadata title strings.
 */

export interface ParsedTrackInfo {
  rawTitle: string;
  artist: string;
  title: string;
}

/**
 * Parses raw ICY metadata string "Artist - Track Title" into artist and title.
 */
export function parseIcyMetadataString(rawTitle: string): ParsedTrackInfo {
  if (!rawTitle || typeof rawTitle !== 'string') {
    return {
      rawTitle: '',
      artist: 'Capital FM',
      title: 'Live Stream',
    };
  }

  const clean = rawTitle.trim();
  if (!clean.includes('-')) {
    return {
      rawTitle: clean,
      artist: 'Capital FM',
      title: clean || 'Live Stream',
    };
  }

  const parts = clean.split('-');
  const artist = parts[0].trim() || 'Capital FM';
  const title = parts.slice(1).join('-').trim() || 'Live Stream';

  return {
    rawTitle: clean,
    artist,
    title,
  };
}

/**
 * Extracts StreamTitle from ICY header block or raw socket chunk.
 * Example input: StreamTitle='Sauti Sol - Suzanna';StreamUrl='';
 */
export function extractIcyStreamTitle(chunk: string): string | null {
  if (!chunk) return null;
  const match = chunk.match(/StreamTitle='(.*?)';/i);
  return match && match[1] ? match[1].trim() : null;
}
