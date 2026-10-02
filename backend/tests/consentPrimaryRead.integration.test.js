'use strict';

// HX-1 — the consent read, and the erasure's aggregate counts, are pinned to the PRIMARY, on a REAL
// two-member replica set.
//
// The live lane's compensation (sockets/biometricHandler.js) is only sound if the consent read that
// follows an insert sees the withdrawal written before it: withdrawConsent writes its withdrawal row
// FIRST and erases after. A read routed to a lagging secondary can miss that row and answer "still
// granted". The driver's default is primary, but a `readPreference` in MONGO_URI would silently
// change it for every read — so the consent read carries its own `.read('primary')`. The same holds
// for the aggregate rule the compensation re-applies (wearableErasure.purgeOrphanedAggregates): its
// two sample counts must see the delete just before them, or a stale secondary keeps the aggregates.
//
// Real: a MongoMemoryReplSet (one primary, one secondary), the real ConsentRecord model, the real
// consent service and gate, the real aggregate rule. The connection's default is deliberately
// `secondaryPreferred`, and the driver's own command monitoring reports which member each `find`
// and each `aggregate` (what countDocuments sends) went to.

process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);

const { MongoMemoryReplSet } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const ConsentRecord = require('../app/models/ConsentRecord');
const { getConsentStatus, HEALTH_CONSENT_PURPOSE } = require('../app/services/privacy/consent');
const { healthProcessingVerdict, healthWriteFence } = require('../app/services/privacy/healthConsentGate');
const User = require('../app/models/User');
const BiometricLog = require('../app/models/BiometricLog');
const VitalSample = require('../app/models/VitalSample');
const { purgeOrphanedAggregates } = require('../app/services/privacy/wearableErasure');

jest.setTimeout(120000);

let rs;
let primary;
const finds = []; // { collection, address } for every `find` the driver sends
const aggregates = []; // { collection, address } for every `aggregate` (countDocuments) it sends

beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 2, storageEngine: 'wiredTiger' } });
  await mongoose.connect(rs.getUri(), {
    dbName: 'kokonada_consent_primary_read_it',
    readPreference: 'secondaryPreferred',
    monitorCommands: true,
  });
  mongoose.connection.getClient().on('commandStarted', (e) => {
    if (e.commandName === 'find') finds.push({ collection: e.command.find, address: e.address });
    if (e.commandName === 'aggregate') aggregates.push({ collection: e.command.aggregate, address: e.address });
  });
  primary = (await mongoose.connection.db.admin().command({ hello: 1 })).primary;
  await ConsentRecord.init();
  // Until the driver has discovered the secondary, `secondaryPreferred` falls back to the primary —
  // and every assertion below would pass vacuously. Wait until an unpinned read really goes elsewhere.
  const deadline = Date.now() + 30000;
  for (;;) {
    finds.length = 0;
    await ConsentRecord.find({}).exec();
    if (finds.length && finds[finds.length - 1].address !== primary) break;
    if (Date.now() > deadline) throw new Error('the secondary never became selectable');
    await new Promise((r) => setTimeout(r, 100));
  }
});
afterAll(async () => {
  await mongoose.disconnect();
  await rs.stop();
});
beforeEach(async () => {
  await ConsentRecord.deleteMany({});
  finds.length = 0;
});

const consentFinds = () => finds.filter((f) => f.collection === ConsentRecord.collection.collectionName);

