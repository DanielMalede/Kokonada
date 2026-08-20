'use strict';

// Wave-4 W4-007 (evidence half) — S12 SCORING SHADOW COMPARE.
//
// The core half changed how every candidate is ranked. §0.4 S12 asks for the evidence that
// justifies keeping it: run v1 and v2 side by side on the SAME pool, per generation, and
// record how far apart they land — rank correlation and top-k overlap — as telemetry only.
//
// Three properties make this worth having rather than decorative, and each is pinned below:
//
//   1. ZERO USER IMPACT. With the flag on, the playlist that ships is byte-identical to the
//      one that ships with the flag off. A shadow that can change the served result is not a
//      shadow, it is a second serving path.
//   2. LOAD-BEARING. On a pool where v1 and v2 genuinely disagree the instrument must SAY so
//      (spearman < 1, overlap < 1). An instrument that reports perfect agreement no matter
//      what is worse than none: it manufactures confidence in a cutover.
//   3. NEVER FATAL. A diagnostic that can take down generation is a liability. The compare is
//      wrapped, and the wrap is exercised here rather than assumed.
//
// The statistics themselves are pure and are pinned against hand-computed values (including a
// tie case), because a rank correlation that is quietly wrong reads exactly like a correct one.

process.env.NODE_ENV = 'test';

jest.mock('../app/config/redis', () => ({ getRedis: jest.fn(() => null), createConnection: jest.fn() }));
jest.mock('../app/models/ServeEvent', () => {
  const rows = [];
  return {
    __rows: rows,
    insertMany: jest.fn(async (docs) => { docs.forEach(d => rows.push(d)); return docs; }),
    find: jest.fn(() => ({ lean: async () => [] })),
  };
});
jest.mock('../app/services/vector/vectorIndex', () => ({
  getMany: jest.fn().mockResolvedValue(new Map()),
  upsertMany: jest.fn().mockResolvedValue({ upserted: 0 }),
  queryNear: jest.fn().mockResolvedValue([]),
  use: jest.fn(),
}));
jest.mock('../app/repositories/audioFeatureRepo', () => ({
  getMany: jest.fn().mockResolvedValue(new Map()),
  upsertMany: jest.fn(),
  missingKeys: jest.fn(),
}));

const featureRepo = require('../app/repositories/audioFeatureRepo');
const shadowCompare = require('../app/services/selection/shadowCompare');
const { selectPlaylist } = require('../app/services/selection/pipeline');
const { scoreTrack, _resetWeights } = require('../app/services/selection/score');

const SHADOW = 'SCORING_V2_SHADOW';
const DISABLE = 'WAVE4_SCORING_V2_DISABLED';

afterEach(() => {
  delete process.env[SHADOW];
  delete process.env[DISABLE];
  _resetWeights();
  jest.restoreAllMocks();
});

// ── 1 · the pure statistics ───────────────────────────────────────────────────────────────

describe('W4-007 S12 · shadowCompare.compare — rank correlation', () => {
  const entries = (served, shadow) =>
    served.map((s, i) => ({ key: `t${i}`, served: s, shadow: shadow[i] }));

  it('reports +1 when the two scorings order the pool identically', () => {
    const stats = shadowCompare.compare(entries([0.9, 0.5, 0.1], [0.4, 0.3, 0.2]), { k: 3 });
    expect(stats.spearman).toBeCloseTo(1, 10);
    expect(stats.topKOverlap).toBeCloseTo(1, 10);
    expect(stats.n).toBe(3);
  });

  it('reports −1 when one scoring exactly reverses the other', () => {
    const stats = shadowCompare.compare(entries([0.9, 0.5, 0.1], [0.1, 0.5, 0.9]), { k: 1 });
    expect(stats.spearman).toBeCloseTo(-1, 10);
    expect(stats.topKOverlap).toBeCloseTo(0, 10);
    expect(stats.topOneSame).toBe(false);
  });

  it('averages tied ranks instead of ordering ties arbitrarily (hand-computed −0.8660)', () => {
    // served [3,1,1] → average ranks [3, 1.5, 1.5]; shadow [1,2,3] → ranks [1,2,3].
    // Pearson over those ranks = −1.5 / (√1.5·√2) = −1.5/√3.
    const stats = shadowCompare.compare(entries([3, 1, 1], [1, 2, 3]), { k: 2 });
    expect(stats.spearman).toBeCloseTo(-1.5 / Math.sqrt(3), 10);
  });

  it('returns null — never NaN — when one side has no variance to correlate', () => {
    const stats = shadowCompare.compare(entries([0.5, 0.5, 0.5], [0.1, 0.2, 0.3]), { k: 2 });
    expect(stats.spearman).toBeNull();
    expect(Number.isNaN(stats.spearman)).toBe(false);
    expect(stats.topKOverlap).not.toBeNull(); // overlap is still defined and still useful
  });

  it('returns null for a correlation that needs at least two points', () => {
    expect(shadowCompare.compare(entries([0.5], [0.9]), { k: 1 }).spearman).toBeNull();
    expect(shadowCompare.compare([], { k: 5 }).spearman).toBeNull();
    expect(shadowCompare.compare([], { k: 5 }).n).toBe(0);
  });

  it('drops a pair with a non-finite score rather than poisoning every statistic', () => {
    const poisoned = [
      { key: 'a', served: 0.9, shadow: 0.8 },
      { key: 'b', served: NaN, shadow: 0.5 },
      { key: 'c', served: 0.4, shadow: Infinity },
      { key: 'd', served: 0.1, shadow: 0.2 },
    ];
    const stats = shadowCompare.compare(poisoned, { k: 2 });
    expect(stats.n).toBe(2);
    expect(stats.dropped).toBe(2);
    expect(Number.isFinite(stats.spearman)).toBe(true);
  });
});

