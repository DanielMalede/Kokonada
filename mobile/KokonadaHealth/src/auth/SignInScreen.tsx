import React, { useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet, Dimensions } from 'react-native';
import { signInWithGoogle } from './auth';
import { currentUserStore } from './currentUser';
import { onSignedIn } from '../prodBootstrap';
import { useTheme, useMotion } from '../design/theme';
import { space, radius, type as typography, elevation } from '../design/tokens';
import { BreathingGlow } from '../experience/aura/BreathingGlow';

// The auth gate's signed-out face — Wave 2.8 "Bioluminescence" first impression.
// SACRED CONTRACT: the sign-in LOGIC is unchanged (signInWithGoogle → setUser →
// onSignedIn, QA4 Suspect #1). This is a visual reskin on the token system only.

// The signature glow (BreathingGlow) is now the SHARED source used by Splash + Onboarding
// too. Its size is proportional to the viewport (an aura scales with the device — not a
// magic number) so it fills the hero on any screen width.
const GLOW_FRACTION = 0.66;

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
        <BreathingGlow color={c.accent.glow} reduced={reduced} breathMs={duration.breath} size={Dimensions.get('window').width * GLOW_FRACTION} />
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
  actions: { width: '100%', alignItems: 'center' },
  button: { width: '100%', maxWidth: 360, paddingVertical: space.lg, alignItems: 'center', borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth },
});
