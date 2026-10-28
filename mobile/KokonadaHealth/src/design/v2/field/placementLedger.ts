// The placement ledger (architect admission §1; designer final rulings (1) and (2); resilience's
// QA-068 driver and admission notes): the visual layer's record of the placements, and the only thing
// the field reads them from. It is derived from the cold-lane taps alone, read structurally as
// {x, y} (this module never imports src/state), and nothing in it is persisted.
//
// It runs once per frame on the UI thread: reconcile(prev, {seq, taps}, nowMs, mode), then fades(),
// and needsFrames() tells the still tier whether to keep its frame callback running. It is pure: no
// clock of its own, no I/O, plain data in and out, and every function is a worklet.
//
// Identity: each placement gets an id, its ordinal (how many came before it), from a counter that
// only rises. The builder keys a lobe's drift by it for the placement's whole life.
//
// Reading the store:
//   · a fresh ledger's first input is the only reset: its taps are shown at once, at fade 1 (a mount;
//     a lab scene mounts a fresh ledger, so its order is its ordinal). Any other seq change, forward
//     or backward, is read by value, as the pops and adds that keep the most taps. Several store
//     changes seen in one frame (React may batch them) are read as their events, so nothing steps;
//   · the taps lost from the tail go first (a clear's oldest first), then those shifted out from the
//     front: the order the cold lane loses them in.
//
// Netting (resilience): a leave of a placement whose enter is still waiting cancels that enter, so
// what waits is always the difference between the field and the store, never a raw queue. The waiting
// leaves and enters, each in arrival order, pair into swaps, then any lone leaves or enters.
//
// Serialized crossfades (designer 2.6 as amended): a crossfade never restarts or interrupts another,
// so every fade is 0 or 1 when one starts; starts are at least motion.settle.duration apart in every
// mode, on the ledger's own clock (dt clamped by motion.dtClamp, never running backwards), the same
// clock the ramp's u runs on. Incoming fades are u, outgoing 1 − u^(1+ω) (crossfade.ts).
//
// The overlap ω (law round 2, designer L7, amending 2.6): computed once per crossfade, at its start, and
// fixed for its life. For each leaving placement and each falling rest lobe, ω = smoothstep(0, ν·r_L, δ),
// δ the distance from its undrifted lobe centre to the nearest undrifted centre coming in in the same
// crossfade (entering placements, and rest lobes rising), 1 with none. ν = field.crossfade.overlapFar,
// r_L = field.lobe.radius without the breath. A placement's undrifted centre is the builder's own
// (lobeAnchor), on the plate the config was made for (ledgerConfig). So a lobe replaced in place
// crossfades linearly, and a lobe left alone holds.
//
// Admission (designer final ruling (1)): the arrival-order prefix of the waiting swaps, stopping at
// the first that does not fit: at most 2 entering and 2 leaving, at most 3 live after, and live +
// entering + leaving + rest lobes (above 0 or rising) within NODE_SLOTS. There is no eviction.
//
// Rest lobes (designer 2.6): they are lit while no live placement carries a lobe, and cross-fade with
// the placements that change that.
//
// Slots: one pool of NODE_SLOTS. A node keeps its slot from the frame it enters until its fade
// reaches 0; freed slots are reused lowest first.

import { clampFrameDt } from '../clock/frameDt.ts';
import { BASE, DIRECTIONS, type DirectionId } from '../tokens/tokens.generated.ts';
import { crossfade, overlapOmega, progress, type FadeMode } from './crossfade.ts';
import { lobeAnchor, nodeAt, type PlacementNode } from './fieldFrame.ts';
import { NODE_SLOTS } from './fieldLaw.ts';

export interface Tap {
  readonly x: number;
  readonly y: number;
}

export interface LedgerInput {
  /** Bumped by the composition root whenever the cold-lane taps change. */
  readonly seq: number;
  readonly taps: readonly Tap[];
}

export interface LedgerConfig {
  /** How many rest lobes the face has (field.rest.lobes): overlap.rest's length. */
  readonly restLobes: number;
  /** Does a neutral placement carry a lobe here (field.lobe.neutralLobe)? */
  readonly neutralLobe: boolean;
  /** Where the lobes sit, undrifted, for L7's ω. */
  readonly overlap: LedgerOverlap;
}

