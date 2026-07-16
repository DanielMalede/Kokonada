'use strict';

// AAD context-binding for field-level encryption (T3.3): every encrypted health field is
// bound to its owning userId, so a ciphertext lifted from one user's row can't be replayed
// into another's. Legacy ciphertexts (written before AAD) still decrypt via fallback, and a
// re-write migrates them forward.
process.env.ENCRYPTION_KEY = 'a'.repeat(64);

const { encrypt, decrypt } = require('../app/utils/encryption');
const BiometricLog    = require('../app/models/BiometricLog');
const PlaylistSession = require('../app/models/PlaylistSession');
const MedicalProfile  = require('../app/models/MedicalProfile');

const OID   = '507f1f77bcf86cd799439011';
const OTHER = '507f1f77bcf86cd799439099';

describe('encrypted field AAD binding (T3.3)', () => {
  it('binds a top-level encrypted field to the owner userId', () => {
    const doc = new BiometricLog({ userId: OID, heartRate: 72, source: 'garmin', recordedAt: new Date() });
    const raw = doc.toObject({ getters: false }).heartRate;

    expect(decrypt(raw, false, String(OID))).toBe('72');        // AAD-bound to owner
    expect(() => decrypt(raw)).toThrow();                       // not readable without the AAD
    expect(() => decrypt(raw, false, String(OTHER))).toThrow(); // nor with another user's id
    expect(doc.heartRate).toBe(72);                             // getter still round-trips
  });

  it('binds an encrypted subdocument field to the OWNER document userId', () => {
    const doc = new PlaylistSession({
      userId: OID, emotionTaps: [{ x: 0, y: 0 }],
      contextPrompt: 'anxious', biometricSnapshot: { heartRate: 95, activity: 'resting' },
      musicProvider: 'spotify',
    });
    const raw = doc.toObject({ getters: false });

    expect(decrypt(raw.contextPrompt, false, String(OID))).toBe('anxious');
    expect(decrypt(raw.biometricSnapshot.heartRate, false, String(OID))).toBe('95');
    expect(doc.contextPrompt).toBe('anxious');
    expect(doc.biometricSnapshot.heartRate).toBe(95);
  });

  it('decrypts a LEGACY no-AAD ciphertext via fallback (migration safety)', () => {
    const legacy = encrypt('58'); // written before AAD binding — no AAD
    const doc = MedicalProfile.hydrate({ _id: OID, userId: OID, restingHeartRate: legacy });
    expect(doc.restingHeartRate).toBe(58); // getter falls back to no-AAD decrypt
  });

  it('re-encrypts on write, binding AAD forward (legacy migration)', () => {
    const legacy = encrypt('58');
    const doc = MedicalProfile.hydrate({ _id: OID, userId: OID, restingHeartRate: legacy });
    doc.restingHeartRate = 60; // re-write
    const raw = doc.toObject({ getters: false }).restingHeartRate;
    expect(decrypt(raw, false, String(OID))).toBe('60'); // now AAD-bound
    expect(() => decrypt(raw)).toThrow();
  });

  it('validates the decrypted range on an AAD-bound value', () => {
    const bad = new BiometricLog({ userId: OID, heartRate: 500, source: 'garmin', recordedAt: new Date() });
    expect(bad.validateSync()?.errors?.heartRate).toBeTruthy();
    const good = new BiometricLog({ userId: OID, heartRate: 120, source: 'garmin', recordedAt: new Date() });
    expect(good.validateSync()).toBeUndefined();
  });
});

describe('decrypt failure distinguishes tampering from legacy plaintext (M1)', () => {
  let alarmSpy;
  beforeEach(() => { alarmSpy = jest.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => alarmSpy.mockRestore());

  const alarmText = () => alarmSpy.mock.calls.flat().map(String).join(' ');

  it('a row-swapped AAD-bound ciphertext (wrong owner) reads as null + alarm, never raw/NaN', () => {
    const bound = encrypt('72', OID);                 // bound to OID
    const doc = BiometricLog.hydrate({ _id: OID, userId: OTHER, heartRate: bound, source: 'garmin', recordedAt: new Date() });
    expect(doc.heartRate).toBeNull();                 // not the ciphertext, not NaN
    expect(alarmSpy).toHaveBeenCalled();              // security alarm raised
    expect(alarmText()).not.toContain('72');          // never the plaintext value
  });

  it('a tampered ciphertext reads as null + alarm', () => {
    const buf = Buffer.from(encrypt('98', OID), 'base64');
    buf[20] ^= 0xff;                                  // corrupt the auth tag
    const doc = MedicalProfile.hydrate({ _id: OID, userId: OID, hrv: buf.toString('base64') });
    expect(doc.hrv).toBeNull();
    expect(alarmSpy).toHaveBeenCalled();
  });

  it('genuine legacy plaintext still reads through with NO alarm', () => {
    const doc = MedicalProfile.hydrate({ _id: OID, userId: OID, restingHeartRate: '58' });
    expect(doc.restingHeartRate).toBe(58);
    expect(alarmSpy).not.toHaveBeenCalled();
  });

  it('a legacy no-AAD ciphertext on the correct owner still decrypts, NO alarm', () => {
    const legacy = encrypt('61'); // no AAD (pre-binding)
    const doc = MedicalProfile.hydrate({ _id: OID, userId: OID, restingHeartRate: legacy });
    expect(doc.restingHeartRate).toBe(61);
    expect(alarmSpy).not.toHaveBeenCalled();
  });
});
