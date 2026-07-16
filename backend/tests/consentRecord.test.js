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
});
