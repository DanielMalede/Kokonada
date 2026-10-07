'use strict';

const HealthSample = require('../../models/HealthSample');
const MedicalProfile = require('../../models/MedicalProfile');
const User = require('../../models/User');
const { getRedis } = require('../../config/redis');
const { enqueue } = require('../../queues/queue');
const { QUEUES } = require('../../queues/definitions');
const { stateVectorJobOptions } = require('../../queues/stateVectorJob');
const { affectKey } = require('../biosonic/affectCache');
const { healthWriteFence } = require('../privacy/healthWriteFence');
const { projectTimeSeriesSample, removeTimeSeriesProjection } = require('./healthSampleProjection');

const SLEEP_STAGE = Object.freeze({
  sleep_deep: 'deep',
  sleep_light: 'light',
  sleep_rem: 'rem',
});
const SLEEP_METRICS = Object.freeze(Object.keys(SLEEP_STAGE));

const baselineKey = (userId) => `bio:baseline:${userId}`;
const PROFILE_PATHS = Object.freeze([
  'healthProjectionProvider',
  'restingHeartRate',
  'sleepStages.deep',
  'sleepStages.light',
  'sleepStages.rem',
  'lastNightSleep.deep',
  'lastNightSleep.light',
  'lastNightSleep.rem',
  'lastNightSleep.date',
  'sleepUpdatedAt',
]);

const errorType = (error) => (
  typeof error?.name === 'string' && /^[A-Za-z][A-Za-z0-9]*$/.test(error.name)
    ? error.name
    : 'Error'
);

async function projectionFence(userId, source) {
  const consent = await healthWriteFence(userId);
  if (!consent.admitted) return consent;

  let account;
  try {
    account = await User.findById(userId).select('wearableProvider deletedAt').read('primary').lean();
  } catch {
    return { admitted: false, reason: 'consent_read_error', fence: null };
  }
  if (!account) return { admitted: false, reason: 'user_missing', fence: null };
  if (account.deletedAt != null) return { admitted: false, reason: 'user_flagged', fence: null };
  if (account.wearableProvider !== source) {
    return { admitted: false, reason: 'provider_not_current', fence: null };
  }
  return consent;
}

