import { stripHtml, decodeHtmlEntities } from '../utils/htmlStripper';

describe('HTML Stripper & Entity Decoder Utility', () => {
  it('should decode standard HTML entities', () => {
    expect(decodeHtmlEntities('Capital &amp; FM')).toBe('Capital & FM');
    expect(decodeHtmlEntities('It&#8217;s a great day')).toBe("It's a great day");
    expect(decodeHtmlEntities('&quot;Nairobi Traffic&quot;')).toBe('"Nairobi Traffic"');
  });

  it('should strip HTML tags while keeping clean paragraph breaks', () => {
    const rawHtml = '<p><strong>Breaking News:</strong> Nairobi highway open.</p><p>Traffic is flowing smoothly.</p>';
    const cleanText = stripHtml(rawHtml);

    expect(cleanText).toBe('Breaking News: Nairobi highway open.\n\nTraffic is flowing smoothly.');
    expect(cleanText).not.toContain('<p>');
    expect(cleanText).not.toContain('<strong>');
  });

  it('should handle empty or null strings gracefully', () => {
    expect(stripHtml('')).toBe('');
    expect(decodeHtmlEntities('')).toBe('');
  });
});
