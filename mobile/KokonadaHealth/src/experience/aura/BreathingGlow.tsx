import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { radius } from '../../design/tokens';

// THE brand gesture: a single soft glow that BREATHES. Extracted from SignInScreen so
// Splash, the Onboarding aura hero, and Sign-in all share ONE source of the breath — no
// drift, no duplication. Decorative (a11y-hidden) and non-interactive by contract.
//
// The breath is a sine on React Native's Animated with useNativeDriver — i.e. it runs on
// the UI thread and is time-based, so it looks identical at 60fps or a throttled 30fps —
// and it disposes on unmount (loop.stop). Under reduced motion (or a non-positive breath)
// it STILLS to a fixed dim glow with no scale loop, exactly as the shipped SignInScreen.

// The breath curve is inherent to the gesture (not a spacing/color token): a gentle
// swell in scale and opacity, defined ONCE here so every surface breathes identically.
const SCALE_REST = 1;
const SCALE_PEAK = 1.14;
const OPACITY_REST = 0.45;
const OPACITY_PEAK = 0.75;
const OPACITY_STILL = 0.55; // reduced-motion: a fixed, calm glow

export function BreathingGlow({
  color,
  reduced,
  breathMs,
  size,
  style,
}: {
  color: string;
  reduced: boolean;
  breathMs: number;
  size: number;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced || breathMs <= 0) return; // reduced-motion → a still glow, no loop
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration: breathMs / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(t, { toValue: 0, duration: breathMs / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduced, breathMs, t]);

  const scale = t.interpolate({ inputRange: [0, 1], outputRange: [SCALE_REST, SCALE_PEAK] });
  const opacity = t.interpolate({ inputRange: [0, 1], outputRange: [OPACITY_REST, OPACITY_PEAK] });
  return (
    <Animated.View
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[
        styles.glow,
        { width: size, height: size, backgroundColor: color, transform: [{ scale }], opacity: reduced ? OPACITY_STILL : opacity },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  glow: { position: 'absolute', borderRadius: radius.pill },
});
