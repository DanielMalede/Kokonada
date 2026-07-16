// backend/tests/measureDiscoveryComposition.test.js
//
// Fixture unit tests for the READ-ONLY prod diagnostic app/scripts/measureDiscoveryComposition.js.
// No live Mongo, no network — pure helpers are exercised directly; the orchestration is driven with
// injected fakes (fakeVectorIndex-style). The whole surface is asserted to be side-effect-free of any
// DB/cache WRITE: the fakes expose read-only methods only, so a stray upsert/enqueue would throw.
'use strict';

const KOKO = require('../app/scripts/measureDiscoveryComposition');

// ── fixtures ────────────────────────────────────────────────────────────────
function jacc(genres, qset) {
  const cset = new Set((genres || []).map((g) => g.toLowerCase()));
  if (!cset.size || !qset.size) return 0;
  let inter = 0;
  for (const g of cset) if (qset.has(g)) inter++;
  return inter / (cset.size + qset.size - inter);
}

function makeFakePool() {
  return [
    { track: { recordingKey: 'mbid:1',    canonicalKey: 'c1', genres: ['electronic'], title: 'a', artist: 'A', uri: null }, base: 0.90 },
    { track: { recordingKey: 'mbid:2',    canonicalKey: 'c2', genres: ['house'],      title: 'b', artist: 'B', uri: null }, base: 0.88 },
    { track: { recordingKey: 'mbid:3',    canonicalKey: 'c3', genres: ['pop'],        title: 'c', artist: 'C', uri: null }, base: 0.80 },
    { track: { recordingKey: 'spotify:1', canonicalKey: 'c4', genres: [],             title: 'd', artist: 'D', uri: 'spotify:track:1' }, base: 0.95 },
    { track: { recordingKey: 'spotify:2', canonicalKey: 'c5', genres: ['rock'],       title: 'e', artist: 'E', uri: 'spotify:track:2' }, base: 0.92 },
    { track: { recordingKey: 'youtube:1', canonicalKey: 'c6', genres: ['ambient'],    title: 'f', artist: 'F', uri: null }, base: 0.85 },
  ];
}

const FEATURE_ROWS = {
  'mbid:1':    { energy: 0.82, bpm: 140 },
  'mbid:2':    { energy: 0.79, bpm: 145 },
  'mbid:3':    { energy: 0.50, bpm: 100 },
  'spotify:1': { energy: 0.60, bpm: 120 },
  'spotify:2': { energy: 0.70, bpm: 130 },
  'youtube:1': { energy: 0.30, bpm: 90 },
};

function makeFakes() {
  const calls = [];
  const fakeMmr = {
    // mirrors mmr.select's contract: takes scored {track,total}[], returns the selected subset (score order).
    select: (scored, { k = 50 } = {}) => [...scored].sort((a, b) => b.total - a.total).slice(0, k),
  };
  const fakeDiscovery = {
    find: async (opts) => {
      const { queryGenres = [], k = 30 } = opts;
      calls.push({ queryGenres: [...queryGenres], envWeight: process.env.DISCOVERY_GENRE_WEIGHT });
      const qset = new Set(queryGenres.map((g) => g.toLowerCase()));
      const scored = makeFakePool().map((c) => ({
        track: c.track,
        total: c.base + (qset.size ? 0.5 * jacc(c.track.genres, qset) : 0),
      }));
      const picked = fakeMmr.select(scored, { k, lambda: 0.7 });
      return picked.map((s) => s.track);
    },
  };
  const fakeVectorIndex = {
    queryNear: async (_vec, { k = 50 } = {}) => {
      const hits = [];
      for (let i = 0; i < 5; i++) hits.push({ recordingKey: `mbid:r${i}`, canonicalKey: `cm${i}`, score: 0.99 });
      for (let i = 0; i < 5; i++) hits.push({ recordingKey: `spotify:r${i}`, canonicalKey: `cs${i}`, score: 0.98 });
      return hits.slice(0, k);
    },
  };
  const loadFeatures = async (keys) => {
    const m = new Map();
    for (const key of [...new Set(keys)]) if (FEATURE_ROWS[key]) m.set(key, FEATURE_ROWS[key]);
    return m;
  };
  const buildTargetVector = (features, genres) => ({ features, genres });
  const fakeTrackCatalog = {
    aggregate: async () => ([
      { _id: 'mbid', total: 1000, withGenres: 950 },
      { _id: 'legacy', total: 2000, withGenres: 40 },
    ]),
  };
  const deps = {
    vectorIndex: fakeVectorIndex,
    discoveryVectorService: fakeDiscovery,
    mmr: fakeMmr,
    buildTargetVector,
    loadFeatures,
    TrackCatalog: fakeTrackCatalog,
  };
  return { calls, fakeMmr, deps };
}

