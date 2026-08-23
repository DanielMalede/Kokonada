'use strict';

/**
 * W4-D63 — TAXONOMY COVERAGE, AS A MEASUREMENT RATHER THAN A CLAIM.
 *
 * W4-015's first Definition of Done is "every taxonomy state hit". The full-stack soak could not
 * demonstrate it: measured over the whole persona population for a simulated day it resolved 11
 * of the 34 states, and asserted only `hit.length > 2` — a floor, honest about being one, but not
 * something a closeout can cite.
 *
 * The reflex reading is "the corpus is too small: simulate more days". That was measured and it
 * is wrong. The limit is the SEAM. `stateTaxonomy` classifies a point in seven axes, and each
 * axis only carries mass when some lane actually supplied its evidence:
 *
 *   · `liveStateAdapter.onlineUpdate` → `resolveAffect({ live, baselines })`
 *       heart rate + activity + the personal baseline blob. Nothing else. Every state whose
 *       `requiredSignals` include recovery or fatigue is therefore unreachable on this lane no
 *       matter how many days are simulated, because sleep, HRV, body battery and readiness never
 *       cross it.
 *   · `targetsBuilder.buildTargets`   → `resolveAffect({ live, baselines, state, sleep, taps })`
 *       the richest production lane: adds the MedicalProfile scalars, last night's sleep and the
 *       user's mood tap.
 *
 * So the useful artifact is not a bigger soak, it is a per-lane number plus, for every state the
 * lane did NOT reach, the reason drawn from that state's own run — which of ITS required axes
 * carried zero mass. That distinguishes the two failures that matter and look identical from a
 * histogram: a state the lane is STRUCTURALLY blind to (evidence never arrives) versus a state
 * the lane can see but that lost the contest to a neighbour (a tuning question).
 *
 * This module is that fold, and nothing else: (target, reported label, per-axis mass) triples in,
 * a report out. Pure — no clock, no randomness, no I/O (§0.4 S9) — so the reasoning can be pinned
 * exhaustively in milliseconds while `tests/sim.stateCoverage.soak.test.js` pays the real cost of
 * producing the triples from the real seams.
 */

/**
 * The closed vocabulary of "why was this state not reached". Closed on purpose: an open-ended
 * free-text reason is the thing W4-D63 is replacing, and W4-015 needs to be able to group misses
 * rather than read 23 sentences.
 */
const MISS_REASONS = Object.freeze({
  /** At least one axis this state REQUIRES carried no mass — the lane never supplies it. */
  SIGNAL_ABSENT: 'required-signal-absent',
  /** Every required axis carried evidence; another state won the posterior. */
  OUTCOMPETED: 'outcompeted',
  /** The run produced no label at all (below every state's entry bar, or the engine abstained). */
  NO_LABEL: 'no-label',
});

const EXPLAIN = Object.freeze({
  [MISS_REASONS.SIGNAL_ABSENT]: (m) => `lane supplies no evidence for ${m.abstainedRequired.join(', ')}`,
  [MISS_REASONS.OUTCOMPETED]: (m) => `all required axes had evidence; ${m.reportedInstead} won the posterior`,
  [MISS_REASONS.NO_LABEL]: (m) => (m.abstainedRequired.length
    ? `no label resolved; ${m.abstainedRequired.join(', ')} carried no evidence`
    : 'no label resolved despite evidence on every required axis'),
});

/**
 * Did this axis carry evidence in this run?
 *
 * Every non-positive, non-finite, missing or malformed mass reads as ABSTAINED. The direction is
 * deliberate: the whole point of the report is to distinguish "the lane cannot see this" from
 * "the lane saw it and chose otherwise", and guessing "saw it" from a `NaN` would file a
 * structural blind spot as a tuning problem — the more expensive of the two mistakes to make.
 */
function carriedEvidence(axes, name) {
  const mass = axes && axes[name] ? axes[name].mass : null;
  return typeof mass === 'number' && Number.isFinite(mass) && mass > 0;
}

/**
 * Fold one lane's runs into a coverage report.
 *
 * @param {object}   opts
 * @param {string}   opts.lane      — which production seam produced these runs ('live', 'serving'…)
 * @param {Array}    opts.states    — the taxonomy (`stateTaxonomy.STATES`), injected like every
 *                                    other state-set port in this wave so the report can be pinned
 *                                    against a fixture rather than against production truth.
 * @param {Array}    opts.results   — one entry per script run:
 *                                    `{ target, persona, label, axes: { <axis>: { mass } } }`
 *                                    `target` is the state the script was authored to produce;
 *                                    `label` is what the lane actually reported (null = none).
 * @returns {object} `{ lane, taxonomySize, targetedCount, reachedCount, coverage, reached,
 *                      missed, untargeted, unknownLabels, line }`
 */
