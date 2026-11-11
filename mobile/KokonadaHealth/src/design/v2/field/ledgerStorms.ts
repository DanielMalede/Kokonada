// The ledger storms (QA-068, the event path, E3): one harness for the default run's coarse grid
// (field/__tests__/ledgerStorms.test.ts) and the sweeps project's full grid
// (field/__tests__/ledgerStorms.<id>.sweeps.test.ts, one per shipped direction), so the two cannot drift apart.
// Test-only: never imported by app code. It is not a worklet module, and it never imports the token
// extensions: the caller passes the statics in (stormDeps).
//
// E3 (resilience admission §3, the replacement text, adopted by the designer; its no-backlog sentence
// amended by resilience round 1 F2):
//
// "Ledger storms, run in every direction under {settle, reduced}. Storms: {toggle, cycle4, reemit,
//  neutral3 ([a direction whose neutral placements carry no lobe]: three neutral placements, then three new neutral taps inside one settle window)},
//  with taps every {17, 50, 100, 143, 167, 250} ms, for 3 s and for 10 s, sampled every 1 ms.
//  - Demand: the ledger's node demand is at most NODE_SLOTS (6). Demand counts live, entering and
//    leaving placements, plus rest lobes whose fade is above 0 or rising. It is counted from the
//    ledger's output, never from the built frame.
//  - Overflow: buildFieldFrame throws RangeError when given more than NODE_SLOTS nodes; it never
//    slices. Planted case: a ledger that admits three swaps must make neutral3 throw.
//  - Fades: no fade, tracked by id, moves more than its curve's steepest slope per ms. An id enters at
//    0 and leaves only at 0. The built frame's rest-lobe fades obey the same bound.
//  - Starts: consecutive starts are at least BASE.motion.settle.duration apart, and every start admits
//    at least one pending change. reemit gives exactly one start and bit-identical fades.
//  - Convergence: the ids with fade above 0 equal the store's live ids by the last tap + 3·600 ms +
//    ramp, or + 2·600 ms + ramp wherever no rest lobe is lit. No backlog: at every frame the waiting
//    change is exactly the difference between the store and the live field (each waiting leave a live
//    placement absent from the store, each waiting enter in the store and not shown, each side at
//    most 3), and no frame ends idle with a change waiting once the spacing has passed. Secondary, in
//    the sweeps project only: the 10 s storm converges no later than 600 ms after the 3 s storm
//    (one-sided). The identity, the no-stall check and the absolute bound are the no-backlog guard;
//    this clause adds only a lag that grows with storm length yet stays inside the absolute bound's
//    slack (measured at 10 s: 253 ms in cycle4 to 1200 ms in reemit). Planted cases, each asserting
//    the harness's own clause output: a raw first-in-first-out ledger breaks the identity and fails
//    the absolute bound (default run); at 250 ms it converges after both storms but more than 600 ms
//    apart (sweeps project; on this plant the absolute bound also fires). If this clause alone fails
//    while the identity, the no-stall check and the absolute bound hold, re-measure the convergence
//    table: a schedule-only failure is ruled by resilience, never fixed by loosening the ledger.
//  - E5, the halo is bound: two frames with the same ledger output, one built while the store holds an
//    extra unadmitted tap, are byte-identical over the whole field (law and real Skia). A static guard
//    checks that no plate or bead file reads field.halo or draws a halo."
//
// Two cross-checks beyond the text (resilience round 1): the built frame occupies no more node slots
// than the ledger's demand (F7), and the 3·600 ms allowance applies only where a rest lobe is lit
// beside three live placements, the one case that needs a third crossfade (F8).
//
// The grids (architect round 1 §4): the default run takes the coarse grid, taps every {17, 143, 250}
// ms for 3 s, where the netting identity and the no-stall check keep the no-backlog guard without the
// 10 s span; the sweeps project takes the full grid above, with the one-sided clause. A planted control
// runs where its clause runs (resilience, rulings after T5d, §2).
//
// The fades driver (resilience, law round 2 (d)): storm() reads the ledger's fades through
// opts.fadesOf, the ledger's own fades by default; the four factory plants at the end of this file
// give the fade detectors (slope, enter at 0, leave at 0, rest-lobe slope) a real plant each, run in
// the default run.

import { BASE, type DirectionId, type Face } from '../tokens/tokens.generated.ts';
import { buildFieldFrame, type FieldGeometry, type FieldState, type FieldStatics } from './fieldFrame.ts';
import { NODE, NODE_SLOTS } from './fieldLaw.ts';
import { ADMISSION, emptyLedger, fades, ledgerConfig, needsFrames, reconcile, type Admission, type Ledger, type LedgerConfig, type LedgerFades, type LedgerInput, type Tap } from './placementLedger.ts';
import { packFrame } from './uniforms.ts';

export type Mode = 'settle' | 'reduced';
export type Storm = 'toggle' | 'cycle4' | 'reemit' | 'neutral3';
export const MODES: readonly Mode[] = ['settle', 'reduced'];
export const STORMS: readonly Storm[] = ['toggle', 'cycle4', 'reemit', 'neutral3'];
export const SETTLE = BASE.motion.settle.duration;
export const RAMP: Record<Mode, number> = { settle: SETTLE, reduced: BASE.motion.fadeReduced.duration };
/** The steepest slope of either curve, per ms (E2): settle in 4/0.6 s, reduced out 2/0.15 s. */
export const SLOPE: Record<Mode, number> = { settle: 4 / 0.6 / 1000, reduced: 2 / 0.15 / 1000 };

export interface StormGrid {
  /** Tap cadences, in ms. */
  readonly every: readonly number[];
  /** Storm lengths, in ms. */
  readonly span: readonly number[];
}
export const STORM_GRIDS: { readonly coarse: StormGrid; readonly full: StormGrid } = {
  coarse: { every: [17, 143, 250], span: [3000] },
  full: { every: [17, 50, 100, 143, 167, 250], span: [3000, 10000] },
};

