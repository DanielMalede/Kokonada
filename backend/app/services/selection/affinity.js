'use strict';

// W4-010 (a) · Read-time recency decay for library affinity.
//
// `affinity` is computed ONCE, at profile build, from a snapshot of the user's listening
// history — and then never moves again until the next full rebuild. A genre someone left
// behind two years ago therefore outranks this month's obsession forever, which is the
// taste half of defect D20 ("no recency decay ... no learning of any kind").
//
// The fix is deliberately a PROJECTION, not a write: the stored `affinity` stays the raw
// evidence, and every read seam applies `affinity · e^(−Δdays/τ)` on the way past. That
// keeps one source of truth (a rebuild is still authoritative), makes the decay reversible
// by a flag rather than a migration, and — per ADR-0012 — fits nothing and persists nothing.
//
// Design rules this module holds to:
//   • Missing evidence is a PRIOR, never a penalty. A library entry written before
//     `lastSeenAt` existed has no recency claim, so its factor is exactly 1 — the wave's
//     standing discipline (W4-007's MISSING_PRIOR, W4-005's axis mass).
//   • A future timestamp is clamped to 1, not amplified (§0.4 S6 timestamp sanity — the
//     classic backfill trap, here in its read-side form).
//   • `now` is a PARAMETER (§0.4 S9): replay determinism, no hidden clock.
//   • A garbage env value must not silently delete the taste term (W4-D26's lesson).

// τ ≈ 90 days: at one time constant a track keeps e^-1 ≈ 37% of its weight, at two ≈ 13%.
// Chosen so a season-old favourite is demoted but not erased, and a two-year-old one is
// effectively gone — the timescale on which listening taste actually turns over.
const DEFAULT_TAU_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

let _tau = null;
let _disabled = null;

function tauDays() {
  if (_tau == null) {
    const raw = parseFloat(process.env.AFFINITY_DECAY_TAU_DAYS ?? '');
    // A non-positive or unparseable τ is a misconfiguration, not an instruction to make
    // every track worthless (τ→0) or to divide by zero. Fall back to the default.
    _tau = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TAU_DAYS;
  }
  return _tau;
}

// S11 escape hatch: restores pre-W4-010 behaviour (no decay) without a revert or a redeploy.
// Read ONCE and memoized (like tauDays above, and like the scorer's weights), so a running
// process picks the flag up on restart, not mid-process — `_resetDecayConfig()` is the test seam.
function decayDisabled() {
  if (_disabled == null) _disabled = Boolean(process.env.WAVE4_AFFINITY_DECAY_DISABLED);
  return _disabled;
}

/** Test seam — env is read once and memoized, as the scorer's weights are. */
function _resetDecayConfig() { _tau = null; _disabled = null; }

/**
 * Milliseconds for anything a `lastSeenAt` might plausibly be (Date, ISO string, epoch
 * number), or null when it carries no usable claim. Deliberately strict: an unparseable
 * value is "no evidence", never epoch 0 (which would read as 1970 and erase the track).
 */
function _msOf(value) {
  if (value == null) return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/**
 * The multiplier a track's affinity earns for how recently the user engaged with it.
 * Always in [0,1]; exactly 1 for "no usable evidence" and for anything not in the past.
 *
 * @param {Date|string|number|null} lastSeenAt
 * @param {{ now?: number, tauDays?: number }} [opts]
 */
function recencyFactor(lastSeenAt, { now = Date.now(), tauDays: tauOverride } = {}) {
  if (decayDisabled()) return 1;
  const seen = _msOf(lastSeenAt);
  if (seen == null) return 1;
  const nowMs = Number.isFinite(now) ? now : Date.now();
  const ageDays = (nowMs - seen) / DAY_MS;
  if (!(ageDays > 0)) return 1;            // future or same instant → no decay, no amplification
  const tau = Number.isFinite(tauOverride) && tauOverride > 0 ? tauOverride : tauDays();
  const f = Math.exp(-ageDays / tau);
  // exp of a large negative underflows to exactly 0, which is in range; guard NaN only.
  return Number.isFinite(f) ? Math.min(1, Math.max(0, f)) : 1;
}

/**
 * A track's affinity as the ranking should see it today. Never exceeds the stored value,
 * never negative, always finite — a missing/garbage affinity reads as 0, as it does at
 * every other affinity seam (`t.affinity ?? 0`).
 */
function decayedAffinity(track, opts = {}) {
  const raw = Number(track?.affinity);
  const base = Number.isFinite(raw) && raw > 0 ? raw : 0;
  return base * recencyFactor(track?.lastSeenAt, opts);
}

/**
 * Projects a list of library entries onto their decayed affinities. Returns NEW objects —
 * the caller's input (often a mongoose subdoc array, or a Redis-cached partition) is never
 * mutated. `affinityRaw` is kept alongside so telemetry and audits can still see the
 * undecayed evidence.
 */
function applyRecencyDecay(tracks, opts = {}) {
  if (!Array.isArray(tracks)) return [];
  if (decayDisabled()) return tracks;
  return tracks.map((t) => {
    if (!t) return t;
    // An entry with NO affinity is left exactly as it is. Writing a decayed 0 onto it would
    // manufacture the field, and downstream readers distinguish absent from zero: the
    // fallback mixer sorts on `affinity ?? listenCount ?? 0`, so coercing a legacy
    // listenCount-only row to `affinity: 0` silently flattens its whole ranking. Same
    // Number(null)===0 trap as W4-D15/W4-D21, one layer up.
    const raw = t.affinity;
    if (raw == null || !Number.isFinite(Number(raw))) return t;
    return { ...t, affinity: decayedAffinity(t, opts), affinityRaw: Number(raw) };
  });
}

module.exports = {
  recencyFactor,
  decayedAffinity,
  applyRecencyDecay,
  tauDays,
  decayDisabled,
  DEFAULT_TAU_DAYS,
  _resetDecayConfig,
};
