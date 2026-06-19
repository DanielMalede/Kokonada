'use strict';

process.env.NODE_ENV = 'test';

const {
  mixPlaylist,
  _selectFamiliarTracks,
  _mergeNatural,
} = require('../app/services/playlistMixer');

// ── Fixtures ───────────────────────────────────────────────────────────────────

function makeLibraryTrack(id, tempo, energy, provider = 'spotify') {
  return { id, tempo, energy, valence: 0.6, acousticness: 0.2, genres: [], artist: 'Artist', provider };
}

function makeDiscoveryTrack(id) {
  return { id, name: `Discovery ${id}`, provider: 'spotify' };
}

const AI_PARAMS = {
  target_bpm:         128,
  target_energy:      0.8,
  target_valence:     0.7,
  target_acousticness: 0.1,
  seed_genres:        ['electronic'],
  seed_artists:       [],
};

// Library with varied BPM/energy to test all fallback tiers
const LIBRARY = [
  makeLibraryTrack('f1', 128, 0.80), // tight match
  makeLibraryTrack('f2', 130, 0.85), // tight match
  makeLibraryTrack('f3', 120, 0.75), // tight match
  makeLibraryTrack('f4', 145, 0.90), // relaxed match (BPM delta 17)
  makeLibraryTrack('f5', 100, 0.60), // relaxed match (energy delta 0.2)
  makeLibraryTrack('f6',  80, 0.40), // broadest fallback only
  makeLibraryTrack('yt1', null, null, 'youtube_music'), // no tempo — must be excluded
];

// ── _selectFamiliarTracks ──────────────────────────────────────────────────────

