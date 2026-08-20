'use strict';

/**
 * A4 — THE STATE TAXONOMY (W4-006).
 *
 * The affect engine (W4-005) deliberately does NOT contain a state table: it takes one as an
 * injected port and runs §M.5's HMM over whatever it is given. This file is that port's only
 * production payload — ~34 states over 6 domains, each a Gaussian region in the engine's
 * seven-axis affect space, each carrying the music policy the serving path acts on.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THE WIDTHS ARE NOT AUTHORED
 *
 * §M.5's emission is  log b_s(e) = Σ_a m_a · ( −½·d_a² − log σ_{s,a} − ½log 2π ).
 *
 * The `−log σ` term is not decoration: it is the Bayesian reward for making a sharper claim. A
 * state authored with tighter widths therefore beats an equally-well-fitting state with looser
 * ones, on precision alone. The affect engine's own header calls this out as a lever ("a state
 * authored with an implausibly tight width will dominate whenever it happens to fit"), and in a
 * table of this size, hand-authored widths drift into exactly that within a few edits — silently,
 * because nothing about the symptom points back at the cause.
 *
 * So the author declares, per axis, a ROLE — what this axis is FOR in this state — and the module
 * solves for the widths:
 *
 *     σ_a = exp(−k · w_role(a)),   k chosen so that   Σ_a −log σ_a = LOG_PRECISION_BUDGET
 *
 * Every state spends the same total precision. The peak emission is therefore IDENTICAL for
 * every state in the table, and a state can only win by being CLOSER to the evidence — never by
 * claiming harder. The budget itself is one honest number: the geometric mean of a state's seven
 * widths is `GEOMETRIC_MEAN_WIDTH`, i.e. an average claim of "this axis lies within a quarter of
 * its range". Everything else follows from the roles.
 *
 * A second consequence falls out for free and is worth stating, because it is the part that
 * makes the table authorable at all: a state that claims MORE axes must claim each of them more
 * loosely. Specificity is conserved. That is the correct trade-off and it is now structural
 * rather than a matter of the author's restraint.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY EVERY STATE CONSTRAINS EVERY AXIS ("no free passes")
 *
 * The engine skips axes a region omits. An omitted axis is therefore a FREE PASS: a state that
 * says nothing about valence pays nothing when valence contradicts it, and can out-score a state
 * that does model valence and is right. The first draft of this table lost `creative-flow` to
 * `deep-focus` at creative-flow's own centre for precisely that reason — the only axis that
 * separates them is the one deep-focus had declined to have an opinion about.
 *
 * So every state constrains all seven axes. An axis a state genuinely has no opinion about is
 * declared `agnostic`, which spends almost none of the budget: its width comes out above
 * 1/√(2π) ≈ 0.399, the point where the precision term turns NEGATIVE, so an agnostic claim is
 * near-flat and mildly self-penalising. Saying "I don't know" costs a little. It should.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT THIS TABLE CANNOT DO, SAID OUT LOUD
 *
 * 1. `arousal` and `exertion` are both monotone in heart rate, so they are near-collinear for a
 *    single reading. They dissociate only through arousal's declared-mood fusion and exertion's
 *    activity prior — which is exactly how `cooldown` (activity dropped, heart rate still up)
 *    separates from `warmup` here. Any future state that needs those two to disagree without one
 *    of those two inputs is not expressible.
 *
 * 2. The circadian axis carries alertness MAGNITUDE, not phase SIGN. A cosinor is symmetric
 *    about its acrophase, so the rising limb of the morning and the falling limb of the evening
 *    are the same number. `morning-sluggish` and `evening-unwind` are therefore separated here by
 *    fatigue and arousal rather than by the clock, which is weaker than it should be.
 *    `chronobiology.circadianAlertness` already computes `phase`; the affect engine drops it.
 *    Queued as a discovered item rather than fixed here — this task owns the taxonomy, not the
 *    engine's axis set.
 *
 * 3. Thirty-four states over seven axes cannot all be far apart. Rather than pretend otherwise,
 *    the suite measures every pair's separation and requires that any pair close enough to be
 *    confused must be MUSICALLY INTERCHANGEABLE — same band, same trajectory family, similar
 *    energy bias. An unavoidable modelling limit is thereby converted into a bounded one: the
 *    model may be unsure, but the listener cannot hear the difference.
 *
 * PURE. No clock, no randomness, no environment, no I/O (S9). The serving-path kill switch for
 * anything built on this table is owned by the wiring half, and its name is exported below so
 * the two halves cannot drift on it.
 */

const { AXIS_NAMES, NEUTRAL } = require('../physiology/affectEngine');

const TAXONOMY_VERSION = 1;

// ── the vocabularies, all closed ────────────────────────────────────────────────────────────

const DOMAINS = Object.freeze(['rest', 'stress', 'focus', 'movement', 'rhythm', 'emotional']);
const BANDS = Object.freeze(['resting', 'active', 'peak']);

