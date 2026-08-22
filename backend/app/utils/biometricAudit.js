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

// Values-free summary of a metrics object, for a log line that needs to say WHAT landed without
// saying what it WAS (ADR-0005 "biometrics are never logged" / §0.2.2 "no numeric vital in any
// log"). Returns the number of scalars present and the names of the ones drawn from `allowed`.
//
// The vocabulary is a required, CLOSED allowlist and the function fails closed (an absent or empty
// one names nothing): a summariser that echoed whatever keys it was handed would be one malformed
// producer away from being the leak it exists to prevent — the same reason `insertAccounted` keeps
// a closed reject vocabulary instead of passing Mongoose's value-quoting messages through. Values
// are unreachable by construction: only `Object.keys` is ever read.
//
// @param {object} obj      e.g. aggregateProfileMetrics' output
// @param {string[]|Set<string>} allowed  the metric names that may be NAMED
// @returns {{count:number, keys:string, unknown:number}} `keys` is comma-joined + sorted, or 'none'
function summarizeMetricKeys(obj, allowed) {
  const isPlainObject = !!obj && typeof obj === 'object' && !Array.isArray(obj);
  const keys  = isPlainObject ? Object.keys(obj) : [];
  const vocab = allowed instanceof Set ? allowed : new Set(Array.isArray(allowed) ? allowed : []);
  const named = keys.filter((k) => vocab.has(k)).sort();

  return {
    count:   keys.length,
    keys:    named.length ? named.join(',') : 'none',
    unknown: keys.length - named.length,
  };
}

module.exports = { logBiometricAccess, auditedDecrypt, summarizeMetricKeys };