export interface StormDeps {
  readonly statics: FieldStatics;
  readonly config: LedgerConfig;
  /** The face the storm's frames are built on: the ledger counts that face's rest lobes (UI-112). */
  readonly face: Face;
}
/**
 * The ledger's config for a direction on one face, from the statics the caller holds: that face's rest
 * lobes, counted and placed (L7 reads their centres), on the storms' plate (geometry, below; R = 170 dp,
 * as every harness here draws it).
 */
export const stormDeps = (id: DirectionId, statics: FieldStatics, face: Face): StormDeps => ({
  statics,
  config: ledgerConfig(id, statics.restLobes[face], geometry),
  face,
});

export const tap = (x: number, y: number): Tap => ({ x, y });
export const QUAD = [tap(0.566, 0.566), tap(0.566, -0.566), tap(-0.566, -0.566), tap(-0.566, 0.566)];
export const neutral = (k: number) => tap(0.01 * (k % 9) + 0.01, -0.02);

/**
 * The cold lane's taps as the storms drive them: at most three, with a seq bumped on every change. Its taps
 * are the reducer's (emotionSlice addTap, undoTap, clearTaps), pinned by src/state/cold/__tests__/
 * emotionSlice.stormModel.test.ts (T10).
 */
export function store(initial: Tap[] = []) {
  let taps = initial;
  let seq = 0;
  return {
    add(t: Tap) { taps = [...taps, t].slice(-3); seq++; },
    undo() { taps = taps.slice(0, -1); seq++; },
    clear() { taps = []; seq++; },
    taps: () => taps,
    seq: () => seq,
  };
}

// A screen's worth of quiet zones, all QUIET_SLOTS of them (a heading, a subheading, two corner
// controls, a caption and the CTA), so every storm frame is built and packed at the limit.
const quietRects = [
  { cx: 100, cy: 6, hx: 70, hy: 5 },
  { cx: 100, cy: 16, hx: 50, hy: 3 },
  { cx: 12, cy: 8, hx: 8, hy: 8 },
  { cx: 188, cy: 8, hx: 8, hy: 8 },
  { cx: 100, cy: 178, hx: 40, hy: 3 },
  { cx: 100, cy: 190, hx: 60, hy: 8 },
];
export const geometry: FieldGeometry = { centrePx: [100, 100], radiusPx: 80, pxPerDp: 80 / 170, fontScale: 1, quietRects };

export const frameState = (id: DirectionId, face: Face, f: LedgerFades): FieldState => ({
  direction: id,
  face,
  placements: f.placements.map((p) => ({ x: p.x, y: p.y, fade: p.fade, ordinal: p.ordinal, driftKey: p.driftKey, slot: p.slot, role: p.role })),
  restFade: f.restFades,
  restSlots: f.restSlots,
  stress: 0,
  confidence: 1,
  genesis: false,
  tMs: 7000,
  breathPhase: 0.3,
  tier: 'full',
});

export interface Outcome {
  starts: number[];
  admittedAtStarts: number[];
  maxDemand: number;
  demandMismatch: number;
  slopeBreaks: string[];
  entersNotAtZero: number[];
  leavesNotAtZero: number[];
  restBreaks: number;
  threw: string | null;
  lastTap: number;
  converged: number | null;
  restLitAfterLastTap: boolean;
  restBesideThreeLive: boolean;
  /** Frames whose fades give no lobe-bearing placement, and of those, the frames with a rest fade other than 1 (RA-2). */
  framesWithoutLobe: number;
  restShortWithoutLobe: number;
  netBreaks: number;
  stalls: number;
  series: string[];
}

/** How a storm reads the ledger's fades: the ledger's own (fades), or a planted driver. */
export type FadesOf = (ledger: Ledger) => LedgerFades;

export interface StormOptions {
  /** The admission limits; the planted controls pass others, the field uses the defaults. */
  readonly limits?: Admission;
  /** Keep every frame's fades, serialized (reemit's bit-identity). */
  readonly keepSeries?: boolean;
  /** How long the storm runs past its last tap, in ms. */
  readonly tail?: number;
  /** The fades driver: fades by default; a factory plant (below) for the detectors' own controls. */
  readonly fadesOf?: FadesOf;
}

const STORM_OPTIONS: ReadonlySet<string> = new Set(['limits', 'keepSeries', 'tail', 'fadesOf']);

