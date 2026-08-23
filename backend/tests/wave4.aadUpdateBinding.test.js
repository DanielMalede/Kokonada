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
const User = require('../app/models/User');
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
  await User.syncIndexes();
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});
beforeEach(async () => {
  await MorningState.deleteMany({});
  await MedicalProfile.deleteMany({});
  await User.deleteMany({});
});

const uid = () => new mongoose.Types.ObjectId();
const rawMorning = () => mongoose.connection.db.collection('morningstates');
const rawProfile = () => mongoose.connection.db.collection('medicalprofiles');
const rawUsers = () => mongoose.connection.db.collection('users');

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

  // The operator-less shorthand `{field: value}` reaches the hook before Mongoose expands it into
  // `$set`, so the rewrite has to expand it itself — otherwise a sub-document written that way is
  // unbound again through a door nobody looked at.
  it('binds a sub-document written through the operator-less shorthand update', async () => {
    const userId = uid();
    await MorningState.findOneAndUpdate(
      { userId, date },
      { readiness: 0.44, night: { deep: 70, light: 200, rem: 80 } },
      { upsert: true, new: true },
    );
    const doc = await rawMorning().findOne({ userId });
    expectBoundTo(doc, 'readiness', userId, 0.44);
    expectBoundTo(doc, 'night.deep', userId, 70);
    expectBoundTo(doc, 'night.rem', userId, 80);
  });

  it('an EMPTY update is left alone rather than rewritten into an empty $set', async () => {
    const userId = uid();
    await MorningState.create({ userId, date, readiness: 0.31 });
    await expect(MorningState.updateOne({ userId, date }, {})).resolves.toBeDefined();

    const doc = await MorningState.findOne({ userId });
    expect(doc.readiness).toBeCloseTo(0.31, 6);
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
  const { encryptedEmbeddedPaths, encryptedDocumentArrayPaths } = require('../app/models/encryptedField');

  const modelDir = path.join(__dirname, '..', 'app', 'models');
  const modelFiles = fs.readdirSync(modelDir)
    .filter((f) => f.endsWith('.js') && f !== 'encryptedField.js');

  it.each(modelFiles)('%s', (file) => {
    const exported = require(path.join(modelDir, file));
    const schema = exported && exported.schema;
    if (!schema || !schema.paths) return; // not a model module (helpers, enums)

    const blindSpots = [...encryptedEmbeddedPaths(schema), ...encryptedDocumentArrayPaths(schema)];
    if (!blindSpots.length) return;

    expect({ file, blindSpots, bound: schema.$encryptedAadBound === true })
      .toEqual({ file, blindSpots, bound: true });
  });

  it('finds the blind spot it was built for (the guard is not vacuous)', () => {
    expect(encryptedEmbeddedPaths(MorningState.schema).sort())
      .toEqual(['cusum.hrv', 'cusum.rhr', 'night']);
  });
});

