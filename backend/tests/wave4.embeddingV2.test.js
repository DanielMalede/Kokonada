'use strict';

process.env.NODE_ENV = 'test';

// W4-014 (B3) — embedding v2 PURE CORE.
//
// What these pins protect, in one line each:
//   D19 (a) genre tag-count crushes the audio dims  -> the two blocks are normalised SEPARATELY,
//       so the audio half of the vector is byte-identical no matter how many genres are attached.
//   D19 (b) unweighted genre bag                    -> IDF weights (SM.16), computed over the mbid:
//       slice only, so a genre everyone carries cannot outvote a genre that discriminates.
//   D19 (c) linear bpm dim                          -> sin/cos(2*pi*log2 bpm) puts an octave pair at the
//       SAME point on the tempo circle, which is D18/M.10's octave equivalence expressed as geometry.
//   W4-D21 an unmeasured dim read as a measured 0   -> every audio dim ABSTAINS to the block origin,
//       and a track with no evidence at all embeds to null rather than to a confident unit vector.

const fc = require('fast-check');

const {
  buildVector, buildVectorV2, cosine, DIM, DIM_V2,
  AUDIO_DIMS, GENRE_DIMS_V2, AUDIO_WEIGHT, GENRE_WEIGHT,
} = require('../app/services/vector/embedding');
const idfStats = require('../app/services/vector/idfStats');

const FEATURES = { bpm: 120, energy: 0.7, valence: 0.6, acousticness: 0.2, danceability: 0.7, loudness: -7 };

const norm = (v) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
const audioOf = (v) => v.slice(0, AUDIO_DIMS);
const genreOf = (v) => v.slice(AUDIO_DIMS);

// A hand-built stats blob: 100 genre-carrying documents, `house` in 50 of them, `sludge` in 1.
const STATS = { v: 1, n: 100, df: { house: 50, sludge: 1, techno: 25 }, computedAt: 0 };

describe('W4-014 · idfStats.weight (SM.16 w_g = log(1 + N/df_g))', () => {
  it('is the literal SM.16 formula for a genre the corpus has seen', () => {
    expect(idfStats.weight('house', STATS)).toBeCloseTo(Math.log(1 + 100 / 50), 12);
    expect(idfStats.weight('techno', STATS)).toBeCloseTo(Math.log(1 + 100 / 25), 12);
  });

  it('ranks a rare genre above a common one (that IS the point of the weighting)', () => {
    expect(idfStats.weight('sludge', STATS)).toBeGreaterThan(idfStats.weight('techno', STATS));
    expect(idfStats.weight('techno', STATS)).toBeGreaterThan(idfStats.weight('house', STATS));
  });

  it('CAPS an unseen genre (df = 0) instead of returning Infinity', () => {
    const w = idfStats.weight('never-seen-before', STATS);
    expect(Number.isFinite(w)).toBe(true);
    expect(w).toBeCloseTo(idfStats.IDF_MAX, 12);
    // and the cap is the "1 document in 100" weight, not an arbitrary number
    expect(idfStats.IDF_MAX).toBeCloseTo(Math.log(1 + 1 / idfStats.MIN_DF_RATIO), 12);
  });

  it('caps a genuinely-rare genre at the same ceiling, so df=1 and df=0 cannot diverge unboundedly', () => {
    const huge = { v: 1, n: 1e9, df: { blip: 1 }, computedAt: 0 };
    expect(idfStats.weight('blip', huge)).toBeCloseTo(idfStats.IDF_MAX, 12);
  });

  it('FAIL-SOFT: an empty corpus (n = 0) weights every genre 0, so v2 degrades to audio-only', () => {
    for (const stats of [null, undefined, {}, { n: 0, df: {} }, { n: 5, df: null }]) {
      expect(idfStats.weight('house', stats)).toBe(0);
    }
  });

  it('normalises the genre key the way the corpus stores it (lowercase, trimmed)', () => {
    expect(idfStats.weight('  HOUSE ', STATS)).toBe(idfStats.weight('house', STATS));
  });

  it('never returns a negative, NaN or Infinite weight for junk input (S8)', () => {
    const junk = [
      ['house', { n: -5, df: { house: 50 } }],
      ['house', { n: NaN, df: { house: 50 } }],
      ['house', { n: Infinity, df: { house: 50 } }],
      ['house', { n: 100, df: { house: -3 } }],
      ['house', { n: 100, df: { house: NaN } }],
      ['house', { n: 100, df: { house: 1e9 } }], // df > n
      [null, STATS], ['', STATS], [42, STATS], [{}, STATS],
    ];
    for (const [g, s] of junk) {
      const w = idfStats.weight(g, s);
      expect(Number.isFinite(w)).toBe(true);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(idfStats.IDF_MAX);
    }
  });
});

