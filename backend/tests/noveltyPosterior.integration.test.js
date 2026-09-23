'use strict';

// W4-013 (B5) — REAL-Mongo integration test for the novelty posterior.
//
// The posterior lives as a sub-document ON the W4-011 `RewardEvent` bucket row rather than in a
// collection of its own, and that is the decision this suite is really guarding. It shares the
// bucket's address, its unique index, its TTL and its whole S5 registration; a second collection
// keyed by the SAME three coordinates would be the "second disagreeing table" class (D11 /
// W4-D42) that this wave keeps finding, and it would need five erasure surfaces re-registered to
// hold exactly the counterpart of a row that already exists.
//
// The seeding problem is the same one `rewardRepo`'s header documents for Track B and it has the
// same solution: an `$inc` on a path with a schema default lands Beta(1,0) on insert, so the
// prior has to be expressed as an aggregation-pipeline `$ifNull`, atomically, in one round trip.

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV = 'test';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { RewardEvent, TrackPosterior, REWARD_EVENT_VERSION } = require('../app/models/RewardEvent');
const rewardRepo = require('../app/repositories/rewardRepo');
const { NOVELTY_PRIOR } = require('../app/agents/runtime/knowledge/noveltyController');
const { HOUR_BINS } = require('../app/agents/runtime/learning/feedbackLoop');

jest.setTimeout(120000);

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_wave4_novelty' });
  await RewardEvent.syncIndexes();
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});
beforeEach(async () => {
  await RewardEvent.deleteMany({});
  await TrackPosterior.deleteMany({});
});

const uid = () => new mongoose.Types.ObjectId();
const AT = new Date('2026-08-21T10:00:00Z');
const bucket = (o = {}) => ({ stateDomain: 'stress', targetBand: 'resting', hourBin: 3, ...o });

describe('W4-013 · recordNoveltyOutcome — seeding the prior atomically', () => {
  it('seeds Beta(2,2) and applies the observation in ONE write on first sight', async () => {
    const userId = uid();
    const ok = await rewardRepo.recordNoveltyOutcome({
      userId, bucket: bucket(), delta: { alpha: 1, beta: 0 }, at: AT,
    });
    expect(ok).toBe(true);

    const row = await RewardEvent.findOne({ userId }).lean();
    expect(row.novelty).toEqual({ alpha: NOVELTY_PRIOR.alpha + 1, beta: NOVELTY_PRIOR.beta });
    expect(row.v).toBe(REWARD_EVENT_VERSION);
    // The novelty write is not a reward observation: it must not inflate the bucket's own mean.
    expect(row.rewardSum).toBe(0);
    expect(row.count).toBe(0);
  });

  it('a failure seeds the prior on the beta side', async () => {
    const userId = uid();
    await rewardRepo.recordNoveltyOutcome({ userId, bucket: bucket(), delta: { alpha: 0, beta: 1 }, at: AT });
    const row = await RewardEvent.findOne({ userId }).lean();
    expect(row.novelty).toEqual({ alpha: NOVELTY_PRIOR.alpha, beta: NOVELTY_PRIOR.beta + 1 });
  });

  it('accumulates across plays without ever re-seeding the prior', async () => {
    const userId = uid();
    for (let i = 0; i < 5; i++) {
      await rewardRepo.recordNoveltyOutcome({ userId, bucket: bucket(), delta: { alpha: 1, beta: 0 }, at: AT });
    }
    await rewardRepo.recordNoveltyOutcome({ userId, bucket: bucket(), delta: { alpha: 0, beta: 1 }, at: AT });

    const row = await RewardEvent.findOne({ userId }).lean();
    expect(row.novelty).toEqual({ alpha: 7, beta: 3 }); // 2+5, 2+1
    expect(await RewardEvent.countDocuments({ userId })).toBe(1);
  });

  it('shares ONE row with the bucket reward — the address is the same address', async () => {
    const userId = uid();
    await rewardRepo.recordBucketReward({ userId, bucket: bucket(), reward: 0.5, at: AT });
    await rewardRepo.recordNoveltyOutcome({ userId, bucket: bucket(), delta: { alpha: 1, beta: 0 }, at: AT });

    expect(await RewardEvent.countDocuments({ userId })).toBe(1);
    const row = await RewardEvent.findOne({ userId }).lean();
    expect(row.count).toBe(1);
    expect(row.rewardSum).toBeCloseTo(0.5, 6);
    expect(row.novelty).toEqual({ alpha: 3, beta: 2 });
  });

  it('keeps separate posteriors per bucket and per user', async () => {
    const a = uid();
    const b = uid();
    await rewardRepo.recordNoveltyOutcome({ userId: a, bucket: bucket(), delta: { alpha: 1, beta: 0 }, at: AT });
    await rewardRepo.recordNoveltyOutcome({ userId: a, bucket: bucket({ hourBin: 2 }), delta: { alpha: 0, beta: 1 }, at: AT });
    await rewardRepo.recordNoveltyOutcome({ userId: b, bucket: bucket(), delta: { alpha: 0, beta: 1 }, at: AT });

    expect((await rewardRepo.readNoveltyPosterior({ userId: a, bucket: bucket() }))).toEqual({ alpha: 3, beta: 2 });
    expect((await rewardRepo.readNoveltyPosterior({ userId: a, bucket: bucket({ hourBin: 2 }) }))).toEqual({ alpha: 2, beta: 3 });
    expect((await rewardRepo.readNoveltyPosterior({ userId: b, bucket: bucket() }))).toEqual({ alpha: 2, beta: 3 });
  });

  it('refuses fail-closed on a bucket the taxonomy does not contain, a bad clock, or an empty delta', async () => {
    const userId = uid();
    const cases = [
      { userId, bucket: bucket({ stateDomain: 'not-a-domain' }), delta: { alpha: 1, beta: 0 }, at: AT },
      { userId, bucket: bucket({ targetBand: 'turbo' }), delta: { alpha: 1, beta: 0 }, at: AT },
      { userId, bucket: bucket({ hourBin: 99 }), delta: { alpha: 1, beta: 0 }, at: AT },
      // The exact boundary: HOUR_BINS is 4, so bin 4 is one past the last legal quarter-day.
      { userId, bucket: bucket({ hourBin: HOUR_BINS }), delta: { alpha: 1, beta: 0 }, at: AT },
      { userId, bucket: bucket({ hourBin: 1.5 }), delta: { alpha: 1, beta: 0 }, at: AT },
      { userId, bucket: null, delta: { alpha: 1, beta: 0 }, at: AT },
      { userId: null, bucket: bucket(), delta: { alpha: 1, beta: 0 }, at: AT },
      { userId, bucket: bucket(), delta: { alpha: 0, beta: 0 }, at: AT },
      { userId, bucket: bucket(), delta: null, at: AT },
      { userId, bucket: bucket(), delta: { alpha: 1, beta: 0 }, at: new Date('nope') },
      { userId, bucket: bucket(), delta: { alpha: 1, beta: 0 }, at: null },
      { userId, bucket: bucket(), delta: { alpha: NaN, beta: 0 }, at: AT },
    ];
    for (const args of cases) {
      expect(await rewardRepo.recordNoveltyOutcome(args)).toBe(false);
    }
    expect(await RewardEvent.countDocuments({})).toBe(0);
  });
});

