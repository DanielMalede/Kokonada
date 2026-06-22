'use strict';

// Field-level encryption at rest for special-category health data (audit F3).
// Mongoose runs getters/setters on in-memory documents, so this needs no DB.
process.env.ENCRYPTION_KEY = 'a'.repeat(64);

const { decrypt } = require('../app/utils/encryption');
const BiometricLog    = require('../app/models/BiometricLog');
const PlaylistSession = require('../app/models/PlaylistSession');
const MedicalProfile  = require('../app/models/MedicalProfile');

const OID = '507f1f77bcf86cd799439011';

describe('field-level encryption at rest (audit F3)', () => {
  describe('BiometricLog.heartRate', () => {
    it('stores heartRate as ciphertext but reads back the number', () => {
      const doc = new BiometricLog({ userId: OID, heartRate: 72, source: 'garmin', recordedAt: new Date() });

      expect(doc.heartRate).toBe(72); // getter decrypts

      const raw = doc.toObject({ getters: false }).heartRate;
      expect(raw).not.toBe(72);
      expect(raw).not.toBe('72');           // not plaintext at rest
      expect(decrypt(raw)).toBe('72');      // genuinely encrypted
    });

    it('rejects an out-of-range heartRate (range preserved through encryption)', () => {
      const doc = new BiometricLog({ userId: OID, heartRate: 500, source: 'garmin', recordedAt: new Date() });
      const err = doc.validateSync();
      expect(err).toBeTruthy();
      expect(err.errors.heartRate).toBeTruthy();
    });

    it('accepts an in-range heartRate', () => {
      const doc = new BiometricLog({ userId: OID, heartRate: 120, source: 'suunto', recordedAt: new Date() });
      expect(doc.validateSync()).toBeUndefined();
    });

    it('tolerates a legacy plaintext value (pre-encryption row)', () => {
      // hydrate() builds a doc from raw DB data without running setters
      const doc = BiometricLog.hydrate({ _id: OID, userId: OID, heartRate: '80', source: 'garmin', recordedAt: new Date() });
      expect(doc.heartRate).toBe(80);
    });
  });

  describe('PlaylistSession', () => {
    it('encrypts contextPrompt and biometricSnapshot.heartRate', () => {
      const doc = new PlaylistSession({
        userId: OID,
        emotionTaps: [{ x: 0, y: 0 }],
        contextPrompt: 'feeling anxious before exam',
        biometricSnapshot: { heartRate: 95, activity: 'resting' },
        musicProvider: 'spotify',
      });

      expect(doc.contextPrompt).toBe('feeling anxious before exam');
      expect(doc.biometricSnapshot.heartRate).toBe(95);

      const raw = doc.toObject({ getters: false });
      expect(raw.contextPrompt).not.toContain('anxious');
      expect(decrypt(raw.contextPrompt)).toBe('feeling anxious before exam');
      expect(decrypt(raw.biometricSnapshot.heartRate)).toBe('95');
    });
  });

  describe('MedicalProfile', () => {
    it('encrypts restingHeartRate / hrv / spO2 at rest', () => {
      const doc = new MedicalProfile({ userId: OID, restingHeartRate: 58, hrv: 65, spO2: 98 });

      expect(doc.restingHeartRate).toBe(58);
      expect(doc.hrv).toBe(65);
      expect(doc.spO2).toBe(98);

      const raw = doc.toObject({ getters: false });
      expect(raw.hrv).not.toBe(65);
      expect(decrypt(raw.hrv)).toBe('65');
    });
  });
});
