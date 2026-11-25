import { progress, rampProgress } from '../../../field/crossfade.ts';
import { relY, worstFlashesPerSecond } from '../../../field/flashCount.ts';
import { geometry as STORM_PLATE, neutral, QUAD, store, STORM_GRIDS } from '../../../field/ledgerStorms.ts';
import { admittedLive, emptyLedger, ledgerConfig, reconcile, stillLive, type Ledger, type Tap } from '../../../field/placementLedger.ts';
import { nodeAt } from '../../../field/fieldFrame.ts';
import { mixSafe } from '../../../color/mixSafe.ts';
import { BASE, DIRECTIONS, type Face } from '../../../tokens/tokens.generated.ts';
import { STATICS } from '../../../tokens/tokens.statics.generated.ts';
import { hexLab, srgbHex } from '../../../field/fieldLaw.ts';
import { ctaColours, ctaInitial, ctaReduce, ctaState, type CtaMachine, type CtaMode, type CtaPaint, type CtaPlacement, type CtaView } from '../ctaState.ts';

// E6, the CTA under the ledger (DEC-174; the resilience-auditor's text, verbatim in the decision): the machine is
// sampled every 1 ms while the real placement ledger runs E3's storms plus toggleJR, in both faces and both modes,
// with taps every {17, 143, 250} ms for 3 s (the coarse grid of the default run). Every clause is read from the
// machine's output alone, so each planted case below is judged by the same detectors, and each must fail:
//   flash   the fill composited over the ground at its opacity, as 8-bit sRGB: at most 2 general flashes and
//           at most 5 changes of 0.1 or more in any 1 s window;
//   starts  shows and tint changes begin only at admitted starts; every hide begins where the store empties;
//   latch   from a hide until the next admitted start, the opacity never rises;
//   step    the opacity moves at most its ramps' steepest slope per ms: a show starts from where the CTA is;
//   live    a start whose target holds a store-live tap has it fully shown by the start plus its ramp, and an
//           emptied store has it fully hidden within one hide;
//   press   pressable or exposed only while the store holds a tap and the CTA is shown and not hiding;
//   truth   the tint always belongs to a placement that is admitted and live in the store.

// toggleJR moves the latest between J and R (remove it and place the other in the same instant), so the store never
// empties and only the tint can flash; placeRemoveJR places and removes, alternating J and R, so the CTA hides and
// shows too; netted removes the only tap just before a start and places another, so the start shows a CTA that is
// still fading out (the netted-hide case of DEC-174's amendment 1).
type Storm = 'toggle' | 'cycle4' | 'reemit' | 'neutral3' | 'toggleJR' | 'placeRemoveJR' | 'netted';
const STORMS: readonly Storm[] = ['toggle', 'cycle4', 'reemit', 'neutral3', 'toggleJR', 'placeRemoveJR', 'netted'];
const MODES: readonly CtaMode[] = ['settle', 'reduced'];
const FACES: readonly Face[] = ['dark', 'light'];
const SETTLE = BASE.motion.settle.duration;
const SHOW: Record<CtaMode, number> = { settle: SETTLE, reduced: BASE.motion.fadeReduced.duration };
const HIDE: Record<CtaMode, number> = { settle: BASE.motion.respond.duration, reduced: BASE.motion.fadeReduced.duration };

/** The steepest change per ms any CTA ramp allows: the show (settle or reduced) and the hide (respond or reduced). */
const STEEPEST = (() => {
  let worst = 1 / BASE.motion.fadeReduced.duration;
  for (let t = 0; t < SETTLE; t += 0.25) worst = Math.max(worst, (progress('settle', t + 1) - progress('settle', t)));
  const r = BASE.motion.respond;
  for (let t = 0; t < r.duration; t += 0.25) worst = Math.max(worst, rampProgress(t + 1, r.duration, r.easing) - rampProgress(t, r.duration, r.easing));
  return worst;
})();

// ------------------------------------------------------------------------------------------------ the drivers

/** What the storm hands a CTA driver, and what it reads back. */
interface Driver {
  init(live: CtaPlacement[], taps: number, t: number): void;
  store(taps: number, t: number, newest: CtaPlacement | null): void;
  start(live: CtaPlacement[], t: number): void;
  view(t: number): CtaView;
}

