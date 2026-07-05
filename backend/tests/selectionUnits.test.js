'use strict';

process.env.NODE_ENV = 'test';

jest.mock('../app/config/redis', () => ({ getRedis: jest.fn(() => null), createConnection: jest.fn() }));

const mongoose = require('mongoose');
const { getRedis } = require('../app/config/redis');
const { buildPool, invalidateUserPools } = require('../app/services/selection/candidatePool');
const { applyHardFilters } = require('../app/services/selection/hardFilters');
const { scoreTrack } = require('../app/services/selection/score');
const { select } = require('../app/services/selection/mmr');

const lib = (id, { artist = 'Artist', genres = ['pop'], affinity = 5, provider = 'spotify' } = {}) =>
  ({ id, provider, name: `Song ${id}`, artist, genres, affinity, uri: `spotify:track:${id}` });

const TARGETS = {
  bpmCenter: 120, bpmWidth: 20, energyFloor: 0.3, energyCeiling: 0.8,
  valenceTarget: 0.6, acousticnessBias: 0, instrumentalBias: 0, tempoBand: 'active', confidence: 1,
};

beforeEach(() => {
  jest.clearAllMocks();
  getRedis.mockReturnValue(null);
});

// ── candidatePool ─────────────────────────────────────────────────────────────

describe('candidatePool.buildPool', () => {
  const profile = (tracks, lastAnalyzed = new Date('2026-07-01')) =>
    ({ library: tracks, lastAnalyzed });

  it('partitions the library by mood: exclude-genre tracks never enter the pool', async () => {
    const pool = await buildPool({
      userId: 'u1',
      musicProfile: profile([lib('a', { genres: ['metal'] }), lib('b', { genres: ['ambient'] })]),
      moodKey: 'calm',
      excludeGenres: ['metal', 'hardcore'],
    });

    expect(pool.map(t => t.id)).toEqual(['b']);
  });

  it('dedupes by canonicalKey across library and discovery (cross-provider)', async () => {
    const discovery = [{ id: 'yt1', provider: 'youtube_music', title: 'Song a', artist: 'Artist' }];
    const pool = await buildPool({
      userId: 'u1',
      musicProfile: profile([lib('a', { genres: ['pop'] })]), // canonicalKey at:artist|song a
      moodKey: 'uplift',
      excludeGenres: [],
      discoveryTracks: discovery,
    });

    expect(pool).toHaveLength(1); // the YouTube copy of the same song collapsed away
    expect(pool[0].canonicalKey).toBe('at:artist|song a');
  });

  it('includes the full uncapped library and marks discovery tracks', async () => {
    const many = Array.from({ length: 700 }, (_, i) => lib(`t${i}`, { artist: `A${i}`, affinity: i }));
    const pool = await buildPool({
      userId: 'u1',
      musicProfile: profile(many),
      moodKey: 'uplift',
      excludeGenres: [],
      discoveryTracks: [{ id: 'd1', provider: 'spotify', name: 'Fresh', artist: 'New Artist' }],
    });

    expect(pool.length).toBe(701); // uncapped: all 700 library tracks + 1 discovery
    expect(pool.find(t => t.id === 'd1').isDiscovery).toBe(true);
    expect(pool.find(t => t.id === 't699')).toBeDefined(); // full library present (no affinity cap)
  });

  it('caches the library partition in Redis and invalidates on profile rebuild (lastAnalyzed)', async () => {
    const store = new Map();
    getRedis.mockReturnValue({
      get: jest.fn(async k => store.get(k) ?? null),
      set: jest.fn(async (k, v) => { store.set(k, v); return 'OK'; }),
    });
    const tracks = [lib('a')];

    await buildPool({ userId: 'u1', musicProfile: profile(tracks, new Date('2026-07-01')), moodKey: 'uplift', excludeGenres: [] });
    expect(store.has('pool:u1:uplift')).toBe(true);

    // Same lastAnalyzed → cache hit (library not re-partitioned)
    const cached = await buildPool({ userId: 'u1', musicProfile: profile([], new Date('2026-07-01')), moodKey: 'uplift', excludeGenres: [] });
    expect(cached.map(t => t.id)).toEqual(['a']);

    // Newer lastAnalyzed → rebuilt from the fresh library
    const rebuilt = await buildPool({ userId: 'u1', musicProfile: profile([lib('b')], new Date('2026-07-02')), moodKey: 'uplift', excludeGenres: [] });
    expect(rebuilt.map(t => t.id)).toEqual(['b']);
  });

  it('never leaks Mongoose subdocument internals into the pool or its Redis cache (OOM guard)', async () => {
    // Reproduces the generation OOM: MusicProfile.library loaded WITHOUT .lean() are
    // hydrated Mongoose subdocuments. Spreading one copies parent-proxy refs
    // ($__parent / __parentArray / _doc) instead of the real fields (id/name live in
    // _doc, exposed only via prototype getters). JSON.stringify then recurses into the
    // whole parent doc PER track → quadratic blowup → 442MB heap OOM. The pool must
    // yield PLAIN tracks with their real fields intact.
    const sub = new mongoose.Schema(
      { id: String, provider: String, name: String, artist: String, genres: [String], affinity: Number, uri: String },
      { _id: false }
    );
    const schema = new mongoose.Schema({ userId: String, library: [sub], lastAnalyzed: Date });
    const Model = mongoose.models.__OomProbe || mongoose.model('__OomProbe', schema);
    const doc = new Model({
      userId: 'u1',
      lastAnalyzed: new Date('2026-07-01'),
      library: [lib('a', { genres: ['pop'] }), lib('b', { genres: ['jazz'], affinity: 3 })],
    });

    const store = new Map();
    getRedis.mockReturnValue({
      get: jest.fn(async k => store.get(k) ?? null),
      set: jest.fn(async (k, v) => { store.set(k, v); return 'OK'; }),
    });

    const pool = await buildPool({
      userId: 'u1',
      musicProfile: { library: doc.library, lastAnalyzed: doc.lastAnalyzed },
      moodKey: 'uplift',
      excludeGenres: [],
    });

    // Real fields survive (affinity-sorted a=5 before b=3) — not lost inside _doc.
    expect(pool.map(t => t.id)).toEqual(['a', 'b']);
    const INTERNAL = ['$__', '_doc', '$__parent', '__parentArray', '__index'];
    for (const t of pool) {
      for (const key of INTERNAL) expect(t).not.toHaveProperty(key);
    }

    // The cached partition must serialize to a compact plain-track blob, not a
    // parent-proxy explosion (two tiny subdocs stringified to ~1.8KB pre-fix).
    const cached = store.get('pool:u1:uplift');
    expect(cached).toBeTruthy();
    expect(cached).not.toContain('$__parent');
    expect(cached).not.toContain('__parentArray');
    expect(JSON.parse(cached).tracks).toHaveLength(2);
  });
});

