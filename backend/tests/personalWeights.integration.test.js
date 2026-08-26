'use strict';

// W4-013 (B7) — REAL-Mongo integration test for the PersonalWeights row.
//
// Unlike B5's novelty posterior — which rides on the W4-011 bucket row because it shares that
// row's address, lifetime and privacy story — this IS a new collection, and §0.4 S5 names it
// explicitly. Its address is the user and nothing else, it has no bucket coordinates, and it is
// read once per GENERATION rather than once per play, so folding it into `RewardEvent` would mean
// either duplicating four numbers across every bucket a listener has or reading an arbitrary one
// of them. The cost of the separate collection is five S5 registration surfaces, which is what
// `tests/shadow.qa4.crypto.test.js` and `tests/wave4.retentionDocs.test.js` mechanically enforce.
//
// What this suite really guards is that the WRITE is atomic in the presence of a decay: `δ` is
// decayed forward from `updatedAt` and then stepped, and if those were a read-modify-write two
// concurrent plays would each decay from the same stale stamp and one update would be lost.

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV = 'test';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { PersonalWeights, PERSONAL_WEIGHTS_VERSION, RETENTION_DAYS } = require('../app/models/PersonalWeights');
const repo = require('../app/repositories/personalWeightsRepo');
const P = require('../app/agents/runtime/learning/personalization');

jest.setTimeout(120000);

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_wave4_personal' });
  await PersonalWeights.syncIndexes();
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});
beforeEach(async () => {
  await PersonalWeights.deleteMany({});
});

const uid = () => new mongoose.Types.ObjectId();
const AT = new Date('2026-08-21T10:00:00Z');
const later = (ms) => new Date(AT.valueOf() + ms);
const step = (o = {}) => ({ taste: 0, feature: 0, genre: 0, rotation: 0, ...o });

describe('W4-013 · applyUpdate — one atomic write per observation', () => {
  it('creates the row on first sight with the step as delta', async () => {
    const userId = uid();
    expect(await repo.applyUpdate({ userId, step: step({ taste: 0.02, feature: -0.02 }), at: AT })).toBe(true);

    const row = await PersonalWeights.findOne({ userId }).lean();
    expect(row.deltas.taste).toBeCloseTo(0.02, 12);
    expect(row.deltas.feature).toBeCloseTo(-0.02, 12);
    expect(row.deltas.genre).toBe(0);
    expect(row.updates).toBe(1);
    expect(row.v).toBe(PERSONAL_WEIGHTS_VERSION);
    expect(row.updatedAt.valueOf()).toBe(AT.valueOf());
  });

  it('accumulates across observations', async () => {
    const userId = uid();
    await repo.applyUpdate({ userId, step: step({ taste: 0.02 }), at: AT });
    await repo.applyUpdate({ userId, step: step({ taste: 0.02 }), at: AT });

    const row = await PersonalWeights.findOne({ userId }).lean();
    expect(row.deltas.taste).toBeCloseTo(0.04, 12);
    expect(row.updates).toBe(2);
  });

  it('decays the stored delta forward BEFORE adding the step, inside the same write', async () => {
    const userId = uid();
    await repo.applyUpdate({ userId, step: step({ taste: 0.4 }), at: AT });

    // One week later, a step of exactly zero on taste: whatever the row holds now is the decay.
    await repo.applyUpdate({
      userId, step: step({ genre: 0.01 }), at: later(P.SHRINK_WEEK_MS),
    });

    const row = await PersonalWeights.findOne({ userId }).lean();
    expect(row.deltas.taste).toBeCloseTo(0.4 * P.SHRINK_PER_WEEK, 10);
    expect(row.deltas.genre).toBeCloseTo(0.01, 10);
  });

  it('never amplifies on a backwards clock', async () => {
    const userId = uid();
    await repo.applyUpdate({ userId, step: step({ taste: 0.4 }), at: AT });
    await repo.applyUpdate({ userId, step: step({ genre: 0.01 }), at: later(-P.SHRINK_WEEK_MS * 5) });

    const row = await PersonalWeights.findOne({ userId }).lean();
    expect(row.deltas.taste).toBeCloseTo(0.4, 10);
  });

  it('enforces the trust region IN THE DATABASE, not only in the engine', async () => {
    // The engine's clamp cannot help a row written by a future caller that forgot it. The
    // pipeline's own $min/$max is the containment that survives that.
    const userId = uid();
    for (let i = 0; i < 60; i++) {
      await repo.applyUpdate({ userId, step: step({ taste: 0.02, feature: -0.02 }), at: AT });
    }
    const row = await PersonalWeights.findOne({ userId }).lean();
    expect(row.deltas.taste).toBeCloseTo(P.DELTA_LIMIT, 10);
    expect(row.deltas.feature).toBeCloseTo(-P.DELTA_LIMIT, 10);
    expect(row.updates).toBe(60);
  });

  it('does not fork a user into two rows under concurrent writes', async () => {
    const userId = uid();
    await Promise.all(
      Array.from({ length: 12 }, () => repo.applyUpdate({ userId, step: step({ taste: 0.01 }), at: AT })),
    );
    expect(await PersonalWeights.countDocuments({ userId })).toBe(1);
    const row = await PersonalWeights.findOne({ userId }).lean();
    expect(row.updates).toBe(12);
    expect(row.deltas.taste).toBeCloseTo(0.12, 8);
  });

  it('refuses fail-closed, without a round trip, on every unusable argument', async () => {
    expect(await repo.applyUpdate({ userId: null, step: step({ taste: 0.02 }), at: AT })).toBe(false);
    expect(await repo.applyUpdate({ userId: uid(), step: null, at: AT })).toBe(false);
    expect(await repo.applyUpdate({ userId: uid(), step: step(), at: AT })).toBe(false);
    expect(await repo.applyUpdate({ userId: uid(), step: step({ taste: NaN }), at: AT })).toBe(false);
    expect(await repo.applyUpdate({ userId: uid(), step: step({ taste: Infinity }), at: AT })).toBe(false);
    expect(await repo.applyUpdate({ userId: uid(), step: step({ taste: 0.02 }), at: null })).toBe(false);
    expect(await repo.applyUpdate({ userId: uid(), step: step({ taste: 0.02 }), at: new Date('x') })).toBe(false);
    expect(await PersonalWeights.countDocuments({})).toBe(0);
  });

  it('bounds a single step so one caller cannot jump the whole region in one write', async () => {
    const userId = uid();
    await repo.applyUpdate({ userId, step: step({ taste: 99 }), at: AT });
    const row = await PersonalWeights.findOne({ userId }).lean();
    expect(row.deltas.taste).toBeCloseTo(P.DELTA_LIMIT, 10);
  });
});

