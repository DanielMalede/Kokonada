// The placement ledger (architect re-rule §3): the visual layer's record of the placements, derived
// from successive tap arrays and nothing else. The cold lane stays the only source: taps are read
// structurally as {x, y} (this module never imports src/state), and nothing here is persisted.
//
// What it adds is identity. Each placement gets an ordinal, how many placements came before it, from
// a counter that only rises and is never reused. The builder keys a lobe's drift by that ordinal for
// the placement's whole life, its fade-out included, so a fourth tap never re-indexes the survivors
// (critic item 5, accepted). Lab scenes: a placement's position in the scene is its ordinal.
//
// A new taps array is classified by reference, in this order:
//   push     one more tap, every old tap still in place;
//   replace  a push with a shift: three taps, the old second and third now first and second;
//   pop      one tap fewer, the rest in place (the latest removed);
//   clear    no taps;
//   none     the same taps (the same array, or a new array of the same tap objects);
//   reset    anything else (a hydrate, a restart): ordinals 0..n−1, all live, no animation.
// A placement that leaves (replace, pop, clear) stays in the ledger as 'leaving', stamped with the
// time it left; its fade-out, admission and removal are the crossfade's (T5), not this module's.

export interface Tap {
  readonly x: number;
  readonly y: number;
}

export type LedgerRole = 'live' | 'leaving';
export type LedgerChange = 'none' | 'push' | 'replace' | 'pop' | 'clear' | 'reset';

export interface LedgerEntry {
  readonly ordinal: number;
  readonly x: number;
  readonly y: number;
  readonly role: LedgerRole;
  /** When it arrived (live) or left (leaving), in the caller's clock. */
  readonly sinceMs: number;
}

export interface Ledger {
  /** The taps array this ledger was last reconciled with, kept by reference. */
  readonly taps: readonly Tap[];
  /** The next ordinal. */
  readonly next: number;
  /** Live entries in tap order, then leaving entries in the order they left. */
  readonly entries: readonly LedgerEntry[];
  /** How the last reconcile read its taps. */
  readonly change: LedgerChange;
}

export function emptyLedger(): Ledger {
  return { taps: [], next: 0, entries: [], change: 'none' };
}

const sameTaps = (a: readonly Tap[], b: readonly Tap[], from = 0, to = a.length, offset = 0) => {
  for (let i = from; i < to; i++) if (a[i] !== b[i + offset]) return false;
  return true;
};

const entryOf = (tap: Tap, ordinal: number, nowMs: number): LedgerEntry => ({ ordinal, x: tap.x, y: tap.y, role: 'live', sinceMs: nowMs });

export function reconcile(prev: Ledger, taps: readonly Tap[], nowMs: number): Ledger {
  const old = prev.taps;
  const live = prev.entries.filter((e) => e.role === 'live');
  const leaving = prev.entries.filter((e) => e.role === 'leaving');
  const leave = (gone: readonly LedgerEntry[]) => gone.map((e) => ({ ...e, role: 'leaving' as const, sinceMs: nowMs }));

  if (taps === old || (taps.length === old.length && sameTaps(old, taps))) {
    return { ...prev, taps, change: 'none', entries: prev.entries };
  }
  if (taps.length === old.length + 1 && sameTaps(old, taps)) {
    const added = entryOf(taps[taps.length - 1], prev.next, nowMs);
    return { taps, next: prev.next + 1, entries: [...live, added, ...leaving], change: 'push' };
  }
  if (old.length === 3 && taps.length === 3 && sameTaps(old, taps, 1, 3, -1)) {
    const added = entryOf(taps[2], prev.next, nowMs);
    return { taps, next: prev.next + 1, entries: [...live.slice(1), added, ...leaving, ...leave(live.slice(0, 1))], change: 'replace' };
  }
  if (taps.length === old.length - 1 && sameTaps(taps, old)) {
    return { taps, next: prev.next, entries: [...live.slice(0, -1), ...leaving, ...leave(live.slice(-1))], change: 'pop' };
  }
  if (taps.length === 0) {
    return { taps, next: prev.next, entries: [...leaving, ...leave(live)], change: 'clear' };
  }
  return { taps, next: taps.length, entries: taps.map((tap, i) => entryOf(tap, i, nowMs)), change: 'reset' };
}

/**
 * The ledger as the builder's placements (FieldState.placements). Every fade comes from the caller:
 * there is no default, because a defaulted fade is exactly what blinks when the placements and the
 * fades land on different frames (resilience, QA-068 finding 4).
 */
export function placementsOf(ledger: Ledger, fadeOf: (entry: LedgerEntry) => number) {
  return [...ledger.entries]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((e) => ({ x: e.x, y: e.y, ordinal: e.ordinal, role: e.role, fade: fadeOf(e) }));
}
