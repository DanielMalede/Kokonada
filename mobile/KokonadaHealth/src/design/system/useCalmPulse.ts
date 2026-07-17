import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';

// The shared BREATH ENGINE. This is BreathingGlow's loop extracted verbatim and generalised so
// every system-state primitive (skeletons, the offline dot) breathes from ONE implementation —
// nothing re-invents a pulse and there is no drift. A sine on Animated with the NATIVE driver, so
// it is UI-thread and time-based (identical at 60fps or a throttled 30fps). Under reduced motion —
// or a non-positive period — it stills to a fixed value and starts no loop, and the loop is always
// disposed on unmount so nothing leaks.

// rest/peak = the animated opacity floor/ceiling; still = the fixed frame shown when the breath is
// silenced (reduced motion). One curve object is the single source of all three frames.
export interface CalmPulseCurve { rest: number; peak: number; still: number; }

export function useCalmPulse(
  reduced: boolean,
  periodMs: number,
  curve: CalmPulseCurve,
): Animated.AnimatedInterpolation<number> | number {
  const t = useRef(new Animated.Value(0)).current;
  const silenced = reduced || periodMs <= 0;

  useEffect(() => {
    if (silenced) return; // reduced / non-positive → a still frame, no loop
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration: periodMs / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(t, { toValue: 0, duration: periodMs / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [silenced, periodMs, t]);

  return silenced ? curve.still : t.interpolate({ inputRange: [0, 1], outputRange: [curve.rest, curve.peak] });
}
