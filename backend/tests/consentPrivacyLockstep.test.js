'use strict';

// ConsentRecord must ride the SAME rails as every other user-owned collection (audit H-9,
// decisions 3 & 4): fully ERASED on account deletion, and INCLUDED in the GDPR data export.
// The erasure cascade and the export registry are documented as needing to stay "in lockstep" —
// this test proves both cover ConsentRecord AND adds a drift guard so they can never silently
// diverge again. The erasure/export behaviours run against real Mongo (memory-server) for true
// delete/find semantics.
process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);

jest.mock('../app/utils/userRedisPurge', () => ({ purgeUserKeys: jest.fn().mockResolvedValue(0) }));
jest.mock('../app/utils/biometricAudit', () => ({ logBiometricAccess: jest.fn(), auditedDecrypt: jest.fn() }));

const fs = require('fs');
const path = require('path');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const ConsentRecord = require('../app/models/ConsentRecord');
const { eraseUserChildData } = require('../app/services/privacy/erasure');
const { exportUserData, COLLECTIONS } = require('../app/services/privacy/userDataExport');

// Every user-owned model (has a userId field), discovered from the filesystem — mirrors the
// completeness discovery in shadow.qa4.crypto (which guards erasure ⇄ gdpr-delete). We use it here
// to guard the OTHER lockstep the code comments flag: erasure ⇄ userDataExport can never drift.
const MODELS_DIR = path.join(__dirname, '../app/models');
function userOwnedModels() {
  return fs.readdirSync(MODELS_DIR)
    .filter((f) => f.endsWith('.js') && f !== 'User.js' && f !== 'encryptedField.js')
    .filter((f) => /userId\s*:/.test(fs.readFileSync(path.join(MODELS_DIR, f), 'utf8')))
    .map((f) => f.replace('.js', ''));
}

jest.setTimeout(120000);

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_consent_privacy_it' });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});
beforeEach(async () => {
  await ConsentRecord.deleteMany({});
});

const PURPOSE = 'health_biometric_processing';
const grant = (userId) =>
  ConsentRecord.create({ userId, purpose: PURPOSE, consentVersion: 1, status: 'granted', grantedAt: new Date() });

describe('account erasure includes ConsentRecord', () => {
  it('deletes the subject\'s consent rows and leaves another user\'s intact', async () => {
    const userA = new mongoose.Types.ObjectId();
    const userB = new mongoose.Types.ObjectId();
    await grant(userA); await grant(userA);
    await grant(userB);

    await eraseUserChildData(userA);

    expect(await ConsentRecord.countDocuments({ userId: userA })).toBe(0); // erased
    expect(await ConsentRecord.countDocuments({ userId: userB })).toBe(1); // other user untouched
  });
});

describe('data export includes ConsentRecord', () => {
  it('serializes the subject\'s consent rows under the consentrecords collection', async () => {
    const userA = new mongoose.Types.ObjectId();
    await grant(userA);

    const out = await exportUserData(userA);

    expect(out.collections.consentrecords).toHaveLength(1);
    expect(out.collections.consentrecords[0].purpose).toBe(PURPOSE);
    expect(out.collections.consentrecords[0].status).toBe('granted');
  });
});

describe('erasure / export lockstep guard', () => {
  it('the export registry includes ConsentRecord', () => {
    const exportNames = COLLECTIONS.map((c) => c.model.modelName);
    expect(exportNames).toContain('ConsentRecord');
  });

  it('the export registry covers EVERY user-owned model (lockstep with erasure — no drift)', () => {
    // erasure + gdpr-delete completeness over this same set is guarded by shadow.qa4.crypto; this
    // asserts the export registry stays lockstep with it, so a new userId model can never be erased
    // but silently dropped from the portability export (or vice-versa).
    const owned = userOwnedModels().sort();
    const exportNames = COLLECTIONS.map((c) => c.model.modelName).sort();
    expect(exportNames).toEqual(owned);
  });
});
