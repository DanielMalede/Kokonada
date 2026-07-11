'use strict';

const MedicalProfile = require('../models/MedicalProfile');
const { decrypt } = require('../utils/encryption');

// GET /api/pulse/state — the owner's live physiological snapshot for the Pulse screen
// (A11). Product ruling 2026-07-03: the OWNER may see their own decrypted numeric
// vitals, served via an EXPLICIT whitelist DTO — never document serialization, never
// persisted on device. MedicalProfile sets toJSON:{getters:true} and holds many more
// encrypted fields (spO2, gpsVelocity, hrZones…) that must NOT leave the server.

const NULL_STATE = () => ({
  stateVector: { status: null, confidence: null, computedAt: null },
  vitals: { hrv: null, bodyBattery: null, dailyReadiness: null, restingHeartRate: null },
  sleep: { lastNight: { deep: null, light: null, rem: null, date: null }, updatedAt: null },
  lastAnalyzed: null,
  sampleCount: 0,
});

function toPulseStateDTO(profile) {
  if (!profile) return NULL_STATE();

  const sv = profile.stateVector || {};
  // status is a plain String stored PRE-encrypted by medicalProfileService — decrypt
  // it here; a corrupt/rotated blob degrades to null rather than throwing.
  let status = null;
  if (sv.status) {
    try { status = decrypt(sv.status); } catch { status = null; }
  }

  const ln = profile.lastNightSleep || {};
  return {
    stateVector: {
      status,
      confidence: sv.confidence != null ? sv.confidence : null,
      computedAt: sv.computedAt || null,
    },
    // encryptedNumber getters have already decrypted these on a real (non-lean) doc.
    vitals: {
      hrv: profile.hrv != null ? profile.hrv : null,
      bodyBattery: profile.bodyBattery != null ? profile.bodyBattery : null,
      dailyReadiness: profile.dailyReadiness != null ? profile.dailyReadiness : null,
      restingHeartRate: profile.restingHeartRate != null ? profile.restingHeartRate : null,
    },
    sleep: {
      lastNight: {
        deep: ln.deep != null ? ln.deep : null,
        light: ln.light != null ? ln.light : null,
        rem: ln.rem != null ? ln.rem : null,
        date: ln.date || null,
      },
      updatedAt: profile.sleepUpdatedAt || null,
    },
    lastAnalyzed: profile.lastAnalyzed || null,
    sampleCount: profile.sampleCount || 0,
  };
}

exports.getPulseState = async (req, res, next) => {
  try {
    // Non-lean: the encryptedNumber getters must run to decrypt the vitals.
    const profile = await MedicalProfile.findOne({ userId: req.user._id });
    const dto = toPulseStateDTO(profile);
    // Diagnostic (Pulse-empty): the batch write logs profileMetrics.restingHeartRate but Pulse
    // shows "—". This pins whether the profile is found, whether restingHR is stored (raw) yet
    // reads back null (getter/decrypt), or whether the server returns it (→ a mobile fetch issue).
    let rawRHR = 'n/a';
    try { rawRHR = profile ? String(profile.get('restingHeartRate', null, { getters: false }) ?? 'null').slice(0, 14) : 'no-profile'; } catch { rawRHR = 'err'; }
    console.warn(`[pulse/state] user=${req.user._id} found=${!!profile} profileId=${profile?._id} restingHR=${dto.vitals.restingHeartRate} rawRHR=${rawRHR} deep=${dto.sleep.lastNight.deep} rem=${dto.sleep.lastNight.rem} sampleCount=${dto.sampleCount}`);
    res.json(dto);
  } catch (err) {
    console.warn(`[pulse/state] FAILED user=${req.user?._id}: ${err.message}`);
    next(err);
  }
};

exports.toPulseStateDTO = toPulseStateDTO;