// ── pure helpers ──────────────────────────────────────────────────────────────
describe('bucketShare', () => {
  it('counts mbid: vs legacy and computes share', () => {
    const b = KOKO.bucketShare(['mbid:1', 'mbid:2', 'spotify:1', 'youtube:1']);
    expect(b.mbid).toBe(2);
    expect(b.legacy).toBe(2);
    expect(b.total).toBe(4);
    expect(b.share).toBeCloseTo(0.5, 6);
  });
  it('empty → share 0', () => {
    expect(KOKO.bucketShare([]).share).toBe(0);
  });
  it('non-string keys count toward total as legacy', () => {
    const b = KOKO.bucketShare(['mbid:1', undefined, null]);
    expect(b.total).toBe(3);
    expect(b.mbid).toBe(1);
    expect(b.legacy).toBe(2);
  });
});

describe('jaccardHitRate', () => {
  it('fraction of candidate genre lists intersecting query (case-insensitive)', () => {
    const cands = [['Electronic'], ['house'], ['pop'], []];
    expect(KOKO.jaccardHitRate(cands, ['electronic', 'house'])).toBeCloseTo(2 / 4, 6);
  });
  it('empty query or empty candidates → 0', () => {
    expect(KOKO.jaccardHitRate([['pop']], [])).toBe(0);
    expect(KOKO.jaccardHitRate([], ['pop'])).toBe(0);
  });
});

describe('mean', () => {
  it('averages finite numbers, empty → 0, ignores non-finite', () => {
    expect(KOKO.mean([1, 2, 3])).toBeCloseTo(2, 6);
    expect(KOKO.mean([])).toBe(0);
    expect(KOKO.mean([1, NaN, 3])).toBeCloseTo(2, 6);
  });
});

describe('absDeltas', () => {
  it('mean abs energy/bpm delta, skips rows missing features', () => {
    const rows = [{ energy: 0.9, bpm: 150 }, { energy: 0.7, bpm: 130 }, undefined, { energy: null, bpm: null }];
    const d = KOKO.absDeltas(rows, { energy: 0.8, bpm: 140 });
    expect(d.energyDelta).toBeCloseTo((0.1 + 0.1) / 2, 6);
    expect(d.bpmDelta).toBeCloseTo((10 + 10) / 2, 6);
    expect(d.energyN).toBe(2);
    expect(d.bpmN).toBe(2);
  });
  it('no usable rows → deltas 0 with N=0', () => {
    const d = KOKO.absDeltas([undefined, { energy: null, bpm: null }], { energy: 0.8, bpm: 140 });
    expect(d.energyDelta).toBe(0);
    expect(d.energyN).toBe(0);
  });
});