/** L7's inputs: every lobe's undrifted centre, and the reach ν·r_L. */
export interface LedgerOverlap {
  /** The face's rest-lobe centres, × R (field.rest.lobes), in the table's order. */
  readonly rest: ReadonlyArray<readonly [number, number]>;
  /** The direction's field.lobe.centreAlpha and centreBeta. */
  readonly centreAlpha: number;
  readonly centreBeta: number;
  /** The bead radius in plate units, on the plate the field is drawn on (fieldFrame.ts beadRadius). */
  readonly beadRadius: number;
  /** ν·r_L: field.crossfade.overlapFar × field.lobe.radius. 0 or less is the planted hold (ω = 1). */
  readonly reach: number;
}

/**
 * The ledger's config for a direction, one face's rest table and the plate (its radius in px and px per
 * dp, as the builder reads them): the counts the admission needs and the centres L7 needs.
 */
export function ledgerConfig(id: DirectionId, rest: ReadonlyArray<readonly [number, number]>, plate: { readonly radiusPx: number; readonly pxPerDp: number }): LedgerConfig {
  'worklet';
  const d = DIRECTIONS[id];
  return {
    restLobes: rest.length,
    neutralLobe: d.field.lobe.neutralLobe > 0,
    overlap: {
      rest,
      centreAlpha: d.field.lobe.centreAlpha,
      centreBeta: d.field.lobe.centreBeta,
      beadRadius: d.bead.diameter / 2 / (plate.radiusPx / plate.pxPerDp),
      reach: BASE.field.crossfade.overlapFar * d.field.lobe.radius,
    },
  };
}

/** The admission limits. Tests plant others to show each guard bites; the field uses ADMISSION. */
export interface Admission {
  readonly entering: number;
  readonly leaving: number;
  readonly live: number;
  readonly nodes: number;
  /** Net a leave against its waiting enter. A raw first-in-first-out queue is a planted control only. */
  readonly netting: boolean;
}

export const ADMISSION: Admission = { entering: 2, leaving: 2, live: 3, nodes: NODE_SLOTS, netting: true };

interface Placed {
  readonly id: number;
  readonly x: number;
  readonly y: number;
}

type Phase = 'still' | 'in' | 'out';
type RestPhase = 'on' | 'off' | 'in' | 'out';

interface Shown extends Placed {
  readonly node: PlacementNode;
  readonly slot: number;
  /** 'in' while entering in the running crossfade, 'out' while leaving it. */
  readonly phase: Phase;
  /** L7's ω, fixed at the start of the crossfade it leaves in; 1 otherwise. */
  readonly omega: number;
}

export interface Ledger {
  readonly config: LedgerConfig;
  readonly limits: Admission;
  /** The last seq read; null before the first frame. */
  readonly seq: number | null;
  /** The store's taps as the ledger reads them, each with its id. */
  readonly store: readonly Placed[];
  /** The next id. */
  readonly next: number;
  /** What the field shows: settled, entering or leaving. */
  readonly shown: readonly Shown[];
  /** Waiting changes, each in arrival order. */
  readonly leaves: readonly Placed[];
  readonly enters: readonly Placed[];
  readonly rest: RestPhase;
  readonly restSlots: readonly number[];
  /** Each rest lobe's ω while they fall ('out'), fixed at that crossfade's start; [] otherwise. */
  readonly restOmegas: readonly number[];
  readonly running: null | { readonly elapsed: number; readonly mode: FadeMode };
  /** The ledger's own clock, in ms: clamped steps, never backwards. */
  readonly clock: number;
  readonly lastNow: number | null;
  readonly lastStart: number;
  readonly starts: number;
  /** Swaps (or lone changes) admitted at the latest start. */
  readonly admitted: number;
  /** Ids whose fade reached 0 on the latest reconcile. */
  readonly ended: readonly number[];
}

export interface LedgerPlacement {
  readonly id: number;
  readonly ordinal: number;
  readonly x: number;
  readonly y: number;
  readonly node: PlacementNode;
  readonly fade: number;
  readonly role: 'live' | 'leaving';
  readonly slot: number;
}

export interface LedgerFades {
  readonly placements: readonly LedgerPlacement[];
  readonly ended: readonly number[];
  /** The brightest rest lobe's fade: 1 lit, 0 off. */
  readonly restFade: number;
  /** Each rest lobe's fade, in the table's order, while they are drawn; [] when off. What a frame takes as its restFade (L7). */
  readonly restFades: readonly number[];
  readonly restSlots: readonly number[];
  /** Live, entering and leaving placements, plus rest lobes above 0 or rising: what the frame holds. */
  readonly demand: number;
}

