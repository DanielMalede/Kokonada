'use strict';

// HX-3 T6 (DEC-122, DEC-040; compliance M4 as amended) — musicProfileService.withoutYoutube, the
// YouTube-free view of a taste profile that generation reads.
//
// It strips every library row the ONE shared predicate calls YouTube Content and re-derives the
// footprint (topGenres / topArtists / genreSet) from what remains with recomputeFootprint — the same
// call youtubeRetention._purge makes — so a YouTube-derived genre or artist cannot survive in the
// ranked lists either. It returns the SAME object when there is nothing to strip (every profile in
// production today), and it never mutates its input: the stored document is never touched.

process.env.ENCRYPTION_KEY = 'a'.repeat(64);

const { withoutYoutube, recomputeFootprint } = require('../app/services/musicProfileService');

const sp = (id, artist, genres, extra = {}) => ({ id, provider: 'spotify', name: `Song ${id}`, artist, genres, affinity: 3, ...extra });
const yt = (id, artist, genres, extra = {}) => ({ id, provider: 'youtube_music', name: `Video ${id}`, artist, genres, affinity: 9, ...extra });

function mergedProfile() {
  // What a merged build stored before DEC-122: YouTube rows in the library, and YouTube-weighted
  // genres and artists ranked into the footprint.
  return {
    _id: 'profile-1',
    userId: 'user-1',
    createdAt: new Date('2026-09-01T00:00:00Z'),
    lastAnalyzed: new Date('2026-09-02T00:00:00Z'),
    tempoBaseline: null,
    energy: null,
    knownArtistIds: ['sp-artist-1'],
    topGenres: ['yt-sentinel-genre', 'nu-disco', 'ambient'],
    topArtists: ['YT Sentinel Channel', 'Spotify Artist'],
    genreSet: ['yt-sentinel-genre', 'nu-disco', 'ambient', 'downtempo'],
    library: [
      yt('vid1', 'YT Sentinel Channel', ['yt-sentinel-genre', 'nu-disco']),
      sp('sp1', 'Spotify Artist', ['ambient']),
      yt('vid2', 'YT Sentinel Channel', ['yt-sentinel-genre']),
      sp('sp2', 'Spotify Artist', ['ambient', 'downtempo']),
    ],
  };
}

const deepFreeze = (o) => {
  Object.freeze(o);
  for (const v of Object.values(o)) if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v);
  return o;
};

describe('musicProfileService.withoutYoutube (HX-3 T6)', () => {
  it('passes a missing profile through (no profile row yet)', () => {
    expect(withoutYoutube(null)).toBeNull();
    expect(withoutYoutube(undefined)).toBeUndefined();
  });

  it('returns the SAME object when no row is YouTube Content — a zero-cost identity', () => {
    const profile = { userId: 'u', topGenres: ['ambient'], topArtists: ['A'], genreSet: ['ambient'], library: [sp('sp1', 'A', ['ambient'])] };
    expect(withoutYoutube(profile)).toBe(profile);
    const empty = { userId: 'u', topGenres: [], library: [] };
    expect(withoutYoutube(empty)).toBe(empty);
    const noLibrary = { userId: 'u', topGenres: ['ambient'] };
    expect(withoutYoutube(noLibrary)).toBe(noLibrary);
  });

  it('strips every youtube_music row and re-derives the footprint from what remains', () => {
    const view = withoutYoutube(mergedProfile());
    expect(view.library.map((t) => t.id)).toEqual(['sp1', 'sp2']);
    const expected = recomputeFootprint(view.library);
    expect(view.topGenres).toEqual(expected.topGenres);
    expect(view.topArtists).toEqual(expected.topArtists);
    expect(view.genreSet).toEqual(expected.genreSet);
    // Nothing YouTube-derived survives anywhere in the view.
    expect(JSON.stringify(view)).not.toMatch(/yt-sentinel-genre|YT Sentinel Channel|nu-disco|vid1|vid2/);
  });

  it('keeps every other field of the profile as it was', () => {
    const view = withoutYoutube(mergedProfile());
    const original = mergedProfile();
    for (const key of ['_id', 'userId', 'createdAt', 'lastAnalyzed', 'tempoBaseline', 'energy', 'knownArtistIds']) {
      expect(view[key]).toEqual(original[key]);
    }
  });

  it('uses the one shared predicate: a youtube: uri or canonicalKey row goes too, whatever its provider label', () => {
    const profile = {
      userId: 'u', topGenres: ['x'], topArtists: ['X'], genreSet: ['x'],
      library: [
        sp('sp1', 'A', ['ambient']),
        sp('mislabelled', 'Leak', ['leak-genre'], { uri: 'youtube:abc' }),
        { id: 'legacy', artist: 'Leak2', genres: ['leak2'], canonicalKey: 'YOUTUBE:def' },
      ],
    };
    const view = withoutYoutube(profile);
    expect(view.library.map((t) => t.id)).toEqual(['sp1']);
    expect(JSON.stringify(view.topGenres.concat(view.topArtists, view.genreSet))).not.toMatch(/leak/i);
  });

  it('a YouTube-only profile becomes an empty taste: no rows, no genres, no artists', () => {
    const profile = { userId: 'u', topGenres: ['yt-sentinel-genre'], topArtists: ['YT Sentinel Channel'], genreSet: ['yt-sentinel-genre'], library: [yt('v', 'YT Sentinel Channel', ['yt-sentinel-genre'])] };
    const view = withoutYoutube(profile);
    expect(view.library).toEqual([]);
    expect(view.topGenres).toEqual([]);
    expect(view.topArtists).toEqual([]);
    expect(view.genreSet).toEqual([]);
  });

  it('never mutates its input (the stored profile is read-only to generation)', () => {
    const input = deepFreeze(mergedProfile());
    const before = JSON.stringify(input);
    expect(() => withoutYoutube(input)).not.toThrow();
    expect(JSON.stringify(input)).toBe(before);
    expect(withoutYoutube(input)).not.toBe(input);
  });
});
