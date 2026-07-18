import React from 'react';
import { View } from 'react-native';
import { Canvas, Circle, Blur, Group } from '@shopify/react-native-skia';
import { CENTER, geometry, treatments } from '../../design/brandMark.geometry';
import { BREATH_OPACITY } from '../aura/BreathingGlow';

// THE brand mark — the Aurora Seed, painted in Skia (Canvas + Circle + Blur, the SoftGlow
// idiom) from the shared brandMark.geometry constants, so the live mark and the launcher
// icons are the SAME shape. Like TabIcon there is NO font/glyph, so it cannot tofu, and it
// tints from the treatment palette (dark = abyss, light = porcelain) — never a magic colour.
//
// Layers, back to front: the bloom FIELD (a soft-falloff accent disc — a bioluminescent
// aura, not a flat disc), the faint outer ring, the breath ring, the glowing seed body, and
// a bright pinpoint highlight. The whole mark sits under ONE Group whose `opacity` carries
// the breath (default rest); a caller may wrap it in an animated view and pass opacity={1}
// to hold the mark full while the wrapper breathes rest→peak (the Splash/bootsplash seam).
//
// Decorative by contract: hidden from assistive tech, non-interactive. Draws NO background —
// the surrounding screen provides surface.base; the opaque bg lives only in the icon assets.

export interface BrandMarkProps {
  size: number;
  treatment?: 'dark' | 'light';
  opacity?: number;
}

export function BrandMark({ size, treatment = 'dark', opacity = BREATH_OPACITY.rest }: BrandMarkProps) {
  const t = treatments[treatment];
  const c = size * CENTER;
  return (
    <View
      testID="brand-mark"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={{ width: size, height: size }}
    >
      <Canvas style={{ width: size, height: size }}>
        <Group opacity={opacity}>
          {/* bloom field — Circle + Blur fading to transparent before the edge (no hard rim) */}
          <Circle cx={c} cy={c} r={size * geometry.bloom.softCore} color={t.bloom}>
            <Blur blur={size * geometry.bloom.softBlur} />
          </Circle>
          {/* faint outer ring (thinner, dimmer) */}
          <Circle
            cx={c}
            cy={c}
            r={size * geometry.ring2.r}
            color={t.ring}
            style="stroke"
            strokeWidth={size * geometry.ring2.sw}
            opacity={t.ring2Alpha}
          >
            <Blur blur={size * geometry.ring2.blur} />
          </Circle>
          {/* breath ring */}
          <Circle
            cx={c}
            cy={c}
            r={size * geometry.ring1.r}
            color={t.ring}
            style="stroke"
            strokeWidth={size * geometry.ring1.sw}
            opacity={t.ring1Alpha}
          >
            <Blur blur={size * geometry.ring1.blur} />
          </Circle>
          {/* glowing seed body */}
          <Circle cx={c} cy={c} r={size * geometry.core.body.r} color={t.coreBody}>
            <Blur blur={size * geometry.core.body.blur} />
          </Circle>
          {/* bright pinpoint highlight */}
          <Circle cx={c} cy={c} r={size * geometry.core.highlight.r} color={t.coreHighlight} />
        </Group>
      </Canvas>
    </View>
  );
}
