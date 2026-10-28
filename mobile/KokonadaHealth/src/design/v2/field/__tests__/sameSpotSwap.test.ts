import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import { BASE, DIRECTIONS, type Face } from '../../tokens/tokens.generated.ts';
import { buildFieldFrame, fixedFieldBreath, type FieldGeometry } from '../fieldFrame.ts';
import { fieldOklab, fieldPixel, type FieldFrame } from '../fieldLaw.ts';
import { FRAME_MS, lobeLattices, relY, samplePoints } from '../flashCount.ts';
import { QUAD, stormDeps, type Mode } from '../ledgerStorms.ts';
import { emptyLedger, fades, reconcile, type LedgerConfig, type Tap } from '../placementLedger.ts';
import { staticsFor } from '../statics.ts';

// Law round 2, item 2b (designer L7; resilience B2): a same-spot swap no longer bumps. Two nodes at one
// spot crossfade linearly (ω = 0), so Σf and Σh are linear in u and every pixel moves one way only.
//
// Resilience B2: "for every direction × face × mode, take two nodes that are identical except for their
// id, with fades (1 − u², u) along the real eased ramp at 60 fps; or the ledger's own add/undo/re-add at
// QUAD[1]. At every sample (the grid, the halo lattice and the lobe-centre lattice): max_u |Y(u) − Y(0)|
// < 0.08 on the rendered 8-bit law pixel. Plant: today's law ... gives ≈ 0.14 and must fail."
//
// Both readings run here, on the ledger's own add / undo / re-add at QUAD[1], at 60 fps, with the clock
// frozen so that only the crossfade moves (the breath and the drift held; tier full under settle, still
// under reduced motion), grain and dither 0:
//   · identical except for their id: the pair drawn with one ordinal (one drift table), so the end
//     frame is the start frame and the bound is B2's own, max_u |Y(u) − Y(0)| < 0.08;
//   · the ledger's own ordinals: the new placement drifts on the next table (critic item 5, a lobe's
//     drift is its ordinal's for its whole life), so the lobe really moves, and Y(1) differs from Y(0)
//     by up to 0.21 under any crossfade, a single one-way change, never a flash. Here the bound is on
//     the excursion beyond the swap's two ends: Y(u) never leaves [min(Y(0), Y(1)), max(Y(0), Y(1))] by
//     0.08 or more.
// The plant is the ledger with ω ≡ 1 (a reach of 0, the designer 2.6 curve), which must break both.

const R_DP = BASE.plate.maxDiameter / 2;
const C_PX = 1.5 * R_DP;
const geometry: FieldGeometry = { centrePx: [C_PX, C_PX], radiusPx: R_DP, pxPerDp: 1, fontScale: 1 };
const statics = staticsFor('abyss', EXTENSIONS as never);
const FACES: Face[] = ['dark', 'light'];
const MODES: Mode[] = ['settle', 'reduced'];
const T_MS = 7000;
const BOUND = 0.08;
const held = (config: LedgerConfig): LedgerConfig => ({ ...config, overlap: { ...config.overlap, reach: 0 } });

/**
 * The swap's frames, from its start (u = 0) to the frame after its end, through the ledger at 60 fps:
 * `first` shown at once, C added on frame 1, undone on frame 9 and re-added on frame 15, so its leave and
 * its re-entry pair at the next start, after the spacing. `oneOrdinal` draws the pair on one drift table.
 */
