'use strict';

/**
 * A5 — THE WELLBEING REGULATOR (W4-006).
 *
 * A PURE decorator over the `targets` object `translate()` produces. It does two things and
 * refuses to do a third.
 *
 *   1. Under strain it TIGHTENS the target — energy ceiling down, texture calmer, tempo window
 *      narrower. Never the reverse. There is no code path here that raises energy, widens a band
 *      or brightens a mood, which is what makes VISION §6's "regulator, not a mirror" a property
 *      of the module rather than a promise about it. The suite fuzzes it over arbitrary targets
 *      and arbitrary affect.
 *
 *   2. It attaches a TRAJECTORY: an arc in (energy, bpm) whose START meets the listener at their
 *      current arousal and whose END is where the state's own policy wants to take them. That is
 *      the iso-principle expressed as data for W4-008 to sequence along.
 *
 *   3. It never touches `valenceTarget`. D4 was the engine forcing a distressed listener into
 *      cheerful music (`Math.max(moodValence, 0.6)`); W4-001 removed the floor, and the structural
 *      replacement is the arc, not a smaller floor. `valenceApproach` travels INSIDE the
 *      trajectory as the arc's destination, where it shapes the ordering of tracks the band has
 *      already admitted, rather than as a filter that overrules how somebody feels.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * TWO PRODUCT GATES THAT SHAPE THE DESIGN (§0.2.6)
 *
 * · An explicit activity chip is a direct intent, and `translate()` deliberately LIFTS the
 *   passive recovery/wind-down cap for it ("a Workout at 2am still serves energy"). Capping it
 *   back down here would silently undo that decision, so when `activityDriven` is set the
 *   regulator does not touch energy at all — it regulates through the arc, scaling the peak via
 *   `intensityScale`. Somebody who asked to train still gets to train; they get a gentler shape.
 *
 * · The trajectory's endpoints are CLAMPED INTO the hard band (`bpmCenter ± bpmWidth`,
 *   `[energyFloor, energyCeiling]`). An arc that asks for a tempo the band filter has already
 *   thrown away is not an arc, it is an unsatisfiable constraint, and W4-008 would have to
 *   silently ignore it.
 *
 * PURE (S9): no clock, no randomness, no environment. `DISABLE_ENV_VAR` names the kill switch the
 * WIRING half must honour (S11); reading it belongs there, next to the seam it protects.
 */

const { byId, ARCHETYPE_DIRECTION } = require('../knowledge/stateTaxonomy');

const REGULATOR_VERSION = 'regulator/v1';
const TRAJECTORY_VERSION = 1;

/** The wiring half's escape hatch. Named here, read there — this module stays pure. */
const DISABLE_ENV_VAR = 'WAVE4_TRAJECTORY_DISABLED';

/**
 * Below this the engine is not confident enough about WHICH state this is for its policy to be
 * worth acting on. A confident-sounding regulation of a guessed state is the worst output this
 * module could produce, so the guess buys nothing: identity, and the pre-wave behaviour stands.
 */
const MIN_REGULATION_CONFIDENCE = 0.25;

/** Strain thresholds. Regulation begins where the axes stop being ordinary, not at the midpoint. */
const STRESS_ONSET = 0.45;
const STRESS_FULL = 0.80;
const RECOVERY_ONSET = 0.45;
const RECOVERY_FLOOR = 0.15;
const STRESS_SHARE = 0.6; // stress leads; depletion corroborates

/** How far the regulator may ever move a target. Deliberately small — it shapes, it does not mute. */
const MAX_CEILING_CUT = 0.25;
const MAX_TEXTURE_LIFT = 1.0; // fraction of the state's own textureBias applied at full demand
const TEXTURE_CAP = 0.4; // the ceiling translate() itself respects
const MAX_WIDTH_SHRINK = 0.25;
const MIN_BPM_WIDTH = 6;
const MIN_ENERGY_GAP = 0.05; // the gap translate() guarantees between floor and ceiling
const MAX_INTENSITY_SCALE_CUT = 0.35;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const clamp01 = (v) => clamp(v, 0, 1);
const round3 = (v) => Math.round(v * 1000) / 1000;
const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Rounding is applied AFTER the monotonicity clamp, never before, and both directions re-clamp
 * against the original. `round3` moves a value by up to 5e-4 in either direction, which is enough
 * to turn "never raises acousticness" into "raised it by 1e-9" — the fuzz found exactly that, on
 * an input of 1.0000000000000003e-9. A near-invisible violation of the one property this module
 * exists to guarantee is still a violation of it.
 */
const tightenDown = (original, candidate) => Math.min(original, round3(candidate));
const tightenUp = (original, candidate, cap) => Math.max(
  original, Math.min(Math.max(cap, original), round3(candidate)),
);