describe('candidatePool.invalidateUserPools', () => {
  it('deletes ONLY the target user\'s pool keys (SCAN + DEL), leaving other users/keys', async () => {
    const store = new Map([
      ['pool:u1:calm', 'x'], ['pool:u1:uplift', 'y'], ['pool:u1:none', 'z'],
      ['pool:u2:calm', 'a'], ['other:u1', 'b'],
    ]);
    getRedis.mockReturnValue({
      scan: jest.fn(async (cursor, _match, pattern) => {
        const re = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        return ['0', [...store.keys()].filter(k => re.test(k))];
      }),
      del: jest.fn(async (...keys) => { keys.forEach(k => store.delete(k)); return keys.length; }),
    });

    const removed = await invalidateUserPools('u1');

    expect(removed).toBe(3);
    expect(store.has('pool:u1:calm')).toBe(false);
    expect(store.has('pool:u1:uplift')).toBe(false);
    expect(store.has('pool:u1:none')).toBe(false);
    expect(store.has('pool:u2:calm')).toBe(true); // a different user is untouched
    expect(store.has('other:u1')).toBe(true);      // a non-pool key is untouched
  });

  it('is a no-op (returns 0) when Redis is unavailable', async () => {
    getRedis.mockReturnValue(null);
    expect(await invalidateUserPools('u1')).toBe(0);
  });
});

// ── hardFilters ───────────────────────────────────────────────────────────────

describe('hardFilters.applyHardFilters', () => {
  const candidates = [
    { ...lib('a'), canonicalKey: 'at:artist|song a' },
    { ...lib('b'), canonicalKey: 'at:artist|song b' },
    { ...lib('c'), canonicalKey: 'at:artist|song c' },
  ];

  it('the ledger windows are impenetrable — global and mood exclusions both drop', () => {
    const out = applyHardFilters(candidates, {
      hardExcluded: new Set(['at:artist|song a']),
      moodExcluded: new Set(['at:artist|song b']),
    });

    expect(out.map(t => t.id)).toEqual(['c']);
  });

  it('genre exclusion is exact-token: excluding "pop punk" does NOT kill "pop"', () => {
    const out = applyHardFilters([
      { ...lib('a', { genres: ['pop'] }), canonicalKey: 'k1' },
      { ...lib('b', { genres: ['pop punk'] }), canonicalKey: 'k2' },
      { ...lib('c', { genres: ['indie pop'] }), canonicalKey: 'k3' },
    ], { excludeGenres: ['pop punk'] });

    expect(out.map(t => t.id)).toEqual(['a', 'c']);
  });

  it('provider routing drops tracks the playback engine cannot serve', () => {
    const out = applyHardFilters([
      { ...lib('a'), canonicalKey: 'k1' },
      { id: 'v1', provider: 'youtube_music', genres: [], canonicalKey: 'k2' },
    ], { provider: 'spotify' });

    expect(out.map(t => t.id)).toEqual(['a']);
  });

  it('the energy ceiling drops feature-bearing tracks only when target confidence is high', () => {
    const withFeatures = [
      { ...lib('a'), canonicalKey: 'k1', features: { energy: 0.95 } },
      { ...lib('b'), canonicalKey: 'k2', features: { energy: 0.4 } },
      { ...lib('c'), canonicalKey: 'k3', features: null },
    ];

    const strict = applyHardFilters(withFeatures, { energyCeiling: 0.8, targetConfidence: 0.9 });
    expect(strict.map(t => t.id)).toEqual(['b', 'c']); // featureless tracks are never energy-dropped

    const unsure = applyHardFilters(withFeatures, { energyCeiling: 0.8, targetConfidence: 0.4 });
    expect(unsure.map(t => t.id)).toEqual(['a', 'b', 'c']); // low confidence → soft (scoring) only
  });
});