function real(paint: CtaPaint, mode: CtaMode): Driver {
  let m: CtaMachine = ctaInitial(paint, [], 0, 0);
  return {
    init: (live, taps, t) => { m = ctaInitial(paint, live, taps, t); },
    store: (taps, t) => { m = ctaReduce(m, { kind: 'store', taps }, t, mode, paint); },
    start: (live, t) => { m = ctaReduce(m, { kind: 'start', live }, t, mode, paint); },
    view: (t) => ctaState(m, t, paint),
  };
}

/** Planted: the tint follows the store (a change at every store change), not the admitted starts. */
function storeTint(paint: CtaPaint, mode: CtaMode): Driver {
  const base = real(paint, mode);
  let tint: { node: ReturnType<typeof nodeAt>; owner: number; from: ReturnType<typeof ctaColours>['fill'] | null; at: number } | null = null;
  const band = { hueFrom: BASE.neverRed.design.hueStart, hueTo: BASE.neverRed.design.hueEnd, chromaFloor: BASE.neverRed.design.chromaFloor };
  const colourAt = (t: number) => {
    if (tint === null) return null;
    const to = ctaColours(paint, tint.node);
    const u = progress(mode, t - tint.at);
    return tint.from === null || u >= 1 ? to.fillHex : srgbHex(mixSafe(tint.from, to.fill, u, band));
  };
  return {
    ...base,
    init: (live, taps, t) => { base.init(live, taps, t); },
    store: (taps, t, newest) => {
      base.store(taps, t, newest);
      if (taps > 0 && newest !== null) {
        const node = nodeAt(newest.x, newest.y);
        if (tint === null || tint.node !== node) {
          const current = colourAt(t);
          tint = { node, owner: newest.id, from: current === null ? null : hexLab(current), at: t };
        } else tint = { ...tint, owner: newest.id };
      }
    },
    view: (t) => {
      const v = base.view(t);
      const fill = colourAt(t);
      return fill === null || v.tint === null ? v : { ...v, tint: { ...v.tint, fill, node: tint!.node, owner: tint!.owner } };
    },
  };
}

/** Planted: the show follows the store (a tap shows it at once, from where it is), not the admitted starts. */
function storeShow(paint: CtaPaint, mode: CtaMode): Driver {
  const base = real(paint, mode);
  let shadow: CtaMachine = ctaInitial(paint, [], 0, 0);
  return {
    ...base,
    init: (live, taps, t) => { base.init(live, taps, t); shadow = ctaInitial(paint, live, taps, t); },
    store: (taps, t, newest) => {
      base.store(taps, t, newest);
      shadow = ctaReduce(shadow, { kind: 'store', taps }, t, mode, paint);
      if (taps > 0 && newest !== null) shadow = ctaReduce(shadow, { kind: 'start', live: [newest] }, t, mode, paint);
    },
    view: (t) => {
      const v = base.view(t);
      const s = ctaState(shadow, t, paint);
      return { ...v, opacity: s.opacity, phase: s.phase, pressable: s.pressable, accessible: s.accessible, tint: v.tint ?? s.tint };
    },
  };
}

/** Planted: no hide latch: after a hide, a show ramp still running rewrites the opacity. */
function noLatch(paint: CtaPaint, mode: CtaMode): Driver {
  const base = real(paint, mode);
  let show: { at: number; from: number } | null = null;
  return {
    ...base,
    start: (live, t) => {
      const before = base.view(t).phase;
      base.start(live, t);
      if ((before === 'hidden' || before === 'hiding') && base.view(t).phase === 'showing') show = { at: t, from: base.view(t).opacity };
    },
    view: (t) => {
      const v = base.view(t);
      if (show === null || v.phase !== 'hiding' || t - show.at >= SHOW[mode]) return v;
      const rewritten = show.from + (1 - show.from) * progress(mode, t - show.at);
      return { ...v, opacity: Math.max(v.opacity, rewritten) };
    },
  };
}

