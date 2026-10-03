'use strict';

// J2 (BE-087; Plan B T6, DT-6 M1′) — account deletion records a withdrawal of the health-data consent
// before it deletes anything (after the job purge), when the latest consent row is a grant.
//
// Why: the cascade deletes ConsentRecord in the SAME Promise.all as MedicalProfile, and the User doc last.
// A step that re-checks consent while the deletion runs (the state-recompute job's fence, the live lane's
// HX-1 and BE-016 compensations) read "granted" until the very end, so a job finishing mid-deletion kept
// what it wrote. A withdrawal row first is the same "row first" rule withdrawConsent follows: from that
// moment every check reads the consent as withdrawn.
//
// Real: MongoDB (mongodb-memory-server, test commands on so a `failCommand` fail point can fail one
// command on one collection with a real server error), the controller, the cascade, the consent service
// and the gate. The job purge runs for real too; with no REDIS_URL it has nothing to reach.

process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET = 'test-jwt-secret-for-tests-only';
delete process.env.REDIS_URL;

jest.mock('../app/sockets/index', () => ({ getIo: () => null }));
jest.mock('google-auth-library', () => ({ OAuth2Client: jest.fn() }));
jest.mock('apple-signin-auth', () => ({ verifyIdToken: jest.fn() }));
// The real purge, observed: its call order is the claim under test.
jest.mock('../app/queues/userJobPurge', () => {
  const actual = jest.requireActual('../app/queues/userJobPurge');
  return { ...actual, purgeUserJobs: jest.fn(actual.purgeUserJobs) };
});

const fs = require('fs');
const path = require('path');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const User = require('../app/models/User');
const ConsentRecord = require('../app/models/ConsentRecord');
const MedicalProfile = require('../app/models/MedicalProfile');
const { purgeUserJobs } = require('../app/queues/userJobPurge');
const {
  HEALTH_CONSENT_PURPOSE, CURRENT_CONSENT_VERSION, getConsentStatus, revokeHealthConsentForDeletion,
} = require('../app/services/privacy/consent');
const { healthWriteFence } = require('../app/services/privacy/healthConsentGate');
const { deleteAccount } = require('../app/controllers/authController');

jest.setTimeout(60000);

const DB = 'kokonada_j2_deletion_mark';
const ERASURE_SRC = path.join(__dirname, '../app/services/privacy/erasure.js');
let mem;

beforeAll(async () => {
  mem = await MongoMemoryServer.create({ instance: { args: ['--setParameter', 'enableTestCommands=1'] } });
  await mongoose.connect(mem.getUri(), { dbName: DB });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem?.stop();
});
beforeEach(async () => {
  await Promise.all([User.deleteMany({}), ConsentRecord.deleteMany({}), MedicalProfile.deleteMany({})]);
});
afterEach(() => jest.restoreAllMocks());

let seq = 0;
const account = () => {
  seq += 1;
  return User.create({ ssoProvider: 'google', ssoId: `sso-mark-${seq}`, email: `mark-${seq}@example.com` });
};
const row = (userId, status) => ConsentRecord.create({
  userId, purpose: HEALTH_CONSENT_PURPOSE, consentVersion: CURRENT_CONSENT_VERSION, status,
  ...(status === 'granted' ? { grantedAt: new Date() } : { withdrawnAt: new Date() }),
});
const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });
const failOnce = (command, collection) => mongoose.connection.db.admin().command({
  configureFailPoint: 'failCommand',
  mode: { times: 1 },
  data: { failCommands: [command], errorCode: 2, namespace: `${DB}.${collection}` },
});
const failPointOff = () => mongoose.connection.db.admin().command({ configureFailPoint: 'failCommand', mode: 'off' });