describe('W4-007 S12 · shadowCompare.compare — top-k overlap and deltas', () => {
  it('measures the overlap of the two top-k SETS, not their order', () => {
    const entries = [
      { key: 'a', served: 0.9, shadow: 0.2 },
      { key: 'b', served: 0.8, shadow: 0.9 },
      { key: 'c', served: 0.1, shadow: 0.8 },
    ];
    // served top-2 = {a,b}; shadow top-2 = {b,c} → one of two shared.
    expect(shadowCompare.compare(entries, { k: 2 }).topKOverlap).toBeCloseTo(0.5, 10);
  });

  it('clamps k to the pool size so a short pool cannot report a diluted overlap', () => {
    const entries = [
      { key: 'a', served: 0.9, shadow: 0.9 },
      { key: 'b', served: 0.1, shadow: 0.1 },
    ];
    const stats = shadowCompare.compare(entries, { k: 50 });
    expect(stats.k).toBe(2);
    expect(stats.topKOverlap).toBeCloseTo(1, 10);
  });

  it('breaks score ties by key so the same pool always reports the same overlap', () => {
    const forward = [
      { key: 'a', served: 0.5, shadow: 0.9 },
      { key: 'b', served: 0.5, shadow: 0.1 },
    ];
    const reversed = [...forward].reverse();
    expect(shadowCompare.compare(forward, { k: 1 }).topKOverlap)
      .toBe(shadowCompare.compare(reversed, { k: 1 }).topKOverlap);
  });

  it('reports the mean and max absolute score delta — the magnitude the ranks hide', () => {
    const entries = [
      { key: 'a', served: 0.9, shadow: 0.5 },
      { key: 'b', served: 0.2, shadow: 0.4 },
    ];
    const stats = shadowCompare.compare(entries, { k: 2 });
    expect(stats.meanAbsDelta).toBeCloseTo(0.3, 10);
    expect(stats.maxAbsDelta).toBeCloseTo(0.4, 10);
  });
});

describe('W4-007 S12 · shadowCompare.summarizeLine — one line, no vitals', () => {
  const stats = shadowCompare.compare(
    [{ key: 'a', served: 0.9, shadow: 0.5 }, { key: 'b', served: 0.2, shadow: 0.4 }],
    { k: 2 }
  );

  it('emits a single line in the house key=value shape', () => {
    const line = shadowCompare.summarizeLine(stats, { served: 'v2', shadow: 'v1', ms: 3 });
    expect(line.split('\n')).toHaveLength(1);
    expect(line.startsWith('[selection.shadow] ')).toBe(true);
    expect(line).toMatch(/\bspearman=/);
    expect(line).toMatch(/\btopK=/);
  });

  it('publishes ONLY scoring statistics — the key set is closed (zero-knowledge)', () => {
    const line = shadowCompare.summarizeLine(stats, { served: 'v2', shadow: 'v1', ms: 3 });
    const keys = [...line.matchAll(/([a-zA-Z0-9]+)=/g)].map(m => m[1]).sort();
    expect(keys).toEqual([
      'dropped', 'k', 'maxAbsDelta', 'meanAbsDelta', 'ms', 'n', 'served', 'shadow',
      'spearman', 'top1', 'topK',
    ]);
  });

  it('prints an undefined correlation as "na" rather than NaN or null', () => {
    const flat = shadowCompare.compare(
      [{ key: 'a', served: 0.5, shadow: 0.1 }, { key: 'b', served: 0.5, shadow: 0.2 }],
      { k: 2 }
    );
    expect(shadowCompare.summarizeLine(flat, { served: 'v2', shadow: 'v1', ms: 1 }))
      .toMatch(/spearman=na\b/);
  });
});

