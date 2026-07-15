import React from 'react';
import { Canvas, Circle, Blur, Group } from '@shopify/react-native-skia';

// THE soft-falloff glow primitive — a Skia Circle wrapped in a Blur so the color ramps
// smoothly to fully transparent at the edge. It reads as a bioluminescent FIELD (depth),
// never a hard-edged flat disc / loading placeholder. Same technique as BioAura (which
// already ships Skia Circle+Blur), so no new dependency and Jest handles it via the same
// Skia mock. Purely presentational: callers wrap it for a11y / breath / positioning.
//
// The core is a fraction of the field so that core + blur spread fade to ~0 BEFORE the
// canvas edge — that is what removes any visible rim (a circle drawn edge-to-edge would
// clip into a hard disc). Blur ≥ 0.25 × core radius is the design-language softness floor.
const CORE_FRACTION = 0.3; // circle radius as a fraction of the field size
const BLUR_FRACTION = 0.1;  // blur radius as a fraction of the field (= 0.33 × core radius)

export function SoftGlow({ color, size, opacity = 1 }: { color: string; size: number; opacity?: number }) {
  const center = size / 2;
  const r = size * CORE_FRACTION;
  return (
    <Canvas style={{ width: size, height: size }}>
      <Group opacity={opacity}>
        <Circle cx={center} cy={center} r={r} color={color}>
          <Blur blur={size * BLUR_FRACTION} />
        </Circle>
      </Group>
    </Canvas>
  );
}