describe('summarizePreflight', () => {
  it('summarizes both buckets', () => {
    const pf = KOKO.summarizePreflight([
      { _id: 'mbid', total: 1000, withGenres: 950 },
      { _id: 'legacy', total: 2000, withGenres: 40 },
    ]);
    expect(pf.mbidTotal).toBe(1000);
    expect(pf.mbidWithGenres).toBe(950);
    expect(pf.mbidGenreCoverage).toBeCloseTo(0.95, 6);
    expect(pf.legacyTotal).toBe(2000);
    expect(pf.legacyGenreCoverage).toBeCloseTo(0.02, 6);
  });
  it('missing bucket → zeros (no divide-by-zero)', () => {
    const pf = KOKO.summarizePreflight([{ _id: 'mbid', total: 10, withGenres: 5 }]);
    expect(pf.mbidGenreCoverage).toBeCloseTo(0.5, 6);
    expect(pf.legacyTotal).toBe(0);
    expect(pf.legacyGenreCoverage).toBe(0);
  });
});

describe('parseArgs', () => {
  it('defaults runs=3 weights=null', () => {
    const a = KOKO.parseArgs([]);
    expect(a.runs).toBe(3);
    expect(a.weights).toBeNull();
  });
  it('parses --runs and --weights (space form)', () => {
    const a = KOKO.parseArgs(['--runs', '5', '--weights', '0.1,0.15,0.25,0.35']);
    expect(a.runs).toBe(5);
    expect(a.weights).toEqual([0.1, 0.15, 0.25, 0.35]);
  });
  it('parses --key=value form', () => {
    const a = KOKO.parseArgs(['--runs=2', '--weights=0.2,0.3']);
    expect(a.runs).toBe(2);
    expect(a.weights).toEqual([0.2, 0.3]);
  });
  it('garbage weights → null; runs floors at 1', () => {
    expect(KOKO.parseArgs(['--weights', 'abc,,']).weights).toBeNull();
    expect(KOKO.parseArgs(['--runs', '0']).runs).toBe(1);
  });
});

describe('currentGenreWeight', () => {
  const save = process.env.DISCOVERY_GENRE_WEIGHT;
  afterEach(() => {
    if (save === undefined) delete process.env.DISCOVERY_GENRE_WEIGHT;
    else process.env.DISCOVERY_GENRE_WEIGHT = save;
  });
  it('defaults to 0.15 when unset/blank', () => {
    delete process.env.DISCOVERY_GENRE_WEIGHT;
    expect(KOKO.currentGenreWeight()).toBeCloseTo(0.15, 6);
    process.env.DISCOVERY_GENRE_WEIGHT = '  ';
    expect(KOKO.currentGenreWeight()).toBeCloseTo(0.15, 6);
  });
  it('clamps to [0, 0.5]', () => {
    process.env.DISCOVERY_GENRE_WEIGHT = '0.9';
    expect(KOKO.currentGenreWeight()).toBeCloseTo(0.5, 6);
    process.env.DISCOVERY_GENRE_WEIGHT = '-1';
    expect(KOKO.currentGenreWeight()).toBeCloseTo(0, 6);
    process.env.DISCOVERY_GENRE_WEIGHT = '0.25';
    expect(KOKO.currentGenreWeight()).toBeCloseTo(0.25, 6);
  });
  it('falls back to default on non-finite', () => {
    process.env.DISCOVERY_GENRE_WEIGHT = 'abc';
    expect(KOKO.currentGenreWeight()).toBeCloseTo(0.15, 6);
  });
});

describe('withGenreWeight', () => {
  it('sets env during fn and restores the prior value', async () => {
    process.env.DISCOVERY_GENRE_WEIGHT = '0.3';
    let during;
    const r = await KOKO.withGenreWeight(0.25, async () => { during = process.env.DISCOVERY_GENRE_WEIGHT; return 42; });
    expect(during).toBe('0.25');
    expect(r).toBe(42);
    expect(process.env.DISCOVERY_GENRE_WEIGHT).toBe('0.3');
    delete process.env.DISCOVERY_GENRE_WEIGHT;
  });
  it('deletes env after when it was previously unset', async () => {
    delete process.env.DISCOVERY_GENRE_WEIGHT;
    let during;
    await KOKO.withGenreWeight(0.4, async () => { during = process.env.DISCOVERY_GENRE_WEIGHT; });
    expect(during).toBe('0.4');
    expect('DISCOVERY_GENRE_WEIGHT' in process.env).toBe(false);
  });
  it('restores env even if fn throws', async () => {
    delete process.env.DISCOVERY_GENRE_WEIGHT;
    await expect(KOKO.withGenreWeight(0.4, async () => { throw new Error('x'); })).rejects.toThrow('x');
    expect('DISCOVERY_GENRE_WEIGHT' in process.env).toBe(false);
  });
});

