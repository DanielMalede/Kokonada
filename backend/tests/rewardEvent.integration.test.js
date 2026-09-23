'use strict';

// W4-011 (B6) — REAL-Mongo integration test (mongodb-memory-server) for the two learned
// artifacts ADR-0012 splits learning into.
//
// The load-bearing suite here is the Track-B one. ADR-0012's containment is "enforced at the
// SCHEMA, fail-closed", and in Mongoose that phrase has a trap in it: `validate` does NOT run on
// `findOneAndUpdate`/`updateOne` unless the caller passes `runValidators: true`. A guard that a
// caller can disarm by forgetting an option is not fail-closed — it is a convention. So every
// write path a caller could realistically reach for is exercised here WITHOUT that option, and
// each one must still refuse a non-CC0 key. (Same defect class as §0.2.2's "Mongoose setters do
// NOT run on findOneAndUpdate($set)", which this wave has already been bitten by once.)

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV = 'test';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { RewardEvent, TrackPosterior, REWARD_EVENT_VERSION, PRIOR } = require('../app/models/RewardEvent');
const rewardRepo = require('../app/repositories/rewardRepo');
const { DOMAINS, BANDS } = require('../app/agents/runtime/knowledge/stateTaxonomy');
const { HOUR_BINS } = require('../app/agents/runtime/learning/feedbackLoop');

jest.setTimeout(120000);

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_wave4_rewardevent' });
  await RewardEvent.syncIndexes();
  await TrackPosterior.syncIndexes();
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
const CC0 = 'mbid:9f8e7d6c-1234-5678-9abc-def012345678';
const bucket = (o = {}) => ({ stateDomain: 'stress', targetBand: 'resting', hourBin: 3, ...o });

