import React, { useMemo } from 'react';
import { Canvas, Circle, Blur, Group } from '@shopify/react-native-skia';
import { deriveAuraUniforms } from './auraUniforms';

// The bio-aura: a soft Skia glow behind the wheel whose hue and intensity breathe
// with live HR. All the math lives in the pure, unit-tested deriveAuraUniforms /
// advancePulsePhase; this component is the thin Skia surface. The pulse phase is
// driven on-device by a Reanimated clock feeding advancePulsePhase (frame-rate
// independent). Verified on-device — the derivation is unit-tested.
export function BioAura({ hr, size }: { hr: number | null; size: number }) {
  const u = useMemo(() => deriveAuraUniforms(hr), [hr]);
  const r = size / 2;
  const color = `hsl(${Math.round(u.hue)}, 80%, 55%)`;
  return (
    <Canvas style={{ width: size, height: size }} pointerEvents="none">
      <Group opacity={u.intensity}>
        <Circle cx={r} cy={r} r={r * 0.8} color={color}>
          <Blur blur={r * 0.25} />
        </Circle>
      </Group>
    </Canvas>
  );
}
