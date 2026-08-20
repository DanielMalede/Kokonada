'use strict';

const baselinesService = require('../services/biosonic/baselines');
const MedicalProfile = require('../models/MedicalProfile');
const { upsertStateVector } = require('../services/medicalProfileService');
const { resolveAffect, resolveHourContext } = require('../services/biosonic/affectService');

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

  // W4-006 (seam half): advance the affect posterior on the nightly lane too.
  //
  // This is the ONLY thing keeping the temporal layer alive for a user who has not generated a
  // playlist today — without it their posterior would expire, and every state would be a cold
  // start the next time they pressed play. It also puts the taxonomy label into storage, which is
  // what `pulseController` (and later W4-012's MorningState) reads.
  //
  // The evidence is deliberately THIN: no `live` reading exists on this lane, so every HR-derived
  // axis abstains and the resulting state is a passive one. That is the honest answer — fabricating
  // a heart rate here to get a confident label would be the exact failure D3 and the affect
  // engine's mass mechanism exist to prevent.
  //
  // Best-effort at the CALL as well as inside, on the W4-004 precedent: "the callee catches" is a
  // property that quietly stops being true, and a failure here must never cost the refresh above.
  const now = Date.now();
  const affect = await resolveAffect({
    userId,
    live: {},
    baselines: stats,
    state: {
      hrv: telemetry.hrv,
      bodyBattery: telemetry.bodyBattery,
      dailyReadiness: telemetry.dailyReadiness,
    },
    sleep: telemetry.lastNightSleep ? { lastNight: telemetry.lastNightSleep } : {},
    tzOffsetMinutes: resolveHourContext(now, stats).tzOffsetMinutes,
    now,
  }).catch(() => null);

  await upsertStateVector(userId, telemetry, { affect: affect ?? null });

  // The summary stays bookkeeping-only: a state label is internal vocabulary and job summaries
  // are logged (§0.2.2, R10).
  return { userId, recomputed: true };
}

module.exports = { process };
