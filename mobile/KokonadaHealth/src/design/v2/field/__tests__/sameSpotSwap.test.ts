import type { Oklab } from '../../color/oklab.ts';
import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import { BASE, DIRECTIONS, type Face } from '../../tokens/tokens.generated.ts';
import { NODE, encodeSrgb8, fieldOklab, pixelTerms, pooledNodes, rankNodes, slotColours, smoothstep, type FieldFrame } from '../fieldLaw.ts';
import { throughLedger } from '../fieldScenes.ts';
import { FRAME_MS, ledgerDriver, lobeLattices } from '../flashCount.ts';
import { perSlotColours, twinPixel, type Twin } from '../lawTwins.ts';
import { QUAD, frameState, stormDeps, type Mode } from '../ledgerStorms.ts';
import { emptyLedger, fades, reconcile, type LedgerConfig, type Tap } from '../placementLedger.ts';
import { HEAVIEST, LIGHT, R_DP, drawdown, held, measureSwap, rampFrames, reversal, swap, swapFrames, swapPoints, type SwapOptions } from '../sameSpotSwap.ts';
import { staticsFor } from '../statics.ts';

// Law round 2, item 2b (designer L7; resilience B2): a same-spot swap no longer bumps. Two nodes at one
// spot crossfade linearly (ω = 0), so Σf and Σh are linear in u and every pixel moves one way only.
//
// Resilience B2: "for every direction × face × mode, take two nodes that are identical except for their
// id, with fades (1 − u², u) along the real eased ramp at 60 fps; or the ledger's own add/undo/re-add at
// QUAD[1]. At every sample (the grid, the halo lattice and the lobe-centre lattice): max_u |Y(u) − Y(0)|
// < 0.08 on the rendered 8-bit law pixel. Plant: today's law ... gives ≈ 0.14 and must fail."
//
// Both readings run here, on the ledger's own add / undo / re-add at QUAD[1], at 60 fps (sameSpotSwap.ts
// draws the swap, shared with the D5b probes):
//   · identical except for their id: the pair drawn with one ordinal (one drift table), so the end
//     frame is the start frame and the bound is B2's own, max_u |Y(u) − Y(0)| < 0.08;
//   · the ledger's own path: until UI-134 the new placement drifted on the next table (its ordinal's),
//     so the lobe moved and Y(1) differed from Y(0) by up to 0.21. Designer Ruling 3 after UI-125: "do
//     not keep the jump; a re-add inherits the drift key, never the ordinal or the id". The re-add now
//     takes the leaver's drift key, so B2's own bound holds on this path too, with the excursion beyond
//     the two ends and the reversal against the net direction (all < 0.08), and RA-5's tripwire on the
//     jump tightens from 0.25 to 0.08. The planted next-ordinal drift (driftBy 'ordinal') must fail it.
// The plant is the ledger with ω ≡ 1 (a reach of 0, the designer 2.6 curve), which must break both.
// Resilience's ruling at 60cf046 (RA-1 to RA-5) is applied: the lobe lattices are the mode's own (reduced
// draws at tier still), every measured case asserts a real swap, the reversal bound, and the tripwire.

const statics = staticsFor('abyss', EXTENSIONS as never);
const FACES: Face[] = ['dark', 'light'];
const MODES: Mode[] = ['settle', 'reduced'];
const BOUND = 0.08;
const CASES = FACES.flatMap((face) => MODES.map((mode) => [face, mode] as const));
const optionsFor = (face: Face, mode: Mode, oneOrdinal: boolean, extra: Partial<SwapOptions> = {}): SwapOptions => ({ face, mode, config: stormDeps('abyss', statics, face).config, statics, oneOrdinal, ...extra });

/** RA-3: a measured swap is real: its whole ramp at 60 fps, and frame 0 has the pair at fades 0 and 1. */
function realSwap(frames: readonly FieldFrame[], mode: Mode, at: Tap = QUAD[1]) {
  expect(frames.length).toBeGreaterThanOrEqual(rampFrames(mode));
  const bead = DIRECTIONS.abyss.bead.diameter / 2 / R_DP;
  const pair = frames[0].nodes.filter((n) => n.bead !== null && Math.abs(n.bead[0] - at.x * (1 - bead)) < 1e-9 && Math.abs(n.bead[1] - at.y * (1 - bead)) < 1e-9);
  expect(pair.map((n) => n.fade).sort()).toEqual([0, 1]);
}

