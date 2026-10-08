'use strict';

const crypto = require('crypto');
const HealthSample = require('../../models/HealthSample');
const { applyHealthOperations } = require('./healthSampleRepository');
const { reconcileHealthSamples } = require('./healthSampleReconciliation');
const { removeTimeSeriesProjection } = require('./healthSampleProjection');
const { healthWriteFence } = require('../privacy/healthWriteFence');
const User = require('../../models/User');
const {
  HealthIngestBatch,
  MAX_BATCH_LEASE_MS,
} = require('./healthOperationJournal');

const STATUS_BY_CODE = Object.freeze({
  health_sample_identity_conflict: 409,
  health_sample_outside_retention: 422,
  health_projection_pending: 503,
  wearable_connection_changed: 409,
  health_consent_changed: 409,
});

function fixedError(code, statusCode) {
  return Object.assign(new Error(code), { code, statusCode });
}

async function ingestFence(userId, source, expectedConnectionVersion) {
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
  if (account.wearableProvider !== source
    || Number(account.wearableConnectionVersion ?? 0) !== Number(expectedConnectionVersion)) {
    return { admitted: false, reason: 'connection_changed', fence: null };
  }
  return { ...consent, connectionVersion: Number(account.wearableConnectionVersion ?? 0) };
}

async function removeStagedRows(selector) {
  const rows = await HealthSample.find({ ...selector, ingestState: 'staged' })
    .select('_id userId sampleKey ingestToken');
  for (const row of rows) await removeTimeSeriesProjection(row.sampleKey, row.userId);
  if (!rows.length) return 0;
  const ids = rows.map((row) => row._id);
  const removed = await HealthSample.deleteMany({
    _id: { $in: ids },
    ingestState: 'staged',
    ...(selector.ingestToken ? { ingestToken: selector.ingestToken } : {}),
  });
  return removed?.deletedCount ?? 0;
}

async function renewIngestLease(ingestToken) {
  const owned = await HealthIngestBatch.updateOne(
    { _id: ingestToken, status: 'writing' },
    { $set: { leaseUntil: new Date(Date.now() + MAX_BATCH_LEASE_MS) } },
  );
  if ((owned?.matchedCount ?? 0) !== 1) throw fixedError('health_projection_pending', 503);
}

async function removeOrphanedStagedRows({ userId = null, source = null, limit = 500 } = {}) {
  const query = { ingestState: 'staged' };
  if (userId != null) query.userId = userId;
  if (source != null) query.source = source;
  const rows = await HealthSample.find(query)
    .select('userId source ingestToken')
    .limit(limit)
    .lean();
  const tokens = [...new Set(rows.map((row) => row.ingestToken).filter(Boolean))];
  let removed = 0;
  for (const ingestToken of tokens) {
    if (await HealthIngestBatch.exists({ _id: ingestToken })) continue;
    removed += await removeStagedRows({
      ...(userId == null ? {} : { userId }),
      ...(source == null ? {} : { source }),
      ingestToken,
    });
  }
  return removed;
}

async function recoverStagedHealthSamples({ userId = null, source = null, limit = 500 } = {}) {
  const batchQuery = {};
  if (userId != null) batchQuery.userId = userId;
  if (source != null) batchQuery.source = source;
  const batches = await HealthIngestBatch.find(batchQuery)
    .limit(limit)
    .lean();

  let recovered = 0;
  let removed = 0;
  let failed = 0;
  const now = new Date();
  for (const batch of batches) {
    const selector = {
      userId: batch.userId,
      source: batch.source,
      connectionVersion: Number(batch.connectionVersion ?? 0),
      consentFence: batch.consentFence,
      ingestToken: batch._id,
    };
    try {
      let status = batch.status;
      if (status === 'writing' && batch.leaseUntil <= now) {
        const aborted = await HealthIngestBatch.updateOne(
          { _id: batch._id, status: 'writing', leaseUntil: { $lte: now } },
          { $set: { status: 'aborted' } },
        );
        if ((aborted?.modifiedCount ?? 0) === 1) status = 'aborted';
      }

      if (status === 'writing') continue;
      const fence = await ingestFence(batch.userId, batch.source, batch.connectionVersion ?? 0);
      if (status === 'complete' && fence.admitted && fence.fence === batch.consentFence) {
        const committed = await HealthSample.updateMany(
          { ...selector, ingestState: 'staged' },
          { $set: { ingestState: 'committed' }, $unset: { ingestToken: 1, consentFence: 1 } },
        );
        if ((committed?.modifiedCount ?? 0) > 0) {
          recovered += committed.modifiedCount;
          await reconcileHealthSamples(batch.userId, batch.source, {
            connectionVersion: Number(batch.connectionVersion ?? 0),
          });
        }
        await HealthIngestBatch.deleteOne({ _id: batch._id, status: 'complete' });
      } else if (status === 'aborted' || fence.reason !== 'consent_read_error') {
        removed += await removeStagedRows(selector);
        await HealthIngestBatch.deleteOne({ _id: batch._id });
      } else {
        failed += 1;
      }
    } catch {
      failed += 1;
    }
  }
  try {
    removed += await removeOrphanedStagedRows({ userId, source, limit });
  } catch {
    failed += 1;
  }
  return { recovered, removed, failed };
}