describe('descriptorFeatures', () => {
  it('bpm=round(70+energy*90), acousticness=clamp(1-energy), passes valence', () => {
    const d = KOKO.descriptorFeatures({ energy_floor: 0.8, valence_hint: 0.75 });
    expect(d.bpm).toBe(142);
    expect(d.energy).toBe(0.8);
    expect(d.valence).toBe(0.75);
    expect(d.acousticness).toBeCloseTo(0.2, 6);
  });
});

describe('ARCHETYPES', () => {
  it('has the 5 archetypes, each with non-empty lowercase seedGenres + targetFeatures', () => {
    const names = KOKO.ARCHETYPES.map((a) => a.name);
    expect(names).toEqual(expect.arrayContaining(['energetic', 'calm', 'moderate', 'happy-dance', 'sad-acoustic']));
    for (const a of KOKO.ARCHETYPES) {
      expect(Array.isArray(a.seedGenres)).toBe(true);
      expect(a.seedGenres.length).toBeGreaterThan(0);
      expect(a.seedGenres.every((g) => typeof g === 'string' && g.length && g === g.toLowerCase())).toBe(true);
      expect(a.targetFeatures && typeof a.targetFeatures === 'object').toBe(true);
      expect(Number.isFinite(a.targetFeatures.energy)).toBe(true);
    }
  });
  it('energetic derives from energize; moderate is the neutral buildVector fill vector', () => {
    const e = KOKO.ARCHETYPES.find((a) => a.name === 'energetic');
    expect(e.targetFeatures.energy).toBe(0.8);
    expect(e.targetFeatures.bpm).toBe(142);
    expect(e.seedGenres).toEqual(['electronic', 'house']);
    const m = KOKO.ARCHETYPES.find((a) => a.name === 'moderate');
    expect(m.targetFeatures).toEqual({ bpm: 130, energy: 0.5, valence: 0.5, acousticness: 0.5, danceability: 0.5, loudness: -27.5 });
    expect(m.seedGenres).toEqual(['pop', 'indie pop']);
  });
});

// ── monkey-patch capture ──────────────────────────────────────────────────────
describe('findCapturingCandidates', () => {
  it('captures the pre-MMR candidate array passed to mmr.select and restores select', async () => {
    const orig = (scored) => scored.slice(0, 2);
    const mmr = { select: orig };
    const candidatesPassed = [
      { track: { recordingKey: 'mbid:x', genres: ['pop'] }, total: 1 },
      { track: { recordingKey: 'spotify:y', genres: [] }, total: 0.9 },
      { track: { recordingKey: 'mbid:z', genres: ['pop'] }, total: 0.8 },
    ];
    let calledWith = null;
    const disc = { find: async (opts) => { calledWith = opts; return mmr.select(candidatesPassed, { k: 5 }); } };
    const out = await KOKO.findCapturingCandidates(disc, mmr, { targetFeatures: {}, queryGenres: ['pop'], k: 5, excludeCanonicalKeys: new Set() });
    expect(out.candidates).toBe(candidatesPassed);
    expect(out.served).toEqual(candidatesPassed.slice(0, 2));
    expect(mmr.select).toBe(orig); // restored
    expect(calledWith.queryGenres).toEqual(['pop']);
  });
  it('restores mmr.select even if find throws', async () => {
    const orig = (s) => s;
    const mmr = { select: orig };
    const disc = { find: async () => { throw new Error('boom'); } };
    await expect(KOKO.findCapturingCandidates(disc, mmr, {})).rejects.toThrow('boom');
    expect(mmr.select).toBe(orig);
  });
});

