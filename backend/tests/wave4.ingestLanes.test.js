'use strict';

// W4-D08, REOPENED by reflection #2 — the two ingest lanes that no test has ever executed.
//
// W4-D08 replaced three hand-copied `insertMany(docs, { ordered:false })` + `count = docs.length`
// pairs with one shared `insertManyAccounted`. It updated three call sites and imported the helper
// in two of them: `suunto.js:50` called `insertManyAccounted` with no `require`, so every Suunto
// webhook threw `ReferenceError: insertManyAccounted is not defined`. Identifier resolution is
// unconditional, so even a payload carrying ZERO heart-rate samples — which never reaches the
// database at all — threw. A cosmetic over-count became a hard outage on that lane, and it shipped
// into an open PR behind a 172-suite green run.
//
// WHY THE GREEN SUITE SAID NOTHING, which is the actual defect this file closes. The only two
// suites mentioning suunto (`integrations.test.js`, `integrationsController.test.js`) `jest.mock`
// the whole module, so they assert against a stub that cannot fail the way the real module does.
// `wave4.ingestAccounting.test.js` covers the helper and `metricStore` and mentions neither suunto
// nor appleHealth. Both lanes W4-D08 edited outside `metricStore` were executed by nothing.
//
// So this file deliberately mocks NOTHING: real module, real adapter, real Mongoose model, real
// mongodb-memory-server. `jest.mock` of the unit under test is what let the bug through, and §1
// forbids a green mock for an integration boundary. The appleHealth import happens to be correct —
// that was luck, not coverage, and it is now pinned so it stays true.

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV       = 'test';
// `persistMetrics`-adjacent code enqueues a recompute when a broker exists; nothing here should
// reach for one. Same defensive delete as the sibling accounting suite.
delete process.env.REDIS_URL;

const crypto   = require('crypto');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const BiometricLog = require('../app/models/BiometricLog');
const suunto       = require('../app/services/wearable/suunto');
const appleHealth  = require('../app/services/wearable/appleHealth');

jest.setTimeout(120000);

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_w4d08_lanes' });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});

const SECRET_KEY = 'SUUNTO_WEBHOOK_SECRET';
let savedSecret;
beforeEach(async () => {
  await BiometricLog.deleteMany({});
  savedSecret = process.env[SECRET_KEY];
  // Unsigned-but-accepted is the module's documented dev path (NODE_ENV !== 'production'); the
  // signed path gets its own pins below so neither branch rides on the other's coverage.
  delete process.env[SECRET_KEY];
});
afterEach(() => {
  if (savedSecret === undefined) delete process.env[SECRET_KEY];
  else process.env[SECRET_KEY] = savedSecret;
});

const userId = () => new mongoose.Types.ObjectId();

// A Suunto webhook sample as `fromSuunto` expects it: { hr, sport, timestamp }.
const suuntoSample = (over = {}, i = 0) => ({
  hr:        72,
  sport:     'RUNNING',
  timestamp: new Date(Date.UTC(2026, 0, 15, 9, 0, i)).toISOString(),
  ...over,
});

// An Apple HealthKit sample as `fromAppleHealth` expects it: { value, workoutType, startDate }.
const appleSample = (over = {}, i = 0) => ({
  value:       72,
  workoutType: 'HKWorkoutActivityTypeRunning',
  startDate:   new Date(Date.UTC(2026, 0, 15, 9, 0, i)).toISOString(),
  ...over,
});

const sign = (body, secret) =>
  crypto.createHmac('sha256', secret).update(body).digest('hex');

