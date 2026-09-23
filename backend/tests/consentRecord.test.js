'use strict';

// REAL-Mongo integration test (mongodb-memory-server) for the append-only ConsentRecord model
// (audit H-9, GDPR Art.9). A withdrawal is a NEW row, never an in-place mutation — so the
// query helper must return the LATEST row for a user+purpose (not just any granted row), which
// is what a grant→withdraw→re-grant sequence proves against real sort semantics.
process.env.NODE_ENV = 'test';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const ConsentRecord = require('../app/models/ConsentRecord');

jest.setTimeout(120000);

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_consent_record_it' });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});
beforeEach(async () => {
  await ConsentRecord.deleteMany({});
});

const PURPOSE = 'health_biometric_processing';
const grant = (userId, consentVersion = 1) =>
  ConsentRecord.create({
    userId, purpose: PURPOSE, consentVersion, status: 'granted',
    dataCategories: ['heart_rate', 'hrv'], grantedAt: new Date(),
  });
const withdraw = (userId, consentVersion = 1) =>
  ConsentRecord.create({
    userId, purpose: PURPOSE, consentVersion, status: 'withdrawn', withdrawnAt: new Date(),
  });

describe('ConsentRecord schema', () => {
  it('round-trips every field it persists', async () => {
    const userId = new mongoose.Types.ObjectId();
    const created = await ConsentRecord.create({
      userId, purpose: PURPOSE, consentVersion: 1, status: 'granted',
      dataCategories: ['heart_rate', 'hrv'], grantedAt: new Date(),
      appVersion: '2.8.2', locale: 'en-US',
    });
    const found = await ConsentRecord.findById(created._id).lean();
    expect(String(found.userId)).toBe(String(userId));
    expect(found.purpose).toBe(PURPOSE);
    expect(found.consentVersion).toBe(1);
    expect(found.status).toBe('granted');
    expect(found.dataCategories).toEqual(['heart_rate', 'hrv']);
    expect(found.appVersion).toBe('2.8.2');
    expect(found.locale).toBe('en-US');
    expect(found.createdAt).toBeInstanceOf(Date); // timestamps — needed to order "latest"
  });

  it('rejects an unknown purpose (enum guard)', async () => {
    const userId = new mongoose.Types.ObjectId();
    await expect(
      ConsentRecord.create({ userId, purpose: 'marketing', consentVersion: 1, status: 'granted' }),
    ).rejects.toThrow();
  });

  it('rejects an unknown status (enum guard)', async () => {
    const userId = new mongoose.Types.ObjectId();
    await expect(
      ConsentRecord.create({ userId, purpose: PURPOSE, consentVersion: 1, status: 'revoked' }),
    ).rejects.toThrow();
  });
});

