import React from 'react';
import { View, type AccessibilityActionEvent } from 'react-native';
import { Canvas, Circle, Group, vec, RadialGradient, Blur } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { screenToCircumplex, circumplexToScreen, isOnWheel, type WheelLayout } from './wheelGeometry';
import { hitsMostRecentDot } from './wheelInteraction';
import { useTheme } from '../../design/theme';
import { emotionAccentFor, auroraGlow } from '../../design/emotionAccent';
import { glassFor } from '../../design/auroraSurfaces';
import { elevation } from '../../design/tokens';
import type { Tap } from '../../state/cold/emotionSlice';

// Dot geometry (fractions of the wheel radius): the painted node is small, but the tap target
// is the generous ≥44dp remove-radius in wheelInteraction. Most-recent dot is largest (a recency
// trail). AURORA: each dot's soft fill is ITS OWN continuous auroraGlow(x,y) — the emotion colour
// at that exact point on the disc — while a crisp structural RING (AA-large vs the disc) carries the
// shape, so the decorative bright fill never has to also be the legibility cue.
const DOT_BASE = 0.055;
const DOT_RECENCY_GROW = 0.4; // most-recent is 1.4× the oldest
const DOT_OPACITY_FLOOR = 0.5;
const DOT_RING_WIDTH = 2; // the crisp structural stroke around each dot

// The Skia radial valence/arousal wheel. The gesture runs on the UI thread; only the pure
// geometry + the final commit cross into JS via a SINGLE runOnJS on gesture-end — the ≤3-tap
// payload contract, unchanged. That single crossing keeps the pure, unit-tested geometry OFF the
// worklet, which is what fixes the on-device Reanimated-4 crash. The worklet only forwards raw
// coordinates; the JS thread decides add-vs-undo and reads the geometry.
export function RadialWheel({
  size,
  committedTaps,
  onCommit,
  onRemoveLast,
  onClear,
  accentInk,
  reduced = false,
}: {
  size: number;
  committedTaps: Tap[];
  onCommit: (circumplex: Tap) => void;
  onRemoveLast?: () => void;
  onClear?: () => void;
  accentInk?: string;
  reduced?: boolean;
}) {
  const { name, c } = useTheme();
  const r = size / 2;
  const layout: WheelLayout = { cx: r, cy: r, radius: r };
  // The session's emotion-mean ink RINGS every dot (AA-large vs the disc — RadialWheel.test pins it);
  // the per-dot FILL is each tap's own auroraGlow, so the ring, not the bright fill, carries the shape.
  const ringInk = accentInk ?? c.emotionAccent.calm.ink;
  const glass = glassFor(c, name);
  // The wheel is a frosted-glass LENS floating ON the aurora (not a window onto it — the moving field
  // must never fight the dots), so the disc is the glass in its opaque fallback form with a bright
  // frosted rim of light. The living aurora reads in the FIELD around the wheel, and glints on this rim.
  const discColors = name === 'light'
    ? [c.surface.raised, c.surface.glassFallback]
    : [c.surface.overlay, c.surface.glassFallback];

  // Hit-test + geometry run on the JS thread. §5: a tap on the most-recent dot removes it
  // (undo), otherwise it commits a new point. Single bridge crossing per tap either way.
  const commitTap = (x: number, y: number) => {
    if (onRemoveLast && hitsMostRecentDot({ x, y }, committedTaps, layout)) { onRemoveLast(); return; }
    if (!isOnWheel({ x, y }, layout)) return;
    onCommit(screenToCircumplex({ x, y }, layout));
  };

  const tap = Gesture.Tap().maxDuration(10000).onEnd((e) => {
    'worklet';
    runOnJS(commitTap)(e.x, e.y);
  });

  const count = committedTaps.length;
  const a11yLabel = count === 0
    ? 'Emotion wheel, no points placed'
    : `Emotion wheel, ${count} ${count === 1 ? 'point' : 'points'} placed, leaning ${emotionAccentFor(committedTaps)}`;
  const onAction = (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === 'undo') onRemoveLast?.();
    else if (e.nativeEvent.actionName === 'clear') onClear?.();
  };

  return (
    <View
      accessibilityRole="adjustable"
      accessibilityLabel={a11yLabel}
      accessibilityActions={[{ name: 'undo', label: 'Undo last' }, { name: 'clear', label: 'Clear' }]}
      onAccessibilityAction={onAction}
      style={[elevation.e1, { width: size, height: size, borderRadius: r }]} // floating-lens shadow
    >
      <GestureDetector gesture={tap}>
        <Canvas style={{ width: size, height: size }}>
          <Circle cx={r} cy={r} r={r}>
            <RadialGradient c={vec(r, r)} r={r} colors={discColors} />
          </Circle>
          <Circle cx={r} cy={r} r={r} color={glass.border} style="stroke" strokeWidth={1} />
          <Group>
            {committedTaps.map((t, i) => {
              const p = circumplexToScreen(t, layout);
              const recency = count > 0 ? (i + 1) / count : 1; // most-recent → 1
              const dotR = r * DOT_BASE * (1 + DOT_RECENCY_GROW * recency);
              const opacity = reduced ? 1 : DOT_OPACITY_FLOOR + (1 - DOT_OPACITY_FLOOR) * recency;
              return (
                <Group key={i}>
                  {/* decorative soft fill — this dot's OWN emotion glow (no AA burden) */}
                  <Circle cx={p.x} cy={p.y} r={dotR} color={auroraGlow(t.x, t.y)} opacity={opacity}>
                    <Blur blur={dotR} />
                  </Circle>
                  {/* crisp structural ring — AA-large vs the disc (carries the shape) */}
                  <Circle cx={p.x} cy={p.y} r={dotR} color={ringInk} opacity={opacity} style="stroke" strokeWidth={DOT_RING_WIDTH} />
                </Group>
              );
            })}
          </Group>
        </Canvas>
      </GestureDetector>
    </View>
  );
}
