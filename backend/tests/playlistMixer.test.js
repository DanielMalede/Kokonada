'use strict';

process.env.NODE_ENV = 'test';

const {
  mixPlaylist,
  _orderFamiliar,
  _isNovel,
  _mergeNatural,
} = require('../app/services/playlistMixer');

// ── Fixtures ───────────────────────────────────────────────────────────────────

// Library track now carries genres + affinity (listening-history model). tempo/
// energy are gone — matching is genre/affinity based.
function libTrack(id, { genres = ['electronic'], affinity = 1, provider = 'spotify', artistIds } = {}) {
  return {
    id, name: `Lib ${id}`, uri: `spotify:track:${id}`,
    genres, affinity, provider, artistIds: artistIds ?? [`la-${id}`],
  };
}

// Discovery candidate as the handler hands it to the mixer: already tagged with
// the artists' genres + artistIds so the mixer can judge relevance/novelty.
function discTrack(id, { genres = ['electronic'], artistIds, provider } = {}) {
  return {
    id, name: `Disc ${id}`, genres, artistIds: artistIds ?? [`da-${id}`],
    ...(provider ? { provider } : {}),
  };
}

const AI_PARAMS = { seed_genres: ['electronic'], seed_artists: [] };

const PROFILE_GENRES = ['electronic', 'techno', 'house'];

function profile(library, { genreSet = PROFILE_GENRES, knownArtistIds = [] } = {}) {
  return { library, genreSet, knownArtistIds };
}

const uniq = (arr) => new Set(arr.map(t => t.id)).size === arr.length;

// ── _orderFamiliar ───────────────────────────────────────────────────────────

describe('_orderFamiliar', () => {
  it('returns [] for an empty library', () => {
    expect(_orderFamiliar([], new Set(['electronic']), null)).toEqual([]);
  });

  it('orders mood-genre matches ahead of non-matching tracks', () => {
    const lib = [
      libTrack('miss', { genres: ['polka'] }),
      libTrack('hit', { genres: ['electronic'] }),
    ];
    const out = _orderFamiliar(lib, new Set(['electronic']), null);
    expect(out[0].id).toBe('hit');
  });

  it('sorts by affinity within a tier (favourites first)', () => {
    const lib = [
      libTrack('low', { genres: ['electronic'], affinity: 1 }),
      libTrack('high', { genres: ['electronic'], affinity: 9 }),
    ];
    const out = _orderFamiliar(lib, new Set(['electronic']), null);
    expect(out.map(t => t.id)).toEqual(['high', 'low']);
  });

  it('filters out tracks that do not match the active provider', () => {
    const lib = [
      libTrack('sp', { provider: 'spotify' }),
      libTrack('yt', { provider: 'youtube_music' }),
    ];
    const out = _orderFamiliar(lib, new Set(['electronic']), 'spotify');
    expect(out.map(t => t.id)).toEqual(['sp']);
  });
});

// ── _isNovel ─────────────────────────────────────────────────────────────────

describe('_isNovel', () => {
  it('is false when the track is already in the library', () => {
    expect(_isNovel(discTrack('t1'), new Set(['t1']), new Set())).toBe(false);
  });

  it('is false when the artist is already known', () => {
    expect(_isNovel(discTrack('t1', { artistIds: ['a1'] }), new Set(), new Set(['a1']))).toBe(false);
  });

  it('is true for a genuinely new track + artist', () => {
    expect(_isNovel(discTrack('t1', { artistIds: ['a1'] }), new Set(['other']), new Set(['known']))).toBe(true);
  });
});

// ── _mergeNatural (unchanged 2:1 interleave) ──────────────────────────────────

describe('_mergeNatural', () => {
  it('interleaves in a 2:1 pattern [f, f, d, f, f, d, ...]', () => {
    const f = ['f1', 'f2', 'f3', 'f4'].map(id => libTrack(id));
    const d = ['d1', 'd2'].map(id => discTrack(id));
    const out = _mergeNatural(f, d);
    expect(out.map(t => t.id)).toEqual(['f1', 'f2', 'd1', 'f3', 'f4', 'd2']);
  });

  it('total length equals familiar + discovery', () => {
    const f = Array.from({ length: 35 }, (_, i) => libTrack(`f${i}`));
    const d = Array.from({ length: 15 }, (_, i) => discTrack(`d${i}`));
    expect(_mergeNatural(f, d)).toHaveLength(50);
  });
});

// ── mixPlaylist — always exactly 50, taste-filtered discovery ─────────────────

