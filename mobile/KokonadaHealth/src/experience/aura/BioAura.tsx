import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { deriveAuraUniforms } from './auraUniforms';
import { breathMsForArousal, arousalFromHr, hrGlowColor } from './auraBreath';
import { BreathingGlow } from './BreathingGlow';
import { motion } from '../../design/tokens';

const EASE_CALM = Easing.bezier(...motion.easing.calm);
// The emotion bloom crosses in to ~0.55 over duration.base when the first tap lands — the moment
// "the palette comes alive". reduced-motion → it is simply present at that opacity, no fade.
const ACCENT_PEAK_OPACITY = 0.55;

// The emotion-accent bloom, mounted only when ≥1 tap exists. It fades ITSELF in on mount (0→peak)
// so a snap is impossible; on unmount (taps cleared) it is gone. Reduced-motion → instant.
function AccentBloom({ color, reduced, breathMs, size }: { color: string; reduced: boolean; breathMs: number; size: number }) {
  const opacity = useRef(new Animated.Value(reduced ? ACCENT_PEAK_OPACITY : 0)).current;
  useEffect(() => {
    if (reduced) { opacity.setValue(ACCENT_PEAK_OPACITY); return; }
    const anim = Animated.timing(opacity, { toValue: ACCENT_PEAK_OPACITY, duration: motion.duration.base, easing: EASE_CALM, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [reduced, opacity]);
  return (
    <Animated.View testID="aura-accent-bloom" pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity }]}>
      <BreathingGlow color={color} reduced={reduced} breathMs={breathMs} size={size} />
    </Animated.View>
  );
}

// The bio-aura: a soft Skia glow behind the wheel that BREATHES with live HR. The pure,
// unit-tested deriveAuraUniforms still owns HR hue/intensity; auraBreath shapes the visible
// period (REGULATOR ETHIC — slower + deeper as arousal rises) and the never-alarming-red colour.
// When taps exist the composition boundary hands an `accentColor` (emotionAccent ink) which is
// composited ADDITIVELY as a second breathing bloom — conscious intent tints the read while HR
// keeps driving intensity + breath. The pure derivation is never fed emotion (Fork 2A).
//   accentColor — emotionAccent[q].ink, present only when the user has placed ≥1 tap
//   reduced     — OS reduce-motion → both glows STILL at a fixed dim opacity (no breath loop)
export function BioAura({
  hr,
  size,
  accentColor,
  reduced = false,
}: {
  hr: number | null;
  size: number;
  accentColor?: string;
  reduced?: boolean;
}) {
  const u = useMemo(() => deriveAuraUniforms(hr), [hr]);
  const breathMs = useMemo(() => breathMsForArousal(arousalFromHr(hr)), [hr]);
  const color = useMemo(() => hrGlowColor(hr), [hr]);

  // Outer opacity = the HR-driven intensity (deriveAuraUniforms clamps it finite): the glow is
  // subtle at rest and brightens with arousal, exactly as the aura did before.
  return (
    <View
      testID="bio-aura"
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{ width: size, height: size, opacity: u.intensity }}
    >
      <BreathingGlow color={color} reduced={reduced} breathMs={breathMs} size={size} />
      {accentColor ? (
        // The emotion FOCAL glow breathes on the aurora's own focalGlow cadence (4600ms), independent
        // of the HR glow's arousal-shaped breath above (the HR layer keeps driving intensity + period).
        <AccentBloom color={accentColor} reduced={reduced} breathMs={motion.duration.focalGlow} size={size} />
      ) : null}
    </View>
  );
}
