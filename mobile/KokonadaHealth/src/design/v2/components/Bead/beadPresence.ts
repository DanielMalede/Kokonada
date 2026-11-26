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
// Ruling 2 (2026-11-25): one presence serves the beads and hero A's rim words (useBeadPresence.ts). Each entry
// carries when its entrance began (placedAt), when its exit began (leftAt) and its opacity at that moment
// (startOpacity, from the entrance's timeline), so the letters near a leaving bead fade back in step with it
// (beadTimeline.ts beadOpacityAt). The times are the caller's clock (performance.now() on the JS thread). When the
// bead's view really begins that exit, a loaded JS thread's effect perhaps well after leftAt, the entry is stamped once
// more (playedAt, presenceExitStarted), so the letters read the exit on the compressed time the bead plays it.
//
// The mount is the only reset: every tap present then is shown whole (no entrance), as a fresh ledger shows
// its first input at fade 1. A leaving bead stays until its exit ends (presenceGone). Under reduced motion (the
// still tier, F1) a bead is whole from its first frame and gone in the frame it is taken: nothing leaves, and
// turning reduced motion on ends every exit that was running.

import type { MotionTier } from '../../motion/useMotionPolicy.ts';
import type { PlatePoint } from '../Plate/geometry.ts';
import { entranceOpacity } from './beadTimeline.ts';

/** The cold lane's ring: at most this many taps are shown (emotionSlice MAX_TAPS, the ledger's ADMISSION.live). */
export const MAX_BEADS = 3;

export interface PresentBead {
  readonly id: number;
  readonly point: PlatePoint;
  /** Playing its exit; it is removed when the exit ends. */
  readonly leaving: boolean;
  /** When its entrance began; null when it was shown whole from its first frame (at the mount, or under reduced motion). */
  readonly placedAt: number | null;
  /** When its exit began; null while it is live. */
  readonly leftAt: number | null;
  /** When its view really began playing the exit (Bead reports it); null until then, and while it is live. */
  readonly playedAt: number | null;
  /** Its opacity when its exit began; 1 while it is live. */
  readonly startOpacity: number;
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

/** A live bead shown whole from its first frame. */
const whole = (id: number, point: PlatePoint): PresentBead => ({ id, point, leaving: false, placedAt: null, leftAt: null, playedAt: null, startOpacity: 1 });

export function presenceOf(taps: readonly PlatePoint[]): BeadPresence {
  const read = readTaps(taps);
  return { beads: read.map((point, id) => whole(id, point)), next: read.length };
}

/** The bead starts leaving at `nowMs`, from its opacity then (whole when it had no entrance). */
function leave(bead: PresentBead, nowMs: number): PresentBead {
  const startOpacity = bead.placedAt === null ? 1 : entranceOpacity(nowMs - bead.placedAt);
  return { ...bead, leaving: true, leftAt: nowMs, playedAt: null, startOpacity };
}

/** The presence after the store's taps change to `taps` at `nowMs`, in motion tier `tier`. */
export function presenceUpdate(prev: BeadPresence, taps: readonly PlatePoint[], nowMs: number, tier: MotionTier): BeadPresence {
  const still = tier === 'still';
  const read = readTaps(taps);
  const shown = prev.beads.filter((b) => !b.leaving);
  const unchanged = shown.length === read.length && shown.every((b, i) => same(b.point, read[i]));
  if (unchanged && !(still && shown.length < prev.beads.length)) return prev;
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
  const beads: PresentBead[] = still
    ? prev.beads.filter((bead) => kept.has(bead.id))
    : prev.beads.map((bead) => (bead.leaving || kept.has(bead.id) ? bead : leave(bead, nowMs)));
  const added = read.slice(b - a).map((point, i) => (still ? whole(prev.next + i, point) : { ...whole(prev.next + i, point), placedAt: nowMs }));
  return { beads: [...beads, ...added], next: prev.next + added.length };
}

export function presenceGone(prev: BeadPresence, id: number): BeadPresence {
  if (!prev.beads.some((bead) => bead.id === id && bead.leaving)) return prev;
  return { beads: prev.beads.filter((bead) => bead.id !== id), next: prev.next };
}

/** The leaving bead `id`'s view began its exit at `atMs`: stamped once, the first report standing. */
export function presenceExitStarted(prev: BeadPresence, id: number, atMs: number): BeadPresence {
  if (!Number.isFinite(atMs) || !prev.beads.some((bead) => bead.id === id && bead.leaving && bead.playedAt === null)) return prev;
  return { beads: prev.beads.map((bead) => (bead.id === id ? { ...bead, playedAt: atMs } : bead)), next: prev.next };
}
