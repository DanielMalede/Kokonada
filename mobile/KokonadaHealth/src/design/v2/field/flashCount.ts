// E4, the rendered flash count (QA-068, the event path; resilience QA-068 test change 2, with the
// additions of resilience admission §3). Test-only, like ledgerStorms.ts: never imported by app code,
// not a worklet module, and the caller passes the statics in.
//
// "E4, rendered flash count (in the sweeps jest project, because it is slow):
//  - Cases: {abyss dark, [a retired direction] dark, abyss light} × modes × {toggle, cycle4} × every ∈ {50, 100, 143,
//    167, 250}.
//  - Settings: c = 1, genesis on, tier still under reduced motion, grain and dither 0, 60 fps for 4 s,
//    a 12×12 grid over ±1.2 R.
//  - Pass: worstFlashesPerSecond(trace) ≤ 2 at every grid point.
//  - Planted controls. Each must be watched failing first, or the guard is blind: the counter on a
//    4 Hz square wave (Y 0.05↔0.30) returns 4; on a single step it returns 0. A naive inline driver
//    that restarts in 0 / out 1 on every tap, run at Abyss dark, reduced, toggle every 143 ms, must
//    give ≥ 3."
// "E4 (additions): Rows also include [a retired direction's] dark and light under neutral3. Besides the 12×12 grid,
//  sample a 5×5 lattice inside each placement's halo radius (≤ 22 dp)."
// Law round 2 (resilience B1, adopted in the reconciliation): "New samples: a 5×5 lattice at ±0.05 R
// around every rest-lobe centre and every placement-lobe centre at the storm's first frame. Rest-lobe
// centres are statics.restLobes plus drift; placement-lobe centres are centreAlpha·bead + centreBeta·unit
// + drift." A placement's drift is its ordinal's, mod the three drift tables, so each tap's lobe is taken
// at ordinals 0, 1 and 2. And (designer item 2 (iii)): E4 runs under the old Abyss rest table too
// (ABYSS_DARK_REST_BEFORE_ITEM_6, in the sweeps test), so the law's fix is proven on its own merits.
// The close-out (Abyss only, 2026-10-27) keeps Abyss's rows, and runs neutral3 on Abyss's dark and
// light faces in place of the retired direction's: no other Abyss storm places only neutral beads.
// The property the retired rows guarded (only neutral placements, neutralLobe 0: the rest lobes stay
// lit, no rest crossfade) is a structural assertion on the fixture direction (fixturePaths.test.ts).
//
// Rendered: each sample is the law's 8-bit sRGB pixel (fieldPixel), which fieldShader.skia.test.ts
// holds to the shader's pixel within ±1 LSB; the sweeps project runs in plain node, without CanvasKit.
// The tension is 0. Under settle the clock and the breath run with the frames at tier full; under
// reduced motion the tier is still, so only the placements move. E6, the CTA under the storms, waits
// for the CTA (B6): it has no tint to sample here yet.

import { BASE, type DirectionId, type Face } from '../tokens/tokens.generated.ts';
import { crossfade, progress } from './crossfade.ts';
import { buildFieldFrame, fixedFieldBreath, type FieldGeometry, type FieldState, type Placement } from './fieldFrame.ts';
import { fieldPixel } from './fieldLaw.ts';
import { QUAD, neutral, store, type Mode, type StormDeps } from './ledgerStorms.ts';
import { emptyLedger, fades, reconcile, type Tap } from './placementLedger.ts';

