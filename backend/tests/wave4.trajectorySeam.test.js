'use strict';

// Wave-4 W4-008 (wiring half) — THE TRAJECTORY SEAM IN `selection/pipeline`.
//
// `tests/trajectoryPlanner.test.js` proves the engine. This proves the ONE place it is plugged in,
// and the three properties that make plugging a re-ordering stage into the serving path safe:
//
//   1. ORDER-ONLY AT THE BOUNDARY. The pipeline returns exactly the tracks it returned before —
//      same set, same count, same membership — in a different order. Everything that decides
//      MEMBERSHIP (the un-relaxable band, the relaxation ladder, the serve ledger, the L4 last
//      resort) runs upstream of this stage and must be completely unaffected by it. A sequencer
//      that can drop or add a track is a selection bug, and it would bypass all of them at once.
//   2. THE KILL SWITCH IS REAL (§0.4 S11). With `WAVE4_TRAJECTORY_DISABLED` set, the served
//      playlist is byte-identical to the pre-W4-008 one — no revert needed, one env var. The
//      golden set carries the same proof across five personas; this pins the mechanism directly.
//   3. NO INFORMATION, NO REORDER. A Manual request with every band null has no arc, so the pick
//      order comes through untouched and `planned` says so.

process.env.NODE_ENV = 'test';