describe('W4-014 · idfStats.compute (ADR-0011/0012 containment)', () => {
  const rows = [
    { recordingKey: 'mbid:1', genres: ['house', 'techno'] },
    { recordingKey: 'mbid:2', genres: ['house'] },
    { recordingKey: 'mbid:3', genres: [] },                       // genre-less: not a document for IDF
    { recordingKey: 'spotify:x', genres: ['house', 'pop', 'pop'] }, // MUST NOT contribute
    { recordingKey: 'youtube:y', genres: ['pop'] },                 // MUST NOT contribute
  ];
  it('counts document frequencies over mbid: rows ONLY — no Spotify/YouTube Content in a persisted artifact', async () => {
    const stats = await idfStats.compute({ rows });
    expect(stats.df).toEqual({ house: 2, techno: 1 });
    expect(stats.df.pop).toBeUndefined();
  });

  it('N is the number of GENRE-CARRYING mbid documents, not the whole corpus', async () => {
    // mbid:3 has no genres, so it is not a document the IDF can discriminate within.
    const stats = await idfStats.compute({ rows });
    expect(stats.n).toBe(2);
  });

  it('counts a genre ONCE per document even if the row lists it twice', async () => {
    const stats = await idfStats.compute({ rows: [{ recordingKey: 'mbid:1', genres: ['house', 'House', ' house '] }] });
    expect(stats.df).toEqual({ house: 1 });
  });

  it('carries an S15 version field and a computedAt stamp taken from the injected clock', async () => {
    const stats = await idfStats.compute({ rows, now: 1234 });
    expect(stats.v).toBe(1);
    expect(stats.computedAt).toBe(1234);
  });

  it('an all-genre-less corpus yields n = 0 — the fail-soft that keeps the genre block exactly zero', async () => {
    const stats = await idfStats.compute({ rows: [{ recordingKey: 'mbid:1', genres: [] }] });
    expect(stats.n).toBe(0);
    expect(idfStats.weight('house', stats)).toBe(0);
  });

  it('reads the mbid: slice through the injected model when no rows are supplied', async () => {
    const seen = {};
    const model = {
      find: (filter, projection) => {
        Object.assign(seen, { filter, projection });
        return { lean: async () => rows.filter(r => r.recordingKey.startsWith('mbid:')) };
      },
    };
    const stats = await idfStats.compute({ model });
    expect(String(seen.filter.recordingKey)).toContain('^mbid:');
    expect(seen.projection).toEqual({ genres: 1, _id: 0 });
    expect(stats.df).toEqual({ house: 2, techno: 1 });
  });
});