/** A one-sided ramp: 0 below `onset`, 1 at `full`, linear between. Zero-guarded (S8). */
function ramp(value, onset, full) {
  const v = finite(value);
  if (v == null) return 0;
  const span = full - onset;
  if (!(Math.abs(span) > 1e-9)) return v >= Math.max(onset, full) ? 1 : 0;
  return clamp01((v - onset) / span);
}

/** An axis value, but only to the extent it is actually measured. An abstaining axis says nothing. */
function evidenced(axes, name, neutral) {
  const a = axes?.[name];
  const value = finite(a?.value);
  const mass = clamp01(finite(a?.mass) ?? 0);
  if (value == null || mass <= 0) return neutral;
  return value;
}

/**
 * REGULATION DEMAND ∈ [0,1] — how much this moment is asking to be brought down.
 *
 * Stress leads and depletion corroborates, because they fail differently: stress is the acute
 * signal the iso-principle exists for, while low recovery is the slow one that says the body
 * cannot afford intensity even if it is not distressed right now. Both enter as one-sided ramps,
 * so an ordinary day produces demand 0 and the regulator is a strict no-op on the numbers.
 */
function regulationDemand(axes) {
  const stress = ramp(evidenced(axes, 'stress', 0.2), STRESS_ONSET, STRESS_FULL);
  const depletion = ramp(-evidenced(axes, 'recovery', 0.6), -RECOVERY_ONSET, -RECOVERY_FLOOR);
  return clamp01(STRESS_SHARE * stress + (1 - STRESS_SHARE) * depletion);
}

/**
 * Where the listener IS, in the target's own units — the arc's starting point.
 *
 * Arousal and exertion are near-collinear given a heart rate, so the meeting point takes the
 * larger of the two: someone mid-effort is met at their effort, someone merely keyed up is met at
 * their arousal, and neither is met at the average of the two.
 */
function meetingPoint(axes, targets) {
  const here = Math.max(
    evidenced(axes, 'arousal', 0.5),
    evidenced(axes, 'exertion', 0.15),
  );
  const floor = finite(targets.energyFloor) ?? 0;
  const ceiling = finite(targets.energyCeiling) ?? 1;
  const center = finite(targets.bpmCenter) ?? 100;
  const width = finite(targets.bpmWidth) ?? 10;
  return {
    energy: clamp(here, floor, ceiling),
    // The band is the whole space the arc has to live in, so "where they are" is expressed as a
    // position within it rather than as a bpm invented from the axis.
    bpm: Math.round(clamp(center - width + here * 2 * width, center - width, center + width)),
  };
}

/**
 * The arc's destination. `direction` comes from the taxonomy (−1 down-regulating, 0 flat,
 * +1 activating) and is the ONLY thing that decides which way the arc points — this module has no
 * opinion of its own about whether a state should be brought up or down.
 */
function destination(start, direction, demand, targets) {
  const floor = finite(targets.energyFloor) ?? 0;
  const ceiling = finite(targets.energyCeiling) ?? 1;
  const center = finite(targets.bpmCenter) ?? 100;
  const width = finite(targets.bpmWidth) ?? 10;

  // Travel scales with how much the moment is asking for, with a floor so a flat arc is still an
  // arc: a state whose policy is to come down comes down a little even on an ordinary day.
  const travel = direction === 0 ? 0 : (0.15 + 0.35 * demand) * direction;
  const energy = clamp(start.energy + travel * (ceiling - floor), floor, ceiling);
  const spanFraction = (ceiling - floor) > 1e-9 ? (energy - start.energy) / (ceiling - floor) : 0;
  const bpm = Math.round(clamp(start.bpm + spanFraction * 2 * width, center - width, center + width));
  return { energy: round3(energy), bpm };
}

/**
 * Decorate `targets` with regulation and a trajectory.
 *
 * Returns the SAME object, untouched, whenever there is nothing honest to say: no affect, no
 * reported label, a label the taxonomy does not contain, a label below the confidence floor, an
 * already-decorated target, or the kill switch. `Object.is(out, targets)` in those cases, so a
 * caller can prove the no-op rather than compare fields.
 */
