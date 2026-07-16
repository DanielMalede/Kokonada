// backend/tests/toCatalogEntry.test.js
const { toCatalogEntry } = require('../app/services/discovery/toCatalogEntry');

describe('toCatalogEntry', () => {
  it('normalizes a pre-keyed mbid corpus entry (name→title, full shape preserved)', () => {
    const entry = toCatalogEntry({
      recordingKey: 'mbid:abc', name: 'Song', uri: null,
      canonicalKey: 'at:a|song', genres: ['pop'], artist: 'A',
    });
    expect(entry).toEqual({
      recordingKey: 'mbid:abc',
      canonicalKey: 'at:a|song',
      uri: null,
      title: 'Song',
      artist: 'A',
      genres: ['pop'],
    });
  });

  it('drops a raw spotify library track — returns null (Spotify-ToS containment)', () => {
    expect(toCatalogEntry({ id: 'xyz', provider: 'spotify', name: 'S2', uri: 'spotify:track:xyz' })).toBeNull();
  });

  it('drops a pre-keyed spotify recordingKey — returns null (Spotify-ToS containment)', () => {
    expect(toCatalogEntry({ recordingKey: 'spotify:q', title: 'T', canonicalKey: 'isrc:USABC1234567' })).toBeNull();
  });

  it('drops a track whose uri is a spotify uri even if the provider differs', () => {
    expect(toCatalogEntry({ id: 'z', provider: 'foo', uri: 'spotify:track:z' })).toBeNull();
  });

  it('passes an already-normalized mbid corpus track through unchanged (idempotent)', () => {
    const entry = toCatalogEntry({ recordingKey: 'mbid:q', title: 'T', canonicalKey: 'isrc:USABC1234567' });
    expect(entry.recordingKey).toBe('mbid:q');
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
    const entry = toCatalogEntry({ recordingKey: 'mbid:abc', name: 'Song' });
    expect(entry.genres).toEqual([]);
  });

  it('sets title to null when neither title nor name is present', () => {
    const entry = toCatalogEntry({ recordingKey: 'mbid:abc' });
    expect(entry.recordingKey).toBe('mbid:abc');
    expect(entry.title).toBeNull();
  });

  it('derives canonicalKey when absent but title+artist are present', () => {
    const entry = toCatalogEntry({ recordingKey: 'mbid:x', name: 'Song', artist: 'A' });
    expect(entry.canonicalKey).not.toBeNull();
    expect(entry.canonicalKey).toEqual(expect.stringMatching(/^(at:|isrc:)/));
  });

  it('drops a raw youtube_music library track even as the only input — returns null (YouTube-ToS containment)', () => {
    expect(toCatalogEntry({ id: 'abc', provider: 'youtube_music', name: 'Song', uri: 'https://youtu.be/abc' })).toBeNull();
  });

  it('drops a pre-keyed youtube: recordingKey — returns null (YouTube-ToS containment)', () => {
    expect(toCatalogEntry({ recordingKey: 'youtube:q', title: 'T', canonicalKey: 'isrc:USABC1234567' })).toBeNull();
  });

  it('drops a track whose uri is a youtube: uri even if the provider differs', () => {
    expect(toCatalogEntry({ id: 'z', provider: 'foo', uri: 'youtube:z' })).toBeNull();
  });

  it('passes a legitimate mbid: recordingKey through (the CC0 corpus survives containment)', () => {
    const entry = toCatalogEntry({ recordingKey: 'mbid:legit', title: 'T', canonicalKey: 'isrc:USABC1234567', genres: ['jazz'] });
    expect(entry.recordingKey).toBe('mbid:legit');
    expect(entry.genres).toEqual(['jazz']);
  });
});
