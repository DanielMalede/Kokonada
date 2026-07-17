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

  // resilience-audit finding: ObjectIds are monotonic only WITHIN a single process — across
  // Railway replicas, two same-millisecond writes can sort either way on _id, so a same-createdAt
  // grant/withdraw pair could resolve to the grant even though the withdrawal is what really
  // happened (or happened-adjacently). Fail CLOSED on a tie: prefer withdrawn.
  it('on a createdAt TIE, prefers withdrawn even when the granted row has the numerically LARGER _id', async () => {
    const userId = new mongoose.Types.ObjectId();
    const withdrawnRow = await withdraw(userId);           // generated first → smaller _id
    const grantedRow = await grant(userId);                 // generated after → larger _id (would win a naive {_id:-1} tie-break)
    expect(String(grantedRow._id) > String(withdrawnRow._id) ||
      grantedRow._id.getTimestamp() >= withdrawnRow._id.getTimestamp()).toBeTruthy(); // sanity: not accidentally the smaller one

    // Force an identical createdAt on both — the real-world race this guards against (two
    // replicas writing in the same millisecond). Mongoose's `timestamps:true` plugin silently
    // strips `createdAt` from a `$set` on update QUERIES to protect its immutability, so a
    // Mongoose-level updateOne can't construct this fixture — go around it via the raw driver
    // collection, which also more faithfully simulates the real race (it happens below Mongoose).
    const tiedAt = new Date('2026-07-17T12:00:00.000Z');
    await ConsentRecord.collection.updateOne({ _id: withdrawnRow._id }, { $set: { createdAt: tiedAt } });
    await ConsentRecord.collection.updateOne({ _id: grantedRow._id }, { $set: { createdAt: tiedAt } });

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