function apply(targets, affect, opts = {}) {
  if (targets === null || typeof targets !== 'object' || Array.isArray(targets)) {
    throw new TypeError('wellbeingRegulator.apply: `targets` must be the translate() target object');
  }
  if (opts?.disabled === true) return targets;
  // Already decorated. Applying twice would compound the cut, and the serving path has more than
  // one place a decorator could plausibly be called from.
  if (targets.trajectory !== undefined) return targets;

  const label = typeof affect?.label === 'string' ? affect.label : null;
  const state = label ? byId(label) : null;
  if (!state) return targets;
  if (clamp01(finite(affect?.confidence) ?? 0) < MIN_REGULATION_CONFIDENCE) return targets;

  const axes = affect?.axes;
  const policy = state.musicPolicy;
  const demand = regulationDemand(axes);
  const direction = ARCHETYPE_DIRECTION[policy.trajectoryArchetype] ?? 0;

  // ── the tightening half ──
  // An explicit activity chip is a direct intent translate() has already honoured; the arc
  // regulates it instead of the band (§0.2.6). And an activating state is never cut at all —
  // there is nothing to protect a listener from in a state whose own policy is to lift.
  const mayCapEnergy = !targets.activityDriven && direction <= 0 && policy.energyBias <= 0;

  let energyCeiling = finite(targets.energyCeiling) ?? 1;
  let energyFloor = finite(targets.energyFloor) ?? 0;
  if (mayCapEnergy && demand > 0) {
    const cut = demand * MAX_CEILING_CUT;
    const capped = Math.max(MIN_ENERGY_GAP, energyCeiling - cut);
    energyCeiling = tightenDown(energyCeiling, capped);
    energyFloor = tightenDown(energyFloor, Math.max(0, energyCeiling - MIN_ENERGY_GAP));
  }

  const acousticIn = finite(targets.acousticnessBias) ?? 0;
  const instrumentalIn = finite(targets.instrumentalBias) ?? 0;
  const acousticnessBias = tightenUp(
    acousticIn, acousticIn + demand * MAX_TEXTURE_LIFT * policy.textureBias.acousticness, TEXTURE_CAP,
  );
  const instrumentalBias = tightenUp(
    instrumentalIn, instrumentalIn + demand * MAX_TEXTURE_LIFT * policy.textureBias.instrumentalness, TEXTURE_CAP,
  );

  // Predictability regulates — the same reasoning translate() uses when stress narrows its window.
  const bpmWidth = Math.max(
    MIN_BPM_WIDTH,
    Math.min(
      finite(targets.bpmWidth) ?? MIN_BPM_WIDTH,
      Math.round((finite(targets.bpmWidth) ?? MIN_BPM_WIDTH) * (1 - MAX_WIDTH_SHRINK * demand)),
    ),
  );

  // ── the trajectory half ──
  const banded = { ...targets, energyFloor, energyCeiling, bpmWidth };
  const start = meetingPoint(axes, banded);
  const end = destination(start, direction, demand, banded);
  const trajectory = Object.freeze({
    v: TRAJECTORY_VERSION,
    archetype: policy.trajectoryArchetype,
    direction,
    valenceApproach: policy.valenceApproach,
    start: Object.freeze({ energy: round3(start.energy), bpm: start.bpm }),
    end: Object.freeze({ energy: end.energy, bpm: end.bpm }),
    // Lets W4-008 lower the PEAK of an activating arc for a depleted body without touching the
    // hard band — the only regulation available when the listener has asked to train.
    intensityScale: round3(1 - MAX_INTENSITY_SCALE_CUT * demand),
  });

  return {
    ...targets,
    energyFloor,
    energyCeiling,
    acousticnessBias,
    instrumentalBias,
    bpmWidth,
    // ── additive only, §0.2.5 ──
    stateId: state.id,
    trajectory,
    regulator: { v: REGULATOR_VERSION, demand: round3(demand) },
    // S15 house telemetry. Tokens and one-decimal ratios; no vital reaches this line, and the
    // state id is internal closed vocabulary rather than display copy (R10).
    telemetry: `[regulator] v=${REGULATOR_VERSION} state=${state.id} band=${state.band} `
      + `demand=${round3(demand)} arc=${policy.trajectoryArchetype} dir=${direction} `
      + `capped=${mayCapEnergy && demand > 0} scale=${round3(1 - MAX_INTENSITY_SCALE_CUT * demand)}`,
  };
}

module.exports = {
  apply,
  regulationDemand,
  meetingPoint,
  destination,
  ramp,
  REGULATOR_VERSION,
  TRAJECTORY_VERSION,
  DISABLE_ENV_VAR,
  MIN_REGULATION_CONFIDENCE,
  STRESS_ONSET,
  STRESS_FULL,
  RECOVERY_ONSET,
  RECOVERY_FLOOR,
  STRESS_SHARE,
  MAX_CEILING_CUT,
  MAX_TEXTURE_LIFT,
  TEXTURE_CAP,
  MAX_WIDTH_SHRINK,
  MIN_BPM_WIDTH,
  MIN_ENERGY_GAP,
  MAX_INTENSITY_SCALE_CUT,
};
