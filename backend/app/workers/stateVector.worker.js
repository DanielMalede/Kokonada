'use strict';

const baselinesService = require('../services/biosonic/baselines');
const MedicalProfile = require('../models/MedicalProfile');
const { upsertStateVector } = require('../services/medicalProfileService');

// BullMQ processor for state-vector-recompute {userId}: refresh the 30-day
// personal baselines (fresh compute + encrypted cache) and re-derive the
// physiological state vector from the profile.
//
// ZERO-KNOWLEDGE BOUNDARY: all decryption happens inside this worker call
// (baselines paging + the profile read). The returned job summary carries no
// biometric values — only bookkeeping.
async function process(job) {
  const userId = job?.data?.userId;
  if (!userId) return { recomputed: false };

  const stats = await baselinesService.computeBaselines(userId);
  await baselinesService.cacheBaselines(userId, stats);
  // W4-004: the engine also derives HRmax + Karvonen zones (§M.7). Persisting them onto the
  // (previously dormant) MedicalProfile fields keeps the stored profile consistent with the
  // physiology the engine reasons with. Decoration only — the baselines are already cached above,
  // so a failure here must never cost the user their refresh. Guarded at the CALL as well as
  // inside, because "the callee catches" is a property that quietly stops being true.
  await baselinesService.persistDerivedProfile(userId, stats).catch(() => {});

  const profile = await MedicalProfile.findOne({ userId }); // getters decrypt here only
  const telemetry = profile ? (typeof profile.toObject === 'function' ? profile.toObject() : profile) : {};
  await upsertStateVector(userId, telemetry);

  return { userId, recomputed: true };
}

module.exports = { process };
