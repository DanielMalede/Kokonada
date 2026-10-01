'use strict';

const { cleanYouTubeArtist, parseYouTubeTitle, translateToSpotify, _originOf } = require('../app/services/crossPlatform');
const { YOUTUBE_EGRESS_ENABLED } = require('../app/config/youtubeSeal');

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
  // A catalogue discovery candidate exactly as discoveryVectorService.find emits it for a no-URI CC0
  // (mbid:) corpus row: `title` (not `name`), uri:null, isDiscovery:true. HX-3 T5 FIXTURE MOVE: the
  // cache / order / deadline / one-failure tests below used YouTube rows; under DEC-040's gate a
  // YouTube row is never searched, so they now run on the rows that still reach the search. Their
  // assertions are unchanged (DEC-123 item 5, if the resilience-auditor calls these fixtures pins).
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const disc = (title, artist) => ({
    id: `mbid:${slug(title)}-${slug(artist)}`, recordingKey: `mbid:${slug(title)}-${slug(artist)}`,
    canonicalKey: `at:${slug(artist)}|${slug(title)}`, uri: null, title, artist, genres: [], isDiscovery: true,
  });

  it('passes through tracks that already have a spotify URI (no search)', async () => {
    const searchFn = jest.fn();
    const spot = { uri: 'spotify:track:abc', name: 'X', artist: 'Y', provider: 'spotify' };
    const { tracks, translated } = await translateToSpotify([spot], 'tok', { searchFn });
    expect(tracks).toEqual([spot]);
    expect(translated).toBe(0);
    expect(searchFn).not.toHaveBeenCalled();
  });

  // HX-3 T5 — REVERSED (DEC-091; DEC-040): this pinned that a YouTube track IS translated. Spotify
  // Developer Policy III.5 forbids the YouTube-to-Spotify translation in every state, so the track is
  // now never searched: it is counted missed and dropped, before its title is even parsed.
  it('REVERSED: never searches a YouTube track — it is dropped and counted missed (DEC-040)', async () => {
    const searchFn = jest.fn().mockResolvedValue({ id: 's1', uri: 'spotify:track:s1', name: 'Get Lucky', artist: 'Daft Punk' });
    const yt = { name: 'Daft Punk - Get Lucky (Official Video)', artist: 'DaftPunkVEVO', uri: null, provider: 'youtube_music' };
    const { tracks, translated, missed } = await translateToSpotify([yt], 'tok', { searchFn });
    expect(translated).toBe(0);
    expect(missed).toBe(1);
    expect(tracks).toEqual([]);
    expect(searchFn).not.toHaveBeenCalled();
  });

  it('drops unmatched tracks but keeps the rest, and caches repeat lookups', async () => {
    const searchFn = jest.fn()
      .mockResolvedValueOnce(null)                                                   // miss
      .mockResolvedValue({ id: 's2', uri: 'spotify:track:s2', name: 'A', artist: 'B' });
    const input = [disc('Unknown Thing', 'Nobody'), disc('A', 'B'), disc('A', 'B')];
    const { tracks, translated, missed } = await translateToSpotify(input, 'tok', { searchFn });
    expect(missed).toBe(1);
    expect(translated).toBe(2);         // second + third both resolve
    expect(tracks).toHaveLength(2);
    expect(searchFn).toHaveBeenCalledTimes(2); // third is served from cache (dedup holds under parallelism)
  });

  it('preserves input order in the translated output', async () => {
    const searchFn = jest.fn().mockImplementation((_tok, { title }) =>
      Promise.resolve({ id: title, uri: `spotify:track:${title}`, name: title, artist: 'a' }));
    const input = [disc('one', 'x'), disc('two', 'y'), disc('three', 'z')];
    const { tracks } = await translateToSpotify(input, 'tok', { searchFn, concurrency: 8 });
    expect(tracks.map(t => t.name)).toEqual(['one', 'two', 'three']);
  });

  it('HARD-bounds total time: returns by the deadline even when searches never resolve (429 Retry-After hang)', async () => {
    // A rate-limited Spotify search waits out a large Retry-After and can effectively never
    // return; the whole translation must still resolve at the deadline, not block generation.
    const searchFn = jest.fn().mockImplementation(() => new Promise(() => {})); // never resolves
    const input = Array.from({ length: 10 }, (_, i) => disc(`Song ${i}`, `A${i}`));
    const start = Date.now();
    const { tracks } = await translateToSpotify(input, 'tok', { searchFn, concurrency: 4, deadlineMs: 60 });
    expect(Date.now() - start).toBeLessThan(600); // did NOT wait on the stuck in-flight searches
    expect(tracks).toEqual([]);                    // best-effort: nothing resolved in time
  });

  it('still translates everything quickly when searches are fast (deadline not hit)', async () => {
    const searchFn = jest.fn().mockImplementation((_t, { title }) =>
      Promise.resolve({ id: title, uri: `spotify:track:${title}`, name: title, artist: 'a' }));
    const input = Array.from({ length: 12 }, (_, i) => disc(`Song ${i}`, `A${i}`));
    const { translated } = await translateToSpotify(input, 'tok', { searchFn, concurrency: 4, deadlineMs: 9000 });
    expect(translated).toBe(12);
  });

  // HX-3 T5 — REVERSED (DEC-091; M5, BE-054): the `disc` fixture at this spot was a YouTube row and
  // the label said `translatedFrom: 'youtube'`. A YouTube row no longer reaches the search, and the
  // label carries the track's true origin (YouTube Developer Policies III.F.2.b): a catalogue
  // candidate is `'catalog'`. The fixture is now the catalogue shape defined at the top of this block.
  it('REVERSED: translates a catalogue discovery candidate (title, not name), labels it catalog, and preserves isDiscovery', async () => {
    const searchFn = jest.fn().mockResolvedValue({ id: 'd1', uri: 'spotify:track:d1', name: 'Cat Song', artist: 'A' });
    const { tracks, translated, missed } = await translateToSpotify([disc('Cat Song', 'A')], 'tok', { searchFn });
    expect(translated).toBe(1);
    expect(missed).toBe(0);
    expect(searchFn).toHaveBeenCalledWith('tok', { title: 'Cat Song', artist: 'A' });
    expect(tracks[0]).toMatchObject({ uri: 'spotify:track:d1', provider: 'spotify', isDiscovery: true, translatedFrom: 'catalog' });
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

// HX-3 T5 (DEC-040; compliance M2, M3, M5) — the gate inside translateToSpotify. With the REAL seal
// (YOUTUBE_EGRESS_ENABLED false), a track is YouTube Content by the ONE shared predicate
// (utils/youtubeContent.isYoutubeContent): provider youtube_music, or a youtube: uri, recordingKey or
// canonicalKey, case-insensitively. Such a track is counted missed and skipped BEFORE its title is
// parsed and before the search, so no YouTube title or channel reaches Spotify. This is also the
// backstop for a YouTube row carried in from anywhere else (a stale cached pool: NR-2).
describe('translateToSpotify — the DEC-040 egress gate', () => {
  const spotifyTrack = { id: 'sp1', uri: 'spotify:track:sp1', name: 'Native', artist: 'S', provider: 'spotify' };
  const catalogue = { id: 'mbid:m1', recordingKey: 'mbid:m1', canonicalKey: 'at:c|catalogue song', uri: null, title: 'Catalogue Song', artist: 'C', isDiscovery: true };
  const youtubeShapes = [
    ['provider youtube_music', { name: 'YT-SENTINEL-1 - Song', artist: 'YT-CHANNEL-1', uri: null, provider: 'youtube_music' }],
    ['provider in another case', { name: 'YT-SENTINEL-2', artist: 'YT-CHANNEL-2', uri: null, provider: 'YouTube_Music' }],
    ['a youtube: uri', { title: 'YT-SENTINEL-3', artist: 'YT-CHANNEL-3', uri: 'youtube:vid3' }],
    ['a youtube: recordingKey', { title: 'YT-SENTINEL-4', artist: 'YT-CHANNEL-4', uri: null, recordingKey: 'youtube:vid4', isDiscovery: true }],
    ['a YOUTUBE: canonicalKey', { title: 'YT-SENTINEL-5', artist: 'YT-CHANNEL-5', uri: null, canonicalKey: 'YOUTUBE:vid5' }],
  ];
  const hit = (_tok, { title, artist }) => Promise.resolve({ id: `s-${title}`, uri: `spotify:track:s-${title}`, name: title, artist });

  it('runs against the real seal', () => {
    expect(YOUTUBE_EGRESS_ENABLED).toBe(false);
  });

  it.each(youtubeShapes)('a track with %s is never searched, never parsed into a query, and is dropped as missed', async (_label, yt) => {
    const searchFn = jest.fn(hit);
    const { tracks, translated, missed } = await translateToSpotify([yt], 'tok', { searchFn });
    expect(searchFn).not.toHaveBeenCalled();
    expect(tracks).toEqual([]);
    expect(translated).toBe(0);
    expect(missed).toBe(1);
  });

  it('a mixed batch: Spotify passes through, the catalogue track is translated and labelled catalog, every YouTube track is dropped — order kept', async () => {
    const searchFn = jest.fn(hit);
    const input = [youtubeShapes[0][1], spotifyTrack, youtubeShapes[3][1], catalogue, youtubeShapes[2][1]];
    const { tracks, translated, missed } = await translateToSpotify(input, 'tok', { searchFn, concurrency: 8 });

    expect(tracks).toHaveLength(2);
    expect(tracks[0]).toBe(spotifyTrack); // the passthrough is untouched — same object, no search
    expect(tracks[1]).toMatchObject({ id: 's-Catalogue Song', uri: 'spotify:track:s-Catalogue Song', provider: 'spotify', translatedFrom: 'catalog', isDiscovery: true, recordingKey: 'mbid:m1' });
    expect(translated).toBe(1);
    expect(missed).toBe(3);
    // The ONLY search made is the catalogue track's, and no YouTube string reached any search.
    expect(searchFn.mock.calls).toEqual([['tok', { title: 'Catalogue Song', artist: 'C' }]]);
    expect(JSON.stringify(searchFn.mock.calls)).not.toMatch(/YT-SENTINEL|YT-CHANNEL/);
  });

  it('the label is the true origin: youtube for YouTube Content, catalog for anything else (M5, BE-054)', () => {
    for (const [, yt] of youtubeShapes) expect(_originOf(yt)).toBe('youtube');
    expect(_originOf(catalogue)).toBe('catalog');
    expect(_originOf({ title: 'No identity', artist: 'X', uri: null })).toBe('catalog');
  });
});