// ── W4-D75 · encrypted leaves inside a document ARRAY ───────────────────────────────────────
//
// W4-D71 solved the SINGLE-NESTED blind spot by rewriting a whole-object `$set` into dotted leaf
// paths, which are cast in the Query context where the owner is. A document ARRAY has the same
// detached cast and no such rewrite: measured against real Mongo (Mongoose 9), the element handed
// to the leaf setter is an `EmbeddedDocument` whose `parentArray().$parent()` is `undefined`, so
// the setter cannot reach the owner no matter how hard it looks — and unlike `$set: {night: {…}}`
// there is no dotted form of "replace this array" or "append this element" to rewrite it into.
//
// So the answer here is not a rewrite but a REFUSAL: the shapes that cannot bind are rejected at
// the seam instead of silently writing a device secret unbound. The enumeration below is measured,
// not assumed — these shapes bind nothing, and these four bind correctly:
//
//   REJECTED  $set / $setOnInsert on the whole array · $push · $push+$each · $addToSet
//   ALLOWED   `pushTokens.0.token` · `pushTokens.$.token` · `pushTokens.$[].token` · push()+save()
//
// The one real writer (`authController` enrolling a device) is on the allowed side already.
describe('W4-D75 · encrypted leaves inside a document ARRAY', () => {
  const baseUser = (over = {}) => ({
    ssoProvider: 'google',
    ssoId: `sso-${new mongoose.Types.ObjectId()}`,
    email: `u${Date.now()}${Math.round(Math.random() * 1e6)}@example.com`,
    ...over,
  });
  const mkUser = (over) => User.create(baseUser(over));
  /** A user already holding one enrolled device, written the bound way. */
  async function userWithToken(plaintext = 'seed-secret') {
    const user = await mkUser();
    user.pushTokens.push({ token: plaintext, platform: 'ios' });
    await user.save();
    return user;
  }

  describe('shapes that cannot bind are REJECTED, not written unbound', () => {
    const cases = [
      ['whole-array $set', (id) => User.updateOne({ _id: id }, { $set: { pushTokens: [{ token: 'x', platform: 'ios' }] } })],
      ['whole-array shorthand $set', (id) => User.updateOne({ _id: id }, { pushTokens: [{ token: 'x', platform: 'ios' }] })],
      ['findOneAndUpdate whole-array $set', (id) => User.findOneAndUpdate({ _id: id }, { $set: { pushTokens: [{ token: 'x', platform: 'ios' }] } })],
      ['updateMany whole-array $set', (id) => User.updateMany({ _id: id }, { $set: { pushTokens: [{ token: 'x', platform: 'ios' }] } })],
      ['$push of one element', (id) => User.updateOne({ _id: id }, { $push: { pushTokens: { token: 'x', platform: 'ios' } } })],
      ['$push with $each', (id) => User.updateOne({ _id: id }, { $push: { pushTokens: { $each: [{ token: 'x', platform: 'ios' }] } } })],
      ['$addToSet', (id) => User.updateOne({ _id: id }, { $addToSet: { pushTokens: { token: 'x', platform: 'ios' } } })],
    ];

    it.each(cases)('%s', async (_label, run) => {
      const user = await mkUser();
      await expect(run(user._id)).rejects.toThrow(/pushTokens/);

      // The refusal is the point: nothing reached the collection.
      const raw = await rawUsers().findOne({ _id: user._id });
      expect(raw.pushTokens || []).toHaveLength(0);
    });

    it('names the path and the shapes that DO bind, so the message is actionable', async () => {
      const user = await mkUser();
      await expect(User.updateOne({ _id: user._id }, { $push: { pushTokens: { token: 'x', platform: 'ios' } } }))
        .rejects.toThrow(/pushTokens[\s\S]*save\(\)/);
    });

    it('rejects an UPSERT that would insert the array through $setOnInsert', async () => {
      const id = new mongoose.Types.ObjectId();
      await expect(User.updateOne(
        { _id: id },
        { $setOnInsert: { ...baseUser(), pushTokens: [{ token: 'x', platform: 'ios' }] } },
        { upsert: true },
      )).rejects.toThrow(/pushTokens/);
      expect(await rawUsers().findOne({ _id: id })).toBeNull();
    });
  });

  describe('writes that carry no encrypted value are left alone', () => {
    it('clears the array with an empty $set', async () => {
      const user = await userWithToken();
      await User.updateOne({ _id: user._id }, { $set: { pushTokens: [] } });
      const raw = await rawUsers().findOne({ _id: user._id });
      expect(raw.pushTokens).toEqual([]);
    });

    it('accepts an element with the encrypted leaf absent', async () => {
      const user = await mkUser();
      await User.updateOne({ _id: user._id }, { $push: { pushTokens: { platform: 'ios' } } });
      const raw = await rawUsers().findOne({ _id: user._id });
      expect(raw.pushTokens).toHaveLength(1);
      expect(raw.pushTokens[0].token).toBeUndefined();
    });

    it('accepts $pull and $unset, which write no ciphertext at all', async () => {
      const user = await userWithToken();
      await User.updateOne({ _id: user._id }, { $pull: { pushTokens: { platform: 'ios' } } });
      expect((await rawUsers().findOne({ _id: user._id })).pushTokens).toEqual([]);
      await User.updateOne({ _id: user._id }, { $unset: { pushTokens: '' } });
      expect((await rawUsers().findOne({ _id: user._id })).pushTokens).toBeUndefined();
    });

    it('leaves a NON-array encrypted field on the same model writable by $set', async () => {
      // The refusal must be scoped to the array; W4-D74 made `garminUserId` bind through $set and
      // that has to keep working.
      const user = await mkUser();
      await User.updateOne({ _id: user._id }, { $set: { garminUserId: 'garmin-abc' } });
      expectBoundTo(await rawUsers().findOne({ _id: user._id }), 'garminUserId', user._id, 'garmin-abc');
    });
  });

  describe('the shapes that DO bind still bind', () => {
    it('binds a numeric-index write (`pushTokens.0.token`)', async () => {
      const user = await userWithToken();
      await User.updateOne({ _id: user._id }, { $set: { 'pushTokens.0.token': 'rotated-0' } });
      expectBoundTo(await rawUsers().findOne({ _id: user._id }), 'pushTokens.0.token', user._id, 'rotated-0');
    });

    it('binds a positional write (`pushTokens.$.token`)', async () => {
      const user = await userWithToken();
      await User.updateOne(
        { _id: user._id, 'pushTokens.platform': 'ios' },
        { $set: { 'pushTokens.$.token': 'rotated-positional' } },
      );
      expectBoundTo(await rawUsers().findOne({ _id: user._id }), 'pushTokens.0.token', user._id, 'rotated-positional');
    });

    it('binds an all-positional write (`pushTokens.$[].token`)', async () => {
      const user = await userWithToken();
      await User.updateOne({ _id: user._id }, { $set: { 'pushTokens.$[].token': 'rotated-all' } });
      expectBoundTo(await rawUsers().findOne({ _id: user._id }), 'pushTokens.0.token', user._id, 'rotated-all');
    });

    it('binds the path the ONE real writer uses (authController: push() + save())', async () => {
      const user = await userWithToken('fcm-device-secret');
      expectBoundTo(await rawUsers().findOne({ _id: user._id }), 'pushTokens.0.token', user._id, 'fcm-device-secret');
      // and the dedup read authController depends on still resolves
      const read = await User.findById(user._id);
      expect(read.pushTokens.some((t) => t.token === 'fcm-device-secret')).toBe(true);
    });
  });

  describe('the inventory the guard walks', () => {
    const { encryptedDocumentArrayPaths } = require('../app/models/encryptedField');

    it('finds the document array it was built for (not vacuous)', () => {
      expect(encryptedDocumentArrayPaths(User.schema)).toEqual(['pushTokens']);
    });

    it('reports nothing for a schema whose encrypted leaves are all single-nested', () => {
      expect(encryptedDocumentArrayPaths(MorningState.schema)).toEqual([]);
    });

    it('User installs the plugin the walk now demands of it', () => {
      expect(User.schema.$encryptedAadBound).toBe(true);
    });
  });
});

