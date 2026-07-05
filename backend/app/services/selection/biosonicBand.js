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

  const bpm = Number(f.bpm);
  const center = Number(targets.bpmCenter);
  const width = Number(targets.bpmWidth);
  if (Number.isFinite(bpm) && Number.isFinite(center) && Number.isFinite(width)) {
    const half = tau * Math.max(4, width);
    if (bpm < center - half || bpm > center + half) return false;
  }

  const energy = Number(f.energy);
  const floor = Number(targets.energyFloor);
  const ceil = Number(targets.energyCeiling);
  if (Number.isFinite(energy) && Number.isFinite(floor) && Number.isFinite(ceil)) {
    const margin = (tau - W_MIN()) * E_TOL();
    if (energy < floor - margin || energy > ceil + margin) return false;
  }
  return true;
}

function filterBand(tracks = [], targets = {}) {
  return tracks.filter(t => withinBand(t, targets));
}

module.exports = { tolerance, withinBand, filterBand };
