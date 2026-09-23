'use strict';

// Per-provider wearable erasure (T3.2). GDPR right-to-erasure at the granularity of a
// SINGLE wearable: disconnecting Garmin must remove Garmin's physiological samples and
// credentials WITHOUT destroying an Apple Health / Health Connect / Suunto connection the
// user still relies on. This is a NEW module by ownership ruling — account-wide erasure
// (services/privacy/erasure.js) stays owned by Wave 1; consolidation happens later.

const BiometricLog   = require('../../models/BiometricLog');
const VitalSample    = require('../../models/VitalSample');
const MedicalProfile = require('../../models/MedicalProfile');
const MorningState   = require('../../models/MorningState');
const garmin         = require('../wearable/garmin');
const { getRedis }   = require('../../config/redis');

const WEARABLE_PROVIDERS = Object.freeze(['garmin', 'apple_health', 'health_connect', 'suunto']);

// Mirrors baselines.js `_cacheKey` (not exported there) — the AAD-bound rolling-median blob.
const _baselineKey = (userId) => `bio:baseline:${userId}`;
// W4-006 (§0.4 S5): the carried affect posterior. It is DERIVED from heart rate and HRV, so it is
// wearable data by provenance even though it stores neither — leaving a cached inference about
// somebody's emotional state behind after they disconnect the sensor that produced it is exactly
// the silent leak S5 exists to prevent.
const { affectKey: _affectKey } = require('../biosonic/affectCache');

// Remove a provider's DATA footprint (biometric samples + derived health profile), scoped
// so nothing belonging to another still-connected wearable is touched.
async function purgeWearableData(userId, provider) {
  // 1. BiometricLog is source-attributed — delete exactly this provider's samples.
  const bio = await BiometricLog.deleteMany({ userId, source: provider });

  // 1b. VitalSample carries the SAME `source` attribution (W4-004, S5), so the identical
  //     scoping applies: disconnecting Garmin removes Garmin's HRV/SpO2/battery history and
  //     leaves an Apple Health connection's rows alone. Registered here in the task that
  //     created the collection rather than "later" — a wearable-derived collection missing
  //     from per-provider erasure is a silent GDPR leak that nothing would surface.
  const vitals = await VitalSample.deleteMany({ userId, source: provider });

  // 2. MedicalProfile is a single per-user AGGREGATE with no per-source attribution; it is
  //    derived from BiometricLog. Delete it ONLY when no biometric samples remain (i.e. it
  //    was derived solely from the purged provider). Otherwise it still reflects another
  //    connected wearable — leave it and let baselines recompute.
  //    "Derived solely from the purged provider" now means no HR samples AND no vital samples
  //    remain — counting only BiometricLog would delete a profile still backed by another
  //    wearable's VitalSample rows.
  //
  //    MorningState (W4-012, S5) is the SAME category of derived aggregate — a nightly
  //    consolidation of exactly the vitals MedicalProfile/BiometricLog/VitalSample carry, with
  //    no per-source attribution of its own — so it rides the identical all-or-nothing rule
  //    rather than a fourth, disagreeing scoping scheme.
  let medicalProfiles = 0;
  let morningStates = 0;
  const remaining = await BiometricLog.countDocuments({ userId })
    + await VitalSample.countDocuments({ userId });
  if (remaining === 0) {
    const med = await MedicalProfile.deleteMany({ userId });
    medicalProfiles = med?.deletedCount ?? 0;
    const morning = await MorningState.deleteMany({ userId });
    morningStates = morning?.deletedCount ?? 0;
  }

  // 2b. RewardEvent (W4-011, ADR-0012 Track A, S5) is registered here as a DELIBERATE
  //     EXCLUSION, and the reasoning is the point rather than the omission. It looks like the
  //     same category as MorningState — a per-user derived aggregate with no `source` field —
  //     but it is not derived solely from the wearable. A bucket's coordinates are
  //     {stateDomain, targetBand, hourBin}, and the taxonomy resolves a state DEGRADED (from
  //     mood taps and the clock alone) when no wrist signal exists at all — `stateTaxonomy`'s
  //     own `degraded` flag is exactly that guarantee. Half of each bucket's evidence is
  //     behavioural (skip / complete / save), which no wearable ever touched. So dropping a
  //     user's whole learned personalization because they unpaired one watch would erase data
  //     that is not wearable-derived, which is over-erasure, not caution. It stays; account
  //     deletion still removes it in full (`erasure.js`).
  //
  // 2c. PersonalWeights (W4-013 B7, S5) is registered here as a DELIBERATE EXCLUSION for the
  //     SAME reason as RewardEvent above, and it is worth stating rather than inheriting. The
  //     overlay is four MUSIC-RANKING coefficients, not a physiological aggregate: it is moved by
  //     the same combined reward, whose behavioural half (skip / complete / save) no wearable ever
  //     touched, and whose biometric half is only ever one of two contributions. It also has no
  //     `source` field to scope a delete by, because a scoring weight has no provider. Dropping a
  //     listener's whole learned ranking because they unpaired one watch would be over-erasure of
  //     data that is not wearable-derived. It stays; account deletion still removes it in full
  //     (`erasure.js`), and §M.15's shrink-to-global takes it back to the default on its own.
  //
  // 3. Invalidate the derived Redis baseline blob so the next generation recomputes from
  //    whatever remains (best-effort — a Redis outage must not fail the erasure; TTL cleans up).
  try {
    const redis = getRedis();
    if (redis) await redis.del(_baselineKey(userId));
  } catch { /* best-effort */ }

  // 3b. And the derived affect posterior (W4-006, S5). Separate try/catch on purpose: these are
  //     two independent promises about the user's data, and a failure to invalidate one must not
  //     skip the other.
  try {
    const redis = getRedis();
    if (redis) await redis.del(_affectKey(userId));
  } catch { /* best-effort */ }

  return {
    biometricLogs: bio?.deletedCount ?? 0, vitalSamples: vitals?.deletedCount ?? 0, medicalProfiles, morningStates,
  };
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

// Best-effort Garmin deregistration (Wave 6 T4). Flag-gated OFF by default: production
// Garmin API access requires an approval that may not be live yet, so a NEW outbound call
// must not fire until a human flips GARMIN_DEREGISTER_ENABLED after confirming approval.
// It runs BEFORE the credentials are cleared (it needs a valid token) and NEVER blocks the
// local erasure — a Garmin/network failure is swallowed so the user's GDPR erasure always
// completes. Returns a small audit record of what was attempted.
async function maybeDeregisterGarmin(user) {
  if (process.env.GARMIN_DEREGISTER_ENABLED !== 'true') return { attempted: false };
  try {
    const accessToken = await garmin.getValidToken(user); // auto-refreshes a stale token
    await garmin.deregisterUser(accessToken);
    return { attempted: true, ok: true };
  } catch (e) {
    console.error('[garmin] deregister failed (erasure continues):', e.message);
    return { attempted: true, ok: false };
  }
}

// Full per-provider erasure: (garmin only) deregister with Garmin, then clear credentials,
// persist, and purge the data footprint.
async function eraseWearableProvider(user, provider) {
  const deregistration = provider === 'garmin' ? await maybeDeregisterGarmin(user) : undefined;
  clearWearableCredentials(user, provider);
  await user.save();
  const purged = await purgeWearableData(user._id, provider);
  return deregistration ? { ...purged, deregistration } : purged;
}

module.exports = {
  WEARABLE_PROVIDERS,
  purgeWearableData,
  clearWearableCredentials,
  eraseWearableProvider,
};