describe('B2: a same-spot swap changes no pixel by 0.08 Y or more (Abyss, every face and mode)', () => {
  it('the swap is real: a leave and a re-entry of the same tap, paired at one start, over the whole ramp at 60 fps', () => {
    for (const mode of MODES) {
      const frames = swapFrames(optionsFor('dark', mode, true));
      realSwap(frames, mode);
      const placed = frames[0].nodes.filter((n) => n.bead !== null);
      expect(placed.map((n) => n.fade).sort()).toEqual([0, 1]); // out at 1, in at 0, in their own slots
      expect(placed[0].centre).toEqual(placed[1].centre);
      // UI-134: on the ledger's own path too, the re-add's lobe sits on the leaver's (one drift key).
      const own = swapFrames(optionsFor('dark', mode, false))[0].nodes.filter((n) => n.bead !== null);
      expect(own[0].centre).toEqual(own[1].centre);
    }
  });

  // UI-134: the four ledger adapters (fieldScenes, flashCount, ledgerStorms, sameSpotSwap) hand the
  // builder the ledger's drift key, so each draws a same-spot re-add on its leaver's drift table.
  it('every ledger adapter passes the drift key through: a same-node replace draws the re-add on the leaver’s key', () => {
    const deps = stormDeps('abyss', statics, 'dark');
    const C = QUAD[1];
    const near: Tap = { x: C.x - 0.05, y: C.y }; // the same node, its lobe 0.05·(1 − bead) R from C's
    const keysOf = (placements: ReadonlyArray<{ driftKey?: number; ordinal?: number }>) => placements.map((p) => [p.ordinal, p.driftKey]);
    // fieldScenes: one store change, C to the near tap, through the ledger.
    const scene = throughLedger(deps, [C], [near]);
    expect(keysOf(scene[1].shown.placements)).toEqual([[0, 0], [1, 0]]);
    // flashCount's and ledgerStorms' drivers, and sameSpotSwap's frames, on the same replace.
    const drive = ledgerDriver(deps, 'settle');
    drive(0, [C], 1);
    expect(keysOf(drive(1, [near], 2).placements)).toEqual([[0, 0], [1, 0]]);
    let l = reconcile(emptyLedger(deps.config), { seq: 1, taps: [C] }, 0, 'settle');
    l = reconcile(l, { seq: 2, taps: [near] }, 1, 'settle');
    expect(keysOf(frameState('abyss', 'dark', fades(l)).placements)).toEqual([[0, 0], [1, 0]]);
  });

  it.each(CASES)('RA-1, %s, %s: every lobe centre drawn in the swap is a lobe-lattice centre of the mode it is drawn in (a settle lattice misses reduced’s)', (face, mode) => {
    const deps = stormDeps('abyss', statics, face);
    const centresOf = (m: Mode) => lobeLattices({ id: 'abyss', face, mode: m, kind: 'toggle', every: 50 }, deps).centres;
    const missing = (centres: Array<[number, number]>, frames: readonly FieldFrame[]) =>
      frames.flatMap((f) => f.nodes.filter((n) => n.fade > 0 && n.radius > 0)).filter((n) => !centres.some((c) => Math.hypot(c[0] - n.centre[0], c[1] - n.centre[1]) < 1e-12)).length;
    for (const oneOrdinal of [true, false]) {
      const frames = swapFrames(optionsFor(face, mode, oneOrdinal));
      expect(missing(centresOf(mode), frames)).toBe(0);
      // The planted control: the settle lattice under reduced motion misses the still tier's centres.
      if (mode === 'reduced') expect(missing(centresOf('settle'), frames)).toBeGreaterThan(0);
    }
  });

  it('RA-2’s controls: the reversal of 0.06 → 0.2 → 0.07 → 0.2 is at least 0.1; of a monotone rise, 0', () => {
    expect(reversal([0.06, 0.2, 0.07, 0.2])).toBeGreaterThanOrEqual(0.1);
    expect(reversal([0.06, 0.1, 0.15, 0.2])).toBe(0);
    expect(reversal([0.2, 0.15, 0.1, 0.06])).toBe(0);
    expect(reversal([0.2, 0.06, 0.19, 0.07])).toBeCloseTo(0.13, 12);
  });

  it.each(CASES)('%s, %s: identical but for their id, max_u |Y(u) − Y(0)| < 0.08', (face, mode) => {
    const frames = swapFrames(optionsFor(face, mode, true));
    realSwap(frames, mode);
    expect(measureSwap(frames, swapPoints(face, mode, stormDeps('abyss', statics, face))).fromStart).toBeLessThan(BOUND);
  });

  // UI-134 (designer Ruling 3 after UI-125): "do not keep the jump; a re-add inherits the drift key, never
  // the ordinal or the id". On the ledger's own path the re-added placement takes the leaver's drift key,
  // so B2's own form holds there too, and RA-5's tripwire tightens from 0.25 to 0.08.
  it.each(CASES)('%s, %s: the ledger’s own path (add, undo, re-add): max_u |Y(u) − Y(0)| < 0.08, nothing 0.08 Y beyond the ends or against the net change, and the re-add jump ≤ 0.08 Y (RA-5, tightened by UI-134)', (face, mode) => {
    const { frames, ledgers } = swap(optionsFor(face, mode, false));
    realSwap(frames, mode);
    // The pair: distinct ids and ordinals, one drift key, the leaver's.
    const pair = fades(ledgers[0]).placements.filter((p) => p.x === QUAD[1].x && p.y === QUAD[1].y);
    expect(pair.map((p) => [p.id, p.ordinal, p.driftKey, p.role])).toEqual([[0, 0, 0, 'leaving'], [1, 1, 0, 'live']]);
    const m = measureSwap(frames, swapPoints(face, mode, stormDeps('abyss', statics, face)));
    expect(m.fromStart).toBeLessThan(BOUND);
    expect(m.beyondEnds).toBeLessThan(BOUND);
    expect(m.reversal).toBeLessThan(BOUND);
    expect(m.jump).toBeLessThanOrEqual(BOUND);
  });

  it.each(CASES)('the plant, %s, %s: the re-add drifting on its next ordinal (the jump UI-134 removed) fails the tightened tripwire and B2’s own form', (face, mode) => {
    const frames = swapFrames(optionsFor(face, mode, false, { driftBy: 'ordinal' }));
    realSwap(frames, mode);
    const m = measureSwap(frames, swapPoints(face, mode, stormDeps('abyss', statics, face)));
    expect(m.jump).toBeGreaterThan(BOUND);
    expect(m.fromStart).toBeGreaterThanOrEqual(BOUND);
  });

  it.each(CASES)('the plant, %s, %s: ω ≡ 1 (the designer 2.6 curve) breaks both readings', (face, mode) => {
    const at = swapPoints(face, mode, stormDeps('abyss', statics, face));
    const one = swapFrames({ ...optionsFor(face, mode, true), config: held(stormDeps('abyss', statics, face).config) });
    const own = swapFrames({ ...optionsFor(face, mode, false), config: held(stormDeps('abyss', statics, face).config) });
    realSwap(one, mode);
    realSwap(own, mode);
    expect(measureSwap(one, at).fromStart).toBeGreaterThanOrEqual(BOUND);
    const m = measureSwap(own, at);
    expect(Math.max(m.beyondEnds, m.reversal)).toBeGreaterThanOrEqual(BOUND);
  });
});

