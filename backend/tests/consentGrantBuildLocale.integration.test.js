'use strict';

process.env.NODE_ENV       = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET     = 'test-jwt-secret-for-tests-only';

// MB-062 (REG-034; DEC-117, the regulatory brief's O2 condition): a consent grant records the build
// and the language it was given in, so the record can show which rendered consent screen each
// grantor saw (GDPR Art. 7(1); EDPB 05/2020 para 108). Proven end to end over HTTP: the REAL
// assembled app and middleware chain (supertest), the REAL consent controller and service, and the
// stored ConsentRecord read back from a REAL Mongo (mongodb-memory-server). Nothing about consent is
// mocked. The provenance is the grantor's own build and locale, so it is kept only when it is a
// short, plain value: anything else is dropped and the grant itself still stands.
//
// Only infrastructure with no bearing on consent is replaced: the db connector (this file connects
// mongoose itself), Redis (null → in-memory fallbacks), the workers, Sentry and the JWT denylist.

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

const { app } = require('../app/index');
const User = require('../app/models/User');
const ConsentRecord = require('../app/models/ConsentRecord');
const { HEALTH_CONSENT_PURPOSE, CURRENT_CONSENT_VERSION } = require('../app/services/privacy/consent');

jest.setTimeout(120000);

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_consent_build_locale_it' });
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
const grant = (user, body) => request(app).post('/api/consent').set('Authorization', bearer(user._id)).send({
  purpose: HEALTH_CONSENT_PURPOSE,
  dataCategories: ['heart_rate', 'hrv'],
  clientVersion: CURRENT_CONSENT_VERSION,
  ...body,
});
const rowsOf = (user) => ConsentRecord.find({ userId: user._id }).lean();

describe('POST /api/consent — the grant records the build and the language it was given in', () => {
  it('stores the appVersion and locale the client sent on the granted ConsentRecord', async () => {
    const user = await newUser('build-locale');
    const res = await grant(user, { appVersion: '1.0 (1)', locale: 'he-IL' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ granted: true, currentVersion: CURRENT_CONSENT_VERSION, staleVersion: false });
    const rows = await rowsOf(user);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({
      status: 'granted',
      consentVersion: CURRENT_CONSENT_VERSION,
      appVersion: '1.0 (1)',
      locale: 'he-IL',
    }));
  });

  it('an older client that sends neither still records its grant, with no provenance (back-compat)', async () => {
    const user = await newUser('legacy-client');
    const res = await grant(user, {});
    expect(res.status).toBe(201);
    const [row] = await rowsOf(user);
    expect(row.status).toBe('granted');
    expect(row).not.toHaveProperty('appVersion');
    expect(row).not.toHaveProperty('locale');
  });

  it('a stale client is still refused (409) and nothing is stored, provenance or not', async () => {
    const user = await newUser('stale-client');
    const res = await grant(user, { clientVersion: CURRENT_CONSENT_VERSION + 1, appVersion: '1.0 (1)', locale: 'en-US' });
    expect(res.status).toBe(409);
    expect(await rowsOf(user)).toHaveLength(0);
  });

  it.each([
    ['an operator object', { appVersion: { $gt: '' }, locale: { $ne: null } }],
    ['numbers', { appVersion: 10, locale: 42 }],
    ['an array', { appVersion: ['1.0'], locale: ['en-US'] }],
    // Long, but inside the app's 10kb body limit (a larger body is refused with 413 before consent).
    ['an oversized string', { appVersion: '1'.repeat(2000), locale: 'e'.repeat(2000) }],
    ['markup and control characters', { appVersion: '1.0<script>', locale: 'en-US\n' }],
    ['empty strings', { appVersion: '', locale: '' }],
    ['a locale that is not a language tag', { appVersion: '1.0 (1)', locale: 'english please' }],
  ])('malformed provenance (%s) is dropped; the grant itself is recorded', async (_label, body) => {
    const user = await newUser(`bad-${crypto.randomUUID()}`);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await grant(user, body);
    const logged = warn.mock.calls.map((args) => args.join(' '));
    warn.mockRestore();
    expect(res.status).toBe(201);
    // Never a silent drop (a client bug would otherwise strip every grant's provenance unseen), and
    // never the dropped value itself in the log.
    expect(logged.some((line) => /\[consent\] grant provenance dropped/.test(line) && line.includes('locale'))).toBe(true);
    for (const line of logged) expect(line).not.toMatch(/script|eeee|1111|english/);
    const rows = await rowsOf(user);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('granted');
    const kept = { appVersion: rows[0].appVersion, locale: rows[0].locale };
    // Only a value that passes on its own may survive; here only the well-formed appVersion of the
    // last case does.
    expect(kept.locale).toBeUndefined();
    if (body.appVersion !== '1.0 (1)') expect(kept.appVersion).toBeUndefined();
  });
});
