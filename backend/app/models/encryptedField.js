'use strict';

// Transparent field-level encryption for Mongoose. Stores AES-256-GCM ciphertext
// as a String; the setter encrypts on write, the getter decrypts on read. Special-
// category health data (heart rate, emotion prompts, physiological metrics) must
// not sit in the database as plaintext. (audit F3)
//
// AAD CONTEXT-BINDING (T3.3): every ciphertext is bound to its owning userId as GCM
// Additional Authenticated Data. A ciphertext lifted from one user's row therefore
// fails to decrypt under another user's id — defense against row-swap / replay. The
// owning userId is read off the document (`this`) — subdocuments climb to the owner.
//
// MIGRATION: existing ciphertexts were written WITHOUT AAD. Reads try the AAD-bound
// decrypt first, then fall back to a no-AAD decrypt, then to legacy plaintext — so
// nothing breaks. Writes always re-encrypt WITH AAD, so data migrates forward on any
// update. (See tests/encryptedFieldAad.test.js.)
//
// Caveats (documented intentionally):
//  - Mongoose 9 runs setters on findOneAndUpdate/updateOne($set) too — so pass the RAW
//    value in an update operator and let the setter encrypt ONCE. Pre-encrypting into
//    $set DOUBLE-encrypts (getter then peels one layer → Number(ciphertext)=NaN). (This
//    bit metricStore's Health-Connect ingest — Pulse showed "—" despite a good sync.)
//    NB: an update operator carries no document `this`, so its ciphertext is written
//    with NO AAD — that is fine (the tolerant read path still decrypts it, and the next
//    document-level .save() re-binds AAD). Fields stored as a PLAIN String that you
//    encrypt yourself (e.g. MedicalProfile stateVector.status) have NO setter — keep
//    encrypting those explicitly.
//  - The getter is tolerant of legacy plaintext (pre-encryption rows): if a value
//    fails to decrypt it is returned/parsed as-is, enabling a gradual migration.
//  - Schemas using these fields should set { toJSON: { getters: true },
//    toObject: { getters: true } } so any serialization decrypts.

const { encrypt, decrypt, isCiphertextFormat } = require('../utils/encryption');

// The owning userId (string) for AAD, or null when unknown. Subdocuments climb to the
// owner document via ownerDocument(); top-level documents expose userId directly.
function _ownerAad(doc) {
  if (!doc || typeof doc !== 'object') return null;
  let owner = doc;
  if (typeof doc.ownerDocument === 'function') {
    try { owner = doc.ownerDocument() || doc; } catch { owner = doc; }
  }
  const uid = owner ? owner.userId : null;
  return uid == null ? null : String(uid);
}

// Raw read: try the AAD-bound decrypt (new writes), fall back to no-AAD (legacy). Throws only
// when neither works.
function _decryptField(doc, v) {
  const aad = _ownerAad(doc);
  if (aad != null) {
    try { return decrypt(v, false, aad); } catch { /* legacy no-AAD ciphertext → try below */ }
  }
  return decrypt(v);
}

// A decrypt that failed on a value that IS our ciphertext format is a real security event —
// tamper, wrong key, or an AAD owner-mismatch (row-swap). Log an alarm (userId + reason only,
// NEVER the value) and signal the caller to yield null rather than leak raw ciphertext / NaN.
function _alarm(doc) {
  const owner = _ownerAad(doc);
  console.error(
    `[crypto-alarm] encrypted field failed authentication (tamper / wrong-key / AAD owner-mismatch) owner=${owner ?? 'unknown'}`,
  );
}

// Read a possibly-encrypted STRING. Genuine legacy plaintext (not our format) passes through; a
// well-formed-but-unauthenticated blob raises an alarm and reads as null. (M1)
function _readString(doc, v) {
  try { return _decryptField(doc, v); }
  catch {
    if (isCiphertextFormat(v)) { _alarm(doc); return null; }
    return v; // genuine legacy plaintext
  }
}

// Read a possibly-encrypted NUMBER, with the same tamper-vs-legacy discrimination. (M1)
function _readNumber(doc, v) {
  try { return Number(_decryptField(doc, v)); }
  catch {
    if (isCiphertextFormat(v)) { _alarm(doc); return null; }
    return Number(v); // genuine legacy plaintext
  }
}

// Write path: bind to the owner when known, else write unbound (an update-operator context
// has no document; the tolerant read + next save migrate it forward).
function _encryptField(doc, v) {
  const aad = _ownerAad(doc);
  return aad != null ? encrypt(String(v), aad) : encrypt(String(v));
}

function encryptedString(opts = {}) {
  const field = {
    type: String,
    set(v) { return v == null ? v : _encryptField(this, v); },
    get(v) { return v == null ? v : _readString(this, v); },
  };
  if (opts.required) field.required = true;
  if (opts.default !== undefined) field.default = opts.default;
  return field;
}

function encryptedNumber(opts = {}) {
  const field = {
    type: String,
    set(v) { return v == null ? v : _encryptField(this, v); },
    get(v) { return v == null ? v : _readNumber(this, v); },
  };
  if (opts.required) field.required = true;
  if (opts.default !== undefined) field.default = opts.default;
  // Range validation must decrypt first (the stored value is ciphertext). (audit F3 preserves F-prior min/max)
  if (opts.min != null || opts.max != null) {
    field.validate = {
      validator(v) {
        if (v == null) return true;
        // A tampered/unauthenticated blob yields NaN → fails validation (never saved); genuine
        // legacy plaintext parses through.
        let n;
        try { n = Number(_decryptField(this, v)); }
        catch { n = isCiphertextFormat(v) ? NaN : Number(v); }
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