// ── preflight ─────────────────────────────────────────────────────────────────
describe('genreCoveragePreflight', () => {
  it('runs a single read-only aggregate and summarizes it', async () => {
    const TrackCatalog = {
      aggregate: jest.fn().mockResolvedValue([
        { _id: 'mbid', total: 1000, withGenres: 950 },
        { _id: 'legacy', total: 2000, withGenres: 40 },
      ]),
    };
    const pf = await KOKO.genreCoveragePreflight(TrackCatalog);
    expect(pf.mbidTotal).toBe(1000);
    expect(pf.mbidGenreCoverage).toBeCloseTo(0.95, 6);
    expect(pf.legacyGenreCoverage).toBeCloseTo(0.02, 6);
    expect(TrackCatalog.aggregate).toHaveBeenCalledTimes(1);
  });
});

// ── orchestration (fakes only) ─────────────────────────────────────────────────
describe('measureArchetype', () => {
  it('ON lifts mbid share vs OFF, computes jaccard + band deltas, sets env weight during ON only', async () => {
    delete process.env.DISCOVERY_GENRE_WEIGHT;
    const { calls, deps, fakeMmr } = makeFakes();
    const origSelect = fakeMmr.select;
    const arch = KOKO.ARCHETYPES.find((a) => a.name === 'energetic');

    const res = await KOKO.measureArchetype(arch, deps, { runs: 2, weights: [0.15], k: 3, retrievalK: 500 });

    expect(res.name).toBe('energetic');
    expect(res.mbidShare500).toBeCloseTo(0.5, 6);
    expect(res.servedOffMbidShare).toBeCloseTo(1 / 3, 6);

    const on = res.weights[0];
    expect(on.weight).toBe(0.15);
    expect(on.servedOnMbidShare).toBeCloseTo(2 / 3, 6);
    expect(on.servedOnMbidShare).toBeGreaterThan(res.servedOffMbidShare);
    expect(on.jaccardHitRate).toBeCloseTo(2 / 6, 6);
    expect(on.preMmrMbidShare).toBeCloseTo(0.5, 6);

    expect(Number.isFinite(res.servedOffEnergyDelta)).toBe(true);
    expect(Number.isFinite(res.servedOffBpmDelta)).toBe(true);
    expect(Number.isFinite(on.servedOnEnergyDelta)).toBe(true);
    expect(Number.isFinite(on.servedOnBpmDelta)).toBe(true);

    // OFF got queryGenres []; ON got the seed genres and saw the env weight set.
    const offCalls = calls.filter((c) => c.queryGenres.length === 0);
    const onCalls = calls.filter((c) => c.queryGenres.length > 0);
    expect(offCalls).toHaveLength(2);
    expect(onCalls).toHaveLength(2);
    expect(onCalls.every((c) => c.envWeight === '0.15')).toBe(true);
    expect(onCalls.every((c) => JSON.stringify(c.queryGenres) === JSON.stringify(arch.seedGenres))).toBe(true);

    // env + monkey-patch fully restored
    expect('DISCOVERY_GENRE_WEIGHT' in process.env).toBe(false);
    expect(deps.mmr.select).toBe(origSelect);
  });
});

describe('runMeasurement', () => {
  it('prints [measure] lines and returns preflight + all archetypes', async () => {
    delete process.env.DISCOVERY_GENRE_WEIGHT;
    const { deps } = makeFakes();
    const lines = [];
    const out = await KOKO.runMeasurement(deps, { runs: 1, weights: [0.15], k: 3 }, (l) => lines.push(l));

    expect(out.preflight.mbidTotal).toBe(1000);
    expect(out.archetypes).toHaveLength(5);
    expect(lines.some((l) => l.startsWith('[measure] preflight'))).toBe(true);
    expect(lines.some((l) => l.includes('served=OFF'))).toBe(true);
    expect(lines.some((l) => l.includes('served=ON') && l.includes('weight=0.15'))).toBe(true);
    expect(lines.every((l) => l.startsWith('[measure]'))).toBe(true);
  });
});
