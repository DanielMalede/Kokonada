'use strict';

const crypto = require('crypto');
const HealthSample = require('../../models/HealthSample');
const MedicalProfile = require('../../models/MedicalProfile');
const User = require('../../models/User');
const { getRedis } = require('../../config/redis');
const { enqueue } = require('../../queues/queue');
const { QUEUES } = require('../../queues/definitions');
const { stateVectorJobOptions } = require('../../queues/stateVectorJob');
const { affectKey } = require('../biosonic/affectCache');
const { healthWriteFence } = require('../privacy/healthWriteFence');
const { purgeOrphanedAggregates } = require('../privacy/wearableErasure');
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
  'healthProjectionConnectionVersion',
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
const PROFILE_CLEAR = Object.freeze(Object.fromEntries(PROFILE_PATHS.map((path) => [path, null])));

const errorType = (error) => (
  typeof error?.name === 'string' && /^[A-Za-z][A-Za-z0-9]*$/.test(error.name)
    ? error.name
    : 'Error'
);

async function projectionFence(userId, source, expectedConnectionVersion = null) {
  const consent = await healthWriteFence(userId);
  if (!consent.admitted) return consent;

  let account;
  try {
    account = await User.findById(userId)
      .select('wearableProvider wearableConnectionVersion deletedAt')
      .read('primary')
      .lean();
  } catch {
    return { admitted: false, reason: 'consent_read_error', fence: null };
  }
  if (!account) return { admitted: false, reason: 'user_missing', fence: null };
  if (account.deletedAt != null) return { admitted: false, reason: 'user_flagged', fence: null };
  if (account.wearableProvider !== source) {
    return { admitted: false, reason: 'provider_not_current', fence: null };
  }
  const connectionVersion = Number(account.wearableConnectionVersion ?? 0);
  if (expectedConnectionVersion != null
    && connectionVersion !== Number(expectedConnectionVersion)) {
    return { admitted: false, reason: 'connection_changed', fence: null };
  }
  return { ...consent, connectionVersion };
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
  return HealthSample.find({ ...query, ingestState: { $ne: 'staged' } })
    .sort({ endAt: 1, _id: 1 });
}

async function rebuildAppleProfile(userId, source, connectionVersion, run) {
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

  const $set = {
    healthProjectionProvider: source,
    healthProjectionConnectionVersion: Number(connectionVersion ?? 0),
  };
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
    createdWithoutPriorProfile: existing == null,
  };
  return true;
}

async function undoRunProjections(userId, source, reason, run) {
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
    if (run.profileWrite.createdWithoutPriorProfile
      || reason === 'user_missing'
      || reason === 'user_flagged') {
      const removed = await MedicalProfile.deleteOne(selector);
      changed += removed?.deletedCount ?? 0;
    } else {
      const cleared = await MedicalProfile.updateOne(
        selector,
        { $set: PROFILE_CLEAR },
      );
      changed += cleared?.modifiedCount ?? 0;
      if ((cleared?.modifiedCount ?? 0) > 0) {
        const purged = await purgeOrphanedAggregates(userId);
        changed += purged?.medicalProfiles ?? 0;
      }
    }
  }
  return changed;
}

async function compensate(userId, source, reason, run) {
  try {
    const changed = await undoRunProjections(userId, source, reason, run);
    const outcome = changed > 0 ? 'undone' : 'nothing';
    console.warn(`[healthProjection] compensating-undo reason=${reason} outcome=${outcome}`);
  } catch (error) {
    console.error(`[healthProjection] compensating-undo reason=${reason} outcome=failed error=${errorType(error)}`);
    throw Object.assign(new Error('health_projection_pending'), {
      code: 'health_projection_pending',
      statusCode: 503,
    });
  }
}

async function cleanupRefusedPending(userId, source, connectionVersion) {
  const selector = {
    userId,
    source,
    projectionState: 'pending',
    ingestState: { $ne: 'staged' },
    ...(connectionVersion == null ? {} : { connectionVersion: Number(connectionVersion) }),
  };
  const pending = await HealthSample.find(selector).select('_id sampleKey');
  for (const sample of pending) await removeTimeSeriesProjection(sample.sampleKey, userId);

  const profileSelector = {
    userId,
    healthProjectionProvider: source,
    ...(connectionVersion == null
      ? {}
      : { healthProjectionConnectionVersion: Number(connectionVersion) }),
  };
  const clearedProfile = await MedicalProfile.updateOne(profileSelector, { $set: PROFILE_CLEAR });
  await HealthSample.deleteMany({
    _id: { $in: pending.map((sample) => sample._id) },
    projectionState: 'pending',
  });
  if ((clearedProfile?.modifiedCount ?? 0) > 0) await purgeOrphanedAggregates(userId);
}

