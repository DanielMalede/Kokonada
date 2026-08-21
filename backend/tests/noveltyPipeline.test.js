'use strict';

/**
 * W4-013 (B5) · the read side — the novelty budget reaching a real playlist.
 *
 * The load-bearing suite is the DORMANCY one. This is STRETCH work that ships dark, and it sits
 * on the serving path, so there are TWO independent guarantees and both are pinned here:
 *
 *   1. the flag is unset → the posterior is never read, the plan is never made, and the playlist
 *      is byte-identical to today's;
 *   2. the flag is SET but the bucket has no evidence → the bandit abstains, and the playlist is
 *      byte-identical to today's anyway.
 *
 * (2) is the one that matters, because it is the state every real user is in on day one. A bandit
 * that sampled its Beta(2,2) prior would pass (1) and fail (2) — it would quietly reshuffle every
 * playlist by a coin flip and look, from the outside, exactly like a feature that was working.
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
jest.mock('../app/repositories/rewardRepo', () => ({
  readNoveltyPosterior: jest.fn().mockResolvedValue(null),
  recordBucketReward: jest.fn(),
  recordTrackOutcome: jest.fn(),
  recordNoveltyOutcome: jest.fn(),
}));

const ledger = require('../app/services/ledger/serveLedger');
const featureRepo = require('../app/repositories/audioFeatureRepo');
const vectorIndex = require('../app/services/vector/vectorIndex');
const rewardRepo = require('../app/repositories/rewardRepo');
const { selectPlaylist } = require('../app/services/selection/pipeline');
const { NOVELTY_FLAG } = require('../app/agents/runtime/knowledge/noveltyController');

const lib = (id, { affinity = 5 } = {}) =>
  ({ id, provider: 'spotify', name: `Song ${id}`, artist: `Artist${id}`, genres: ['pop'], affinity, uri: `spotify:track:${id}` });

/**
 * Discovery candidates come in two grades on purpose: even ids carry the allowed genre and odd
 * ids carry one the mood's allow-list rejects, so they score measurably differently. Without that
 * the whole pool scores identically and "keeps the BEST" is unfalsifiable — a trim that kept an
 * arbitrary prefix would pass just as happily.
 */
const disc = (id) => ({
  ...lib(`d${id}`, { affinity: 0 }),
  genres: id % 2 === 0 ? ['pop'] : ['polka'],
  isDiscovery: true,
});

/**
 * Fifteen familiar tracks against a k of twenty. The size is deliberate and was MEASURED, not
 * guessed: with a 40-track library the familiar tail outscores every discovery candidate and none
 * is ever served, which made the first draft of every quota assertion below pass vacuously
 * (`servedDiscovery <= budget` is trivially true at zero). The control test at the top of the
 * quota block now pins that discovery really does get served when the bandit is not looking.
 */
const PROFILE = {
  library: Array.from({ length: 15 }, (_, i) => lib(`t${i}`, { affinity: 15 - i })),
  lastAnalyzed: new Date('2026-07-01'),
};

/** Enough discovery candidates that a quota has something to actually cut. */
const DISCOVERY = Array.from({ length: 20 }, (_, i) => disc(i));

const BASE = {
  userId: 'u1',
  musicProfile: PROFILE,
  moodKey: 'uplift',
  provider: 'spotify',
  aiParams: { exclude_genres: [], allow_genres: ['pop'] },
  // A full W4-011 bucket address: tempoBand + hourOfDay + stateId are what `contextFromTargets`
  // and `bucketOf` need to name the cell this generation belongs to.
  targets: {
    bpmCenter: 120, bpmWidth: 20, energyFloor: 0.3, energyCeiling: 0.8, valenceTarget: 0.6,
    confidence: 1, tempoBand: 'active', hourOfDay: 14, stateId: 'steady-cardio',
  },
  discoveryTracks: DISCOVERY,
  k: 20,
};

const discoveryCount = (tracks) => tracks.filter((t) => t.isDiscovery).length;