/** One storm, frame by frame at 1 ms, through the ledger and the builder. */
export function storm(id: DirectionId, mode: Mode, kind: Storm, every: number, span: number, deps: StormDeps, opts: StormOptions = {}): Outcome {
  // The tests run untyped (babel-jest): admission limits passed where the options go must throw, not
  // silently run the default ledger.
  const unknown = Object.keys(opts).filter((k) => !STORM_OPTIONS.has(k));
  if (unknown.length > 0) throw new TypeError(`unknown storm option: ${unknown.join(', ')}`);
  const { limits = ADMISSION, keepSeries = false, tail = 3 * SETTLE + RAMP[mode] + 200, fadesOf = fades } = opts;
  const s = store(kind === 'neutral3' ? [neutral(1), neutral(2), neutral(3)] : []);
  const actions = new Map<number, Array<() => void>>();
  const at = (t: number, act: () => void) => actions.set(t, [...(actions.get(t) ?? []), act]);
  let lastTap = 0;
  // The ledger's first frame (t = 0) sees the store as it is; the storm's taps start at 1 ms.
  if (kind === 'toggle') {
    for (let t = 1, k = 0; t < span; t += every, k++) { at(t, k % 2 === 0 ? () => s.add(QUAD[1]) : () => s.undo()); lastTap = t; }
  } else if (kind === 'cycle4') {
    for (let t = 1, k = 0; t < span; t += every, k++) { const q = QUAD[k % 4]; at(t, () => s.add(q)); lastTap = t; }
  } else if (kind === 'reemit') {
    at(1, () => s.add(QUAD[0]));
    lastTap = 1;
  } else {
    for (let k = 0; k < 3; k++) { const q = neutral(4 + k); at(100 + k * every, () => s.add(q)); lastTap = 100 + k * every; }
  }
  const end = Math.max(span, lastTap) + tail;
  let ledger = emptyLedger(deps.config, limits);
  const o: Outcome = {
    starts: [], admittedAtStarts: [], maxDemand: 0, demandMismatch: 0, slopeBreaks: [], entersNotAtZero: [], leavesNotAtZero: [], restBreaks: 0,
    threw: null, lastTap, converged: null, restLitAfterLastTap: false, restBesideThreeLive: false, framesWithoutLobe: 0, restShortWithoutLobe: 0, netBreaks: 0, stalls: 0, series: [],
  };
  let previous = new Map<number, number>();
  let previousRest = -1;
  let lastKey = '';
  let startsSeen = 0;
  for (let t = 0; t <= end; t++) {
    for (const act of actions.get(t) ?? []) act();
    let input = { seq: s.seq(), taps: s.taps() };
    if (kind === 'reemit' && t > 0 && t % every === 0) {
      // the same taps re-sent: a fresh array of equal taps, under the same seq or a new one
      input = { seq: (t / every) % 2 === 0 ? s.seq() + t : s.seq(), taps: s.taps().map((x) => ({ ...x })) };
    }
    ledger = reconcile(ledger, input, t, mode);
    const f = fadesOf(ledger);
    // No backlog (resilience admission §1): what waits is exactly the store minus the field; and a frame
    // never ends idle with a change waiting once the spacing has passed.
    const live = new Set(f.placements.filter((p) => p.role === 'live').map((p) => p.id));
    const inStore = new Set(ledger.store.map((p) => p.id));
    const leaving = new Set(ledger.leaves.map((p) => p.id));
    const entering = new Set(ledger.enters.map((p) => p.id));
    const netted = ledger.leaves.length <= 3 && ledger.enters.length <= 3
      && [...leaving].every((pid) => live.has(pid) && !inStore.has(pid))
      && [...entering].every((pid) => !live.has(pid) && inStore.has(pid))
      && [...inStore].every((pid) => (live.has(pid) && !leaving.has(pid)) || entering.has(pid))
      && [...live].every((pid) => inStore.has(pid) || leaving.has(pid));
    if (!netted) o.netBreaks++;
    if (ledger.running === null && (ledger.leaves.length > 0 || ledger.enters.length > 0) && ledger.clock - ledger.lastStart >= SETTLE) o.stalls++;
    if (keepSeries) o.series.push(JSON.stringify(f));
    if (ledger.starts !== startsSeen) {
      startsSeen = ledger.starts;
      o.starts.push(t);
      o.admittedAtStarts.push(ledger.admitted);
    }
    const demand = f.placements.length + f.restSlots.length;
    if (demand !== f.demand) o.demandMismatch++;
    o.maxDemand = Math.max(o.maxDemand, demand);
    // Fades by id: the steepest slope per ms; enter at 0 (a reset's are exempt: no animation); leave at 0.
    const now = new Map<number, number>(f.placements.map((p) => [p.id, p.fade]));
    for (const e of f.ended) now.set(e, 0);
    for (const [pid, fade] of now) {
      const before = previous.get(pid);
      if (before === undefined) {
        if (fade !== 0 && t > 0) o.entersNotAtZero.push(pid);
      } else if (Math.abs(fade - before) > SLOPE[mode] * 1.001 + 1e-12) {
        o.slopeBreaks.push(`id ${pid} at ${t} ms: ${before} → ${fade}`);
      }
    }
    for (const [pid, before] of previous) if (!now.has(pid) && before !== 0) o.leavesNotAtZero.push(pid);
    previous = new Map([...now].filter(([pid]) => !f.ended.includes(pid)));
    if (t > lastTap && f.restFade > 0) o.restLitAfterLastTap = true;
    if (t > lastTap && f.restFade > 0 && f.placements.filter((p) => p.role === 'live').length === 3) o.restBesideThreeLive = true;
    // The ledger's rest promise (law round 2 D9, RA-2): with no lobe-bearing placement given, every rest
    // fade is exactly 1, as the builder draws it whatever it is given; no clause reads it, the test pins it.
    if (!f.placements.some((p) => p.node !== 'neutral' || deps.config.neutralLobe)) {
      o.framesWithoutLobe++;
      if (!f.restFades.every((r) => r === 1)) o.restShortWithoutLobe++;
    }
    // The built frame: it must build (never slice, never overflow), and its rest lobes obey the bound.
    // The builder is pure, so a frame whose ledger output is unchanged builds the same frame: it is
    // built again only when the output changes.
    const key = f.placements.map((p) => `${p.id}:${p.slot}:${p.fade}`).join(',') + '|' + f.restFades.join(',') + '|' + f.restSlots.join(',');
    if (o.threw === null && key !== lastKey) {
      lastKey = key;
      try {
        const frame = buildFieldFrame(frameState(id, deps.face, f), geometry, deps.statics);
        packFrame(frame);
        // The ledger and the builder agree: the frame occupies no more slots than the ledger's demand.
        const occupied = frame.nodes.filter((nd) => nd.fade > 0 || nd.bead !== null).length;
        if (occupied > f.demand) o.demandMismatch++;
        const rest = Math.max(0, ...frame.nodes.filter((nd) => nd.id === NODE.R0 && nd.bead === null).map((nd) => nd.fade));
        if (previousRest >= 0 && Math.abs(rest - previousRest) > SLOPE[mode] * 1.001 + 1e-12) o.restBreaks++;
        previousRest = rest;
      } catch (error) {
        o.threw = `${(error as Error).name} at ${t} ms: ${(error as Error).message}`;
      }
    }
    // Convergence: what is shown above 0 is exactly the store's taps, every one at 1.
    const target = s.taps();
    const lit = f.placements.filter((p) => p.fade > 0);
    const same = lit.length === target.length && lit.every((p, i) => p.fade === 1 && p.x === target[i].x && p.y === target[i].y);
    if (t >= lastTap) {
      if (same && o.converged === null) o.converged = t - lastTap;
      if (!same) o.converged = null;
    }
  }
  return o;
}