// Two further shapes measured against real Mongo while enumerating: assigning ONE WHOLE ELEMENT
// detaches it exactly as assigning the array does, by numeric index and through the positional
// operator alike. They normalise to the array path, which is why one comparison covers both.
describe('W4-D75 · assigning a whole ELEMENT is the same blind spot', () => {
  const mkSeeded = async () => {
    const user = await User.create({
      ssoProvider: 'google',
      ssoId: `sso-${new mongoose.Types.ObjectId()}`,
      email: `u${Date.now()}${Math.round(Math.random() * 1e6)}@example.com`,
    });
    user.pushTokens.push({ token: 'seed-secret', platform: 'ios' });
    await user.save();
    return user;
  };

  it('rejects a numeric-index whole-element $set (`pushTokens.0`)', async () => {
    const user = await mkSeeded();
    await expect(User.updateOne(
      { _id: user._id },
      { $set: { 'pushTokens.0': { token: 'replaced', platform: 'ios' } } },
    )).rejects.toThrow(/pushTokens/);
    // the element the refusal protected is still the bound one
    expectBoundTo(await rawUsers().findOne({ _id: user._id }), 'pushTokens.0.token', user._id, 'seed-secret');
  });

  it('rejects a positional whole-element $set (`pushTokens.$`)', async () => {
    const user = await mkSeeded();
    await expect(User.updateOne(
      { _id: user._id, 'pushTokens.platform': 'ios' },
      { $set: { 'pushTokens.$': { token: 'replaced', platform: 'ios' } } },
    )).rejects.toThrow(/pushTokens/);
    expectBoundTo(await rawUsers().findOne({ _id: user._id }), 'pushTokens.0.token', user._id, 'seed-secret');
  });
});

