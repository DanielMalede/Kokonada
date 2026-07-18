import React, { useEffect, useRef } from 'react';
import { View, Animated, Easing, StyleSheet, Dimensions } from 'react-native';
import { useTheme, useMotion } from '../design/theme';
import { space, type as typography, motion } from '../design/tokens';
import { BreathingGlow } from '../experience/aura/BreathingGlow';
import { SoftGlow } from '../experience/aura/SoftGlow';
import { BrandMark } from '../experience/brand/BrandMark';

// The first breath of the instrument — the same organism as SignInScreen: one soft
// breathing aura (brand accent.glow) behind the wordmark, on surface.base, and NOTHING
// else. The aura is the star; text is nearly absent (just "Kokonada"). This is a pure
// visual: the dwell + routing that follow it are owned by the route machine (AppFlow), so
// the splash never has to know about users, sessions, or BootSplash.
//
// Motion: the wordmark does one gentle fade-up on entry (duration.slow / easing.enter),
// then holds. Under reduced motion it simply appears (no fade, no scale loop on the glow).

const GLOW_FRACTION = 0.9; // aura hero fills ~90% of the viewport width (proportional, not a token)
const ENTER = Easing.bezier(...motion.easing.enter);
const FADE_RISE = space.md; // the wordmark rises one space step as it fades in (the "up" in fade-up)
// The wordmark sits dead-centre on the glow core, whose peak inhale (0.75) would drop white
// ink to ~2.5:1. A soft surface-colored scrim between the glow and the glyphs lifts that to
// AA (dark → 6.19:1; verified in onboardingContrast.test.ts) while keeping the centered
// brand-breath intent. Constant (not breathing) so it holds at the brightest inhale.
export const SPLASH_WORDMARK_SCRIM_ALPHA = 0.45;
const SCRIM_SCALE_Y = 0.4; // compress the soft scrim into a wide, short band behind the wordmark

export function SplashScreen() {
  const { c, name } = useTheme();
  const { reduced, duration } = useMotion();

  // 0 → 1 entry progress; under reduced motion it starts (and stays) at 1 → appears at once.
  const enter = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced || duration.slow <= 0) { enter.setValue(1); return; }
    const anim = Animated.timing(enter, { toValue: 1, duration: duration.slow, easing: ENTER, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [reduced, duration.slow, enter]);

  const translateY = enter.interpolate({ inputRange: [0, 1], outputRange: [FADE_RISE, 0] });
  const glowSize = Dimensions.get('window').width * GLOW_FRACTION;

  return (
    <View style={[styles.screen, { backgroundColor: c.surface.base }]}>
      <View style={styles.hero}>
        {/* The full Aurora Seed breathes as ONE — bloom + rings + seed — so the OS bootsplash
            (still mark at rest) hands off to this (the same mark breathing from rest) with no
            pop. The breath wrapper carries the rest→peak swell; the mark is held full (opacity 1). */}
        <BreathingGlow color={c.accent.glow} reduced={reduced} breathMs={duration.breath} size={glowSize}>
          <BrandMark size={glowSize} treatment={name} opacity={1} />
        </BreathingGlow>
        {/* Legibility scrim: a soft surface-colored field between the glow and the wordmark,
            compressed into a wide short band, so white ink clears AA over the bright core. */}
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.scrim, { width: glowSize, height: glowSize, transform: [{ scaleY: SCRIM_SCALE_Y }] }]}
        >
          <SoftGlow color={c.surface.base} size={glowSize} opacity={SPLASH_WORDMARK_SCRIM_ALPHA} />
        </View>
        <Animated.Text
          accessibilityRole="header"
          style={{
            fontSize: typography.size.display,
            fontFamily: typography.family.display,
            fontWeight: typography.weight.semibold,
            letterSpacing: typography.tracking.display,
            color: c.content.primary,
            opacity: enter,
            transform: [{ translateY }],
          }}
        >
          Kokonada
        </Animated.Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scrim: { position: 'absolute' },
});