// ─────────────────────────────────────────────────────────────────────────────
describe('suunto.handleWebhook — the REAL function, no module mock', () => {
  it('THE REGRESSION: a webhook with valid samples resolves instead of throwing ReferenceError', async () => {
    const uid  = userId();
    const body = JSON.stringify([suuntoSample({}, 1), suuntoSample({}, 2), suuntoSample({}, 3)]);

    const res = await suunto.handleWebhook(uid, body, '');

    expect(res).toEqual({ ingested: 3, rejected: { count: 0, reasons: [] } });
    expect(await BiometricLog.countDocuments({ userId: uid })).toBe(3);
  });

  it('THE REGRESSION, second face: a payload with NO heart-rate samples resolves to zeroes', async () => {
    // Nothing here ever reaches the database — the `hr != null` filter empties the batch first.
    // It threw anyway, because an undefined identifier is resolved whether or not the row count
    // makes the call meaningful. This is the pin that proves the failure was unconditional.
    const uid  = userId();
    const body = JSON.stringify([{ sport: 'RUNNING', timestamp: suuntoSample().timestamp }]);

    const res = await suunto.handleWebhook(uid, body, '');

    expect(res).toEqual({ ingested: 0, rejected: { count: 0, reasons: [] } });
    expect(await BiometricLog.countDocuments({ userId: uid })).toBe(0);
  });

  it('accepts a single object payload, not only an array', async () => {
    const uid = userId();
    const res = await suunto.handleWebhook(uid, JSON.stringify(suuntoSample()), '');

    expect(res.ingested).toBe(1);
    expect(await BiometricLog.countDocuments({ userId: uid })).toBe(1);
  });

  it('stores the normalized shape: suunto source, mapped activity, parsed timestamp', async () => {
    const uid = userId();
    await suunto.handleWebhook(
      uid,
      JSON.stringify([suuntoSample({ sport: 'GYM', hr: 118 }, 4)]),
      '',
    );

    // NOT `.lean()`: the decrypting getter only runs on a hydrated document, so a lean read
    // would assert against ciphertext and prove nothing about the stored value.
    const row = await BiometricLog.findOne({ userId: uid });
    expect(row.source).toBe('suunto');
    expect(row.activity).toBe('strength');          // GYM → strength, via the real adapter map
    expect(row.heartRate).toBe(118);                // survives the encrypted round-trip
    expect(row.recordedAt.toISOString()).toBe(suuntoSample({}, 4).timestamp);
  });

  it('an unmapped sport degrades to `unknown` rather than failing the enum', async () => {
    const uid = userId();
    const res = await suunto.handleWebhook(
      uid,
      JSON.stringify([suuntoSample({ sport: 'SKI_TOURING' }, 5)]),
      '',
    );

    expect(res.ingested).toBe(1);
    expect((await BiometricLog.findOne({ userId: uid })).activity).toBe('unknown');
  });

  it('W4-D08 PROPER: reports the rows the database actually took when one sample is out of range', async () => {
    // 340 bpm is in-band for the adapter and out of range for the model (max 300) — a x2 PPG
    // artifact on a workout reading. The lane must not report it as ingested.
    const uid  = userId();
    const body = JSON.stringify([
      suuntoSample({}, 1),
      suuntoSample({ hr: 340 }, 2),
      suuntoSample({}, 3),
    ]);

    const res = await suunto.handleWebhook(uid, body, '');

    expect(res.ingested).toBe(2);                                   // NOT samples.length
    expect(res.rejected.count).toBe(1);
    expect(res.rejected.reasons).toEqual([
      { path: 'heartRate', reason: 'user-defined', count: 1 },
    ]);
    expect(await BiometricLog.countDocuments({ userId: uid })).toBe(2);
    expect(res.ingested).toBe(await BiometricLog.countDocuments({ userId: uid }));
  });

  it('ZERO-KNOWLEDGE: the webhook response carries counts and kinds, never a submitted vital', async () => {
    const uid  = userId();
    const body = JSON.stringify([suuntoSample({ hr: 347 }, 1), suuntoSample({}, 2)]);

    const serialized = JSON.stringify(await suunto.handleWebhook(uid, body, ''));

    expect(serialized).not.toMatch(/347/);
    expect(serialized).not.toMatch(/\b72\b/);
  });

  it('accepts a correctly signed payload when a webhook secret IS configured', async () => {
    process.env[SECRET_KEY] = 'w4-d08-test-secret';
    const uid  = userId();
    const body = JSON.stringify([suuntoSample({}, 6)]);

    const res = await suunto.handleWebhook(uid, body, sign(body, process.env[SECRET_KEY]));

    expect(res.ingested).toBe(1);
    expect(await BiometricLog.countDocuments({ userId: uid })).toBe(1);
  });

  it('still refuses a forged signature with 403 and writes nothing', async () => {
    process.env[SECRET_KEY] = 'w4-d08-test-secret';
    const uid  = userId();
    const body = JSON.stringify([suuntoSample({}, 7)]);

    await expect(suunto.handleWebhook(uid, body, sign(body, 'wrong-secret')))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(await BiometricLog.countDocuments({ userId: uid })).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('appleHealth.ingestBatch — the REAL function, no module mock', () => {
  it('lands every valid sample and reports what the database took', async () => {
    const uid = userId();
    const res = await appleHealth.ingestBatch(uid, [
      appleSample({}, 1), appleSample({}, 2), appleSample({}, 3),
    ]);

    expect(res).toEqual({ ingested: 3, rejected: { count: 0, reasons: [] } });
    expect(await BiometricLog.countDocuments({ userId: uid })).toBe(3);
  });

  it('stores the normalized shape: apple_health source, mapped activity, parsed startDate', async () => {
    const uid = userId();
    await appleHealth.ingestBatch(uid, [appleSample({ workoutType: 'HKWorkoutActivityTypeWalking' }, 8)]);

    const row = await BiometricLog.findOne({ userId: uid });
    expect(row.source).toBe('apple_health');
    expect(row.activity).toBe('walking');
    expect(row.heartRate).toBe(72);
    expect(row.recordedAt.toISOString()).toBe(appleSample({}, 8).startDate);
  });

  it('W4-D08 PROPER: reports the rows the database actually took when one sample is out of range', async () => {
    const uid = userId();
    const res = await appleHealth.ingestBatch(uid, [
      appleSample({}, 1), appleSample({ value: 340 }, 2), appleSample({}, 3),
    ]);

    expect(res.ingested).toBe(2);
    expect(res.rejected.count).toBe(1);
    expect(res.rejected.reasons).toEqual([
      { path: 'heartRate', reason: 'user-defined', count: 1 },
    ]);
    expect(await BiometricLog.countDocuments({ userId: uid })).toBe(2);
  });

  it('ZERO-KNOWLEDGE: the batch response carries counts and kinds, never a submitted vital', async () => {
    const uid = userId();
    const serialized = JSON.stringify(
      await appleHealth.ingestBatch(uid, [appleSample({ value: 347 }, 1), appleSample({}, 2)]),
    );

    expect(serialized).not.toMatch(/347/);
    expect(serialized).not.toMatch(/\b72\b/);
  });

  it('refuses an empty batch with 400 and writes nothing', async () => {
    const uid = userId();
    await expect(appleHealth.ingestBatch(uid, [])).rejects.toMatchObject({ statusCode: 400 });
    expect(await BiometricLog.countDocuments({ userId: uid })).toBe(0);
  });

  it('refuses an oversized batch with 400 at the documented 500-sample boundary', async () => {
    const uid   = userId();
    const batch = Array.from({ length: 501 }, (_, i) => appleSample({}, i % 60));

    await expect(appleHealth.ingestBatch(uid, batch)).rejects.toMatchObject({ statusCode: 400 });
    expect(await BiometricLog.countDocuments({ userId: uid })).toBe(0);
  });

  it('accepts the batch exactly AT the boundary — 500 is allowed, 501 is not', async () => {
    const uid   = userId();
    const batch = Array.from({ length: 500 }, (_, i) => appleSample({}, i % 60));

    const res = await appleHealth.ingestBatch(uid, batch);

    expect(res.ingested).toBe(500);
    expect(await BiometricLog.countDocuments({ userId: uid })).toBe(500);
  });
});
