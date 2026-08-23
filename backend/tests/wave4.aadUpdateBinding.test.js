'use strict';

// W4-D71 — AAD binding for encrypted values written through an UPDATE OPERATOR.
//
// `encryptedField` binds every ciphertext to its owner's userId as GCM additional authenticated
// data, so a blob lifted out of one user's row cannot be replayed into another's (T3.3). That
// binding was only ever applied on the DOCUMENT write path: in an update operator the setter's
// `this` is a Query (or, worse, a detached sub-document), neither of which exposes `userId`, so
// every `$set`-written value was encrypted UNBOUND and the collection had no row-swap protection
// at all. `MorningState` is the sharpest case — `dailyAnalysis.worker` is its only writer and it
// upserts, so there is no "next `.save()`" to migrate the row forward the way the original caveat
// assumed. This suite pins the binding at the real seam: assertions go through the DRIVER, because
// a getter-only test cannot tell "bound" from "unbound" (the read path is deliberately tolerant of
// both).
//
// Real-Mongo (mongodb-memory-server) rather than a hydrate() fake: the whole defect lives in what
// Mongoose does while CASTING an update, which a hydrated document never exercises.

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV = 'test';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

const { encrypt, decrypt } = require('../app/utils/encryption');
const MorningState = require('../app/models/MorningState');
const MedicalProfile = require('../app/models/MedicalProfile');
const { upsertStateVector } = require('../app/services/medicalProfileService');
const { toPulseStateDTO } = require('../app/controllers/pulseController');
const { byId } = require('../app/agents/runtime/knowledge/stateTaxonomy');

jest.setTimeout(120000);

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_wave4_aad_update' });
  await MorningState.syncIndexes();
  await MedicalProfile.syncIndexes();
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});
beforeEach(async () => {
  await MorningState.deleteMany({});
  await MedicalProfile.deleteMany({});
});

const uid = () => new mongoose.Types.ObjectId();
const rawMorning = () => mongoose.connection.db.collection('morningstates');
const rawProfile = () => mongoose.connection.db.collection('medicalprofiles');

/** Walk a dotted path on a plain driver document. */
const at = (doc, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), doc);

/**
 * The single assertion this whole row is about: the stored blob is readable ONLY with the owner's
 * id as AAD. `decrypt` throws on an authentication failure, so "throws without the AAD" is the
 * positive evidence that the binding is real and not merely present.
 */
function expectBoundTo(doc, path, ownerId, plaintext) {
  const blob = at(doc, path);
  expect(typeof blob).toBe('string');
  expect(decrypt(blob, false, String(ownerId))).toBe(String(plaintext));
  expect(() => decrypt(blob)).toThrow();
  expect(() => decrypt(blob, false, String(uid()))).toThrow();
}

// The exact update `dailyAnalysis.worker` issues — same keys, same nesting, same operators.
const workerUpdate = () => ({
  $set: {
    readiness: 0.72,
    readinessConfidence: 0.6,
    sleepDebt: { debt: 45, ratio: 0.2, need: 500, ceiling: 1000, nights: 12, confidence: 0.7 },
    night: { deep: 90, light: 300, rem: 90 },
    cosinor: { M: 58, A: 4.5, phi: 15.2, confidence: 0.8, source: 'fit' },
    cusum: {
      rhr: { cPlus: 1.25, cMinus: 0, flagged: false, direction: null, referenceDays: 21 },
      hrv: { cPlus: 0, cMinus: 4.5, flagged: true, direction: 'down', referenceDays: 21 },
    },
  },
});

