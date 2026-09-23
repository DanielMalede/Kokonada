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
const { insertManyAccounted } = require('./insertAccounted');

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

  // W4-D08: `ingested` is what the database took, not what was attempted — `ordered:false` continues
  // past a duplicate AND past a schema-rejected row, and only the driver knows which is which.
  const { inserted, rejected } = await insertManyAccounted(BiometricLog, docs);
  return { ingested: inserted, rejected };
}

module.exports = { ingestBatch };