/**
 * What an axis is FOR in a state.
 *   defining    — the state is ABOUT this axis; being wrong here means it is the wrong state
 *   supporting  — corroborates the defining axes; wrong here weakens the claim
 *   contextual  — a weak expectation, present mostly to deny a free pass to a rival
 *   agnostic    — no opinion; sits at the engine's neutral and stays near-flat
 */
const AXIS_ROLES = Object.freeze(['defining', 'supporting', 'contextual', 'agnostic']);
const ROLE_WEIGHTS = Object.freeze({
  defining: 2.0, supporting: 1.4, contextual: 1.0, agnostic: 0.55,
});

/**
 * The geometric mean of a state's seven widths, in NORMALISED axis units. The single number the
 * whole width solver is derived from: "on average, a state claims an axis lies within a quarter
 * of the range that axis can actually reach".
 */
const GEOMETRIC_MEAN_WIDTH = 0.25;
const LOG_PRECISION_BUDGET = -AXIS_NAMES.length * Math.log(GEOMETRIC_MEAN_WIDTH);

/**
 * THE ATTAINABLE ENVELOPE — and the reason centres in the table below are normalised rather than
 * raw axis values.
 *
 * An affect axis is not a free variable in [0,1]. `blend()` fuses the evidence with the engine's
 * NEUTRAL prior at `AXIS_PRIOR_MASS`, so an axis whose evidence mass tops out at m can only ever
 * reach `m·1 + (1−m)·neutral`. Several axes are squeezed further by their own weights: exertion
 * is dragged toward the stated activity's prior, and fatigue carries `FATIGUE_WEIGHTS.debt`, so
 * it cannot pass ~0.48 no matter how ruinous the sleep history is.
 *
 * The first draft of this table was authored in raw units and eight states were consequently
 * UNREACHABLE — `peak-effort` sat at exertion 0.94 against an engine that cannot emit above 0.78,
 * `low-mood-low-energy` at valence 0.14 against a floor of 0.14, every heavily-fatigued state
 * above a ceiling of 0.48. The reachability suite caught it; nothing else would have, because an
 * unreachable state is silent rather than wrong.
 *
 * MEASURED, not assumed: min/max over 5.8M evidence vectors — five personas × a coherent grid of
 * heart rate (−0.15 to 1.05 of reserve), activity label, hrv ratio, sleep, multi-week debt,
 * battery, readiness, hour and saturated mood taps — through the real `computeAxes` against real
 * `computeBaselineBlob` baselines (`sim/` personas, 21 days each). Rounded outward by a hair.
 *
 * Regions are therefore authored in [0,1] NORMALISED units, where 0 is the lowest an axis is
 * known to go and 1 the highest, and both centres and widths are mapped through the same affine
 * transform. Every geometric property the suite pins — peak equality, separation in units of σ,
 * argmax-at-centre — is invariant under that map, so the taxonomy can be REASONED about in
 * normalised space and still speak the engine's units.
 */
const AXIS_RANGE = Object.freeze({
  arousal: Object.freeze({ lo: 0.10, hi: 0.90 }),
  stress: Object.freeze({ lo: 0.04, hi: 0.85 }),
  recovery: Object.freeze({ lo: 0.19, hi: 0.90 }),
  exertion: Object.freeze({ lo: 0.03, hi: 0.78 }),
  fatigue: Object.freeze({ lo: 0.06, hi: 0.48 }),
  circadianAlertness: Object.freeze({ lo: 0.14, hi: 0.84 }),
  valence: Object.freeze({ lo: 0.14, hi: 0.86 }),
});

const spanOf = (axis) => AXIS_RANGE[axis].hi - AXIS_RANGE[axis].lo;
/** normalised → raw engine units */
const toRaw = (axis, norm) => AXIS_RANGE[axis].lo + norm * spanOf(axis);
/** raw engine units → normalised */
const toNorm = (axis, raw) => (raw - AXIS_RANGE[axis].lo) / spanOf(axis);

/** How the regulator is allowed to move valence. There is deliberately no value meaning FORCE. */
const VALENCE_APPROACHES = Object.freeze(['meet', 'sustain', 'lift-gently']);

/**
 * W4-008's archetype vocabulary, each tagged with the DIRECTION its arc moves energy in:
 * −1 down-regulating, 0 flat, +1 activating.
 *
 * Direction rather than a coarser "family" label, because direction is what a listener can
 * actually be harmed by. Two confusable states whose arcs are flat-versus-falling differ by
 * something nobody can name; two whose arcs are RISING versus FALLING give the listener the
 * opposite of what the state asked for, which is the mirror failure VISION §6 exists to prevent.
 * The confusability guard therefore forbids opposing directions and permits the adjacent ones.
 */
const ARCHETYPE_DIRECTION = Object.freeze({
  'monotone-wind-down': -1,
  'meet-then-lower': -1,
  'flat-focus': 0,
  'cadence-locked': 0,
  steady: 0,
  'warmup-peak-cooldown': 1,
  'gentle-lift': 1,
});
const TRAJECTORY_ARCHETYPES = Object.freeze(Object.keys(ARCHETYPE_DIRECTION));