describe('W4-D71 · MorningState $set writes bind the owner AAD', () => {
  const date = new Date('2026-08-01T00:00:00Z');

  it('binds every encrypted TOP-LEVEL and NESTED-PATH value written by the worker upsert', async () => {
    const userId = uid();
    await MorningState.findOneAndUpdate({ userId, date }, workerUpdate(), { upsert: true, new: true });

    const doc = await rawMorning().findOne({ userId });
    expectBoundTo(doc, 'readiness', userId, 0.72);
    expectBoundTo(doc, 'sleepDebt.debt', userId, 45);
    expectBoundTo(doc, 'sleepDebt.ratio', userId, 0.2);
    expectBoundTo(doc, 'sleepDebt.need', userId, 500);
    expectBoundTo(doc, 'sleepDebt.ceiling', userId, 1000);
    expectBoundTo(doc, 'cosinor.M', userId, 58);
    expectBoundTo(doc, 'cosinor.A', userId, 4.5);
    expectBoundTo(doc, 'cosinor.phi', userId, 15.2);
  });

  it('binds encrypted values inside a SINGLE-NESTED sub-document (`night`, `cusum.*`)', async () => {
    const userId = uid();
    await MorningState.findOneAndUpdate({ userId, date }, workerUpdate(), { upsert: true, new: true });

    const doc = await rawMorning().findOne({ userId });
    expectBoundTo(doc, 'night.deep', userId, 90);
    expectBoundTo(doc, 'night.light', userId, 300);
    expectBoundTo(doc, 'night.rem', userId, 90);
    expectBoundTo(doc, 'cusum.rhr.cPlus', userId, 1.25);
    expectBoundTo(doc, 'cusum.rhr.cMinus', userId, 0);
    expectBoundTo(doc, 'cusum.hrv.cPlus', userId, 0);
    expectBoundTo(doc, 'cusum.hrv.cMinus', userId, 4.5);
  });

  it('keeps the plain (non-magnitude) fields plain and the sub-document shape intact', async () => {
    const userId = uid();
    await MorningState.findOneAndUpdate({ userId, date }, workerUpdate(), { upsert: true, new: true });

    const doc = await rawMorning().findOne({ userId });
    expect(doc.readinessConfidence).toBe(0.6);
    expect(doc.sleepDebt.nights).toBe(12);
    expect(doc.sleepDebt.confidence).toBe(0.7);
    expect(doc.cosinor.confidence).toBe(0.8);
    expect(doc.cosinor.source).toBe('fit');
    expect(doc.cusum.rhr.flagged).toBe(false);
    expect(doc.cusum.rhr.referenceDays).toBe(21);
    expect(doc.cusum.hrv.flagged).toBe(true);
    expect(doc.cusum.hrv.direction).toBe('down');
  });

  it('still round-trips through the model getters after a $set write', async () => {
    const userId = uid();
    await MorningState.findOneAndUpdate({ userId, date }, workerUpdate(), { upsert: true, new: true });

    const doc = await MorningState.findOne({ userId });
    expect(doc.readiness).toBeCloseTo(0.72, 6);
    expect(doc.night.deep).toBe(90);
    expect(doc.night.rem).toBe(90);
    expect(doc.sleepDebt.need).toBe(500);
    expect(doc.cosinor.phi).toBeCloseTo(15.2, 6);
    expect(doc.cusum.hrv.cMinus).toBeCloseTo(4.5, 6);
  });

  it('a `night: null` write still stores null rather than an empty sub-document', async () => {
    const userId = uid();
    await MorningState.findOneAndUpdate(
      { userId, date },
      { $set: { readiness: 0.5, night: null } },
      { upsert: true, new: true },
    );
    const doc = await rawMorning().findOne({ userId });
    expect(doc.night).toBeNull();
  });

  // The rewrite turns a whole-object sub-document $set into dotted leaf paths, which MERGE where
  // the original REPLACED — so it pairs them with a $unset for the omitted leaves. This pins that
  // the stored document is byte-identical to what the un-rewritten update produced: the omitted
  // keys are ABSENT, not null, and not left over from the previous write.
  it('a whole-object $set on a sub-document still REPLACES, dropping the keys it omits', async () => {
    const userId = uid();
    await MorningState.findOneAndUpdate({ userId, date }, workerUpdate(), { upsert: true, new: true });
    await MorningState.findOneAndUpdate(
      { userId, date },
      { $set: { night: { deep: 120 } } },
      { new: true },
    );
    const doc = await rawMorning().findOne({ userId });
    expectBoundTo(doc, 'night.deep', userId, 120);
    expect(Object.keys(doc.night)).toEqual(['deep']);
    expect(at(doc, 'night.light')).toBeUndefined();
    expect(at(doc, 'night.rem')).toBeUndefined();
  });

  it('a ciphertext moved into ANOTHER user row reads as null, never as the other user value', async () => {
    const alice = uid();
    const bob = uid();
    await MorningState.findOneAndUpdate({ userId: alice, date }, workerUpdate(), { upsert: true, new: true });
    await MorningState.findOneAndUpdate({ userId: bob, date }, { $set: { readiness: 0.1 } }, { upsert: true, new: true });

    const aliceDoc = await rawMorning().findOne({ userId: alice });
    await rawMorning().updateOne({ userId: bob }, { $set: { readiness: aliceDoc.readiness } });

    const alarm = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const bobDoc = await MorningState.findOne({ userId: bob });
      expect(bobDoc.readiness).toBeNull();
      expect(alarm).toHaveBeenCalled();
      expect(alarm.mock.calls.flat().map(String).join(' ')).not.toContain('0.72');
    } finally { alarm.mockRestore(); }
  });

  it('LEGACY unbound rows still decrypt (migration safety — nothing in the collection breaks)', async () => {
    const userId = uid();
    await rawMorning().insertOne({
      userId,
      date,
      readiness: encrypt('0.41'),                       // written before binding — no AAD
      night: { deep: encrypt('77'), light: null, rem: null },
      v: 1,
    });
    const doc = await MorningState.findOne({ userId });
    expect(doc.readiness).toBeCloseTo(0.41, 6);
    expect(doc.night.deep).toBe(77);
  });

  it('recovers the owner from $setOnInsert when the filter does not carry it', async () => {
    const userId = uid();
    await MorningState.findOneAndUpdate(
      { date },
      { $set: { readiness: 0.33 }, $setOnInsert: { userId } },
      { upsert: true, new: true },
    );
    const doc = await rawMorning().findOne({ userId });
    expectBoundTo(doc, 'readiness', userId, 0.33);
  });

  it('a NON-SCALAR owner filter stays unbound rather than binding to "[object Object]"', async () => {
    const a = uid();
    const b = uid();
    await MorningState.create({ userId: a, date });
    await MorningState.create({ userId: b, date });
    await MorningState.updateMany({ userId: { $in: [a, b] } }, { $set: { readiness: 0.9 } });

    const doc = await rawMorning().findOne({ userId: a });
    expect(decrypt(doc.readiness)).toBe('0.9');                       // unbound, as before
    expect(() => decrypt(doc.readiness, false, '[object Object]')).toThrow();
    expect(await MorningState.findOne({ userId: a }).then(d => d.readiness)).toBeCloseTo(0.9, 6);
  });
});