// ── score ─────────────────────────────────────────────────────────────────────

describe('score.scoreTrack', () => {
  const ctx = { targets: TARGETS, maxAffinity: 10, allowGenres: ['pop', 'dance'], exposure: new Map(), now: Date.now() };

  it('a feature match near the biosonic center outranks a distant one', () => {
    const near = scoreTrack({ ...lib('a'), canonicalKey: 'k1', features: { bpm: 122, energy: 0.6, valence: 0.6 } }, ctx);
    const far  = scoreTrack({ ...lib('b'), canonicalKey: 'k2', features: { bpm: 200, energy: 0.99, valence: 0.1 } }, ctx);

    expect(near.total).toBeGreaterThan(far.total);
    expect(near.terms.featureDistance).toBeGreaterThan(far.terms.featureDistance);
  });

  it('recent exposure under a near mood context pushes the score down', () => {
    const exposure = new Map([['k1', [{ moodKey: 'uplift', servedAt: new Date(Date.now() - 3600_000) }]]]);
    const fresh = scoreTrack({ ...lib('a'), canonicalKey: 'k1' }, { ...ctx, targetMoodKey: 'uplift' });
    const burnt = scoreTrack({ ...lib('a'), canonicalKey: 'k1' }, { ...ctx, targetMoodKey: 'uplift', exposure });

    expect(burnt.total).toBeLessThan(fresh.total);
    expect(burnt.terms.exposurePenalty).toBeGreaterThan(0);
  });

  it('featureless tracks pay the unknown penalty; discovery earns its bonus', () => {
    const unknown = scoreTrack({ ...lib('a'), canonicalKey: 'k1', features: null }, ctx);
    expect(unknown.terms.unknownFeaturePenalty).toBeGreaterThan(0);

    const disc = scoreTrack({ ...lib('b'), canonicalKey: 'k2', isDiscovery: true }, ctx);
    expect(disc.terms.discoveryBonus).toBeGreaterThan(0);
  });

  it('every term is finite for degenerate inputs', () => {
    const out = scoreTrack({ id: 'x', canonicalKey: 'k', genres: null, affinity: null }, { targets: {}, maxAffinity: 0, exposure: new Map() });
    expect(Number.isFinite(out.total)).toBe(true);
  });
});

// ── mmr ───────────────────────────────────────────────────────────────────────

describe('mmr.select', () => {
  const scored = (id, total, { artist = `A-${id}`, features = null, genres = ['pop'] } = {}) =>
    ({ track: { id, artist, features, genres, canonicalKey: `k${id}` }, total });

  it('suppresses same-artist runs even when they hold the top scores', () => {
    const picks = select([
      scored('a1', 1.0, { artist: 'Drake' }),
      scored('a2', 0.99, { artist: 'Drake' }),
      scored('a3', 0.98, { artist: 'Drake' }),
      scored('b', 0.7, { artist: 'Bonobo' }),
      scored('c', 0.6, { artist: 'Tycho' }),
    ], { k: 3 });

    const artists = picks.map(p => p.track.artist);
    expect(new Set(artists).size).toBeGreaterThanOrEqual(2); // never a monoculture
    expect(artists[0]).toBe('Drake'); // best track still leads
  });

  it('returns everything (ranked) when k exceeds the candidate count', () => {
    const picks = select([scored('a', 0.9), scored('b', 0.5)], { k: 50 });
    expect(picks).toHaveLength(2);
    expect(picks[0].track.id).toBe('a');
  });

  it('lambda=1 degenerates to pure score ranking', () => {
    const picks = select([
      scored('a1', 1.0, { artist: 'Drake' }),
      scored('a2', 0.99, { artist: 'Drake' }),
      scored('b', 0.7, { artist: 'Bonobo' }),
    ], { k: 2, lambda: 1 });

    expect(picks.map(p => p.track.id)).toEqual(['a1', 'a2']);
  });

  it('is deterministic for identical input', () => {
    const input = [scored('a', 0.9), scored('b', 0.8), scored('c', 0.7)];
    expect(select(input, { k: 2 })).toEqual(select(input, { k: 2 }));
  });
});
