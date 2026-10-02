'use strict';

// J2 (BE-087; Plan B T1, DT-4 A1, DT-5 W-c) — healthConsentGate.healthWriteFence: the gate the
// state-recompute job asks before it reads any health data, and again once it has written. Does the
// account still exist, does it hold a CURRENT health-data grant, and is that the same grant as the
// last time it asked (the fence)?
//
// Real: MongoDB (mongodb-memory-server), the User and ConsentRecord models, the consent service and
// the gate. A read error is a real server error, not a stub: the server runs with test commands on,
// and a `failCommand` fail point makes the next `find` on ONE collection fail with a code the driver
// does not retry (2, BadValue), so the rejection travels the same path it would in production.
// The primary pin is proven on a real replica set in consentPrimaryRead.integration.test.js.

process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const User = require('../app/models/User');
const ConsentRecord = require('../app/models/ConsentRecord');
const {
  getConsentState, getConsentStatus, HEALTH_CONSENT_PURPOSE, CURRENT_CONSENT_VERSION,
} = require('../app/services/privacy/consent');
const { healthWriteFence, healthProcessingVerdict } = require('../app/services/privacy/healthConsentGate');

jest.setTimeout(60000);

const DB = 'kokonada_j2_health_write_fence';
let mem;
const finds = []; // the collection of every `find` the driver sends

beforeAll(async () => {
  mem = await MongoMemoryServer.create({ instance: { args: ['--setParameter', 'enableTestCommands=1'] } });
  await mongoose.connect(mem.getUri(), { dbName: DB, monitorCommands: true });
  mongoose.connection.getClient().on('commandStarted', (e) => {
    if (e.commandName === 'find') finds.push(e.command.find);
  });
  await Promise.all([User.init(), ConsentRecord.init()]);
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem?.stop();
});
beforeEach(async () => {
  await Promise.all([User.deleteMany({}), ConsentRecord.deleteMany({})]);
  finds.length = 0;
});

let seq = 0;
const account = (over = {}) => {
  seq += 1;
  return User.create({ ssoProvider: 'google', ssoId: `sso-fence-${seq}`, email: `fence-${seq}@example.com`, ...over });
};
const row = (userId, status, version = CURRENT_CONSENT_VERSION) => ConsentRecord.create({
  userId,
  purpose: HEALTH_CONSENT_PURPOSE,
  consentVersion: version,
  status,
  ...(status === 'granted' ? { grantedAt: new Date() } : { withdrawnAt: new Date() }),
});
const grant = (userId, version) => row(userId, 'granted', version);
const withdraw = (userId) => row(userId, 'withdrawn');
const latestId = async (userId) => String((await ConsentRecord.latestFor(userId, HEALTH_CONSENT_PURPOSE))._id);

/** The next `find` on `collection` fails on the server; `times` finds in a row, or until `off()`. */
async function failFinds(collection, times) {
  await mongoose.connection.db.admin().command({
    configureFailPoint: 'failCommand',
    mode: times ? { times } : 'alwaysOn',
    data: { failCommands: ['find'], errorCode: 2, namespace: `${DB}.${collection}` },
  });
}
const off = () => mongoose.connection.db.admin().command({ configureFailPoint: 'failCommand', mode: 'off' });

const REFUSED = (reason) => ({ admitted: false, reason, fence: null });

describe('the account', () => {
  it('user_missing when no User doc carries the id, even with a current grant on file', async () => {
    const gone = new mongoose.Types.ObjectId();
    await grant(gone); // a deleted account's leftover consent row: the account is still gone

    await expect(healthWriteFence(gone)).resolves.toEqual(REFUSED('user_missing'));
    await expect(healthWriteFence(String(gone))).resolves.toEqual(REFUSED('user_missing'));
  });

  it('a User doc with deletedAt set is user_flagged, even with a current grant', async () => {
    const flagged = await account({ deletedAt: new Date() });
    await grant(flagged._id);

    await expect(healthWriteFence(flagged._id)).resolves.toEqual(REFUSED('user_flagged'));
  });

  it('an existing account is never user_missing, whatever its consent says', async () => {
    const never = await account();
    const granted = await account();
    await grant(granted._id);
    const withdrawn = await account();
    await grant(withdrawn._id);
    await withdraw(withdrawn._id);
    const stale = await account();
    await grant(stale._id, CURRENT_CONSENT_VERSION - 1);

    for (const user of [never, granted, withdrawn, stale]) {
      const out = await healthWriteFence(user._id);
      expect(out.reason).not.toBe('user_missing');
      expect(out.reason).not.toBe('user_flagged');
    }
  });

  it('a User read that fails is a read error, never user_missing (the account may well exist)', async () => {
    const user = await account();
    await grant(user._id);
    await failFinds('users', 1);

    await expect(healthWriteFence(user._id)).resolves.toEqual(REFUSED('consent_read_error'));
    await expect(healthWriteFence(user._id)).resolves.toEqual(expect.objectContaining({ admitted: true })); // the fault was one read
  });

  it('a missing id is refused without a read, as healthProcessingVerdict refuses it, and is never user_missing', async () => {
    for (const id of [undefined, null, '']) {
      await expect(healthWriteFence(id)).resolves.toEqual(REFUSED('consent_not_current'));
    }
    expect(finds).toEqual([]);
  });

  it('an id that cannot name an account is refused as a read error, never user_missing', async () => {
    for (const id of ['ghost', '   ', 'zzzzzzzzzzzzzzzzzzzzzzzz']) {
      await expect(healthWriteFence(id)).resolves.toEqual(REFUSED('consent_read_error'));
    }
  });
});