async function recordCleanupMarker(userId, source, connectionVersion, consentFence, sampleKeys) {
  const token = crypto.randomBytes(16).toString('hex');
  const result = await User.updateOne({
    _id: userId,
    wearableProvider: source,
    wearableConnectionVersion: Number(connectionVersion ?? 0),
    deletedAt: null,
  }, {
    $push: {
      healthProjectionCleanupPending: {
        token,
        provider: source,
        connectionVersion: Number(connectionVersion ?? 0),
        consentFence: String(consentFence),
        sampleKeys,
        createdAt: new Date(),
      },
    },
  });
  if ((result?.modifiedCount ?? 0) !== 1) {
    throw Object.assign(new Error('health_projection_pending'), {
      code: 'health_projection_pending',
      statusCode: 503,
    });
  }
  return token;
}

async function clearCleanupMarkers(userId, selector) {
  await User.updateOne(
    { _id: userId },
    { $pull: { healthProjectionCleanupPending: selector } },
  );
}

async function cleanupMarker(userId, marker) {
  for (const sampleKey of marker.sampleKeys ?? []) {
    const newer = await HealthSample.exists({
      userId,
      source: marker.provider,
      sampleKey,
      ingestState: { $ne: 'staged' },
      connectionVersion: { $gt: Number(marker.connectionVersion ?? 0) },
    });
    if (!newer) await removeTimeSeriesProjection(sampleKey, userId);
  }
  const clearedProfile = await MedicalProfile.updateOne({
    userId,
    healthProjectionProvider: marker.provider,
    healthProjectionConnectionVersion: Number(marker.connectionVersion ?? 0),
  }, { $set: PROFILE_CLEAR });
  await clearCleanupMarkers(userId, { token: marker.token });
  if ((clearedProfile?.modifiedCount ?? 0) > 0) await purgeOrphanedAggregates(userId);
}

async function recoverOwedHealthProjectionCleanups({ limit = 100 } = {}) {
  const users = await User.find({ 'healthProjectionCleanupPending.0': { $exists: true } })
    .select('_id healthProjectionCleanupPending')
    .limit(limit)
    .lean();
  let cleaned = 0;
  let deferred = 0;
  let failed = 0;
  for (const user of users) {
    for (const marker of user.healthProjectionCleanupPending ?? []) {
      try {
        const fence = await projectionFence(user._id, marker.provider, marker.connectionVersion);
        if (fence.admitted && fence.fence === marker.consentFence) {
          deferred += 1;
          continue;
        }
        if (fence.reason === 'consent_read_error') {
          deferred += 1;
          continue;
        }
        await cleanupMarker(user._id, marker);
        cleaned += 1;
      } catch {
        failed += 1;
      }
    }
  }
  return { cleaned, deferred, failed };
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

async function reconcileHealthSamples(userId, source, { connectionVersion = null } = {}) {
  const start = await projectionFence(userId, source, connectionVersion);
  if (!start.admitted) {
    if (start.reason !== 'consent_read_error') {
      await cleanupRefusedPending(userId, source, connectionVersion);
    }
    return { projected: 0, removed: 0, profileUpdated: false };
  }

  // This cut makes the final update race-safe: an upsert/delete that changes a row during this
  // pass receives a newer updatedAt and remains pending for the next pass.
  const cutoff = new Date();
  const pending = await HealthSample.find({
    userId,
    source,
    projectionState: 'pending',
    ingestState: { $ne: 'staged' },
    ...(connectionVersion == null ? {} : { connectionVersion: Number(connectionVersion) }),
    updatedAt: { $lte: cutoff },
  }).sort({ updatedAt: 1, _id: 1 });

  if (!pending.length) return { projected: 0, removed: 0, profileUpdated: false };

  const cleanupToken = await recordCleanupMarker(
    userId,
    source,
    start.connectionVersion,
    start.fence,
    pending.map((sample) => sample.sampleKey),
  );
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
    profileUpdated = await rebuildAppleProfile(userId, source, start.connectionVersion, run);
  } catch (error) {
    failure = error;
  }

  const after = await projectionFence(userId, source, connectionVersion);
  let refusal = null;
  if (!after.admitted) refusal = after.reason;
  else if (after.fence !== start.fence) refusal = 'consent_changed';
  else if (after.connectionVersion !== start.connectionVersion) refusal = 'connection_changed';
  if (refusal) {
    await compensate(userId, source, refusal, run);
    await cleanupRefusedPending(userId, source, start.connectionVersion);
    await clearCleanupMarkers(userId, { token: cleanupToken });
  }
  if (failure) throw failure;
  if (refusal) return { projected: 0, removed: 0, profileUpdated: false };

  await invalidateDerivedCaches(userId);
  await enqueueStateRecompute(userId);

  await HealthSample.updateMany({
    _id: { $in: pending.map((sample) => sample._id) },
    projectionState: 'pending',
    updatedAt: { $lte: cutoff },
  }, { $set: { projectionState: 'applied' } });

  await clearCleanupMarkers(userId, {
    provider: source,
    connectionVersion: Number(start.connectionVersion ?? 0),
    consentFence: String(start.fence),
  });

  return { projected, removed, profileUpdated };
}

module.exports = {
  recoverOwedHealthProjectionCleanups,
  reconcileHealthSamples,
  summarizeSleepIntervals,
};