/** E3's clauses on one storm's outcome: each broken clause, labelled. The mixed storm (below) is held to them too. */
export function stormFailures(label: string, kind: Storm | 'mixed', mode: Mode, o: Outcome): string[] {
  const out: string[] = [];
  const fail = (clause: string, detail: unknown) => out.push(`${label}: ${clause}: ${JSON.stringify(detail)}`);
  if (o.threw !== null) fail('the builder threw', o.threw);
  if (o.maxDemand > NODE_SLOTS) fail('demand above NODE_SLOTS', o.maxDemand);
  if (o.demandMismatch !== 0) fail('the demand and the built frame disagree', o.demandMismatch);
  if (o.slopeBreaks.length > 0) fail('a fade moved faster than its curve', o.slopeBreaks.slice(0, 3));
  if (o.entersNotAtZero.length > 0) fail('an id entered above 0', o.entersNotAtZero);
  if (o.leavesNotAtZero.length > 0) fail('an id left above 0', o.leavesNotAtZero);
  if (o.restBreaks !== 0) fail('a rest-lobe fade moved faster than its curve', o.restBreaks);
  const gaps = o.starts.slice(1).map((t, k) => t - o.starts[k]);
  if (gaps.some((g) => g < SETTLE)) fail('starts closer than motion.settle.duration', gaps.filter((g) => g < SETTLE));
  if (o.admittedAtStarts.some((a) => a < 1)) fail('a start admitted nothing', o.admittedAtStarts.filter((a) => a < 1).length);
  if (o.netBreaks !== 0) fail('the netting identity broke', o.netBreaks);
  if (o.stalls !== 0) fail('a frame ended idle with a change waiting past the spacing', o.stalls);
  const bound = (o.restBesideThreeLive ? 3 : 2) * SETTLE + RAMP[mode];
  if (o.converged === null || o.converged > bound) fail(`did not converge within ${bound} ms of the last tap`, o.converged);
  if (kind === 'reemit' && o.starts.length !== 1) fail('reemit did not give exactly one start', o.starts.length);
  return out;
}

/** The one-sided no-backlog clause on one cadence's outcomes: each longer storm that converged more than 600 ms after the shortest. */
export function backlogBreaks(label: string, spans: readonly number[], outcomes: readonly Outcome[]): string[] {
  const out: string[] = [];
  const [first, ...longer] = outcomes;
  for (const [i, o] of longer.entries()) {
    if (first.converged !== null && o.converged !== null && o.converged > first.converged + SETTLE) {
      out.push(`${label}: the ${spans[i + 1]} ms storm converged ${o.converged - first.converged} ms after the ${spans[0]} ms one`);
    }
  }
  return out;
}

/**
 * Every storm of a grid for one direction, mode and storm kind: the runs made and every broken clause.
 * The planted controls pass other admission limits or a longer tail; the field uses the defaults.
 */
export function gridReport(
  id: DirectionId,
  mode: Mode,
  kind: Storm,
  grid: StormGrid,
  deps: StormDeps,
  limits: Admission = ADMISSION,
  tail?: number,
): { runs: number; failures: string[]; outcomes: Outcome[] } {
  const failures: string[] = [];
  const all: Outcome[] = [];
  let runs = 0;
  for (const every of grid.every) {
    const outcomes = grid.span.map((span) => storm(id, mode, kind, every, span, deps, { limits, tail }));
    runs += outcomes.length;
    all.push(...outcomes);
    outcomes.forEach((o, i) => failures.push(...stormFailures(`${id} ${deps.face} ${mode} ${kind} every ${every} ms for ${grid.span[i]} ms`, kind, mode, o)));
    failures.push(...backlogBreaks(`${id} ${deps.face} ${mode} ${kind} every ${every} ms`, grid.span, outcomes));
  }
  return { runs, failures, outcomes: all };
}

// The mixed, lagged storm (T10: architect T5 r1 §5, "add/undo/clear, with the input seen every {1, 17, 50} ms";
// resilience round 1 F3, the seeded property storm; reconciliation round 1: one test, R's generator with A's
// input-seen-every dimension). E3 never puts two store changes in one frame (its frames are 1 ms, its taps at
// least 17 ms apart), yet the ledger's reading by value rests on frames that see several. Here:
//   · the generator: R's LCG, seed = (seed · 1664525 + 1013904223) >>> 0, read on [0, 1). Before the first
//     frame the store takes 0–3 adds, so the first read is a reset; then each of MIXED_FRAMES frames applies
//     0–3 store operations (MIXED_OPS: an add of a quadrant tap, a neutral, one exactly on
//     placement.neutralRadius, one on the rim or one beyond it; an undo; a clear), its dt drawn from
//     MIXED_DTS (a NaN dt gives the frame a NaN timestamp; −7 runs it back); odd seeds flip the mode once,
//     mid-run;
//   · the lag: the ledger reads the store only once `every` ms of wall time (the JS clock, which never runs
//     back) have passed since its last read, every ∈ MIXED_EVERY; between reads it is given the last input,
//     so one read can hold several frames' changes;
//   · the tail: after the last operation, 16.667 ms frames until the ledger's clock is `tail` (MIXED_TAIL)
//     past the read that saw the store's last change of value.
// Every frame is held to E3's clauses (stormFailures), on the ledger's own clock: a fade moves at most SLOPE
// of the mode of the crossfade that ran into the frame times the clock's step, and not at all where none ran;
// rest lobes, the ledger's and the built frame's, the same; starts at least 600 apart on the clock; the
// convergence bound from the last change's read, on the tail's mode, plus the frame quantum (mixedBound, RA-21). Two clauses of its own: the waiting
// queue never holds more than six changes (the queue bound, architect T5 r1 §4: each side at most 3), and no
// frame is needed once the tail has run (needsFrames, L19).