describe('W4-D71 · MedicalProfile $set writes bind the owner AAD', () => {
  it('binds the top-level, nested-path and DOTTED-path values metricStore writes', async () => {
    const userId = uid();
    await MedicalProfile.findOneAndUpdate(
      { userId },
      {
        $set: {
          restingHeartRate: 58,
          hrv: 72,
          sleepStages: { rem: 95, deep: 88, light: 300 },
          'lastNightSleep.deep': 91,
          'lastNightSleep.light': 305,
          'lastNightSleep.rem': 94,
          'lastNightSleep.date': new Date('2026-08-01T00:00:00Z'),
        },
      },
      { upsert: true, new: true },
    );

    const doc = await rawProfile().findOne({ userId });
    expectBoundTo(doc, 'restingHeartRate', userId, 58);
    expectBoundTo(doc, 'hrv', userId, 72);
    expectBoundTo(doc, 'sleepStages.rem', userId, 95);
    expectBoundTo(doc, 'sleepStages.deep', userId, 88);
    expectBoundTo(doc, 'lastNightSleep.deep', userId, 91);
    expectBoundTo(doc, 'lastNightSleep.rem', userId, 94);
    expect(doc.lastNightSleep.date).toBeInstanceOf(Date);
  });

  it('still round-trips through the model getters', async () => {
    const userId = uid();
    await MedicalProfile.findOneAndUpdate(
      { userId }, { $set: { restingHeartRate: 58, hrv: 72 } }, { upsert: true, new: true },
    );
    const doc = await MedicalProfile.findOne({ userId });
    expect(doc.restingHeartRate).toBe(58);
    expect(doc.hrv).toBe(72);
  });
});

// The one place in the codebase that encrypts EXPLICITLY into a `$set` (the field is a plain
// String with no setter, so it has no other option) — §0.2.2 cites it as the precedent, which is
// exactly why it has to carry the AAD itself.
const RUNNING_TELEMETRY = {
  heartRate: 165, restingHeartRate: 60, hrv: 45, respirationRate: 18, spO2: 97,
  stepsPerMinute: 160, accelerometerVariance: 1.2, gpsVelocityKmh: 12,
  bodyBattery: 70, dailyReadiness: 80, timeOfDay: 'morning',
};

