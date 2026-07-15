import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet } from 'react-native';
import { useTheme, useMotion } from '../design/theme';
import { radius, motion } from '../design/tokens';
import { BreathingGlow } from '../experience/aura/BreathingGlow';
import { circumplexToScreen, type WheelLayout } from '../experience/wheel/wheelGeometry';

// Panel 3 — "Your soundtrack, tuned to you." The aura condenses to a compact glow ringed
// by a faint emotion-wheel teaser, and a single dot travels from the center and SETTLES
// onto the ring with a gentle spring. The dot's rest position is derived from the real
// wheel geometry (circumplexToScreen, READ-ONLY — this is a decorative teaser, not the
// wheel) so the tease sits exactly where a committed emotion would.
//
// onSettle drives the parent's "Begin" fade-in. It is GUARANTEED to fire: immediately
// under reduced motion (dot pre-settled), otherwise on a bounded timer that tracks the
// spring — so "Begin" can never get stuck hidden.

const COMPACT_FRACTION = 0.55; // the condensed glow, smaller than the resting aura
const RING_FRACTION = 0.8;     // faint wheel ring radius, as a fraction of the half-hero
const DOT_FRACTION = 0.05;     // travelling dot diameter, as a fraction of the hero
const SETTLE_ANGLE = Math.PI / 3; // decorative rest angle on the rim (unit vector → on-ring)
const START_CIRCUMPLEX = { x: 0, y: 0 };                                   // travels from center
const SETTLE_CIRCUMPLEX = { x: Math.cos(SETTLE_ANGLE), y: Math.sin(SETTLE_ANGLE) }; // to the rim

export function WheelTeaseHero({ size, onSettle }: { size: number; onSettle?: () => void }) {
  const { c } = useTheme();
  const { reduced, duration } = useMotion();

  const half = size / 2;
  const ringR = half * RING_FRACTION;
  const layout: WheelLayout = { cx: half, cy: half, radius: ringR };
  const start = circumplexToScreen(START_CIRCUMPLEX, layout);
  const settle = circumplexToScreen(SETTLE_CIRCUMPLEX, layout);
  const dot = size * DOT_FRACTION;

  // 0 = at start (center), 1 = settled on the rim. Pre-settled under reduced motion.
  const progress = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  const settledRef = useRef(false);
  const onSettleRef = useRef(onSettle);
  onSettleRef.current = onSettle;
  const fireSettle = () => { if (!settledRef.current) { settledRef.current = true; onSettleRef.current?.(); } };

  useEffect(() => {
    if (reduced) { progress.setValue(1); fireSettle(); return; }
    const anim = Animated.spring(progress, {
      toValue: 1,
      stiffness: motion.spring.gentle.stiffness,
      damping: motion.spring.gentle.damping,
      mass: motion.spring.gentle.mass,
      useNativeDriver: true,
    });
    anim.start(({ finished }) => { if (finished) fireSettle(); });
    // Guaranteed settle signal — the gentle spring settles well within a slow beat; this
    // makes "Begin" appear even if the native spring callback is dropped.
    const t = setTimeout(fireSettle, Math.max(duration.slow, duration.base));
    return () => { anim.stop(); clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [start.x - settle.x, 0] });
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [start.y - settle.y, 0] });

  return (
    <View
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[styles.hero, { width: size, height: size }]}
    >
      <BreathingGlow color={c.accent.glow} reduced={reduced} breathMs={duration.breath} size={size * COMPACT_FRACTION} />
      {/* faint emotion-wheel ring teaser */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: layout.cx - ringR,
          top: layout.cy - ringR,
          width: ringR * 2,
          height: ringR * 2,
          borderRadius: radius.pill,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: c.content.tertiary,
        }}
      />
      {/* the settling dot — rest position from circumplexToScreen, travels in via translate */}
      <Animated.View
        testID="wheel-tease-dot"
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: settle.x - dot / 2,
          top: settle.y - dot / 2,
          width: dot,
          height: dot,
          borderRadius: radius.pill,
          backgroundColor: c.accent.glow,
          transform: [{ translateX }, { translateY }],
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', justifyContent: 'center' },
});
