'use strict';

process.env.NODE_ENV = 'test';

const {
  mixPlaylist,
  personalizeWhitelist,
  _orderFamiliar,
  _isNovel,
  _mergeNatural,
} = require('../app/services/playlistMixer');
const { MOOD_DESCRIPTORS } = require('../app/services/moodDescriptors');

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

// ── personalizeWhitelist (personalization is the ABSOLUTE filter) ─────────────

describe('personalizeWhitelist', () => {
  const genreSet = ['afrobeat', 'afro-house'];

  it('keeps a candidate whose genre intersects the user taste', () => {
    const out = personalizeWhitelist([discTrack('keep', { genres: ['afrobeat'] })], { genreSet, knownArtistIds: [] });
    expect(out.map((t) => t.id)).toEqual(['keep']);
  });

  it('keeps a candidate by a known artist even when its genre is off-taste', () => {
    const out = personalizeWhitelist(
      [discTrack('byKnown', { genres: ['rock'], artistIds: ['fav'] })],
      { genreSet, knownArtistIds: ['fav'] },
    );
    expect(out.map((t) => t.id)).toEqual(['byKnown']);
  });

  it('discards an off-taste candidate (Rock for an Afrobeat listener)', () => {
    const out = personalizeWhitelist([discTrack('rock', { genres: ['rock'], artistIds: ['x'] })], { genreSet, knownArtistIds: [] });
    expect(out).toEqual([]);
  });

  it('discards genre-unknown / unverifiable candidates (cannot confirm on-taste)', () => {
    const out = personalizeWhitelist([discTrack('unk', { genres: [], artistIds: ['x'] })], { genreSet, knownArtistIds: [] });
    expect(out).toEqual([]);
  });

  it('from a Beast-Mode-style mixed pool keeps ONLY the on-taste tracks', () => {
    const pool = [
      discTrack('afro1', { genres: ['afrobeat'] }),
      discTrack('rock1', { genres: ['rock'] }),
      discTrack('rock2', { genres: ['hard rock'] }),
      discTrack('afro2', { genres: ['afro-house'] }),
    ];
    const out = personalizeWhitelist(pool, { genreSet, knownArtistIds: [] });
    expect(out.map((t) => t.id).sort()).toEqual(['afro1', 'afro2']);
  });

  it('is case-insensitive on genres and accepts a Set for genreSet', () => {
    const out = personalizeWhitelist([discTrack('keep', { genres: ['Afrobeat'] })], { genreSet: new Set(['afrobeat']), knownArtistIds: [] });
    expect(out.map((t) => t.id)).toEqual(['keep']);
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
    expect(res.familiar.length).toBe(28);  // 55% (lowered from 70% for more freshness)
    expect(res.discovery.length).toBe(22);  // 45%
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
      // Supply must exceed the discovery target (45% of 50 = 22) so the off-taste
      // outlier is never reached as backfill.
      ...Array.from({ length: 30 }, (_, i) => discTrack(`rel${i}`, { genres: ['techno'] })),
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
    // The duplicate id is never resurfaced as discovery, and never double-counted
    // (it may or may not be one of the variety-shuffled familiar picks).
    expect(res.discovery.map(t => t.id)).not.toContain(dupId);
    expect(res.merged.filter(t => t.id === dupId).length).toBeLessThanOrEqual(1);
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

// ── Bug 1: variety — the familiar block must not be a static lock ──────────────

describe('mixPlaylist — familiar variety (Bug 1)', () => {
  const richLibrary   = (n = 60) => Array.from({ length: n }, (_, i) => libTrack(`f${i}`, { affinity: n - i }));
  const richDiscovery = (n = 40) => Array.from({ length: n }, (_, i) => discTrack(`d${i}`));
  const fetchOf = (tracks) => () => Promise.resolve(tracks);

  it('surfaces a different familiar subset across repeated generations', async () => {
    const seen = new Set();
    for (let n = 0; n < 6; n++) {
      const res = await mixPlaylist({
        musicProfile: profile(richLibrary(60)),
        aiParams: AI_PARAMS,
        fetchDiscoveryTracks: fetchOf(richDiscovery(40)),
      });
      res.familiar.forEach((t) => seen.add(t.id));
    }
    // A static 70%/55% block would only ever expose `familiarTarget` (28) ids.
    // The variety window must surface strictly more than that across runs.
    expect(seen.size).toBeGreaterThan(28);
  });

  it('still favours the highest-affinity tracks (window stays near the top)', async () => {
    const res = await mixPlaylist({
      musicProfile: profile(richLibrary(60)),
      aiParams: AI_PARAMS,
      fetchDiscoveryTracks: fetchOf(richDiscovery(40)),
    });
    // Every familiar pick comes from the top-affinity window (~1.7×28 ≈ 48), never
    // the long tail of low-affinity tracks (f48..f59).
    const tailIds = Array.from({ length: 12 }, (_, i) => `f${48 + i}`);
    expect(res.familiar.every((t) => !tailIds.includes(t.id))).toBe(true);
  });
});

// ── Zero-tolerance strict sonic filter ────────────────────────────────────────

describe('mixPlaylist — strict mood filter (zero-tolerance vibe)', () => {
  const fetchOf = (tracks) => () => Promise.resolve(tracks);

  const INTENSE_PARAMS = {
    seed_genres:    ['metal', 'hard rock'],
    allow_genres:   ['metal', 'hard rock', 'drum and bass', 'punk', 'hardcore'],
    exclude_genres: ['acoustic', 'ambient', 'singer-songwriter'],
    seed_artists:   [],
  };

  it('hard-excludes an off-vibe (acoustic) library favourite even at top affinity', async () => {
    const lib = [
      ...Array.from({ length: 20 }, (_, i) => libTrack(`m${i}`, { genres: ['metal'], affinity: 20 - i })),
      libTrack('BALLAD', { genres: ['acoustic', 'singer-songwriter'], affinity: 999 }),
    ];
    const disc = [
      ...Array.from({ length: 20 }, (_, i) => discTrack(`dm${i}`, { genres: ['hard rock'] })),
      discTrack('DISC_BALLAD', { genres: ['acoustic'] }),
    ];
    const res = await mixPlaylist({
      musicProfile: profile(lib, { genreSet: ['metal', 'hard rock'] }),
      aiParams: INTENSE_PARAMS,
      fetchDiscoveryTracks: fetchOf(disc),
    });
    const ids = res.merged.map((t) => t.id);
    expect(ids).not.toContain('BALLAD');       // off-vibe familiar dropped
    expect(ids).not.toContain('DISC_BALLAD');  // off-vibe discovery dropped
  });

  it('with no on-vibe familiar, fills from on-vibe discovery and never off-vibe library', async () => {
    const lib = Array.from({ length: 30 }, (_, i) => libTrack(`a${i}`, { genres: ['acoustic'], affinity: 30 - i }));
    const disc = Array.from({ length: 60 }, (_, i) => discTrack(`dm${i}`, { genres: ['metal'] }));
    const res = await mixPlaylist({
      musicProfile: profile(lib, { genreSet: ['metal'] }),
      aiParams: INTENSE_PARAMS,
      fetchDiscoveryTracks: fetchOf(disc),
    });
    expect(res.familiar).toHaveLength(0);                       // all library is off-vibe
    expect(res.merged.length).toBeGreaterThan(0);              // still produces a playlist
    expect(res.merged.every((t) => !(t.genres || []).includes('acoustic'))).toBe(true);
  });
});

// ── Mood relaxation ladder: never empty for a connected user ──────────────────
// The zero-tolerance allow-list can starve BOTH pools (e.g. "Calm" allows only
// ambient/acoustic/lo-fi but the user listens to pop/soul, and Spotify discovery is
// dead → 0 on-vibe candidates). That produced the "Could not build a playlist from
// the current sources" failure. The ladder backfills from the user's non-excluded
// library while STILL honouring the exclude_genres floor.

describe('mixPlaylist — mood relaxation ladder (never empty for a connected user)', () => {
  const fetchOf = (tracks) => () => Promise.resolve(tracks);

  const CALMISH = {
    seed_genres:    ['ambient'],
    allow_genres:   ['ambient', 'acoustic', 'lo-fi'],   // narrow on-vibe allow-list
    exclude_genres: ['metal', 'edm', 'trap'],           // hard floor
    seed_artists:   [],
  };

  it('backfills from the non-excluded library when allow-list + discovery are both empty', async () => {
    // Diverse library the allow-list doesn't cover (pop), plus a couple of excluded
    // (trap) tracks. Discovery returns nothing (dead Spotify endpoints).
    const lib = [
      ...Array.from({ length: 60 }, (_, i) => libTrack(`pop${i}`, { genres: ['pop'], affinity: 60 - i })),
      libTrack('TRAP', { genres: ['trap'], affinity: 999 }),
    ];
    const res = await mixPlaylist({
      musicProfile: profile(lib, { genreSet: ['pop'] }),
      aiParams: CALMISH,
      fetchDiscoveryTracks: fetchOf([]),
    });
    // Was 0 (empty → playlist_error). Now fills toward 50 from the non-excluded library.
    expect(res.merged.length).toBeGreaterThan(0);
    expect(uniq(res.merged)).toBe(true);
    // The exclude floor still holds even under relaxation: no trap leaks in.
    expect(res.merged.map((t) => t.id)).not.toContain('TRAP');
    expect(res.merged.some((t) => (t.genres || []).includes('trap'))).toBe(false);
  });

  it('still prefers on-vibe allow-list tracks before relaxing', async () => {
    // 5 genuinely on-vibe (ambient) + plenty of off-vibe-but-allowed (pop) tracks.
    const lib = [
      ...Array.from({ length: 5 },  (_, i) => libTrack(`amb${i}`, { genres: ['ambient'], affinity: 100 - i })),
      ...Array.from({ length: 60 }, (_, i) => libTrack(`pop${i}`, { genres: ['pop'],     affinity: 60 - i })),
    ];
    const res = await mixPlaylist({
      musicProfile: profile(lib, { genreSet: ['ambient', 'pop'] }),
      aiParams: CALMISH,
      fetchDiscoveryTracks: fetchOf([]),
    });
    // The on-vibe ambient tracks must be chosen ahead of the relaxed pop backfill.
    const ids = res.merged.map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(['amb0', 'amb1', 'amb2', 'amb3', 'amb4']));
  });
});

// ── strictPersonalize: the vibe pool is constrained to the user's taste ────────

describe('mixPlaylist — strictPersonalize (personalization is the absolute filter)', () => {
  const fetchOf = (tracks) => () => Promise.resolve(tracks);

  it('discards off-taste vibe tracks and never backfills them into the 50 (Afrobeat vs Rock)', async () => {
    // An Afrobeat listener presses "Beast Mode": the vibe pool is mostly Rock with a
    // few Afrobeat tracks. The Rock must be DISCARDED, not demoted-and-backfilled.
    const lib  = Array.from({ length: 5 }, (_, i) => libTrack(`afroLib${i}`, { genres: ['afrobeat'], affinity: 5 - i }));
    const disc = [
      ...Array.from({ length: 3 },  (_, i) => discTrack(`afro${i}`, { genres: ['afrobeat'] })),
      ...Array.from({ length: 40 }, (_, i) => discTrack(`ROCK${i}`, { genres: ['rock'] })),
    ];
    const res = await mixPlaylist({
      musicProfile: profile(lib, { genreSet: ['afrobeat', 'afro-house'] }),
      aiParams: AI_PARAMS,
      fetchDiscoveryTracks: fetchOf(disc),
      strictPersonalize: true,
    });
    // Zero Rock anywhere in the output.
    expect(res.merged.some((t) => (t.genres || []).includes('rock'))).toBe(false);
    // Everything that survives overlaps the user's taste.
    expect(res.merged.every((t) => (t.genres || []).some((g) => ['afrobeat', 'afro-house'].includes(g)))).toBe(true);
  });

  it('keeps the off-taste backfill behaviour when strictPersonalize is off (back-compat)', async () => {
    // Same pool, default behaviour: off-taste outliers may still backfill to fill 50.
    const lib  = Array.from({ length: 5 }, (_, i) => libTrack(`afroLib${i}`, { genres: ['afrobeat'], affinity: 5 - i }));
    const disc = Array.from({ length: 40 }, (_, i) => discTrack(`ROCK${i}`, { genres: ['rock'] }));
    const res = await mixPlaylist({
      musicProfile: profile(lib, { genreSet: ['afrobeat'] }),
      aiParams: AI_PARAMS,
      fetchDiscoveryTracks: fetchOf(disc),
    });
    // Without the strict flag, the old relax-and-backfill still reaches the outliers.
    expect(res.merged.some((t) => (t.genres || []).includes('rock'))).toBe(true);
  });
});

// ── Extreme "Taste vs. Vibe" conflict scenarios (bulletproofing) ───────────────
// These prove the DETERMINISTIC guarantees: (1) personalization is the absolute
// filter (off-taste candidates are discarded), and (2) the mood's exclude_genres are
// a hard sonic floor. Per-track BPM/energy precision is the Groq critic's job (it has
// no audio-features to measure), so these tests assert genre/taste outcomes only.

// Build realistic aiParams straight from the live mood descriptors so the tests track
// production behaviour rather than a hand-authored copy.
function moodParams(key) {
  const d = MOOD_DESCRIPTORS[key];
  return {
    seed_genres:    d.allow_genres.slice(0, 3),
    allow_genres:   d.allow_genres,
    exclude_genres: d.exclude_genres,
    seed_artists:   [],
  };
}

describe('personalizeWhitelist — taste vs. vibe extremes', () => {
  it('S1 Metalhead+CALM: discards generic ambient/piano, keeps a softer track by an affinity artist', () => {
    const genreSet = ['death metal', 'metalcore', 'metal'];
    const pool = [
      discTrack('ambient1', { genres: ['ambient'] }),
      discTrack('piano1',   { genres: ['classical', 'piano'] }),
      discTrack('softByFav', { genres: ['acoustic'], artistIds: ['fav-metal'] }),
    ];
    const out = personalizeWhitelist(pool, { genreSet, knownArtistIds: ['fav-metal'] });
    expect(out.map((t) => t.id)).toEqual(['softByFav']);
  });

  it('S2 PopLover+INTENSE: never injects thrash metal or hard techno; keeps dance-pop', () => {
    const genreSet = ['indie pop', 'pop', 'dance pop', 'acoustic folk'];
    const pool = [
      discTrack('thrash',   { genres: ['thrash metal'] }),
      discTrack('hardtech', { genres: ['hard techno'] }),
      discTrack('dancepop', { genres: ['dance pop'] }),
    ];
    const out = personalizeWhitelist(pool, { genreSet, knownArtistIds: [] });
    expect(out.map((t) => t.id)).toEqual(['dancepop']);
  });

  it('S3 ElectronicFan+low-valence: keeps downtempo/deep-house, drops off-profile candidates', () => {
    const genreSet = ['techno', 'house', 'deep house', 'downtempo', 'electronic'];
    const pool = [
      discTrack('deep', { genres: ['deep house'] }),
      discTrack('down', { genres: ['downtempo'] }),
      discTrack('rock', { genres: ['indie rock'] }),
    ];
    const out = personalizeWhitelist(pool, { genreSet, knownArtistIds: [] });
    expect(out.map((t) => t.id).sort()).toEqual(['deep', 'down']);
  });
});

describe('mixPlaylist — taste vs. vibe extremes (end-to-end taste + mood floor)', () => {
  const fetchOf = (tracks) => () => Promise.resolve(tracks);

  it('S1 Metalhead → CALM: zero metal (incl. death metal), no forced ambient, surfaces affinity-artist softer track', async () => {
    const lib  = Array.from({ length: 10 }, (_, i) => libTrack(`m${i}`, { genres: ['death metal'], affinity: 10 - i }));
    const disc = [
      discTrack('DEATHMETAL', { genres: ['death metal'] }),                    // on-taste but off-vibe → CALM floor must drop it
      discTrack('AMBIENT',    { genres: ['ambient'] }),                        // off-taste generic → personalization discards
      discTrack('softFav',    { genres: ['acoustic'], artistIds: ['ma1'] }),   // softer, by an affinity artist → survives
    ];
    const res = await mixPlaylist({
      musicProfile: profile(lib, { genreSet: ['death metal', 'metal'], knownArtistIds: ['ma1'] }),
      aiParams: moodParams('calm'),
      fetchDiscoveryTracks: fetchOf(disc),
      strictPersonalize: true,
    });
    const ids = res.merged.map((t) => t.id);
    expect(res.merged.some((t) => (t.genres || []).some((g) => g.includes('metal')))).toBe(false); // no metal of any kind
    expect(ids).not.toContain('AMBIENT');  // generic ambient they hate is NOT forced on them
    expect(ids).toContain('softFav');      // a softer track by an artist they love does surface
  });

  it('S2 Pop lover → INTENSE: never injects thrash/techno; surfaces high-energy pop from taste', async () => {
    const lib  = Array.from({ length: 6 }, (_, i) => libTrack(`p${i}`, { genres: ['indie pop'], affinity: 6 - i }));
    const disc = [
      discTrack('THRASH',   { genres: ['thrash metal'] }),
      discTrack('HARDTECH', { genres: ['hard techno'] }),
      ...Array.from({ length: 5 }, (_, i) => discTrack(`pop${i}`, { genres: ['dance pop'] })),
    ];
    const res = await mixPlaylist({
      musicProfile: profile(lib, { genreSet: ['indie pop', 'pop', 'dance pop'], knownArtistIds: [] }),
      aiParams: moodParams('intense'),
      fetchDiscoveryTracks: fetchOf(disc),
      strictPersonalize: true,
    });
    expect(res.merged.some((t) => (t.genres || []).some((g) => g.includes('metal') || g.includes('techno')))).toBe(false);
    expect(res.merged.some((t) => (t.genres || []).includes('dance pop'))).toBe(true);
  });

  it('S3 Electronic fan → low-valence (unwind): drops peak-time big-room/EDM, keeps downtempo/deep house', async () => {
    const lib  = Array.from({ length: 6 }, (_, i) => libTrack(`h${i}`, { genres: ['deep house'], affinity: 6 - i }));
    const disc = [
      discTrack('BIGROOM', { genres: ['big room'] }),
      discTrack('EDM',     { genres: ['edm'] }),
      discTrack('down1',   { genres: ['downtempo'] }),
      discTrack('deep1',   { genres: ['deep house'] }),
    ];
    const res = await mixPlaylist({
      musicProfile: profile(lib, { genreSet: ['techno', 'house', 'deep house', 'downtempo'], knownArtistIds: [] }),
      aiParams: moodParams('unwind'),
      fetchDiscoveryTracks: fetchOf(disc),
      strictPersonalize: true,
    });
    const genres = res.merged.flatMap((t) => t.genres || []);
    expect(genres).not.toContain('big room');
    expect(genres).not.toContain('edm');
    expect(genres.some((g) => g === 'downtempo' || g === 'deep house')).toBe(true);
  });

  it('substring genre floor: compound subgenres are caught by their base exclude (death metal→metal, pop punk→punk)', async () => {
    const disc = [
      discTrack('dm', { genres: ['death metal'] }),
      discTrack('pp', { genres: ['pop punk'] }),
      discTrack('ok', { genres: ['lo-fi'] }),
    ];
    const res = await mixPlaylist({
      musicProfile: profile([], { genreSet: ['death metal', 'pop punk', 'lo-fi'] }),
      aiParams: { seed_genres: ['lo-fi'], allow_genres: ['lo-fi', 'ambient'], exclude_genres: ['metal', 'punk'], seed_artists: [] },
      fetchDiscoveryTracks: fetchOf(disc),
      strictPersonalize: true,
    });
    const ids = res.merged.map((t) => t.id);
    expect(ids).not.toContain('dm');  // 'death metal' caught by 'metal'
    expect(ids).not.toContain('pp');  // 'pop punk' caught by 'punk'
    expect(ids).toContain('ok');
  });

  it('every mood preset enforces its own exclude_genres floor even for an on-taste track', async () => {
    for (const key of Object.keys(MOOD_DESCRIPTORS)) {
      const banned = MOOD_DESCRIPTORS[key].exclude_genres[0];
      const allowed = MOOD_DESCRIPTORS[key].allow_genres[0];
      const disc = [discTrack('bad', { genres: [banned] }), discTrack('ok', { genres: [allowed] })];
      const res = await mixPlaylist({
        musicProfile: profile([], { genreSet: [banned, ...MOOD_DESCRIPTORS[key].allow_genres] }),
        aiParams: moodParams(key),
        fetchDiscoveryTracks: fetchOf(disc),
        strictPersonalize: true,
      });
      expect(res.merged.map((t) => t.id)).not.toContain('bad'); // on-taste but off-vibe → still excluded
    }
  });
});