async function ingestV2Batch(userId, platform, samples, options = {}) {
  if (platform !== 'healthkit') {
    throw fixedError('health_v2_platform_not_supported', 400);
  }

  const source = 'apple_health';
  const expectedConnectionVersion = Number(options.connectionVersion ?? 0);
  const start = await ingestFence(userId, source, expectedConnectionVersion);
  if (!start.admitted) {
    if (start.reason === 'consent_read_error') throw fixedError('health_projection_pending', 503);
    if (start.reason === 'consent_not_current') throw fixedError('health_consent_changed', 409);
    throw fixedError('wearable_connection_changed', 409);
  }
  const ingestToken = crypto.randomBytes(16).toString('hex');
  const now = new Date();
  await HealthIngestBatch.create({
    _id: ingestToken,
    userId,
    source,
    connectionVersion: expectedConnectionVersion,
    consentFence: start.fence,
    status: 'writing',
    leaseUntil: new Date(now.getTime() + MAX_BATCH_LEASE_MS),
    createdAt: now,
  });
  let stored;
  try {
    stored = await applyHealthOperations(userId, source, samples, {
      ...options,
      connectionVersion: expectedConnectionVersion,
      consentFence: start.fence,
      ingestToken,
      beforeOperation: () => renewIngestLease(ingestToken),
      afterOperation: () => renewIngestLease(ingestToken),
    });

    const completed = await HealthIngestBatch.updateOne(
      { _id: ingestToken, status: 'writing' },
      { $set: { status: 'complete' } },
    );
    if ((completed?.modifiedCount ?? 0) !== 1) {
      throw fixedError('health_projection_pending', 503);
    }

    const after = await ingestFence(userId, source, expectedConnectionVersion);
    const consentChanged = after.admitted && after.fence !== start.fence;
    if (!after.admitted || consentChanged) {
      if (after.reason !== 'consent_read_error') {
        await HealthIngestBatch.updateOne(
          { _id: ingestToken },
          { $set: { status: 'aborted' } },
        );
        await removeStagedRows({ userId, source, ingestToken });
        await HealthIngestBatch.deleteOne({ _id: ingestToken, status: 'aborted' });
      }
      if (after.reason === 'consent_read_error') throw fixedError('health_projection_pending', 503);
      if (consentChanged || after.reason === 'consent_not_current') {
        throw fixedError('health_consent_changed', 409);
      }
      throw fixedError('wearable_connection_changed', 409);
    }

    await HealthSample.updateMany(
      { userId, source, ingestToken, ingestState: 'staged' },
      { $set: { ingestState: 'committed' }, $unset: { ingestToken: 1, consentFence: 1 } },
    );
    await HealthIngestBatch.deleteOne({ _id: ingestToken, status: 'complete' });
    const reconciled = await reconcileHealthSamples(userId, source, {
      connectionVersion: expectedConnectionVersion,
    });
    return {
      accepted: stored.accepted,
      created: stored.created,
      replayed: stored.replayed,
      deleted: stored.deleted,
      projected: reconciled.projected,
    };
  } catch (error) {
    await HealthIngestBatch.updateOne(
      { _id: ingestToken, status: 'writing' },
      { $set: { status: 'aborted' } },
    );
    try {
      // Safe even after commit/projection failure: committed rows no longer carry ingestToken.
      await removeStagedRows({ userId, source, ingestToken });
      await HealthIngestBatch.deleteOne({ _id: ingestToken, status: 'aborted' });
    } catch {
      // The durable aborted journal, or the journal-independent staged sweep, retries cleanup.
    }
    const statusCode = STATUS_BY_CODE[error?.code];
    if (statusCode) throw fixedError(error.code, statusCode);
    throw error;
  }
}

module.exports = { ingestV2Batch, recoverStagedHealthSamples };