describe('W4-011 · RewardEvent (ADR-0012 Track A — context buckets, all users)', () => {
  it('round-trips a bucket aggregate', async () => {
    const userId = uid();
    await RewardEvent.create({ userId, bucket: bucket(), rewardSum: 0.72, count: 1, updatedAt: AT });
    const row = await RewardEvent.findOne({ userId });
    expect(row.bucket.stateDomain).toBe('stress');
    expect(row.bucket.targetBand).toBe('resting');
    expect(row.bucket.hourBin).toBe(3);
    expect(row.rewardSum).toBeCloseTo(0.72, 6);
    expect(row.count).toBe(1);
    expect(row.v).toBe(REWARD_EVENT_VERSION);
  });

  it('aggregates idempotently: two plays in the same bucket make ONE row, not two', async () => {
    const userId = uid();
    await rewardRepo.recordBucketReward({ userId, bucket: bucket(), reward: 0.5, at: AT });
    await rewardRepo.recordBucketReward({ userId, bucket: bucket(), reward: -0.2, at: AT });

    const rows = await RewardEvent.find({ userId });
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(2);
    expect(rows[0].rewardSum).toBeCloseTo(0.3, 6);
  });

  it('creates the row on the FIRST play and never races itself into a duplicate', async () => {
    const userId = uid();
    // Ten concurrent writes to the same coordinates — the shape a burst of playback events
    // takes. The unique index is what makes this safe; the repo must survive its own E11000.
    await Promise.all(Array.from({ length: 10 }, () =>
      rewardRepo.recordBucketReward({ userId, bucket: bucket(), reward: 0.1, at: AT })));
    const rows = await RewardEvent.find({ userId });
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(10);
    expect(rows[0].rewardSum).toBeCloseTo(1, 6);
  });

  it('refuses to write a bucket the engine could not resolve (no partial coordinates)', async () => {
    const userId = uid();
    expect(await rewardRepo.recordBucketReward({ userId, bucket: null, reward: 0.5, at: AT })).toBe(false);
    expect(await rewardRepo.recordBucketReward({ userId, bucket: bucket({ stateDomain: 'anxiety' }), reward: 0.5, at: AT })).toBe(false);
    expect(await rewardRepo.recordBucketReward({ userId: null, bucket: bucket(), reward: 0.5, at: AT })).toBe(false);
    expect(await rewardRepo.recordBucketReward({ userId, bucket: bucket(), reward: NaN, at: AT })).toBe(false);
    expect(await RewardEvent.countDocuments({})).toBe(0);
  });

  it('keeps different bucket coordinates apart, and different users apart', async () => {
    const a = uid();
    const b = uid();
    await RewardEvent.create([
      { userId: a, bucket: bucket(), rewardSum: 1, count: 1, updatedAt: AT },
      { userId: a, bucket: bucket({ hourBin: 0 }), rewardSum: 1, count: 1, updatedAt: AT },
      { userId: a, bucket: bucket({ targetBand: 'peak' }), rewardSum: 1, count: 1, updatedAt: AT },
      { userId: a, bucket: bucket({ stateDomain: 'rest' }), rewardSum: 1, count: 1, updatedAt: AT },
      { userId: b, bucket: bucket(), rewardSum: 1, count: 1, updatedAt: AT },
    ]);
    expect(await RewardEvent.countDocuments({ userId: a })).toBe(4);
    expect(await RewardEvent.countDocuments({ userId: b })).toBe(1);
  });

  it('refuses a duplicate bucket row for the same user (the uniqueness the upsert relies on)', async () => {
    const userId = uid();
    await RewardEvent.create({ userId, bucket: bucket(), rewardSum: 1, count: 1, updatedAt: AT });
    await expect(
      RewardEvent.create({ userId, bucket: bucket(), rewardSum: 1, count: 1, updatedAt: AT }),
    ).rejects.toThrow(/duplicate key/i);
  });

  it('accepts only coordinates the TAXONOMY declares — a bucket cannot name a state it invented', async () => {
    const userId = uid();
    for (const bad of [{ stateDomain: 'anxiety' }, { targetBand: 'quiet' }, { hourBin: HOUR_BINS }, { hourBin: -1 }]) {
      await expect(
        RewardEvent.create({ userId, bucket: bucket(bad), rewardSum: 0, count: 1, updatedAt: AT }),
      ).rejects.toThrow(mongoose.Error.ValidationError);
    }
  });

  it('derives its coordinate vocabulary from the taxonomy, not from a copied list', () => {
    const path = RewardEvent.schema.path('bucket.stateDomain');
    expect(path.enumValues.slice().sort()).toEqual([...DOMAINS].sort());
    expect(RewardEvent.schema.path('bucket.targetBand').enumValues.slice().sort()).toEqual([...BANDS].sort());
  });

  it('stores NO vital, NO track identity and NO state label (§0.2.2, ADR-0012 §1)', async () => {
    const userId = uid();
    await RewardEvent.create({ userId, bucket: bucket(), rewardSum: 0.5, count: 1, updatedAt: AT });
    const raw = await mongoose.connection.db.collection('rewardevents').findOne({ userId });
    // A CLOSED key set: any field added later has to be argued against this line.
    expect(Object.keys(raw).sort()).toEqual(['_id', 'bucket', 'count', 'rewardSum', 'updatedAt', 'userId', 'v']);
    expect(Object.keys(raw.bucket).sort()).toEqual(['hourBin', 'stateDomain', 'targetBand']);
    // The taxonomy's 34 labels are internal vocabulary; only the six coarse domains may land.
    expect(DOMAINS).toContain(raw.bucket.stateDomain);
  });

  it('self-expires on staleness, keyed to updatedAt so an ACTIVE bucket never ages out', () => {
    const ttl = RewardEvent.schema.indexes().find(([, o]) => o && o.expireAfterSeconds != null);
    expect(ttl).toBeTruthy();
    expect(ttl[0]).toEqual({ updatedAt: 1 });
    expect(ttl[1].expireAfterSeconds).toBe(365 * 24 * 3600);
  });
});

