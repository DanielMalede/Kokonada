// The page's one bead presence (ruling 2, the designer's rulings of 2026-11-25): the beads BeadLayer draws and hero A's
// RimLabels reads, so a bead and the letters it knocks out answer to the same entry. The page calls it once with the
// store's taps (oldest first) and the motion tier, and hands `beads` and `looks` to both. The looks are the beads' one
// clock (useBeadClock.ts, UI-320): each bead's opacity, colour and scale, written on the UI thread every frame it moves,
// which the bead draws and the letters follow, so neither waits on JS or on a clock of its own. The driver reports a bead
// whose exit ended, and the presence drops it. Each entry is structurally hero A's RimBead (id, point, leaving).
//
// A new taps array is read by value in the same render (React's "adjust state on a prop change"), so the render that
// shows a change also stamps it, on the JS clock (performance.now()). The same taps in a new array keep the very same
// beads. The tier is read the same way: under reduced motion a bead is whole in one frame and gone in one (F1), and
// nothing is ever in motion, so the driver never runs. The stamps only tell the driver how late JS dispatched a motion.

import { useCallback, useState } from 'react';
import type { SharedValue } from 'react-native-reanimated';
import type { MotionTier } from '../../motion/useMotionPolicy.ts';
import type { PlatePoint } from '../Plate/geometry.ts';
import type { BeadLooks } from './beadDriver.ts';
import { presenceGone, presenceOf, presenceUpdate, type BeadPresence, type PresentBead } from './beadPresence.ts';
import { useBeadClock, type BeadClockOptions } from './useBeadClock.ts';

export interface BeadPresenceHandle {
  /** The beads on the plate in id order (oldest first), the leaving ones included. */
  readonly beads: readonly PresentBead[];
  /** Each moving bead's look, by id, written on the UI thread: one value for the hook's life. BeadLayer and RimLabels read it. */
  readonly looks: SharedValue<BeadLooks>;
}

interface Held {
  readonly presence: BeadPresence;
  readonly taps: readonly PlatePoint[];
  readonly tier: MotionTier;
}

export function useBeadPresence(taps: readonly PlatePoint[], tier: MotionTier, options?: BeadClockOptions): BeadPresenceHandle {
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
  const looks = useBeadClock(presence.beads, onGone, options);
  return { beads: presence.beads, looks };
}