describe('W4-013 · readWeights — the serving-path read', () => {
  it('is NULL for a cold-start user, which is what makes selection byte-identical', async () => {
    expect(await repo.readWeights({ userId: uid() })).toBeNull();
    expect(await repo.readWeights({ userId: null })).toBeNull();
  });

  it('round-trips into effectiveDeltas, decayed to the read moment', async () => {
    const userId = uid();
    await repo.applyUpdate({ userId, step: step({ taste: 0.4 }), at: AT });

    const row = await repo.readWeights({ userId });
    expect(row.updates).toBe(1);
    const eff = P.effectiveDeltas(row, { now: AT.valueOf() + P.SHRINK_WEEK_MS });
    expect(eff.taste).toBeCloseTo(0.4 * P.SHRINK_PER_WEEK, 10);
  });
});

describe('W4-013 · §0.4 S5 — registration is EXERCISED, not only grepped', () => {
  // `shadow.qa4.crypto` proves the collection is NAMED in all four code surfaces by reading
  // their source. That is the right guard for completeness (it discovers new models nobody
  // remembered), but it cannot prove the call actually deletes anything — a `deleteMany` with a
  // typo'd filter would pass it. This runs the real cascade against a real row.
  it('the account-erasure cascade actually removes the overlay', async () => {
    const { eraseUserChildData } = require('../app/services/privacy/erasure');
    const mine = uid();
    const theirs = uid();
    await repo.applyUpdate({ userId: mine, step: step({ taste: 0.02 }), at: AT });
    await repo.applyUpdate({ userId: theirs, step: step({ taste: 0.02 }), at: AT });

    await eraseUserChildData(mine);

    expect(await PersonalWeights.countDocuments({ userId: mine })).toBe(0);
    // And erasure is scoped: user A can never erase user B (the standing Q3 property).
    expect(await PersonalWeights.countDocuments({ userId: theirs })).toBe(1);
  });

  it('the GDPR export serialises the overlay (Art.15 right of access)', async () => {
    const { exportUserData } = require('../app/services/privacy/userDataExport');
    const userId = uid();
    await repo.applyUpdate({ userId, step: step({ taste: 0.02 }), at: AT });

    const dump = await exportUserData(userId);
    const rows = dump?.collections?.personalweights;
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0].deltas.taste).toBeCloseTo(0.02, 10);
  });
});

describe('W4-013 · the stored shape is CLOSED and self-expiring', () => {
  it('leaves no scratch field behind from the update pipeline', async () => {
    const userId = uid();
    await repo.applyUpdate({ userId, step: step({ taste: 0.02 }), at: AT });
    const raw = await mongoose.connection.db.collection('personalweights').findOne({ userId });
    expect(Object.keys(raw).sort()).toEqual(['_id', 'deltas', 'updatedAt', 'updates', 'userId', 'v']);
    expect(Object.keys(raw.deltas).sort()).toEqual(['feature', 'genre', 'rotation', 'taste']);
  });

  it('carries a TTL index on updatedAt (a staleness eviction, not a deletion clock)', async () => {
    const idx = await PersonalWeights.collection.indexes();
    const ttl = idx.find((i) => i.expireAfterSeconds != null);
    expect(ttl).toBeTruthy();
    expect(ttl.key).toEqual({ updatedAt: 1 });
    expect(ttl.expireAfterSeconds).toBe(RETENTION_DAYS * 24 * 3600);
    const unique = idx.find((i) => i.unique);
    expect(unique.key).toEqual({ userId: 1 });
  });
});
