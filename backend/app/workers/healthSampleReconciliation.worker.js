'use strict';

const HealthSample = require('../models/HealthSample');
const { reconcileHealthSamples } = require('../services/wearable/healthSampleReconciliation');

const BATCH_SIZE = 100;

async function processJob() {
  const pending = await HealthSample.find({ projectionState: 'pending' })
    .select({ userId: 1, source: 1 })
    .sort({ updatedAt: 1, _id: 1 })
    .limit(BATCH_SIZE)
    .lean();

  const groups = new Map();
  for (const sample of pending) {
    const userId = String(sample.userId);
    const key = `${userId}\u0000${sample.source}`;
    if (!groups.has(key)) groups.set(key, { userId, source: sample.source });
  }

  let repaired = 0;
  for (const { userId, source } of groups.values()) {
    try {
      await reconcileHealthSamples(userId, source);
      repaired += 1;
    } catch {
      // The error or group identity can contain special-category health context. The pending row
      // is the durable retry signal, so log only a fixed operational message and continue.
      console.error('[healthSampleReconciliation] repair group failed');
    }
  }

  return { groups: groups.size, repaired };
}

module.exports = { process: processJob };