/** WCAG relative luminance of an 8-bit sRGB pixel. */
export const relY = ([r, g, b]: readonly number[]) => {
  const lin = (c: number) => {
    const x = c / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

/** Most WCAG 2.3.1 general flashes in any 1 s window: a change counts at ≥ 0.1 with the darker side < 0.8; two opposing changes make one flash. */
export function worstFlashesPerSecond(y: readonly number[], frameMs: number): number {
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
    worst = Math.max(worst, Math.floor((b - a + 1) / 2));
  }
  return worst;
}

export type FlashStorm = 'toggle' | 'cycle4' | 'neutral3';
export interface FlashCase {
  readonly id: DirectionId;
  readonly face: Face;
  readonly mode: Mode;
  readonly kind: FlashStorm;
  readonly every: number;
}

export const FRAME_MS = 1000 / 60;
export const FRAMES = 240;
/** The cases: Abyss dark and light under toggle and cycle4, and under neutral3. */
export const E4_CADENCES = [50, 100, 143, 167, 250];
export const E4_CASES: readonly FlashCase[] = [
  ...([['abyss', 'dark'], ['abyss', 'light']] as Array<[DirectionId, Face]>).flatMap(([id, face]) =>
    (['settle', 'reduced'] as Mode[]).flatMap((mode) => (['toggle', 'cycle4'] as FlashStorm[]).flatMap((kind) => E4_CADENCES.map((every) => ({ id, face, mode, kind, every }))))),
  ...(['dark', 'light'] as Face[]).flatMap((face) => (['settle', 'reduced'] as Mode[]).flatMap((mode) => E4_CADENCES.map((every) => ({ id: 'abyss' as DirectionId, face, mode, kind: 'neutral3' as FlashStorm, every })))),
];

const R_DP = BASE.plate.maxDiameter / 2;
const C_PX = 1.5 * R_DP;
/** The plate at 1 px per dp, with its centre far enough in that every sample sits at positive pixels. */
const geometry: FieldGeometry = { centrePx: [C_PX, C_PX], radiusPx: R_DP, pxPerDp: 1, fontScale: 1 };

/** The taps of a storm over the 4 s window, each at its time, as store operations. */
function schedule(kind: FlashStorm, every: number, s: ReturnType<typeof store>): Map<number, Array<() => void>> {
  const at = new Map<number, Array<() => void>>();
  const put = (t: number, act: () => void) => at.set(t, [...(at.get(t) ?? []), act]);
  const span = FRAMES * FRAME_MS;
  if (kind === 'toggle') for (let t = 1, k = 0; t < span; t += every, k++) put(t, k % 2 === 0 ? () => s.add(QUAD[1]) : () => s.undo());
  else if (kind === 'cycle4') for (let t = 1, k = 0; t < span; t += every, k++) { const q = QUAD[k % 4]; put(t, () => s.add(q)); }
  else for (let k = 0; k < 3; k++) { const q = neutral(4 + k); put(100 + k * every, () => s.add(q)); }
  return at;
}

/** Every tap position a storm uses: the halo lattices sit around them. */
function tapsOf(kind: FlashStorm): Tap[] {
  if (kind === 'toggle') return [QUAD[1]];
  if (kind === 'cycle4') return [...QUAD];
  return [1, 2, 3, 4, 5, 6].map(neutral);
}

/** The samples, in plate units: the 12×12 grid over ±1.2 R, and a 5×5 lattice inside each tap's halo radius. */
export function samplePoints(kind: FlashStorm): Array<[number, number]> {
  const grid: Array<[number, number]> = [];
  for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) grid.push([-1.2 + (2.4 * i) / 11, -1.2 + (2.4 * j) / 11]);
  const rh = BASE.field.halo.diameter / 2 / R_DP;
  const lattice: Array<[number, number]> = [];
  for (const t of tapsOf(kind)) {
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 5; j++) {
        const o: [number, number] = [-rh + (2 * rh * i) / 4, -rh + (2 * rh * j) / 4];
        if (Math.hypot(o[0], o[1]) <= rh + 1e-12) lattice.push([t.x + o[0], t.y + o[1]]);
      }
    }
  }
  return [...grid, ...lattice];
}

/** Abyss's dark rest table before law round 2's item 6: two symmetric lobes (the light face's today). */
export const ABYSS_DARK_REST_BEFORE_ITEM_6: ReadonlyArray<readonly [number, number]> = [[-0.35, -0.3], [0.4, 0.35]];

/** A case's state at a frame time t (ms from the storm's start), the clock running from 7000 ms. */
function stateAt(c: FlashCase, t: number, shown: { placements: Placement[]; restFade: number; restSlots?: number[] }): FieldState {
  const tMs = 7000 + t;
  return {
    direction: c.id, face: c.face, placements: shown.placements, restFade: shown.restFade, restSlots: shown.restSlots,
    stress: 0, confidence: 1, genesis: true, tMs, breathPhase: fixedFieldBreath(c.id, 0, tMs).phase, tier: c.mode === 'reduced' ? 'still' : 'full',
  };
}

/**
 * Resilience B1: the lobe centres at the storm's first frame, as the builder places them (each rest lobe
 * of the deps' face, and each tap's lobe at ordinals 0–2), and a 5×5 lattice at ±0.05 R around each.
 */
export function lobeLattices(c: FlashCase, deps: StormDeps): { centres: Array<[number, number]>; points: Array<[number, number]> } {
  const centres: Array<[number, number]> = [];
  const centreOf = (placements: Placement[], restFade: number, pick: (frame: ReturnType<typeof buildFieldFrame>) => Array<[number, number]>) =>
    pick(buildFieldFrame(stateAt(c, 0, { placements, restFade }), geometry, deps.statics)).forEach((p) => centres.push(p));
  // The rest lobes: nothing placed, so the builder lights them all.
  centreOf([], 1, (f) => f.nodes.filter((n) => n.fade > 0 && n.bead === null).map((n) => [n.centre[0], n.centre[1]]));
  for (const t of tapsOf(c.kind)) {
    for (let ordinal = 0; ordinal < 3; ordinal++) {
      centreOf([{ x: t.x, y: t.y, fade: 1, ordinal }], 0, (f) => f.nodes.filter((n) => n.fade > 0 && n.bead !== null).map((n) => [n.centre[0], n.centre[1]]));
    }
  }
  const points: Array<[number, number]> = [];
  for (const [cx, cy] of centres) {
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) points.push([cx + (-0.05 + (0.1 * i) / 4), cy + (-0.05 + (0.1 * j) / 4)]);
  }
  return { centres, points };
}

