'use strict';

// ADR-0005 audit-trail requirement: "Any code path that decrypts a biometric field must be
// auditable." This is the single audited accessor — it records WHO (userId), WHY (purpose)
// and WHEN (timestamp) special-category biometric data was decrypted, while honoring the same
// ADR's "Biometrics are never logged" rule: the plaintext VALUE is never emitted. Only a
// coarse sample count (never a reading) may accompany the record.

const { decrypt } = require('./encryption');

// Emit a values-free access record. Returns the structured record (for tests/aggregation).
// `meta.count` is the ONLY extra field surfaced — arbitrary meta is deliberately NOT spread,
// so a caller can't accidentally leak a vital into the audit log.
function logBiometricAccess(userId, purpose, meta = {}) {
  const record = {
    tag: 'biometric-access',
    userId: userId == null ? null : String(userId),
    purpose,
    at: new Date().toISOString(),
  };
  if (meta && meta.count != null) record.count = meta.count;
  console.info(
    `[biometric-access] user=${record.userId} purpose=${record.purpose} at=${record.at}`
    + (record.count != null ? ` count=${record.count}` : ''),
  );
  return record;
}

// The single audited decrypt accessor. Decrypts a biometric ciphertext bound to `userId`
// (AAD) and records the access. Returns the plaintext to the caller but NEVER logs it.
function auditedDecrypt(userId, purpose, blob, { parseJson = false } = {}) {
  logBiometricAccess(userId, purpose);
  return decrypt(blob, parseJson, userId == null ? null : String(userId));
}

module.exports = { logBiometricAccess, auditedDecrypt };
