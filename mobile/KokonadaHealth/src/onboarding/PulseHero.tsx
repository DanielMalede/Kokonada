import React, { useEffect, useRef } from 'react';
import { View, Animated, Easing, StyleSheet } from 'react-native';
import { useMotion } from '../design/theme';
import { emotionAnchors, radius } from '../design/tokens';
import { BreathingGlow } from '../experience/aura/BreathingGlow';
import { SoftGlow } from '../experience/aura/SoftGlow';

// Panel 2 — "Your body is heard." The aura REACTING: a concentric ring pulses out on a
// gentle heartbeat cadence while the hue drifts calm↔warm. The cadence is derived from the
// breath token (≈1s ≈ a calm ~60bpm heart) and the ring/drift run on Animated with the
// native driver — i.e. UI-thread and time-based, so they look identical at 60fps or 30fps
// and dispose on unmount.
//
// REGULATOR ETHIC (load-bearing): the drift reaches WARM and stops. It never crosses into
// coral/peak/red — the aura is calming even as a demo, never alarming. Both hue endpoints
// are the calm/warm anchor tokens; nothing here can render a red.
//
// Reduced motion: a single STATIC ring at rest, no hue drift, no pulse loop.

const RING_BASE_FRACTION = 0.55; // ring diameter as a fraction of the hero
const RING_STROKE_FRACTION = 0.01; // ring stroke as a fraction of the hero (proportional, scales with device)
const RING_MAX_SCALE = 1.8;      // how far the pulse expands
const RING_PEAK_OPACITY = 0.5;
const WARM_PEAK_OPACITY = 0.5;   // how strongly the drift blends toward warm

export function PulseHero({ size }: { size: number }) {
  const { reduced, duration } = useMotion();
  const pulse = useRef(new Animated.Value(0)).current; // 0 = ring at rest, 1 = fully expanded/faded
  const drift = useRef(new Animated.Value(0)).current; // 0 = calm, 1 = warm

  useEffect(() => {
    if (reduced) { pulse.setValue(0); drift.setValue(0); return; } // static ring, pure calm
    const period = Math.max(1, Math.round(duration.breath / 4)); // calm heartbeat cadence
    const ring = Animated.loop(
      Animated.timing(pulse, { toValue: 1, duration: period, easing: Easing.out(Easing.ease), useNativeDriver: true }),
    );
    const hue = Animated.loop(
      Animated.sequence([
        Animated.timing(drift, { toValue: 1, duration: duration.breath / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(drift, { toValue: 0, duration: duration.breath / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    ring.start();
    hue.start();
    return () => { ring.stop(); hue.stop(); };
  }, [reduced, duration.breath, pulse, drift]);

  const ringSize = size * RING_BASE_FRACTION;
  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, RING_MAX_SCALE] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [RING_PEAK_OPACITY, 0] });
  const warmOpacity = reduced ? 0 : drift.interpolate({ inputRange: [0, 1], outputRange: [0, WARM_PEAK_OPACITY] });

  return (
    <View
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[styles.hero, { width: size, height: size }]}
    >
      {/* base calm glow (soft-falloff) */}
      <BreathingGlow color={emotionAnchors.calm} reduced={reduced} breathMs={duration.breath} size={size} />
      {/* warm-drift overlay — a soft-falloff warm glow whose opacity cross-fades the perceived hue calm↔warm */}
      <Animated.View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.glow, { width: size, height: size, opacity: warmOpacity }]}
      >
        <SoftGlow color={emotionAnchors.warm} size={size} />
      </Animated.View>
      {/* the heartbeat ring */}
      <Animated.View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.ring,
          {
            width: ringSize,
            height: ringSize,
            borderWidth: Math.max(StyleSheet.hairlineWidth, size * RING_STROKE_FRACTION),
            borderColor: emotionAnchors.calm,
            opacity: reduced ? RING_PEAK_OPACITY : ringOpacity,
            transform: [{ scale: reduced ? 1 : ringScale }],
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', justifyContent: 'center' },
  glow: { position: 'absolute', borderRadius: radius.pill },
  ring: { position: 'absolute', borderRadius: radius.pill },
});
