'use strict';

/**
 * W4-013 (B7) · the read side — a learned overlay reaching a real ranking.
 *
 * As with B5, the load-bearing suite is the DORMANCY one, and for the same reason: this is
 * STRETCH work, it ships dark, and it sits on the serving path. There are THREE independent
 * guarantees and all three are pinned below, because each fails differently:
 *
 *   1. the flag is unset → the row is never read, no overlay is computed, the playlist is
 *      byte-identical to today's;
 *   2. the flag is SET but the listener has no row → cold start, global weights, byte-identical;
 *   3. the flag is SET and a row exists but has DECAYED back into global weights → also
 *      byte-identical, because `overlay` returns the caller's own object by identity.
 *
 * (3) is the one an implementation gets wrong. A δ of 1e-12 that still went through the
 * multiply-and-renormalise would produce weights that differ in the last few bits — enough to
 * flip two tracks that were tied, so the playlist changes for a listener the system has, in
 * substance, learned nothing about. Identity-return is what makes the invariant exact.
 */

process.env.NODE_ENV = 'test';

jest.mock('../app/config/redis', () => ({ getRedis: jest.fn(() => null), createConnection: jest.fn() }));
jest.mock('../app/services/ledger/serveLedger', () => ({
  recordServes: jest.fn(),
  hardExcluded: jest.fn().mockResolvedValue(new Set()),
  moodExcluded: jest.fn().mockResolvedValue(new Set()),
  getExposure: jest.fn().mockResolvedValue(new Map()),
}));
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
jest.mock('../app/repositories/personalWeightsRepo', () => ({
  readWeights: jest.fn().mockResolvedValue(null),
  applyUpdate: jest.fn(),
}));

const ledger = require('../app/services/ledger/serveLedger');
const featureRepo = require('../app/repositories/audioFeatureRepo');
const vectorIndex = require('../app/services/vector/vectorIndex');
const weightsRepo = require('../app/repositories/personalWeightsRepo');
const { selectPlaylist } = require('../app/services/selection/pipeline');
const P = require('../app/agents/runtime/learning/personalization');

/**
 * The library is built so TASTE and FEATURE FIT disagree. `t0..t7` are high-affinity tracks whose
 * measured features sit far from the band; `f0..f7` are lower-affinity tracks close to it, with a
 * graded affinity so the boundary between the two groups falls INSIDE the playlist rather than at
 * its edge. A ranking that leans harder on taste serves more `t`; one that leans on the biosonic
 * fit serves more `f`. Without that tension an overlay could be applied perfectly and change
 * nothing observable, and every assertion below would be vacuous.
 *
 * Features are fed through the MOCKED `audioFeatureRepo`, not attached to the track objects:
 * stage 2 of the pipeline overwrites `track.features` from the store for every candidate, so an
 * inline value is silently discarded and every track scores identically. (Measured, not assumed —
 * the first draft of this fixture did exactly that and served the library in insertion order.)
 */
const tasty = (i) => ({
  id: `t${i}`, provider: 'spotify', name: `Loved ${i}`, artist: `A${i}`, genres: ['pop'],
  affinity: 20 - i, uri: `spotify:track:t${i}`,
});
const fitting = (i) => ({
  id: `f${i}`, provider: 'spotify', name: `Fits ${i}`, artist: `B${i}`, genres: ['pop'],
  affinity: 12 - i, uri: `spotify:track:f${i}`,
});

/** What the store would hand back for each of them. `api` provenance = full source confidence. */
const FEATURES = new Map([
  ...Array.from({ length: 8 }, (_, i) => [`spotify:t${i}`, {
    source: 'api', confidence: 1,
    bpm: 58 + i, energy: 0.05 + 0.01 * i, valence: 0.05 + 0.01 * i, acousticness: 0.88, danceability: 0.4,
  }]),
  ...Array.from({ length: 8 }, (_, i) => [`spotify:f${i}`, {
    source: 'api', confidence: 1,
    bpm: 98 + i, energy: 0.5 + 0.012 * i, valence: 0.56 + 0.012 * i, acousticness: 0.18, danceability: 0.6,
  }]),
]);

const PROFILE = {
  library: [...Array.from({ length: 8 }, (_, i) => tasty(i)), ...Array.from({ length: 8 }, (_, i) => fitting(i))],
  lastAnalyzed: new Date('2026-07-01'),
};

