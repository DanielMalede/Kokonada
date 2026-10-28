// The same-spot swap through the ledger (law round 2, item 2b, designer L7; resilience B2; TASKS UI-122,
// UI-129): the frames and the measures that sameSpotSwap.test.ts and the D5b probes share, so the shadow
// guard and the test draw the same swap. Test-only, like ledgerStorms.ts and flashCount.ts: never
// imported by app code, not a worklet module, and the caller passes the statics and the ledger config in.
//
// A swap: `first` shown at once, the tap `at` added on frame 1, undone on frame 9 and re-added on frame
// 15, so its leave and its re-entry pair at the next start, after the spacing, at 60 fps. The clock is
// frozen so that only the crossfade moves (the breath and the drift held; tier full under settle, still
// under reduced motion), grain and dither 0. `oneOrdinal` draws the pair on one ordinal and drift table
// (the leaving placement's): the two slots are identical but for the tap's identity (B2's first form,
// criterion A's F1); otherwise each placement keeps the ledger's ordinal and drift key (the ledger's own
// path, F2), where the re-add takes the leaver's drift key (UI-134), so F2 draws the same lobes as F1.
// `driftBy: 'ordinal'` is the planted control: every placement drifts on its ordinal, so the re-add
// jumps to the next drift table, as it did before UI-134.

import { BASE } from '../tokens/tokens.generated.ts';
import { buildFieldFrame, fixedFieldBreath, type FieldGeometry, type FieldStatics } from './fieldFrame.ts';
import { fieldPixel, type FieldFrame } from './fieldLaw.ts';
import { FRAME_MS, lobeLattices, relY, samplePoints } from './flashCount.ts';
import { QUAD, type Mode, type StormDeps } from './ledgerStorms.ts';
import { emptyLedger, fades, reconcile, type Ledger, type LedgerConfig, type Tap } from './placementLedger.ts';

export const R_DP = BASE.plate.maxDiameter / 2;
export const C_PX = 1.5 * R_DP;
/** The plate at 1 px per dp, its centre far enough in that every sample sits at positive pixels. */
export const SWAP_GEOMETRY: FieldGeometry = { centrePx: [C_PX, C_PX], radiusPx: R_DP, pxPerDp: 1, fontScale: 1 };
export const SWAP_T_MS = 7000;

/** The ledger with ω ≡ 1 (a reach of 0, the designer 2.6 curve): the planted hold. */
export const held = (config: LedgerConfig): LedgerConfig => ({ ...config, overlap: { ...config.overlap, reach: 0 } });

export interface SwapOptions {
  readonly face: 'dark' | 'light';
  readonly mode: Mode;
  readonly config: LedgerConfig;
  readonly statics: FieldStatics;
  readonly oneOrdinal: boolean;
  /**
   * What each placement drifts on: the ledger's drift key (the default; UI-134), or its ordinal, the
   * planted control that brings back the re-add's jump to the next drift table.
   */
  readonly driftBy?: 'key' | 'ordinal';
  /** Shown at once, before the swap: the neighbour. */
  readonly first?: readonly Tap[];
  /** The swapped tap; QUAD[1] (calm) by default. */
  readonly at?: Tap;
  readonly geometry?: FieldGeometry;
  /** Tension, confidence and genesis; the heaviest presence (0, 1, on) by default. */
  readonly state?: SwapState;
}

export interface SwapState {
  readonly stress: number;
  readonly confidence: number | null;
  readonly genesis: boolean;
}
/** The heaviest presence: the face's k_field above the halo peak, so a mark's w is 1 only where the field is absent. */
export const HEAVIEST: SwapState = { stress: 0, confidence: 1, genesis: true };
/** A light presence (no confidence yet, genesis off): k_field below the halo peak on the face, so w reaches 1 there too. */
export const LIGHT: SwapState = { stress: 0, confidence: 0, genesis: false };

export interface Swap {
  readonly frames: FieldFrame[];
  /** The ledger at each drawn frame (frame 0 is the swap's start). */
  readonly ledgers: Ledger[];
}

