import React from 'react';
import { Canvas, Circle, Group, vec, RadialGradient } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { screenToCircumplex, circumplexToScreen, isOnWheel, type WheelLayout } from './wheelGeometry';
import type { Tap } from '../../state/cold/emotionSlice';

// The Skia radial valence/arousal wheel. The gesture runs on the UI thread; only
// the pure geometry (screenToCircumplex) and the final commit cross into JS via a
// single runOnJS on gesture-end — the ≤3-tap payload contract, unchanged from the
// web. Gesture math + geometry are unit-tested; this is the native surface,
// verified on-device.
export function RadialWheel({
  size,
  committedTaps,
  onCommit,
}: {
  size: number;
  committedTaps: Tap[];
  onCommit: (circumplex: Tap) => void;
}) {
  const r = size / 2;
  const layout: WheelLayout = { cx: r, cy: r, radius: r };

  const tap = Gesture.Tap().maxDuration(10000).onEnd((e) => {
    'worklet';
    if (!isOnWheel({ x: e.x, y: e.y }, layout)) return;
    const circumplex = screenToCircumplex({ x: e.x, y: e.y }, layout);
    runOnJS(onCommit)(circumplex); // single bridge crossing per tap
  });

  return (
    <GestureDetector gesture={tap}>
      <Canvas style={{ width: size, height: size }}>
        <Circle cx={r} cy={r} r={r}>
          <RadialGradient c={vec(r, r)} r={r} colors={['#2a2a3e', '#12121c']} />
        </Circle>
        <Group>
          {committedTaps.map((t, i) => {
            const p = circumplexToScreen(t, layout);
            // most-recent tap brightest (recency-ordered opacity)
            const opacity = 0.4 + 0.6 * ((i + 1) / committedTaps.length);
            return <Circle key={i} cx={p.x} cy={p.y} r={r * 0.06} color={`rgba(255,255,255,${opacity})`} />;
          })}
        </Group>
      </Canvas>
    </GestureDetector>
  );
}