/**
 * The axes whose evidence comes from the LIVE WRIST SIGNAL — heart rate and HRV. `degraded` is
 * derived from this set, never declared, so the two cannot drift apart.
 *
 * The first version of this listed only `arousal` and `exertion`, on the reasoning that those are
 * the heart-rate-derived ones. The reachability suite falsified it in the most useful way: under
 * a degraded (mood-only) run, `arousal` still carries mass — from the user's own mood taps — and
 * `exertion` still carries the activity prior, so states requiring them were NOT excluded and the
 * flag was asserting something untrue. What actually distinguishes the two classes is the SOURCE:
 * arousal, exertion and stress are statements about the body's live signal, while recovery,
 * fatigue, circadian alertness and valence come from sleep, the clock and the person's own word,
 * and survive a dead sensor intact.
 *
 * The guarantee this buys, and the one the reachability suite pins: given ONLY passive evidence —
 * no heart rate, no HRV, no taps — every label the engine reports is one of these degraded-safe
 * states. It never names a bodily state on the strength of a clock.
 */
const HR_DEPENDENT_AXES = Object.freeze(['arousal', 'exertion', 'stress']);

/** The env var the WIRING half must honour (S11). Read there, never here — this module is pure. */
const DISABLE_ENV_VAR = 'WAVE4_AFFECT_DISABLED';

// ── threshold scaling ───────────────────────────────────────────────────────────────────────

/**
 * Enter/exit thresholds are expressed as MULTIPLES OF THE UNIFORM PRIOR, not as absolutes.
 *
 * The engine's defaults (0.35 / 0.15) were written against a 6-state fixture, where uniform is
 * 0.167 and 0.35 means "twice as likely as chance". Over 34 states uniform is 0.029, and a fixed
 * 0.35 would mean "twelve times chance" — a bar a correct posterior rarely clears, which would
 * leave most of this table permanently unreachable. Expressing the bar as a multiple keeps its
 * MEANING fixed as the table grows, and makes adding a state a safe edit.
 */
const ENTER_PRIOR_MULTIPLE = Object.freeze({ fallback: 3.5, normal: 4.5, loud: 6.0 });
const EXIT_FRACTION_OF_ENTER = 0.5;

/** Per-domain dwell defaults: how long a state of this kind plausibly lasts. */
const DOMAIN_DWELL = Object.freeze({
  rest: { minDwellSec: 300, dwellTauSec: 1200 },
  stress: { minDwellSec: 180, dwellTauSec: 600 },
  focus: { minDwellSec: 300, dwellTauSec: 900 },
  movement: { minDwellSec: 120, dwellTauSec: 300 },
  rhythm: { minDwellSec: 600, dwellTauSec: 1800 },
  emotional: { minDwellSec: 300, dwellTauSec: 900 },
});

// ── the table ───────────────────────────────────────────────────────────────────────────────
//
// `axes` lists ONLY the axes this state has an opinion about, as [centre, role]. Everything
// omitted becomes agnostic at the engine's neutral — see "no free passes" above.
// `policy` is [energyBias, valenceApproach, acousticnessBias, instrumentalnessBias, archetype].

