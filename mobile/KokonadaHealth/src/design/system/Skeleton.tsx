import React, { createContext, useContext } from 'react';
import { Animated, View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme, useMotion } from '../theme';
import { space, radius, elevation } from '../tokens';
import { useCalmPulse } from './useCalmPulse';

// "Skeletons never spinners." Loading placeholders BREATHE on opacity (useCalmPulse) rather than
// sliding a shimmer — a translational shimmer reads as a spinner and inverts under the wrong theme.
// Blocks are decorative (role="none") but always wrapped in a busy live-region container, so
// perception never rides on tone alone. Reduced motion stills the pulse to full strength (still =
// 1.0) with byte-identical layout. All geometry is tokenised — zero raw hex, zero magic numbers.

// The breath frames (like BREATH_OPACITY). still = 1.0 so a reduced-motion skeleton shows at full
// strength rather than dimmed.
export const SKELETON_PULSE = { rest: 0.6, peak: 1.0, still: 1.0 } as const;

export type SkeletonVariant = 'line' | 'title' | 'card' | 'row';
export type SkeletonSurface = 'base' | 'raised';
type SkeletonWidth = number | `${number}%`;

export interface SkeletonProps {
  variant?: SkeletonVariant;
  width?: SkeletonWidth;
  onSurface?: SkeletonSurface; // where the ghost sits — 'base' (list/full-screen) or 'raised' (inside a card)
  count?: number;
  label?: string; // busy announcement for the loading container
  style?: StyleProp<ViewStyle>;
}

// A group shares ONE breath driver so every child pulses in phase (and only one loop runs).
const SkeletonPulseContext = createContext<{ opacity: Animated.AnimatedInterpolation<number> | number } | null>(null);

const DEFAULT_LABEL = 'Loading…';

// text lines pulse at low elevation; card/row silhouettes lift to e1.
const RADIUS: Record<SkeletonVariant, number> = { line: radius.sm, title: radius.sm, card: radius.lg, row: radius.lg };
const HEIGHT: Record<SkeletonVariant, number> = { line: space.md, title: space.lg, card: space['4xl'], row: space['3xl'] };
const ELEV = { line: elevation.e0, title: elevation.e0, card: elevation.e1, row: elevation.e1 } as const;
const GAP: Record<SkeletonVariant, number> = { line: space.sm, title: space.sm, card: space.lg, row: space.lg };

function defaultWidth(variant: SkeletonVariant): SkeletonWidth {
  return variant === 'title' ? '55%' : '100%';
}

function SkeletonBase({ variant = 'line', width, onSurface = 'base', count = 1, label = DEFAULT_LABEL, style }: SkeletonProps) {
  const { c } = useTheme();
  const { reduced, duration } = useMotion();
  const group = useContext(SkeletonPulseContext);
  const inGroup = group != null;
  // Hooks run unconditionally; inside a group we neutralise the own-loop (period 0) and read the
  // shared node instead, so a group runs EXACTLY one breath loop.
  const own = useCalmPulse(reduced || inGroup, inGroup ? 0 : duration.breath, SKELETON_PULSE);
  const opacity = group ? group.opacity : own;

  const ghost = onSurface === 'raised' ? c.surface.overlay : c.surface.raised;
  const n = Math.max(1, count);

  const blocks = Array.from({ length: n }).map((_, i) => (
    <Animated.View
      key={i}
      accessibilityRole="none"
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          height: HEIGHT[variant],
          width: width ?? defaultWidth(variant),
          borderRadius: RADIUS[variant],
          backgroundColor: ghost,
          opacity,
        },
        ELEV[variant],
        i > 0 ? { marginTop: GAP[variant] } : null,
        style,
      ]}
    />
  ));

  // Inside a group the container/label belong to the group; emit bare blocks so the group's gap
  // and single live region own the layout and announcement.
  if (inGroup) return <>{blocks}</>;

  return (
    <View accessibilityLabel={label} accessibilityLiveRegion="polite" style={styles.busy}>
      {blocks}
    </View>
  );
}

function SkeletonGroup({ children, label = DEFAULT_LABEL, style }: { children: React.ReactNode; label?: string; style?: StyleProp<ViewStyle> }) {
  const { reduced, duration } = useMotion();
  const opacity = useCalmPulse(reduced, duration.breath, SKELETON_PULSE);
  return (
    <SkeletonPulseContext.Provider value={{ opacity }}>
      <View accessibilityLabel={label} accessibilityLiveRegion="polite" style={[styles.group, style]}>
        {children}
      </View>
    </SkeletonPulseContext.Provider>
  );
}

function SkeletonRow({ label = DEFAULT_LABEL, style }: { label?: string; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  const { reduced, duration } = useMotion();
  const opacity = useCalmPulse(reduced, duration.breath, SKELETON_PULSE);
  return (
    <SkeletonPulseContext.Provider value={{ opacity }}>
      <View
        accessibilityLabel={label}
        accessibilityLiveRegion="polite"
        style={[styles.rowCard, elevation.e1, { backgroundColor: c.surface.raised }, style]}
      >
        <SkeletonBase variant="title" onSurface="raised" width="55%" />
        <SkeletonBase variant="line" onSurface="raised" width="100%" />
        <SkeletonBase variant="line" onSurface="raised" width="80%" />
      </View>
    </SkeletonPulseContext.Provider>
  );
}

type SkeletonComponent = typeof SkeletonBase & { Group: typeof SkeletonGroup; Row: typeof SkeletonRow };
export const Skeleton = SkeletonBase as SkeletonComponent;
Skeleton.Group = SkeletonGroup;
Skeleton.Row = SkeletonRow;

const styles = StyleSheet.create({
  busy: { gap: space.sm },
  group: { padding: space.lg, gap: space.lg },
  rowCard: { borderRadius: radius.lg, padding: space.lg, gap: space.sm },
});