// UI-131 (iii), as the designer amended it at D5b: "a planted ω ≡ 1 must fail B2 (first form), criterion
// A below and the ledger's ω pin". The pin: "ω = 0 exactly at δ = 0, ω = 1 exactly at δ ≥ ν·r_L, ω = 1
// with no incoming lobe", read from the ledger's own leaving placement at the swap's start.
describe('the ledger’s ω pin (L7), and the hold failing it', () => {
  const config = stormDeps('abyss', statics, 'dark').config;
  const reach = config.overlap.reach;
  /** The ω of the first leaving placement, the store's taps set at each step's time (ms), at 60 fps. */
  const firstOmega = (c: LedgerConfig, steps: ReadonlyArray<readonly [number, readonly Tap[]]>) => {
    let l = emptyLedger(c);
    for (let f = 0; f < 240; f++) {
      const t = f * FRAME_MS;
      const k = steps.filter(([at]) => at <= t).length;
      l = reconcile(l, { seq: k, taps: k === 0 ? [] : steps[k - 1][1] }, t, 'settle');
      const out = l.shown.find((x) => x.phase === 'out');
      if (out) return out.omega;
    }
    return undefined;
  };
  const [J, C, I] = [QUAD[0], QUAD[1], QUAD[3]];

  it('ω = 0 exactly at δ = 0 (a same-spot swap, as the swap draws it); the hold gives 1', () => {
    expect(reach).toBeCloseTo(BASE.field.crossfade.overlapFar * DIRECTIONS.abyss.field.lobe.radius, 12);
    const leaving = (cfg: LedgerConfig) => swap({ ...optionsFor('dark', 'settle', false), config: cfg }).ledgers[0].shown.find((x) => x.phase === 'out')!.omega;
    expect(leaving(config)).toBe(0);
    expect(leaving(held(config))).toBe(1);
  });

  it('ω = 1 exactly at δ ≥ ν·r_L, and with no lobe coming in', () => {
    // C leaves as I comes in, a quadrant and more apart.
    expect(Math.hypot(C.x - I.x, C.y - I.y) * (1 - DIRECTIONS.abyss.bead.diameter / 2 / R_DP)).toBeGreaterThan(reach);
    expect(firstOmega(config, [[0, [J, C]], [1000, [J, I]]])).toBe(1);
    // A leave with J still live and nothing coming in: the hold.
    expect(firstOmega(config, [[0, [J, C]], [1000, [J]]])).toBe(1);
    // Not vacuous: C added (the first frame's taps show at once, so on a later frame), then undone and
    // re-added inside the spacing: the leave and the re-entry pair at the next start, at one spot, ω = 0.
    expect(firstOmega(config, [[0, [J]], [16, [J, C]], [150, [J]], [250, [J, C]]])).toBe(0);
  });
});

