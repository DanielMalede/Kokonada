'use strict';

const HealthSample = require('../models/HealthSample');
const {
  reconcileHealthSamples,
  recoverOwedHealthProjectionCleanups,
} = require('../services/wearable/healthSampleReconciliation');
const { recoverStagedHealthSamples } = require('../services/wearable/healthStoreV2');

const BATCH_SIZE = 100;

async function processJob() {
  const projectionCleanup = await recoverOwedHealthProjectionCleanups({ limit: BATCH_SIZE });
  // A crash or a transient cleanup failure can leave a post-write fence decision owed. Resolve
  // those staged rows first; only committed rows are eligible for physiological projection.
  const staged = await recoverStagedHealthSamples({ limit: BATCH_SIZE });
  const pending = await HealthSample.find({
    projectionState: 'pending',
    ingestState: { $ne: 'staged' },
  })
    .select({ userId: 1, source: 1, connectionVersion: 1 })
    .sort({ updatedAt: 1, _id: 1 })
    .limit(BATCH_SIZE)
    .lean();

  const groups = new Map();
  for (const sample of pending) {
    const userId = String(sample.userId);
    const connectionVersion = Number(sample.connectionVersion ?? 0);
    const key = `${userId}\u0000${sample.source}\u0000${connectionVersion}`;
    if (!groups.has(key)) groups.set(key, { userId, source: sample.source, connectionVersion });
  }

  let repaired = 0;
  for (const { userId, source, connectionVersion } of groups.values()) {
    try {
      await reconcileHealthSamples(userId, source, { connectionVersion });
      repaired += 1;
    } catch {
      // The error or group identity can contain special-category health context. The pending row
      // is the durable retry signal, so log only a fixed operational message and continue.
      console.error('[healthSampleReconciliation] repair group failed');
    }
  }

  return { groups: groups.size, repaired, staged, projectionCleanup };
}

module.exports = { process: processJob };