/** Planted: the show fires only when the first placement is admitted (the target before it held none). */
function firstOnly(paint: CtaPaint, mode: CtaMode): Driver {
  const base = real(paint, mode);
  let previous: CtaPlacement[] = [];
  return {
    ...base,
    init: (live, taps, t) => { base.init(live, taps, t); previous = live; },
    start: (live, t) => {
      const shown = base.view(t).phase === 'showing' || base.view(t).phase === 'shown';
      if (shown || previous.length === 0) base.start(live, t);
      previous = live;
    },
  };
}

/** Planted: pressable (and exposed) whenever the store holds a tap, hidden or not. */
function pressableHidden(paint: CtaPaint, mode: CtaMode): Driver {
  const base = real(paint, mode);
  let taps = 0;
  return {
    ...base,
    init: (live, n, t) => { base.init(live, n, t); taps = n; },
    store: (n, t, newest) => { base.store(n, t, newest); taps = n; },
    view: (t) => ({ ...base.view(t), pressable: taps > 0, accessible: taps > 0 }),
  };
}

/** Planted (the step clause's control): a show that starts from 0, not from where the CTA is. */
function showFromZero(paint: CtaPaint, mode: CtaMode): Driver {
  const base = real(paint, mode);
  let show: { at: number } | null = null;
  return {
    ...base,
    start: (live, t) => {
      const before = base.view(t).phase;
      base.start(live, t);
      if ((before === 'hidden' || before === 'hiding') && base.view(t).phase === 'showing') show = { at: t };
    },
    view: (t) => {
      const v = base.view(t);
      return show !== null && v.phase === 'showing' ? { ...v, opacity: progress(mode, t - show.at) } : v;
    },
  };
}

type Factory = (paint: CtaPaint, mode: CtaMode) => Driver;

// ------------------------------------------------------------------------------------------------ the storm

interface Sample {
  readonly t: number;
  readonly view: CtaView;
  readonly taps: number;
  readonly live: ReadonlySet<number>;
  /** The store's taps and the ledger, as they are at this ms (the truth under the hop reads them). */
  readonly store: readonly Tap[];
  readonly ledger: Ledger;
}

/** A start's hop to JS (F4): delivered `delay` ms after the ledger made it, filtered by stillLive against the store then, or (planted) not. */
interface Hop {
  readonly delay: number;
  readonly filter: boolean;
}

interface Run {
  readonly samples: Sample[];
  /** Times of admitted starts (under the hop, of their deliveries), with the ids each carried to the CTA. */
  readonly starts: Array<{ t: number; live: number[] }>;
  /** Times the store emptied. */
  readonly empties: number[];
  readonly mode: CtaMode;
  readonly paint: CtaPaint;
  readonly hop: Hop | null;
  /** Under the hop, each delivery: what it carried, the store's taps then, and the ids in the ledger's store then. */
  readonly deliveries: Array<{ t: number; carried: CtaPlacement[]; store: readonly Tap[]; ledgerStore: ReadonlySet<number> }>;
  /** Under the hop, every placement a delivery carried, by id. */
  readonly delivered: Map<number, CtaPlacement>;
}

function schedule(kind: Storm, every: number, span: number, s: ReturnType<typeof store>) {
  const at = new Map<number, Array<() => void>>();
  const put = (t: number, act: () => void) => at.set(t, [...(at.get(t) ?? []), act]);
  let last = 0;
  if (kind === 'toggle') for (let t = 1, k = 0; t < span; t += every, k++) { put(t, k % 2 === 0 ? () => s.add(QUAD[1]) : () => s.undo()); last = t; }
  else if (kind === 'toggleJR') for (let t = 1, k = 0; t < span; t += every, k++) { const q = QUAD[k % 2 === 0 ? 0 : 2]; put(t, k === 0 ? () => s.add(q) : () => { s.undo(); s.add(q); }); last = t; }
  else if (kind === 'placeRemoveJR') for (let t = 1, k = 0; t < span; t += every, k++) { put(t, k % 2 === 1 ? () => s.undo() : k % 4 === 0 ? () => s.add(QUAD[0]) : () => s.add(QUAD[2])); last = t; }
  else if (kind === 'netted') for (let t = 0; t + SETTLE < span; t += 2 * SETTLE) { put(t + 1, () => s.add(QUAD[0])); put(t + SETTLE - 11, () => s.undo()); put(t + SETTLE - 6, () => s.add(QUAD[2])); put(t + SETTLE + 300, () => s.clear()); last = t + SETTLE + 300; }
  else if (kind === 'cycle4') for (let t = 1, k = 0; t < span; t += every, k++) { const q = QUAD[k % 4]; put(t, () => s.add(q)); last = t; }
  else if (kind === 'reemit') { put(1, () => s.add(QUAD[0])); last = 1; }
  else for (let k = 0; k < 3; k++) { const q = neutral(4 + k); put(100 + k * every, () => s.add(q)); last = 100 + k * every; }
  return { at, last };
}

