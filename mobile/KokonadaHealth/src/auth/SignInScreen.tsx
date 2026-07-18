import React, { useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet, Dimensions, Platform } from 'react-native';
import { appleAuth, AppleButton } from '@invertase/react-native-apple-authentication';
import { signInWithGoogle, signInWithApple, type KokonadaUser } from './auth';
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

  // SACRED CONTRACT (QA4 Suspect #1): a successful sign-in ALWAYS runs
  // <provider> → setUser → onSignedIn, unchanged. Both Google and Apple funnel through
  // this one handler so the post-auth ignition is identical for either provider.
  const runSignIn = async (provider: () => Promise<KokonadaUser>) => {
    setBusy(true);
    setError(null);
    try {
      const user = await provider();
      currentUserStore.getState().setUser(user);
      await onSignedIn();
    } catch (e: any) {
      setError(e?.message ?? 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  const onGoogle = () => runSignIn(signInWithGoogle);
  const onApple = () => runSignIn(signInWithApple);

  // Guideline 4.8: on iOS, wherever a third-party login (Google) is offered we MUST offer
  // Sign in with Apple. It uses Apple's OFFICIAL button (ASAuthorizationAppleIDButton via
  // AppleButton) — never a hand-drawn look-alike. Not shown on Android or pre-iOS-13.
  const showApple = Platform.OS === 'ios' && appleAuth.isSupported;

  return (
    <View style={[styles.screen, { backgroundColor: c.surface.base }]}>
      <View style={styles.hero}>
        <BreathingGlow color={c.accent.glow} reduced={reduced} breathMs={duration.breath} size={Dimensions.get('window').width * GLOW_FRACTION} />
        <Text
          accessibilityRole="header"
          style={{ fontSize: typography.size.display, fontFamily: typography.family.display, fontWeight: typography.weight.semibold, letterSpacing: typography.tracking.display, color: c.content.primary }}
        >
          Kokonada
        </Text>
        <Text style={{ marginTop: space.sm, fontSize: typography.size.callout, textAlign: 'center', color: c.content.secondary, maxWidth: 300, lineHeight: typography.size.callout * typography.leading.normal }}>
          Music that moves with your body and mood.
        </Text>
      </View>

      <View style={styles.actions}>
        <Pressable
          onPress={onGoogle}
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

        {showApple ? (
          <AppleButton
            testID="apple-signin-button"
            buttonStyle={AppleButton.Style.BLACK}
            buttonType={AppleButton.Type.SIGN_IN}
            onPress={onApple}
            style={styles.appleButton}
          />
        ) : null}

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
  // The official Apple button draws its own fill/label; we only own its measure. It matches
  // the Google button's width and sits one gap below it.
  appleButton: { width: '100%', maxWidth: 360, height: 52, marginTop: space.md },
});