function measureStateCoverage({ lane = 'unknown', states = [], results = [] } = {}) {
  const byId = new Map(states.map((s) => [s.id, s]));

  // A target that is not a state means the corpus and the taxonomy have drifted apart, which
  // would silently deflate every number below it. Loud, not lenient.
  for (const r of results) {
    if (!byId.has(r.target)) {
      throw new RangeError(`sim/stateCoverage: result targets unknown state '${r.target}'`);
    }
  }

  const targeted = new Map(); // state id → the run that aimed at it (last one wins)
  for (const r of results) targeted.set(r.target, r);

  const reached = new Set();
  const unknown = new Set();
  for (const r of results) {
    if (r.label == null) continue;
    if (byId.has(r.label)) reached.add(r.label);
    else unknown.add(r.label);
  }

  const missed = [];
  for (const [id, run] of targeted) {
    if (reached.has(id)) continue;
    const required = byId.get(id).requiredSignals || [];
    const abstainedRequired = required.filter((a) => !carriedEvidence(run.axes, a)).sort();
    const reason = abstainedRequired.length
      ? MISS_REASONS.SIGNAL_ABSENT
      : (run.label == null ? MISS_REASONS.NO_LABEL : MISS_REASONS.OUTCOMPETED);
    // NO_LABEL is checked after SIGNAL_ABSENT on purpose: when both are true the absent evidence
    // is the CAUSE and "no label" is its symptom, and a report that files the symptom sends the
    // reader looking at thresholds instead of at the seam.
    const miss = {
      id,
      persona: run.persona ?? null,
      reportedInstead: run.label ?? null,
      requiredSignals: [...required],
      abstainedRequired,
      reason,
    };
    miss.explain = EXPLAIN[reason](miss);
    missed.push(miss);
  }
  missed.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const untargeted = states.map((s) => s.id).filter((id) => !targeted.has(id));
  const targetedCount = targeted.size;
  // `reachedCount` is a fact about the LANE — every distinct real state it produced, including
  // ones no script aimed at. `coverage` is a fact about the CORPUS, so it is the targeted states
  // that were hit, which is `targeted - missed` and NOT `reached / targeted`.
  //
  // The two differ only when a run lands outside the targeted set, which is exactly what the
  // strided smoke scope invites: six scripts whose runs all drift onto neighbouring states would
  // give `reached = 6, targeted = 6` and report coverage 1.0 for a sweep that missed everything
  // it aimed at. It can also exceed 1. Over the full 34-script sweep the two are identical, which
  // is why the wrong one looks right until the day it is used on a subset.
  const reachedCount = reached.size;
  const coverage = targetedCount === 0 ? 0 : (targetedCount - missed.length) / targetedCount;

  const report = {
    lane,
    taxonomySize: states.length,
    targetedCount,
    reachedCount,
    coverage,
    reached: [...reached].sort(),
    missed,
    untargeted,
    unknownLabels: [...unknown].sort(),
  };
  report.line = `[sim.coverage] lane=${lane} taxonomy=${report.taxonomySize} targeted=${targetedCount} `
    + `reached=${reachedCount} coverage=${coverage.toFixed(3)} missed=${missed.length} `
    + `untargeted=${untargeted.length} blindSpots=${missed.filter((m) => m.reason === MISS_REASONS.SIGNAL_ABSENT).length}`;
  return report;
}

/**
 * How much of the corpus a run should sweep — W4-D60's rule (the soak's SCALE is what scales, not
 * its coverage) applied to the 34 scripts instead of to the persona list.
 *
 * The default sample is STRIDED, not the first N. The corpus is grouped by domain — six rest
 * scripts, then stress, focus, exertion, circadian, mood — so `slice(0, 6)` would run rest six
 * times and report a confident number about a sixth of the taxonomy. A stride spans the groups,
 * which is what makes the cheap default a genuine (if coarse) signal rather than a comforting one.
 */
function coverageScope(scripts = [], { full = false, sample = 6 } = {}) {
  if (full || sample >= scripts.length) return [...scripts];
  const stride = scripts.length / sample;
  const out = [];
  for (let i = 0; i < sample; i++) out.push(scripts[Math.floor(i * stride)]);
  return out;
}

/**
 * The missed list as one line per state, for a soak log or a closeout appendix. Kept here rather
 * than in the test so the report and its rendering cannot drift apart.
 */
function formatMisses(report) {
  return report.missed.map((m) => `[sim.coverage] lane=${report.lane} unreached=${m.id} `
    + `reason=${m.reason} requires=${m.requiredSignals.join('|') || 'none'} `
    + `absent=${m.abstainedRequired.join('|') || 'none'} got=${m.reportedInstead ?? 'none'}`);
}

module.exports = { measureStateCoverage, coverageScope, formatMisses, MISS_REASONS };