/** The frame dts the mixed storm draws from, in ms (resilience round 1 F3). */
export const MIXED_DTS: readonly number[] = [0, 1, 8.333, 16.667, 33.3, 120, 5000, -7, Number.NaN];
/**
 * The device regime (resilience T10 RA-20, UI-193): every frame dt positive, MIXED_DTS with 0 and NaN read as 16.667
 * and −7 as 7 (the harness mutant H5's mapping), drawn the same way, so a seed applies the same operations.
 */
export const MIXED_DTS_POSITIVE: readonly number[] = MIXED_DTS.map((d) => Math.abs(d) || 16.667);
/** How often the ledger reads the store, in ms of wall time (architect T5 r1 §5). */
export const MIXED_EVERY: readonly number[] = [1, 17, 50];
export type MixedOp = 'quadrant' | 'neutral' | 'onNeutralRadius' | 'rim' | 'beyond' | 'undo' | 'clear';
export const MIXED_OPS: readonly MixedOp[] = ['quadrant', 'neutral', 'onNeutralRadius', 'rim', 'beyond', 'undo', 'clear'];
/** The frames that apply store operations, per storm. */
export const MIXED_FRAMES = 60;
/** The tail past the last change's read, on the ledger's clock: three starts (3·600), one spacing more for L19, and 200 ms. */
export const MIXED_TAIL = 4 * SETTLE + 200;

export interface MixedGrid {
  /** The seeds: each runs one storm per start mode and input cadence. */
  readonly seeds: readonly number[];
  readonly every: readonly number[];
}
const firstSeeds = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
/** The default run takes the coarse seeds; the sweeps project the full 200 per direction × mode (resilience round 1 F3). */
export const MIXED_GRIDS: { readonly coarse: MixedGrid; readonly full: MixedGrid } = {
  coarse: { seeds: firstSeeds(16), every: MIXED_EVERY },
  full: { seeds: firstSeeds(200), every: MIXED_EVERY },
};

/**
 * R's generator: an LCG, read on [0, 1), for a whole seed ≥ 0. Exact in doubles: for s < 2³² the step stays below
 * 2⁵³, so the remainder mod 2³² is R's `>>> 0` without a bitwise operator (no-bitwise).
 */
