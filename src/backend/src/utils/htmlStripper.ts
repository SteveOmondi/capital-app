/**
 * Utility to strip HTML tags and decode common HTML entities from raw WordPress content.
 */

const HTML_ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#039;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&#8217;': "'",
  '&#8216;': "'",
  '&#8220;': '"',
  '&#8221;': '"',
  '&#8211;': '–',
  '&#8212;': '—',
  '&hellip;': '…',
  '&#8230;': '…',
};

/**
 * Decodes HTML entities in text strings.
 */
export function decodeHtmlEntities(text: string): string {
  if (!text) return '';
  
  let decoded = text;
  // Replace known entity codes
  for (const [entity, char] of Object.entries(HTML_ENTITY_MAP)) {
    decoded = decoded.replace(new RegExp(entity, 'g'), char);
  }

  // Handle generic numeric entities like &#123; or &#x1f;
  decoded = decoded.replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));
  decoded = decoded.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

  return decoded;
}

/**
 * Strips HTML tags and decodes entities from text.
 */
export function stripHtml(html: string): string {
  if (!html) return '';
  
  // Remove script and style tags completely along with their contents
  let clean = html.replace(/<script\b[^<]*>([\s\S]*?)<\/script>/gi, '');
  clean = clean.replace(/<style\b[^<]*>([\s\S]*?)<\/style>/gi, '');

  // Replace block element tags with newlines for clean paragraph spacing
  clean = clean.replace(/<\/(p|div|h[1-6]|li|tr|br\s*\/?)>/gi, '\n');

  // Strip all remaining HTML tags
  clean = clean.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  clean = decodeHtmlEntities(clean);

  // Normalize excessive spaces and clean up blank lines
  clean = clean
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n\n');

  return clean.trim();
}