describe('W4-014 · idfStats cache seam', () => {
  afterEach(() => idfStats.reset());

  it('use() injects a blob that peek() returns without touching the database', async () => {
    idfStats.use(STATS);
    await expect(idfStats.peek()).resolves.toBe(STATS);
  });

  it('reset() clears the injection', async () => {
    idfStats.use(STATS);
    idfStats.reset();
    await expect(idfStats.peek({ loader: async () => ({ v: 1, n: 1, df: { a: 1 }, computedAt: 0 }) }))
      .resolves.toMatchObject({ n: 1 });
  });

  it('peek() calls the loader ONCE inside the TTL and re-loads after it', async () => {
    let calls = 0;
    const loader = async () => { calls++; return { v: 1, n: calls, df: {}, computedAt: 0 }; };
    let clock = 0;
    const opts = () => ({ loader, now: clock, ttlMs: 1000 });
    await idfStats.peek(opts());
    await idfStats.peek(opts());
    expect(calls).toBe(1);
    clock = 1001;
    await idfStats.peek(opts());
    expect(calls).toBe(2);
  });

  it('NEVER throws into a caller: a failing loader degrades to the audio-only empty blob', async () => {
    const stats = await idfStats.peek({ loader: async () => { throw new Error('atlas down'); } });
    expect(stats.n).toBe(0);
    expect(idfStats.weight('house', stats)).toBe(0);
  });
});

describe('W4-014 · buildVectorV2 shape and block geometry', () => {
  it('is 135 dims: a 7-dim audio block and a 128-dim genre block', () => {
    expect(AUDIO_DIMS).toBe(7);
    expect(GENRE_DIMS_V2).toBe(128);
    expect(DIM_V2).toBe(135);
    expect(buildVectorV2(FEATURES, [], { idf: STATS })).toHaveLength(DIM_V2);
  });

  it('is deterministic', () => {
    const a = buildVectorV2(FEATURES, ['house', 'techno'], { idf: STATS });
    const b = buildVectorV2(FEATURES, ['house', 'techno'], { idf: STATS });
    expect(a).toEqual(b);
  });

  it('normalises the two blocks SEPARATELY: |audio| = 0.8, |genre| = 0.6, |v| = 1', () => {
    const v = buildVectorV2(FEATURES, ['house'], { idf: STATS });
    expect(norm(audioOf(v))).toBeCloseTo(AUDIO_WEIGHT, 12);
    expect(norm(genreOf(v))).toBeCloseTo(GENRE_WEIGHT, 12);
    expect(norm(v)).toBeCloseTo(1, 12);
    expect(AUDIO_WEIGHT).toBe(0.8);
    expect(GENRE_WEIGHT).toBe(0.6);
  });

  it('EVERY emitted vector is a unit vector, whether or not it carries genres', () => {
    for (const genres of [[], ['house'], ['house', 'techno']]) {
      expect(norm(buildVectorV2(FEATURES, genres, { idf: STATS }))).toBeCloseTo(1, 12);
    }
    expect(norm(buildVectorV2({}, ['house'], { idf: STATS }))).toBeCloseTo(1, 12);
  });

  it('a genre-less track has an EXACTLY zero genre block, so genre-less cosine equals audio-only cosine', () => {
    const a = buildVectorV2(FEATURES, [], { idf: STATS });
    const b = buildVectorV2({ ...FEATURES, energy: 0.4 }, [], { idf: STATS });
    expect(genreOf(a).every(x => x === 0)).toBe(true);
    // cosine over the composed vectors == cosine over the bare audio unit vectors, EXACTLY —
    // this is the property that makes v2 a superset of the ~98% genre-less corpus rather than
    // a rescaling of it (see the renormalisation note in embedding.js).
    const unit = (v) => { const n = norm(audioOf(v)); return audioOf(v).map(x => x / n); };
    expect(cosine(a, b)).toBeCloseTo(cosine(unit(a), unit(b)), 12);
  });

  it('annotation coverage is not relevance: a genre-less and a genre-tagged track stay comparable', () => {
    const bare = buildVectorV2(FEATURES, [], { idf: STATS });
    const tagged = buildVectorV2(FEATURES, ['house'], { idf: STATS });
    // identical audio, no genre agreement possible → exactly the audio weight, not 0.64
    expect(cosine(bare, tagged)).toBeCloseTo(AUDIO_WEIGHT, 12);
  });
});

