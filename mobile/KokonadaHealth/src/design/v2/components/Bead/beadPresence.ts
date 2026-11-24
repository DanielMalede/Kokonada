// Which beads are on the plate (LEDGER §7, B2 P2 states: a fourth tap dissolves the oldest; undo and clear
// take beads away), as plain data: the bead layer draws it, and each bead plays its own entrance and exit.
//
// The store holds bare points, oldest first, so a bead's identity is read from a change by value, exactly as
// the placement ledger reads the store (placementLedger.ts change(): the longest run of the shown taps that
// the new taps begin with stays, ties to the earliest; the rest leave, tail first; what follows the run
// enters with the next ids). The beads and the field therefore answer to the same tap at every step, which
// beadPresence.test.ts holds against the real ledger. The store is read as the ledger reads it: the newest
// three (the cold lane's ring), a non-finite coordinate as 0.
//
// The mount is the only reset: every tap present then is shown at once (initial, no entrance), as a fresh
// ledger shows its first input at fade 1. A leaving bead stays until its exit ends (presenceGone).

import type { PlatePoint } from './platePoint.ts';

/** The cold lane's ring: at most this many taps are shown (emotionSlice MAX_TAPS, the ledger's ADMISSION.live). */
export const MAX_BEADS = 3;

export interface PresentBead {
  readonly id: number;
  readonly point: PlatePoint;
  /** Playing its exit; it is removed when the exit ends. */
  readonly leaving: boolean;
  /** Shown at the mount: it has no entrance. */
  readonly initial: boolean;
}

export interface BeadPresence {
  /** In id order. */
  readonly beads: readonly PresentBead[];
  /** The next id: ids only rise. */
  readonly next: number;
}

/** The store's taps as the ledger reads them (readTaps): the newest three, each non-finite coordinate as 0. */
function readTaps(taps: readonly PlatePoint[]): PlatePoint[] {
  return taps.slice(-MAX_BEADS).map((t) => ({ x: Number.isFinite(t.x) ? t.x : 0, y: Number.isFinite(t.y) ? t.y : 0 }));
}

const same = (a: PlatePoint, b: PlatePoint) => a.x === b.x && a.y === b.y;

export function presenceOf(taps: readonly PlatePoint[]): BeadPresence {
  const read = readTaps(taps);
  return { beads: read.map((point, id) => ({ id, point, leaving: false, initial: true })), next: read.length };
}

export function presenceUpdate(prev: BeadPresence, taps: readonly PlatePoint[]): BeadPresence {
  const read = readTaps(taps);
  const shown = prev.beads.filter((b) => !b.leaving);
  if (shown.length === read.length && shown.every((b, i) => same(b.point, read[i]))) return prev;
  // The kept run shown[a, b): the most taps kept, ties to the earliest run.
  let a = 0;
  let b = 0;
  for (let from = 0; from < shown.length; from++) {
    for (let to = from + 1; to <= shown.length; to++) {
      const keep = to - from;
      if (keep > b - a && keep <= read.length) {
        let match = true;
        for (let i = 0; i < keep; i++) if (!same(shown[from + i].point, read[i])) match = false;
        if (match) {
          a = from;
          b = to;
        }
      }
    }
  }
  const kept = new Set(shown.slice(a, b).map((bead) => bead.id));
  const beads: PresentBead[] = prev.beads.map((bead) => (bead.leaving || kept.has(bead.id) ? bead : { ...bead, leaving: true }));
  const added = read.slice(b - a).map((point, i) => ({ id: prev.next + i, point, leaving: false, initial: false }));
  return { beads: [...beads, ...added], next: prev.next + added.length };
}

export function presenceGone(prev: BeadPresence, id: number): BeadPresence {
  if (!prev.beads.some((bead) => bead.id === id && bead.leaving)) return prev;
  return { beads: prev.beads.filter((bead) => bead.id !== id), next: prev.next };
}
