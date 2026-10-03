// The field clock (MB-085): the time the living field is drawn at, in ms within one master period T.
//
// The port is a SharedValue, so the field's uniforms are derived on the UI thread with no React
// re-render (the hot lane). The real-time adapter below advances it from Reanimated's frame
// callback; the Design Lab supplies fixed and stepped clocks through the same port.
//
// The laws, pinned by fieldClock.test.tsx:
//   · dt is clamped to MAX_FRAME_DT_MS, so a return from the background never jumps the field;
//   · the clock pauses while the field is not active (the frame callback is switched off);
//   · t wraps modulo T, so it never grows without bound or loses float precision;
//   · it only moves forward: a negative, missing or non-finite dt adds nothing.

import { useEffect } from 'react';
import { useFrameCallback, useSharedValue, type SharedValue } from 'react-native-reanimated';

export const MAX_FRAME_DT_MS = 100;

export type FieldClock = { readonly t: SharedValue<number> };

/** One frame of field time. A poisoned t (NaN, negative) restarts at 0; a bad period holds at 0. */
export function advanceFieldTime(
  t: number,
  dtMs: number | null | undefined,
  periodMs: number,
  maxDtMs: number = MAX_FRAME_DT_MS,
): number {
  'worklet';
  if (!(Number.isFinite(periodMs) && periodMs > 0)) return 0;
  const dt = typeof dtMs === 'number' && Number.isFinite(dtMs) && dtMs > 0 ? Math.min(dtMs, maxDtMs) : 0;
  const base = Number.isFinite(t) && t >= 0 ? t : 0;
  return (base + dt) % periodMs;
}

/** Real time for the field: advances on every frame while `active`, and holds still otherwise. */
export function useRealtimeFieldClock(periodMs: number, active: boolean): FieldClock {
  const t = useSharedValue(0);
  const frame = useFrameCallback((info) => {
    'worklet';
    t.value = advanceFieldTime(t.value, info.timeSincePreviousFrame, periodMs);
  }, active);
  useEffect(() => {
    frame.setActive(active);
  }, [frame, active]);
  return { t };
}
