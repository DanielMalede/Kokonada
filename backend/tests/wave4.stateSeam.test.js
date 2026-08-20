'use strict';

// W4-006 (seam half) — THE STATE VOCABULARY REACHES STORAGE AND THE BAND PROJECTION.
//
// Two seams, one theme: the taxonomy becomes the vocabulary the rest of the system reasons in,
// WITHOUT anything a user reads changing. That distinction is the whole design here, because
// HITL H6 (what a person is shown for a state) is Daniel's open decision, and a seam that
// quietly started rendering `acute-stress` on the Pulse screen would settle it by accident.
//
//   1. `moodDescriptors._STATE_TO_BAND` is now DERIVED from `stateTaxonomy.stateBandTable()`
//      rather than hand-written. Strict superset: all nine legacy labels keep the exact band
//      they resolved to, and 30-odd taxonomy ids are added alongside.
//
//   2. `medicalProfileService.upsertStateVector` gains an ADDITIVE encrypted `stateId`. The
//      existing `status`/`confidence` pair — the one `pulseController` decrypts and serves to
//      the owner — keeps its exact vocabulary and its exact meaning.

process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);

jest.mock('../app/models/MedicalProfile', () => ({ findOneAndUpdate: jest.fn().mockResolvedValue({}) }));

const MedicalProfile = require('../app/models/MedicalProfile');
const { decrypt } = require('../app/utils/encryption');
const taxonomy = require('../app/agents/runtime/knowledge/stateTaxonomy');
const moodDescriptors = require('../app/services/moodDescriptors');
const { biometricBand, _STATE_TO_BAND } = moodDescriptors;
const { upsertStateVector, computeStateVector } = require('../app/services/medicalProfileService');

beforeEach(() => {
  jest.clearAllMocks();
  process.env.ENCRYPTION_KEY = 'a'.repeat(64);
  MedicalProfile.findOneAndUpdate.mockResolvedValue({});
});

// ── 1. the band projection ──────────────────────────────────────────────────────────────────

// The nine bands as they stood before this commit, written out rather than imported, so this is
// a genuine record of prior behaviour and not a tautology against the table it is checking.
const BANDS_BEFORE_W4_006 = {
  'High-Stress / Pre-Panic':           'resting',
  'Peak Athletic Performance':         'peak',
  'Intense Workout':                   'peak',
  'Active Recovery':                   'active',
  'Morning Activation':                'active',
  'Exhausted Commute':                 'resting',
  'Screen-Off / Background Listening': 'resting',
  'Deep Focus / Flow State':           'active',
  'Resting / Meditative':              'resting',
};

describe('_STATE_TO_BAND is derived from the taxonomy, as a strict superset', () => {
  test('every legacy label resolves to exactly the band it resolved to before', () => {
    for (const [label, band] of Object.entries(BANDS_BEFORE_W4_006)) {
      expect({ [label]: _STATE_TO_BAND[label] }).toEqual({ [label]: band });
      expect(biometricBand({ stateLabel: label })).toBe(band);
    }
  });

  test('the taxonomy ids are now resolvable too', () => {
    const opinionated = taxonomy.STATES.filter((s) => s.requiredSignals.length > 0);
    expect(opinionated.length).toBeGreaterThan(25);
    for (const s of opinionated) {
      expect({ [s.id]: _STATE_TO_BAND[s.id] }).toEqual({ [s.id]: s.band });
      expect(biometricBand({ stateLabel: s.id })).toBe(s.band);
    }
  });

  test('the fallback state contributes NO band — "nothing stands out" must not assert one', () => {
    const fallback = taxonomy.STATES.find((s) => s.requiredSignals.length === 0);
    expect(fallback).toBeDefined();
    expect(_STATE_TO_BAND[fallback.id]).toBeUndefined();

    // …and a context carrying only that label falls through to the heart rate, exactly as an
    // unknown label always has.
    expect(biometricBand({ stateLabel: fallback.id, heartRate: 130 }))
      .toBe(moodDescriptors.bandFromHeartRate(130));
  });

  test('the preference chain below the label is untouched', () => {
    expect(biometricBand({ stateLabel: 'not-a-state', hrRatio: 1.5 })).toBe('peak');
    expect(biometricBand({ stateLabel: 'not-a-state', hrRatio: 1.05 })).toBe('resting');
    expect(biometricBand({ hrRatio: 1.2 })).toBe('active');
    expect(biometricBand({ heartRate: 95 })).toBe(moodDescriptors.bandFromHeartRate(95));
    expect(biometricBand(null)).toBeNull();
  });

  test('the table is derived, not a second hand-kept copy that can drift', () => {
    expect(_STATE_TO_BAND).toEqual(taxonomy.stateBandTable());
  });

  test('every band it emits is one the rest of the system knows', () => {
    for (const band of Object.values(_STATE_TO_BAND)) {
      expect(['resting', 'active', 'peak']).toContain(band);
    }
  });
});

// ── 2. what gets stored ─────────────────────────────────────────────────────────────────────

const telemetry = { heartRate: 150, restingHeartRate: 60, stepsPerMinute: 150, spO2: 97 };

