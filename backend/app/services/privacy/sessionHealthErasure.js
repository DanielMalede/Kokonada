'use strict';

// BE-016 (DEC-111, DEC-118): withdrawing health-data consent erases the heart-rate snapshot kept on
// each session and the values derived from it, on sessions, on serve events and in the user-scoped
// Redis cache. WHAT is removed, and from WHICH rows, is sessionHealthPolicy.js; this module runs it.
//
// Its own module, called from consent.withdrawConsent ONLY, on the ADR-0015 precedent: a per-wearable
// disconnect (purgeWearableData has three callers, two of them disconnects) is not a withdrawal, and
// unpairing a watch must not rewrite History. The daily sweep (sessionHealthSweep.js) and the live
// lane's compensation (sockets/biometricHandler.js, undoRunWrites) reuse it.
//
// Kept on purpose (DEC-118): the session itself and its time, the emotion taps, a preset moodKey, the
// free text on its own 30-day clock (C1), the provider, the skip count, the flags, and the tracks on
// HX-2's 29-day clocks (T1). A heart-rate session keeps the mark `bio:`, which only says it was Live.

const mongoose = require('mongoose');
const User = require('../../models/User');
const ConsentRecord = require('../../models/ConsentRecord');
const PlaylistSession = require('../../models/PlaylistSession');
const ServeEvent = require('../../models/ServeEvent');
const { getRedis } = require('../../config/redis');
const { purgeUserKeysStrict } = require('../../utils/userRedisPurge');
const {
  BIO_KEY_WITH_BAND, SERVE_BIO_KEY, TARGETS_CLEARED, HEART_SESSION_SET, HEART_RATE_SET, SERVE_BIO_SET, SERVE_BAND_SET,
  windowsFor, erasureSteps, fresh,
} = require('./sessionHealthPolicy');

const MODELS = { PlaylistSession, ServeEvent };

const zeroCounts = () => ({ sessions: 0, sessionTargets: 0, serveEvents: 0, redisKeys: 0 });

// The purpose is read at call time: consent.js requires this module, so a load-time require back
// into it would see a half-initialised export.
const healthPurpose = () => require('./consent').HEALTH_CONSENT_PURPOSE;

// A user or session id as an ObjectId, or null. Validated BEFORE any query: Mongoose strips
// `undefined` from a filter, so a missing id turns a one-user update into an every-user update (the
// learningErasure precedent). Only a real ObjectId or its 24-character hex form is accepted;
// Mongoose's own isValidObjectId also accepts any 12-character string.
function toObjectId(value) {
  if (value instanceof mongoose.Types.ObjectId) return value;
  const hex = typeof value === 'string' ? value : (value && typeof value.toHexString === 'function' ? value.toHexString() : null);
  return typeof hex === 'string' && /^[0-9a-fA-F]{24}$/.test(hex) ? new mongoose.Types.ObjectId(hex) : null;
}

const isFiniteDate = (d) => d instanceof Date && Number.isFinite(d.getTime());

// An error's class name, or 'Error' — never its message: a driver message can quote values.
function errorType(e) {
  const name = e?.name;
  return typeof name === 'string' && /^[A-Za-z][A-Za-z0-9]*$/.test(name) ? name : 'Error';
}

function incomplete(counts, failedSteps) {
  const err = new Error(`session health erasure incomplete — ${failedSteps.length} step(s) failed (${failedSteps.join(', ')})`);
  err.name = 'SessionHealthErasureError';
  err.counts = counts;
  err.failedSteps = failedSteps;
  return err;
}

/** This user's consent history for the health purpose, from the PRIMARY (the HX-1 rule for consent reads). */
async function readHistory(userId) {
  return ConsentRecord.find({ userId, purpose: healthPurpose() }).read('primary').lean();
}

/**
 * Run every step of the policy for one user over the given windows. Each step is isolated: one that
 * fails does not stop the others, and the whole call then throws (the purgeSpotifyData shape) with
 * the counts so far and the failed steps by name and error type. The Redis purge runs LAST, so a
 * window rebuilt from serve rows reads rows already cleared. Returns the counts of rows changed.
 */
async function eraseSessionHealth(userId, windows, { purgeRedis = false } = {}) {
  const counts = zeroCounts();
  const id = toObjectId(userId);
  // Both cutoffs must be finite Dates (round 1, N9): Mongoose would cast a date string or a number and
  // run the erasure on it, and an Invalid Date would fail every step.
  if (!id || !windows || !isFiniteDate(windows.heartRateBefore) || !isFiniteDate(windows.targetsBefore)) return counts;
  const failedSteps = [];
  for (const step of erasureSteps(id, windows)) {
    try {
      const res = await MODELS[step.model].updateMany(step.filter, { $set: step.set });
      counts[step.count] += res?.modifiedCount ?? 0;
    } catch (e) {
      failedSteps.push(`${step.name}:${errorType(e)}`);
    }
  }
  if (purgeRedis) {
    try {
      counts.redisKeys = await purgeUserKeysStrict(String(id));
    } catch (e) {
      failedSteps.push(`redisKeys:${errorType(e)}`);
    }
  }
  if (failedSteps.length) throw incomplete(counts, failedSteps);
  return counts;
}

// Clears the owed-erasure record only if it still holds the value this run wrote: a newer withdrawal
// (or sweep) that wrote its own value is left to report on itself. Best-effort: a record left set
// only makes the daily sweep run an idempotent erasure once more.
async function clearPending(userId, value) {
  try {
    await User.updateOne({ _id: userId, healthErasurePendingAt: value }, { $set: { healthErasurePendingAt: null } });
  } catch { /* the sweep clears it */ }
}