export function lcg(seed: number): () => number {
  let s = seed % 4294967296;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/** An add of one kind: a quadrant tap (one of QUAD, or anywhere between the neutral radius and the rim), a neutral, exactly on the neutral radius, on the rim, or beyond it. */
function mixedTap(kind: MixedOp, next: () => number): Tap {
  const pick = (n: number) => Math.min(n - 1, Math.floor(next() * n));
  const axis = (r: number) => [tap(r, 0), tap(0, r), tap(-r, 0), tap(0, -r)][pick(4)];
  const polar = (r: number) => {
    const a = 2 * Math.PI * next();
    return tap(r * Math.cos(a), r * Math.sin(a));
  };
  const NR = BASE.placement.neutralRadius;
  if (kind === 'quadrant') return next() < 0.5 ? QUAD[pick(4)] : polar(NR + 0.01 + (0.98 - NR) * next());
  if (kind === 'neutral') return neutral(pick(9));
  if (kind === 'onNeutralRadius') return axis(NR);
  if (kind === 'rim') return axis(1);
  return polar(1.05 + 0.5 * next());
}

export interface MixedOutcome extends Outcome {
  /** The mode at the end: the tail's, which the convergence bound reads. */
  mode: Mode;
  flipped: boolean;
  /** needsFrames after the tail. */
  framesNeededAtEnd: boolean;
  /** The most changes waiting at a frame, leaves plus enters. */
  queueMax: number;
  /** After the read that saw the last change: the starts on later frames, and the longest clock step (RA-21). */
  startsAfterLastRead: number;
  maxStepAfterLastRead: number;
  /**
   * Operations that changed the taps by value, per read after the first (a reset): the most, and the reads that held
   * two or more (RA-23: an undo or clear of an empty list bumps seq and changes nothing).
   */
  maxValueChangesPerRead: number;
  batchedValueReads: number;
  reads: number;
  frames: number;
  /** Frames by dt, and operations by kind. */
  dts: Record<string, number>;
  ops: Record<MixedOp, number>;
}

export interface MixedOptions {
  /** The admission limits; the planted controls pass others, the field uses the defaults. */
  readonly limits?: Admission;
  /** The fades driver: fades by default; a factory plant for the detectors' own controls. */
  readonly fadesOf?: FadesOf;
  /** The tail past the last change's read, on the ledger's clock (MIXED_TAIL). */
  readonly tail?: number;
  /** The frame dts drawn from, MIXED_DTS by default (MIXED_DTS_POSITIVE: the device regime, RA-20). */
  readonly dts?: readonly number[];
}
const MIXED_OPTIONS: ReadonlySet<string> = new Set(['limits', 'fadesOf', 'tail', 'dts']);
const sameTapsByValue = (a: readonly Tap[], b: readonly Tap[]) => a.length === b.length && a.every((t, i) => t.x === b[i].x && t.y === b[i].y);

/** One mixed, lagged storm: one seed, one start mode, one input cadence, through the ledger and the builder. */
export function mixedStorm(id: DirectionId, startMode: Mode, seed: number, every: number, deps: StormDeps, opts: MixedOptions = {}): MixedOutcome {
  const unknown = Object.keys(opts).filter((k) => !MIXED_OPTIONS.has(k));
  if (unknown.length > 0) throw new TypeError(`unknown mixed storm option: ${unknown.join(', ')}`);
  const { limits = ADMISSION, fadesOf = fades, tail = MIXED_TAIL, dts = MIXED_DTS } = opts;
  const next = lcg(seed);
  const pick = (n: number) => Math.min(n - 1, Math.floor(next() * n));
  const s = store();
  const o: MixedOutcome = {
    starts: [], admittedAtStarts: [], maxDemand: 0, demandMismatch: 0, slopeBreaks: [], entersNotAtZero: [], leavesNotAtZero: [], restBreaks: 0,
    threw: null, lastTap: 0, converged: null, restLitAfterLastTap: false, restBesideThreeLive: false, framesWithoutLobe: 0, restShortWithoutLobe: 0, netBreaks: 0, stalls: 0, series: [],
    mode: startMode, flipped: false, framesNeededAtEnd: false, startsAfterLastRead: 0, maxStepAfterLastRead: 0, queueMax: 0, maxValueChangesPerRead: 0, batchedValueReads: 0, reads: 0, frames: 0, dts: {},
    ops: { quadrant: 0, neutral: 0, onNeutralRadius: 0, rim: 0, beyond: 0, undo: 0, clear: 0 },
  };
  // Operations that changed the taps by value, and how many of them the reads so far have seen.
  let valueChanges = 0;
  let valueChangesRead = 0;
  const apply = (op: MixedOp) => {
    o.ops[op]++;
    const was = s.taps();
    if (op === 'undo') s.undo();
    else if (op === 'clear') s.clear();
    else s.add(mixedTap(op, next));
    if (!sameTapsByValue(was, s.taps())) valueChanges++;
  };
  // Before the first frame: 0–3 adds, so the first read is a reset (its taps shown at once).
  for (let k = pick(4); k > 0; k--) apply(MIXED_OPS[pick(5)]);
  const flipAt = seed % 2 === 1 ? 1 + pick(MIXED_FRAMES - 1) : -1;
  let mode = startMode;
  let ts = 0;
  let wall = 0;
  let readAt = -Infinity;
  let input: LedgerInput = { seq: s.seq(), taps: s.taps() };
  let ledger = emptyLedger(deps.config, limits);
  let previous = new Map<number, number>();
  let previousRest: readonly number[] = [];
  let builtRest = 0;
  let lastKey = '';
  // The ledger's clock at the read that saw the latest change of value; the clock since which the field has shown the store.
  let seenAt = 0;
  let sameSince: number | null = null;
  for (let k = 0; k < MIXED_FRAMES + 4000; k++) {
    const ops = k < MIXED_FRAMES;
    if (!ops && input.seq === s.seq() && ledger.clock >= seenAt + tail) break;
    const dt = k === 0 ? 0 : ops ? dts[pick(dts.length)] : 16.667;
    o.dts[String(dt)] = (o.dts[String(dt)] ?? 0) + 1;
    if (k === flipAt) {
      mode = mode === 'settle' ? 'reduced' : 'settle';
      o.flipped = true;
    }
    if (ops) for (let n = pick(4); n > 0; n--) apply(MIXED_OPS[pick(MIXED_OPS.length)]);
    if (Number.isFinite(dt)) ts += dt;
    if (Number.isFinite(dt) && dt > 0) wall += dt;
    let changed = false;
    if (k === 0 || wall - readAt >= every) {
      const changes = valueChanges - valueChangesRead;
      valueChangesRead = valueChanges;
      o.reads++;
      if (k > 0) {
        o.maxValueChangesPerRead = Math.max(o.maxValueChangesPerRead, changes);
        if (changes >= 2) o.batchedValueReads++;
      }
      changed = !sameTapsByValue(input.taps, s.taps());
      input = { seq: s.seq(), taps: s.taps() };
      readAt = wall;
    }
    const before = ledger;
    ledger = reconcile(ledger, input, Number.isNaN(dt) ? Number.NaN : ts, mode);
    o.frames++;
    const f = fadesOf(ledger);
    // The slope bound into this frame: the mode of the crossfade that ran into it, times the clock's step.
    const ran = before.running === null ? null : before.running.mode;
    const bound = (ran === null ? 0 : SLOPE[ran] * (ledger.clock - before.clock)) * 1.001 + 1e-12;
    // No backlog (E3, resilience round 1 F2) and the queue bound.
    const live = new Set(f.placements.filter((p) => p.role === 'live').map((p) => p.id));
    const inStore = new Set(ledger.store.map((p) => p.id));
    const leaving = new Set(ledger.leaves.map((p) => p.id));
    const entering = new Set(ledger.enters.map((p) => p.id));
    const netted = ledger.leaves.length <= 3 && ledger.enters.length <= 3
      && [...leaving].every((pid) => live.has(pid) && !inStore.has(pid))
      && [...entering].every((pid) => !live.has(pid) && inStore.has(pid))
      && [...inStore].every((pid) => (live.has(pid) && !leaving.has(pid)) || entering.has(pid))
      && [...live].every((pid) => inStore.has(pid) || leaving.has(pid));
    if (!netted) o.netBreaks++;
    o.queueMax = Math.max(o.queueMax, ledger.leaves.length + ledger.enters.length);
    if (ledger.running === null && (ledger.leaves.length > 0 || ledger.enters.length > 0) && ledger.clock - ledger.lastStart >= SETTLE) o.stalls++;
    if (ledger.starts !== before.starts) {
      o.starts.push(ledger.lastStart);
      o.admittedAtStarts.push(ledger.admitted);
    }
    const demand = f.placements.length + f.restSlots.length;
    if (demand !== f.demand) o.demandMismatch++;
    o.maxDemand = Math.max(o.maxDemand, demand);
    // Fades by id: within the bound; enter at 0 (the first frame's reset excepted); leave at 0.
    const now = new Map<number, number>(f.placements.map((p) => [p.id, p.fade]));
    for (const e of f.ended) now.set(e, 0);
    for (const [pid, fade] of now) {
      const was = previous.get(pid);
      if (was === undefined) {
        if (fade !== 0 && k > 0) o.entersNotAtZero.push(pid);
      } else if (Math.abs(fade - was) > bound) {
        o.slopeBreaks.push(`id ${pid} at clock ${ledger.clock}: ${was} → ${fade} (bound ${bound})`);
      }
    }
    for (const [pid, was] of previous) if (!now.has(pid) && was !== 0) o.leavesNotAtZero.push(pid);
    previous = new Map([...now].filter(([pid]) => !f.ended.includes(pid)));
    // The ledger's rest lobes, by table index (one not drawn is at 0), within the same bound.
    for (let i = 0; i < Math.max(f.restFades.length, previousRest.length); i++) {
      if (k > 0 && Math.abs((f.restFades[i] ?? 0) - (previousRest[i] ?? 0)) > bound) o.restBreaks++;
    }
    previousRest = f.restFades;
    if (!f.placements.some((p) => p.node !== 'neutral' || deps.config.neutralLobe)) {
      o.framesWithoutLobe++;
      if (!f.restFades.every((r) => r === 1)) o.restShortWithoutLobe++;
    }
    // The built frame, built again only when the ledger's output changes: it must build, hold no more than
    // the demand, and its rest lobes obey the same bound.
    const key = f.placements.map((p) => `${p.id}:${p.slot}:${p.fade}`).join(',') + '|' + f.restFades.join(',') + '|' + f.restSlots.join(',');
    if (o.threw === null && key !== lastKey) {
      lastKey = key;
      try {
        const frame = buildFieldFrame(frameState(id, deps.face, f), geometry, deps.statics);
        packFrame(frame);
        const occupied = frame.nodes.filter((nd) => nd.fade > 0 || nd.bead !== null).length;
        if (occupied > f.demand) o.demandMismatch++;
        const rest = Math.max(0, ...frame.nodes.filter((nd) => nd.id === NODE.R0 && nd.bead === null).map((nd) => nd.fade));
        if (k > 0 && Math.abs(rest - builtRest) > bound) o.restBreaks++;
        builtRest = rest;
      } catch (error) {
        o.threw = `${(error as Error).name} at clock ${ledger.clock}: ${(error as Error).message}`;
      }
    }
    // Convergence, from the read that saw the last change of value: what is shown above 0 is exactly the
    // store's taps, every one at 1. F8's allowance: a rest lobe lit beside three live placements after it.
    if (changed) {
      seenAt = ledger.clock;
      o.restBesideThreeLive = false;
      o.restLitAfterLastTap = false;
      o.startsAfterLastRead = 0;
      o.maxStepAfterLastRead = 0;
    } else if (k > 0) {
      o.maxStepAfterLastRead = Math.max(o.maxStepAfterLastRead, ledger.clock - before.clock);
      if (ledger.starts !== before.starts) o.startsAfterLastRead++;
      if (f.restFade > 0) o.restLitAfterLastTap = true;
      if (f.restFade > 0 && live.size === 3) o.restBesideThreeLive = true;
    }
    const lit = f.placements.filter((p) => p.fade > 0);
    const same = lit.length === input.taps.length && lit.every((p, i) => p.fade === 1 && p.x === input.taps[i].x && p.y === input.taps[i].y);
    if (!same) sameSince = null;
    else if (sameSince === null) sameSince = ledger.clock;
  }
  o.lastTap = seenAt;
  o.converged = sameSince === null ? null : Math.max(0, sameSince - seenAt);
  o.framesNeededAtEnd = needsFrames(ledger);
  o.mode = mode;
  return o;
}

/**
 * The mixed storm's convergence bound (resilience T10 RA-21, ruling UI-191): E3's, on the tail's mode, plus one frame
 * step for each start after the last change's read and one for the last ramp's end, the step being the longest clock
 * step after that read, as the storm measured them. A start lands on the first frame past its spacing and a ramp ends
 * on the first frame past its duration; E3, on 1 ms frames, stays absolute.
 */
export function mixedBound(o: MixedOutcome): number {
  return (o.restBesideThreeLive ? 3 : 2) * SETTLE + RAMP[o.mode] + (o.startsAfterLastRead + 1) * o.maxStepAfterLastRead;
}

/** The mixed storm's clauses: E3's, on the tail's mode, but its convergence, which takes the frame quantum (mixedBound); then its own two. */
export function mixedFailures(label: string, o: MixedOutcome): string[] {
  // E3's clauses with its absolute convergence clause stood down (a converged 0 meets every bound); the mixed one below.
  const out = stormFailures(label, 'mixed', o.mode, { ...o, converged: 0 });
  const fail = (clause: string, detail: unknown) => out.push(`${label}: ${clause}: ${JSON.stringify(detail)}`);
  const bound = mixedBound(o);
  if (o.converged === null || o.converged > bound) fail(`did not converge within ${bound} ms of the last change's read`, o.converged);
  if (o.queueMax > 2 * ADMISSION.live) fail('the waiting queue held more than six changes', o.queueMax);
  if (o.framesNeededAtEnd) fail('frames still needed after the tail', o.framesNeededAtEnd);
  return out;
}

/** The mixed storm on every seed of a set, for one direction, start mode and input cadence: the runs made and every broken clause. */
export function mixedReport(id: DirectionId, mode: Mode, every: number, seeds: readonly number[], deps: StormDeps, opts: MixedOptions = {}): { runs: number; failures: string[]; outcomes: MixedOutcome[] } {
  const outcomes = seeds.map((seed) => mixedStorm(id, mode, seed, every, deps, opts));
  const failures = outcomes.flatMap((o, i) => mixedFailures(`${id} ${deps.face} ${mode} mixed seed ${seeds[i]} every ${every} ms`, o));
  return { runs: outcomes.length, failures, outcomes };
}

// The planted fades drivers (resilience, law round 2 (d)): each wraps the ledger's own fades and breaks
// exactly one of E3's fade clauses, so detectors D6–D9 each bite on a real storm. Each is a factory,
// made fresh per storm: no state is shared between storms (the S10-1 parity class).

/** D6: every placement's fade in quarter steps, round(4f)/4: 'a fade moved faster than its curve'. */
export const plantQuarterStepFades = (): FadesOf => (ledger) => {
  const f = fades(ledger);
  return { ...f, placements: f.placements.map((p) => ({ ...p, fade: Math.round(4 * p.fade) / 4 })) };
};

/** D7: an id's first-seen fade is 0.005, below one ms of either curve's slope: 'an id entered above 0'. */
export const plantEnterAboveZero = (): FadesOf => {
  const seen = new Set<number>();
  return (ledger) => {
    const f = fades(ledger);
    return {
      ...f,
      placements: f.placements.map((p) => {
        if (seen.has(p.id)) return p;
        seen.add(p.id);
        return { ...p, fade: 0.005 };
      }),
    };
  };
};

/**
 * D8: a leaving placement with fade below 0.02 is cut, from placements and from ended, with demand
 * reduced by the same count: 'an id left above 0'.
 */
export const plantCutLeaveEarly = (): FadesOf => (ledger) => {
  const f = fades(ledger);
  const cut = new Set(f.placements.filter((p) => p.role === 'leaving' && p.fade < 0.02).map((p) => p.id));
  return { ...f, placements: f.placements.filter((p) => !cut.has(p.id)), ended: f.ended.filter((e) => !cut.has(e)), demand: f.demand - cut.size };
};

/** D9: the rest lobes' fades in quarter steps up, ceil(4·restFade)/4, so 0 stays 0: 'a rest-lobe fade moved faster than its curve'. */
export const plantRestQuarterSteps = (): FadesOf => (ledger) => {
  const f = fades(ledger);
  const up = (r: number) => Math.ceil(4 * r) / 4;
  return { ...f, restFade: up(f.restFade), restFades: f.restFades.map(up) };
};

// The mixed storm reads the rest lobes twice: the ledger's, lobe by lobe, and the built frame's (their max, after the
// builder's own rule). D9 steps both, so each detector covered for the other (T10's harness mutation run, H9a and
// H9b); each of these two plants is seen by one of them only.

/**
 * The lowest of two or more drawn rest lobes in quarter steps down, floor(4·r)/4: the brightest is untouched, so
 * the built frame's rest (their max) never moves; only the ledger's per-lobe rest detector sees it.
 */
export const plantLowRestQuarterSteps = (): FadesOf => (ledger) => {
  const f = fades(ledger);
  if (f.restFades.length < 2) return f;
  const low = f.restFades.indexOf(Math.min(...f.restFades));
  return { ...f, restFades: f.restFades.map((r, i) => (i === low ? Math.floor(4 * r) / 4 : r)) };
};

/**
 * While the rest lobes rise, no placement is given (the demand follows): the builder, given no lobe-bearing
 * placement, draws the rest glow at 1 from the rise's first frame, while the ledger's rest fades rise from 0 on
 * their curve. Only the built frame's rest detector sees the step.
 */
export const plantNoPlacementsWhileRestRises = (): FadesOf => (ledger) => {
  const f = fades(ledger);
  return ledger.rest === 'in' ? { ...f, placements: [], demand: f.restSlots.length } : f;
};

// NaN (resilience T10 RA-25, UI-198): a detector written |a − b| > bound is false for NaN, so a NaN fade passes it. Each
// plant gives one fade NaN on one frame, mid-ramp, and nothing else changes: the builder draws a NaN fade as 0 (its
// finite(…, 0)), which moves no other clause.

/** One placement's fade NaN for one frame, the first time any fade is strictly between 0 and 1: the fade slope detector must see it. */
export const plantNaNFadeMidRamp = (): FadesOf => {
  let done = false;
  return (ledger) => {
    const f = fades(ledger);
    const at = done ? -1 : f.placements.findIndex((p) => p.fade > 0 && p.fade < 1);
    if (at < 0) return f;
    done = true;
    return { ...f, placements: f.placements.map((p, i) => (i === at ? { ...p, fade: Number.NaN } : p)) };
  };
};

/**
 * The first rest lobe's fade NaN for one frame, the first time two or more rest lobes rise mid-ramp: they rise together,
 * so the built frame's rest (their max) does not move, and only the ledger's per-lobe rest detector can see it.
 */
export const plantNaNRestMidRise = (): FadesOf => {
  let done = false;
  return (ledger) => {
    const f = fades(ledger);
    if (done || ledger.rest !== 'in' || f.restFades.length < 2 || !(f.restFades[0] > 0 && f.restFades[0] < 1)) return f;
    done = true;
    return { ...f, restFades: f.restFades.map((r, i) => (i === 0 ? Number.NaN : r)) };
  };
};
