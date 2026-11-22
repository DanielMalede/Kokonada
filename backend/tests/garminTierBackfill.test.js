'use strict';

// BE-220 — Garmin's Starter tier includes no historical data ("Historical Data: Not included"; backfill
// "Supported with Enterprise Access only"; Agreement §5.2(f),(h)), so at Starter the OAuth callback must not
// ask Garmin for a backfill at all. The tier is a frozen code constant in services/wearable/garminTier.js,
// mirroring the music fence (garminMusicFence.js): Starter by default, a higher tier only on an exact literal,
// no env var, nothing a run can flip.
//
// Real semantics: the REAL tier module (and its REAL source evaluated with the literal swapped); the REAL
// callback controller, the REAL garmin.js client and the REAL User and ConsentRecord models on a REAL Mongo
// (mongodb-memory-server). Only the network is faked: axios answers Garmin's token, user-id and permissions
// endpoints the way Garmin does and records every backfill request it is sent.
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET = 'test-jwt-secret-for-tests-only';
process.env.NODE_ENV = 'test';
process.env.GARMIN_CONSUMER_KEY = 'garmin_key';
process.env.GARMIN_CONSUMER_SECRET = 'garmin_secret';
process.env.GARMIN_REDIRECT_URI = 'http://localhost:5000/api/integrations/garmin/callback';
delete process.env.REDIS_URL;

const fs = require('fs');
const path = require('path');
const vm = require('vm');

jest.mock('../app/sockets', () => ({ getIo: () => null }));
jest.mock('../app/sockets/biometricHandler', () => ({ handleBiometricReading: jest.fn() }));
jest.mock('axios');
// A passthrough spy: it returns exactly what the REAL predicate returns, so the callback under test runs on the
// shipped tier; one test makes it answer `true` once to prove the guard is not vacuous. The module's own pins
// below read the REAL module through jest.requireActual.
jest.mock('../app/services/wearable/garminTier', () => {
  const actual = jest.requireActual('../app/services/wearable/garminTier');
  return { ...actual, garminBackfillIncluded: jest.fn(actual.garminBackfillIncluded) };
});

const TIER_FILE = path.join(__dirname, '../app/services/wearable/garminTier.js');
const LITERAL = /^const GARMIN_TIER = 'starter';$/m;
const source = () => fs.readFileSync(TIER_FILE, 'utf8');

// The module's source, evaluated in a fresh context with the tier's literal replaced by `literal`.
function evaluateWith(literal) {
  const SOURCE = source();
  const src = SOURCE.replace(LITERAL, `const GARMIN_TIER = ${literal};`);
  if (literal !== "'starter'") expect(src).not.toEqual(SOURCE); // the swap really happened
  const module = { exports: {} };
  vm.runInNewContext(src, { module, exports: module.exports, Object });
  return module.exports;
}

