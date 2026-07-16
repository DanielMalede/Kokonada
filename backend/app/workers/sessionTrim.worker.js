'use strict';

const PlaylistSession = require('../models/PlaylistSession');

// Bounded retention for PlaylistSession SENSITIVE fields (T3.1). A schema-level TTL can't
// target a SUBSET of fields, so this scheduled trim redacts only the encrypted, re-identifying
// context — the free-text contextPrompt and the biometric HR snapshot — once a session ages
// past the window, while KEEPING the non-sensitive trackSummary / feedback / activity label so
// the History feed still renders "what played". Mirrors the reclassify repeatable-worker pattern.

const RETENTION_DAYS = () => Number(process.env.SESSION_SENSITIVE_RETENTION_DAYS) || 30;

async function processJob() {
  const cutoff = new Date(Date.now() - RETENTION_DAYS() * 24 * 3600 * 1000);
  // Idempotent: only touch rows that STILL carry sensitive data. Once trimmed both fields are
  // null, so the row stops matching and re-runs are free (never double-encrypt a cleared row).
  const filter = {
    createdAt: { $lt: cutoff },
    $or: [
      { contextPrompt: { $ne: null } },
      { 'biometricSnapshot.heartRate': { $ne: null } },
    ],
  };
  // Null (not '') so the encrypted-field setter passes the value straight through — no
  // ciphertext for an empty string, nothing left to decrypt. activity/trackSummary untouched.
  const res = await PlaylistSession.updateMany(filter, {
    $set: { contextPrompt: null, 'biometricSnapshot.heartRate': null },
  });
  return { trimmed: res?.modifiedCount ?? 0 };
}

module.exports = { process: processJob };