describe('W4-D71 · explicitly-encrypted stateVector binds the owner AAD', () => {
  it('binds status and stateId to the owner', async () => {
    const userId = uid();
    await upsertStateVector(userId, RUNNING_TELEMETRY, { affect: { label: 'peak-effort', confidence: 0.8 } });

    const doc = await rawProfile().findOne({ userId });
    expect(decrypt(doc.stateVector.status, false, String(userId))).toBe('Peak Athletic Performance');
    expect(() => decrypt(doc.stateVector.status)).toThrow();
    expect(decrypt(doc.stateVector.stateId, false, String(userId))).toBe('peak-effort');
    expect(() => decrypt(doc.stateVector.stateId)).toThrow();
  });

  it('a BOUND status/stateId still resolves for the Pulse DTOs', async () => {
    const userId = uid();
    await upsertStateVector(userId, RUNNING_TELEMETRY, { affect: { label: 'peak-effort', confidence: 0.8 } });

    const profile = await MedicalProfile.findOne({ userId });
    const dto = toPulseStateDTO(profile, { morning: null });
    expect(dto.stateVector.status).toBe('Peak Athletic Performance');
    expect(dto.affect.domain).toBe(byId('peak-effort').domain);
  });

  it('a LEGACY unbound status/stateId still resolves for the Pulse DTOs (migration safety)', async () => {
    const userId = uid();
    await rawProfile().insertOne({
      userId,
      stateVector: {
        status: encrypt('Deep Rest'),          // legacy: written before binding, no AAD
        confidence: 0.5,
        computedAt: new Date('2026-08-01T06:00:00Z'),
        stateId: encrypt('deep-rest'),
        stateConfidence: 0.6,
      },
    });

    const profile = await MedicalProfile.findOne({ userId });
    const dto = toPulseStateDTO(profile, { morning: null });
    expect(dto.stateVector.status).toBe('Deep Rest');
    expect(dto.affect.domain).toBe(byId('deep-rest').domain);
  });

  it('another user status blob never resolves on this row', async () => {
    const alice = uid();
    const bob = uid();
    await upsertStateVector(alice, RUNNING_TELEMETRY, { affect: { label: 'peak-effort', confidence: 0.8 } });
    await upsertStateVector(bob, RUNNING_TELEMETRY, { affect: { label: 'peak-effort', confidence: 0.8 } });

    const aliceDoc = await rawProfile().findOne({ userId: alice });
    await rawProfile().updateOne({ userId: bob }, { $set: { 'stateVector.status': aliceDoc.stateVector.status } });

    const profile = await MedicalProfile.findOne({ userId: bob });
    const dto = toPulseStateDTO(profile, { morning: null });
    expect(dto.stateVector.status).toBeNull();
  });
});

// ── The guard that keeps this fixed ─────────────────────────────────────────────────────────
//
// The binding is a property of the SCHEMA, not of the writer who happened to be audited: a model
// added later with an encrypted leaf inside a sub-document is unbound again unless it installs the
// plugin, and nothing would say so. This walks every model in `app/models` and fails the build for
// the schema that needs it and does not have it — the same posture as the erasure-completeness
// guard, which is why the collection this row was found on had five registrations and no binding.
describe('W4-D71 · every schema that needs the update binding installs it', () => {
  const fs = require('fs');
  const path = require('path');
  const { encryptedEmbeddedPaths } = require('../app/models/encryptedField');

  const modelDir = path.join(__dirname, '..', 'app', 'models');
  const modelFiles = fs.readdirSync(modelDir)
    .filter((f) => f.endsWith('.js') && f !== 'encryptedField.js');

  it.each(modelFiles)('%s', (file) => {
    const exported = require(path.join(modelDir, file));
    const schema = exported && exported.schema;
    if (!schema || !schema.paths) return; // not a model module (helpers, enums)

    const blindSpots = encryptedEmbeddedPaths(schema);
    if (!blindSpots.length) return;

    expect({ file, blindSpots, bound: schema.$encryptedAadBound === true })
      .toEqual({ file, blindSpots, bound: true });
  });

  it('finds the blind spot it was built for (the guard is not vacuous)', () => {
    expect(encryptedEmbeddedPaths(MorningState.schema).sort())
      .toEqual(['cusum.hrv', 'cusum.rhr', 'night']);
  });
});