/** Every cascade model's deleteMany, observed (they still run for real). */
function observeDeletes() {
  const src = fs.readFileSync(ERASURE_SRC, 'utf8');
  const body = src.slice(src.indexOf('async function eraseUserChildData'), src.indexOf('await purgeUserKeys'));
  const names = [...body.matchAll(/(\w+)\.deleteMany\(\s*\{\s*userId\s*\}/g)].map((m) => m[1]);
  expect(names.length).toBeGreaterThanOrEqual(13);
  return names.map((name) => {
    expect(mongoose.models[name]).toBeDefined(); // each cascade variable is its model's registered name
    return jest.spyOn(mongoose.models[name], 'deleteMany');
  });
}

describe('the mark: a withdrawal row after the job purge and before any delete', () => {
  it('when the latest row is a grant: purge, then the withdrawal row, then the first delete; the cascade then erases it', async () => {
    const user = await account();
    await row(user._id, 'granted');
    const create = jest.spyOn(ConsentRecord, 'create');
    const deletes = observeDeletes();
    const reply = res();

    await deleteAccount({ user: { _id: user._id }, auth: {} }, reply, jest.fn());

    expect(reply.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/permanently deleted/i) }));
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toEqual(expect.objectContaining({
      userId: user._id, purpose: HEALTH_CONSENT_PURPOSE, status: 'withdrawn', consentVersion: CURRENT_CONSENT_VERSION,
    }));
    const firstDelete = Math.min(...deletes.map((d) => d.mock.invocationCallOrder[0]));
    expect(purgeUserJobs.mock.invocationCallOrder.at(-1)).toBeLessThan(create.mock.invocationCallOrder[0]);
    expect(create.mock.invocationCallOrder[0]).toBeLessThan(firstDelete);
    expect(await ConsentRecord.countDocuments({ userId: user._id })).toBe(0);
    expect(await User.exists({ _id: user._id })).toBeNull();
  });

  it.each([
    ['never granted', async () => {}],
    ['already withdrawn', async (id) => { await row(id, 'granted'); await row(id, 'withdrawn'); }],
  ])('%s: no row is written', async (_state, seed) => {
    const user = await account();
    await seed(user._id);
    const create = jest.spyOn(ConsentRecord, 'create');

    await expect(revokeHealthConsentForDeletion(user._id)).resolves.toBe('none');
    await deleteAccount({ user: { _id: user._id }, auth: {} }, res(), jest.fn());

    expect(create).not.toHaveBeenCalled();
  });

  it('the helper says what it did', async () => {
    const user = await account();
    await row(user._id, 'granted');

    await expect(revokeHealthConsentForDeletion(user._id)).resolves.toBe('revoked');
    await expect(revokeHealthConsentForDeletion(user._id)).resolves.toBe('none');
    expect((await getConsentStatus(user._id, HEALTH_CONSENT_PURPOSE)).granted).toBe(false);
  });
});

describe('while the cascade runs, every consent check already reads withdrawn', () => {
  // ConsentRecord.deleteMany runs in the same Promise.all; it is held too, so the consent rows are still
  // there when the gate is asked and only the mark can make it refuse (without it the gate read granted).
  it('the state-recompute gate refuses the account while MedicalProfile.deleteMany is held, and reads it missing after', async () => {
    const user = await account();
    await row(user._id, 'granted');
    await MedicalProfile.create({ userId: user._id });
    expect((await healthWriteFence(user._id)).admitted).toBe(true);
    let release;
    let reached;
    const held = new Promise((r) => { release = r; });
    const atDelete = new Promise((r) => { reached = r; });
    for (const model of [MedicalProfile, ConsentRecord]) {
      const realDelete = model.deleteMany.bind(model);
      jest.spyOn(model, 'deleteMany').mockImplementation(async (...args) => {
        if (model === MedicalProfile) reached();
        await held;
        return realDelete(...args);
      });
    }

    const deletion = deleteAccount({ user: { _id: user._id }, auth: {} }, res(), jest.fn());
    await atDelete;
    const during = await healthWriteFence(user._id);
    release();
    await deletion;

    expect(during).toEqual({ admitted: false, reason: 'consent_not_current', fence: null });
    expect(await healthWriteFence(user._id)).toEqual({ admitted: false, reason: 'user_missing', fence: null });
  });
});

