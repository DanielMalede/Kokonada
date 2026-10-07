// The field clock (MB-085): the time the living field is drawn at, in ms within one master period T.
//
// The port is a SharedValue, so the field's uniforms are derived on the UI thread with no React
// re-render (the hot lane). The real-time adapter below advances it from Reanimated's frame
// callback; the Design Lab supplies fixed and stepped clocks through the same port.
//
// The laws, pinned by fieldClock.test.tsx:
//   · dt is clamped to MAX_FRAME_DT_MS (motion.dtClamp), so a return from the background never jumps
//     the field; the breath takes the same clamped dt (advanceFieldMotion);
//   · the clock pauses while the field is not active (the frame callback is switched off);
//   · t wraps modulo T, so it never grows without bound or loses float precision;
//   · it only moves forward: a negative, missing or non-finite dt adds nothing.

import { useCallback, useEffect } from 'react';
import { useFrameCallback, useSharedValue, type FrameInfo, type SharedValue } from 'react-native-reanimated';
import { advanceBreath, type BreathClock, type BreathState } from '../motion/breathPhaser.ts';
import { clampFrameDt, MAX_FRAME_DT_MS } from './frameDt.ts';

// One dt law (B4 item 6): the clamp and clampFrameDt live in frameDt.ts (pure), read from
// motion.dtClamp once; everything that moves with real time takes the same clamped dt.
export { clampFrameDt, MAX_FRAME_DT_MS };

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
  const dt = clampFrameDt(dtMs, maxDtMs);
  const base = Number.isFinite(t) && t >= 0 ? t : 0;
  return (base + dt) % periodMs;
}

export interface FieldMotion {
  /** The field time, in [0, T). */
  readonly t: number;
  /** The real-time breath (breathPhaser.ts). */
  readonly breath: BreathState;
}

/**
 * One real-time frame of the field: the dt is clamped once, and that one value moves both the field
 * time and the breath, so the breath can never run ahead of the field after a long frame, and a frame
 * with no dt (the first after a start) moves neither instead of reaching advanceBreath, which refuses it.
 */
export function advanceFieldMotion(
  motion: FieldMotion,
  dtMs: number | null | undefined,
  periodMs: number,
  targetN: number,
  breathClock: BreathClock,
  maxDtMs: number = MAX_FRAME_DT_MS,
): FieldMotion {
  'worklet';
  const dt = clampFrameDt(dtMs, maxDtMs);
  return { t: advanceFieldTime(motion.t, dt, periodMs, maxDtMs), breath: advanceBreath(motion.breath, dt, targetN, breathClock) };
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