// TASKS UI-122 and UI-129 (law round 2, D5b): the designer's acceptance criteria for the same-node swap
// beside a neighbour, under the amended L4 (rank nodes, not slots; w from the node's pooled halo H_n).
// "Setup: Abyss dark and light, settle and reduced, 60 fps, the real ledger. Node n (a bead node with a
// halo) swapped in place (δ = 0); neighbour m 0.6 R away, run on a straight edge and on a waypoint pair
// (J–I). F1: identical but for the id. F2: the ledger's own undo and re-add."
//   A (F1): every frame 8-bit equal to frame 0; float OKLab ΔE ≤ 1e-5.
//   B (F2): on pixels where m is C1 or C2 and |q − bead_n| ≥ 0.3 R, the reversal R = max over u1 < u2 of
//     [ΔE(X(u1), X(0)) − ΔE(X(u2), X(0))] ≤ 0.002 OKLab; the D5 pulses must each fall to ≤ 0.002; the
//     ledger-path excursion beyond the swap's ends stays < 0.08 Y.
//   C (UI-129): where w_n = 1 at both ends, n's colour is halo_n bit for bit at every frame, both forms.
//   E: the old slot ranking fails A and B; per-slot w from h_i fails C; ω ≡ 1 fails A.
// Here the samples are the 12×12 grid over ±1.2 R, 5×5 lattices around both beads' halos and both lobe
// centres, and a 9×9 patch over ±0.15 R around the neighbour's bead, on the rendered law pixel; the D5b
// probe runs A and B over every pixel of the canvas in plain node.
const BEAD = DIRECTIONS.abyss.bead.diameter / 2 / R_DP;
const EDGES = {
  // Abyss centres a lobe on its bead (centreAlpha 1, centreBeta 0): J's lobe sits 0.6 R above C's.
  straight: { n: NODE.C, at: QUAD[1], neighbour: { x: QUAD[1].x, y: QUAD[1].y + 0.6 / (1 - BEAD) } as Tap },
  // J–I meets through the neutral: I swapped, J 0.6 R to its right.
  waypoint: { n: NODE.I, at: QUAD[3], neighbour: { x: QUAD[3].x + 0.6 / (1 - BEAD), y: QUAD[3].y } as Tap },
} as const;
type Edge = keyof typeof EDGES;
const EDGE_CASES = (Object.keys(EDGES) as Edge[]).flatMap((edge) => CASES.map(([face, mode]) => [edge, face, mode] as const));