describe('W4-007 S12 · the enable flag', () => {
  it('is OFF by default and OFF for every falsey spelling', () => {
    expect(shadowCompare.shadowEnabled({})).toBe(false);
    for (const v of ['', ' ', '0', 'false', 'no', 'off', 'FALSE']) {
      expect(shadowCompare.shadowEnabled({ [SHADOW]: v })).toBe(false);
    }
  });

  it('is ON for any other non-empty value — an ENABLE flag must not turn on for "0"', () => {
    for (const v of ['1', 'true', 'yes', 'on', 'shadow']) {
      expect(shadowCompare.shadowEnabled({ [SHADOW]: v })).toBe(true);
    }
  });
});

// ── 2 · the explicit version seam on scoreTrack ───────────────────────────────────────────

describe('W4-007 S12 · scoreTrack takes an explicit version (no env mutation to compare)', () => {
  const track = { canonicalKey: 'k', affinity: 5, features: { bpm: 120, energy: 0.6, valence: 0.5 } };
  const targets = { bpmCenter: 120, bpmWidth: 20, energyFloor: 0.4, energyCeiling: 0.8, valenceTarget: 0.5 };

  it('scores v1 on demand while the process is serving v2', () => {
    const out = scoreTrack(track, { targets, maxAffinity: 5, version: 'v1' });
    expect(out.terms.scoringVersion).toBe('v1');
  });

  it('scores v2 on demand while the process is serving v1 (flag set)', () => {
    process.env[DISABLE] = '1';
    _resetWeights();
    const out = scoreTrack(track, { targets, maxAffinity: 5, version: 'v2' });
    expect(out.terms.scoringVersion).toBe('v2');
  });

  it('falls back to the flag when no version is named, so the serving path is unchanged', () => {
    expect(scoreTrack(track, { targets, maxAffinity: 5 }).terms.scoringVersion).toBe('v2');
    process.env[DISABLE] = '1';
    _resetWeights();
    expect(scoreTrack(track, { targets, maxAffinity: 5 }).terms.scoringVersion).toBe('v1');
  });

  it('ignores an unknown version rather than inventing a third scoring', () => {
    expect(scoreTrack(track, { targets, maxAffinity: 5, version: 'v9' }).terms.scoringVersion).toBe('v2');
  });
});

// ── 3 · the pipeline wiring ───────────────────────────────────────────────────────────────

// A pool built to make v1 and v2 disagree for the documented reasons: fully-measured tracks,
// tracks whose dims are PRESENT BUT NULL (the shape AudioFeature actually stores, which v1
// read as a fabricated 0.467), single-dim tracks (v1's fabricated 1.0), and featureless ones.
const POOL_SIZE = 40;
const lib = (i) => ({
  id: `t${i}`, provider: 'spotify', name: `Song ${i}`, artist: `Artist${i % 7}`,
  genres: i % 3 === 0 ? ['pop'] : ['rock'], affinity: POOL_SIZE - i, uri: `spotify:track:t${i}`,
});
const PROFILE = { library: Array.from({ length: POOL_SIZE }, (_, i) => lib(i)), lastAnalyzed: new Date('2026-07-01') };
const TARGETS = {
  bpmCenter: 120, bpmWidth: 30, energyFloor: 0.35, energyCeiling: 0.85,
  valenceTarget: 0.55, acousticnessBias: 0.2, confidence: 0.8,
};
const NOW = Date.parse('2026-07-02T12:00:00Z');