/** The swap's frames, from its start (u = 0) to the frame its incoming placement reaches fade 1. */
export function swap(o: SwapOptions): Swap {
  const at = o.at ?? QUAD[1];
  const first = o.first ?? [];
  const geometry = o.geometry ?? SWAP_GEOMETRY;
  const state = o.state ?? HEAVIEST;
  let taps: readonly Tap[] = first;
  let seq = 0;
  let ledger = emptyLedger(o.config);
  const frames: FieldFrame[] = [];
  const ledgers: Ledger[] = [];
  let swapping = false;
  let pairOrdinal = -1; // the leaving placement's ordinal and drift key: the pair's one drift table, for the whole swap
  let pairKey = -1;
  for (let frame = 0; frame < 240; frame++) {
    if (frame === 1) { taps = [...first, at]; seq++; }
    if (frame === 9) { taps = [...first]; seq++; }
    if (frame === 15) { taps = [...first, at]; seq++; }
    ledger = reconcile(ledger, { seq, taps }, frame * FRAME_MS, o.mode);
    if (ledger.starts === 2) swapping = true;
    if (!swapping) continue;
    const f = fades(ledger);
    const atTap = f.placements.filter((p) => p.x === at.x && p.y === at.y);
    if (pairOrdinal < 0) {
      pairOrdinal = Math.min(...atTap.map((p) => p.ordinal));
      pairKey = atTap.find((p) => p.ordinal === pairOrdinal)!.driftKey;
    }
    const pairOf = (p: { x: number; y: number }) => o.oneOrdinal && p.x === at.x && p.y === at.y;
    frames.push({
      ...buildFieldFrame(
        {
          direction: 'abyss', face: o.face, stress: state.stress, confidence: state.confidence, genesis: state.genesis, tMs: SWAP_T_MS, breathPhase: fixedFieldBreath('abyss', state.stress, SWAP_T_MS).phase, tier: o.mode === 'reduced' ? 'still' : 'full',
          placements: f.placements.map((p) => {
            const ordinal = pairOf(p) ? pairOrdinal : p.ordinal;
            return { x: p.x, y: p.y, fade: p.fade, slot: p.slot, ordinal, driftKey: o.driftBy === 'ordinal' ? ordinal : pairOf(p) ? pairKey : p.driftKey };
          }),
          restFade: f.restFades,
          restSlots: f.restSlots,
        },
        geometry,
        o.statics,
      ),
      grain: { inside: 0, ground: 0 },
      dither: 0,
    });
    ledgers.push(ledger);
    if (atTap.length === 1 && atTap[0].fade === 1) break;
  }
  return { frames, ledgers };
}

/** The swap's frames alone. */
export const swapFrames = (o: SwapOptions): FieldFrame[] => swap(o).frames;

/** The fewest frames a real swap draws: its whole ramp at 60 fps. */
export const rampFrames = (mode: Mode) => Math.floor((mode === 'settle' ? BASE.motion.settle.duration : BASE.motion.fadeReduced.duration) / FRAME_MS);

/**
 * B2's samples: the toggle's 12×12 grid and halo lattice, and the lobe-centre lattices of the mode the
 * swap is drawn in (resilience RA-1: reduced draws at tier still, the field's still time). `latticeMode`
 * is the planted control's override.
 */
export function swapPoints(face: 'dark' | 'light', mode: Mode, deps: StormDeps, latticeMode: Mode = mode): Array<[number, number]> {
  return [...samplePoints('toggle'), ...lobeLattices({ id: 'abyss', face, mode: latticeMode, kind: 'toggle', every: 50 }, deps).points];
}

/** The rendered 8-bit pixel's relative luminance at q (plate units) on the swap geometry. */
export const yAt = (frame: FieldFrame, [qx, qy]: readonly number[]) =>
  relY(fieldPixel(frame, frame.centrePx[0] + qx * frame.radiusPx, frame.centrePx[1] - qy * frame.radiusPx));

/** The largest fall after a peak: max over i < j of trace[i] − trace[j] (0 for a trace that never falls). */
export function drawdown(trace: readonly number[]): number {
  let peak = -Infinity;
  let worst = 0;
  for (const v of trace) {
    peak = Math.max(peak, v);
    worst = Math.max(worst, peak - v);
  }
  return worst;
}

/**
 * Resilience RA-2: the largest move against the trace's net direction (its largest drawdown where the net
 * change is up or nil, its largest draw-up where it is down).
 */
export const reversal = (trace: readonly number[]): number =>
  trace[trace.length - 1] - trace[0] >= 0 ? drawdown(trace) : drawdown(trace.map((v) => -v));

export interface SwapMeasure {
  /** B2's first form: max_u |Y(u) − Y(0)|. */
  readonly fromStart: number;
  /** The excursion beyond [min, max] of the swap's two ends. */
  readonly beyondEnds: number;
  /** RA-2: the largest move against the net direction. */
  readonly reversal: number;
  /** RA-5: the largest |Y(1) − Y(0)|. */
  readonly jump: number;
}

/** The worst of each measure over every sample, on the rendered 8-bit Y. */
export function measureSwap(frames: readonly FieldFrame[], at: ReadonlyArray<readonly [number, number]>): SwapMeasure {
  let fromStart = 0;
  let beyondEnds = 0;
  let back = 0;
  let jump = 0;
  for (const q of at) {
    const y = frames.map((f) => yAt(f, q));
    const [a, b] = [y[0], y[y.length - 1]];
    for (const v of y) {
      fromStart = Math.max(fromStart, Math.abs(v - a));
      beyondEnds = Math.max(beyondEnds, v - Math.max(a, b), Math.min(a, b) - v);
    }
    back = Math.max(back, reversal(y));
    jump = Math.max(jump, Math.abs(b - a));
  }
  return { fromStart, beyondEnds, reversal: back, jump };
}
