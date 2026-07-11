'use strict';

// Transparent field-level encryption for Mongoose. Stores AES-256-GCM ciphertext
// as a String; the setter encrypts on write, the getter decrypts on read. Special-
// category health data (heart rate, emotion prompts, physiological metrics) must
// not sit in the database as plaintext. (audit F3)
//
// Caveats (documented intentionally):
//  - Mongoose 9 runs setters on findOneAndUpdate/updateOne($set) too — so pass the RAW
//    value in an update operator and let the setter encrypt ONCE. Pre-encrypting into
//    $set DOUBLE-encrypts (getter then peels one layer → Number(ciphertext)=NaN). (This
//    bit metricStore's Health-Connect ingest — Pulse showed "—" despite a good sync.)
//    NB: fields stored as a PLAIN String that you encrypt yourself (e.g. MedicalProfile
//    stateVector.status) have NO setter — keep encrypting those explicitly.
//  - The getter is tolerant of legacy plaintext (pre-encryption rows): if a value
//    fails to decrypt it is returned/parsed as-is, enabling a gradual migration.
//  - Schemas using these fields should set { toJSON: { getters: true },
//    toObject: { getters: true } } so any serialization decrypts.

const { encrypt, decrypt } = require('../utils/encryption');

function encryptedString(opts = {}) {
  const field = {
    type: String,
    set: (v) => (v == null ? v : encrypt(String(v))),
    get: (v) => {
      if (v == null) return v;
      try { return decrypt(v); } catch { return v; } // legacy plaintext
    },
  };
  if (opts.required) field.required = true;
  if (opts.default !== undefined) field.default = opts.default;
  return field;
}

function encryptedNumber(opts = {}) {
  const field = {
    type: String,
    set: (v) => (v == null ? v : encrypt(String(v))),
    get: (v) => {
      if (v == null) return v;
      try { return Number(decrypt(v)); } catch { return Number(v); } // legacy plaintext
    },
  };
  if (opts.required) field.required = true;
  if (opts.default !== undefined) field.default = opts.default;
  // Range validation must decrypt first (the stored value is ciphertext). (audit F3 preserves F-prior min/max)
  if (opts.min != null || opts.max != null) {
    field.validate = {
      validator(v) {
        if (v == null) return true;
        let n;
        try { n = Number(decrypt(v)); } catch { n = Number(v); }
        if (Number.isNaN(n)) return false;
        if (opts.min != null && n < opts.min) return false;
        if (opts.max != null && n > opts.max) return false;
        return true;
      },
      message: opts.message || 'encrypted numeric value out of range',
    };
  }
  return field;
}

module.exports = { encryptedString, encryptedNumber };
