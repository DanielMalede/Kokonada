/**
 * Apple HealthKit bridge.
 *
 * Apple HealthKit data lives on the device and cannot be fetched server-side.
 * The mobile app reads it locally and pushes batches to the backend via this
 * service. No OAuth is needed — the user's JWT authenticates the push.
 *
 * Expected payload from the mobile app:
 * POST /api/integrations/wearable/apple/push
 * {
 *   samples: [
 *     { value: 72, workoutType: "HKWorkoutActivityTypeRunning", startDate: "2024-01-01T10:00:00Z" },
 *     ...
 *   ]
 * }
 */

const BiometricLog = require('../../models/BiometricLog');
const { normalize }  = require('./adapter');

const MAX_BATCH = 500; // prevent oversized payloads

async function ingestBatch(userId, samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw Object.assign(new Error('samples must be a non-empty array'), { statusCode: 400 });
  }
  if (samples.length > MAX_BATCH) {
    throw Object.assign(new Error(`Batch too large — max ${MAX_BATCH} samples per request`), { statusCode: 400 });
  }

  const docs = samples.map(raw => {
    const normalized = normalize('apple_health', raw);
    return { userId, ...normalized };
  });

  await BiometricLog.insertMany(docs, { ordered: false }); // ordered:false = continue on duplicate
  return { ingested: docs.length };
}

module.exports = { ingestBatch };