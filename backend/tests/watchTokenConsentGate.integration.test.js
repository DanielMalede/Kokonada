'use strict';

process.env.NODE_ENV       = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET     = 'test-jwt-secret-for-tests-only';

// H2 (DT-H2-3 option S1) — POST /api/integrations/watch/token mints the whr_ live-HR credential
// ONLY for a CURRENT Art.9 grant, proven end-to-end: the REAL assembled app and middleware chain
// (supertest), the REAL requireConsent → consent service → ConsentRecord read, and the REAL User
// document in a REAL Mongo (mongodb-memory-server). Nothing about consent is mocked.
//
// Before this gate the mobile boot minted the credential for EVERY signed-in user, and minting
// also stamps wearableProvider='garmin' — so a mood-only user who never consented left the server
// holding a live-HR credential and a wearable attribute (compliance C5, regulatory N4). The
// assertions therefore check the stored User document, not just the status code: a refusal must
// leave NO credential and NO provider stamp behind.
//
// Only infrastructure with no bearing on the gate is replaced: the db connector (this file
// connects mongoose to the in-memory server itself), Redis (null → in-memory fallbacks), the
// background workers, Sentry, and the JWT denylist (Redis-backed).

const request = require('supertest');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

jest.mock('../app/config/db', () => jest.fn().mockResolvedValue(undefined));
jest.mock('../app/config/redis', () => ({
  connectRedis: jest.fn().mockResolvedValue(undefined),
  getRedis: jest.fn(() => null),
  createConnection: jest.fn(),
}));
jest.mock('../app/workers', () => ({ startInProcessWorkers: jest.fn(() => []) }));
jest.mock('../app/config/sentry', () => ({
  initSentry: jest.fn(),
  captureException: jest.fn(),
  sentryErrorHandler: (err, req, res, next) => next(err),
}));
jest.mock('../app/utils/tokenDenylist', () => ({
  isRevoked: jest.fn().mockResolvedValue(false),
  revoke: jest.fn().mockResolvedValue(true),
}));
// J1 (BE-074): the withdrawal below purges the job queue. Loading app/index.js applies backend/.env with
// override:true, which sets REDIS_URL whatever this file deletes, so the purge is mocked like the Redis
// client above. The purge is proven on real Redis in consentWithdrawalJobs.redis.test.js.
jest.mock('../app/queues/userJobPurge', () => ({
  purgeUserJobs: jest.fn().mockResolvedValue({ removed: 0, inFlight: 0 }),
}));

const { app } = require('../app/index');
const User = require('../app/models/User');
const ConsentRecord = require('../app/models/ConsentRecord');
const {
  recordConsent, withdrawConsent, HEALTH_CONSENT_PURPOSE, CURRENT_CONSENT_VERSION,
} = require('../app/services/privacy/consent');

jest.setTimeout(120000);

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_watch_token_gate_it' });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});
beforeEach(async () => {
  await Promise.all([User.deleteMany({}), ConsentRecord.deleteMany({})]);
});

const bearer = (userId) =>
  `Bearer ${jwt.sign({ userId: String(userId) }, process.env.JWT_SECRET, { expiresIn: '1h', jwtid: crypto.randomUUID() })}`;

const newUser = (tag) => User.create({ ssoProvider: 'google', ssoId: `sso-${tag}`, email: `${tag}@example.com` });
const mint = (user) => request(app).post('/api/integrations/watch/token').set('Authorization', bearer(user._id));
const fresh = (user) => User.findById(user._id).lean();

describe('POST /watch/token — the whr_ credential is minted only under a current Art.9 grant', () => {
  it('NO consent on file → 403 consent_required; no credential and no wearable stamp are stored', async () => {
    const user = await newUser('mood-only');
    const res = await mint(user);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'consent_required' });
    const stored = await fresh(user);
    expect(stored.watchToken?.hash ?? null).toBeNull();
    expect(stored.wearableProvider ?? null).toBeNull();
  });

  it('a WITHDRAWN grant → 403 consent_required; nothing is minted', async () => {
    const user = await newUser('withdrew');
    await recordConsent(user._id, { purpose: HEALTH_CONSENT_PURPOSE, dataCategories: ['heart_rate'] });
    await withdrawConsent(user._id, HEALTH_CONSENT_PURPOSE);
    const res = await mint(user);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'consent_required' });
    expect((await fresh(user)).watchToken?.hash ?? null).toBeNull();
  });

  it('a STALE grant (older consent version) → 403 consent_stale; nothing is minted', async () => {
    const user = await newUser('stale');
    await ConsentRecord.create({
      userId: user._id,
      purpose: HEALTH_CONSENT_PURPOSE,
      consentVersion: CURRENT_CONSENT_VERSION - 1,
      dataCategories: ['heart_rate'],
      status: 'granted',
      grantedAt: new Date(),
    });
    const res = await mint(user);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'consent_stale' });
    expect((await fresh(user)).watchToken?.hash ?? null).toBeNull();
  });

  it('control: a CURRENT grant → 201 with a whr_ token whose hash is what the server stored', async () => {
    const user = await newUser('consented');
    await recordConsent(user._id, { purpose: HEALTH_CONSENT_PURPOSE, dataCategories: ['heart_rate'] });
    const res = await mint(user);
    expect(res.status).toBe(201);
    expect(res.body.token).toMatch(/^whr_[A-Za-z0-9_-]+$/);
    const stored = await fresh(user);
    expect(stored.watchToken.hash).toBe(crypto.createHash('sha256').update(res.body.token).digest('hex'));
  });

  it('the revoke (DELETE) stays reachable WITHOUT consent — a credential must always be revocable', async () => {
    const user = await newUser('revoker');
    const res = await request(app).delete('/api/integrations/watch/token').set('Authorization', bearer(user._id));
    expect(res.status).toBe(200);
  });
});