// The normalisation the array check rides on. `timestamps: true` makes Mongoose append its own
// `$set: {updatedAt}` BEFORE this hook runs, so a caller-shorthand update arrives as
// `{pushTokens: […], $set: {updatedAt}}` — mixed. An update-level "does any key start with $"
// reads that as operator form and never looks at the bare key, which is where the value is; that
// is exactly how the shorthand case got through the first implementation of this row. The same
// test is what the W4-D71 sub-document rewrite depends on, so it is pinned on its own.
describe('W4-D75 · shorthand keys are normalised PER KEY, not per update', () => {
  const mkUser = () => User.create({
    ssoProvider: 'google',
    ssoId: `sso-${new mongoose.Types.ObjectId()}`,
    email: `u${Date.now()}${Math.round(Math.random() * 1e6)}@example.com`,
  });

  it('sees the bare key even when Mongoose has already added a $set of its own', async () => {
    const user = await mkUser();
    // `timestamps: true` is what makes this update mixed rather than pure shorthand.
    expect(User.schema.options.timestamps).toBe(true);
    await expect(User.updateOne({ _id: user._id }, { pushTokens: [{ token: 'x', platform: 'ios' }] }))
      .rejects.toThrow(/pushTokens/);
  });

  it('moves a bare key into $set without dropping it or the timestamps beside it', async () => {
    const user = await mkUser();
    const before = (await rawUsers().findOne({ _id: user._id })).updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    await User.updateOne({ _id: user._id }, { garminUserId: 'garmin-shorthand' });

    const raw = await rawUsers().findOne({ _id: user._id });
    expectBoundTo(raw, 'garminUserId', user._id, 'garmin-shorthand');
    expect(raw.updatedAt.getTime()).toBeGreaterThan(before.getTime());
  });
});

