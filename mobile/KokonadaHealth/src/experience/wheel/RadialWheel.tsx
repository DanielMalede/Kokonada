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

  // Hit-test + geometry run on the JS thread. A tap is infrequent, so the single
  // runOnJS crossing per tap is free — and keeping the pure, unit-tested geometry
  // OFF the worklet is what fixes the on-device crash: Reanimated 4 makes calling a
  // non-worklet function ('isOnWheel'/'screenToCircumplex') synchronously from a
  // worklet a hard error. The worklet now only forwards the raw coordinates.
  const commitTap = (x: number, y: number) => {
    if (!isOnWheel({ x, y }, layout)) return;
    onCommit(screenToCircumplex({ x, y }, layout)); // single bridge crossing per tap
  };

  const tap = Gesture.Tap().maxDuration(10000).onEnd((e) => {
    'worklet';
    runOnJS(commitTap)(e.x, e.y);
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