const writtenStateVector = () => MedicalProfile.findOneAndUpdate.mock.calls[0][1].$set.stateVector;

describe('upsertStateVector writes the taxonomy id ADDITIVELY', () => {
  test('the legacy status/confidence pair keeps its exact vocabulary (HITL H6 is not settled here)', async () => {
    await upsertStateVector('u1', telemetry);
    const sv = writtenStateVector();

    // `pulseController` decrypts this field and serves it to the owner. Turning it into
    // `peak-effort` would be an agent deciding what a person is told they are, which is exactly
    // the call H6 reserves for Daniel and a compliance pass.
    expect(decrypt(sv.status)).toBe('Peak Athletic Performance');
    expect(sv.confidence).toBe(computeStateVector(telemetry).confidence);
  });

  test('the taxonomy id is written alongside it, encrypted', async () => {
    await upsertStateVector('u1', telemetry);
    const sv = writtenStateVector();

    expect(sv.stateId).toBeDefined();
    expect(sv.stateId).not.toBe('peak-effort');           // stored ciphertext, never plaintext
    expect(decrypt(sv.stateId)).toBe('peak-effort');
    expect(taxonomy.byId(decrypt(sv.stateId))).not.toBeNull();
  });

  test('an affect label supersedes the nine-rule classifier for the taxonomy id', async () => {
    await upsertStateVector('u1', telemetry, {
      affect: { label: 'creative-flow', confidence: 0.8 },
    });
    const sv = writtenStateVector();

    expect(decrypt(sv.stateId)).toBe('creative-flow');
    expect(sv.stateConfidence).toBe(0.8);
    // …and the legacy pair is STILL the classifier's, so the two vocabularies never disagree
    // about which one produced which field.
    expect(decrypt(sv.status)).toBe('Peak Athletic Performance');
  });

  test('an affect label the taxonomy does not contain is ignored, not stored', async () => {
    await upsertStateVector('u1', telemetry, { affect: { label: 'vibes', confidence: 0.9 } });
    // Falls back to the legacy mapping rather than persisting a label nothing can resolve.
    expect(decrypt(writtenStateVector().stateId)).toBe('peak-effort');
  });

  test('every legacy label the classifier can emit maps to a real taxonomy state', () => {
    const emittable = [
      'High-Stress / Pre-Panic', 'Peak Athletic Performance', 'Intense Workout', 'Active Recovery',
      'Exhausted Commute', 'Screen-Off / Background Listening', 'Deep Focus / Flow State',
      'Morning Activation', 'Resting / Meditative', 'Neutral',
    ];
    for (const label of emittable) {
      const id = taxonomy.fromLegacyLabel(label);
      expect({ [label]: taxonomy.byId(id)?.id }).toEqual({ [label]: id });
    }
  });

  test('the neutral fallback stores the fallback state, not null', async () => {
    await upsertStateVector('u1', {});
    const sv = writtenStateVector();
    expect(decrypt(sv.status)).toBe('Neutral');
    expect(decrypt(sv.stateId)).toBe(taxonomy.fromLegacyLabel('Neutral'));
  });

  test('encryption is EXPLICIT — setters do not run on findOneAndUpdate($set) (R9)', async () => {
    await upsertStateVector('u1', telemetry);
    const sv = writtenStateVector();

    // The model declares these as plain Strings with no setter precisely because $set bypasses
    // setters — so the write itself has to encrypt, and a regression here stores a state label at
    // rest in plaintext, which R10 forbids outright. Asserted as a round trip rather than by the
    // shape of the envelope: the ciphertext format is the crypto util's business, and pinning it
    // here would make this test fail on a format change that broke nothing.
    for (const [field, plain] of [['status', 'Peak Athletic Performance'], ['stateId', 'peak-effort']]) {
      expect(typeof sv[field]).toBe('string');
      expect(sv[field]).not.toBe(plain);
      expect(sv[field]).not.toContain(plain);
      expect(decrypt(sv[field])).toBe(plain);
    }
  });

  test('the upsert shape is otherwise unchanged', async () => {
    await upsertStateVector('u1', telemetry);
    const [filter, update, opts] = MedicalProfile.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ userId: 'u1' });
    expect(opts).toEqual({ upsert: true, new: true });
    expect(update.$set.stateVector.computedAt).toBeInstanceOf(Date);
  });
});

// ── 3. the DTO the owner actually sees ──────────────────────────────────────────────────────

describe('the Pulse DTO does not leak internal vocabulary (R10 / HITL H6)', () => {
  test('an explicit whitelist means the new field cannot appear by accident', () => {
    jest.isolateModules(() => {
      const { toPulseStateDTO } = require('../app/controllers/pulseController');
      const { encrypt } = require('../app/utils/encryption');
      const dto = toPulseStateDTO({
        stateVector: {
          status: encrypt('Deep Focus / Flow State'),
          stateId: encrypt('deep-focus'),
          stateConfidence: 0.77,
          confidence: 1,
          computedAt: new Date(),
        },
      });

      expect(dto.stateVector.status).toBe('Deep Focus / Flow State');
      expect(dto.stateVector.stateId).toBeUndefined();
      expect(JSON.stringify(dto)).not.toContain('deep-focus');
    });
  });
});