const neighbourSwap = (edge: Edge, face: Face, mode: Mode, oneOrdinal: boolean, extra: Partial<SwapOptions> = {}) =>
  swapFrames(optionsFor(face, mode, oneOrdinal, { at: EDGES[edge].at, first: [EDGES[edge].neighbour], ...extra }));

function samplesOf(frame: FieldFrame): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) out.push([-1.2 + (2.4 * i) / 11, -1.2 + (2.4 * j) / 11]);
  const lit = frame.nodes.filter((n) => n.bead !== null);
  for (const node of lit) {
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 5; j++) {
        out.push([node.bead![0] - frame.haloRadius + (2 * frame.haloRadius * i) / 4, node.bead![1] - frame.haloRadius + (2 * frame.haloRadius * j) / 4]);
        out.push([node.centre[0] - 0.05 + 0.025 * i, node.centre[1] - 0.05 + 0.025 * j]);
      }
    }
  }
  const m = lit.find((n) => n.id === NODE.J)!;
  for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) out.push([m.bead![0] - 0.15 + (0.3 * i) / 8, m.bead![1] - 0.15 + (0.3 * j) / 8]);
  return out;
}
const pixelOf = (frame: FieldFrame, [qx, qy]: readonly number[]): [number, number] => [frame.centrePx[0] + qx * frame.radiusPx, frame.centrePx[1] - qy * frame.radiusPx];
const deltaE = (p: Oklab, q: Oklab) => Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b);
type Pixel = (frame: FieldFrame, x: number, y: number) => Oklab;
const LAW: Pixel = fieldOklab;
const twin = (t: Twin): Pixel => (frame, x, y) => twinPixel(frame, x, y, t);

/** Criterion A over the samples: the 8-bit pixels that differ from frame 0, and the worst float ΔE. */
function criterionA(frames: readonly FieldFrame[], pixel: Pixel) {
  let off = 0;
  let worst = 0;
  for (const q of samplesOf(frames[0])) {
    const [x, y] = pixelOf(frames[0], q);
    const first = pixel(frames[0], x, y);
    const bytes = encodeSrgb8(first).join();
    for (const f of frames.slice(1)) {
      const c = pixel(f, x, y);
      worst = Math.max(worst, deltaE(c, first));
      if (encodeSrgb8(c).join() !== bytes) off++;
    }
  }
  return { off, worst };
}

/** Is the neighbour (J) C1 or C2 at this pixel, under the law's ranking? */
const neighbourRanks = (frame: FieldFrame, x: number, y: number) => {
  const terms = pixelTerms(frame, x, y);
  const { E } = pooledNodes(terms.e, slotColours(frame, terms), frame.nodes.map((n) => n.id));
  const [i1, i2] = rankNodes(E);
  return E[NODE.J] > 0 && (i1 === NODE.J || i2 === NODE.J);
};

/** Criterion B over the samples where J is C1 or C2 at every frame and the sample is ≥ 0.3 R from bead_n. */
function criterionB(frames: readonly FieldFrame[], n: number, pixel: Pixel) {
  const bead = frames[0].nodes.find((x) => x.id === n && x.bead !== null)!.bead!;
  let worst = 0;
  let pixels = 0;
  for (const q of samplesOf(frames[0])) {
    if (Math.hypot(q[0] - bead[0], q[1] - bead[1]) < 0.3) continue;
    const [x, y] = pixelOf(frames[0], q);
    if (!frames.every((f) => neighbourRanks(f, x, y))) continue;
    pixels++;
    const lab = frames.map((f) => pixel(f, x, y));
    worst = Math.max(worst, drawdown(lab.map((c) => deltaE(c, lab[0]))));
  }
  return { worst, pixels };
}