function swapFrames(face: Face, mode: Mode, config: LedgerConfig, oneOrdinal: boolean, first: Tap[] = []): FieldFrame[] {
  const C = QUAD[1];
  let taps: Tap[] = first;
  let seq = 0;
  let ledger = emptyLedger(config);
  const out: FieldFrame[] = [];
  let swapping = false;
  let pairOrdinal = -1; // the leaving placement's: the pair's one drift table, for the whole swap
  for (let frame = 0; frame < 240; frame++) {
    if (frame === 1) { taps = [...first, C]; seq++; }
    if (frame === 9) { taps = [...first]; seq++; }
    if (frame === 15) { taps = [...first, C]; seq++; }
    ledger = reconcile(ledger, { seq, taps }, frame * FRAME_MS, mode);
    if (ledger.starts === 2) swapping = true;
    if (!swapping) continue;
    const f = fades(ledger);
    const atC = f.placements.filter((p) => p.x === C.x && p.y === C.y);
    if (pairOrdinal < 0) pairOrdinal = Math.min(...atC.map((p) => p.ordinal));
    out.push({
      ...buildFieldFrame(
        {
          direction: 'abyss', face, stress: 0, confidence: 1, genesis: true, tMs: T_MS, breathPhase: fixedFieldBreath('abyss', 0, T_MS).phase, tier: mode === 'reduced' ? 'still' : 'full',
          placements: f.placements.map((p) => ({ x: p.x, y: p.y, fade: p.fade, slot: p.slot, ordinal: oneOrdinal && p.x === C.x && p.y === C.y ? pairOrdinal : p.ordinal })),
          restFade: f.restFades,
          restSlots: f.restSlots,
        },
        geometry,
        statics,
      ),
      grain: { inside: 0, ground: 0 },
      dither: 0,
    });
    if (atC.length === 1 && atC[0].fade === 1) break;
  }
  return out;
}

const points = (face: Face, deps: ReturnType<typeof stormDeps>) => [...samplePoints('toggle'), ...lobeLattices({ id: 'abyss', face, mode: 'settle', kind: 'toggle', every: 50 }, deps).points];
const yAt = (frame: FieldFrame, [qx, qy]: readonly number[]) => relY(fieldPixel(frame, C_PX + qx * R_DP, C_PX - qy * R_DP));

/** The worst |Y(u) − Y(0)| and the worst excursion beyond [min, max] of the two ends, over every sample. */
function measure(frames: FieldFrame[], at: Array<[number, number]>) {
  let fromStart = 0;
  let beyondEnds = 0;
  for (const q of at) {
    const y = frames.map((f) => yAt(f, q));
    const [a, b] = [y[0], y[y.length - 1]];
    for (const v of y) {
      fromStart = Math.max(fromStart, Math.abs(v - a));
      beyondEnds = Math.max(beyondEnds, v - Math.max(a, b), Math.min(a, b) - v);
    }
  }
  return { fromStart, beyondEnds };
}

describe('B2: a same-spot swap changes no pixel by 0.08 Y or more (Abyss, every face and mode)', () => {
  it('the swap is real: a leave and a re-entry of the same tap, paired at one start, over the whole ramp at 60 fps', () => {
    const deps = stormDeps('abyss', statics, 'dark');
    for (const mode of MODES) {
      const frames = swapFrames('dark', mode, deps.config, true);
      const ramp = mode === 'settle' ? BASE.motion.settle.duration : BASE.motion.fadeReduced.duration;
      expect(frames.length).toBeGreaterThanOrEqual(Math.floor(ramp / FRAME_MS));
      const placed = frames[0].nodes.filter((n) => n.bead !== null);
      expect(placed.map((n) => n.fade).sort()).toEqual([0, 1]); // out at 1, in at 0, in their own slots
      expect(placed[0].centre).toEqual(placed[1].centre);
    }
  });

  it.each(FACES.flatMap((face) => MODES.map((mode) => [face, mode] as const)))('%s, %s: identical but for their id, max_u |Y(u) − Y(0)| < 0.08', (face, mode) => {
    const deps = stormDeps('abyss', statics, face);
    const frames = swapFrames(face, mode, deps.config, true);
    const m = measure(frames, points(face, deps));
    expect(m.fromStart).toBeLessThan(BOUND);
  });

  it.each(FACES.flatMap((face) => MODES.map((mode) => [face, mode] as const)))('%s, %s: the ledger’s own ordinals, no pixel goes 0.08 Y beyond the swap’s two ends', (face, mode) => {
    const deps = stormDeps('abyss', statics, face);
    const frames = swapFrames(face, mode, deps.config, false);
    const m = measure(frames, points(face, deps));
    expect(m.beyondEnds).toBeLessThan(BOUND);
  });

  it.each(FACES.flatMap((face) => MODES.map((mode) => [face, mode] as const)))('the plant, %s, %s: ω ≡ 1 (the designer 2.6 curve) breaks both readings', (face, mode) => {
    const deps = stormDeps('abyss', statics, face);
    const at = points(face, deps);
    expect(measure(swapFrames(face, mode, held(deps.config), true), at).fromStart).toBeGreaterThanOrEqual(BOUND);
    expect(measure(swapFrames(face, mode, held(deps.config), false), at).beyondEnds).toBeGreaterThanOrEqual(BOUND);
  });
});