// Records an erasure as owed. Its own failure is reported, never fatal: the steps still run, and the
// daily sweep also finds every account with a withdrawal from the consent history.
async function markPending(userId, value, failedSteps) {
  try {
    await User.updateOne({ _id: userId }, { $set: { healthErasurePendingAt: value } });
  } catch (e) {
    failedSteps.push(`pending:${errorType(e)}`);
  }
}

/**
 * The withdrawal's erasure (consent.withdrawConsent, after the withdrawal row is written). Reads the
 * consent history on the primary; a user with no grant before the latest withdrawal is not erased and
 * nothing is written for them (G3). Otherwise the erasure is recorded as owed
 * (`User.healthErasurePendingAt`) before its first step and cleared only when every step ran; a
 * failure leaves it for the daily sweep (F1). A history that cannot be read is recorded as owed too,
 * and the sweep decides. Throws on a partial failure; returns { status: 'purged' | 'skipped', counts }.
 */
async function eraseSessionHealthOnWithdrawal(userId) {
  const id = toObjectId(userId);
  if (!id) return { status: 'skipped', counts: zeroCounts() };
  const startedAt = new Date();
  const failedSteps = [];

  let windows;
  try {
    windows = windowsFor(await readHistory(id), startedAt);
  } catch (e) {
    await markPending(id, startedAt, failedSteps);
    throw incomplete(zeroCounts(), [`history:${errorType(e)}`, ...failedSteps]);
  }
  if (!windows) return { status: 'skipped', counts: zeroCounts() };
  await markPending(id, startedAt, failedSteps);

  let counts;
  try {
    counts = await eraseSessionHealth(id, windows, { purgeRedis: true });
  } catch (e) {
    throw incomplete(e.counts ?? zeroCounts(), [...failedSteps, ...(e.failedSteps ?? [`steps:${errorType(e)}`])]);
  }
  await clearPending(id, startedAt);
  return { status: 'purged', counts };
}

/**
 * R-A (the race with a generation already running): undo exactly ONE run's writes — its session by
 * `_id`, its serve batch by `servedAt`, and its band-named cache keys — never anything else of the
 * user's. Called by the live lane after all of a run's writes have settled, when the run was shaped by
 * health data and consent is no longer current (or could not be read).
 *   stripActivity: the run started with a heart rate, so its stored activity is not provably a chip.
 * Returns { changed } (rows changed plus keys deleted). A store failure propagates to the caller.
 */
async function undoRunWrites({ userId, sessionId = null, servedAt = null, moodKey = null, stripActivity = false } = {}) {
  const id = toObjectId(userId);
  if (!id) return { changed: 0 };
  let changed = 0;

  const sid = toObjectId(sessionId);
  if (sid) {
    const mine = { _id: sid, userId: id };
    const heart = await PlaylistSession.updateOne({ ...mine, moodKey: BIO_KEY_WITH_BAND }, { $set: fresh(HEART_SESSION_SET) });
    const withHr = await PlaylistSession.updateOne({ ...mine, 'biometricSnapshot.heartRate': { $ne: null } }, { $set: fresh(HEART_RATE_SET) });
    // Matched only while something is left to clear: the schema stamps updatedAt on every matched
    // row, so an unconditional match would report a change that removed nothing.
    const left = [{ targetBpm: { $ne: null } }, { targetEnergy: { $ne: null } }, { targetValence: { $ne: null } }];
    if (stripActivity) left.push({ 'biometricSnapshot.activity': { $ne: null } });
    const rest = await PlaylistSession.updateOne({ ...mine, $or: left }, {
      $set: { ...fresh(TARGETS_CLEARED), ...(stripActivity ? { 'biometricSnapshot.activity': null } : {}) },
    });
    if ((heart?.modifiedCount ?? 0) + (withHr?.modifiedCount ?? 0) + (rest?.modifiedCount ?? 0) > 0) changed += 1;
  }

  if (servedAt instanceof Date && Number.isFinite(servedAt.getTime())) {
    const batch = { userId: id, servedAt };
    const bio = await ServeEvent.updateMany({ ...batch, moodKey: SERVE_BIO_KEY }, { $set: fresh(SERVE_BIO_SET) });
    const band = await ServeEvent.updateMany(
      { ...batch, $or: [{ 'bioState.tempoBand': { $ne: null } }, { 'bioState.activity': { $ne: null } }] },
      { $set: fresh(SERVE_BAND_SET) },
    );
    changed += (bio?.modifiedCount ?? 0) + (band?.modifiedCount ?? 0);
  }

  if (typeof moodKey === 'string' && BIO_KEY_WITH_BAND.test(moodKey)) {
    // The keys this run's band names: the live buffer (shadowBufferRepo), the candidate pool
    // (candidatePool) and the per-mood ledger window (serveLedger). Pinned against those writers in
    // tests/sessionHealthRace.integration.test.js.
    const keys = [`buffer:${id}:${moodKey}`, `pool:${id}:${moodKey}`, `ledger:${id}:mood:${moodKey}`];
    const redis = getRedis();
    if (redis) changed += await redis.del(...keys);
    else if (process.env.REDIS_URL) throw new Error('Redis is configured but unavailable');
  }
  return { changed };
}

module.exports = {
  eraseSessionHealth,
  eraseSessionHealthOnWithdrawal,
  undoRunWrites,
  readHistory,
  toObjectId,
  errorType,
};
