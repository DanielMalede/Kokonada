// The beads' driver, run (UI-320, UI-321; the architect's ruling and the designer's rulings of 2026-11-26): one shared
// value of looks by bead id, written on the UI thread by one frame callback from each bead's own clock (beadDriver.ts).
// The beads' views and the rim words' returning letters both read it, so they answer to the same frame.
//
//   · JS says who is in motion, never when: a play per bead that enters or leaves, dispatched in the commit that shows the
//     change, with how late that commit was against the presence's stamp (the entrance's placedAt, the exit's leftAt).
//     The lateness is measured once per phase and only compresses the motion; the clock itself starts on the UI thread.
//   · The frame callback is active only while a bead enters or leaves: at rest nothing runs.
//   · JS hears only onGone: one call per exit, in the frame it ends, and never after the unmount. No look is ever
//     mirrored into React state. The one other word that crosses is that the driver may rest: it carries no look, sets
//     no state, and only stops the frame callback (a callback cannot stop itself from the UI thread).

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { runOnJS, useFrameCallback, useSharedValue, type FrameInfo, type SharedValue } from 'react-native-reanimated';
import { useTokens } from '../../tokens/useTokens.ts';
import { driverStep, type BeadLooks, type BeadPlay, type BeadRuns, type DriverConfig } from './beadDriver.ts';
import { beadMotion } from './beadModel.ts';
import type { PresentBead } from './beadPresence.ts';

export interface BeadClockOptions {
  /** Every motion's length times this (the lab's dial); 1 when omitted. */
  readonly timeScale?: number;
}

/**
 * The looks of the presence's beads, by id, for the hook's life. `onGone` is called once for each leaving bead, when its
 * exit ends (the presence then drops it). A bead with no look is at rest: whole, or not yet drawn when it was placed
 * with an entrance (beadDriver.ts restLook).
 */
export function useBeadClock(beads: readonly PresentBead[], onGone: (id: number) => void, options?: BeadClockOptions): SharedValue<BeadLooks> {
  const { id: direction } = useTokens();
  const timeScale = options?.timeScale ?? 1;
  // The low tier plays the same motion (LEDGER §7); the still tier never reaches here: its presence has nothing in motion.
  const config = useMemo<DriverConfig>(() => ({ motion: beadMotion(direction, 'full'), timeScale }), [direction, timeScale]);

  const looks = useSharedValue<BeadLooks>({});
  const runs = useSharedValue<BeadRuns>({});
  const plays = useSharedValue<readonly BeadPlay[]>([]);
  // Which dispatch the UI thread last saw, and which it last said it may rest after: a word to rest is said once, and
  // one that crosses a newer dispatch on its way to JS is ignored there.
  const dispatched = useSharedValue(0);
  const rested = useSharedValue(0);
  const generation = useRef(0);
  /** Each phase's lateness, measured when it was first dispatched: `<id>:enter` or `<id>:leave`. */
  const lates = useRef(new Map<string, number>());

  const gone = useRef(onGone);
  gone.current = onGone;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const report = useCallback((id: number) => {
    if (mounted.current) gone.current(id);
  }, []);
  const onRest = useRef<(seen: number) => void>(() => {});
  const rest = useCallback((seen: number) => onRest.current(seen), []);

  const onFrame = useCallback(
    (info: FrameInfo) => {
      'worklet';
      const out = driverStep(plays.value, runs.value, looks.value, info.timestamp, config);
      runs.value = out.runs;
      // One assignment: every bead's opacity, colour and scale land in the same frame.
      looks.value = out.looks;
      for (let i = 0; i < out.gone.length; i++) runOnJS(report)(out.gone[i]);
      if (!out.moving && rested.value !== dispatched.value) {
        rested.value = dispatched.value;
        runOnJS(rest)(dispatched.value);
      }
    },
    [plays, runs, looks, dispatched, rested, config, report, rest],
  );
  const frame = useFrameCallback(onFrame, false);
  onRest.current = (seen: number) => {
    if (seen === generation.current) frame.setActive(false);
  };

  useLayoutEffect(() => {
    const now = performance.now();
    const next: BeadPlay[] = [];
    const live = new Set<string>();
    let fresh = false;
    for (const bead of beads) {
      if (!bead.leaving && bead.placedAt === null) continue;
      const key = `${bead.id}:${bead.leaving ? 'leave' : 'enter'}`;
      live.add(key);
      let late = lates.current.get(key);
      if (late === undefined) {
        const stamp = bead.leaving ? bead.leftAt : bead.placedAt;
        late = stamp === null ? 0 : Math.max(0, now - stamp);
        lates.current.set(key, late);
        fresh = true;
      }
      next.push({ id: bead.id, leaving: bead.leaving, entered: bead.placedAt !== null, late });
    }
    for (const key of [...lates.current.keys()]) if (!live.has(key)) lates.current.delete(key);
    plays.value = next;
    if (fresh) {
      generation.current += 1;
      dispatched.value = generation.current;
      frame.setActive(true);
    }
  }, [beads, plays, dispatched, frame]);

  return looks;
}
