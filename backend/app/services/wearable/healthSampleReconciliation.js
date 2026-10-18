'use strict';

const BiometricLog = require('../../models/BiometricLog');
const HealthSample = require('../../models/HealthSample');
const MedicalProfile = require('../../models/MedicalProfile');
const User = require('../../models/User');
const VitalSample = require('../../models/VitalSample');
const { getRedis } = require('../../config/redis');
const { enqueue } = require('../../queues/queue');
const { QUEUES } = require('../../queues/definitions');
const { stateVectorJobOptions } = require('../../queues/stateVectorJob');
const { affectKey } = require('../biosonic/affectCache');
const { healthWriteFence } = require('../privacy/healthWriteFence');
const { purgeOrphanedAggregates } = require('../privacy/wearableErasure');
const { projectTimeSeriesSample, removeTimeSeriesProjection } = require('./healthSampleProjection');
const {
  HealthProjectionCleanup,
  MAX_BATCH_LEASE_MS,
  MAX_PROJECTION_SAMPLE_KEYS,
  projectionCleanupId,
} = require('./healthOperationJournal');

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
  //
  // A profile this pass READ is updated by its `_id` and never upserted (BE-144): when an erasure
  // deletes it while this write is in flight, the write matches nothing and the profile stays
  // deleted. Only a first projection, with no profile at all, may insert one, and the run's
  // compensation removes that one when a fence refuses. `userId` stays in the filter because the
  // encrypted fields take their owner binding (AAD) from it (encryptedField.js `_queryAad`).
  const written = await MedicalProfile.findOneAndUpdate(
    existing ? { _id: existing._id, userId } : { userId },
    { $set },
    { upsert: existing == null, returnDocument: 'after' },
  );
  if (!written) return false; // read, then erased: never re-create it
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