describe('best-effort, reported, never blocking', () => {
  let logged;
  beforeEach(() => {
    logged = [];
    for (const level of ['log', 'info', 'warn', 'error']) {
      jest.spyOn(console, level).mockImplementation((...args) => { logged.push(args.map(String).join(' ')); });
    }
  });

  it('a withdrawal write that fails: the account is still deleted, and one fixed line with no id is logged', async () => {
    const user = await account();
    await row(user._id, 'granted');
    await failOnce('insert', 'consentrecords');
    const reply = res();
    const next = jest.fn();

    try {
      await deleteAccount({ user: { _id: user._id }, auth: {} }, reply, next);
    } finally {
      await failPointOff();
    }

    expect(next).not.toHaveBeenCalled();
    expect(await User.exists({ _id: user._id })).toBeNull();
    expect(logged.filter((l) => l.startsWith('[account-deletion]'))).toEqual(['[account-deletion] consent withdrawal failed (MongoServerError)']);
    expect(logged.join('\n')).not.toContain(String(user._id));
  });

  it('a deletion that does not finish leaves the account, and its consent no longer reads as granted', async () => {
    const user = await account();
    await row(user._id, 'granted');
    await failOnce('delete', 'musicprofiles');
    const next = jest.fn();

    try {
      await deleteAccount({ user: { _id: user._id }, auth: {} }, res(), next);
    } finally {
      await failPointOff();
    }

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(await User.exists({ _id: user._id })).not.toBeNull();
    expect((await getConsentStatus(user._id, HEALTH_CONSENT_PURPOSE)).granted).toBe(false);
    expect((await healthWriteFence(user._id)).admitted).toBe(false);
  });
});

// The two deletion doors stay in lockstep (erasure.js says so): both mark the consent after the job purge
// and before the first collection delete, and the script records what it did in its audit.
describe('both doors mark first (lockstep)', () => {
  const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const ERASURE = stripComments(fs.readFileSync(ERASURE_SRC, 'utf8'));
  const GDPR_DELETE = stripComments(fs.readFileSync(path.join(__dirname, '../scripts/gdpr-delete.js'), 'utf8'));

  it('erasure.js: purgeUserJobs(, then revokeHealthConsentForDeletion(, then the first .deleteMany(', () => {
    const body = ERASURE.slice(ERASURE.indexOf('async function eraseUserChildData'));
    const [purge, mark, firstDelete] = ['purgeUserJobs(userId)', 'revokeHealthConsentForDeletion(userId)', '.deleteMany('].map((t) => body.indexOf(t));
    expect([purge, mark, firstDelete].every((i) => i > -1)).toBe(true);
    expect(purge).toBeLessThan(mark);
    expect(mark).toBeLessThan(firstDelete);
  });

  it('gdpr-delete.js, on a real run: the same order, and the audit records consentRevoked', () => {
    const realRun = GDPR_DELETE.slice(GDPR_DELETE.indexOf('console.log(`GDPR deletion for userId'));
    const [purge, mark, firstDelete] = ['purgeUserJobs(userId)', 'revokeHealthConsentForDeletion(userId)', '.deleteMany('].map((t) => realRun.indexOf(t));
    expect([purge, mark, firstDelete].every((i) => i > -1)).toBe(true);
    expect(purge).toBeLessThan(mark);
    expect(mark).toBeLessThan(firstDelete);
    expect(realRun.slice(realRun.indexOf('appendAudit('))).toMatch(/\bconsentRevoked\b/);
  });

  it('gdpr-delete.js writes nothing on a dry run: the mark is only on the real run', () => {
    const dryRun = GDPR_DELETE.slice(GDPR_DELETE.indexOf('if (dryRun)'), GDPR_DELETE.indexOf('console.log(`GDPR deletion for userId'));
    expect(dryRun).not.toContain('revokeHealthConsentForDeletion(');
  });
});
