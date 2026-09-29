'use strict';

const PlaylistSession = require('../models/PlaylistSession');
const {
  providerContentCutoff,
  stripProviderContent,
  expireServeEvents,
  backfillUnclassifiedCreatedAt,
  expireUnclassifiedTracks,
} = require('../services/privacy/providerContentErasure');

// The daily retention job. Two clocks run here:
//   • T3.1 — the encrypted, re-identifying context (the free-text contextPrompt and the HR
//     snapshot) is redacted once a session passes SESSION_SENSITIVE_RETENTION_DAYS (30).
//   • HX-2 — provider track data is gone before it is 30 days old (cutoff 29): the five provider
//     fields on every PlaylistSession, ServeEvent rows, and UnclassifiedTrack pool rows. A
//     schema TTL cannot empty a SUBSET of fields, so PlaylistSession is trimmed field by field
//     and never deleted; its moodKey, emotion taps, activity and skip count stay for History.
// Each step runs even if another fails; the run then fails loudly so the worker logs it.
// The `[sessionTrim]` line (counts only) is the production check that the job ran.

const SENSITIVE_RETENTION_DAYS = () => Number(process.env.SESSION_SENSITIVE_RETENTION_DAYS) || 30;

async function trimSensitive(now) {
  const cutoff = new Date(now - SENSITIVE_RETENTION_DAYS() * 24 * 3600 * 1000);
  // Idempotent: only touch rows that STILL carry sensitive data. Once trimmed both fields are
  // null, so the row stops matching and re-runs are free (never double-encrypt a cleared row).
  // Null (not '') so the encrypted-field setter passes the value straight through — no
  // ciphertext for an empty string, nothing left to decrypt.
  const res = await PlaylistSession.updateMany({
    createdAt: { $lt: cutoff },
    $or: [
      { contextPrompt: { $ne: null } },
      { 'biometricSnapshot.heartRate': { $ne: null } },
    ],
  }, {
    $set: { contextPrompt: null, 'biometricSnapshot.heartRate': null },
  });
  return res?.modifiedCount ?? 0;
}

async function processJob() {
  const now = Date.now();
  const providerCutoff = providerContentCutoff(now);

  const steps = [
    ['trimmed', () => trimSensitive(now)],
    ['stripped', () => stripProviderContent({ createdAt: { $lt: providerCutoff } })],
    ['serveEvents', () => expireServeEvents(providerCutoff)],
    // Backfill BEFORE expiry, so a row that just got its clock is judged by it in the same run.
    ['unclassifiedBackfilled', () => backfillUnclassifiedCreatedAt()],
    ['unclassifiedExpired', () => expireUnclassifiedTracks(providerCutoff)],
  ];

  const result = {};
  let failures = 0;
  for (const [name, run] of steps) {
    try {
      result[name] = await run();
    } catch (err) {
      result[name] = 0;
      failures += 1;
      // The error NAME only: a driver message can quote the values it choked on.
      console.error(`[sessionTrim] step ${name} failed (${err?.name || 'Error'})`);
    }
  }
  result.failures = failures;

  console.log(`[sessionTrim] ${Object.entries(result).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  if (failures) throw new Error(`[sessionTrim] ${failures} step(s) failed`);
  return result;
}

module.exports = { process: processJob };