/** Before any start: far enough back that the first change starts at once. */
const LONG_AGO = -1e12;

/** The lowest `count` slots not in `used`; −1 where none is free, which the builder refuses. */
function freeSlots(count: number, used: readonly number[]): number[] {
  'worklet';
  const out: number[] = [];
  for (let s = 0; s < NODE_SLOTS && out.length < count; s++) if (used.indexOf(s) < 0) out.push(s);
  while (out.length < count) out.push(-1);
  return out;
}

function bearsLobe(node: PlacementNode, config: LedgerConfig): boolean {
  'worklet';
  return node !== 'neutral' || config.neutralLobe;
}

function sameTap(a: Tap, b: Tap): boolean {
  'worklet';
  return a.x === b.x && a.y === b.y;
}

function sameTaps(store: readonly Placed[], taps: readonly Tap[]): boolean {
  'worklet';
  if (store.length !== taps.length) return false;
  for (let i = 0; i < taps.length; i++) if (!sameTap(store[i], taps[i])) return false;
  return true;
}

export function emptyLedger(config: LedgerConfig, limits: Admission = ADMISSION): Ledger {
  'worklet';
  if (config.restLobes !== config.overlap.rest.length) {
    throw new RangeError(`a ledger config counts ${config.restLobes} rest lobes but places ${config.overlap.rest.length}`);
  }
  return {
    config,
    limits,
    seq: null,
    store: [],
    next: 0,
    shown: [],
    leaves: [],
    enters: [],
    rest: 'on',
    restSlots: freeSlots(config.restLobes, []),
    restOmegas: [],
    running: null,
    clock: 0,
    lastNow: null,
    lastStart: LONG_AGO,
    starts: 0,
    admitted: 0,
    ended: [],
  };
}

/** Shown at once, at fade 1: a fresh ledger's first input, the only reset. */
function reset(l: Ledger, taps: readonly Tap[], seq: number): Ledger {
  'worklet';
  const shown: Shown[] = taps.map((t, i) => ({ id: l.next + i, x: t.x, y: t.y, node: nodeAt(t.x, t.y), slot: i, phase: 'still' as const, omega: 1 }));
  const lit = !shown.some((s) => bearsLobe(s.node, l.config));
  return {
    ...l,
    seq,
    store: shown.map((s) => ({ id: s.id, x: s.x, y: s.y })),
    next: l.next + taps.length,
    shown,
    leaves: [],
    enters: [],
    rest: lit ? 'on' : 'off',
    restSlots: lit ? freeSlots(l.config.restLobes, shown.map((s) => s.slot)) : [],
    restOmegas: [],
    running: null,
    ended: [...l.ended, ...l.shown.map((s) => s.id)],
  };
}

/** A change of seq, read by value as the pops and adds that keep the most taps, and netted. */
function change(l: Ledger, taps: readonly Tap[], seq: number): Ledger {
  'worklet';
  const old = l.store;
  // N starts with old[a, b): the kept run. Most kept wins; ties keep the earliest run.
  let a = 0;
  let b = 0;
  for (let from = 0; from < old.length; from++) {
    for (let to = from + 1; to <= old.length; to++) {
      const keep = to - from;
      if (keep > b - a && keep <= taps.length) {
        let match = true;
        for (let i = 0; i < keep; i++) if (!sameTap(old[from + i], taps[i])) match = false;
        if (match) {
          a = from;
          b = to;
        }
      }
    }
  }
  const kept = old.slice(a, b);
  // Lost from the tail first (pops, a clear), then shifted out from the front.
  const lost = [...old.slice(b), ...old.slice(0, a)];
  const added: Placed[] = taps.slice(b - a).map((t, i) => ({ id: l.next + i, x: t.x, y: t.y }));
  let enters = [...l.enters];
  const leaves = [...l.leaves];
  for (const gone of lost) {
    const waiting = enters.findIndex((e) => e.id === gone.id);
    if (l.limits.netting && waiting >= 0) enters = enters.filter((_, i) => i !== waiting);
    else leaves.push(gone);
  }
  return { ...l, seq, store: [...kept, ...added], next: l.next + added.length, leaves, enters: [...enters, ...added] };
}

