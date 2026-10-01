import React, { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../design/theme';
import { space, type as typography } from '../design/tokens';
import {
  PRIVACY_POLICY_URL,
  PRIVACY_POLICY_LABEL,
  PRIVACY_POLICY_HINT,
  PRIVACY_POLICY_OPEN_FAILED,
} from './legalLinks';

// The privacy-policy link (HX-5; designer direction Part 2, compliance brief M5). One quiet,
// underlined text link, the same on every screen that carries it: callers own its alignment and
// margin, never its look. It is a link, not a button: it leaves the app for the browser, and it is
// a disclosure, not a commit (no motion, no haptic). It never frames the policy as something to
// agree to. If the browser cannot be opened, the reason and the address appear beneath it as
// selectable text, so the link is never a dead end.

export interface PrivacyPolicyLinkProps {
  // The consent sheet makes it inert while a grant is being recorded.
  disabled?: boolean;
}

export function PrivacyPolicyLink({ disabled = false }: PrivacyPolicyLinkProps) {
  const { c } = useTheme();
  const [openFailed, setOpenFailed] = useState(false);

  const onPress = () => {
    if (disabled) return;
    // Wrapped so that a synchronous throw and a rejection take the same path, and neither escapes.
    Promise.resolve()
      .then(() => Linking.openURL(PRIVACY_POLICY_URL))
      .then(() => setOpenFailed(false), () => setOpenFailed(true));
  };

  const colour = (pressed: boolean) =>
    disabled ? c.content.tertiary : pressed ? c.content.primary : c.content.secondary;

  return (
    <>
      <Pressable
        testID="privacy-policy-link"
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="link"
        accessibilityLabel={PRIVACY_POLICY_LABEL}
        accessibilityHint={PRIVACY_POLICY_HINT}
        accessibilityState={{ disabled }}
        style={styles.target}
      >
        {({ pressed }) => (
          <Text style={[styles.label, { color: colour(pressed) }]}>{PRIVACY_POLICY_LABEL}</Text>
        )}
      </Pressable>
      {openFailed ? (
        <View testID="privacy-policy-open-failed" style={styles.fallback}>
          <Text accessibilityLiveRegion="polite" style={[styles.fallbackText, { color: c.content.secondary }]}>
            {PRIVACY_POLICY_OPEN_FAILED}
          </Text>
          <Text testID="privacy-policy-address" selectable style={[styles.fallbackText, { color: c.content.primary }]}>
            {PRIVACY_POLICY_URL}
          </Text>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  // A real 48 x 48 box in the layout (no hitSlop), so it never reaches over a neighbour's target.
  target: { minHeight: space['3xl'], minWidth: space['3xl'], paddingHorizontal: space.none, justifyContent: 'center', alignItems: 'center' },
  label: {
    fontSize: typography.size.footnote,
    fontWeight: typography.weight.regular,
    lineHeight: typography.size.footnote * typography.leading.normal,
    letterSpacing: typography.tracking.body,
    textDecorationLine: 'underline',
  },
  fallback: { gap: space.xs, paddingBottom: space.xs },
  fallbackText: { fontSize: typography.size.footnote, lineHeight: typography.size.footnote * typography.leading.normal },
});