/** What the field shows at a frame, from the ledger, or from a naive driver that restarts each fade on every tap. */
type Driver = (t: number, taps: readonly Tap[], seq: number) => { placements: Placement[]; restFade: number; restSlots?: number[] };

function ledgerDriver(deps: StormDeps, mode: Mode): Driver {
  let ledger = emptyLedger(deps.config);
  return (t, taps, seq) => {
    ledger = reconcile(ledger, { seq, taps }, t, mode);
    const f = fades(ledger);
    return {
      placements: f.placements.map((p) => ({ x: p.x, y: p.y, fade: p.fade, ordinal: p.ordinal, slot: p.slot, role: p.role })),
      restFade: f.restFade,
      restSlots: [...f.restSlots],
    };
  };
}

/**
 * The planted naive driver: every tap restarts a fade at once, in from 0 or out from 1, with no
 * serialization and no netting; the rest lobes restart the same way whenever the store empties or fills.
 */
export function naiveDriver(mode: Mode): Driver {
  let shown: Array<{ id: number; x: number; y: number; since: number; dir: 'in' | 'out' }> = [];
  let next = 0;
  let previous: readonly Tap[] = [];
  let rest = { since: -1e9, dir: 'in' as 'in' | 'out' };
  return (t, taps) => {
    if (taps !== previous) {
      const kept = shown.filter((p) => p.dir === 'in' && taps.some((x) => x.x === p.x && x.y === p.y));
      for (const p of shown) if (p.dir === 'in' && !kept.includes(p)) shown.push({ ...p, since: t, dir: 'out' });
      shown = shown.filter((p) => p.dir === 'out' || kept.includes(p));
      for (const tap of taps) if (!kept.some((p) => p.x === tap.x && p.y === tap.y)) shown.push({ id: next++, x: tap.x, y: tap.y, since: t, dir: 'in' });
      if ((taps.length === 0) !== (previous.length === 0)) rest = { since: t, dir: taps.length === 0 ? 'in' : 'out' };
      previous = taps;
    }
    const fadeOf = (since: number, dir: 'in' | 'out') => { const c = crossfade(progress(mode, t - since)); return dir === 'in' ? c.in : c.out; };
    shown = shown.filter((p) => !(p.dir === 'out' && fadeOf(p.since, 'out') === 0));
    const placements = shown.slice(-3).map((p, slot) => ({ x: p.x, y: p.y, fade: fadeOf(p.since, p.dir), ordinal: p.id, slot, role: p.dir === 'out' ? ('leaving' as const) : ('live' as const) }));
    return { placements, restFade: fadeOf(rest.since, rest.dir) };
  };
}

/** One case: the worst flashes per second over every sample point, and where. */
export function flashReport(c: FlashCase, deps: StormDeps, driver: Driver = ledgerDriver(deps, c.mode)): { points: number; worst: number; at: [number, number] } {
  // The ledger counts its deps' face's rest lobes (UI-112): a case on the other face would draw a rest
  // table the ledger never counted.
  if (deps.face !== c.face) throw new Error(`E4: a ${c.face} face case needs deps of that face, got ${deps.face}`);
  const s = store(c.kind === 'neutral3' ? [neutral(1), neutral(2), neutral(3)] : []);
  const actions = schedule(c.kind, c.every, s);
  const times = [...actions.keys()].sort((a, b) => a - b);
  const points = [...samplePoints(c.kind), ...lobeLattices(c, deps).points];
  const traces = points.map(() => [] as number[]);
  let done = 0;
  for (let f = 0; f < FRAMES; f++) {
    const t = f * FRAME_MS;
    while (done < times.length && times[done] <= t) { for (const act of actions.get(times[done])!) act(); done++; }
    const shown = driver(t, s.taps(), s.seq());
    // The clock runs with the frames; at tier still the builder holds the field at field.stillTime.
    const frame = { ...buildFieldFrame(stateAt(c, t, shown), geometry, deps.statics), grain: { inside: 0, ground: 0 }, dither: 0 };
    points.forEach(([qx, qy], i) => traces[i].push(relY(fieldPixel(frame, C_PX + qx * R_DP, C_PX - qy * R_DP))));
  }
  let worst = 0;
  let at: [number, number] = [NaN, NaN];
  traces.forEach((trace, i) => { const w = worstFlashesPerSecond(trace, FRAME_MS); if (w > worst) { worst = w; at = points[i]; } });
  return { points: points.length, worst, at };
}