const BASE = {
  userId: 'u1',
  musicProfile: PROFILE,
  moodKey: 'uplift',
  provider: 'spotify',
  aiParams: { exclude_genres: [], allow_genres: ['pop'] },
  targets: {
    // A WIDE band: the biosonic gate must not do the discriminating for us, or the overlay's
    // effect on the RANKING would be invisible behind a hard filter. Pinned below by asserting
    // that all sixteen candidates survive it.
    bpmCenter: 100, bpmWidth: 90, energyFloor: 0, energyCeiling: 1, valenceTarget: 0.6,
    confidence: 1, tempoBand: 'active', hourOfDay: 14, stateId: 'steady-cardio',
  },
  discoveryTracks: [],
  k: 8,
};

const ids = (r) => r.tracks.map((t) => t.id);
const nFitting = (r) => r.tracks.filter((t) => t.id.startsWith('f')).length;

const row = (deltas) => ({ deltas: { ...P.ZERO_DELTAS, ...deltas }, updatedAt: new Date(), updates: 12 });

beforeEach(() => {
  jest.clearAllMocks();
  ledger.hardExcluded.mockResolvedValue(new Set());
  ledger.moodExcluded.mockResolvedValue(new Set());
  ledger.getExposure.mockResolvedValue(new Map());
  featureRepo.getMany.mockResolvedValue(FEATURES);
  vectorIndex.getMany.mockResolvedValue(new Map());
  weightsRepo.readWeights.mockResolvedValue(null);
  delete process.env[P.PERSONAL_FLAG];
  delete process.env.SELECTION_SHADOW;
  delete process.env.WAVE4_SCORING_V2_DISABLED;
});

describe('W4-013 · B7 DORMANCY INVARIANT', () => {
  it('with the flag unset the overlay row is never even READ', async () => {
    await selectPlaylist(BASE);
    expect(weightsRepo.readWeights).not.toHaveBeenCalled();
  });

  it('with the flag unset the telemetry object is unchanged — no personal key at all', async () => {
    const { telemetry } = await selectPlaylist(BASE);
    expect('personal' in telemetry).toBe(false);
  });

  it('with the flag SET but no row, the playlist is byte-identical to today', async () => {
    const before = await selectPlaylist(BASE);
    process.env[P.PERSONAL_FLAG] = 'true';
    const after = await selectPlaylist(BASE);

    expect(weightsRepo.readWeights).toHaveBeenCalledTimes(1);
    expect(after.telemetry.personal).toEqual(expect.objectContaining({ applied: false, reason: 'cold-start' }));
    expect(ids(after)).toEqual(ids(before));
  });

  it('with a row that has DECAYED back into global weights, byte-identical too', async () => {
    const before = await selectPlaylist(BASE);
    process.env[P.PERSONAL_FLAG] = 'true';
    // A real δ, but stamped two years ago: 0.98^104 ≈ 0.12 of it survives... so make it tiny to
    // start with, which is the state every long-decayed row eventually reaches.
    weightsRepo.readWeights.mockResolvedValue({
      deltas: { ...P.ZERO_DELTAS, taste: 1e-9 }, updatedAt: new Date(), updates: 3,
    });
    const after = await selectPlaylist(BASE);

    expect(after.telemetry.personal).toEqual(expect.objectContaining({ applied: false, reason: 'no-evidence' }));
    expect(ids(after)).toEqual(ids(before));
  });

  it('a broken overlay read can never take generation down', async () => {
    const before = await selectPlaylist(BASE);
    process.env[P.PERSONAL_FLAG] = 'true';
    weightsRepo.readWeights.mockRejectedValue(new Error('mongo is unwell'));

    const after = await selectPlaylist(BASE);
    expect(after.telemetry.personal).toEqual(expect.objectContaining({ applied: false, reason: 'error' }));
    expect(ids(after)).toEqual(ids(before));
  });

  it('the S11 scoring kill-switch also disables the overlay — v1 is restored WHOLE', async () => {
    // `WAVE4_SCORING_V2_DISABLED` promises the entire pre-W4-007 behaviour back with no revert.
    // An overlay that kept running on top of the v1 weights would make that promise false, and
    // the v1 weights are not normalised, so §M.15's re-allocation is not even defined over them.
    process.env[P.PERSONAL_FLAG] = 'true';
    process.env.WAVE4_SCORING_V2_DISABLED = 'true';
    weightsRepo.readWeights.mockResolvedValue(row({ taste: 0.4, feature: -0.4 }));

    const withOverlay = await selectPlaylist(BASE);
    expect(weightsRepo.readWeights).not.toHaveBeenCalled();
    expect('personal' in withOverlay.telemetry).toBe(false);
  });
});

