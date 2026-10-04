'use strict';

const baselinesService = require('../services/biosonic/baselines');
const MedicalProfile = require('../models/MedicalProfile');
const { upsertStateVector } = require('../services/medicalProfileService');
const { resolveAffect, resolveHourContext } = require('../services/biosonic/affectService');
const { readNightHistory } = require('../repositories/sleepHistoryRepo');
const { healthWriteFence } = require('../services/privacy/healthWriteFence');
const { getRedis } = require('../config/redis');
const { USER_KEY_NAMESPACES } = require('../utils/userRedisPurge');
const { STATE_JOB_RESULT } = require('../queues/stateVectorJob');

// BullMQ processor for state-vector-recompute {userId}: refresh the 30-day
// personal baselines (fresh compute + encrypted cache) and re-derive the
// physiological state vector from the profile.
//
// ZERO-KNOWLEDGE BOUNDARY: all decryption happens inside this worker call
// (baselines paging + the profile read). The returned job summary carries no
// biometric values — only bookkeeping.
//
// J2 (BE-087; DT-4 A1, DT-5 W-c) — only for an account that still exists and holds a CURRENT health-data
// grant, and nothing of a run outlives a deletion or a withdrawal made while it ran:
//   • START GATE, before any read or decrypt (healthConsentGate.healthWriteFence). Refused: nothing is read
//     or written. Refused because the account is GONE (`user_missing`, definitive: the User doc is deleted
//     last): the profile and the two keys are removed too, since an earlier run killed after its writes and
//     re-run by BullMQ's stalled check leaves exactly those.
//   • The writes: `bio:baseline:`, the profile's zones (update-only), `bio:affect:` (AWAITED on this lane,
//     so nothing lands after the check below) and the profile's state vector (upsert).
//   • FENCED RE-CHECK, on the success path and on the throw path: the same gate again. Account gone: the
//     whole profile and both keys. Any other refusal, or a different latest consent row than at the start
//     (`consent_changed`, a withdraw-then-re-grant): both keys, and the profile if this run created it,
//     else only this run's state vector (zones it estimated stay on a profile that existed before it ran).
//   • One closed-token line per undo, never a user id or a job id. A failure is rethrown with its type only.
// A server stopped between the writes and the re-check leaves what was written: the daily sweep of deleted
// accounts' data removes it for a deleted account (BE-094); after a withdrawal it stays (declared).

// An error's class name, or 'Error': never its message (a driver message can quote values).
const errorType = (e) => (typeof e?.name === 'string' && /^[A-Za-z][A-Za-z0-9]*$/.test(e.name) ? e.name : 'Error');

// The two keys a run writes, from the registry erasure uses (one definition of their names).
const RUN_KEYS = USER_KEY_NAMESPACES.filter((ns) => ns.name === 'bio-baseline' || ns.name === 'bio-affect');

async function deleteRunKeys(userId) {
  const redis = getRedis();
  if (!redis) return 0;
  return redis.del(...RUN_KEYS.map((ns) => ns.pattern(String(userId))));
}

/** The account is gone: everything this job ever writes for it. */
async function undoMissingAccount(userId) {
  const profiles = await MedicalProfile.deleteMany({ userId });
  return (profiles?.deletedCount ?? 0) + await deleteRunKeys(userId);
}

/** Any other refusal: this run's writes only. */
async function undoRun(userId, run) {
  let changed = await deleteRunKeys(userId);
  const created = await MedicalProfile.deleteOne({ userId, createdAt: { $gte: run.startedAt } });
  changed += created?.deletedCount ?? 0;
  if (!created?.deletedCount && run.stateComputedAt) {
    const own = await MedicalProfile.updateOne(
      { userId, 'stateVector.computedAt': run.stateComputedAt },
      { $unset: { stateVector: '' } },
    );
    changed += own?.modifiedCount ?? 0;
  }
  return changed;
}

/** Runs the undo for `reason` and logs its one line. Never throws. */
async function compensate(userId, reason, run) {
  let outcome;
  try {
    const changed = reason === 'user_missing' ? await undoMissingAccount(userId) : await undoRun(userId, run);
    outcome = changed > 0 ? 'undone' : 'nothing';
  } catch (e) {
    outcome = `failed error=${errorType(e)}`;
  }
  const line = `[stateVector] compensating-undo reason=${reason} outcome=${outcome}`;
  if (outcome.startsWith('failed')) console.error(line);
  else console.warn(line);
}

