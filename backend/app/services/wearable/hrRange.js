'use strict';

// The ONE physiological heart-rate range in the system (W4-001 / D9).
//
// Before this module the codebase carried three different gates for the same value:
// the socket ingest accepted 0–300, the watch route accepted 30–230, and every
// CONSUMER (biometric context, targets, state vector) required 30–220. The gap was
// silent: a 250 bpm push was acked, stored in the debounce state, and then dropped
// without a trace at consumption time, so the user's playlist simply stopped
// responding. Ingest and consumption now share this predicate, so a reading that is
// accepted is a reading that can actually drive a target.
//
// Bounds: 30 bpm is below the resting rate of a trained endurance athlete
// (sinus bradycardia is clinically flagged under 60; elite resting rates reach the
// mid-30s), and 220 is the classic age-zero HRmax ceiling (220 − age). Anything
// outside is sensor artefact or spoofed content, not physiology.

const HR_MIN = 30;
const HR_MAX = 220;

/**
 * True when `n` is a heart rate a human body can actually produce.
 * Strict on type: the socket payload is attacker-controlled, so a numeric STRING
 * ("120") is rejected rather than coerced (audit F14).
 */
function isPhysiologicalHR(n) {
  return typeof n === 'number' && Number.isFinite(n) && n >= HR_MIN && n <= HR_MAX;
}

module.exports = { HR_MIN, HR_MAX, isPhysiologicalHR };
