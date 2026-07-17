import React, { useMemo } from 'react';
import { View } from 'react-native';
import { deriveAuraUniforms } from './auraUniforms';
import { breathMsForArousal, arousalFromHr, hrGlowColor } from './auraBreath';
import { BreathingGlow } from './BreathingGlow';

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
        <BreathingGlow color={accentColor} reduced={reduced} breathMs={breathMs} size={size} />
      ) : null}
    </View>
  );
}
