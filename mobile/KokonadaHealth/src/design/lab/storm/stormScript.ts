// The storm scenes' tap script (B8-7; the architect's B8 plan at 199b138; resilience QA-068's S7 and TASKS UI-190).
//
// A case is a cycle of cold-lane inputs at fixed times from the scene's start (its taps on the unit disc, y up), repeated
// for as long as the scene runs: the harness starts screenrecord some unknown time after READY, so a recording as long as
// a cycle plus the case's own span holds one whole case wherever it starts. Everything is a pure function of the elapsed
// time: no randomness and no wall clock here (the scene's JS timer only says when to look again).
//
//   · first: rest for IDLE_MS, then the first tap, rest → one.calm (S7 (i), in normal and in reduced motion), held 4 s,
//     then undone back to rest; a 10 s cycle, so every first tap follows 6 s at rest.
//   · toggle: rest for IDLE_MS, then a toggle storm on the one.calm spot, add and undo alternating every STORM_PERIOD_MS
//     (7 a second) for STORM_SPAN_MS: 21 changes, the last an add (S7 (ii)); then one undo back to rest at 9 s, long
//     after the storm has settled; a 12 s cycle.
//   · idle: one change every IDLE_MS, add one.calm then undo, so every change follows exactly IDLE_MS of quiet: at the
//     still tier the field's frames have stopped by then (needsFrames), so the change shows L19's wake (UI-190).
//
// The one.calm spot is the hero scene's placement, given by the caller (stormScenes.ts reads it from the extensions):
// nothing here, and nothing on a lab line, names a tap coordinate.

import type { Tap } from '../../v2/field/placementLedger';

/** The storm's period, ms: 7 taps a second. */
export const STORM_PERIOD_MS = 143;
/** The storm lasts 3 s. */
export const STORM_SPAN_MS = 3000;
/** The quiet before a measured change, ms. */
export const IDLE_MS = 2000;

export const STORM_CASES = ['first', 'toggle', 'idle'] as const;
export type StormCase = (typeof STORM_CASES)[number];

export interface StormChange {
  /** ms from the cycle's start, in (0, cycleMs]. */
  readonly atMs: number;
  readonly taps: readonly Tap[];
}

export interface StormScript {
  readonly case: StormCase;
  readonly cycleMs: number;
  /** The input at the start of every cycle: rest. */
  readonly initial: readonly Tap[];
  /** In time order; the last one restores `initial`, so the cycle repeats. */
  readonly changes: readonly StormChange[];
}

const REST: readonly Tap[] = Object.freeze([]);
// Each change carries its own array: FieldView bumps its seq on a new taps reference, and the ledger decides by value.
const rest = (): readonly Tap[] => Object.freeze([]);
const one = (t: Tap): readonly Tap[] => Object.freeze([{ x: t.x, y: t.y }]);

/** A case's script, with the one.calm spot. */
export function stormScript(c: StormCase, calm: Tap): StormScript {
  if (c === 'first') {
    return { case: c, cycleMs: 10000, initial: REST, changes: [{ atMs: IDLE_MS, taps: one(calm) }, { atMs: 6000, taps: rest() }] };
  }
  if (c === 'toggle') {
    const count = Math.floor((STORM_SPAN_MS - 1) / STORM_PERIOD_MS) + 1;
    const storm = Array.from({ length: count }, (_, i): StormChange => ({
      atMs: IDLE_MS + i * STORM_PERIOD_MS, taps: i % 2 === 0 ? one(calm) : rest(),
    }));
    return { case: c, cycleMs: 12000, initial: REST, changes: [...storm, { atMs: 9000, taps: rest() }] };
  }
  return { case: c, cycleMs: 2 * IDLE_MS, initial: REST, changes: [{ atMs: IDLE_MS, taps: one(calm) }, { atMs: 2 * IDLE_MS, taps: rest() }] };
}

/** The number of changes at or before `elapsedMs` since the scene's start, across cycles. */
export function stormCountAt(s: StormScript, elapsedMs: number): number {
  if (!(elapsedMs > 0)) return 0;
  const cycles = Math.floor(elapsedMs / s.cycleMs);
  const within = elapsedMs - cycles * s.cycleMs;
  let k = 0;
  while (k < s.changes.length && s.changes[k].atMs <= within) k++;
  return cycles * s.changes.length + k;
}

/** The taps after `count` changes: the initial before the first, else the last change's own array. */
export function stormTapsAt(s: StormScript, count: number): readonly Tap[] {
  return count <= 0 ? s.initial : s.changes[(count - 1) % s.changes.length].taps;
}

/** The elapsed time of the first change after `elapsedMs`. */
export function nextChangeAfter(s: StormScript, elapsedMs: number): number {
  const cycles = Math.max(0, Math.floor(elapsedMs / s.cycleMs));
  for (let c = cycles; ; c++) {
    for (const ch of s.changes) {
      const at = c * s.cycleMs + ch.atMs;
      if (at > elapsedMs) return at;
    }
  }
}
