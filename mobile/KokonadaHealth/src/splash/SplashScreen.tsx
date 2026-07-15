import React, { useEffect, useRef } from 'react';
import { View, Animated, Easing, StyleSheet, Dimensions } from 'react-native';
import { useTheme, useMotion } from '../design/theme';
import { space, type as typography, motion } from '../design/tokens';
import { BreathingGlow } from '../experience/aura/BreathingGlow';

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

export function SplashScreen() {
  const { c } = useTheme();
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

  return (
    <View style={[styles.screen, { backgroundColor: c.surface.base }]}>
      <View style={styles.hero}>
        <BreathingGlow color={c.accent.glow} reduced={reduced} breathMs={duration.breath} size={Dimensions.get('window').width * GLOW_FRACTION} />
        <Animated.Text
          accessibilityRole="header"
          style={{
            fontSize: typography.size.display,
            fontWeight: typography.weight.bold,
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
});
