'use strict';

// Confidence-adaptive biosonic band — the UN-RELAXABLE mood identity. A logistic
// tolerance τ(c) sets the tempo/energy window: tight when translate() is confident,
// smoothly + boundedly wider when it is not (a bare manual tap must not over-constrain
// the whole library). Double-saturating (floor w_min>0: features carry irreducible
// error; ceil w_max: a zero-confidence request still keeps a mood). Pure, no I/O.

const W_MIN = () => parseFloat(process.env.BAND_W_MIN ?? '1.0');
const W_MAX = () => parseFloat(process.env.BAND_W_MAX ?? '3.0');
const C0    = () => parseFloat(process.env.BAND_C0 ?? '0.6');
const K     = () => parseFloat(process.env.BAND_K ?? '10');
const E_TOL = () => parseFloat(process.env.BAND_E_TOL ?? '0.1');
// Activity-driven requests are ENERGY-primary with a WIDE, fixed tempo window (an explicit
// exertion wants a range of energetic music, not the step-cadence point — and the stress
// narrowing must not apply). featureFit still sorts exact tempo within it.
const INTENT_BPM_SPAN = () => parseFloat(process.env.BAND_INTENT_BPM_SPAN ?? '40');
// Texture outlier ceilings, applied ONLY under an explicit exertion intent (activityIntensity).
// High exertion: a fast ACOUSTIC track is almost always a double-time BPM artifact — its acoustic
// timbre is invariant to the octave error, so the ceiling drops it structurally. Low exertion: a
// club-danceable track betrays a mis-read-low energy — an orthogonal cross-check on the energy gate.
const ACOUSTIC_CEIL = () => parseFloat(process.env.BAND_ACOUSTIC_CEIL ?? '0.4');
const DANCE_CEIL    = () => parseFloat(process.env.BAND_DANCE_CEIL ?? '0.6');

const clamp01 = (x) => Math.min(1, Math.max(0, x));

function tolerance(confidence) {
  const c = Number.isFinite(confidence) ? clamp01(confidence) : 0;
  const sig = 1 / (1 + Math.exp(-K() * (C0() - c)));
  return W_MIN() + (W_MAX() - W_MIN()) * sig;
}

function withinBand(track, targets = {}) {
  const f = track?.features;
  if (!f) return true; // featureless: cannot judge — kept, pays unknownFeaturePenalty in score
  const tau = tolerance(targets.confidence ?? 0);

  // Tempo tolerance: a WIDE fixed window for an explicit activity (energy-primary — the
  // stress-narrowed, confidence-scaled window would exclude the library's energetic mass
  // that sits below the step cadence); the narrow window still governs mood requests.
  const bpm = Number(f.bpm);
  const center = Number(targets.bpmCenter);
  const width = Number(targets.bpmWidth);
  const half = targets.activityDriven
    ? INTENT_BPM_SPAN()
    : (Number.isFinite(width) ? tau * Math.max(4, width) : null);
  if (Number.isFinite(bpm) && Number.isFinite(center) && half != null) {
    if (bpm < center - half || bpm > center + half) return false;
  }

  // Energy — the PRIMARY gate for activity-driven requests (a workout means high energy);
  // one and the same window for mood requests.
  const energy = Number(f.energy);
  const floor = Number(targets.energyFloor);
  const ceil = Number(targets.energyCeiling);
  if (Number.isFinite(energy) && Number.isFinite(floor) && Number.isFinite(ceil)) {
    const margin = (tau - W_MIN()) * E_TOL();
    if (energy < floor - margin || energy > ceil + margin) return false;
  }

  // Texture outlier rejection — un-relaxable, orthogonal to energy/tempo, gated by exertion intent.
  if (targets.activityIntensity === 'high') {
    const acoustic = Number(f.acousticness);
    if (Number.isFinite(acoustic) && acoustic > ACOUSTIC_CEIL()) return false; // acoustic double-time
  } else if (targets.activityIntensity === 'low') {
    const dance = Number(f.danceability);
    if (Number.isFinite(dance) && dance > DANCE_CEIL()) return false; // intensity bleed into calm
  }
  return true;
}

function filterBand(tracks = [], targets = {}) {
  return tracks.filter(t => withinBand(t, targets));
}

module.exports = { tolerance, withinBand, filterBand };
