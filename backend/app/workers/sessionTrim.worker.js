'use strict';

const PlaylistSession = require('../models/PlaylistSession');
const {
  providerContentCutoff,
  stripProviderContent,
  expireServeEvents,
} = require('../services/privacy/providerContentErasure');
const unclassifiedRepo = require('../repositories/unclassifiedRepo');
const { sweepOwedSpotifyErasures } = require('../services/privacy/spotifyErasure');
const { sweepOwedHealthErasures } = require('../services/privacy/sessionHealthSweep');

// The daily retention job. Two clocks run here:
//   • T3.1 — the encrypted, re-identifying context (the free-text contextPrompt and the HR
//     snapshot) is redacted once a session passes SESSION_SENSITIVE_RETENTION_DAYS (30).
//   • HX-2 — provider track data is gone before it is 30 days old (cutoff 29): the five provider
//     fields on every PlaylistSession, ServeEvent rows, and UnclassifiedTrack pool rows. A
//     schema TTL cannot empty a SUBSET of fields, so PlaylistSession is trimmed field by field
//     and never deleted; its moodKey, emotion taps, activity and skip count stay for History.
//   • HX-2 M6 — a Spotify disconnect whose purge did not finish is finished here, so every
//     disconnect is fully erased within days with no user action.
//   • BE-016 (DEC-111) — a withdrawal of health-data consent whose session-health erasure did not
//     finish, and withdrawals made before that erasure existed, are finished here (`healthErasures=`;
//     services/privacy/sessionHealthSweep.js). It runs after the 30-day trim, so a session the trim
//     reaches in this run is judged as trimmed in this run. HEALTH_ERASURE_SWEEP_DISABLED stops the backlog; owed erasures still finish.
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
    ['unclassifiedBackfilled', () => unclassifiedRepo.backfillCreatedAt()],
    ['unclassifiedExpired', () => unclassifiedRepo.expireCreatedBefore(providerCutoff)],
    // After the 30-day trim (see the BE-016 note above). Before the Spotify sweep, which it does not
    // depend on, so the line still ends `spotifyErasures=N failures=N`.
    ['healthErasures', () => sweepOwedHealthErasures()],
    ['spotifyErasures', () => sweepOwedSpotifyErasures()],
  ];

  const result = {};
  let failures = 0;
  for (const [name, run] of steps) {
    try {
      // A step returns a count, or { count, failed } when it works through many units (users).
      const out = await run();
      result[name] = typeof out === 'number' ? out : (out?.count ?? 0);
      failures += typeof out === 'number' ? 0 : (out?.failed ?? 0);
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