/**
 * The store's taps as the field reads them: at most the cold lane's three (emotionSlice MAX_TAPS), and
 * a non-finite coordinate read as 0, as the builder reads it (fieldFrame.ts finite(…, 0)), so both give
 * a tap the same node.
 */
function readTaps(taps: readonly Tap[]): Tap[] {
  'worklet';
  return taps.slice(-ADMISSION.live).map((t) => ({ x: Number.isFinite(t.x) ? t.x : 0, y: Number.isFinite(t.y) ? t.y : 0 }));
}

/** How many of the waiting swaps (then lone changes) fit, as an arrival-order prefix. */
function admissible(l: Ledger): { count: number; leaving: Placed[]; entering: Placed[]; restLit: boolean } {
  'worklet';
  const steps: Array<{ leave: Placed | null; enter: Placed | null }> = [];
  const pairs = Math.max(l.leaves.length, l.enters.length);
  for (let i = 0; i < pairs; i++) steps.push({ leave: i < l.leaves.length ? l.leaves[i] : null, enter: i < l.enters.length ? l.enters[i] : null });
  let best = { count: 0, leaving: [] as Placed[], entering: [] as Placed[], restLit: l.rest === 'on' };
  const leaving: Placed[] = [];
  const entering: Placed[] = [];
  for (let k = 0; k < steps.length; k++) {
    const step = steps[k];
    if (step.leave !== null) {
      const target = step.leave.id;
      // A leave must take something the field shows (with netting off, it may still be waiting).
      if (!l.shown.some((s) => s.id === target && s.phase === 'still')) break;
      leaving.push(step.leave);
    }
    if (step.enter !== null) entering.push(step.enter);
    const liveAfter = [
      ...l.shown.filter((s) => leaving.every((x) => x.id !== s.id)).map((s) => s.node),
      ...entering.map((e) => nodeAt(e.x, e.y)),
    ];
    const restLit = !liveAfter.some((node) => bearsLobe(node, l.config));
    const restCounted = l.rest === 'on' || restLit ? l.config.restLobes : 0;
    const demand = l.shown.length + entering.length + restCounted;
    if (leaving.length > l.limits.leaving || entering.length > l.limits.entering || liveAfter.length > l.limits.live || demand > l.limits.nodes) break;
    best = { count: k + 1, leaving: [...leaving], entering: [...entering], restLit };
  }
  return best;
}

/** A placement's undrifted lobe centre, as the builder places it (lobeAnchor). */
function anchorOf(p: Tap, o: LedgerOverlap): readonly [number, number] {
  'worklet';
  return lobeAnchor(p.x, p.y, o.beadRadius, o.centreAlpha, o.centreBeta);
}

/** L7's ω for an outgoing lobe at `c`: from the nearest centre coming in, or the hold with none. */
function omegaAt(c: readonly [number, number], incoming: ReadonlyArray<readonly [number, number]>, reach: number): number {
  'worklet';
  let nearest = Infinity;
  for (const q of incoming) nearest = Math.min(nearest, Math.hypot(c[0] - q[0], c[1] - q[1]));
  return overlapOmega(nearest, reach);
}

/**
 * Start a crossfade with the admitted changes: leavers go 'out', new ones come 'in' in free slots, and
 * every outgoing lobe's ω is fixed here, once, for the life of the crossfade (L7).
 */
function start(l: Ledger, mode: FadeMode): Ledger {
  'worklet';
  const plan = admissible(l);
  if (plan.count === 0) return l;
  const restFalling = l.rest === 'on' && !plan.restLit;
  const restRising = l.rest === 'off' && plan.restLit;
  // L7: every centre coming in (entering lobes, and rest lobes rising), then each outgoing lobe's ω.
  const o = l.config.overlap;
  const entering = plan.entering.map((e) => anchorOf(e, o));
  const incoming = restRising ? [...entering, ...o.rest] : entering;
  const shown: Shown[] = l.shown.map((s) => (plan.leaving.some((x) => x.id === s.id) ? { ...s, phase: 'out' as const, omega: omegaAt(anchorOf(s, o), incoming, o.reach) } : s));
  const used = [...shown.map((s) => s.slot), ...l.restSlots];
  const slots = freeSlots(plan.entering.length, used);
  plan.entering.forEach((e, i) => shown.push({ id: e.id, x: e.x, y: e.y, node: nodeAt(e.x, e.y), slot: slots[i], phase: 'in', omega: 1 }));
  const rest: RestPhase = restFalling ? 'out' : restRising ? 'in' : l.rest;
  const restSlots = restRising ? freeSlots(l.config.restLobes, shown.map((s) => s.slot)) : l.restSlots;
  const restOmegas = restFalling ? o.rest.map((c) => omegaAt(c, entering, o.reach)) : [];
  return {
    ...l,
    shown,
    restOmegas,
    leaves: l.leaves.filter((x) => plan.leaving.every((y) => y.id !== x.id)),
    enters: l.enters.filter((x) => plan.entering.every((y) => y.id !== x.id)),
    rest,
    restSlots,
    running: { elapsed: 0, mode },
    lastStart: l.clock,
    starts: l.starts + 1,
    admitted: plan.count,
  };
}

