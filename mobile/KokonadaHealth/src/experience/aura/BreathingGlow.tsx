import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { SoftGlow } from './SoftGlow';
import { BREATH_OPACITY } from './breath';

// THE brand gesture: a single soft glow that BREATHES. It renders a soft-falloff Skia glow
// (SoftGlow: Circle + Blur) — a bioluminescent FIELD, never a hard-edged flat disc — behind
// a decorative wrapper that carries the breath. Shared by Splash, the Onboarding aura hero,
// and Sign-in, so the breath has ONE source (no drift, no duplication).
//
// The breath is a sine on React Native's Animated with useNativeDriver — UI-thread and
// time-based, so it looks identical at 60fps or a throttled 30fps — driving the wrapper's
// OPACITY, and it disposes on unmount (loop.stop). Under reduced motion (or a non-positive
// breath) it STILLS to a fixed dim glow with no loop. Decorative (a11y-hidden) by contract.

// The breath opacity curve lives in ./breath (a pure module shared with the asset scripts);
// re-exported here so every existing importer keeps `import { BREATH_OPACITY } from '.../BreathingGlow'`.
export { BREATH_OPACITY };

export function BreathingGlow({
  color,
  reduced,
  breathMs,
  size,
  style,
  children,
}: {
  color: string;
  reduced: boolean;
  breathMs: number;
  size: number;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
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

  const opacity = reduced
    ? BREATH_OPACITY.still
    : t.interpolate({ inputRange: [0, 1], outputRange: [BREATH_OPACITY.rest, BREATH_OPACITY.peak] });

  return (
    <Animated.View
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[styles.glow, { width: size, height: size, opacity }, style]}
    >
      {/* custom children (e.g. the full BrandMark) REPLACE the default bloom, so the ONE
          breath can carry the whole mark — not only the soft glow — with no duplication. */}
      {children ?? <SoftGlow color={color} size={size} />}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  glow: { position: 'absolute' },
});