const TABLE = [
  // ── Rest & Recovery ───────────────────────────────────────────────────────────────────────
  {
    id: 'deep-rest', domain: 'rest', band: 'resting',
    axes: { arousal: [0.12, 'defining'], exertion: [0.04, 'defining'], stress: [0.12, 'supporting'], recovery: [0.70, 'contextual'], circadianAlertness: [0.30, 'contextual'] },
    required: ['arousal', 'exertion'],
    policy: [-0.35, 'meet', 0.25, 0.15, 'monotone-wind-down'],
    explain: ['Slow and spacious, to stay out of the way of a body that has settled.', ['arousal', 'exertion']],
  },
  {
    id: 'meditative', domain: 'rest', band: 'resting',
    axes: { arousal: [0.28, 'defining'], stress: [0.07, 'defining'], exertion: [0.06, 'supporting'], recovery: [0.70, 'contextual'], valence: [0.60, 'contextual'] },
    required: ['arousal', 'stress'],
    policy: [-0.30, 'sustain', 0.30, 0.25, 'flat-focus'],
    explain: ['Even and uncluttered, holding a steady calm rather than steering it.', ['arousal', 'stress']],
  },
  {
    id: 'resting-content', domain: 'rest', band: 'resting',
    axes: { arousal: [0.36, 'defining'], stress: [0.16, 'defining'], exertion: [0.10, 'supporting'], recovery: [0.65, 'contextual'], valence: [0.60, 'contextual'], fatigue: [0.24, 'contextual'], circadianAlertness: [0.50, 'contextual'] },
    required: ['arousal'],
    policy: [-0.15, 'meet', 0.12, 0.05, 'steady'],
    explain: ['Unhurried and warm, matching an easy moment without pushing it anywhere.', ['arousal', 'stress']],
  },
  {
    id: 'drowsy-low-battery', domain: 'rest', band: 'resting',
    axes: { recovery: [0.12, 'defining'], fatigue: [0.80, 'defining'], arousal: [0.30, 'supporting'], circadianAlertness: [0.45, 'supporting'], exertion: [0.08, 'contextual'] },
    required: ['recovery', 'fatigue'],
    policy: [-0.30, 'lift-gently', 0.22, 0.10, 'monotone-wind-down'],
    explain: ['Gentle and undemanding, for a day that has very little left in it.', ['recovery', 'fatigue']],
  },
  {
    id: 'post-exertion-recovery', domain: 'rest', band: 'resting',
    axes: { exertion: [0.08, 'defining'], arousal: [0.66, 'defining'], recovery: [0.42, 'supporting'], fatigue: [0.50, 'supporting'], stress: [0.28, 'contextual'], circadianAlertness: [0.50, 'contextual'] },
    required: ['exertion', 'arousal'],
    policy: [-0.25, 'meet', 0.18, 0.08, 'monotone-wind-down'],
    explain: ['Coming down from effort — meeting the pace, then letting it fall away.', ['exertion', 'arousal']],
  },
  {
    id: 'sleep-onset-wind-down', domain: 'rest', band: 'resting',
    axes: { circadianAlertness: [0.12, 'defining'], arousal: [0.20, 'defining'], exertion: [0.05, 'supporting'], stress: [0.16, 'contextual'], fatigue: [0.45, 'contextual'] },
    required: ['circadianAlertness', 'arousal'],
    policy: [-0.40, 'sustain', 0.32, 0.28, 'monotone-wind-down'],
    explain: ['Quiet and receding, shaped for the end of a day rather than the middle of one.', ['circadianAlertness', 'arousal']],
  },

  // ── Stress & Regulation ───────────────────────────────────────────────────────────────────
  {
    id: 'acute-stress', domain: 'stress', band: 'resting',
    axes: { stress: [0.90, 'defining'], arousal: [0.74, 'defining'], exertion: [0.12, 'supporting'], recovery: [0.45, 'contextual'], fatigue: [0.35, 'contextual'] },
    required: ['stress', 'arousal'],
    policy: [-0.30, 'meet', 0.30, 0.20, 'meet-then-lower'],
    explain: ['Starting close to where things are, then easing the pace down from there.', ['stress', 'arousal']],
  },
  {
    id: 'simmering-tension', domain: 'stress', band: 'resting',
    axes: { stress: [0.62, 'defining'], arousal: [0.48, 'defining'], exertion: [0.12, 'supporting'], recovery: [0.55, 'contextual'], valence: [0.42, 'contextual'] },
    required: ['stress'],
    policy: [-0.20, 'meet', 0.22, 0.12, 'meet-then-lower'],
    explain: ['Steady and predictable, giving a wound-up hour something even to lean on.', ['stress', 'arousal']],
  },
  {
    id: 'anxious-restless', domain: 'stress', band: 'resting',
    axes: { stress: [0.72, 'defining'], arousal: [0.88, 'defining'], exertion: [0.26, 'supporting'], fatigue: [0.48, 'contextual'], recovery: [0.45, 'contextual'] },
    required: ['stress', 'arousal'],
    policy: [-0.25, 'meet', 0.26, 0.18, 'meet-then-lower'],
    explain: ['Meeting a restless edge first, then narrowing towards something steadier.', ['stress', 'arousal']],
  },
  {
    id: 'overload-needs-downshift', domain: 'stress', band: 'resting',
    axes: { stress: [0.80, 'defining'], recovery: [0.16, 'defining'], fatigue: [0.80, 'defining'], arousal: [0.58, 'supporting'], circadianAlertness: [0.35, 'supporting'] },
    required: ['stress', 'recovery', 'fatigue'],
    policy: [-0.45, 'lift-gently', 0.34, 0.24, 'meet-then-lower'],
    explain: ['Pulling the demand right down, because there is nothing left to spend.', ['stress', 'recovery', 'fatigue']],
  },
  {
    id: 'recovering-from-stress', domain: 'stress', band: 'resting',
    axes: { stress: [0.40, 'defining'], arousal: [0.46, 'defining'], recovery: [0.58, 'supporting'], circadianAlertness: [0.55, 'supporting'], exertion: [0.08, 'supporting'], fatigue: [0.40, 'contextual'] },
    required: ['stress'],
    policy: [-0.10, 'lift-gently', 0.14, 0.06, 'steady'],
    explain: ['Settling — keeping things level while the edge finishes coming off.', ['stress', 'arousal']],
  },

  // ── Focus & Cognitive ─────────────────────────────────────────────────────────────────────
  {
    id: 'deep-focus', domain: 'focus', band: 'active',
    axes: { circadianAlertness: [0.78, 'defining'], arousal: [0.54, 'defining'], stress: [0.24, 'supporting'], exertion: [0.10, 'supporting'], valence: [0.55, 'contextual'] },
    required: ['circadianAlertness', 'arousal'],
    policy: [0.0, 'sustain', 0.10, 0.35, 'flat-focus'],
    explain: ['Low-variance and wordless, so attention has nothing to catch on.', ['circadianAlertness', 'arousal']],
  },
  {
    id: 'light-focus', domain: 'focus', band: 'resting',
    axes: { circadianAlertness: [0.54, 'defining'], arousal: [0.44, 'defining'], stress: [0.20, 'supporting'], exertion: [0.08, 'supporting'], valence: [0.52, 'contextual'], fatigue: [0.22, 'contextual'] },
    required: ['arousal'],
    policy: [-0.05, 'sustain', 0.14, 0.28, 'flat-focus'],
    explain: ['Present but undemanding, for work that does not need silence.', ['circadianAlertness', 'arousal']],
  },
  {
    id: 'creative-flow', domain: 'focus', band: 'active',
    axes: { valence: [0.84, 'defining'], arousal: [0.60, 'defining'], circadianAlertness: [0.70, 'supporting'], stress: [0.18, 'supporting'], exertion: [0.12, 'contextual'] },
    required: ['valence', 'arousal'],
    policy: [0.10, 'sustain', 0.06, 0.20, 'steady'],
    explain: ['Bright and continuous, staying out of the way of something already going well.', ['valence', 'arousal']],
  },
  {
    id: 'mental-fatigue', domain: 'focus', band: 'resting',
    axes: { fatigue: [0.72, 'defining'], circadianAlertness: [0.62, 'defining'], arousal: [0.44, 'supporting'], recovery: [0.42, 'supporting'], stress: [0.34, 'contextual'] },
    required: ['fatigue', 'circadianAlertness'],
    policy: [-0.25, 'lift-gently', 0.20, 0.22, 'flat-focus'],
    explain: ['Simple and low-effort, for a tired mind in the middle of an alert day.', ['fatigue', 'circadianAlertness']],
  },
  {
    id: 'restless-distracted', domain: 'focus', band: 'resting',
    axes: { arousal: [0.70, 'defining'], stress: [0.42, 'defining'], circadianAlertness: [0.44, 'supporting'], exertion: [0.12, 'supporting'], valence: [0.42, 'contextual'] },
    required: ['arousal', 'stress'],
    policy: [-0.15, 'meet', 0.18, 0.24, 'meet-then-lower'],
    explain: ['Repetitive and narrow, to give a scattered stretch one thing to hold.', ['arousal', 'stress']],
  },

  // ── Movement & Exertion ───────────────────────────────────────────────────────────────────
  {
    id: 'warmup', domain: 'movement', band: 'active',
    axes: { exertion: [0.44, 'defining'], arousal: [0.50, 'defining'], stress: [0.20, 'supporting'], recovery: [0.62, 'contextual'], fatigue: [0.28, 'contextual'] },
    required: ['exertion', 'arousal'],
    policy: [0.25, 'sustain', 0.0, 0.0, 'warmup-peak-cooldown'],
    explain: ['Building, so the pace arrives where the body is going rather than where it is.', ['exertion', 'arousal']],
  },
  {
    id: 'steady-cardio', domain: 'movement', band: 'active',
    axes: { exertion: [0.64, 'defining'], arousal: [0.72, 'defining'], stress: [0.22, 'supporting'], recovery: [0.58, 'contextual'], circadianAlertness: [0.55, 'contextual'] },
    required: ['exertion', 'arousal'],
    policy: [0.40, 'sustain', 0.0, 0.0, 'cadence-locked'],
    explain: ['Locked to a working rhythm and held there.', ['exertion', 'arousal']],
  },
  {
    id: 'peak-effort', domain: 'movement', band: 'peak',
    axes: { exertion: [0.94, 'defining'], arousal: [0.94, 'defining'], stress: [0.30, 'supporting'], recovery: [0.55, 'contextual'], fatigue: [0.30, 'contextual'] },
    required: ['exertion', 'arousal'],
    policy: [0.55, 'sustain', 0.0, 0.0, 'cadence-locked'],
    explain: ['Full intensity, held flat so nothing drops underneath the effort.', ['exertion', 'arousal']],
  },
  {
    id: 'intervals', domain: 'movement', band: 'peak',
    axes: { exertion: [0.74, 'defining'], arousal: [0.80, 'defining'], stress: [0.40, 'supporting'], recovery: [0.55, 'contextual'], fatigue: [0.36, 'contextual'] },
    required: ['exertion', 'arousal'],
    policy: [0.45, 'sustain', 0.0, 0.0, 'warmup-peak-cooldown'],
    explain: ['Swinging between hard and easy, in step with the work itself.', ['exertion', 'arousal']],
  },
  {
    id: 'cooldown', domain: 'movement', band: 'active',
    axes: { exertion: [0.30, 'defining'], arousal: [0.64, 'defining'], stress: [0.26, 'supporting'], recovery: [0.52, 'supporting'], circadianAlertness: [0.55, 'contextual'], valence: [0.52, 'contextual'], fatigue: [0.40, 'contextual'] },
    required: ['exertion', 'arousal'],
    policy: [-0.20, 'sustain', 0.10, 0.05, 'monotone-wind-down'],
    explain: ['Winding out of effort while the body is still catching up with it.', ['exertion', 'arousal']],
  },
  {
    id: 'obligated-workout-low-recovery', domain: 'movement', band: 'active',
    axes: { exertion: [0.58, 'defining'], recovery: [0.18, 'defining'], fatigue: [0.78, 'defining'], arousal: [0.70, 'supporting'], stress: [0.48, 'supporting'] },
    required: ['exertion', 'recovery', 'fatigue'],
    policy: [0.05, 'lift-gently', 0.06, 0.05, 'warmup-peak-cooldown'],
    explain: ['Carrying the session without asking for more than the day can give.', ['exertion', 'recovery', 'fatigue']],
  },
  {
    id: 'casual-walk', domain: 'movement', band: 'active',
    axes: { exertion: [0.38, 'defining'], arousal: [0.54, 'defining'], stress: [0.16, 'supporting'], circadianAlertness: [0.55, 'supporting'], recovery: [0.60, 'contextual'], fatigue: [0.24, 'contextual'] },
    required: ['exertion', 'arousal'],
    policy: [0.05, 'meet', 0.08, 0.0, 'cadence-locked'],
    explain: ['Walking pace, kept where the steps are.', ['exertion', 'arousal']],
  },
  {
    id: 'commute-active', domain: 'movement', band: 'active',
    axes: { exertion: [0.34, 'defining'], stress: [0.54, 'defining'], arousal: [0.58, 'supporting'], circadianAlertness: [0.50, 'supporting'], fatigue: [0.44, 'contextual'] },
    required: ['exertion', 'stress'],
    policy: [-0.05, 'meet', 0.16, 0.10, 'meet-then-lower'],
    explain: ['Moving but not by choice — something steady to sit inside for the trip.', ['exertion', 'stress']],
  },

  // ── Daily Rhythm & Transition ─────────────────────────────────────────────────────────────
  {
    id: 'morning-activation', domain: 'rhythm', band: 'active',
    axes: { circadianAlertness: [0.68, 'defining'], arousal: [0.58, 'defining'], fatigue: [0.14, 'defining'], recovery: [0.78, 'supporting'], exertion: [0.20, 'supporting'], valence: [0.58, 'contextual'] },
    required: ['circadianAlertness', 'arousal'],
    policy: [0.25, 'lift-gently', 0.0, 0.0, 'gentle-lift'],
    explain: ['Coming up with the day rather than ahead of it.', ['circadianAlertness', 'arousal']],
  },
  {
    id: 'morning-sluggish', domain: 'rhythm', band: 'resting',
    axes: { circadianAlertness: [0.28, 'defining'], fatigue: [0.66, 'defining'], arousal: [0.30, 'supporting'], recovery: [0.46, 'supporting'], exertion: [0.10, 'contextual'] },
    required: ['circadianAlertness', 'fatigue'],
    // FLAT, not a lift, and the reason is limitation #2 in the header: the circadian axis carries
    // alertness magnitude without phase sign, so this state and `pre-sleep` are only weakly
    // separable. Lifting someone at bedtime because the model mistook it for morning is a real
    // harm; holding level in both is not. The taxonomy declines to push what it cannot locate.
    policy: [-0.10, 'lift-gently', 0.16, 0.08, 'flat-focus'],
    explain: ['Even and unhurried, for a morning that has not properly started.', ['circadianAlertness', 'fatigue']],
  },
  {
    id: 'afternoon-dip', domain: 'rhythm', band: 'resting',
    axes: { fatigue: [0.56, 'defining'], arousal: [0.40, 'defining'], circadianAlertness: [0.52, 'supporting'], exertion: [0.12, 'supporting'], recovery: [0.46, 'contextual'] },
    required: ['fatigue', 'arousal'],
    policy: [-0.10, 'lift-gently', 0.14, 0.12, 'gentle-lift'],
    explain: ['A small lift through the flat part of the afternoon.', ['fatigue', 'arousal']],
  },
  {
    id: 'evening-unwind', domain: 'rhythm', band: 'resting',
    axes: { circadianAlertness: [0.26, 'defining'], arousal: [0.42, 'defining'], stress: [0.26, 'supporting'], exertion: [0.08, 'supporting'], fatigue: [0.30, 'contextual'] },
    required: ['circadianAlertness', 'arousal'],
    policy: [-0.25, 'meet', 0.24, 0.12, 'monotone-wind-down'],
    explain: ['Letting the evening come down at its own pace.', ['circadianAlertness', 'arousal']],
  },
  {
    id: 'night-owl-alert', domain: 'rhythm', band: 'active',
    axes: { circadianAlertness: [0.82, 'defining'], arousal: [0.54, 'defining'], fatigue: [0.36, 'supporting'], exertion: [0.10, 'supporting'], stress: [0.28, 'contextual'] },
    required: ['circadianAlertness', 'arousal'],
    policy: [0.15, 'sustain', 0.04, 0.15, 'steady'],
    explain: ['Awake late and genuinely awake — kept level rather than wound further up.', ['circadianAlertness', 'arousal']],
  },
  {
    id: 'pre-sleep', domain: 'rhythm', band: 'resting',
    axes: { circadianAlertness: [0.18, 'defining'], arousal: [0.32, 'defining'], exertion: [0.06, 'supporting'], fatigue: [0.52, 'supporting'], stress: [0.22, 'contextual'] },
    required: ['circadianAlertness', 'arousal'],
    policy: [-0.35, 'sustain', 0.28, 0.22, 'monotone-wind-down'],
    explain: ['The last stretch before sleep, thinning out as it goes.', ['circadianAlertness', 'arousal']],
  },

  // ── Emotional ─────────────────────────────────────────────────────────────────────────────
  {
    id: 'energized-positive', domain: 'emotional', band: 'active',
    axes: { valence: [0.86, 'defining'], arousal: [0.76, 'defining'], recovery: [0.64, 'supporting'], stress: [0.18, 'supporting'], exertion: [0.26, 'contextual'] },
    required: ['valence', 'arousal'],
    policy: [0.30, 'sustain', 0.0, 0.0, 'steady'],
    explain: ['Bright and moving, staying with something that is already good.', ['valence', 'arousal']],
  },
  {
    id: 'low-mood-low-energy', domain: 'emotional', band: 'resting',
    axes: { valence: [0.14, 'defining'], arousal: [0.30, 'defining'], recovery: [0.40, 'supporting'], fatigue: [0.56, 'supporting'], exertion: [0.10, 'contextual'] },
    required: ['valence', 'arousal'],
    policy: [-0.15, 'lift-gently', 0.20, 0.10, 'gentle-lift'],
    explain: ['Sitting with a low stretch first, and only then opening it up a little.', ['valence', 'arousal']],
  },
  {
    id: 'tense-but-positive', domain: 'emotional', band: 'active',
    axes: { valence: [0.76, 'defining'], stress: [0.58, 'defining'], arousal: [0.64, 'supporting'], exertion: [0.18, 'supporting'], recovery: [0.50, 'contextual'] },
    required: ['valence', 'stress'],
    policy: [-0.05, 'sustain', 0.12, 0.06, 'meet-then-lower'],
    explain: ['Keyed up but in a good way — kept bright while the edge comes off.', ['valence', 'stress']],
  },
  {
    id: 'neutral-baseline', domain: 'emotional', band: 'resting',
    axes: { valence: [0.50, 'defining'], arousal: [0.50, 'defining'], stress: [0.22, 'supporting'], recovery: [0.58, 'supporting'], exertion: [0.14, 'supporting'], circadianAlertness: [0.50, 'contextual'], fatigue: [0.22, 'contextual'] },
    required: [],
    policy: [0.0, 'meet', 0.0, 0.0, 'steady'],
    explain: ['Nothing in particular stands out, so the mix simply follows the request.', ['valence', 'arousal']],
  },
];