describe('W4-013 · B7 the overlay actually re-ranks', () => {
  it('the fixture is not vacuous: taste and biosonic fit genuinely disagree', async () => {
    const base = await selectPlaylist(BASE);
    // Default mood weights favour taste (0.35) over feature (0.30), so the loved-but-unfitting
    // tracks lead. If this ever stops holding, every assertion below needs re-deriving.
    expect(nFitting(base)).toBeLessThan(BASE.k);
    expect(nFitting(base)).toBeGreaterThan(0);
  });

  it('a listener whose rewards favour FEATURE FIT is served more on-band music', async () => {
    const before = await selectPlaylist(BASE);
    process.env[P.PERSONAL_FLAG] = 'true';
    weightsRepo.readWeights.mockResolvedValue(row({ taste: -0.4, feature: 0.4 }));

    const after = await selectPlaylist(BASE);
    expect(after.telemetry.personal).toEqual(expect.objectContaining({ applied: true, updates: 12 }));
    expect(nFitting(after)).toBeGreaterThan(nFitting(before));
  });

  it('and the opposite δ moves it the opposite way', async () => {
    process.env[P.PERSONAL_FLAG] = 'true';
    weightsRepo.readWeights.mockResolvedValue(row({ taste: 0.4, feature: -0.4 }));
    const towardTaste = await selectPlaylist(BASE);

    weightsRepo.readWeights.mockResolvedValue(row({ taste: -0.4, feature: 0.4 }));
    const towardFit = await selectPlaylist(BASE);

    expect(nFitting(towardFit)).toBeGreaterThan(nFitting(towardTaste));
  });

  it('still serves a FULL playlist — an overlay reorders, it never filters', async () => {
    process.env[P.PERSONAL_FLAG] = 'true';
    weightsRepo.readWeights.mockResolvedValue(row({ taste: -0.4, feature: 0.4 }));
    const r = await selectPlaylist(BASE);
    expect(r.tracks).toHaveLength(BASE.k);
    expect(new Set(ids(r)).size).toBe(BASE.k);
  });

  it('reads the row ONCE per generation, not once per candidate', async () => {
    process.env[P.PERSONAL_FLAG] = 'true';
    weightsRepo.readWeights.mockResolvedValue(row({ taste: 0.4, feature: -0.4 }));
    await selectPlaylist(BASE);
    expect(weightsRepo.readWeights).toHaveBeenCalledTimes(1);
  });
});

describe('W4-013 · B7 the gradients the write lane will need', () => {
  it('are absent entirely when the feature is off', async () => {
    const r = await selectPlaylist(BASE);
    expect(r.gradients).toBeNull();
  });

  it('are emitted for the SERVED tracks, keyed the way the client names them', async () => {
    process.env[P.PERSONAL_FLAG] = 'true';
    const r = await selectPlaylist(BASE);

    expect(Array.isArray(r.gradients)).toBe(true);
    expect(r.gradients).toHaveLength(BASE.k);
    for (const g of r.gradients) {
      expect(typeof g.key).toBe('string');
      expect(g.key.length).toBeGreaterThan(0);
      for (const d of P.PERSONAL_TERMS) {
        expect(Number.isFinite(g.g[d])).toBe(true);
        expect(Math.abs(g.g[d])).toBeLessThanOrEqual(1);
      }
    }
    // Every served track is represented exactly once.
    expect(new Set(r.gradients.map((g) => g.key)).size).toBe(BASE.k);
  });

  it('are computed against the weights that ACTUALLY ranked the track, overlay included', async () => {
    process.env[P.PERSONAL_FLAG] = 'true';
    const plain = await selectPlaylist(BASE);

    weightsRepo.readWeights.mockResolvedValue(row({ taste: 0.4, feature: -0.4 }));
    const overlaid = await selectPlaylist(BASE);

    // Same track, different weights in force → a different centring, so a different gradient.
    // A gradient computed against the GLOBAL table would be identical here, and every δ the
    // learner then took would be a step along the wrong direction.
    // A track SERVED IN BOTH — the overlay changes membership, so the two lists only partly
    // overlap and picking `[0]` blindly compares a track against its own absence.
    const shared = overlaid.gradients.map((g) => g.key)
      .filter((k) => plain.gradients.some((g) => g.key === k));
    expect(shared.length).toBeGreaterThan(0);

    const a = plain.gradients.find((g) => g.key === shared[0]);
    const b = overlaid.gradients.find((g) => g.key === shared[0]);
    expect(b.g.taste).not.toBeCloseTo(a.g.taste, 6);
  });
});