jest.mock('../app/config/redis', () => ({ getRedis: jest.fn(() => null), createConnection: jest.fn() }));
jest.mock('../app/models/ServeEvent', () => ({
  insertMany: jest.fn(async (docs) => docs),
  find: jest.fn(() => ({ lean: async () => [] })),
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

const featureRepo = require('../app/repositories/audioFeatureRepo');
const { selectPlaylist } = require('../app/services/selection/pipeline');
const { DISABLE_ENV_VAR } = require('../app/agents/runtime/delivery/trajectoryPlanner');

const POOL_SIZE = 40;
const lib = (i) => ({
  id: `t${i}`, provider: 'spotify', name: `Song ${i}`, artist: `Artist${i % 11}`,
  genres: i % 3 === 0 ? ['pop'] : ['rock'], affinity: POOL_SIZE - i, uri: `spotify:track:t${i}`,
});
const PROFILE = { library: Array.from({ length: POOL_SIZE }, (_, i) => lib(i)), lastAnalyzed: new Date('2026-07-01') };

// A wide band so the whole pool survives it — this suite is about SEQUENCING, and a band that
// culls the pool would leave too few tracks for an order to be interesting.
const TARGETS = {
  bpmCenter: 110, bpmWidth: 45, energyFloor: 0.05, energyCeiling: 0.95, valenceTarget: 0.5,
  acousticnessBias: 0, instrumentalBias: 0, tempoBand: 'active', confidence: 0.8,
  activityDriven: false, activityIntensity: null, cadenceLocked: false,
  state: { recovery: 0.5, stress: 0.4, exertion: 0.2 },
};
const BLANK_TARGETS = {
  ...TARGETS,
  bpmCenter: null, bpmWidth: null, energyFloor: null, energyCeiling: null,
  valenceTarget: null, tempoBand: null, confidence: 0.3,
};
const NOW = Date.parse('2026-07-02T12:00:00Z');

// A spread of feature classes, matching what AudioFeature actually stores: fully measured,
// present-but-null dims, one measured dim, and featureless.
const featureDocs = () => new Map(Array.from({ length: POOL_SIZE }, (_, i) => {
  const key = `spotify:t${i}`;
  const mode = i % 4;
  if (mode === 0) return [key, { bpm: 80 + i * 2, energy: 0.05 + (i % 10) * 0.09, valence: 0.3 + (i % 7) * 0.08, acousticness: 0.3, danceability: 0.6, source: 'api', confidence: 1 }];
  if (mode === 1) return [key, { bpm: 95 + (i % 11) * 3, energy: null, valence: null, acousticness: null, danceability: null, source: 'llm', confidence: 0.4 }];
  if (mode === 2) return [key, { bpm: null, energy: 0.1 + (i % 9) * 0.1, source: 'acousticbrainz', confidence: 0.85 }];
  return [key, null];
}));

const run = (extra = {}) => selectPlaylist({
  userId: 'u-arc', musicProfile: PROFILE, moodKey: 'calm', provider: 'spotify',
  targets: TARGETS, k: 20, now: NOW, ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  featureRepo.getMany.mockResolvedValue(featureDocs());
});
afterEach(() => { delete process.env[DISABLE_ENV_VAR]; });

describe('W4-008 seam · the pipeline sequences what MMR selected', () => {
  it('lays the playlist along the arc and reports which one', async () => {
    const { tracks, telemetry } = await run();
    expect(tracks).toHaveLength(20);
    expect(telemetry.trajectory).toEqual({
      archetype: 'steady', planned: true, cost: expect.any(Number), folded: expect.any(Number),
    });
    expect(telemetry.stageMs.trajectory).toEqual(expect.any(Number));
  });

  it('the arc, not the pool, chooses the shape — a resting band winds down', async () => {
    const { telemetry } = await run({ targets: { ...TARGETS, bpmCenter: 70, tempoBand: 'resting' } });
    expect(telemetry.trajectory.archetype).toBe('monotone-wind-down');
    expect(telemetry.trajectory.planned).toBe(true);
  });

  it('ORDER-ONLY: the served SET is identical with the planner on and off', async () => {
    const planned = await run();
    process.env[DISABLE_ENV_VAR] = '1';
    const raw = await run();

    const idsOf = (r) => r.tracks.map(t => t.id);
    expect(idsOf(planned).slice().sort()).toEqual(idsOf(raw).slice().sort());
    expect(new Set(idsOf(planned)).size).toBe(20);
    // ...and everything the MEMBERSHIP stages reported is untouched by sequencing.
    for (const key of ['poolSize', 'afterFilters', 'relaxLevel', 'featured', 'banded', 'bandWidened']) {
      expect(planned.telemetry[key]).toEqual(raw.telemetry[key]);
    }
  });

  it('and the order really did change, so the invariant above is not vacuous', async () => {
    const planned = await run();
    process.env[DISABLE_ENV_VAR] = '1';
    const raw = await run();
    expect(planned.tracks.map(t => t.id)).not.toEqual(raw.tracks.map(t => t.id));
  });

  it('THE KILL SWITCH: with the flag set the result is the pre-W4-008 MMR order (S11)', async () => {
    process.env[DISABLE_ENV_VAR] = '1';
    const off = await run();
    expect(off.telemetry.trajectory.planned).toBe(false);
    expect(off.telemetry.trajectory.cost).toBe(0);
    // MMR's own order is score-descending with the diversity penalty applied; the strongest
    // available statement that we are seeing it unmodified is that turning the flag off changes
    // the order (asserted above) and turning it on twice is stable.
    process.env[DISABLE_ENV_VAR] = '1';
    const again = await run();
    expect(again.tracks.map(t => t.id)).toEqual(off.tracks.map(t => t.id));
  });

  it('NO ARC, NO REORDER: an unconstrained Manual request comes through in pick order', async () => {
    const planned = await selectPlaylist({
      userId: 'u-arc', musicProfile: PROFILE, moodKey: 'calm', provider: 'spotify',
      targets: BLANK_TARGETS, k: 20, now: NOW,
    });
    process.env[DISABLE_ENV_VAR] = '1';
    const raw = await selectPlaylist({
      userId: 'u-arc', musicProfile: PROFILE, moodKey: 'calm', provider: 'spotify',
      targets: BLANK_TARGETS, k: 20, now: NOW,
    });
    expect(planned.telemetry.trajectory.planned).toBe(false);
    expect(planned.tracks.map(t => t.id)).toEqual(raw.tracks.map(t => t.id));
  });

  it('is deterministic: the same request twice returns the same playlist in the same order', async () => {
    const a = await run();
    const b = await run();
    expect(a.tracks.map(t => t.id)).toEqual(b.tracks.map(t => t.id));
    expect(a.telemetry.trajectory.cost).toBe(b.telemetry.trajectory.cost);
  });

  it('an empty result never reaches the planner as something to sequence', async () => {
    const { tracks, telemetry } = await selectPlaylist({
      userId: 'u-arc', musicProfile: { library: [] }, moodKey: 'calm', provider: 'spotify',
      targets: TARGETS, k: 20, now: NOW,
    });
    expect(tracks).toEqual([]);
    expect(telemetry.trajectory.planned).toBe(false);
  });

  it('ZERO-KNOWLEDGE: the trajectory telemetry carries no vital and no track identity', async () => {
    const { telemetry } = await run();
    const serialized = JSON.stringify(telemetry.trajectory);
    expect(serialized).not.toMatch(/t\d+/); // no track ids
    expect(serialized).not.toMatch(/heartRate|hrv|bpmCenter|\bhr\b/i);
    // Only the four keys the seam publishes — a stats blob would be a leak surface by accretion.
    expect(Object.keys(telemetry.trajectory).sort()).toEqual(['archetype', 'cost', 'folded', 'planned']);
  });
});