// ── the width solver ────────────────────────────────────────────────────────────────────────

/**
 * σ_a = exp(−k·w_a) with k = BUDGET / Σ_a w_a. Every state therefore satisfies
 * Σ_a −log σ_a = BUDGET exactly, so peak emissions are equal ACROSS the table while remaining
 * ordered WITHIN a state by role. Nothing here is hand-tuned; the only authored quantities are
 * the centre and the role.
 */
function solveRegion(axes) {
  const roles = {};
  for (const axis of AXIS_NAMES) {
    const declared = axes[axis];
    roles[axis] = declared ? declared[1] : 'agnostic';
  }
  const totalWeight = AXIS_NAMES.reduce((acc, a) => acc + ROLE_WEIGHTS[roles[a]], 0);
  const k = LOG_PRECISION_BUDGET / totalWeight;

  const region = {};
  for (const axis of AXIS_NAMES) {
    const declared = axes[axis];
    // An axis the state has no opinion about sits at the engine's own NEUTRAL exactly, so an
    // agnostic claim is literally "whatever the prior says" rather than a nearby number.
    const norm = declared ? declared[0] : toNorm(axis, NEUTRAL[axis]);
    region[axis] = Object.freeze({
      center: round4(toRaw(axis, norm)),
      width: spanOf(axis) * Math.exp(-k * ROLE_WEIGHTS[roles[axis]]),
      role: roles[axis],
      // Kept so the geometry can be inspected in the units it was authored in.
      norm: round4(norm),
    });
  }
  return Object.freeze(region);
}