describe('_selectFamiliarTracks', () => {
  it('returns empty array when library is empty', () => {
    expect(_selectFamiliarTracks([], AI_PARAMS, 14)).toEqual([]);
  });

  it('excludes tracks with null tempo (YouTube tracks)', () => {
    const result = _selectFamiliarTracks(LIBRARY, AI_PARAMS, 10);
    const ids = result.map(t => t.id);
    expect(ids).not.toContain('yt1');
  });

  it('selects tight matches (BPM ±15, energy ±0.2) first', () => {
    const result = _selectFamiliarTracks(LIBRARY, AI_PARAMS, 3);
    const ids = result.map(t => t.id);
    // f1, f2, f3 are tight matches
    expect(ids).toContain('f1');
    expect(ids).toContain('f2');
    expect(ids).toContain('f3');
  });

  it('falls back to relaxed match when tight match count < familiarTarget', () => {
    // Only 3 tight matches exist; ask for 5 → should include relaxed matches
    const result = _selectFamiliarTracks(LIBRARY, AI_PARAMS, 5);
    expect(result.length).toBe(5);
    const ids = result.map(t => t.id);
    // Should pull in relaxed matches f4 and f5
    expect(ids.some(id => ['f4', 'f5'].includes(id))).toBe(true);
  });

  it('falls back to broadest match sorted by BPM proximity when relaxed still insufficient', () => {
    // Ask for more tracks than tight + relaxed can provide (only 5 non-null-tempo tracks match)
    const result = _selectFamiliarTracks(LIBRARY, AI_PARAMS, 6);
    expect(result.length).toBe(6);
    const ids = result.map(t => t.id);
    expect(ids).toContain('f6'); // broadest fallback
  });

  it('never returns more than familiarTarget tracks', () => {
    const result = _selectFamiliarTracks(LIBRARY, AI_PARAMS, 3);
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it('returns all available tracks when library has fewer than familiarTarget', () => {
    const small = [makeLibraryTrack('a', 128, 0.8), makeLibraryTrack('b', 130, 0.82)];
    const result = _selectFamiliarTracks(small, AI_PARAMS, 14);
    expect(result.length).toBe(2);
  });

  it('never includes youtube_music tracks (null tempo)', () => {
    const ytOnly = [makeLibraryTrack('yt1', null, null, 'youtube_music')];
    const result = _selectFamiliarTracks(ytOnly, AI_PARAMS, 5);
    expect(result).toEqual([]);
  });
});

// ── _mergeNatural ──────────────────────────────────────────────────────────────

describe('_mergeNatural', () => {
  it('returns empty array when both inputs are empty', () => {
    expect(_mergeNatural([], [])).toEqual([]);
  });

  it('returns only familiar tracks when discovery is empty', () => {
    const f = [makeLibraryTrack('f1', 128, 0.8), makeLibraryTrack('f2', 130, 0.82)];
    const result = _mergeNatural(f, []);
    expect(result).toEqual(f);
  });

  it('returns only discovery tracks when familiar is empty', () => {
    const d = [makeDiscoveryTrack('d1'), makeDiscoveryTrack('d2')];
    const result = _mergeNatural([], d);
    expect(result).toEqual(d);
  });

  it('interleaves in 2:1 pattern [f, f, d, f, f, d, ...]', () => {
    const f = ['f1', 'f2', 'f3', 'f4'].map(id => makeLibraryTrack(id, 128, 0.8));
    const d = ['d1', 'd2'].map(id => makeDiscoveryTrack(id));
    const result = _mergeNatural(f, d);
    // Expected: f1, f2, d1, f3, f4, d2
    expect(result[0].id).toBe('f1');
    expect(result[1].id).toBe('f2');
    expect(result[2].id).toBe('d1');
    expect(result[3].id).toBe('f3');
    expect(result[4].id).toBe('f4');
    expect(result[5].id).toBe('d2');
  });

  it('appends remaining familiar tracks when discovery is exhausted', () => {
    const f = ['f1', 'f2', 'f3', 'f4', 'f5'].map(id => makeLibraryTrack(id, 128, 0.8));
    const d = [makeDiscoveryTrack('d1')];
    const result = _mergeNatural(f, d);
    expect(result).toHaveLength(6);
    // All familiar tracks must be present
    ['f1', 'f2', 'f3', 'f4', 'f5'].forEach(id => {
      expect(result.map(t => t.id)).toContain(id);
    });
  });

  it('appends remaining discovery tracks when familiar is exhausted', () => {
    const f = ['f1', 'f2'].map(id => makeLibraryTrack(id, 128, 0.8));
    const d = ['d1', 'd2', 'd3', 'd4'].map(id => makeDiscoveryTrack(id));
    const result = _mergeNatural(f, d);
    expect(result).toHaveLength(6);
    ['d1', 'd2', 'd3', 'd4'].forEach(id => {
      expect(result.map(t => t.id)).toContain(id);
    });
  });

  it('total length always equals familiar.length + discovery.length', () => {
    const f = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map(i => makeLibraryTrack(`f${i}`, 128, 0.8));
    const d = [1, 2, 3, 4, 5, 6].map(i => makeDiscoveryTrack(`d${i}`));
    const result = _mergeNatural(f, d);
    expect(result).toHaveLength(f.length + d.length);
  });
});

// ── mixPlaylist ────────────────────────────────────────────────────────────────

describe('mixPlaylist', () => {
  const discoveryTracks = [1, 2, 3, 4, 5, 6].map(i => makeDiscoveryTrack(`d${i}`));
  const fetchDiscoveryTracks = jest.fn().mockResolvedValue(discoveryTracks);
  const musicProfile = { library: LIBRARY };

  beforeEach(() => fetchDiscoveryTracks.mockClear());

  it('calls fetchDiscoveryTracks with the aiParams', async () => {
    await mixPlaylist({ musicProfile, aiParams: AI_PARAMS, fetchDiscoveryTracks });
    expect(fetchDiscoveryTracks).toHaveBeenCalledWith(AI_PARAMS);
  });

  it('returns familiar, discovery, and merged arrays', async () => {
    const result = await mixPlaylist({ musicProfile, aiParams: AI_PARAMS, fetchDiscoveryTracks });
    expect(result).toHaveProperty('familiar');
    expect(result).toHaveProperty('discovery');
    expect(result).toHaveProperty('merged');
  });

  it('merged length equals familiar + discovery lengths', async () => {
    const result = await mixPlaylist({ musicProfile, aiParams: AI_PARAMS, fetchDiscoveryTracks });
    expect(result.merged).toHaveLength(result.familiar.length + result.discovery.length);
  });

  it('enforces 70/30 split for playlistSize=20', async () => {
    const result = await mixPlaylist({
      musicProfile, aiParams: AI_PARAMS, fetchDiscoveryTracks, playlistSize: 20,
    });
    expect(result.familiar.length).toBeLessThanOrEqual(14); // 70% of 20
    expect(result.discovery.length).toBeLessThanOrEqual(6); // 30% of 20
  });

  it('enforces 70/30 split for playlistSize=10', async () => {
    const result = await mixPlaylist({
      musicProfile, aiParams: AI_PARAMS, fetchDiscoveryTracks, playlistSize: 10,
    });
    expect(result.familiar.length).toBeLessThanOrEqual(7);  // 70% of 10
    expect(result.discovery.length).toBeLessThanOrEqual(3); // 30% of 10
  });

  it('familiar tracks come from the library (not discovery)', async () => {
    const result = await mixPlaylist({ musicProfile, aiParams: AI_PARAMS, fetchDiscoveryTracks });
    const libraryIds = LIBRARY.map(t => t.id);
    result.familiar.forEach(t => expect(libraryIds).toContain(t.id));
  });

  it('discovery tracks come from fetchDiscoveryTracks', async () => {
    const result = await mixPlaylist({ musicProfile, aiParams: AI_PARAMS, fetchDiscoveryTracks });
    const discoveryIds = discoveryTracks.map(t => t.id);
    result.discovery.forEach(t => expect(discoveryIds).toContain(t.id));
  });

  it('returns empty merged when library is empty and discovery returns empty', async () => {
    fetchDiscoveryTracks.mockResolvedValueOnce([]);
    const result = await mixPlaylist({
      musicProfile: { library: [] },
      aiParams: AI_PARAMS,
      fetchDiscoveryTracks,
    });
    expect(result.merged).toEqual([]);
    expect(result.familiar).toEqual([]);
    expect(result.discovery).toEqual([]);
  });

  it('uses all available library tracks when library < familiarTarget', async () => {
    const tinyLibrary = { library: [makeLibraryTrack('only1', 128, 0.8)] };
    const result = await mixPlaylist({
      musicProfile: tinyLibrary, aiParams: AI_PARAMS, fetchDiscoveryTracks,
    });
    expect(result.familiar).toHaveLength(1);
  });

  it('fills entirely from discovery when library has no Spotify tracks', async () => {
    const ytOnlyLibrary = { library: [makeLibraryTrack('yt1', null, null, 'youtube_music')] };
    const result = await mixPlaylist({
      musicProfile: ytOnlyLibrary, aiParams: AI_PARAMS, fetchDiscoveryTracks,
    });
    expect(result.familiar).toHaveLength(0);
    expect(result.discovery.length).toBeGreaterThan(0);
  });

  it('propagates errors from fetchDiscoveryTracks', async () => {
    fetchDiscoveryTracks.mockRejectedValueOnce(new Error('Spotify 500'));
    await expect(
      mixPlaylist({ musicProfile, aiParams: AI_PARAMS, fetchDiscoveryTracks })
    ).rejects.toThrow('Spotify 500');
  });
});