describe('ConsentRecord.latestFor', () => {
  it('returns the single most-recent row for a user+purpose', async () => {
    const userId = new mongoose.Types.ObjectId();
    await grant(userId);
    const latest = await ConsentRecord.latestFor(userId, PURPOSE);
    expect(latest.status).toBe('granted');
    expect(latest.consentVersion).toBe(1);
  });

  it('returns the WITHDRAWN row after grant→withdraw (not the stale granted one)', async () => {
    const userId = new mongoose.Types.ObjectId();
    await grant(userId);
    await withdraw(userId);
    const latest = await ConsentRecord.latestFor(userId, PURPOSE);
    expect(latest.status).toBe('withdrawn');
  });

  it('returns the LATEST granted row after grant→withdraw→re-grant', async () => {
    const userId = new mongoose.Types.ObjectId();
    await grant(userId);
    await withdraw(userId);
    await grant(userId);
    const latest = await ConsentRecord.latestFor(userId, PURPOSE);
    expect(latest.status).toBe('granted'); // the re-grant, NOT the withdrawal, NOT the original grant
  });

  it('scopes to the given user (never another user\'s row)', async () => {
    const userA = new mongoose.Types.ObjectId();
    const userB = new mongoose.Types.ObjectId();
    await grant(userA);
    expect(await ConsentRecord.latestFor(userB, PURPOSE)).toBeNull();
  });

  // ── same-millisecond ties (W4-D29) ──────────────────────────────────────────────────────────
  // `createdAt` is millisecond-resolution, so two consent writes can genuinely tie. Whether that
  // tie is RESOLVABLE depends on WHO wrote the rows, and the _id says which: an ObjectId is
  // [4-byte seconds | 5-byte per-process random | 3-byte per-process counter], so two ids sharing
  // the middle field came from ONE process and their counter really does encode insertion order,
  // while different middle fields mean two replicas whose _id order is noise. The fixtures below
  // therefore build BOTH kinds of tie explicitly — the earlier version of the cross-writer pin
  // simulated "another replica" with a LOCALLY generated ObjectId, i.e. a same-process tie wearing
  // a cross-process label, which is why it could not tell the two branches apart.

  const tiedAt = new Date('2026-07-17T12:00:00.000Z');
  const beforeTie = new Date(tiedAt.getTime() - 1000);

  // Mongoose's `timestamps:true` plugin strips `createdAt` from a `$set` on update QUERIES to
  // protect its immutability, so the tie must be forced through the raw driver collection — which
  // is also where the real race happens (below Mongoose).
  const forceCreatedAt = (id, at) =>
    ConsentRecord.collection.updateOne({ _id: id }, { $set: { createdAt: at } });

  // The 5-byte per-process field of an ObjectId, as hex: equal iff one process generated both.
  const writerOf = (id) => id.toHexString().slice(8, 18);

  // A row as ANOTHER REPLICA would have written it: same document shape, but an _id whose
  // per-process field differs from this process's, plus a caller-chosen counter so the test owns
  // the _id ordering instead of hoping for it.
  const FOREIGN_WRITER = Buffer.from([0xfe, 0xed, 0xfa, 0xce, 0x01]);
  const foreignId = (at, counter) => {
    const buf = Buffer.alloc(12);
    buf.writeUInt32BE(Math.floor(at.getTime() / 1000), 0);
    FOREIGN_WRITER.copy(buf, 4);
    buf.writeUIntBE(counter, 9, 3);
    return new mongoose.Types.ObjectId(buf);
  };
  const insertForeign = async (userId, status, at, counter) => {
    const _id = foreignId(at, counter);
    await ConsentRecord.collection.insertOne({
      _id, userId, purpose: PURPOSE, consentVersion: 1, status, dataCategories: [],
      ...(status === 'granted' ? { grantedAt: at } : { withdrawnAt: at }),
      createdAt: at, updatedAt: at, __v: 0,
    });
    return _id;
  };

  // W4-D29: the CI-only failure of the grant→withdraw→re-grant test above. All three rows come
  // from ONE process, so the re-grant's counter proves it landed last — returning the withdrawal
  // discards an ordering the row itself carries, and tells a user who re-consented that they did not.
  it('resolves a same-millisecond withdraw→re-grant from ONE process to the re-grant', async () => {
    const userId = new mongoose.Types.ObjectId();
    const first = await grant(userId);
    const withdrawnRow = await withdraw(userId);
    const reGrant = await grant(userId);
    // The fixture must really BE a same-process tie, or this proves nothing about the branch.
    expect(writerOf(reGrant._id)).toBe(writerOf(withdrawnRow._id));
    expect(String(reGrant._id) > String(withdrawnRow._id)).toBe(true); // counter encodes the order
    await forceCreatedAt(first._id, beforeTie);
    await forceCreatedAt(withdrawnRow._id, tiedAt);
    await forceCreatedAt(reGrant._id, tiedAt);

    const latest = await ConsentRecord.latestFor(userId, PURPOSE);
    expect(latest.status).toBe('granted');
    expect(String(latest._id)).toBe(String(reGrant._id));
  });

  // The mirror image: trusting the counter must not become a bias toward 'granted'. Same process,
  // same millisecond, withdrawal last → withdrawn, and here that is the ORDER's answer rather
  // than the fail-closed rule's.
  it('resolves a same-millisecond grant→withdraw from ONE process to the withdrawal', async () => {
    const userId = new mongoose.Types.ObjectId();
    const grantedRow = await grant(userId);
    const withdrawnRow = await withdraw(userId);
    expect(writerOf(withdrawnRow._id)).toBe(writerOf(grantedRow._id));
    expect(String(withdrawnRow._id) > String(grantedRow._id)).toBe(true);
    await forceCreatedAt(grantedRow._id, tiedAt);
    await forceCreatedAt(withdrawnRow._id, tiedAt);

    const latest = await ConsentRecord.latestFor(userId, PURPOSE);
    expect(latest.status).toBe('withdrawn');
  });

  // resilience-audit finding, kept: ObjectIds are monotonic only WITHIN a single process — across
  // Railway replicas, two same-millisecond writes can sort either way on _id, so a same-createdAt
  // grant/withdraw pair could resolve to the grant even though the withdrawal is what really
  // happened (or happened-adjacently). Fail CLOSED on a genuine cross-writer tie: prefer withdrawn.
  it('on a CROSS-WRITER createdAt tie, prefers withdrawn even when the granted row has the LARGER _id', async () => {
    const userId = new mongoose.Types.ObjectId();
    const withdrawnId = await insertForeign(userId, 'withdrawn', tiedAt, 0x000001);
    const grantedRow = await grant(userId);
    await forceCreatedAt(grantedRow._id, tiedAt);
    expect(writerOf(grantedRow._id)).not.toBe(writerOf(withdrawnId)); // genuinely two writers
    expect(String(grantedRow._id) > String(withdrawnId)).toBe(true);  // would win a naive {_id:-1} tie-break

    const latest = await ConsentRecord.latestFor(userId, PURPOSE);
    expect(latest.status).toBe('withdrawn');
  });

  // The fail-closed rule is only as good as the window it inspects. Ordering the tie group by _id
  // means the two newest ids can BOTH be grants while a foreign withdrawal sits behind them, so
  // the scan has to cover the whole tied millisecond, not the top 2.
  it('fails closed on a cross-writer tie even when the withdrawal is not among the newest _ids', async () => {
    const userId = new mongoose.Types.ObjectId();
    const withdrawnId = await insertForeign(userId, 'withdrawn', tiedAt, 0x000001);
    const g1 = await grant(userId);
    const g2 = await grant(userId);
    await forceCreatedAt(g1._id, tiedAt);
    await forceCreatedAt(g2._id, tiedAt);
    expect(String(g1._id) > String(withdrawnId)).toBe(true);
    expect(String(g2._id) > String(withdrawnId)).toBe(true);

    const latest = await ConsentRecord.latestFor(userId, PURPOSE);
    expect(latest.status).toBe('withdrawn');
  });

  // A window that came back FULL may be hiding tied rows, so it can prove neither "one writer"
  // nor "no withdrawal" — the read must ask the database instead of concluding from a partial view.
  it('fails closed when the tie group overflows the scan window', async () => {
    const userId = new mongoose.Types.ObjectId();
    const limit = ConsentRecord.TIE_SCAN_LIMIT;
    expect(Number.isInteger(limit) && limit >= 2).toBe(true);
    // Smallest _id of the millisecond, and from another writer — invisible to a full window.
    await insertForeign(userId, 'withdrawn', tiedAt, 0x000001);
    for (let i = 0; i < limit; i += 1) {
      const row = await grant(userId);
      await forceCreatedAt(row._id, tiedAt);
    }

    const latest = await ConsentRecord.latestFor(userId, PURPOSE);
    expect(latest.status).toBe('withdrawn');
  });

  it('no tie → still returns the genuinely later row regardless of status (normal path unaffected)', async () => {
    const userId = new mongoose.Types.ObjectId();
    await withdraw(userId);
    await new Promise((r) => setTimeout(r, 5));
    const later = await grant(userId);
    const latest = await ConsentRecord.latestFor(userId, PURPOSE);
    expect(String(latest._id)).toBe(String(later._id));
    expect(latest.status).toBe('granted');
  });
});
