// backend/tests/toCatalogEntry.test.js
const { toCatalogEntry } = require('../app/services/discovery/toCatalogEntry');

describe('toCatalogEntry', () => {
  it('normalizes a raw youtube_music library track (recordingKey youtube:<id>, name→title)', () => {
    const entry = toCatalogEntry({
      id: 'abc', provider: 'youtube_music', name: 'Song', uri: 'https://youtu.be/abc',
      canonicalKey: 'at:a|song', genres: ['pop'], artist: 'A',
    });
    expect(entry).toEqual({
      recordingKey: 'youtube:abc',
      canonicalKey: 'at:a|song',
      uri: 'https://youtu.be/abc',
      title: 'Song',
      artist: 'A',
      genres: ['pop'],
    });
  });

  it('normalizes a raw spotify library track (recordingKey spotify:<id>)', () => {
    const entry = toCatalogEntry({ id: 'xyz', provider: 'spotify', name: 'S2', uri: 'spotify:track:xyz' });
    expect(entry.recordingKey).toBe('spotify:xyz');
    expect(entry.title).toBe('S2');
  });

  it('passes an already-normalized track through unchanged (idempotent)', () => {
    const entry = toCatalogEntry({ recordingKey: 'spotify:q', title: 'T', canonicalKey: 'isrc:USABC1234567' });
    expect(entry.recordingKey).toBe('spotify:q');
    expect(entry.title).toBe('T');
    expect(entry.canonicalKey).toBe('isrc:USABC1234567');
  });

  it('returns null when no recordingKey can be derived (no provider/id and no recordingKey)', () => {
    expect(toCatalogEntry({ name: 'orphan' })).toBeNull();
  });

  it('returns null for null / undefined / non-object input', () => {
    expect(toCatalogEntry(null)).toBeNull();
    expect(toCatalogEntry(undefined)).toBeNull();
    expect(toCatalogEntry(42)).toBeNull();
  });

  it('defaults genres to [] when not an array', () => {
    const entry = toCatalogEntry({ id: 'abc', provider: 'youtube_music', name: 'Song' });
    expect(entry.genres).toEqual([]);
  });

  it('sets title to null when neither title nor name is present', () => {
    const entry = toCatalogEntry({ id: 'abc', provider: 'youtube_music' });
    expect(entry.recordingKey).toBe('youtube:abc');
    expect(entry.title).toBeNull();
  });

  it('derives canonicalKey when absent but title+artist are present', () => {
    const entry = toCatalogEntry({ id: 'x', provider: 'spotify', uri: 'spotify:track:x', name: 'Song', artist: 'A' });
    expect(entry.canonicalKey).not.toBeNull();
    expect(entry.canonicalKey).toEqual(expect.stringMatching(/^(at:|isrc:)/));
  });
});