describe('W4-014 · D19 (a) tag-count invariance — the crush is structurally impossible', () => {
  it('the AUDIO block is byte-identical whether a track carries 1 genre or 12', () => {
    const one = buildVectorV2(FEATURES, ['house'], { idf: STATS });
    const many = buildVectorV2(
      FEATURES,
      ['house', 'techno', 'sludge', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'],
      { idf: STATS },
    );
    expect(audioOf(many)).toEqual(audioOf(one));
  });

  it('v1 does NOT have that property — this is the defect being closed, measured not asserted', () => {
    const one = buildVector(FEATURES, ['house']);
    const many = buildVector(FEATURES, ['house', 'techno', 'sludge', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']);
    expect(many.slice(0, 6)).not.toEqual(one.slice(0, 6));
    expect(many[1]).toBeLessThan(one[1] * 0.75); // energy dim visibly crushed by tag count
  });

  it('a duplicated genre does not double-weight its bin', () => {
    const once = buildVectorV2(FEATURES, ['house'], { idf: STATS });
    const twice = buildVectorV2(FEATURES, ['house', 'HOUSE', ' house '], { idf: STATS });
    expect(twice).toEqual(once);
  });
});

describe('W4-014 · D19 (c) octave equivalence lives in the geometry', () => {
  it('an octave-neighbour tempo lands on the SAME point of the tempo circle', () => {
    const slow = buildVectorV2({ ...FEATURES, bpm: 87 }, ['house'], { idf: STATS });
    const fast = buildVectorV2({ ...FEATURES, bpm: 174 }, ['house'], { idf: STATS });
    expect(cosine(slow, fast)).toBeCloseTo(1, 10);
  });

  it('octave-neighbour cosine >= same-tempo-different-genre cosine (the W4-014 DoD pin)', () => {
    const base = buildVectorV2({ ...FEATURES, bpm: 87 }, ['house'], { idf: STATS });
    const octave = buildVectorV2({ ...FEATURES, bpm: 174 }, ['house'], { idf: STATS });
    const otherGenre = buildVectorV2({ ...FEATURES, bpm: 87 }, ['sludge'], { idf: STATS });
    expect(cosine(base, octave)).toBeGreaterThanOrEqual(cosine(base, otherGenre));
    // and the genre block is what separates them: 0.8^2 of the mass still agrees
    expect(cosine(base, otherGenre)).toBeCloseTo(AUDIO_WEIGHT * AUDIO_WEIGHT, 10);
  });

  it('a tempo a TRUE fifth away is NOT treated as equivalent (the fold is octaves, not everything)', () => {
    const base = buildVectorV2({ bpm: 120 }, [], { idf: STATS });
    const fifth = buildVectorV2({ bpm: 180 }, [], { idf: STATS });
    expect(cosine(base, fifth)).toBeLessThan(0.99);
  });
});

describe('W4-014 · abstention (W4-D21 class) — an unmeasured dim is never a measured zero', () => {
  it('an unmeasured audio dim sits at the block origin, contributing nothing to any dot product', () => {
    const v = buildVectorV2({ energy: 1 }, [], { idf: STATS });
    // energy is dim 0; valence/acousticness/danceability/loudness and the tempo pair abstain
    expect(v.slice(1, AUDIO_DIMS).every(x => x === 0)).toBe(true);
    expect(v[0]).toBeCloseTo(1, 12); // genre-less -> the audio block IS the unit vector
  });

  it('an explicit null loudness embeds identically to an ABSENT loudness (not to 0 dB)', () => {
    const withNull = buildVectorV2({ energy: 0.7, valence: 0.6, loudness: null }, [], { idf: STATS });
    const without = buildVectorV2({ energy: 0.7, valence: 0.6 }, [], { idf: STATS });
    expect(withNull).toEqual(without);
    // and NOT the same as a track actually measured at the bottom of the loudness range
    expect(buildVectorV2({ energy: 0.7, valence: 0.6, loudness: -60 }, [], { idf: STATS })).not.toEqual(without);
  });

  it('an unusable bpm abstains rather than folding to a fabricated tempo', () => {
    const none = buildVectorV2({ energy: 0.7 }, [], { idf: STATS });
    for (const bpm of [null, undefined, 0, -120, NaN, Infinity, '', ' ', true, {}, []]) {
      expect(buildVectorV2({ energy: 0.7, bpm }, [], { idf: STATS })).toEqual(none);
    }
  });

  it('ABSTAINS with null when there is no evidence at all — no confident vector out of nothing', () => {
    expect(buildVectorV2(null, [], { idf: STATS })).toBeNull();
    expect(buildVectorV2({}, [], { idf: STATS })).toBeNull();
    expect(buildVectorV2({ energy: null, bpm: null }, [], { idf: STATS })).toBeNull();
    expect(buildVectorV2({}, ['house'], { idf: null })).toBeNull();      // genres but no usable stats
    expect(buildVectorV2({}, [], { idf: STATS })).toBeNull();
  });

  it('a genre-only track (no audio evidence) still embeds — the genre block alone is evidence', () => {
    const v = buildVectorV2({}, ['house'], { idf: STATS });
    expect(v).toHaveLength(DIM_V2);
    expect(audioOf(v).every(x => x === 0)).toBe(true);
    expect(norm(v)).toBeCloseTo(1, 12);
  });

  it('a measured audio value of exactly 0 IS evidence and embeds (0 != unknown)', () => {
    const v = buildVectorV2({ energy: 0 }, [], { idf: STATS });
    expect(v).not.toBeNull();
    expect(v[0]).toBeCloseTo(-1, 12); // centred: energy 0 is the negative pole, not the origin
  });
});

describe('W4-014 · S8 numerical hygiene', () => {
  it('clamps out-of-range feature values instead of letting them dominate the block', () => {
    const hot = buildVectorV2({ energy: 99, valence: -99 }, [], { idf: STATS });
    expect(hot.every(Number.isFinite)).toBe(true);
    expect(norm(audioOf(hot))).toBeCloseTo(1, 12); // genre-less
  });

  it('300-round fuzz: every emitted vector is finite, DIM_V2 long, and block-normalised', () => {
    const feat = fc.record({
      bpm: fc.oneof(fc.double(), fc.constant(null), fc.string()),
      energy: fc.oneof(fc.double(), fc.constant(null)),
      valence: fc.oneof(fc.double(), fc.constant(null)),
      acousticness: fc.oneof(fc.double(), fc.constant(null)),
      danceability: fc.oneof(fc.double(), fc.constant(null)),
      loudness: fc.oneof(fc.double(), fc.constant(null)),
    }, { requiredKeys: [] });
    fc.assert(fc.property(feat, fc.array(fc.string(), { maxLength: 20 }), (f, genres) => {
      const v = buildVectorV2(f, genres, { idf: STATS });
      if (v === null) return true;
      if (v.length !== DIM_V2 || !v.every(Number.isFinite)) return false;
      if (Math.abs(norm(v) - 1) > 1e-9) return false; // always a unit vector
      const a = norm(audioOf(v));
      const g = norm(genreOf(v));
      const both = Math.abs(a - AUDIO_WEIGHT) < 1e-9 && Math.abs(g - GENRE_WEIGHT) < 1e-9;
      const audioOnly = Math.abs(a - 1) < 1e-9 && g === 0;
      const genreOnly = a === 0 && Math.abs(g - 1) < 1e-9;
      return both || audioOnly || genreOnly;
    }), { numRuns: 300, seed: 20260822 });
  });
});

describe('W4-014 · v1 is untouched while the flags are off', () => {
  it('buildVector still emits the exact 70-dim v1 vector', () => {
    const v = buildVector(FEATURES, ['pop', 'dance']);
    expect(DIM).toBe(70);
    expect(v).toHaveLength(70);
    expect(norm(v)).toBeCloseTo(1, 12);
    // the v1 audio dims are the uncentred [0,1] mapping, jointly normalised with the genre bag
    expect(v[1]).toBeGreaterThan(0);
    expect(v[0]).toBeGreaterThan(0);
  });

  it('v1 and v2 are different lengths, so nothing can silently write one into the other index', () => {
    expect(DIM).not.toBe(DIM_V2);
  });
});