describe('W4-011 · TrackPosterior (ADR-0012 Track B — CC0 mbid: ONLY, fail-closed)', () => {
  it('accepts a CC0 mbid: recording and starts from a uniform prior', async () => {
    await TrackPosterior.create({ recordingKey: CC0, updatedAt: AT });
    const row = await TrackPosterior.findOne({ recordingKey: CC0 });
    expect(row.alpha).toBe(1);
    expect(row.beta).toBe(1);
  });

  it('rejects every non-CC0 key on create/save', async () => {
    for (const bad of ['spotify:track:4iV5W9uYEdYUVa79Axb7Rh', 'youtube:abc123', 'mbidfoo', 'MBID:x', 'x-mbid:y', '']) {
      await expect(TrackPosterior.create({ recordingKey: bad, updatedAt: AT }))
        .rejects.toThrow(mongoose.Error.ValidationError);
    }
    expect(await TrackPosterior.countDocuments({})).toBe(0);
  });

  it('rejects an UNANCHORED key that merely contains mbid: (the tripwire\'s own counter-example)', async () => {
    await expect(TrackPosterior.create({ recordingKey: 'spotify:track:mbid:9f8e', updatedAt: AT }))
      .rejects.toThrow(mongoose.Error.ValidationError);
  });

  // THE load-bearing pin. None of these pass `runValidators`, which is exactly how a real caller
  // writes an upsert — and exactly how a validator-only guard gets silently bypassed.
  it('refuses a non-CC0 key through findOneAndUpdate WITHOUT runValidators', async () => {
    await expect(TrackPosterior.findOneAndUpdate(
      { recordingKey: 'spotify:track:4iV5W9uYEdYUVa79Axb7Rh' },
      { $inc: { alpha: 1 }, $set: { updatedAt: AT } },
      { upsert: true, new: true },
    )).rejects.toThrow(/mbid/i);
    expect(await TrackPosterior.countDocuments({})).toBe(0);
  });

  it('refuses a non-CC0 key through updateOne and updateMany WITHOUT runValidators', async () => {
    await expect(TrackPosterior.updateOne(
      { recordingKey: 'youtube:abc' }, { $inc: { beta: 1 } }, { upsert: true },
    )).rejects.toThrow(/mbid/i);
    await expect(TrackPosterior.updateMany(
      { recordingKey: 'youtube:abc' }, { $inc: { beta: 1 } }, { upsert: true },
    )).rejects.toThrow(/mbid/i);
    expect(await TrackPosterior.countDocuments({})).toBe(0);
  });

  it('refuses a non-CC0 key smuggled in the UPDATE rather than the filter', async () => {
    await expect(TrackPosterior.findOneAndUpdate(
      { recordingKey: CC0 },
      { $set: { recordingKey: 'spotify:track:4iV5W9uYEdYUVa79Axb7Rh', updatedAt: AT } },
      { upsert: true },
    )).rejects.toThrow(/mbid/i);
  });

  it('refuses a filterless upsert — an update that names no recording cannot be gated', async () => {
    await expect(TrackPosterior.findOneAndUpdate(
      { alpha: { $gt: 0 } }, { $inc: { alpha: 1 } }, { upsert: true },
    )).rejects.toThrow(/mbid/i);
  });

  it('rejects a non-CC0 key through insertMany, and lets the CC0 one through', async () => {
    await expect(TrackPosterior.insertMany([
      { recordingKey: CC0, updatedAt: AT },
      { recordingKey: 'spotify:track:x', updatedAt: AT },
    ])).rejects.toThrow();
    await TrackPosterior.insertMany([{ recordingKey: CC0, updatedAt: AT }]);
    expect(await TrackPosterior.countDocuments({})).toBe(1);
  });

  // The prior is the reason this goes through the repo rather than a bare `$inc` upsert: an
  // insert driven by `$inc` alone silently starts the posterior at Beta(1,0) — a recording that
  // succeeded once would read as CERTAIN rather than as barely-evidenced, and every Thompson
  // draw against it in W4-013 would come back ~1.0. `$setOnInsert` cannot fix it either
  // (MongoDB refuses two operators on one path), so the seeding is explicit in the repo.
  it('accumulates a CC0 posterior from the uniform prior, idempotently', async () => {
    await rewardRepo.recordTrackOutcome({ recordingKey: CC0, delta: { alpha: 1, beta: 0 }, at: AT });
    await rewardRepo.recordTrackOutcome({ recordingKey: CC0, delta: { alpha: 0, beta: 1 }, at: AT });
    const rows = await TrackPosterior.find({});
    expect(rows).toHaveLength(1);
    expect(rows[0].alpha).toBe(PRIOR.alpha + 1);
    expect(rows[0].beta).toBe(PRIOR.beta + 1);
  });

  it('seeds a FIRST-ever success from the prior, not from zero', async () => {
    await rewardRepo.recordTrackOutcome({ recordingKey: CC0, delta: { alpha: 1, beta: 0 }, at: AT });
    const row = await TrackPosterior.findOne({ recordingKey: CC0 });
    expect(row.alpha).toBe(PRIOR.alpha + 1);
    expect(row.beta).toBe(PRIOR.beta); // an unobserved failure count is the prior, never 0
  });

  it('refuses a non-CC0 recording through the repo, without reaching Mongo at all', async () => {
    expect(await rewardRepo.recordTrackOutcome({ recordingKey: 'spotify:track:x', delta: { alpha: 1, beta: 0 }, at: AT })).toBe(false);
    expect(await rewardRepo.recordTrackOutcome({ recordingKey: null, delta: { alpha: 1, beta: 0 }, at: AT })).toBe(false);
    expect(await rewardRepo.recordTrackOutcome({ recordingKey: CC0, delta: { alpha: 0, beta: 0 }, at: AT })).toBe(false);
    expect(await TrackPosterior.countDocuments({})).toBe(0);
  });

  it('is a GLOBAL CC0 artifact: it carries no userId, so it is not user-scoped data', () => {
    expect(TrackPosterior.schema.path('userId')).toBeUndefined();
    const raw = require('fs').readFileSync(
      require('path').join(__dirname, '../app/models/RewardEvent.js'), 'utf8',
    );
    // The bucket collection IS user-scoped and must stay discoverable by the S5 erasure guards,
    // which key off the literal `userId:` in this file.
    expect(raw).toMatch(/userId\s*:/);
  });
});