beforeEach(() => {
  jest.clearAllMocks();
  ledger.hardExcluded.mockResolvedValue(new Set());
  ledger.moodExcluded.mockResolvedValue(new Set());
  ledger.getExposure.mockResolvedValue(new Map());
  featureRepo.getMany.mockResolvedValue(new Map());
  vectorIndex.getMany.mockResolvedValue(new Map());
  rewardRepo.readNoveltyPosterior.mockResolvedValue(null);
  delete process.env[NOVELTY_FLAG];
  delete process.env.SELECTION_SHADOW;
});

describe('W4-013 · DORMANCY INVARIANT', () => {
  it('with the flag unset the posterior is never even READ', async () => {
    await selectPlaylist(BASE);
    expect(rewardRepo.readNoveltyPosterior).not.toHaveBeenCalled();
  });

  it('with the flag unset the telemetry object is unchanged — no novelty key at all', async () => {
    const { telemetry } = await selectPlaylist(BASE);
    expect('novelty' in telemetry).toBe(false);
  });

  it('with the flag unset the playlist is byte-identical to the pre-W4-013 selection', async () => {
    const before = await selectPlaylist(BASE);
    process.env[NOVELTY_FLAG] = 'true';
    rewardRepo.readNoveltyPosterior.mockResolvedValue(null); // enabled, but no evidence anywhere
    const after = await selectPlaylist(BASE);
    expect(after.tracks.map((t) => t.id)).toEqual(before.tracks.map((t) => t.id));
  });

  it('with the flag SET but no evidence, the bandit abstains and imposes no quota', async () => {
    const before = await selectPlaylist(BASE);
    process.env[NOVELTY_FLAG] = 'true';
    const after = await selectPlaylist(BASE);

    expect(rewardRepo.readNoveltyPosterior).toHaveBeenCalledTimes(1);
    expect(after.telemetry.novelty).toEqual(expect.objectContaining({ budget: null, reason: 'no-evidence' }));
    expect(after.tracks.map((t) => t.id)).toEqual(before.tracks.map((t) => t.id));
  });

  it('an untouched Beta(2,2) prior counts as NO evidence — the coin flip never happens', async () => {
    // Guards the exact failure mode the module header argues against. If someone later "fixes"
    // the abstention by sampling the prior, this playlist stops matching.
    const before = await selectPlaylist(BASE);
    process.env[NOVELTY_FLAG] = 'true';
    rewardRepo.readNoveltyPosterior.mockResolvedValue({ alpha: 2, beta: 2 });
    const after = await selectPlaylist(BASE);
    expect(after.telemetry.novelty.budget).toBeNull();
    expect(after.tracks.map((t) => t.id)).toEqual(before.tracks.map((t) => t.id));
  });
});

