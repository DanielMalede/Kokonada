// The page's one bead presence (ruling 2, the designer's rulings of 2026-11-25): the beads BeadLayer draws and hero A's
// RimLabels reads, so a bead and the letters it knocks out answer to the same entry. The page calls it once with the
// store's taps (oldest first) and the motion tier, hands `beads` to both, and `onGone` to BeadLayer, which reports a
// bead whose exit ended, and `onExitStart`, which stamps when a bead's native clock really started its exit and how long
// it plays (playedAt, playMs). Each entry is structurally hero A's RimBead (point, leaving, leftAt, playedAt, playMs,
// startOpacity), and beadOpacityAt (beadTimeline.ts) reads its opacity on the UI thread.
//
// A new taps array is read by value in the same render (React's "adjust state on a prop change"), so the render that
// shows a change also stamps it, on the JS clock (performance.now()). The same taps in a new array keep the very same
// beads. The tier is read the same way: under reduced motion a bead is whole in one frame and gone in one (F1).

import { useCallback, useState } from 'react';
import type { MotionTier } from '../../motion/useMotionPolicy.ts';
import type { PlatePoint } from '../Plate/geometry.ts';
import { presenceExitStarted, presenceGone, presenceOf, presenceUpdate, type BeadPresence, type PresentBead } from './beadPresence.ts';

export interface BeadPresenceHandle {
  /** The beads on the plate in id order (oldest first), the leaving ones included. */
  readonly beads: readonly PresentBead[];
  /** A leaving bead's exit ended: drop it. One function for the hook's life. */
  readonly onGone: (id: number) => void;
  /** A leaving bead's clock started its exit at `atMs` (performance.now()) and plays it over `playMs`: stamp it. One function for the hook's life. */
  readonly onExitStart: (id: number, atMs: number, playMs: number) => void;
}

interface Held {
  readonly presence: BeadPresence;
  readonly taps: readonly PlatePoint[];
  readonly tier: MotionTier;
}

export function useBeadPresence(taps: readonly PlatePoint[], tier: MotionTier): BeadPresenceHandle {
  const [held, setHeld] = useState<Held>(() => ({ presence: presenceOf(taps), taps, tier }));
  let presence = held.presence;
  if (held.taps !== taps || held.tier !== tier) {
    presence = presenceUpdate(held.presence, taps, performance.now(), tier);
    setHeld({ presence, taps, tier });
  }
  const onGone = useCallback((id: number) => {
    setHeld((h) => {
      const next = presenceGone(h.presence, id);
      return next === h.presence ? h : { ...h, presence: next };
    });
  }, []);
  const onExitStart = useCallback((id: number, atMs: number, playMs: number) => {
    setHeld((h) => {
      const next = presenceExitStarted(h.presence, id, atMs, playMs);
      return next === h.presence ? h : { ...h, presence: next };
    });
  }, []);
  return { beads: presence.beads, onGone, onExitStart };
}