async function refresh(userId, run) {
  const stats = await baselinesService.computeBaselines(userId);
  await baselinesService.cacheBaselines(userId, stats);
  // W4-004: the engine also derives HRmax + Karvonen zones (§M.7). Persisting them onto the
  // (previously dormant) MedicalProfile fields keeps the stored profile consistent with the
  // physiology the engine reasons with. Decoration only — the baselines are already cached above,
  // so a failure here must never cost the user their refresh. Guarded at the CALL as well as
  // inside, because "the callee catches" is a property that quietly stops being true.
  await baselinesService.persistDerivedProfile(userId, stats).catch(() => {});

  const profile = await MedicalProfile.findOne({ userId }); // getters decrypt here only
  const telemetry = profile ? (typeof profile.toObject === 'function' ? profile.toObject() : profile) : {};

  // W4-006 (seam half): advance the affect posterior on the nightly lane too.
  //
  // This is the ONLY thing keeping the temporal layer alive for a user who has not generated a
  // playlist today — without it their posterior would expire, and every state would be a cold
  // start the next time they pressed play. It also puts the taxonomy label into storage, which is
  // what `pulseController` (and later W4-012's MorningState) reads.
  //
  // The evidence is deliberately THIN: no `live` reading exists on this lane, so every HR-derived
  // axis abstains and the resulting state is a passive one. That is the honest answer — fabricating
  // a heart rate here to get a confident label would be the exact failure D3 and the affect
  // engine's mass mechanism exist to prevent.
  //
  // Best-effort at the CALL as well as inside, on the W4-004 precedent: "the callee catches" is a
  // property that quietly stops being true, and a failure here must never cost the refresh above.
  const now = Date.now();
  // Best-effort, like everything else on this lane: a history that will not read costs the
  // fatigue axis its debt term, never the baseline refresh above.
  const nightHistory = await readNightHistory(userId).catch(() => []);
  const affect = await resolveAffect({
    userId,
    live: {},
    baselines: stats,
    state: {
      hrv: telemetry.hrv,
      bodyBattery: telemetry.bodyBattery,
      dailyReadiness: telemetry.dailyReadiness,
    },
    // W4-D68: the nightly lane gets the SAME sleep evidence the serving lane now gets. This is
    // the one lane with no live reading at all, so the slow axes are most of what it can honestly
    // say — and `fatigue`'s dominant term was abstaining here too, for want of a read.
    sleep: {
      ...(telemetry.lastNightSleep ? { lastNight: telemetry.lastNightSleep } : {}),
      ...(nightHistory.length > 0 ? { history: nightHistory } : {}),
    },
    tzOffsetMinutes: resolveHourContext(now, stats).tzOffsetMinutes,
    now,
    persist: 'await', // J2: nothing of this run may land after the re-check below
  }).catch(() => null);

  const written = await upsertStateVector(userId, telemetry, { affect: affect ?? null });
  run.stateComputedAt = written?.stateVector?.computedAt ?? null;
}

async function process(job) {
  const userId = job?.data?.userId;
  if (!userId) return STATE_JOB_RESULT;

  const start = await healthWriteFence(userId);
  if (!start.admitted) {
    if (start.reason === 'user_missing') await compensate(userId, 'user_missing');
    return STATE_JOB_RESULT;
  }

  const run = { startedAt: new Date(), stateComputedAt: null };
  let failure = null;
  try {
    await refresh(userId, run);
  } catch (err) {
    failure = err;
  }

  const after = await healthWriteFence(userId);
  let reason = null;
  if (!after.admitted) reason = after.reason;
  else if (after.fence !== start.fence) reason = 'consent_changed';
  if (reason) await compensate(userId, reason, run);

  // F-a: the type only. The job's failed reason goes into the queue's event log, and a driver message
  // (a CastError, a duplicate key) can quote the user id.
  if (failure) throw new Error(`state-vector recompute failed (${errorType(failure)})`);
  // The summary stays bookkeeping-only and the same for every job (DT-2): a state label is internal
  // vocabulary, and a result that varied would record what the job found next to its pseudonym.
  return STATE_JOB_RESULT;
}

module.exports = { process, STATE_JOB_RESULT };