describe('the tier switch (garminTier.js) is Starter and cannot be opened at run time', () => {
  afterEach(() => { delete process.env.GARMIN_TIER; delete process.env.GARMIN_BACKFILL; });

  it('ships at Starter: no backfill included', () => {
    const tier = jest.requireActual('../app/services/wearable/garminTier');
    expect(tier.GARMIN_TIER).toBe('starter');
    expect(tier.garminBackfillIncluded()).toBe(false);
  });

  it('the tripwire: the shipped source carries the literal `starter` exactly once, and nothing else assigns it', () => {
    const SOURCE = source();
    expect(SOURCE.match(new RegExp(LITERAL.source, 'gm'))).toHaveLength(1);
    expect(SOURCE.match(/GARMIN_TIER\s*=[^=]/g)).toHaveLength(1);
    expect(SOURCE).not.toMatch(/process\.env|process\[|require\(/);
  });

  it('the header says how it may be opened: Garmin\'s written tier grant, compliance-auditor, the owner at the head', () => {
    const SOURCE = source();
    const header = SOURCE.slice(0, SOURCE.indexOf('const GARMIN_TIER'));
    for (const needle of ['BE-220', 'Starter', 'compliance-auditor', '§5.2']) expect(header).toContain(needle);
  });

  it('the module is frozen: a run cannot reassign the tier or the predicate', () => {
    const tier = jest.requireActual('../app/services/wearable/garminTier');
    expect(Object.isFrozen(tier)).toBe(true);
    expect(() => { 'use strict'; tier.garminBackfillIncluded = () => true; }).toThrow(TypeError);
    expect(() => { 'use strict'; tier.GARMIN_TIER = 'enterprise'; }).toThrow(TypeError);
    expect(tier.garminBackfillIncluded()).toBe(false);
  });

  it('an env var does not open it (the module reads no environment)', () => {
    process.env.GARMIN_TIER = 'enterprise';
    process.env.GARMIN_BACKFILL = 'true';
    jest.isolateModules(() => {
      expect(jest.requireActual('../app/services/wearable/garminTier').garminBackfillIncluded()).toBe(false);
    });
  });

  it('only the exact literal `enterprise` includes the backfill', () => {
    expect(evaluateWith("'enterprise'").garminBackfillIncluded()).toBe(true);
    expect(evaluateWith("'starter'").garminBackfillIncluded()).toBe(false); // the evaluator is not vacuous
  });

  it.each([["'Enterprise'"], ["'ENTERPRISE'"], ["'enterprise '"], ['true'], ['1'], ["'evaluation'"], ['undefined'], ['null'], ['{}']])(
    'a look-alike value %s keeps it at Starter',
    (literal) => { expect(evaluateWith(literal).garminBackfillIncluded()).toBe(false); },
  );
});

// ── the OAuth callback ───────────────────────────────────────────────────────────────────────────────────────

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const axios = require('axios');

jest.setTimeout(120000);

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_garmin_tier_backfill' });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});

// Garmin, faked at the wire: the token exchange, GET /user/id, GET /user/permissions, and the backfill
// endpoints (whose calls are recorded).
let backfillUrls;
function fakeGarmin() {
  backfillUrls = [];
  axios.post.mockImplementation(async (url) => {
    if (url === 'https://diauth.garmin.com/di-oauth2-service/oauth/token') {
      return { data: { access_token: 'gat', refresh_token: 'grt', expires_in: 86400 } };
    }
    throw new Error(`unexpected POST ${url}`);
  });
  axios.get.mockImplementation(async (url) => {
    if (url === 'https://apis.garmin.com/wellness-api/rest/user/id') return { data: { userId: 'garmin-tier-1' } };
    if (url === 'https://apis.garmin.com/wellness-api/rest/user/permissions') return { data: ['HEALTH_EXPORT'] };
    if (url.startsWith('https://apis.garmin.com/wellness-api/rest/backfill/')) { backfillUrls.push(url); return { status: 202, data: '' }; }
    throw new Error(`unexpected GET ${url}`);
  });
}

// Lets the callback's fire-and-forget setImmediate (where a backfill would be kicked off) run to the end.
const drain = async () => { for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r)); };

async function connectWithCurrentConsent(controller) {
  const User = require('../app/models/User');
  const ConsentRecord = require('../app/models/ConsentRecord');
  const { CURRENT_CONSENT_VERSION, HEALTH_CONSENT_PURPOSE } = require('../app/services/privacy/consentState');
  const { signOauthState } = require('../app/utils/jwt');
  const user = await User.create({ ssoProvider: 'google', ssoId: `s-${new mongoose.Types.ObjectId()}`, email: 'tier@example.com' });
  await ConsentRecord.create({
    userId: user._id, purpose: HEALTH_CONSENT_PURPOSE, consentVersion: CURRENT_CONSENT_VERSION, status: 'granted', grantedAt: new Date(),
  });
  const res = { redirect: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis(), send: jest.fn() };
  await controller.garminCallback({ query: { code: 'auth-code', state: signOauthState(String(user._id), 'garmin', { cv: 'verifier' }) }, cookies: {} }, res);
  await drain();
  return { user, res, User };
}

describe('garminCallback at the shipped tier (BE-220)', () => {
  beforeEach(() => { jest.clearAllMocks(); fakeGarmin(); });

  it('Starter: a consented user connects and Garmin is sent no backfill request', async () => {
    const controller = require('../app/controllers/integrationsController');
    const { user, res, User } = await connectWithCurrentConsent(controller);

    expect(res.redirect).toHaveBeenCalledWith('kokonada://integrations?biometric=garmin');
    const saved = await User.findById(user._id);
    expect(saved.wearableProvider).toBe('garmin');
    expect(backfillUrls).toEqual([]);
    expect(axios.get.mock.calls.map(([u]) => u).filter((u) => u.includes('/backfill/'))).toEqual([]);
  });

  it('the guard is not vacuous: with the tier opened, the same connect requests the backfill', async () => {
    const tierSpy = jest.requireMock('../app/services/wearable/garminTier');
    tierSpy.garminBackfillIncluded.mockReturnValueOnce(true);
    await connectWithCurrentConsent(require('../app/controllers/integrationsController'));

    expect(backfillUrls.length).toBeGreaterThan(0);
    expect(backfillUrls.every((u) => /summaryStartTimeInSeconds=\d+&summaryEndTimeInSeconds=\d+/.test(u))).toBe(true);
  });
});
