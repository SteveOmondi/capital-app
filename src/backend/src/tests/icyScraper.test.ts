import { parseIcyMetadataString, extractIcyStreamTitle } from '../utils/icyScraper';

describe('ICY Stream Metadata Parser Utility', () => {
  it('should parse "Artist - Track Title" correctly', () => {
    const result = parseIcyMetadataString('Sauti Sol - Suzanna');
    expect(result.artist).toBe('Sauti Sol');
    expect(result.title).toBe('Suzanna');
    expect(result.rawTitle).toBe('Sauti Sol - Suzanna');
  });

  it('should parse single track string without hyphens', () => {
    const result = parseIcyMetadataString('Capital FM Live');
    expect(result.artist).toBe('Capital FM');
    expect(result.title).toBe('Capital FM Live');
  });

  it('should extract StreamTitle from raw ICY header chunk', () => {
    const rawChunk = "StreamTitle='Burna Boy - Last Last';StreamUrl='https://www.capitalfm.africa';";
    const extracted = extractIcyStreamTitle(rawChunk);
    expect(extracted).toBe('Burna Boy - Last Last');
  });
});