/**
 * How prominent a state's musical consequence is, which is what its entry bar should scale with.
 * DERIVED from the state itself so it cannot drift away from the policy it is meant to guard: a
 * peak-band state or a high-stress state changes the mix a great deal, and should have to be
 * believed more before it does.
 */
function prominenceOf(entry, region) {
  if (entry.required.length === 0) return 'fallback';
  if (entry.band === 'peak' || region.stress.norm >= 0.7) return 'loud';
  return 'normal';
}

function buildState(entry) {
  const region = solveRegion(entry.axes);
  const prominence = prominenceOf(entry, region);
  const enterThreshold = round4((ENTER_PRIOR_MULTIPLE[prominence] / TABLE.length));
  const [energyBias, valenceApproach, acousticness, instrumentalness, trajectoryArchetype] = entry.policy;
  const [text, claims] = entry.explain;

  return Object.freeze({
    id: entry.id,
    domain: entry.domain,
    band: entry.band,
    region,
    prominence,
    enterThreshold,
    exitThreshold: round4(enterThreshold * EXIT_FRACTION_OF_ENTER),
    ...DOMAIN_DWELL[entry.domain],
    requiredSignals: Object.freeze([...entry.required]),
    // Derived, never declared — see HR_DEPENDENT_AXES.
    degraded: !entry.required.some((r) => HR_DEPENDENT_AXES.includes(r)),
    musicPolicy: Object.freeze({
      energyBias,
      valenceApproach,
      textureBias: Object.freeze({ acousticness, instrumentalness }),
      trajectoryArchetype,
    }),
    explainTemplate: Object.freeze({ text, claims: Object.freeze([...claims]) }),
  });
}

