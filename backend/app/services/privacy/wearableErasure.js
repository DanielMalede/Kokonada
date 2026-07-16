'use strict';

// Per-provider wearable erasure (T3.2). GDPR right-to-erasure at the granularity of a
// SINGLE wearable: disconnecting Garmin must remove Garmin's physiological samples and
// credentials WITHOUT destroying an Apple Health / Health Connect / Suunto connection the
// user still relies on. This is a NEW module by ownership ruling — account-wide erasure
// (services/privacy/erasure.js) stays owned by Wave 1; consolidation happens later.

const BiometricLog   = require('../../models/BiometricLog');
const MedicalProfile = require('../../models/MedicalProfile');
const { getRedis }   = require('../../config/redis');

const WEARABLE_PROVIDERS = Object.freeze(['garmin', 'apple_health', 'health_connect', 'suunto']);

// Mirrors baselines.js `_cacheKey` (not exported there) — the AAD-bound rolling-median blob.
const _baselineKey = (userId) => `bio:baseline:${userId}`;

// Remove a provider's DATA footprint (biometric samples + derived health profile), scoped
// so nothing belonging to another still-connected wearable is touched.
async function purgeWearableData(userId, provider) {
  // 1. BiometricLog is source-attributed — delete exactly this provider's samples.
  const bio = await BiometricLog.deleteMany({ userId, source: provider });

  // 2. MedicalProfile is a single per-user AGGREGATE with no per-source attribution; it is
  //    derived from BiometricLog. Delete it ONLY when no biometric samples remain (i.e. it
  //    was derived solely from the purged provider). Otherwise it still reflects another
  //    connected wearable — leave it and let baselines recompute.
  let medicalProfiles = 0;
  const remaining = await BiometricLog.countDocuments({ userId });
  if (remaining === 0) {
    const med = await MedicalProfile.deleteMany({ userId });
    medicalProfiles = med?.deletedCount ?? 0;
  }

  // 3. Invalidate the derived Redis baseline blob so the next generation recomputes from
  //    whatever remains (best-effort — a Redis outage must not fail the erasure; TTL cleans up).
  try {
    const redis = getRedis();
    if (redis) await redis.del(_baselineKey(userId));
  } catch { /* best-effort */ }

  return { biometricLogs: bio?.deletedCount ?? 0, medicalProfiles };
}

// Null out the User-doc credential fields for a provider. Does NOT persist — the caller
// saves (so it composes with other credential edits in one write). Returns true if it
// mutated anything.
function clearWearableCredentials(user, provider) {
  let changed = false;

  // The active wearable connection (token-based: garmin/suunto; push-based: apple_health,
  // health_connect where wearableProvider alone marks the connection).
  if (user.wearableProvider === provider) {
    user.wearableProvider = null;
    user.wearableToken = null;
    changed = true;
  }

  // Garmin-only credentials — unambiguously Garmin's, cleared on any Garmin erasure.
  if (provider === 'garmin') {
    if (user.garminUserId != null)     { user.garminUserId = null; changed = true; }
    if (user.garminUserIdHmac != null) { user.garminUserIdHmac = null; changed = true; }
    if (user.watchToken?.hash)         { user.watchToken = { hash: null, createdAt: null, lastSeenAt: null }; changed = true; }
  }

  return changed;
}

// Full per-provider erasure: clear credentials, persist, then purge the data footprint.
async function eraseWearableProvider(user, provider) {
  clearWearableCredentials(user, provider);
  await user.save();
  return purgeWearableData(user._id, provider);
}

module.exports = {
  WEARABLE_PROVIDERS,
  purgeWearableData,
  clearWearableCredentials,
  eraseWearableProvider,
};
