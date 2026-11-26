// The fieldCost bench's storm (B8-3; the architect's B8 plan: "the storm script is 7 taps/s and deterministic"; resilience
// T5 r1 Q5: "during a 7 taps/s storm, which is the ledger's allocation and GC peak"). The cold lane's taps as a storm drives
// them, as a pure function of the time since the bench's first frame: change k lands at k·1000/7 ms, each one a new tap
// cycling the four quadrant points, the lane keeping its last STORM_KEEP (as the cold lane's store does, ledgerStorms.ts's
// store()), and seq the number of changes so far. At every change one placement enters and, from the fourth, one leaves.
// No randomness and no wall clock: the same frame times give the same inputs on every run. A worklet: the bench calls it on
// the UI thread.

import type { LedgerInput, Tap } from '../../v2/field/placementLedger';

export const STORM_TAPS_PER_SECOND = 7;
/** The cold lane keeps its last three taps. */
export const STORM_KEEP = 3;
/** One point per quadrant, on the unit disc, y up (the storms' cycle4 points). */
export const STORM_POINTS: readonly Tap[] = [
  { x: 0.566, y: 0.566 },
  { x: 0.566, y: -0.566 },
  { x: -0.566, y: -0.566 },
  { x: -0.566, y: 0.566 },
];

/** The ledger's input at `elapsedMs` since the bench's first frame; before it, the first input. */
export function stormInput(elapsedMs: number): LedgerInput {
  'worklet';
  const seq = elapsedMs > 0 ? Math.floor((elapsedMs * STORM_TAPS_PER_SECOND) / 1000) : 0;
  const taps: Tap[] = [];
  // After seq changes the lane has held taps 0..seq; it keeps the last STORM_KEEP, oldest first.
  for (let i = Math.max(0, seq - STORM_KEEP + 1); i <= seq; i++) taps.push(STORM_POINTS[i % STORM_POINTS.length]);
  return { seq, taps };
}