const featureDocs = () => new Map(Array.from({ length: POOL_SIZE }, (_, i) => {
  const key = `spotify:t${i}`;
  const mode = i % 4;
  if (mode === 0) {
    return [key, { bpm: 110 + i, energy: 0.4 + (i % 5) * 0.08, valence: 0.5, acousticness: 0.3, danceability: 0.6, source: 'api', confidence: 1 }];
  }
  if (mode === 1) { // present-but-null dims — v1 read these as 0
    return [key, { bpm: 118 + (i % 9), energy: null, valence: null, acousticness: null, danceability: null, source: 'llm', confidence: 0.4 }];
  }
  if (mode === 2) { // one measured dim — v1's fabricated perfect fit
    return [key, { bpm: 120, source: 'acousticbrainz', confidence: 0.85 }];
  }
  return [key, null]; // featureless
}));

const run = (extra = {}) => selectPlaylist({
  userId: 'u-shadow', musicProfile: PROFILE, moodKey: 'calm', provider: 'spotify',
  targets: TARGETS, k: 12, now: NOW, ...extra,
});

describe('W4-007 S12 · pipeline shadow compare', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    featureRepo.getMany.mockResolvedValue(featureDocs());
  });

  it('is inert by default: no shadow telemetry, no log line, no extra scoring', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const spy = jest.spyOn(shadowCompare, 'compare');
    const { telemetry } = await run();
    expect(telemetry.shadow).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
    expect(log.mock.calls.flat().join(' ')).not.toContain('[selection.shadow]');
  });

  it('ZERO USER IMPACT: the shipped playlist is identical with the flag on and off', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const off = await run();
    process.env[SHADOW] = '1';
    const on = await run();
    expect(on.tracks.map(t => t.id)).toEqual(off.tracks.map(t => t.id));
    expect(on.telemetry.afterFilters).toBe(off.telemetry.afterFilters);
    expect(on.telemetry.relaxLevel).toBe(off.telemetry.relaxLevel);
  });

  it('LOAD-BEARING: on a pool where v1 and v2 disagree, the instrument says so', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    process.env[SHADOW] = '1';
    const { telemetry } = await run();
    expect(telemetry.shadow).toBeTruthy();
    expect(telemetry.shadow.n).toBeGreaterThan(10);
    expect(telemetry.shadow.servedVersion).toBe('v2');
    expect(telemetry.shadow.shadowVersion).toBe('v1');
    expect(telemetry.shadow.spearman).toBeLessThan(1);      // the orderings really differ
    expect(telemetry.shadow.topKOverlap).toBeLessThan(1);
    expect(telemetry.shadow.maxAbsDelta).toBeGreaterThan(0);
  });

  it('logs exactly ONE shadow line per generation', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    process.env[SHADOW] = '1';
    await run();
    const lines = log.mock.calls.flat().filter(a => typeof a === 'string' && a.startsWith('[selection.shadow]'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/served=v2 shadow=v1/);
  });

  it('compares in the other direction when the process is serving v1', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    process.env[SHADOW] = '1';
    process.env[DISABLE] = '1';
    _resetWeights();
    const { telemetry } = await run();
    expect(telemetry.shadow.servedVersion).toBe('v1');
    expect(telemetry.shadow.shadowVersion).toBe('v2');
  });

  it('NEVER FATAL: a failure inside the compare cannot take generation down', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(shadowCompare, 'compare').mockImplementation(() => { throw new Error('boom'); });
    process.env[SHADOW] = '1';
    const { tracks, telemetry } = await run();
    expect(tracks).toHaveLength(12);
    expect(telemetry.shadow).toBeUndefined();
    expect(err.mock.calls.flat().join(' ')).toContain('[selection.shadow]');
  });

  it('reports an empty pool honestly instead of dividing by zero', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    process.env[SHADOW] = '1';
    const { telemetry } = await selectPlaylist({
      userId: 'u-empty', musicProfile: { library: [] }, moodKey: 'calm',
      provider: 'spotify', targets: TARGETS, k: 12, now: NOW,
    });
    expect(telemetry.shadow.n).toBe(0);
    expect(telemetry.shadow.spearman).toBeNull();
  });

  it('records its own cost as a stage timing, so the diagnostic is never free by accident', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    process.env[SHADOW] = '1';
    const { telemetry } = await run();
    expect(telemetry.stageMs.shadow).toBeGreaterThanOrEqual(0);
    expect(telemetry.stageMs.total).toBeGreaterThanOrEqual(telemetry.stageMs.shadow);
  });
});