describe('the consent', () => {
  it('a current grant is admitted, and the fence is the latest consent row\'s _id', async () => {
    const user = await account();
    await grant(user._id);

    const out = await healthWriteFence(user._id);

    expect(out).toEqual({ admitted: true, reason: null, fence: await latestId(user._id) });
    expect(typeof out.fence).toBe('string');
  });

  it.each([
    ['never granted', async () => {}],
    ['withdrawn', async (id) => { await grant(id); await withdraw(id); }],
    ['granted at an older consent version (stale)', async (id) => { await grant(id, CURRENT_CONSENT_VERSION - 1); }],
  ])('%s is consent_not_current, with no fence', async (_state, seed) => {
    const user = await account();
    await seed(user._id);

    await expect(healthWriteFence(user._id)).resolves.toEqual(REFUSED('consent_not_current'));
  });

  it('a consent read that fails is consent_read_error, and carries no error text', async () => {
    const user = await account();
    await grant(user._id);
    await failFinds('consentrecords', 1);

    const out = await healthWriteFence(user._id);

    expect(out).toEqual(REFUSED('consent_read_error'));
    expect(Object.keys(out).sort()).toEqual(['admitted', 'fence', 'reason']);
  });

  it('the fence changes on a re-grant, so a withdraw-then-re-grant between two asks is seen', async () => {
    const user = await account();
    await grant(user._id);
    const first = await healthWriteFence(user._id);

    await withdraw(user._id);
    await expect(healthWriteFence(user._id)).resolves.toEqual(REFUSED('consent_not_current'));
    await grant(user._id);
    const second = await healthWriteFence(user._id);

    expect(first.admitted).toBe(true);
    expect(second.admitted).toBe(true);
    expect(second.fence).not.toBe(first.fence);
    expect(second.fence).toBe(await latestId(user._id));
  });

  it('a re-grant made while nobody asked still changes the fence (the post-write re-check sees it)', async () => {
    const user = await account();
    await grant(user._id);
    const before = await healthWriteFence(user._id);

    await withdraw(user._id);
    await grant(user._id);
    const after = await healthWriteFence(user._id);

    expect(after.admitted).toBe(true);
    expect(after.fence).not.toBe(before.fence);
  });

  it('two asks with nothing written in between return the same fence', async () => {
    const user = await account();
    await grant(user._id);

    const [a, b] = [await healthWriteFence(user._id), await healthWriteFence(user._id)];

    expect(a).toEqual(b);
  });
});

describe('getConsentState: the latest row, under the same rule as getConsentStatus', () => {
  it.each([
    ['never granted', async () => {}],
    ['granted', async (id) => { await grant(id); }],
    ['withdrawn', async (id) => { await grant(id); await withdraw(id); }],
    ['stale', async (id) => { await grant(id, CURRENT_CONSENT_VERSION - 1); }],
  ])('%s', async (_state, seed) => {
    const user = await account();
    await seed(user._id);

    const state = await getConsentState(user._id, HEALTH_CONSENT_PURPOSE);
    const latest = await ConsentRecord.latestFor(user._id, HEALTH_CONSENT_PURPOSE);

    expect(state.status).toEqual(await getConsentStatus(user._id, HEALTH_CONSENT_PURPOSE));
    expect(state.latest === null ? null : String(state.latest._id)).toBe(latest === null ? null : String(latest._id));
  });
});

// For an account that exists and is not flagged, the fence decides exactly as the socket gate does.
describe('parity with healthProcessingVerdict, for every consent state', () => {
  it.each([
    ['never granted', async () => {}, false],
    ['granted', async (id) => { await grant(id); }, false],
    ['withdrawn', async (id) => { await grant(id); await withdraw(id); }, false],
    ['re-granted', async (id) => { await grant(id); await withdraw(id); await grant(id); }, false],
    ['stale', async (id) => { await grant(id, CURRENT_CONSENT_VERSION - 1); }, false],
    ['consent store failing', async (id) => { await grant(id); }, true],
  ])('%s', async (_state, seed, storeDown) => {
    const user = await account();
    await seed(user._id);
    if (storeDown) await failFinds('consentrecords');
    let fence;
    let verdict;
    try {
      fence = await healthWriteFence(user._id);
      verdict = await healthProcessingVerdict(user._id);
    } finally {
      if (storeDown) await off();
    }

    expect({ admitted: fence.admitted, reason: fence.reason }).toEqual(verdict);
    expect(fence.fence === null).toBe(!verdict.admitted);
  });
});