/** The running crossfade has reached u = 1: leavers end, entrants settle, the rest lobes arrive. */
function finish(l: Ledger): Ledger {
  'worklet';
  const ended = l.shown.filter((s) => s.phase === 'out').map((s) => s.id);
  const rest = l.rest === 'in' ? 'on' : l.rest === 'out' ? 'off' : l.rest;
  return {
    ...l,
    shown: l.shown.filter((s) => s.phase !== 'out').map((s) => (s.phase === 'in' ? { ...s, phase: 'still' as const } : s)),
    rest,
    restSlots: rest === 'off' ? [] : l.restSlots,
    restOmegas: [],
    running: null,
    ended: [...l.ended, ...ended],
  };
}

/** One frame: advance the running crossfade on the clamped clock, read the store, start what may start. */
export function reconcile(prev: Ledger, input: LedgerInput, nowMs: number, mode: FadeMode): Ledger {
  'worklet';
  const dt = prev.lastNow === null ? 0 : clampFrameDt(nowMs - prev.lastNow);
  let l: Ledger = { ...prev, clock: prev.clock + dt, lastNow: nowMs, ended: [] };
  if (l.running !== null) {
    l = { ...l, running: { ...l.running, elapsed: l.running.elapsed + dt } };
    if (progress(l.running!.mode, l.running!.elapsed) >= 1) l = finish(l);
  }
  if (l.seq === null) {
    l = reset(l, readTaps(input.taps), input.seq);
  } else if (input.seq !== l.seq) {
    const taps = readTaps(input.taps);
    l = sameTaps(l.store, taps) ? { ...l, seq: input.seq } : change(l, taps, input.seq);
  }
  const waiting = l.leaves.length > 0 || l.enters.length > 0;
  if (l.running === null && waiting && l.clock - l.lastStart >= BASE.motion.settle.duration) l = start(l, mode);
  return l;
}

/** What the field draws this frame, from the ledger alone: each outgoing lobe on the ω fixed at its start. */
export function fades(l: Ledger): LedgerFades {
  'worklet';
  const u = l.running === null ? 1 : progress(l.running.mode, l.running.elapsed);
  const c = crossfade(u);
  const placements = [...l.shown]
    .sort((p, q) => p.id - q.id)
    .map((s) => ({
      id: s.id,
      ordinal: s.id,
      x: s.x,
      y: s.y,
      node: s.node,
      fade: s.phase === 'in' ? c.in : s.phase === 'out' ? crossfade(u, s.omega).out : 1,
      role: s.phase === 'out' ? ('leaving' as const) : ('live' as const),
      slot: s.slot,
    }));
  const restSlots = l.rest === 'off' ? [] : [...l.restSlots];
  const restFades = restSlots.map((_, i) => (l.rest === 'on' ? 1 : l.rest === 'in' ? c.in : crossfade(u, i < l.restOmegas.length ? l.restOmegas[i] : 1).out));
  const restFade = l.rest === 'on' ? 1 : l.rest === 'off' ? 0 : l.rest === 'in' ? c.in : restFades.length > 0 ? Math.max(...restFades) : c.out;
  return { placements, ended: [...l.ended], restFade, restFades, restSlots, demand: placements.length + restSlots.length };
}

/** Does the field need frames? While a crossfade runs, or a change waits for its start. */
export function needsFrames(l: Ledger): boolean {
  'worklet';
  return l.running !== null || l.leaves.length > 0 || l.enters.length > 0;
}
