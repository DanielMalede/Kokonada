'use strict';

// REAL end-to-end integration test (mongodb-memory-server) for the Garmin webhook lookup after
// garminUserId was encrypted (T3.3 blocker). Proves the full chain against real Mongo + real
// crypto: encrypt-on-connect → deterministic blind index → webhook resolves by index → ingests.
// The OLD plaintext query `{ garminUserId: gid }` can NEVER match AES-GCM ciphertext, so this
// test fails hard on the un-fixed code (users: 0) — no false-green.
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV = 'test';
// Wave 2's webhook fails closed (503) unless a secret is configured + presented.
const WEBHOOK_SECRET = 'wave3-it-secret';
process.env.GARMIN_WEBHOOK_SECRET = WEBHOOK_SECRET;

// Keep the heavy socket chain out of the controller under test.
jest.mock('../app/sockets', () => ({ getIo: () => null }));
jest.mock('../app/sockets/biometricHandler', () => ({ handleBiometricReading: jest.fn() }));
// Stub only the external ingest side-effect; everything else (User model, crypto, lookup) is real.
jest.mock('../app/services/wearable/garminIngest', () => ({ ingestSummaries: jest.fn().mockResolvedValue({}) }));

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const User = require('../app/models/User');
const garminIngest = require('../app/services/wearable/garminIngest');
const { blindIndex } = require('../app/utils/encryption');
const ConsentRecord = require('../app/models/ConsentRecord');
const { CURRENT_CONSENT_VERSION } = require('../app/services/privacy/consent');
const { garminWebhook } = require('../app/controllers/integrationsController');

jest.setTimeout(120000);

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_wave3_it' });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});
beforeEach(async () => {
  jest.clearAllMocks();
  await User.deleteMany({});
  await ConsentRecord.deleteMany({});
});

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}
const connectGarmin = (gid, over = {}) => User.create({
  ssoProvider: 'google', ssoId: `s-${gid}`, email: `${gid}@x.c`,
  wearableProvider: 'garmin', garminUserId: gid, ...over,
});
// The webhook now gates on a CURRENT Art.9 consent grant; give the connected user one so the
// resolve→ingest chain under test is exercised (the no-consent DROP is covered by its own test).
const grantConsent = (userId) => ConsentRecord.create({
  userId, purpose: 'health_biometric_processing', consentVersion: CURRENT_CONSENT_VERSION,
  status: 'granted', grantedAt: new Date(),
});

describe('garminWebhook — resolve encrypted garminUserId via blind index (real Mongo)', () => {
  it('ingests to the correct user when the inbound gid matches a stored (encrypted) garminUserId', async () => {
    const u = await connectGarmin('garmin-XYZ');
    await grantConsent(u._id);
    const res = makeRes();

    await garminWebhook({ query: { secret: WEBHOOK_SECRET }, body: { dailies: [{ userId: 'garmin-XYZ', restingHeartRateInBeatsPerMinute: 52 }] } }, res, jest.fn());

    expect(garminIngest.ingestSummaries).toHaveBeenCalledTimes(1);
    expect(String(garminIngest.ingestSummaries.mock.calls[0][0])).toBe(String(u._id));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ received: true, users: 1 }));
  });

  it('stores garminUserId as ciphertext (never plaintext) yet still resolves it', async () => {
    await connectGarmin('garmin-XYZ');
    const raw = await mongoose.connection.db.collection('users').findOne({ garminUserIdHmac: blindIndex('garmin-XYZ') });
    expect(raw).toBeTruthy();                 // found ONLY via the blind index
    expect(raw.garminUserId).not.toBe('garmin-XYZ'); // stored encrypted
  });

  it('self-heals a pre-index connection (garminUserIdHmac was null) via decrypt-scan backfill', async () => {
    const u = await connectGarmin('garmin-OLD');
    await grantConsent(u._id);
    await User.updateOne({ _id: u._id }, { $set: { garminUserIdHmac: null } }); // simulate a row connected before the index existed
    const res = makeRes();

    await garminWebhook({ query: { secret: WEBHOOK_SECRET }, body: { dailies: [{ userId: 'garmin-OLD' }] } }, res, jest.fn());

    expect(String(garminIngest.ingestSummaries.mock.calls[0][0])).toBe(String(u._id));
    const healed = await User.findById(u._id);
    expect(healed.garminUserIdHmac).toBe(blindIndex('garmin-OLD')); // backfilled for next time
  });

  it('ignores an unknown Garmin userId', async () => {
    await connectGarmin('garmin-XYZ');
    const res = makeRes();

    await garminWebhook({ query: { secret: WEBHOOK_SECRET }, body: { dailies: [{ userId: 'nobody-here' }] } }, res, jest.fn());

    expect(garminIngest.ingestSummaries).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ users: 0 }));
  });

  // Art.9 consent gate (audit H-9 follow-up): the Garmin server-to-server lane carries special-
  // category data (SpO2/respiration/body-battery beyond HR) and has no req.user, so consent is
  // enforced INLINE on the resolved user — same as the requireConsent 403 on the session-authed
  // ingest routes. A connected-but-unconsented user's summaries must be dropped, never persisted.
  it('drops a connected Garmin user with NO Art.9 consent — never persists their summaries', async () => {
    await connectGarmin('garmin-NOCONSENT'); // connected, but never granted consent
    const res = makeRes();

    await garminWebhook({ query: { secret: WEBHOOK_SECRET }, body: { pulseox: [{ userId: 'garmin-NOCONSENT', startTimeInSeconds: 1700000000, timeOffsetSpo2Values: { 0: 97 } }] } }, res, jest.fn());

    expect(garminIngest.ingestSummaries).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ users: 0 }));
  });

  it('resolves + re-stamps across an ENCRYPTION_KEY rotation (H2 — no reindex outage)', async () => {
    const OLD = 'a'.repeat(64);
    const NEW = 'b'.repeat(64);
    // Connected under the OLD key → hmac + ciphertext both under OLD.
    process.env.ENCRYPTION_KEY = OLD;
    const u = await connectGarmin('garmin-ROT');
    await grantConsent(u._id); // ConsentRecord is not an encrypted field → unaffected by rotation

    // Rotate: NEW primary, OLD demoted to previous.
    process.env.ENCRYPTION_KEY = NEW;
    process.env.ENCRYPTION_KEY_PREVIOUS = OLD;
    try {
      const res = makeRes();
      await garminWebhook({ query: { secret: WEBHOOK_SECRET }, body: { dailies: [{ userId: 'garmin-ROT' }] } }, res, jest.fn());

      expect(String(garminIngest.ingestSummaries.mock.calls[0][0])).toBe(String(u._id)); // still resolved
      const healed = await User.findById(u._id);
      expect(healed.garminUserIdHmac).toBe(blindIndex('garmin-ROT')); // re-stamped to the NEW-key index
    } finally {
      process.env.ENCRYPTION_KEY = OLD;
      delete process.env.ENCRYPTION_KEY_PREVIOUS;
    }
  });
});