function profileSnapshot(profile) {
  const snapshot = {};
  for (const path of PROFILE_PATHS) snapshot[path] = profile.get(path) ?? null;
  return snapshot;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Rebuild sleep from authoritative intervals. HealthKit stage samples are intervals, so their
 * duration is derived from the dates rather than trusting a client-supplied aggregate value.
 */
function summarizeSleepIntervals(samples) {
  const nights = new Map();
  let latestEndMs = null;

  for (const sample of Array.isArray(samples) ? samples : []) {
    const stage = SLEEP_STAGE[sample?.metric];
    if (!stage) continue;
    const startMs = new Date(sample.startAt).getTime();
    const endMs = new Date(sample.endAt).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;

    const night = new Date(endMs).toISOString().slice(0, 10);
    const bucket = nights.get(night) ?? { deep: 0, light: 0, rem: 0 };
    bucket[stage] += (endMs - startMs) / 60000;
    nights.set(night, bucket);
    latestEndMs = latestEndMs == null ? endMs : Math.max(latestEndMs, endMs);
  }

  if (!nights.size) return null;
  const ordered = [...nights.entries()].sort(([left], [right]) => left.localeCompare(right));
  const [latestDate, latestTotals] = ordered[ordered.length - 1];
  const rounded = (value) => Math.round(value);

  return {
    sleepStages: {
      deep: rounded(median(ordered.map(([, totals]) => totals.deep))),
      light: rounded(median(ordered.map(([, totals]) => totals.light))),
      rem: rounded(median(ordered.map(([, totals]) => totals.rem))),
    },
    lastNightSleep: {
      deep: rounded(latestTotals.deep),
      light: rounded(latestTotals.light),
      rem: rounded(latestTotals.rem),
      date: new Date(latestDate),
    },
    sleepUpdatedAt: new Date(latestEndMs),
  };
}

async function findRows(query) {
  return HealthSample.find(query).sort({ endAt: 1, _id: 1 });
}

async function rebuildAppleProfile(userId, source, run) {
  if (source !== 'apple_health') return false;

  const user = await User.findById(userId).select('wearableProvider').lean();
  if (user?.wearableProvider !== 'apple_health') return false;

  const [sleepRows, restingRows, existing] = await Promise.all([
    findRows({ userId, source, state: 'active', metric: { $in: SLEEP_METRICS } }),
    findRows({ userId, source, state: 'active', metric: 'resting_heart_rate' }),
    MedicalProfile.findOne({ userId }),
  ]);
  const summary = summarizeSleepIntervals(sleepRows);
  const restingValues = restingRows.map((row) => Number(row.value)).filter(Number.isFinite);
  const ownsExistingProjection = existing?.healthProjectionProvider === source;

  // A heart-rate-only upload has no MedicalProfile projection. Do not claim provenance merely
  // because Apple is active; only a supported profile value or a previously-owned projection
  // gives this service permission to write these fields.
  if (!summary && !restingValues.length && !ownsExistingProjection) return false;

  const $set = { healthProjectionProvider: source };
  if (summary) {
    $set['sleepStages.deep'] = summary.sleepStages.deep;
    $set['sleepStages.light'] = summary.sleepStages.light;
    $set['sleepStages.rem'] = summary.sleepStages.rem;
    $set['lastNightSleep.deep'] = summary.lastNightSleep.deep;
    $set['lastNightSleep.light'] = summary.lastNightSleep.light;
    $set['lastNightSleep.rem'] = summary.lastNightSleep.rem;
    $set['lastNightSleep.date'] = summary.lastNightSleep.date;
    $set.sleepUpdatedAt = summary.sleepUpdatedAt;
  } else if (ownsExistingProjection) {
    for (const path of [
      'sleepStages.deep', 'sleepStages.light', 'sleepStages.rem',
      'lastNightSleep.deep', 'lastNightSleep.light', 'lastNightSleep.rem',
      'lastNightSleep.date', 'sleepUpdatedAt',
    ]) $set[path] = null;
  }

  if (restingValues.length) $set.restingHeartRate = Math.round(median(restingValues));
  else if (ownsExistingProjection) $set.restingHeartRate = null;

  // Deliberately no `hrv` write: Apple HealthKit HRV is SDNN, while this legacy scalar has
  // RMSSD-oriented meaning. Task 4 preserves SDNN in VitalSample and the method-aware baseline.
  const written = await MedicalProfile.findOneAndUpdate(
    { userId },
    { $set },
    { upsert: true, returnDocument: 'after' },
  );
  run.profileWrite = {
    id: written._id,
    updatedAt: written.updatedAt,
    before: existing ? profileSnapshot(existing) : null,
  };
  return true;
}

async function undoRunProjections(userId, source, run) {
  let changed = 0;
  for (const sampleKey of run.createdSampleKeys) {
    changed += await removeTimeSeriesProjection(sampleKey, userId);
  }

  if (run.profileWrite) {
    const selector = {
      _id: run.profileWrite.id,
      userId,
      healthProjectionProvider: source,
      updatedAt: run.profileWrite.updatedAt,
    };
    if (run.profileWrite.before == null) {
      const removed = await MedicalProfile.deleteOne(selector);
      changed += removed?.deletedCount ?? 0;
    } else {
      const restored = await MedicalProfile.updateOne(
        selector,
        { $set: run.profileWrite.before },
      );
      changed += restored?.modifiedCount ?? 0;
    }
  }
  return changed;
}

async function compensate(userId, source, reason, run) {
  let outcome;
  try {
    const changed = await undoRunProjections(userId, source, run);
    outcome = changed > 0 ? 'undone' : 'nothing';
  } catch (error) {
    outcome = `failed error=${errorType(error)}`;
  }
  const line = `[healthProjection] compensating-undo reason=${reason} outcome=${outcome}`;
  if (outcome.startsWith('failed')) console.error(line);
  else console.warn(line);
}

async function invalidateDerivedCaches(userId) {
  const redis = getRedis();
  if (!redis) return;
  await redis.del(baselineKey(userId), affectKey(userId));
}

async function enqueueStateRecompute(userId) {
  const queued = await enqueue(
    QUEUES.STATE_VECTOR_RECOMPUTE,
    { userId },
    stateVectorJobOptions(userId, 60_000)
  );
  if (queued?.queued === false) {
    const error = Object.assign(new Error('health_projection_pending'), {
      code: 'health_projection_pending',
      statusCode: 503,
    });
    throw error;
  }
}

async function reconcileHealthSamples(userId, source) {
  const start = await projectionFence(userId, source);
  if (!start.admitted) return { projected: 0, removed: 0, profileUpdated: false };

  // This cut makes the final update race-safe: an upsert/delete that changes a row during this
  // pass receives a newer updatedAt and remains pending for the next pass.
  const cutoff = new Date();
  const pending = await HealthSample.find({
    userId,
    source,
    projectionState: 'pending',
    updatedAt: { $lte: cutoff },
  }).sort({ updatedAt: 1, _id: 1 });

  if (!pending.length) return { projected: 0, removed: 0, profileUpdated: false };

  const run = { createdSampleKeys: [], profileWrite: null };
  let projected = 0;
  let removed = 0;
  let profileUpdated = false;
  let failure = null;
  try {
    for (const sample of pending) {
      const result = await projectTimeSeriesSample(sample);
      projected += result.inserted;
      removed += result.removed;
      if (result.inserted > 0) run.createdSampleKeys.push(sample.sampleKey);
    }
    profileUpdated = await rebuildAppleProfile(userId, source, run);
  } catch (error) {
    failure = error;
  }

  const after = await projectionFence(userId, source);
  let refusal = null;
  if (!after.admitted) refusal = after.reason;
  else if (after.fence !== start.fence) refusal = 'consent_changed';
  if (refusal) await compensate(userId, source, refusal, run);
  if (failure) throw failure;
  if (refusal) return { projected: 0, removed: 0, profileUpdated: false };

  await invalidateDerivedCaches(userId);
  await enqueueStateRecompute(userId);

  await HealthSample.updateMany({
    _id: { $in: pending.map((sample) => sample._id) },
    projectionState: 'pending',
    updatedAt: { $lte: cutoff },
  }, { $set: { projectionState: 'applied' } });

  return { projected, removed, profileUpdated };
}

module.exports = {
  reconcileHealthSamples,
  summarizeSleepIntervals,
};
