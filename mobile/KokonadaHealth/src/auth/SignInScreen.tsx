import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, Dimensions, Platform } from 'react-native';
import { appleAuth, AppleButton } from '@invertase/react-native-apple-authentication';
import { signInWithGoogle, signInWithApple, type KokonadaUser } from './auth';
import { currentUserStore } from './currentUser';
import { onSignedIn } from '../prodBootstrap';
import { useTheme, useMotion } from '../design/theme';
import { space, type as typography } from '../design/tokens';
import { BreathingGlow } from '../experience/aura/BreathingGlow';
import { GoogleSignInButton, SIGN_IN_BUTTON_HEIGHT, GOOGLE_SIGN_IN_WIDTH } from './GoogleSignInButton';
import { PrivacyPolicyLink } from '../legal/PrivacyPolicyLink';

// The auth gate's signed-out face — Wave 2.8 "Bioluminescence" first impression.
// SACRED CONTRACT: the sign-in LOGIC is unchanged (signInWithGoogle → setUser →
// onSignedIn, QA4 Suspect #1). This is a visual reskin on the token system only.

// The signature glow (BreathingGlow) is now the SHARED source used by Splash + Onboarding
// too. Its size is proportional to the viewport (an aura scales with the device — not a
// magic number) so it fills the hero on any screen width.
const GLOW_FRACTION = 0.66;

export function SignInScreen() {
  const { c, name } = useTheme();
  const { reduced, duration } = useMotion();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Synchronous re-entry latch — immune to stale-closure races, so a fast Google+Apple
  // double-tap can't double-fire (the native AppleButton has no `disabled` prop to lean on).
  const inFlight = useRef(false);

  // SACRED CONTRACT (QA4 Suspect #1): a successful sign-in ALWAYS runs
  // <provider> → setUser → onSignedIn, unchanged. Both Google and Apple funnel through
  // this one handler so the post-auth ignition is identical for either provider. A provider
  // may resolve null to signal a benign no-op (e.g. an Apple cancel) — that shows no error.
  const runSignIn = async (provider: () => Promise<KokonadaUser | null>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const user = await provider();
      if (!user) return; // cancelled / no-op — leave the gate untouched, no banner
      currentUserStore.getState().setUser(user);
      await onSignedIn();
    } catch (e: any) {
      setError(e?.message ?? 'Sign-in failed');
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  };

  const onGoogle = () => runSignIn(signInWithGoogle);
  const onApple = () => runSignIn(signInWithApple);

  // Guideline 4.8: on iOS, wherever a third-party login (Google) is offered we MUST offer
  // Sign in with Apple. It uses Apple's OFFICIAL button (ASAuthorizationAppleIDButton via
  // AppleButton) — never a hand-drawn look-alike. Not shown on Android or pre-iOS-13.
  const showApple = Platform.OS === 'ios' && appleAuth.isSupported;
  // Apple HIG: White on dark backgrounds (the app is dark-default, "abyss", where a BLACK button
  // would be nearly invisible). On the light face, White with outline — HIG: "Use this style on
  // white or light-color backgrounds that don't provide sufficient contrast with the white button
  // fill." The light canvas (surface.base) is near-white, so it applies; it also pairs with
  // Google's white pill beside it (designer, HX-6; owner, DEC-106).
  const appleButtonStyle = name === 'dark' ? AppleButton.Style.WHITE : AppleButton.Style.WHITE_OUTLINE;

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
        {/* HX-6: Google's pre-approved button image, exactly as downloaded (never drawn in code). */}
        <GoogleSignInButton busy={busy} onPress={onGoogle} />

        {/* On Android nothing Apple renders: no placeholder, no disabled or look-alike button. */}
        {showApple ? (
          <AppleButton
            testID="apple-signin-button"
            buttonStyle={appleButtonStyle}
            buttonType={AppleButton.Type.SIGN_IN}
            // Half the shared height: a pill, matching Google's (HIG: "Adjust the corner radius to
            // match the appearance of other buttons in your app"). Not radius.pill — the native
            // button takes a real radius, and 20 is exactly half of SIGN_IN_BUTTON_HEIGHT.
            cornerRadius={SIGN_IN_BUTTON_HEIGHT / 2}
            onPress={onApple}
            style={styles.appleButton}
          />
        ) : null}

        {error ? (
          <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ marginTop: space.md, color: c.state.danger, textAlign: 'center' }}>
            {error}
          </Text>
        ) : null}

        {/* HX-5: the privacy policy, reachable before any sign-in button acts. It closes the block,
            so an error stays next to the buttons it is about. Never disabled. */}
        <View style={styles.privacyPolicy}>
          <PrivacyPolicyLink />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.xl, paddingTop: 96, paddingBottom: 56 },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  actions: { width: '100%', alignItems: 'center' },
  // The official Apple button draws its own fill/label; we only own its measure. It is exactly the
  // Google image's rendered size — one height constant, one width — so neither button is smaller
  // than the other (Apple HIG: no smaller than other sign-in buttons; Google: "approximately the
  // same size"). This equalises SIZE only; visual weight is not asserted here. One gap below.
  appleButton: { width: GOOGLE_SIGN_IN_WIDTH, height: SIGN_IN_BUTTON_HEIGHT, marginTop: space.md },
  privacyPolicy: { marginTop: space.lg, alignItems: 'center' },
});