// ── W4-D76 · an AGGREGATION-PIPELINE update stores PLAINTEXT ────────────────────────────────
//
// W4-D71/D75 are about ciphertext written without its owner AAD. This one is worse: a pipeline
// update runs SERVER-SIDE, so no Mongoose setter executes at all and the literal value lands in
// the collection — `garminUserId: 'x'` is stored as the five characters, not as a blob. It hits
// EVERY encrypted leaf (top-level ones included, which the query-context cast otherwise handles),
// so no rewrite can repair it; only a refusal can.
//
// The row that queued this assumed a `pre` hook cannot see a pipeline update. Measured against
// Mongoose 9.7.1, that is WRONG — query middleware fires for `updateOne`/`findOneAndUpdate` with
// `updatePipeline: true` and `this.getUpdate()` returns the stage array; the existing hook simply
// returned early on `!_isPlainObject(raw)`. So this is a RUNTIME refusal at the same seam as D75,
// which also covers callers that do not exist yet.
//
// `bulkWrite` is a genuinely different bypass and is handled by the static guard at the bottom:
// it runs NO query middleware, but its casting DOES run setters, so it stores ciphertext with no
// owner AAD (the D71 class) — or plaintext, when its own update is a pipeline.
//
//   REFUSED   $set/$addFields/$project naming an encrypted leaf (or an ancestor of one)
//   REFUSED   $replaceRoot / $replaceWith on any schema with an encrypted leaf
//   ALLOWED   a pipeline that touches no encrypted leaf · $unset (clearing writes no ciphertext)
describe('W4-D76 · aggregation-pipeline updates that would write an encrypted leaf', () => {
  const mkUser = () => User.create({
    ssoProvider: 'google',
    ssoId: `sso-${new mongoose.Types.ObjectId()}`,
    email: `u${Date.now()}${Math.round(Math.random() * 1e6)}@example.com`,
  });

  it('refuses $set on a top-level encrypted leaf instead of storing the plaintext', async () => {
    const user = await mkUser();
    await expect(User.updateOne(
      { _id: user._id },
      [{ $set: { garminUserId: 'PLAINTEXT-CANARY' } }],
      { updatePipeline: true },
    )).rejects.toThrow(/garminUserId/);

    // The refusal has to abort the write, not merely report it.
    const raw = await rawUsers().findOne({ _id: user._id });
    expect(raw.garminUserId == null).toBe(true);
  });

  it('refuses on findOneAndUpdate too, not just updateOne', async () => {
    const user = await mkUser();
    await expect(User.findOneAndUpdate(
      { _id: user._id },
      [{ $set: { garminUserId: 'PLAINTEXT-CANARY' } }],
      { updatePipeline: true },
    )).rejects.toThrow(/\[encryptedField\]/);
  });

  it('refuses $addFields and $project, the other two stages that assign a value', async () => {
    const user = await mkUser();
    for (const stage of [{ $addFields: { garminUserId: 'x' } }, { $project: { garminUserId: 'x' } }]) {
      await expect(User.updateOne({ _id: user._id }, [stage], { updatePipeline: true }))
        .rejects.toThrow(/garminUserId/);
    }
  });

  it('refuses an ANCESTOR of an encrypted leaf, not just the leaf itself', async () => {
    const userId = uid();
    await MedicalProfile.create({ userId, restingHeartRate: 55 });
    // `lastNightSleep.{deep,light,rem}` are encrypted; assigning the parent assigns all three.
    await expect(MedicalProfile.updateOne(
      { userId },
      [{ $set: { lastNightSleep: { deep: 90, light: 300, rem: 90 } } }],
      { updatePipeline: true },
    )).rejects.toThrow(/lastNightSleep/);
    // …and the numeric leaf itself, which would otherwise be stored as a readable number.
    await expect(MedicalProfile.updateOne(
      { userId },
      [{ $set: { restingHeartRate: 61 } }],
      { updatePipeline: true },
    )).rejects.toThrow(/restingHeartRate/);
    expect(typeof (await rawProfile().findOne({ userId })).restingHeartRate).toBe('string');
  });

  it('refuses $replaceRoot/$replaceWith, which can assign any leaf at all', async () => {
    const user = await mkUser();
    for (const stage of [{ $replaceWith: { email: 'x@y.z' } }, { $replaceRoot: { newRoot: {} } }]) {
      await expect(User.updateOne({ _id: user._id }, [stage], { updatePipeline: true }))
        .rejects.toThrow(/\[encryptedField\]/);
    }
  });

  it('ALLOWS a pipeline that touches no encrypted leaf', async () => {
    const user = await mkUser();
    await User.updateOne({ _id: user._id }, [{ $set: { name: 'Renamed' } }], { updatePipeline: true });
    expect((await rawUsers().findOne({ _id: user._id })).name).toBe('Renamed');
  });

  it('ALLOWS $unset of an encrypted leaf — clearing writes no ciphertext', async () => {
    const user = await mkUser();
    await User.updateOne({ _id: user._id }, { garminUserId: 'bound-first' });
    await User.updateOne({ _id: user._id }, [{ $unset: ['garminUserId'] }], { updatePipeline: true });
    expect((await rawUsers().findOne({ _id: user._id })).garminUserId).toBeUndefined();
  });

  it('leaves the ordinary operator path exactly as W4-D71/D75 left it', async () => {
    const user = await mkUser();
    await User.updateOne({ _id: user._id }, { $set: { garminUserId: 'still-bound' } });
    expectBoundTo(await rawUsers().findOne({ _id: user._id }), 'garminUserId', user._id, 'still-bound');
  });
});

