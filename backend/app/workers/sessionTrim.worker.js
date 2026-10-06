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
const { sweepDeletedAccountOrphans } = require('../services/privacy/orphanSweep');
const { trimStateEvents } = require('../queues/stateVectorJob');

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
//   • J2 (BE-094) — the data a deleted account left behind (rows and keys under an id no User doc carries)
//     is erased by the house cascade (services/privacy/orphanSweep.js), at most 50 accounts a run, once the
//     sweep is armed: `orphanErasures=` the count, or `disabled` (not armed) or `refused` (its guard refused,
//     or a read failed; a failed step), and `orphanBacklog=` the deleted accounts still left, a real count,
//     or `unknown` when it could not be counted. Before the health sweep and the 05:00 nightly analysis.
//   • J2 (BE-084, T-a) — the state-recompute event log loses every entry more than 24 hours old by the
//     Redis server's clock (`stateEvents=` the count, or `failed`; queues/stateVectorJob.js).
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
    // J2 (BE-094): two tokens from one result (the signed P10 places them here, so the line still ends
    // `healthErasures=N spotifyErasures=N failures=N`). The entry point takes no argument: the nightly run
    // is never forced and never told it is armed (tests/orphanSweep.structural.test.js).
    [['orphanErasures', 'orphanBacklog'], async () => {
      const { count, backlog, failed } = await sweepDeletedAccountOrphans();
      return { orphanErasures: count, orphanBacklog: backlog, failed };
    }],
    ['stateEvents', () => trimStateEvents()],
    // After the 30-day trim (see the BE-016 note above). Before the Spotify sweep, which it does not
    // depend on, so the line still ends `spotifyErasures=N failures=N`.
    ['healthErasures', () => sweepOwedHealthErasures()],
    ['spotifyErasures', () => sweepOwedSpotifyErasures()],
  ];

  const result = {};
  let failures = 0;
  // J2 (DT-13 FINAL §D): what a J2 token reads when its step throws. Never 0, which would read as "ran and
  // found nothing". The older tokens keep their 0.
  const FAILURE_WORD = { orphanErasures: 'refused', orphanBacklog: 'unknown', stateEvents: 'failed' };
  for (const [names, run] of steps) {
    const tokens = Array.isArray(names) ? names : [names];
    try {
      // A step returns a count, or { count, failed } when it works through many units (users), or, for a
      // step with several tokens, { <token>: value, …, failed }.
      const out = await run();
      if (tokens.length > 1) for (const token of tokens) result[token] = out?.[token] ?? FAILURE_WORD[token] ?? 0;
      else result[tokens[0]] = typeof out === 'number' ? out : (out?.count ?? 0);
      failures += typeof out === 'number' ? 0 : (out?.failed ?? 0);
    } catch (err) {
      for (const token of tokens) result[token] = FAILURE_WORD[token] ?? 0;
      failures += 1;
      // The error NAME only: a driver message can quote the values it choked on.
      console.error(`[sessionTrim] step ${tokens[0]} failed (${err?.name || 'Error'})`);
    }
  }
  result.failures = failures;

  console.log(`[sessionTrim] ${Object.entries(result).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  if (failures) throw new Error(`[sessionTrim] ${failures} step(s) failed`);
  return result;
}

module.exports = { process: processJob };
