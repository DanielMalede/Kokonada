'use strict';

const { moodCoords } = require('../moodDescriptors');

// Pure exposure-decay math: how strongly a track's serve history should push it
// away from being served again in the CURRENT mood context.
//
//   penalty = Σ over serves  W · exp(-ageHours/τ) · proximity(servedMood, targetMood)
//   proximity(a, b) = exp(-euclid(a, b) / σ)   over (energy, valence) coordinates
//
// Recent + same-context serves dominate; old + distant-context serves fade.
// The hard exclusion windows (24h global / 72h per-mood) live in serveLedger —
// this score only shapes ranking BEYOND those windows.

const HOUR = 3_600_000;
const TAU_HOURS = () => parseFloat(process.env.LEDGER_DECAY_TAU_HOURS || '96');
const SIGMA     = () => parseFloat(process.env.MOOD_PROXIMITY_SIGMA || '0.4');

function moodProximity(a, b, sigma = SIGMA()) {
  const dist = Math.hypot(a.energy - b.energy, a.valence - b.valence);
  return Math.exp(-dist / sigma);
}

function exposurePenalty({
  serves = [],
  targetMoodKey = null,
  targetCoords = null,
  now = Date.now(),
  tauHours = TAU_HOURS(),
  sigma = SIGMA(),
  weight = 1,
} = {}) {
  const target = targetCoords ?? moodCoords(targetMoodKey);
  let penalty = 0;
  for (const serve of serves) {
    const servedMs = new Date(serve.servedAt).getTime();
    const ageHours = (now - servedMs) / HOUR;
    penalty += weight * Math.exp(-ageHours / tauHours) * moodProximity(moodCoords(serve.moodKey), target, sigma);
  }
  return penalty;
}

module.exports = { moodProximity, exposurePenalty };
