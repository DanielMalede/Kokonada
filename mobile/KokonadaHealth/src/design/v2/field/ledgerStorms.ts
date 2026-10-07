// The ledger storms (QA-068, the event path, E3): one harness for the default run's coarse grid
// (field/__tests__/ledgerStorms.test.ts) and the sweeps project's full grid
// (field/__tests__/ledgerStorms.{abyss,linen,basin}.sweeps.test.ts), so the two cannot drift apart.
// Test-only: never imported by app code. It is not a worklet module, and it never imports the token
// extensions: the caller passes the statics in (stormDeps).
//
// E3 (resilience admission §3, the replacement text, adopted by the designer; its no-backlog sentence
// amended by resilience round 1 F2):
//
// "Ledger storms, run in every direction under {settle, reduced}. Storms: {toggle, cycle4, reemit,
//  neutral3 (Linen: three neutral placements, then three new neutral taps inside one settle window)},
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

import { BASE, DIRECTIONS, type DirectionId, type Face } from '../tokens/tokens.generated.ts';
import { buildFieldFrame, type FieldGeometry, type FieldState, type FieldStatics } from './fieldFrame.ts';
import { NODE, NODE_SLOTS } from './fieldLaw.ts';
import { ADMISSION, emptyLedger, fades, reconcile, type Admission, type LedgerConfig, type LedgerFades, type Tap } from './placementLedger.ts';
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
}
/** The ledger's config for a direction, from the statics the caller holds. */
export const stormDeps = (id: DirectionId, statics: FieldStatics): StormDeps => ({
  statics,
  config: { restLobes: statics.restLobes.length, neutralLobe: DIRECTIONS[id].field.lobe.neutralLobe > 0 },
});

export const tap = (x: number, y: number): Tap => ({ x, y });
export const QUAD = [tap(0.566, 0.566), tap(0.566, -0.566), tap(-0.566, -0.566), tap(-0.566, 0.566)];
export const neutral = (k: number) => tap(0.01 * (k % 9) + 0.01, -0.02);

/** The cold lane's taps as the storms drive them: at most three, with a seq bumped on every change. */
export function store(initial: Tap[] = []) {
  let taps = initial;
  let seq = 0;
  return {
    add(t: Tap) { taps = [...taps, t].slice(-3); seq++; },
    undo() { taps = taps.slice(0, -1); seq++; },
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
  placements: f.placements.map((p) => ({ x: p.x, y: p.y, fade: p.fade, ordinal: p.ordinal, slot: p.slot, role: p.role })),
  restFade: f.restFade,
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
  netBreaks: number;
  stalls: number;
  series: string[];
}

/** One storm, frame by frame at 1 ms, through the ledger and the builder. */
export function storm(
  id: DirectionId,
  mode: Mode,
  kind: Storm,
  every: number,
  span: number,
  deps: StormDeps,
  limits: Admission = ADMISSION,
  keepSeries = false,
  tail = 3 * SETTLE + RAMP[mode] + 200,
): Outcome {
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
    threw: null, lastTap, converged: null, restLitAfterLastTap: false, restBesideThreeLive: false, netBreaks: 0, stalls: 0, series: [],
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
    const f = fades(ledger);
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
    // The built frame: it must build (never slice, never overflow), and its rest lobes obey the bound.
    // The builder is pure, so a frame whose ledger output is unchanged builds the same frame: it is
    // built again only when the output changes.
    const key = f.placements.map((p) => `${p.id}:${p.slot}:${p.fade}`).join(',') + '|' + f.restFade + '|' + f.restSlots.join(',');
    if (o.threw === null && key !== lastKey) {
      lastKey = key;
      try {
        const frame = buildFieldFrame(frameState(id, 'dark', f), geometry, deps.statics);
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

/** E3's clauses on one storm's outcome: each broken clause, labelled. */
export function stormFailures(label: string, kind: Storm, mode: Mode, o: Outcome): string[] {
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
): { runs: number; failures: string[] } {
  const failures: string[] = [];
  let runs = 0;
  for (const every of grid.every) {
    const outcomes = grid.span.map((span) => storm(id, mode, kind, every, span, deps, limits, false, tail));
    runs += outcomes.length;
    outcomes.forEach((o, i) => failures.push(...stormFailures(`${id} ${mode} ${kind} every ${every} ms for ${grid.span[i]} ms`, kind, mode, o)));
    failures.push(...backlogBreaks(`${id} ${mode} ${kind} every ${every} ms`, grid.span, outcomes));
  }
  return { runs, failures };
}