function round4(v) { return Math.round(v * 1e4) / 1e4; }

const STATES = Object.freeze(TABLE.map(buildState));
const BY_ID = new Map(STATES.map((s) => [s.id, s]));

// ── legacy compatibility ────────────────────────────────────────────────────────────────────

/**
 * The nine `medicalProfileService` rule labels plus its `Neutral` fallback, mapped into the new
 * vocabulary. The suite pins that every mapping PRESERVES the band `moodDescriptors._STATE_TO_BAND`
 * already resolved the legacy label to, so the seam half can extend that table without any
 * existing consumer changing behaviour.
 */
const LEGACY_STATE_MAP = Object.freeze({
  'High-Stress / Pre-Panic': 'acute-stress',
  'Peak Athletic Performance': 'peak-effort',
  'Intense Workout': 'intervals',
  'Active Recovery': 'cooldown',
  'Morning Activation': 'morning-activation',
  'Exhausted Commute': 'drowsy-low-battery',
  'Screen-Off / Background Listening': 'resting-content',
  'Deep Focus / Flow State': 'deep-focus',
  'Resting / Meditative': 'meditative',
  Neutral: 'neutral-baseline',
});

// ── accessors ───────────────────────────────────────────────────────────────────────────────

function byId(id) { return BY_ID.get(id) ?? null; }
function bandOf(id) { return byId(id)?.band ?? null; }
function policyOf(id) { return byId(id)?.musicPolicy ?? null; }
function explainOf(id) { return byId(id)?.explainTemplate ?? null; }
function fromLegacyLabel(label) { return LEGACY_STATE_MAP[label] ?? null; }

