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

import { useCallback, useEffect } from 'react';
import { useFrameCallback, useSharedValue, type FrameInfo, type SharedValue } from 'react-native-reanimated';

// The value comes from motion.dtClamp in the V1 tokens (designer ruling DSN-039). Once the token
// pipeline is merged in (B4), this becomes a read of that token.
export const MAX_FRAME_DT_MS = 50;

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
  // One worklet per (t, periodMs): Reanimated re-registers a frame callback when its identity or
  // autostart changes, and a re-registered callback's first frame has no dt. An inline worklet would
  // be a new identity on every render and drop a frame of field time each time. The clamp is passed
  // in explicitly rather than read as a default parameter inside the worklet.
  const onFrame = useCallback((info: FrameInfo) => {
    'worklet';
    t.value = advanceFieldTime(t.value, info.timeSincePreviousFrame, periodMs, MAX_FRAME_DT_MS);
  }, [t, periodMs]);
  const frame = useFrameCallback(onFrame, false);
  useEffect(() => {
    frame.setActive(active);
  }, [frame, active]);
  return { t };
}
