import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme, useMotion } from '../design/theme';
import { BreathingGlow } from '../experience/aura/BreathingGlow';

// Panel 1 — "Feel it." The aura at rest: the shared BreathingGlow (brand accent, calm
// teal) large and centered, breathing slowly at duration.breath. Purely decorative; the
// whole hero is hidden from assistive tech. Under reduced motion the glow stills (handled
// inside BreathingGlow) — layout is byte-identical either way.
export function AuraHero({ size }: { size: number }) {
  const { c } = useTheme();
  const { reduced, duration } = useMotion();
  return (
    <View
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[styles.hero, { width: size, height: size }]}
    >
      <BreathingGlow color={c.accent.glow} reduced={reduced} breathMs={duration.breath} size={size} />
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', justifyContent: 'center' },
});