function run(factory: Factory, kind: Storm, every: number, span: number, mode: CtaMode, face: Face, hop: Hop | null = null): Run {
  const paint: CtaPaint = { id: 'abyss', face };
  const driver = factory(paint, mode);
  const s = store(kind === 'neutral3' ? [neutral(1), neutral(2), neutral(3)] : []);
  const { at, last } = schedule(kind, every, span, s);
  const config = ledgerConfig('abyss', STATICS.abyss['field.rest'].lobes[face], { radiusPx: STORM_PLATE.radiusPx, pxPerDp: STORM_PLATE.pxPerDp });
  let ledger: Ledger = emptyLedger(config);
  const out: Run = { samples: [], starts: [], empties: [], mode, paint, hop, deliveries: [], delivered: new Map() };
  const end = Math.max(span, last) + 3 * SETTLE + SHOW[mode] + HIDE[mode] + 200 + (hop === null ? 0 : hop.delay);
  let seq = -1;
  let starts = 0;
  /** Under the hop: the starts made and not yet delivered, each with when it lands. */
  let inFlight: Array<{ due: number; live: CtaPlacement[] }> = [];
  for (let t = 0; t <= end; t++) {
    for (const act of at.get(t) ?? []) act();
    let input = { seq: s.seq(), taps: s.taps() as readonly Tap[] };
    if (kind === 'reemit' && t > 0 && t % every === 0) input = { seq: s.seq() + t, taps: s.taps().map((x) => ({ ...x })) };
    const changed = t > 0 && s.seq() !== seq;
    ledger = reconcile(ledger, input, t, mode);
    if (t === 0) driver.init(admittedLive(ledger), s.taps().length, 0);
    if (changed) {
      const newest = ledger.store.length > 0 ? ledger.store[ledger.store.length - 1] : null;
      driver.store(s.taps().length, t, newest === null ? null : { id: newest.id, x: newest.x, y: newest.y });
      if (s.taps().length === 0) out.empties.push(t);
    }
    seq = s.seq();
    if (ledger.starts !== starts) {
      starts = ledger.starts;
      const live = admittedLive(ledger);
      if (hop === null) {
        driver.start(live, t);
        out.starts.push({ t, live: live.map((p) => p.id) });
      } else inFlight.push({ due: t + hop.delay, live });
    }
    // A delivery lands after the store events of its ms, as runOnJS lands after the JS work already queued.
    if (hop !== null) {
      for (const f of inFlight.filter((x) => x.due === t)) {
        const carried = hop.filter ? stillLive(f.live, s.taps()) : f.live;
        driver.start(carried, t);
        out.starts.push({ t, live: carried.map((p) => p.id) });
        out.deliveries.push({ t, carried, store: s.taps(), ledgerStore: new Set(ledger.store.map((p) => p.id)) });
        for (const p of carried) out.delivered.set(p.id, p);
      }
      inFlight = inFlight.filter((x) => x.due !== t);
    }
    out.samples.push({ t, view: driver.view(t), taps: s.taps().length, live: new Set(admittedLive(ledger).map((p) => p.id)), store: s.taps(), ledger });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ the clauses

/** The 8-bit sRGB pixel of the fill composited over the face's ground at the CTA's opacity, and its luminance. */
function luminance(view: CtaView, face: Face): number {
  const bytes = (hex: string) => [0, 1, 2].map((i) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16));
  const g = bytes(DIRECTIONS.abyss.color[face].ground.hex);
  if (view.tint === null || view.opacity <= 0) return relY(g);
  const f = bytes(view.tint.fill);
  return relY(g.map((gc, i) => Math.round(gc * (1 - view.opacity) + f[i] * view.opacity)));
}

/** The WCAG changes worstFlashesPerSecond counts (≥ 0.1, darker side < 0.8), and the most in any 1 s window. */
function worstChanges(y: readonly number[], frameMs: number): number {
  const changes: number[] = [];
  let lo = y[0];
  let hi = y[0];
  let dir = 0;
  for (let i = 1; i < y.length; i++) {
    lo = Math.min(lo, y[i]);
    hi = Math.max(hi, y[i]);
    if (dir <= 0 && y[i] - lo >= 0.1 && lo < 0.8) { changes.push(i * frameMs); dir = 1; lo = hi = y[i]; }
    else if (dir >= 0 && hi - y[i] >= 0.1 && y[i] < 0.8) { changes.push(i * frameMs); dir = -1; lo = hi = y[i]; }
  }
  let worst = 0;
  for (let a = 0, b = 0; b < changes.length; b++) {
    while (changes[b] - changes[a] > 1000) a++;
    worst = Math.max(worst, b - a + 1);
  }
  return worst;
}

function clauses(r: Run): Record<'flash' | 'starts' | 'latch' | 'step' | 'live' | 'press' | 'truth', string[]> {
  const out = { flash: [] as string[], starts: [] as string[], latch: [] as string[], step: [] as string[], live: [] as string[], press: [] as string[], truth: [] as string[] };
  const ys = r.samples.map((x) => luminance(x.view, r.paint.face));
  const flashes = worstFlashesPerSecond(ys, 1);
  const changes = worstChanges(ys, 1);
  if (flashes > 2) out.flash.push(`${flashes} flashes in 1 s`);
  if (changes > 5) out.flash.push(`${changes} changes in 1 s`);
  const startAt = new Set(r.starts.map((x) => x.t));
  const emptyAt = new Set(r.empties);
  let latched = false;
  for (let i = 1; i < r.samples.length; i++) {
    const before = r.samples[i - 1];
    const now = r.samples[i];
    const t = now.t;
    const wasShown = before.view.phase === 'showing' || before.view.phase === 'shown';
    if (now.view.phase === 'showing' && !wasShown && !startAt.has(t)) out.starts.push(`a show began at ${t} ms with no start`);
    if (now.view.tint !== null && before.view.tint !== null && now.view.tint.node !== before.view.tint.node && !startAt.has(t)) out.starts.push(`a tint change began at ${t} ms with no start`);
    if (now.view.phase === 'hiding' && wasShown && !emptyAt.has(t)) out.starts.push(`a hide began at ${t} ms with the store not emptied`);
    // From the hide (it begins from where the CTA is, so its first sample is the show's last) to the next start.
    if (startAt.has(t)) latched = false;
    if (latched && now.view.opacity > before.view.opacity + 1e-12) out.latch.push(`the opacity rose at ${t} ms after a hide`);
    if (now.view.phase === 'hiding' && wasShown) latched = true;
    if (!(Math.abs(now.view.opacity - before.view.opacity) <= STEEPEST * 1.001 + 1e-12)) out.step.push(`${before.view.opacity} → ${now.view.opacity} at ${t} ms`);
    if ((now.view.pressable || now.view.accessible) && !(now.taps > 0 && (now.view.phase === 'showing' || now.view.phase === 'shown'))) out.press.push(`pressable at ${t} ms while ${now.view.phase} with ${now.taps} taps`);
    if (now.view.tint !== null && (before.view.tint === null || now.view.tint.owner !== before.view.tint.owner)) {
      const owner = now.view.tint.owner;
      if (r.hop === null) {
        if (!now.live.has(owner)) out.truth.push(`the tint went to ${owner} at ${t} ms, not admitted and live`);
      } else {
        // Under the hop: a placement a delivery carried, that the field still shows and not leaving, whose point the store holds now.
        const carried = r.delivered.get(owner);
        const shown = now.ledger.shown.some((p) => p.id === owner && p.phase !== 'out');
        if (carried === undefined || !shown || stillLive([carried], now.store).length === 0) out.truth.push(`the tint went to ${owner} at ${t} ms, not carried, shown and held by the store`);
      }
    }
  }
  const at = (t: number) => r.samples[Math.min(r.samples.length - 1, t)].view;
  for (const s of r.starts) {
    if (s.live.length === 0) continue;
    const due = s.t + SHOW[r.mode];
    if (r.empties.some((e) => e >= s.t && e <= due) || due >= r.samples.length) continue;
    if (at(due).opacity < 1 - 1e-9) out.live.push(`not shown by ${due} ms after the start at ${s.t} ms`);
  }
  for (const e of r.empties) {
    const due = e + HIDE[r.mode];
    if (r.starts.some((s) => s.live.length > 0 && s.t >= e && s.t <= due) || due >= r.samples.length) continue;
    if (at(due).opacity > 1e-9) out.live.push(`not hidden by ${due} ms after the store emptied at ${e} ms`);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ the tests

const GRID = STORM_GRIDS.coarse;
const CASES = STORMS.flatMap((kind) => GRID.every.flatMap((every) => MODES.flatMap((mode) => FACES.map((face) => ({ kind, every, mode, face })))));

describe('E6: the CTA under the ledger’s storms (DEC-174, coarse grid)', () => {
  it('the detectors are not blind: a 4 Hz square wave makes 9 changes in a closed 1 s window and 4 flashes, a single step none', () => {
    const square = Array.from({ length: 2000 }, (_, i) => (Math.floor(i / 125) % 2 === 0 ? 0.05 : 0.3));
    expect(worstChanges(square, 1)).toBe(9);
    expect(worstFlashesPerSecond(square, 1)).toBe(4);
    const step = Array.from({ length: 2000 }, (_, i) => (i < 1000 ? 0.05 : 0.3));
    expect(worstChanges(step, 1)).toBe(1);
    expect(worstFlashesPerSecond(step, 1)).toBe(0);
  });

  it.each(CASES)('$kind every $every ms, $mode, $face: every clause holds', ({ kind, every, mode, face }) => {
    const r = run(real, kind, every, GRID.span[0], mode, face);
    expect(clauses(r)).toEqual({ flash: [], starts: [], latch: [], step: [], live: [], press: [], truth: [] });
    // The storm really drives the CTA: it starts more than once and becomes visible.
    if (kind !== 'reemit' && kind !== 'neutral3') expect(r.starts.length).toBeGreaterThan(1);
    expect(Math.max(...r.samples.map((x) => x.view.opacity))).toBeGreaterThan(0.3);
  });

  it('the latch: a hide injected at every 10 ms of a show ramp never lets the opacity rise before the next start', () => {
    for (const mode of MODES) {
      for (let k = 0; k <= SETTLE; k += 10) {
        const paint: CtaPaint = { id: 'abyss', face: 'dark' };
        let m = ctaReduce(ctaInitial(paint, [], 0, 0), { kind: 'store', taps: 1 }, 0, mode, paint);
        m = ctaReduce(m, { kind: 'start', live: [{ id: 0, x: 0.6, y: 0.6 }] }, 0, mode, paint);
        m = ctaReduce(m, { kind: 'store', taps: 0 }, k, mode, paint);
        m = ctaReduce(m, { kind: 'store', taps: 1 }, k + 5, mode, paint);
        let previous = ctaState(m, k, paint).opacity;
        for (let t = k + 1; t < k + SETTLE; t++) {
          const now = ctaState(m, t, paint).opacity;
          expect(now).toBeLessThanOrEqual(previous + 1e-12);
          previous = now;
        }
      }
    }
  });
});

describe('E6: each planted case must fail (the clauses are watched failing)', () => {
  const PLANT_CASES = (['toggle', 'toggleJR', 'placeRemoveJR', 'cycle4', 'netted'] as const).flatMap((kind) => [17, 143].flatMap((every) => MODES.map((mode) => ({ kind, every, mode }))));
  const failures = (factory: Factory, clause: keyof ReturnType<typeof clauses>) =>
    PLANT_CASES.reduce((n, c) => n + clauses(run(factory, c.kind, c.every, GRID.span[0], c.mode, 'dark'))[clause].length, 0);

  it('the tint follows the store: it changes with no start, and flashes', () => {
    expect(failures(storeTint, 'starts')).toBeGreaterThan(0);
    expect(failures(storeTint, 'flash')).toBeGreaterThan(0);
  });

  it('the show follows the store: it shows with no start, and flashes', () => {
    expect(failures(storeShow, 'starts')).toBeGreaterThan(0);
    expect(failures(storeShow, 'flash')).toBeGreaterThan(0);
  });

  it('no hide latch: the running show ramp raises the opacity after a hide', () => {
    expect(failures(noLatch, 'latch')).toBeGreaterThan(0);
  });

  it('the show only on the first placement admitted: after a netted hide and a tap it never shows', () => {
    expect(failures(firstOnly, 'live')).toBeGreaterThan(0);
  });

  it('pressable while hidden', () => {
    expect(failures(pressableHidden, 'press')).toBeGreaterThan(0);
  });

  it('a show from 0 instead of from where the CTA is: the opacity steps', () => {
    expect(failures(showFromZero, 'step')).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------------------------------------ E6 under the hop

// F4 (the architect's F10 G8 findings): on the device a start crosses from the UI thread to JS (runOnJS) and lands after
// the store may have moved on. Here each start is delivered 16, 50 or 250 ms after the ledger made it, as FieldView
// delivers it: filtered by stillLive against the store at delivery. Store events stay immediate. Under the hop the
// clauses' starts are the deliveries, and the truth is read as JS can know it: at a delivery the tint goes to a
// placement that start carried, that the field still shows and not leaving, and whose point the store holds then. The
// ledger's ids cannot be that truth: a tap undone and placed again at its point within the hop is a new id in the
// ledger and the same tap in the store (the last test below), and the tint is the same either way.
const HOPS: readonly number[] = [16, 50, 250];
const HOP_CASES = CASES.flatMap((c) => HOPS.map((delay) => ({ ...c, delay })));
const HOP_PLANTS = (['toggle', 'toggleJR', 'placeRemoveJR', 'cycle4', 'netted'] as const).flatMap((kind) => [17, 143].flatMap((every) => MODES.flatMap((mode) => HOPS.map((delay) => ({ kind, every, mode, delay })))));

describe('E6 under the hop (F4): each start delivered late, through stillLive against the store at delivery', () => {
  it.each(HOP_CASES)('$kind every $every ms, $mode, $face, $delay ms late: every clause holds, and the CTA settles where the store does', ({ kind, every, mode, face, delay }) => {
    const r = run(real, kind, every, GRID.span[0], mode, face, { delay, filter: true });
    expect(clauses(r)).toEqual({ flash: [], starts: [], latch: [], step: [], live: [], press: [], truth: [] });
    if (kind !== 'reemit' && kind !== 'neutral3') expect(r.starts.length).toBeGreaterThan(1);
    expect(r.starts.every((s) => s.t >= delay)).toBe(true);
    const last = r.samples[r.samples.length - 1];
    expect(last.view.phase).toBe(last.taps > 0 ? 'shown' : 'hidden');
  });

  // The filtered control of these cases is the grid above (each holds every clause there).
  it('planted: with no filter, a start lands on a store that no longer holds its placement, and the truth clause fails', () => {
    const truth = HOP_PLANTS.reduce((n, c) => n + clauses(run(real, c.kind, c.every, GRID.span[0], c.mode, 'dark', { delay: c.delay, filter: false })).truth.length, 0);
    expect(truth).toBeGreaterThan(0);
  });

  it('the ledger’s ids are not the truth under the hop: toggled every 17 ms and 50 ms late, a delivered tap is back in the store under a new ledger id', () => {
    const r = run(real, 'toggle', 17, GRID.span[0], 'settle', 'dark', { delay: 50, filter: true });
    const reAdded = r.deliveries.filter((d) => d.carried.some((p) => !d.ledgerStore.has(p.id)));
    expect(reAdded.length).toBeGreaterThan(0);
    for (const d of reAdded) for (const p of d.carried) expect(stillLive([p], d.store)).toEqual([p]);
    expect(clauses(r).truth).toEqual([]);
  });
});