describe('the consent read goes to the primary even when the connection prefers a secondary', () => {
  it('the setup is not vacuous: an unpinned read on this connection goes to the secondary', async () => {
    await ConsentRecord.find({}).exec();
    expect(consentFinds()).toHaveLength(1);
    expect(consentFinds()[0].address).not.toBe(primary);
  });

  it('getConsentStatus and the gate read the primary', async () => {
    const userId = new mongoose.Types.ObjectId();
    await ConsentRecord.create({ userId, purpose: HEALTH_CONSENT_PURPOSE, consentVersion: 1, status: 'granted', grantedAt: new Date() });
    finds.length = 0;

    await getConsentStatus(userId, HEALTH_CONSENT_PURPOSE);
    await healthProcessingVerdict(userId);

    expect(consentFinds().length).toBeGreaterThanOrEqual(2);
    expect(consentFinds().map((f) => f.address)).toEqual(consentFinds().map(() => primary));
  });

  // BE-016 N3 (round 1): the session-health erasure reads the whole history to decide whom it erases.
  // A lagging secondary could miss the withdrawal row just written, return no windows, and report
  // `sessionHealth=skipped` with no owed record for the sweep to finish.
  it('the session-health erasure reads the consent history from the primary', async () => {
    const { readHistory } = require('../app/services/privacy/sessionHealthErasure');
    const userId = new mongoose.Types.ObjectId();
    await ConsentRecord.create({ userId, purpose: HEALTH_CONSENT_PURPOSE, consentVersion: 1, status: 'granted', grantedAt: new Date() });
    finds.length = 0;

    const history = await readHistory(userId);

    expect(history).toHaveLength(1);
    expect(consentFinds()).toHaveLength(1);
    expect(consentFinds()[0].address).toBe(primary);
  });

  // J2 (BE-087, Plan B T1): the state-recompute job asks this gate again right after it has written.
  // A secondary that has not seen the account's deletion (the User doc goes last) or the withdrawal row
  // would answer "still there, still granted", and the job would keep what it wrote.
  it('healthWriteFence reads the account and the consent from the primary', async () => {
    const user = await User.create({ ssoProvider: 'google', ssoId: 'sso-fence-primary', email: 'fence-primary@example.com' });
    await ConsentRecord.create({ userId: user._id, purpose: HEALTH_CONSENT_PURPOSE, consentVersion: 1, status: 'granted', grantedAt: new Date() });
    finds.length = 0;
    await User.find({}).exec();
    expect(finds.filter((f) => f.collection === User.collection.collectionName)[0].address).not.toBe(primary); // not vacuous
    finds.length = 0;

    const out = await healthWriteFence(user._id);

    expect(out.admitted).toBe(true);
    const userFinds = finds.filter((f) => f.collection === User.collection.collectionName);
    expect(userFinds).toHaveLength(1);
    expect(consentFinds().length).toBeGreaterThanOrEqual(1);
    expect([...userFinds, ...consentFinds()].map((f) => f.address)).toEqual([...userFinds, ...consentFinds()].map(() => primary));
  });

  // J2 (BE-094, S1): the nightly analysis skips a profile whose account is gone. A secondary that has not
  // yet seen a new account would report it gone, and that user would be skipped as a deleted account.
  it('existingAccountIds reads the accounts from the primary', async () => {
    const { existingAccountIds } = require('../app/services/privacy/accountExistence');
    const user = await User.create({ ssoProvider: 'google', ssoId: 'sso-existence-primary', email: 'existence-primary@example.com' });
    const gone = new mongoose.Types.ObjectId();
    finds.length = 0;

    const existing = await existingAccountIds([user._id, gone]);

    expect([...existing]).toEqual([String(user._id)]);
    const userFinds = finds.filter((f) => f.collection === User.collection.collectionName);
    expect(userFinds).toHaveLength(1);
    expect(userFinds[0].address).toBe(primary);
  });

  it('the tie read (a full window of rows in one millisecond) reads the primary too', async () => {
    const userId = new mongoose.Types.ObjectId();
    const at = new Date();
    const rows = Array.from({ length: ConsentRecord.TIE_SCAN_LIMIT }, (_, i) => ({
      userId, purpose: HEALTH_CONSENT_PURPOSE, consentVersion: 1,
      status: i === 3 ? 'withdrawn' : 'granted', createdAt: at, updatedAt: at,
    }));
    await ConsentRecord.collection.insertMany(rows, { writeConcern: { w: 'majority' } });
    finds.length = 0;

    const latest = await ConsentRecord.latestFor(userId, HEALTH_CONSENT_PURPOSE);

    expect(latest.status).toBe('withdrawn'); // the second (tie) query ran and found the withdrawal
    expect(consentFinds()).toHaveLength(2);
    expect(consentFinds().map((f) => f.address)).toEqual([primary, primary]);
  });
});

describe('the aggregate rule counts on the primary too', () => {
  const sampleCounts = () => aggregates.filter((a) => [BiometricLog.collection.collectionName, VitalSample.collection.collectionName].includes(a.collection));

  it('the setup is not vacuous: an unpinned count on this connection goes to the secondary', async () => {
    aggregates.length = 0;
    await BiometricLog.countDocuments({}).exec();
    expect(sampleCounts()).toHaveLength(1);
    expect(sampleCounts()[0].address).not.toBe(primary);
  });

  it('purgeOrphanedAggregates reads both sample counts from the primary', async () => {
    aggregates.length = 0;
    await purgeOrphanedAggregates(new mongoose.Types.ObjectId());
    expect(sampleCounts().map((a) => a.collection).sort()).toEqual(
      [BiometricLog.collection.collectionName, VitalSample.collection.collectionName].sort(),
    );
    expect(sampleCounts().map((a) => a.address)).toEqual([primary, primary]);
  });
});