describe('W4-D76 · every schema with ANY encrypted leaf installs the refusal', () => {
  const fs = require('fs');
  const path = require('path');
  const { encryptedLeafPaths } = require('../app/models/encryptedField');

  const modelDir = path.join(__dirname, '..', 'app', 'models');
  const modelFiles = fs.readdirSync(modelDir)
    .filter((f) => f.endsWith('.js') && f !== 'encryptedField.js');

  const schemaOf = (file) => {
    const exported = require(path.join(modelDir, file));
    return exported && exported.schema && exported.schema.paths ? exported.schema : null;
  };

  // W4-D71's guard asked only about the sub-document/array blind spots, because those were the
  // only shapes that could go unbound. A pipeline update bypasses the setter for EVERY leaf, so
  // the inventory question is now "does this schema encrypt anything at all".
  it.each(modelFiles)('%s', (file) => {
    const schema = schemaOf(file);
    if (!schema) return; // not a model module (helpers, enums)

    const leaves = encryptedLeafPaths(schema);
    if (!leaves.length) return;

    expect({ file, leaves, bound: schema.$encryptedAadBound === true })
      .toEqual({ file, leaves, bound: true });
  });

  it('covers the models that carry ONLY top-level leaves (the guard is not vacuous)', () => {
    const withLeaves = modelFiles
      .filter((f) => { const s = schemaOf(f); return s && encryptedLeafPaths(s).length > 0; });
    // If this list ever shrinks, a model stopped encrypting — that is a finding, not a fix.
    expect(withLeaves.sort()).toEqual([
      'BiometricLog.js', 'MedicalProfile.js', 'MorningState.js',
      'PlaylistSession.js', 'User.js', 'VitalSample.js',
    ]);
  });
});

describe('W4-D76 · bulkWrite is out of reach of every hook, so it is guarded statically', () => {
  const fs = require('fs');
  const path = require('path');
  const { encryptedLeafPaths } = require('../app/models/encryptedField');

  const appDir = path.join(__dirname, '..', 'app');
  const modelDir = path.join(appDir, 'models');

  const encryptedModels = fs.readdirSync(modelDir)
    .filter((f) => f.endsWith('.js') && f !== 'encryptedField.js')
    .filter((f) => {
      const exported = require(path.join(modelDir, f));
      const schema = exported && exported.schema;
      return schema && schema.paths && encryptedLeafPaths(schema).length > 0;
    })
    .map((f) => f.replace(/\.js$/, ''));

  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return e.isFile() && e.name.endsWith('.js') ? [full] : [];
  });

  /**
   * Call sites where a model whose schema encrypts something is written through a bypass no
   * middleware can see. Two independent readings, because either one alone is evadable: the
   * receiver identifier immediately before the call, and "this file imports an encrypted model
   * AND uses the bypass at all".
   */
  const bypassSites = (source, file) => {
    const hits = [];
    const imports = encryptedModels.filter((m) => new RegExp(`models/${m}\\b`).test(source));
    for (const [, receiver] of source.matchAll(/(\w+)\s*\.\s*bulkWrite\s*\(/g)) {
      if (encryptedModels.includes(receiver) || imports.length) {
        hits.push(`${file}: ${receiver}.bulkWrite (imports: ${imports.join(',') || 'none'})`);
      }
    }
    if (imports.length && /updatePipeline\s*:\s*true/.test(source)) {
      hits.push(`${file}: updatePipeline in a file importing ${imports.join(',')}`);
    }
    return hits;
  };

  it('no encrypted model is written through bulkWrite or a pipeline update anywhere in app/', () => {
    const found = walk(appDir)
      .flatMap((f) => bypassSites(fs.readFileSync(f, 'utf8'), path.relative(appDir, f)));
    expect(found).toEqual([]);
  });

  it('the detector finds the bypass it was built for (the guard is not vacuous)', () => {
    expect(bypassSites("const User = require('../models/User');\nawait User.bulkWrite(ops);", 'x.js'))
      .toHaveLength(1);
    expect(bypassSites("const A = require('../models/AudioFeature');\nawait A.bulkWrite(ops);", 'x.js'))
      .toEqual([]);
  });
});
