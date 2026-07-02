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

  const profile = await MedicalProfile.findOne({ userId }); // getters decrypt here only
  const telemetry = profile ? (typeof profile.toObject === 'function' ? profile.toObject() : profile) : {};
  await upsertStateVector(userId, telemetry);

  return { userId, recomputed: true };
}

module.exports = { process };
