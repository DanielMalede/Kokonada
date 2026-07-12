'use strict';

const { cleanYouTubeArtist, parseYouTubeTitle, translateToSpotify } = require('../app/services/crossPlatform');

describe('cleanYouTubeArtist', () => {
  it('strips "- Topic", VEVO, and Official Artist Channel', () => {
    expect(cleanYouTubeArtist('Tame Impala - Topic')).toBe('Tame Impala');
    expect(cleanYouTubeArtist('ColdplayVEVO')).toBe('Coldplay');
    expect(cleanYouTubeArtist('Radiohead - Official Artist Channel')).toBe('Radiohead');
    expect(cleanYouTubeArtist('')).toBe('');
  });
});

describe('parseYouTubeTitle', () => {
  it('splits "Artist - Song (Official Video)" and drops the noise', () => {
    expect(parseYouTubeTitle('Daft Punk - Get Lucky (Official Video)', 'DaftPunkVEVO'))
      .toEqual({ title: 'Get Lucky', artist: 'Daft Punk' });
  });
  it('uses the cleaned channel as the artist for "- Topic" uploads', () => {
    expect(parseYouTubeTitle('Redbone', 'Childish Gambino - Topic'))
      .toEqual({ title: 'Redbone', artist: 'Childish Gambino' });
  });
  it('strips bracketed/lyric noise', () => {
    expect(parseYouTubeTitle('Bohemian Rhapsody [Lyrics]', 'Queen - Topic'))
      .toEqual({ title: 'Bohemian Rhapsody', artist: 'Queen' });
  });
});

describe('translateToSpotify', () => {
  const yt = (name, artist) => ({ name, artist, uri: null, provider: 'youtube_music' });

  it('passes through tracks that already have a spotify URI (no search)', async () => {
    const searchFn = jest.fn();
    const spot = { uri: 'spotify:track:abc', name: 'X', artist: 'Y', provider: 'spotify' };
    const { tracks, translated } = await translateToSpotify([spot], 'tok', { searchFn });
    expect(tracks).toEqual([spot]);
    expect(translated).toBe(0);
    expect(searchFn).not.toHaveBeenCalled();
  });

  it('translates a YouTube track to a playable Spotify URI', async () => {
    const searchFn = jest.fn().mockResolvedValue({ id: 's1', uri: 'spotify:track:s1', name: 'Get Lucky', artist: 'Daft Punk' });
    const { tracks, translated, missed } = await translateToSpotify(
      [yt('Daft Punk - Get Lucky (Official Video)', 'DaftPunkVEVO')], 'tok', { searchFn },
    );
    expect(translated).toBe(1);
    expect(missed).toBe(0);
    expect(tracks[0]).toMatchObject({ uri: 'spotify:track:s1', provider: 'spotify', translatedFrom: 'youtube' });
    expect(searchFn).toHaveBeenCalledWith('tok', { title: 'Get Lucky', artist: 'Daft Punk' });
  });

  it('drops unmatched tracks but keeps the rest, and caches repeat lookups', async () => {
    const searchFn = jest.fn()
      .mockResolvedValueOnce(null)                                                   // miss
      .mockResolvedValue({ id: 's2', uri: 'spotify:track:s2', name: 'A', artist: 'B' });
    const input = [yt('Unknown Thing', 'Nobody'), yt('A', 'B'), yt('A', 'B')];
    const { tracks, translated, missed } = await translateToSpotify(input, 'tok', { searchFn });
    expect(missed).toBe(1);
    expect(translated).toBe(2);         // second + third both resolve
    expect(tracks).toHaveLength(2);
    expect(searchFn).toHaveBeenCalledTimes(2); // third is served from cache (dedup holds under parallelism)
  });

  it('preserves input order in the translated output', async () => {
    const searchFn = jest.fn().mockImplementation((_tok, { title }) =>
      Promise.resolve({ id: title, uri: `spotify:track:${title}`, name: title, artist: 'a' }));
    const input = [yt('one', 'x'), yt('two', 'y'), yt('three', 'z')];
    const { tracks } = await translateToSpotify(input, 'tok', { searchFn, concurrency: 8 });
    expect(tracks.map(t => t.name)).toEqual(['one', 'two', 'three']);
  });

  it('HARD-bounds total time: returns by the deadline even when searches never resolve (429 Retry-After hang)', async () => {
    // A rate-limited Spotify search waits out a large Retry-After and can effectively never
    // return; the whole translation must still resolve at the deadline, not block generation.
    const searchFn = jest.fn().mockImplementation(() => new Promise(() => {})); // never resolves
    const input = Array.from({ length: 10 }, (_, i) => yt(`Song ${i}`, `A${i}`));
    const start = Date.now();
    const { tracks } = await translateToSpotify(input, 'tok', { searchFn, concurrency: 4, deadlineMs: 60 });
    expect(Date.now() - start).toBeLessThan(600); // did NOT wait on the stuck in-flight searches
    expect(tracks).toEqual([]);                    // best-effort: nothing resolved in time
  });

  it('still translates everything quickly when searches are fast (deadline not hit)', async () => {
    const searchFn = jest.fn().mockImplementation((_t, { title }) =>
      Promise.resolve({ id: title, uri: `spotify:track:${title}`, name: title, artist: 'a' }));
    const input = Array.from({ length: 12 }, (_, i) => yt(`Song ${i}`, `A${i}`));
    const { translated } = await translateToSpotify(input, 'tok', { searchFn, concurrency: 4, deadlineMs: 9000 });
    expect(translated).toBe(12);
  });

  // Discovery candidates carry `title` (NOT `name`), uri:null, isDiscovery:true — the shape
  // discoveryVectorService.find emits for a translatable no-URI corpus track.
  const disc = (title, artist) => ({ title, artist, uri: null, provider: 'youtube_music', isDiscovery: true });

  it('translates a discovery candidate (title, not name) and preserves isDiscovery through the spread', async () => {
    const searchFn = jest.fn().mockResolvedValue({ id: 'd1', uri: 'spotify:track:d1', name: 'YT Song', artist: 'A' });
    const { tracks, translated, missed } = await translateToSpotify([disc('YT Song', 'A')], 'tok', { searchFn });
    expect(translated).toBe(1);
    expect(missed).toBe(0);
    expect(searchFn).toHaveBeenCalledWith('tok', { title: 'YT Song', artist: 'A' });
    expect(tracks[0]).toMatchObject({ uri: 'spotify:track:d1', provider: 'spotify', isDiscovery: true, translatedFrom: 'youtube' });
  });

  it('a search failure for one discovery candidate drops only that one — the sibling and the batch survive, order preserved', async () => {
    // A per-track search rejection must never fail the whole batch (spotify search rejects on
    // network/429). The throwing candidate is counted missed and dropped; the rest are unaffected.
    const searchFn = jest.fn().mockImplementation(async (_tok, { title }) => {
      if (title === 'Boom') throw new Error('search exploded');
      return { id: title, uri: `spotify:track:${title}`, name: title, artist: 'A' };
    });
    const input = [disc('Alpha', 'A'), disc('Boom', 'A'), disc('Zeta', 'A')];
    const { tracks, translated, missed } = await translateToSpotify(input, 'tok', { searchFn, concurrency: 8 });
    expect(missed).toBe(1);
    expect(translated).toBe(2);
    expect(tracks.map(t => t.name)).toEqual(['Alpha', 'Zeta']); // Boom dropped; surviving order preserved
    expect(tracks.every(t => t.isDiscovery === true)).toBe(true);
  });
});
