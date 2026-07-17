'use strict';

const { isYoutubeKey, isYoutubeContent, isYoutubeRow, youtubeRowSelector } = require('../app/utils/youtubeContent');

// Predicate unit coverage for the YouTube-ToS containment helper — the single source of truth
// every corpus write path + the leak monitor + the purge script gate on. Mirrors the shape of
// the Spotify containment predicate (utils/spotifyContent) so the two rules stay symmetric.

describe('youtubeContent — in-memory write-time predicate (isYoutubeKey / isYoutubeContent)', () => {
  it('isYoutubeKey matches the youtube: scheme case-insensitively, trims, rejects non-strings', () => {
    expect(isYoutubeKey('youtube:abc')).toBe(true);
    expect(isYoutubeKey('YOUTUBE:abc')).toBe(true);
    expect(isYoutubeKey('  youtube:abc  ')).toBe(true);
    expect(isYoutubeKey('spotify:abc')).toBe(false);
    expect(isYoutubeKey('mbid:abc')).toBe(false);
    expect(isYoutubeKey('youtube_music')).toBe(false); // the provider label is not a scheme key
    expect(isYoutubeKey(null)).toBe(false);
    expect(isYoutubeKey(42)).toBe(false);
  });

  it('isYoutubeContent flags provider youtube_music OR a youtube:-schemed recordingKey/uri/canonicalKey', () => {
    expect(isYoutubeContent({ provider: 'youtube_music' })).toBe(true);
    expect(isYoutubeContent({ provider: 'YOUTUBE_MUSIC' })).toBe(true); // fail-closed on case
    expect(isYoutubeContent({ recordingKey: 'youtube:x' })).toBe(true);
    expect(isYoutubeContent({ uri: 'youtube:x' })).toBe(true);
    expect(isYoutubeContent({ canonicalKey: 'youtube:x' })).toBe(true);
    expect(isYoutubeContent({ provider: 'spotify', recordingKey: 'spotify:x' })).toBe(false);
    expect(isYoutubeContent({ recordingKey: 'mbid:x' })).toBe(false);
    expect(isYoutubeContent(null)).toBe(false);
    expect(isYoutubeContent(42)).toBe(false);
  });
});

describe('youtubeContent — persisted-row predicate + Mongo selector (isYoutubeRow / youtubeRowSelector)', () => {
  it('isYoutubeRow flags youtube: recordingKey / uri and spares spotify:/mbid:', () => {
    expect(isYoutubeRow({ recordingKey: 'youtube:abc' })).toBe(true);
    expect(isYoutubeRow({ recordingKey: 'YOUTUBE:abc' })).toBe(true);
    expect(isYoutubeRow({ uri: 'youtube:abc' })).toBe(true);
    expect(isYoutubeRow({ recordingKey: 'spotify:x' })).toBe(false);
    expect(isYoutubeRow({ recordingKey: 'mbid:x' })).toBe(false);
    expect(isYoutubeRow({ recordingKey: 'mbid:x', spotifyId: 'z' })).toBe(false); // a spotifyId is not youtube content
    expect(isYoutubeRow(null)).toBe(false);
  });

  it('youtubeRowSelector uses a case-SENSITIVE anchored regex so the DB query can use the index', () => {
    const sel = youtubeRowSelector();
    const rk = sel.$or.find((c) => c.recordingKey)?.recordingKey;
    expect(rk).toBeInstanceOf(RegExp);
    expect(rk.flags).not.toContain('i'); // real keys are lowercase; case-insensitivity would defeat the index
    expect(rk.test('youtube:abc')).toBe(true);
    expect(rk.test('YOUTUBE:abc')).toBe(false);
    expect(rk.test('spotify:abc')).toBe(false);
  });

  it('youtubeRowSelector carries NO bare-id clause (AudioFeature has no youtube-equivalent of spotifyId)', () => {
    const sel = youtubeRowSelector();
    expect(sel.$or.every((c) => 'recordingKey' in c || 'uri' in c)).toBe(true);
    expect(JSON.stringify(sel)).not.toContain('youtubeId');
    expect(JSON.stringify(sel)).not.toContain('spotifyId');
  });
});