describe('W4-013 · readNoveltyPosterior — what the pipeline gets', () => {
  it('returns NULL for a bucket that has never been visited (dormancy at the source)', async () => {
    expect(await rewardRepo.readNoveltyPosterior({ userId: uid(), bucket: bucket() })).toBeNull();
  });

  it('returns NULL for a bucket row that exists but carries no novelty evidence', async () => {
    const userId = uid();
    await rewardRepo.recordBucketReward({ userId, bucket: bucket(), reward: 0.5, at: AT });
    expect(await rewardRepo.readNoveltyPosterior({ userId, bucket: bucket() })).toBeNull();
  });

  it('returns NULL rather than throwing on a malformed request', async () => {
    expect(await rewardRepo.readNoveltyPosterior({ userId: null, bucket: bucket() })).toBeNull();
    expect(await rewardRepo.readNoveltyPosterior({ userId: uid(), bucket: bucket({ hourBin: -1 }) })).toBeNull();
    expect(await rewardRepo.readNoveltyPosterior({})).toBeNull();
  });
});

describe('W4-013 · the stored shape stays auditable', () => {
  it('adds exactly ONE key to the closed set W4-011 pinned, and it carries no track identity', async () => {
    const userId = uid();
    await rewardRepo.recordBucketReward({ userId, bucket: bucket(), reward: 0.5, at: AT });
    await rewardRepo.recordNoveltyOutcome({ userId, bucket: bucket(), delta: { alpha: 1, beta: 0 }, at: AT });

    const raw = await mongoose.connection.db.collection('rewardevents').findOne({ userId });
    // Deliberate extension of `rewardEvent.integration.test.js`'s closed key set. `novelty` is
    // two counters about a DECISION (serve novelty or not) in a coarse context — the same class
    // of outcome statistic as rewardSum/count, with no recording, provider or vital in it.
    expect(Object.keys(raw).sort()).toEqual(
      ['_id', 'bucket', 'count', 'novelty', 'rewardSum', 'updatedAt', 'userId', 'v'],
    );
    expect(Object.keys(raw.novelty).sort()).toEqual(['alpha', 'beta']);
    expect(JSON.stringify(raw)).not.toMatch(/spotify|youtube|mbid/i);
  });

  it('a novelty write refreshes the staleness clock, so a bucket in active use never expires', async () => {
    const userId = uid();
    const later = new Date(AT.getTime() + 86400000);
    await rewardRepo.recordBucketReward({ userId, bucket: bucket(), reward: 0.5, at: AT });
    await rewardRepo.recordNoveltyOutcome({ userId, bucket: bucket(), delta: { alpha: 1, beta: 0 }, at: later });
    const row = await RewardEvent.findOne({ userId }).lean();
    expect(row.updatedAt.getTime()).toBe(later.getTime());
  });
});
