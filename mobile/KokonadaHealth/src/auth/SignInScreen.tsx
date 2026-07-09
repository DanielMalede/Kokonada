import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, Animated, Easing, StyleSheet } from 'react-native';
import { signInWithGoogle } from './auth';
import { currentUserStore } from './currentUser';
import { onSignedIn } from '../prodBootstrap';
import { useTheme, useMotion } from '../design/theme';
import { space, radius, type as typography, elevation } from '../design/tokens';

// The auth gate's signed-out face — Wave 2.8 "Bioluminescence" first impression.
// SACRED CONTRACT: the sign-in LOGIC is unchanged (signInWithGoogle → setUser →
// onSignedIn, QA4 Suspect #1). This is a visual reskin on the token system only.

// The one signature: a single soft cyan glow that BREATHES behind the wordmark — the
// brand's recognisable gesture. Decorative (a11y-hidden) and stilled under reduced motion.
function BreathingGlow({ color, reduced, breathMs }: { color: string; reduced: boolean; breathMs: number }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced || breathMs <= 0) return; // reduced-motion → a still glow, no loop
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration: breathMs / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(t, { toValue: 0, duration: breathMs / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduced, breathMs, t]);

  const scale = t.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] });
  const opacity = t.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0.75] });
  return (
    <Animated.View
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[styles.glow, { backgroundColor: color, transform: [{ scale }], opacity: reduced ? 0.55 : opacity }]}
    />
  );
}

export function SignInScreen() {
  const { c } = useTheme();
  const { reduced, duration } = useMotion();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onPress = async () => {
    setBusy(true);
    setError(null);
    try {
      const user = await signInWithGoogle();
      currentUserStore.getState().setUser(user);
      await onSignedIn();
    } catch (e: any) {
      setError(e?.message ?? 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: c.surface.base }]}>
      <View style={styles.hero}>
        <BreathingGlow color={c.accent.glow} reduced={reduced} breathMs={duration.breath} />
        <Text
          accessibilityRole="header"
          style={{ fontSize: typography.size.display, fontWeight: typography.weight.bold, letterSpacing: typography.tracking.display, color: c.content.primary }}
        >
          Kokonada
        </Text>
        <Text style={{ marginTop: space.sm, fontSize: typography.size.callout, textAlign: 'center', color: c.content.secondary, maxWidth: 300, lineHeight: typography.size.callout * typography.leading.normal }}>
          Music that moves with your body and mood.
        </Text>
      </View>

      <View style={styles.actions}>
        <Pressable
          onPress={onPress}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Continue with Google"
          accessibilityState={{ disabled: busy, busy }}
          style={[
            styles.button,
            elevation.e1,
            { backgroundColor: c.surface.raised, borderColor: c.surface.hairline, opacity: busy ? 0.6 : 1 },
          ]}
        >
          {busy ? (
            <ActivityIndicator color={c.content.primary} />
          ) : (
            <Text style={{ color: c.content.primary, fontWeight: typography.weight.semibold, fontSize: typography.size.body }}>
              Continue with Google
            </Text>
          )}
        </Pressable>

        {error ? (
          <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ marginTop: space.md, color: c.state.danger, textAlign: 'center' }}>
            {error}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.xl, paddingTop: 96, paddingBottom: 56 },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  glow: { position: 'absolute', width: 260, height: 260, borderRadius: radius.pill },
  actions: { width: '100%', alignItems: 'center' },
  button: { width: '100%', maxWidth: 360, paddingVertical: space.lg, alignItems: 'center', borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth },
});