// RA-1 (the resilience audit of #256). A projection that commits after an erasure deleted the
// provider's samples and before it counted what remains is seen by that count, so MedicalProfile
// and MorningState survive the erasure. Once the refusal has undone the projection, the erasure's
// own rule runs again, so the two never disagree about what an erasure leaves; the live lane does
// the same (sockets/biometricHandler.js, _compensateIfConsentLapsed). The rule deletes only when no
// sample of any provider remains. A failure is retryable, as a failed compensation is.
async function reapplyOrphanRule(userId, reason) {
  try {
    await purgeOrphanedAggregates(userId);
  } catch (error) {
    console.error(`[healthProjection] orphan-rule reason=${reason} outcome=failed error=${errorType(error)}`);
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
  await MedicalProfile.updateOne(profileSelector, { $set: PROFILE_CLEAR });
  await HealthSample.deleteMany({
    _id: { $in: pending.map((sample) => sample._id) },
    projectionState: 'pending',
  });
}

async function recordCleanupMarker(userId, source, connectionVersion, consentFence, sampleKeys) {
  if (sampleKeys.length > MAX_PROJECTION_SAMPLE_KEYS) {
    throw Object.assign(new Error('health_projection_pending'), {
      code: 'health_projection_pending',
      statusCode: 503,
    });
  }
  const token = projectionCleanupId(userId, source, connectionVersion);
  try {
    await HealthProjectionCleanup.create({
      _id: token,
      userId,
      provider: source,
      connectionVersion: Number(connectionVersion ?? 0),
      consentFence: String(consentFence),
      status: 'projecting',
      leaseUntil: new Date(Date.now() + MAX_BATCH_LEASE_MS),
      sampleKeys,
      createdAt: new Date(),
    });
  } catch (error) {
    // One fixed obligation per user/provider/generation bounds the journal and prevents another
    // projection pass from running while an earlier cleanup is still owed.
    if (error?.code !== 11000) throw error;
    throw Object.assign(new Error('health_projection_pending'), {
      code: 'health_projection_pending',
      statusCode: 503,
    });
  }
  return token;
}

async function clearCleanupMarkers(userId, selector) {
  await HealthProjectionCleanup.deleteMany({ userId, ...selector });
}

async function renewProjectionLease(token) {
  const owned = await HealthProjectionCleanup.updateOne(
    { _id: token, status: 'projecting' },
    { $set: { leaseUntil: new Date(Date.now() + MAX_BATCH_LEASE_MS) } },
  );
  if ((owned?.matchedCount ?? 0) !== 1) {
    throw Object.assign(new Error('health_projection_pending'), {
      code: 'health_projection_pending',
      statusCode: 503,
    });
  }
}

async function cleanupMarker(userId, marker, { keepMarker = false } = {}) {
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
  await MedicalProfile.updateOne({
    userId,
    healthProjectionProvider: marker.provider,
    healthProjectionConnectionVersion: Number(marker.connectionVersion ?? 0),
  }, { $set: PROFILE_CLEAR });
  if (!keepMarker) await clearCleanupMarkers(userId, { _id: marker._id });
}

async function findProjectionsWithoutAuthority(Model, limit) {
  return Model.aggregate([
    { $match: { healthSampleKey: { $type: 'string' } } },
    {
      $lookup: {
        from: HealthSample.collection.name,
        let: {
          projectionUserId: '$userId',
          projectionSource: '$source',
          projectionSampleKey: '$healthSampleKey',
        },
        pipeline: [
          {
            $match: {
              state: 'active',
              ingestState: { $ne: 'staged' },
              $expr: {
                $and: [
                  { $eq: ['$userId', '$$projectionUserId'] },
                  { $eq: ['$source', '$$projectionSource'] },
                  { $eq: ['$sampleKey', '$$projectionSampleKey'] },
                ],
              },
            },
          },
          { $project: { _id: 1 } },
          { $limit: 1 },
        ],
        as: 'authoritativeRows',
      },
    },
    { $match: { authoritativeRows: { $eq: [] } } },
    { $project: { _id: 1 } },
    { $limit: limit },
  ]);
}

/**
 * A projection writer may be suspended inside Mongo longer than any lease. If it commits after
 * its cleanup marker was processed, the marker cannot lead recovery back to that row. The
 * authoritative HealthSample link is therefore the durable invariant: no linked time-series
 * projection may outlive its active, committed source row. MedicalProfile has no sample key, so
 * its explicit provider/generation provenance is checked against the live consent/provider fence.
 */
async function sweepOrphanedHealthProjections({ limit = 100 } = {}) {
  let removed = 0;
  for (const Model of [BiometricLog, VitalSample]) {
    const orphaned = await findProjectionsWithoutAuthority(Model, limit);
    if (!orphaned.length) continue;
    const result = await Model.deleteMany({ _id: { $in: orphaned.map((row) => row._id) } });
    removed += result?.deletedCount ?? 0;
  }

  const profiles = await MedicalProfile.find({ healthProjectionProvider: { $ne: null } })
    .select('_id userId healthProjectionProvider healthProjectionConnectionVersion')
    .limit(limit)
    .lean();
  for (const profile of profiles) {
    const fence = await projectionFence(
      profile.userId,
      profile.healthProjectionProvider,
      profile.healthProjectionConnectionVersion,
    );
    if (fence.reason === 'consent_read_error' || fence.admitted) continue;
    const result = await MedicalProfile.updateOne({
      _id: profile._id,
      healthProjectionProvider: profile.healthProjectionProvider,
      healthProjectionConnectionVersion: profile.healthProjectionConnectionVersion,
    }, { $set: PROFILE_CLEAR });
    removed += result?.modifiedCount ?? 0;
  }
  return removed;
}

async function recoverOwedHealthProjectionCleanups({ limit = 100 } = {}) {
  const markers = await HealthProjectionCleanup.find({})
    .limit(limit)
    .lean();
  let cleaned = 0;
  let deferred = 0;
  let failed = 0;
  for (const marker of markers) {
    try {
      const fence = await projectionFence(marker.userId, marker.provider, marker.connectionVersion);
      if (marker.status === 'projecting' && marker.leaseUntil > new Date()) {
        deferred += 1;
        continue;
      }
      if (marker.status === 'cleanup' && marker.leaseUntil > new Date()) {
        deferred += 1;
        continue;
      }
      if (marker.status !== 'cleanup' && fence.reason === 'consent_read_error') {
        deferred += 1;
        continue;
      }
      if (marker.status === 'projecting') {
        const claimed = await HealthProjectionCleanup.updateOne(
          { _id: marker._id, status: 'projecting', leaseUntil: { $lte: new Date() } },
          {
            $set: {
              status: 'cleanup',
              leaseUntil: new Date(Date.now() + MAX_BATCH_LEASE_MS),
            },
          },
        );
        if ((claimed?.modifiedCount ?? 0) !== 1) {
          deferred += 1;
          continue;
        }
        await cleanupMarker(marker.userId, marker, { keepMarker: true });
      } else {
        await cleanupMarker(marker.userId, marker);
      }
      cleaned += 1;
    } catch {
      failed += 1;
    }
  }
  try {
    await sweepOrphanedHealthProjections({ limit });
  } catch {
    // The next worker pass retries independently of journal presence. Keep the public result
    // values-free while making an operational failure visible to the worker/monitoring path.
    failed += 1;
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
  }).sort({ updatedAt: 1, _id: 1 }).limit(MAX_PROJECTION_SAMPLE_KEYS);

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
      await renewProjectionLease(cleanupToken);
      const result = await projectTimeSeriesSample(sample);
      await renewProjectionLease(cleanupToken);
      projected += result.inserted;
      removed += result.removed;
      if (result.inserted > 0) run.createdSampleKeys.push(sample.sampleKey);
    }
    await renewProjectionLease(cleanupToken);
    profileUpdated = await rebuildAppleProfile(userId, source, start.connectionVersion, run);
    await renewProjectionLease(cleanupToken);
  } catch (error) {
    failure = error;
  }

  const after = await projectionFence(userId, source, connectionVersion);
  let refusal = null;
  if (!after.admitted) refusal = after.reason;
  else if (after.fence !== start.fence) refusal = 'consent_changed';
  else if (after.connectionVersion !== start.connectionVersion) refusal = 'connection_changed';
  if (refusal) {
    await HealthProjectionCleanup.updateOne(
      { _id: cleanupToken },
      { $set: { status: 'cleanup', leaseUntil: new Date() } },
    );
    await compensate(userId, source, refusal, run);
    // RA-2: a fence that could not read says nothing about the grant, so the pending authoritative
    // rows stay for the next pass, as the start fence and both ingest fences keep them. The run's own
    // writes are undone above all the same (fail closed).
    if (refusal !== 'consent_read_error') {
      await cleanupRefusedPending(userId, source, start.connectionVersion);
    }
    await clearCleanupMarkers(userId, { _id: cleanupToken });
    // On every refusal, the unreadable fence included, and fail-safe either way: the rule removes
    // nothing while a sample of any provider remains, and on that reason the pending rows are kept,
    // so it deletes nothing unless every sample, those rows included, is already gone.
    await reapplyOrphanRule(userId, refusal);
  }
  if (failure) {
    await HealthProjectionCleanup.updateOne(
      { _id: cleanupToken },
      { $set: { status: 'cleanup', leaseUntil: new Date() } },
    );
    try {
      await cleanupMarker(userId, {
        _id: cleanupToken,
        provider: source,
        connectionVersion: start.connectionVersion,
        sampleKeys: pending.map((sample) => sample.sampleKey),
      });
    } catch {
      throw Object.assign(new Error('health_projection_pending'), {
        code: 'health_projection_pending',
        statusCode: 503,
      });
    }
    throw failure;
  }
  if (refusal === 'consent_read_error') {
    // Retryable: the batch answers 503, and the repair worker finds the rows still pending.
    throw Object.assign(new Error('health_projection_pending'), {
      code: 'health_projection_pending',
      statusCode: 503,
    });
  }
  if (refusal) return { projected: 0, removed: 0, profileUpdated: false };

  await invalidateDerivedCaches(userId);
  await enqueueStateRecompute(userId);

  await HealthSample.updateMany({
    _id: { $in: pending.map((sample) => sample._id) },
    projectionState: 'pending',
    updatedAt: { $lte: cutoff },
  }, { $set: { projectionState: 'applied' } });

  await clearCleanupMarkers(userId, {
    _id: cleanupToken,
  });

  return { projected, removed, profileUpdated };
}

module.exports = {
  recoverOwedHealthProjectionCleanups,
  reconcileHealthSamples,
  sweepOrphanedHealthProjections,
  summarizeSleepIntervals,
};