describe('D5b: a same-node swap beside a neighbour 0.6 R away (UI-122, UI-129)', () => {
  it.each(Object.keys(EDGES) as Edge[])('%s: the neighbour J is another node 0.6 R from the swapped one, lobe centre to lobe centre, on the edge it names', (edge) => {
    const frames = neighbourSwap(edge, 'dark', 'settle', true);
    realSwap(frames, 'settle', EDGES[edge].at);
    const placed = frames[0].nodes.filter((n) => n.bead !== null);
    expect(placed.map((n) => n.id).sort()).toEqual([NODE.J, EDGES[edge].n, EDGES[edge].n].sort());
    const j = placed.find((n) => n.id === NODE.J)!;
    const k = placed.find((n) => n.id === EDGES[edge].n)!;
    // Abyss centres a lobe on its bead, so the undrifted lobe centres are 0.6 R apart too.
    expect([DIRECTIONS.abyss.field.lobe.centreAlpha, DIRECTIONS.abyss.field.lobe.centreBeta]).toEqual([1, 0]);
    expect(Math.hypot(j.bead![0] - k.bead![0], j.bead![1] - k.bead![1])).toBeCloseTo(0.6, 12);
  });

  it.each(EDGE_CASES)('criterion A, %s edge, %s, %s: identical but for the id, every frame 8-bit equal to frame 0, float ΔE ≤ 1e-5', (edge, face, mode) => {
    const frames = neighbourSwap(edge, face, mode, true);
    realSwap(frames, mode, EDGES[edge].at);
    expect(criterionA(frames, LAW)).toEqual({ off: 0, worst: expect.any(Number) });
    expect(criterionA(frames, LAW).worst).toBeLessThanOrEqual(1e-5);
  });

  it.each(EDGE_CASES)('criterion A’s plants, %s edge, %s, %s: the slot ranking and ω ≡ 1 each fail it', (edge, face, mode) => {
    const frames = neighbourSwap(edge, face, mode, true);
    expect(criterionA(frames, twin({ rank: 'slots', w: 'node' })).off).toBeGreaterThan(0);
    const hold = neighbourSwap(edge, face, mode, true, { config: held(stormDeps('abyss', statics, face).config) });
    realSwap(hold, mode, EDGES[edge].at);
    expect(criterionA(hold, LAW).off).toBeGreaterThan(0);
  });

  it.each(EDGE_CASES)('criterion B, %s edge, %s, %s: on the ledger’s own path the neighbour’s ΔE from the start never reverses by more than 0.002, and no pixel goes 0.08 Y beyond the ends', (edge, face, mode) => {
    const frames = neighbourSwap(edge, face, mode, false);
    realSwap(frames, mode, EDGES[edge].at);
    const b = criterionB(frames, EDGES[edge].n, LAW);
    expect(b.pixels).toBeGreaterThan(40);
    expect(b.worst).toBeLessThanOrEqual(0.002);
    expect(measureSwap(frames, samplesOf(frames[0])).beyondEnds).toBeLessThan(BOUND);
  });

  it.each(EDGE_CASES)('criterion B’s plant, %s edge, %s, %s: the slot ranking reverses by more than 0.002', (edge, face, mode) => {
    const frames = neighbourSwap(edge, face, mode, false);
    expect(criterionB(frames, EDGES[edge].n, twin({ rank: 'slots', w: 'node' })).worst).toBeGreaterThan(0.002);
  });

  // RA-4 and criterion B's line "the D5 pulses must each fall to ≤ 0.002": the interim case as D5 measured
  // it (F1, the neighbour's 5×5 lattice at ±0.05 R around its lobe centre, the straight edge), now a
  // plain bounded case. At D5 (slot ranking) the pulses were 0.0157 (dark, settle), 0.0206 (dark,
  // reduced), 0.0048 (light, settle) and 0.0063 (light, reduced).
  it.each(CASES)('the D5 interim case, %s, %s: the neighbour’s ΔE from the swap’s start falls by at most 0.002 after any peak', (face, mode) => {
    const frames = neighbourSwap('straight', face, mode, true);
    realSwap(frames, mode);
    const centre = frames[0].nodes.find((n) => n.id === NODE.J && n.bead !== null)!.centre;
    let pulse = 0;
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 5; j++) {
        const [x, y] = pixelOf(frames[0], [centre[0] - 0.05 + 0.025 * i, centre[1] - 0.05 + 0.025 * j]);
        const lab = frames.map((f) => fieldOklab(f, x, y));
        pulse = Math.max(pulse, drawdown(lab.map((c) => deltaE(c, lab[0]))));
      }
    }
    expect(pulse).toBeLessThanOrEqual(0.002);
  });

  /**
   * Criterion C: on an 11×11 lattice over bead_n's halo, where n carries weight and w_n = 1 at both ends,
   * C_n against halo_n at every frame. `onFace` counts the held samples where the field is present
   * (k_field > 0), the only place a per-slot w can differ from the node's.
   */
  function criterionC(frames: readonly FieldFrame[], n: number, colours: (frame: FieldFrame, terms: ReturnType<typeof pixelTerms>) => Oklab[]) {
    const node = frames[0].nodes.find((x) => x.id === n && x.bead !== null)!;
    const halo = node.halo;
    let steady = 0;
    let onFace = 0;
    let off = 0;
    const r = frames[0].haloRadius;
    const ids = frames[0].nodes.map((s) => s.id);
    for (let i = 0; i < 11; i++) {
      for (let j = 0; j < 11; j++) {
        const q: [number, number] = [node.bead![0] - r + (2 * r * i) / 10, node.bead![1] - r + (2 * r * j) / 10];
        const [x, y] = pixelOf(frames[0], q);
        const ends = [frames[0], frames[frames.length - 1]].map((f) => {
          const t = pixelTerms(f, x, y);
          return { w: smoothstep(-0.05, 0, t.halos[n] - t.kField), weight: pooledNodes(t.e, slotColours(f, t), ids).E[n], kField: t.kField };
        });
        if (!ends.every((end) => end.w === 1 && end.weight > 0)) continue;
        steady++;
        if (ends[0].kField > 0) onFace++;
        for (const f of frames) {
          const terms = pixelTerms(f, x, y);
          const mine = f.nodes.filter((s) => s.id === n && s.fade > 0);
          expect(mine.every((s) => JSON.stringify(s.halo) === JSON.stringify(halo))).toBe(true);
          const c = pooledNodes(terms.e, colours(f, terms), f.nodes.map((s) => s.id)).C[n];
          if (JSON.stringify(c) !== JSON.stringify(halo)) off++;
        }
      }
    }
    return { steady, onFace, off };
  }

  // Under the heaviest presence the face's k_field (0.85 dark, 0.26 light) is above the halo peak (0.45,
  // 0.25), so w_n = 1 only where the field is absent (the ring, k_field 0), and there a per-slot w is 1 as
  // well; under a light presence (confidence 0, genesis off: k_field 0.39 dark, 0.12 light) w_n = 1 on the
  // face too, and mid-swap each slot's own h_i is half of H_n: UI-129, measured.
  const C_CASES = EDGE_CASES.flatMap(([edge, face, mode]) => (['F1', 'F2'] as const).flatMap((form) => (['heaviest', 'light'] as const).map((presence) => [edge, face, mode, form, presence] as const)));
  it.each(C_CASES)('criterion C, %s edge, %s, %s, %s, %s presence: where w_n = 1 at both ends, n’s colour is its halo bit for bit at every frame', (edge, face, mode, form, presence) => {
    const frames = neighbourSwap(edge, face, mode, form === 'F1', { state: presence === 'light' ? LIGHT : HEAVIEST });
    realSwap(frames, mode, EDGES[edge].at);
    const law = criterionC(frames, EDGES[edge].n, slotColours);
    expect(law.steady).toBeGreaterThan(10);
    expect(law.off).toBe(0);
    if (presence === 'light') {
      // Not vacuous: w_n = 1 on the face, and the plant (w from each slot's own h_i) shows the turned field there.
      expect(law.onFace).toBeGreaterThan(10);
      expect(criterionC(frames, EDGES[edge].n, perSlotColours).off).toBeGreaterThan(0);
    }
  });
});
