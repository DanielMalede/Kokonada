import React, { useEffect, useMemo } from 'react';
import { Canvas, Group, Circle, Path, Blur, RadialGradient, Skia, useClock, vec } from '@shopify/react-native-skia';
import { useSharedValue, useDerivedValue, withSpring, type SharedValue } from 'react-native-reanimated';
import { fibonacciSphere, nearestEdges, projectNode, heat, clamp01 } from './neuralLoaderMath';

// GENESIS Neural-Analysis Loader — a translucent, reticulated pearl (a living 3D neural net)
// inside a living harmonic bloom, on the Skia UI/GPU thread so generation latency never janks it.
// All motion is derived from the frame clock + `intensity` (the active spring) + `engagement`;
// every value that reaches Skia flows through the NaN-clamped neuralLoaderMath (BioAura precedent).
//   active     — the generator is analyzing → springs intensity 0↔1 (soft overshoot in, exhale out)
//   engagement — 0..1 prompt richness → warms the palette cyan → coral → red and brightens

interface Props {
  active: boolean;
  engagement: SharedValue<number>;
  size?: number;
}

const NODE_COUNT = 44;
const TAU = Math.PI * 2;

export function NeuralAnalysisLoader({ active, engagement, size = 260 }: Props) {
  const clock = useClock(); // ms since mount, ticks every frame on the UI thread
  const intensity = useSharedValue(0);

  useEffect(() => {
    // Underdamped spring → the pearl inflates with a subtle overshoot on entry, exhales on exit.
    intensity.value = withSpring(active ? 1 : 0, { damping: 13, stiffness: 78, mass: 0.7 });
  }, [active, intensity]);

  // Geometry precomputed once on the JS thread (pure data — no worklet needed).
  const sphere = useMemo(() => fibonacciSphere(NODE_COUNT), []);
  const edges = useMemo(() => nearestEdges(sphere, 3), [sphere]);

  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2;
  const baseR = R * 0.54; // bigger core

  // ── Derived per-frame scalars (UI thread) ──────────────────────────────────
  const pr = useDerivedValue(() => {
    'worklet';
    const t = clock.value / 1000;
    const I = clamp01(intensity.value);
    const breath = Math.sin(t * (0.8 + 1.4 * I)) * 0.5 + 0.5; // alive even at rest
    return baseR * (1 + (breath - 0.5) * (0.05 + 0.08 * I));
  });
  const netColor = useDerivedValue(() => {
    'worklet';
    const [r, g, b] = heat(engagement.value);
    return `rgb(${r},${g},${b})`;
  });
  const netOpacity = useDerivedValue(() => {
    'worklet';
    return 0.35 + 0.5 * clamp01(intensity.value);
  });
  const auraR = useDerivedValue(() => {
    'worklet';
    return pr.value * 2.4;
  });

  // ── Reticulated net — 3D tumble projected to two Skia paths ─────────────────
  const edgesPath = useDerivedValue(() => {
    'worklet';
    const t = clock.value / 1000;
    const I = clamp01(intensity.value);
    const ry = t * (0.25 + 0.45 * I);
    const rx = Math.sin(t * 0.3) * 0.35; // gentle tumble
    const r = pr.value;
    const p = Skia.Path.Make();
    for (let e = 0; e < edges.length; e++) {
      const a = projectNode(sphere[edges[e][0]], ry, rx);
      const b = projectNode(sphere[edges[e][1]], ry, rx);
      p.moveTo(cx + a.px * r, cy + a.py * r * 0.98);
      p.lineTo(cx + b.px * r, cy + b.py * r * 0.98);
    }
    return p;
  });
  const nodesPath = useDerivedValue(() => {
    'worklet';
    const t = clock.value / 1000;
    const I = clamp01(intensity.value);
    const ry = t * (0.25 + 0.45 * I);
    const rx = Math.sin(t * 0.3) * 0.35;
    const r = pr.value;
    const p = Skia.Path.Make();
    for (let i = 0; i < sphere.length; i++) {
      const pt = projectNode(sphere[i], ry, rx);
      const pulse = Math.sin(t * 2.2 + pt.phase) * 0.5 + 0.5; // each node lives on its own phase
      const sz = (0.8 + 1.7 * pt.depth) * (0.85 + 0.4 * pulse); // depth cue via node size
      p.addCircle(cx + pt.px * r, cy + pt.py * r * 0.98, sz);
    }
    return p;
  });

  // ── Living harmonic bloom behind — undulating rose strands ──────────────────
  const bloomPath = useDerivedValue(() => {
    'worklet';
    const t = clock.value / 1000;
    const I = clamp01(intensity.value);
    const strands = 4 + Math.round(5 * I);
    const p = Skia.Path.Make();
    for (let s = 0; s < strands; s++) {
      const k = 3 + s;
      const flow = t * (0.5 + 0.12 * s);
      const amp = 0.22 + 0.1 * Math.sin(t * 0.7 + s);
      const rr = R * (0.55 + 0.45 * ((s + 1) / strands));
      for (let i = 0; i <= 120; i++) {
        const th = (i / 120) * TAU;
        const rad = rr * (0.74 + amp * Math.cos(k * th + flow));
        const x = cx + Math.cos(th) * rad;
        const y = cy + Math.sin(th) * rad * 0.94;
        if (i === 0) p.moveTo(x, y); else p.lineTo(x, y);
      }
    }
    return p;
  });

  return (
    <Canvas style={{ width: size, height: size }} pointerEvents="none">
      {/* aura */}
      <Circle cx={cx} cy={cy} r={auraR} opacity={netOpacity}>
        <RadialGradient c={vec(cx, cy)} r={size} colors={['rgba(158,232,255,0.16)', 'rgba(158,232,255,0)']} />
        <Blur blur={size * 0.06} />
      </Circle>

      {/* living harmonic bloom (behind the glass) */}
      <Path path={bloomPath} style="stroke" strokeWidth={1} color={netColor} opacity={0.22} />

      {/* translucent glassy iridescent body — see-through so the net reads */}
      <Circle cx={cx} cy={cy} r={pr} opacity={0.5}>
        <RadialGradient
          c={vec(cx - baseR * 0.26, cy - baseR * 0.3)}
          r={baseR * 1.3}
          colors={['rgba(255,255,255,0.34)', 'rgba(183,155,255,0.20)', 'rgba(158,232,255,0.06)']}
        />
      </Circle>

      {/* reticulated living net */}
      <Group opacity={netOpacity}>
        <Path path={edgesPath} style="stroke" strokeWidth={0.9} color={netColor} opacity={0.55} />
        <Path path={nodesPath} color={netColor}>
          <Blur blur={1.4} />
        </Path>
      </Group>

      {/* soft specular — keeps the glass read */}
      <Circle cx={cx - baseR * 0.26} cy={cy - baseR * 0.3} r={baseR * 0.4} opacity={0.5}>
        <RadialGradient
          c={vec(cx - baseR * 0.26, cy - baseR * 0.3)}
          r={baseR * 0.4}
          colors={['rgba(255,255,255,0.5)', 'rgba(255,255,255,0)']}
        />
      </Circle>
    </Canvas>
  );
}