describe('W4-013 · the quota, once there is evidence', () => {
  beforeEach(() => { process.env[NOVELTY_FLAG] = 'true'; });

  it('CONTROL: without a quota, discovery really is served — every assertion below depends on it', async () => {
    delete process.env[NOVELTY_FLAG];
    const { tracks } = await selectPlaylist(BASE);
    expect(discoveryCount(tracks)).toBeGreaterThan(Math.round(20 * 0.3));
  });

  it('reads the posterior at the bucket THIS generation belongs to', async () => {
    rewardRepo.readNoveltyPosterior.mockResolvedValue({ alpha: 20, beta: 4 });
    await selectPlaylist(BASE);
    expect(rewardRepo.readNoveltyPosterior).toHaveBeenCalledWith({
      userId: 'u1',
      bucket: { stateDomain: 'movement', targetBand: 'active', hourBin: 2 },
    });
  });

  it('a bucket that has only ever been skipped drives discovery OUT of the playlist', async () => {
    rewardRepo.readNoveltyPosterior.mockResolvedValue({ alpha: 2, beta: 500 });
    const { tracks, telemetry } = await selectPlaylist(BASE);
    expect(telemetry.novelty.budget).toBe(0);
    expect(discoveryCount(tracks)).toBe(0);
    // The familiar library is all that is left, and all of it is served: the quota removed the
    // gambles, it did not shorten the playlist by any more than there was novelty to remove.
    expect(tracks).toHaveLength(PROFILE.library.length);
  });

  it('the served discovery count never exceeds the budget', async () => {
    rewardRepo.readNoveltyPosterior.mockResolvedValue({ alpha: 500, beta: 2 });
    const { tracks, telemetry } = await selectPlaylist(BASE);
    expect(telemetry.novelty.budget).toBeGreaterThan(0);
    expect(discoveryCount(tracks)).toBeGreaterThan(0);
    expect(discoveryCount(tracks)).toBeLessThanOrEqual(telemetry.novelty.budget);
  });

  it('§M.14 30% cap: an unbeaten bucket still cannot spend more than 30% of the list', async () => {
    rewardRepo.readNoveltyPosterior.mockResolvedValue({ alpha: 5000, beta: 2 });
    const { tracks, telemetry } = await selectPlaylist(BASE);
    expect(telemetry.novelty.budget).toBeLessThanOrEqual(Math.round(20 * 0.3));
    expect(discoveryCount(tracks)).toBeLessThanOrEqual(Math.round(20 * 0.3));
    // Without the cap this pool would serve well past 6 (see the CONTROL test above).
    expect(discoveryCount(tracks)).toBeGreaterThan(0);
  });

  it('NEVER trims a familiar track — the quota is a ceiling on novelty, not on the playlist', async () => {
    rewardRepo.readNoveltyPosterior.mockResolvedValue({ alpha: 2, beta: 500 });
    const withQuota = await selectPlaylist(BASE);
    const familiarOnly = await selectPlaylist({ ...BASE, discoveryTracks: [] });
    expect(withQuota.tracks.map((t) => t.id)).toEqual(familiarOnly.tracks.map((t) => t.id));
  });

  it('keeps the BEST-scoring discovery candidates, not an arbitrary prefix', async () => {
    rewardRepo.readNoveltyPosterior.mockResolvedValue({ alpha: 5000, beta: 2 });
    const { tracks, telemetry } = await selectPlaylist(BASE);

    expect(telemetry.novelty.considered).toBe(DISCOVERY.length);
    expect(telemetry.novelty.kept).toBeLessThanOrEqual(telemetry.novelty.budget);

    // Ten on-genre candidates and ten off-genre ones; the budget is at most 6. Every discovery
    // track that survives must therefore be an on-genre one — an arbitrary prefix, or a trim in
    // pool order, would serve `polka` here.
    const servedDiscovery = tracks.filter((t) => t.isDiscovery);
    expect(servedDiscovery.length).toBeGreaterThan(0);
    for (const t of servedDiscovery) expect(t.genres).toEqual(['pop']);
  });

  it('a generation with no discovery candidates plans nothing to cut', async () => {
    rewardRepo.readNoveltyPosterior.mockResolvedValue({ alpha: 500, beta: 2 });
    const { tracks, telemetry } = await selectPlaylist({ ...BASE, discoveryTracks: [] });
    expect(telemetry.novelty.considered).toBe(0);
    expect(discoveryCount(tracks)).toBe(0);
  });
});

describe('W4-013 · the bandit can never take generation down', () => {
  beforeEach(() => { process.env[NOVELTY_FLAG] = 'true'; });

  it('a posterior read that THROWS still serves a full playlist', async () => {
    rewardRepo.readNoveltyPosterior.mockRejectedValue(new Error('mongo is having a day'));
    const { tracks, telemetry } = await selectPlaylist(BASE);
    expect(tracks).toHaveLength(20);
    expect(discoveryCount(tracks)).toBeGreaterThan(0); // and the un-quota'd discovery still flows
    expect(telemetry.novelty).toEqual(expect.objectContaining({ budget: null, reason: 'error' }));
  });

  it('a generation whose targets name no bucket abstains rather than guessing one', async () => {
    const { tracks, telemetry } = await selectPlaylist({
      ...BASE,
      targets: { ...BASE.targets, tempoBand: null, stateId: null, hourOfDay: null },
    });
    expect(rewardRepo.readNoveltyPosterior).not.toHaveBeenCalled();
    expect(telemetry.novelty).toEqual(expect.objectContaining({ budget: null, reason: 'no-bucket' }));
    expect(tracks).toHaveLength(20);
  });
});