// TASKS UI-122, the designer's interim E4 case: "a same-node swap with a neighbour 0.6 R away, the
// neighbour's ΔE monotone over the swap". Under L4 the selection ranks slots, not nodes, so mid-swap the
// swapped node's out and in slots can take the top two ranks near the neighbour and push it to third:
// a boundary pulse no mood caused. The fix (sum e per node before ranking) waits for the architect's
// SkSL feasibility check, so this case is expected to fail until it lands (UI-122).
// Measured at D5 (float OKLab, the neighbour's 5×5 lattice at ±0.05 R, one drift table for the pair, 60
// fps): the neighbour's ΔE rises and returns to 0, a pulse of 0.0157 (dark, settle), 0.0206 (dark,
// reduced), 0.0048 (light, settle) and 0.0063 (light, reduced).
describe('UI-122 (interim): a same-node swap beside a neighbour 0.6 R away', () => {
  const BEAD = DIRECTIONS.abyss.bead.diameter / 2 / R_DP;
  // Abyss centres a lobe on its bead (centreAlpha 1, centreBeta 0): J's lobe sits 0.6 R above C's.
  const J: Tap = { x: QUAD[1].x, y: QUAD[1].y + 0.6 / (1 - BEAD) };

  it('the neighbour is a different node, 0.6 R from the swapped one, lobe centre to lobe centre', () => {
    expect([DIRECTIONS.abyss.field.lobe.centreAlpha, DIRECTIONS.abyss.field.lobe.centreBeta]).toEqual([1, 0]);
    const frames = swapFrames('dark', 'settle', stormDeps('abyss', statics, 'dark').config, true, [J]);
    const placed = frames[0].nodes.filter((n) => n.bead !== null);
    expect(placed.map((n) => n.id)).toEqual([0, 1, 1]); // J, then C out and C in
    expect(Math.hypot(placed[0].bead![0] - placed[1].bead![0], placed[0].bead![1] - placed[1].bead![1])).toBeCloseTo(0.6, 12);
  });

  it.failing('the neighbour’s ΔE from the swap’s start is monotone over the swap (UI-122: fails under L4 until e is summed per node)', () => {
    const pulses: string[] = [];
    for (const face of FACES) {
      for (const mode of MODES) {
        const frames = swapFrames(face, mode, stormDeps('abyss', statics, face).config, true, [J]);
        const centre = frames[0].nodes.find((n) => n.id === 0 && n.bead !== null)!.centre;
        for (let i = 0; i < 5; i++) {
          for (let j = 0; j < 5; j++) {
            const q = [centre[0] - 0.05 + 0.025 * i, centre[1] - 0.05 + 0.025 * j];
            const lab = frames.map((f) => fieldOklab(f, C_PX + q[0] * R_DP, C_PX - q[1] * R_DP));
            const dE = lab.map((c) => Math.hypot(c.L - lab[0].L, c.a - lab[0].a, c.b - lab[0].b));
            let peak = 0;
            let drop = 0;
            for (const v of dE) { peak = Math.max(peak, v); drop = Math.max(drop, peak - v); }
            if (drop > 1e-9) pulses.push(`${face} ${mode} at (${q[0].toFixed(3)}, ${q[1].toFixed(3)}): ΔE falls ${drop.toFixed(5)} after peaking at ${peak.toFixed(5)}`);
          }
        }
      }
    }
    expect(pulses).toEqual([]);
  });
});
