'use strict';

// HX-1 — the consent read is pinned to the PRIMARY, on a REAL two-member replica set.
//
// The live lane's compensation (sockets/biometricHandler.js) is only sound if the consent read that
// follows an insert sees the withdrawal written before it: withdrawConsent writes its withdrawal row
// FIRST and erases after. A read routed to a lagging secondary can miss that row and answer "still
// granted". The driver's default is primary, but a `readPreference` in MONGO_URI would silently
// change it for every read — so the consent read carries its own `.read('primary')`.
//
// Real: a MongoMemoryReplSet (one primary, one secondary), the real ConsentRecord model, the real
// consent service and gate. The connection's default is deliberately `secondaryPreferred`, and the
// driver's own command monitoring reports which member each `find` was sent to.

process.env.NODE_ENV = 'test';

const { MongoMemoryReplSet } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const ConsentRecord = require('../app/models/ConsentRecord');
const { getConsentStatus, HEALTH_CONSENT_PURPOSE } = require('../app/services/privacy/consent');
const { healthProcessingVerdict } = require('../app/services/privacy/healthConsentGate');

jest.setTimeout(120000);

let rs;
let primary;
const finds = []; // { collection, address } for every `find` the driver sends

beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 2, storageEngine: 'wiredTiger' } });
  await mongoose.connect(rs.getUri(), {
    dbName: 'kokonada_consent_primary_read_it',
    readPreference: 'secondaryPreferred',
    monitorCommands: true,
  });
  mongoose.connection.getClient().on('commandStarted', (e) => {
    if (e.commandName === 'find') finds.push({ collection: e.command.find, address: e.address });
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