/** Σ_a (−log σ_a − ½log 2π): the emission a state reaches at its own centre under full mass. */
function peakLogEmission(state) {
  const HALF_LOG_2PI = 0.5 * Math.log(2 * Math.PI);
  return AXIS_NAMES.reduce(
    (acc, a) => acc + (-Math.log(state.region[a].width) - HALF_LOG_2PI), 0,
  );
}

/**
 * The band projection the seam half hands `moodDescriptors.biometricBand` — a STRICT SUPERSET of
 * today's `_STATE_TO_BAND`: every legacy label keeps its exact band, and every taxonomy id is
 * added alongside. A closed lookup, so a state label can steer the band without any label ever
 * reaching a prompt or a log (§0.2.2, R10).
 */
function stateBandTable() {
  const table = {};
  for (const [label, id] of Object.entries(LEGACY_STATE_MAP)) {
    if (label !== 'Neutral') table[label] = bandOf(id);
  }
  for (const s of STATES) {
    // The fallback contributes NO band on purpose: "nothing in particular stands out" should let
    // `biometricBand` fall through to the heart rate rather than assert a band of its own.
    if (s.requiredSignals.length === 0) continue;
    table[s.id] = s.band;
  }
  return table;
}

module.exports = {
  TAXONOMY_VERSION,
  STATES,
  DOMAINS,
  BANDS,
  AXIS_ROLES,
  ROLE_WEIGHTS,
  VALENCE_APPROACHES,
  TRAJECTORY_ARCHETYPES,
  ARCHETYPE_DIRECTION,
  LEGACY_STATE_MAP,
  HR_DEPENDENT_AXES,
  GEOMETRIC_MEAN_WIDTH,
  AXIS_RANGE,
  LOG_PRECISION_BUDGET,
  ENTER_PRIOR_MULTIPLE,
  EXIT_FRACTION_OF_ENTER,
  DOMAIN_DWELL,
  DISABLE_ENV_VAR,
  peakLogEmission,
  byId,
  bandOf,
  policyOf,
  explainOf,
  fromLegacyLabel,
  stateBandTable,
};
