import React from 'react';
import { Canvas, Group, Circle, RadialGradient, Blur, Fill, LinearGradient, vec, useClock } from '@shopify/react-native-skia';
import { useDerivedValue } from 'react-native-reanimated';
import { auroraFlowPose, auroraBlobLayout } from './auroraField';
import { useTheme } from '../../design/theme';
import { parseHex } from '../../design/contrast';

// THE LIVING AURORA — the ambient field that IS the Kokonada brand, painted by Skia on the UI/GPU
// thread so a busy JS thread (a generation in flight) can never jank it. All motion is derived from
// the frame clock through the pure, NaN-clamped auroraField math (the NeuralAnalysisLoader / BioAura
// precedent), so the only per-frame cost is four Math.sin calls — the field can never be the reason a
// frame is missed (60fps floor). Reduce-motion freezes it to the STILL identity pose (no drift/breath),
// which also stops Skia re-rendering the field entirely.
//
// (File name deliberately differs from the sibling `auroraField.ts` math module — a case-insensitive
// filesystem would otherwise alias `AuroraField.tsx` onto it.)
//
// Layer order (mockup aurora-interactive.html): canvas gradient → drifting aurora blobs → veil. The
// veil seats the UI on the aurora; it is DECORATIVE (every text cluster lays its own AA scrim on top),
// so it carries no contrast burden and stays light enough that the aurora remains the hero.
const VEIL_OPACITY = 0.42;

// A fully-transparent twin of a blob hue, so each blob is a SOFT radial glow (colour → nothing) rather
// than a hard disc — the "four soft radial blobs" the token comment describes.
const transparent = (hex: string): string => { const { r, g, b } = parseHex(hex); return `rgba(${r},${g},${b},0)`; };

export function LivingAurora({ width, height, reduced = false }: { width: number; height: number; reduced?: boolean }) {
  const { c } = useTheme();
  const clock = useClock(); // ms since mount, ticks every frame on the UI thread
  const cx = width / 2;
  const cy = height / 2;
  const blobs = auroraBlobLayout(width, height);

  // The ambient drift pose: a pure function of ELAPSED ms (never a frame count → a 30fps and a 60fps
  // device sit at the same pose at the same instant), frozen to the identity pose when reduce-motion
  // is set. Scale + rotate happen about the viewport centre (origin), then the field translates.
  const transform = useDerivedValue(() => {
    'worklet';
    const pose = auroraFlowPose(reduced ? null : clock.value, width, height);
    return [{ translateX: pose.translateX }, { translateY: pose.translateY }, { rotate: pose.rotate }, { scale: pose.scale }];
  });

  return (
    <Canvas style={{ width, height }} pointerEvents="none">
      <Fill>
        <LinearGradient start={vec(0, 0)} end={vec(0, height)} colors={[c.surface.canvasTop, c.surface.canvasBottom]} />
      </Fill>
      <Group transform={transform} origin={vec(cx, cy)}>
        {blobs.map((b) => (
          <Circle key={b.key} cx={b.cx} cy={b.cy} r={b.r} opacity={b.alpha}>
            <RadialGradient c={vec(b.cx, b.cy)} r={b.r} colors={[b.color, transparent(b.color)]} />
            <Blur blur={c.aurora.blur} />
          </Circle>
        ))}
      </Group>
      <Fill color={c.surface.veilColor} opacity={VEIL_OPACITY} />
    </Canvas>
  );
}