describe('mixPlaylist (50-song guarantee + discovery relevance)', () => {
  const richLibrary   = (n = 60) => Array.from({ length: n }, (_, i) => libTrack(`f${i}`, { affinity: n - i }));
  const richDiscovery = (n = 40) => Array.from({ length: n }, (_, i) => discTrack(`d${i}`));
  const fetchOf = (tracks) => () => Promise.resolve(tracks);

  it('2.1 returns exactly 50 unique tracks from a rich library + discovery', async () => {
    const res = await mixPlaylist({
      musicProfile: profile(richLibrary()),
      aiParams: AI_PARAMS,
      fetchDiscoveryTracks: fetchOf(richDiscovery()),
    });
    expect(res.merged).toHaveLength(50);
    expect(uniq(res.merged)).toBe(true);
    expect(res.familiar.length).toBe(35);  // 70%
    expect(res.discovery.length).toBe(15);  // 30%
  });

  it('2.2 fills 50 entirely from discovery when the library is empty', async () => {
    const res = await mixPlaylist({
      musicProfile: profile([]),
      aiParams: AI_PARAMS,
      fetchDiscoveryTracks: fetchOf(richDiscovery(80)),
    });
    expect(res.merged).toHaveLength(50);
    expect(uniq(res.merged)).toBe(true);
    expect(res.familiar).toHaveLength(0);
  });

  it('2.3 relaxes + backfills to 50 with a tiny library and thin relevant discovery', async () => {
    // 3 familiar; 5 relevant + 60 "looser" (genre-unknown) discovery candidates.
    const lib = [libTrack('f0'), libTrack('f1'), libTrack('f2')];
    const disc = [
      ...Array.from({ length: 5 }, (_, i) => discTrack(`rel${i}`)),
      ...Array.from({ length: 60 }, (_, i) => discTrack(`loose${i}`, { genres: [] })),
    ];
    const res = await mixPlaylist({
      musicProfile: profile(lib),
      aiParams: AI_PARAMS,
      fetchDiscoveryTracks: fetchOf(disc),
    });
    expect(res.merged).toHaveLength(50);
    expect(uniq(res.merged)).toBe(true);
  });

  it('2.6 returns all unique it can when fewer than 50 exist worldwide', async () => {
    const res = await mixPlaylist({
      musicProfile: profile([libTrack('f0'), libTrack('f1')]),
      aiParams: AI_PARAMS,
      fetchDiscoveryTracks: fetchOf(richDiscovery(10)),
    });
    expect(res.merged).toHaveLength(12); // 2 familiar + 10 discovery, no padding/dupes
    expect(uniq(res.merged)).toBe(true);
  });

  it('4.4 drops discovery outliers whose genres are outside the user taste', async () => {
    const disc = [
      ...Array.from({ length: 20 }, (_, i) => discTrack(`rel${i}`, { genres: ['techno'] })),
      discTrack('OUTLIER', { genres: ['polka', 'death metal'] }),
    ];
    const res = await mixPlaylist({
      musicProfile: profile(richLibrary()),
      aiParams: AI_PARAMS,
      fetchDiscoveryTracks: fetchOf(disc),
    });
    // With enough relevant supply, the off-taste outlier is never reached.
    expect(res.merged.map(t => t.id)).not.toContain('OUTLIER');
  });

  it('4.5 excludes discovery tracks already in the library (non-novel)', async () => {
    const lib = richLibrary();
    const dupId = lib[0].id;
    const disc = [discTrack(dupId), ...richDiscovery()];
    const res = await mixPlaylist({
      musicProfile: profile(lib),
      aiParams: AI_PARAMS,
      fetchDiscoveryTracks: fetchOf(disc),
    });
    // The duplicate id appears at most once (as a familiar track, never as discovery).
    expect(res.discovery.map(t => t.id)).not.toContain(dupId);
    expect(res.merged.filter(t => t.id === dupId)).toHaveLength(1);
  });

  it('4.5b excludes discovery by a known artist (novelty against baseline)', async () => {
    const res = await mixPlaylist({
      musicProfile: profile(richLibrary(), { knownArtistIds: ['known-artist'] }),
      aiParams: AI_PARAMS,
      fetchDiscoveryTracks: fetchOf([
        discTrack('byKnown', { artistIds: ['known-artist'] }),
        ...richDiscovery(),
      ]),
    });
    expect(res.discovery.map(t => t.id)).not.toContain('byKnown');
  });

  it('4.6 keeps discovery whose genre is adjacent (in the user genreSet)', async () => {
    const res = await mixPlaylist({
      musicProfile: profile([], { genreSet: ['electronic', 'techno'] }),
      aiParams: AI_PARAMS,
      fetchDiscoveryTracks: fetchOf([discTrack('adj', { genres: ['techno'] })]),
    });
    expect(res.discovery.map(t => t.id)).toContain('adj');
  });

  it('filters familiar tracks to the active provider so URIs stay valid', async () => {
    const lib = [
      ...Array.from({ length: 40 }, (_, i) => libTrack(`sp${i}`, { provider: 'spotify', affinity: 40 - i })),
      libTrack('yt', { provider: 'youtube_music' }),
    ];
    const res = await mixPlaylist({
      musicProfile: profile(lib),
      aiParams: AI_PARAMS,
      fetchDiscoveryTracks: fetchOf([]),
      provider: 'spotify',
    });
    expect(res.familiar.map(t => t.id)).not.toContain('yt');
  });

  it('propagates errors from fetchDiscoveryTracks', async () => {
    await expect(mixPlaylist({
      musicProfile: profile(richLibrary()),
      aiParams: AI_PARAMS,
      fetchDiscoveryTracks: () => Promise.reject(new Error('Spotify 500')),
    })).rejects.toThrow('Spotify 500');
  });
});
