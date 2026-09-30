import React from 'react';
import { View, Image, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { useTheme } from '../design/theme';
import { space } from '../design/tokens';

// HX-6 (CMP-099, MB-036): the Google sign-in button IS Google's pre-approved image, shown exactly
// as downloaded (assets/brand/google/README.md records the source and a SHA-256 per file). Nothing
// here draws the button, the words or the "G": a button drawn in code is a custom button, bound by
// every rule of Google's "Create a custom Sign in with Google Button" section (Google Sans Medium,
// the colour table, the padding), and a hand-drawn look-alike is not the pre-approved asset. The
// image is never tinted, dimmed, cropped, re-padded,
// stretched or mirrored; theme tokens are not applied to it.

// One file per face (Metro picks the @2x/@3x variant for the device density).
const GOOGLE_SIGN_IN_IMAGE = {
  light: require('../../assets/brand/google/google_signin_pill_light.png'),
  dark: require('../../assets/brand/google/google_signin_pill_dark.png'),
};

// The words Google draws on the image, read from the file itself and recorded in the README. The
// accessible name is exactly these words (English only until F7, DEC-051).
export const GOOGLE_SIGN_IN_WORDS = 'Sign in with Google';

// The file's intrinsic aspect ratio (@1x is 180×40; @2x and @3x are exact multiples) — a property
// of the asset, not a design number. Google: scale as needed, but preserve the aspect ratio.
export const GOOGLE_SIGN_IN_ASPECT = 180 / 40;

// One height for every sign-in button — Google's here, Apple's on iOS (SignInScreen) — in dp, so it
// ignores font scale. 40 is the asset's designed @1x height, so it renders pixel-exact at 1x, 2x and
// 3x. The designer may choose another height; the width follows from the aspect ratio.
export const SIGN_IN_BUTTON_HEIGHT = 40;
export const GOOGLE_SIGN_IN_WIDTH = SIGN_IN_BUTTON_HEIGHT * GOOGLE_SIGN_IN_ASPECT;

export interface GoogleSignInButtonProps {
  busy: boolean;
  onPress: () => void;
}

export function GoogleSignInButton({ busy, onPress }: GoogleSignInButtonProps) {
  const { name, c } = useTheme();
  return (
    <Pressable
      testID="google-signin-button"
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={GOOGLE_SIGN_IN_WORDS}
      accessibilityState={{ disabled: busy, busy }}
      style={styles.target}
    >
      <View style={styles.frame}>
        <Image
          testID="google-signin-image"
          source={GOOGLE_SIGN_IN_IMAGE[name]}
          resizeMode="contain"
          accessible={false}
          importantForAccessibility="no"
          style={styles.image}
        />
        {/* Busy never touches the image: the spinner sits just past its trailing edge. */}
        {busy ? (
          <View style={styles.spinnerSlot}>
            <ActivityIndicator testID="google-signin-busy" color={c.content.secondary} />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // An invisible target at least 48 dp tall around the 40 dp image (Android's minimum touch
  // target) — the image itself is never re-padded.
  target: { minHeight: space['3xl'], alignItems: 'center', justifyContent: 'center' },
  frame: { width: GOOGLE_SIGN_IN_WIDTH, height: SIGN_IN_BUTTON_HEIGHT },
  image: { width: GOOGLE_SIGN_IN_WIDTH, height: SIGN_IN_BUTTON_HEIGHT },
  // Logical start/marginStart: the spinner sits past the image's TRAILING edge in LTR and RTL alike.
  spinnerSlot: { position: 'absolute', top: 0, bottom: 0, start: '100%', marginStart: space.sm, justifyContent: 'center' },
});
