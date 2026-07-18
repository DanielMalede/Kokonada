import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../../design/theme';
import { space, radius, type as typography, elevation, type HapticKey } from '../../design/tokens';
import { fireHaptic } from '../../design/haptics';
import { HEALTH_CONNECT_DATA_CATEGORIES } from '../../health/consentApi';
import { WhyAccordion } from '../connect/WhyAccordion';

// §10 Health-data VAULT panel. Three jobs on one calm surface: (1) a trust summary, (2) the
// "what we read, and why" disclosure — its list mirrors the ON-DEVICE Health Connect read set
// exactly (HEALTH_CONNECT_DATA_CATEGORIES), while the FULL legal document (incl. the Garmin-only
// categories) stays ONLY in the reused-unchanged §11 ConsentSheet — and (3) the consent WITHDRAWAL
// right, echoing §11's neutral treatment. Withdrawal is a RIGHT, not destruction: NEUTRAL brand
// (accent.glowInk), never state.danger — that hue is reserved for account deletion.
//
// STATIC trust surface — FIXED brand accent only, NEVER a reactive emotion re-tint.

// Friendly labels for the on-device read set (the five Health Connect categories the OS actually
// reads). Derived from HEALTH_CONNECT_DATA_CATEGORIES so this summary can never drift from what is
// requested; final wording is placeholder pending legal.
const READ_LABELS: Record<(typeof HEALTH_CONNECT_DATA_CATEGORIES)[number], string> = {
  heart_rate: 'Heart rate',
  hrv: 'Heart-rate variability (HRV)',
  sleep: 'Sleep',
  resting_heart_rate: 'Resting heart rate',
  historical_access_182d: 'Historical readings (up to ~6 months back)',
};
const WHAT_WE_READ_BODY = HEALTH_CONNECT_DATA_CATEGORIES.map((k) => `• ${READ_LABELS[k]}`).join('\n');

export interface VaultConsentPanelProps {
  consentGranted: boolean;
  syncing: boolean;
  withdrawing: boolean;
  onSync: () => void;
  onWithdraw: () => void;
  triggerHaptic?: (key: HapticKey) => void;
}

export function VaultConsentPanel({ consentGranted, syncing, withdrawing, onSync, onWithdraw, triggerHaptic = fireHaptic }: VaultConsentPanelProps) {
  const { c } = useTheme();
  const [confirming, setConfirming] = useState(false);

  const onWithdrawPress = () => { triggerHaptic('commit'); onWithdraw(); };

  return (
    <View style={[styles.card, elevation.e1, { backgroundColor: c.surface.raised }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: c.content.primary }]}>Health data</Text>
      <Text style={[styles.caption, { color: c.content.secondary }]}>Your body, read only with your say-so.</Text>

      <WhyAccordion title="What we read, and why" body={WHAT_WE_READ_BODY} />

      {/* Permission status — a WORD carries the meaning; the ✓ is decorative. Not-granted is a
          neutral note, never red (there is nothing wrong with mood-only). */}
      <View style={styles.statusRow}>
        {consentGranted ? (
          <Text accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.check, { color: c.state.success }]}>✓</Text>
        ) : null}
        <Text style={[styles.statusWord, { color: c.content.secondary }]}>
          {consentGranted ? 'Consent on file — personalising with your body’s signals.' : 'Not connected yet — you’re in mood-only mode.'}
        </Text>
      </View>

      <Pressable
        onPress={onSync}
        disabled={syncing}
        accessibilityRole="button"
        accessibilityLabel="sync-health"
        accessibilityState={{ disabled: syncing }}
        style={[styles.syncCta, { backgroundColor: c.accent.glowInk, opacity: syncing ? 0.6 : 1 }]}
      >
        <Text style={[styles.syncLabel, { color: c.content.onAccent }]}>{syncing ? 'Syncing…' : 'Sync now'}</Text>
      </Pressable>

      {/* Withdrawal — shown only when a grant is on file. Two-step, echoing §11's neutral confirm. */}
      {consentGranted ? (
        !confirming ? (
          <Pressable
            onPress={() => setConfirming(true)}
            disabled={withdrawing}
            accessibilityRole="button"
            accessibilityLabel="withdraw-consent"
            hitSlop={space.sm}
            style={styles.withdrawLink}
          >
            <Text style={[styles.withdrawLinkText, { color: c.content.secondary }]}>Withdraw health-data consent</Text>
          </Pressable>
        ) : (
          <View style={styles.confirm}>
            <Text accessibilityRole="header" style={[styles.confirmTitle, { color: c.content.primary }]}>Withdraw consent to health-data processing?</Text>

            <View style={styles.microSection}>
              <Text accessibilityRole="header" style={[styles.microHeading, { color: c.content.primary }]}>Your controls</Text>
              <Text style={[styles.microBody, { color: c.content.secondary }]}>
                Consent is optional — the app keeps working in mood-only mode. You can turn it back on anytime from here.
              </Text>
            </View>
            <View style={styles.microSection}>
              <Text accessibilityRole="header" style={[styles.microHeading, { color: c.content.primary }]}>How long we keep it</Text>
              <Text style={[styles.microBody, { color: c.content.secondary }]}>
                Withdrawing stops biometric personalisation and erases the health data held across your connected wearables.
              </Text>
            </View>

            {/* Equal-weight action bar (§11 geometry): identical box, only the fill differs. Both
                are NEUTRAL — withdrawal is a right, not a danger. */}
            <View style={styles.actionBar}>
              <Pressable
                onPress={() => setConfirming(false)}
                disabled={withdrawing}
                accessibilityRole="button"
                accessibilityLabel="withdraw-cancel"
                style={[styles.barBtn, { borderColor: c.content.tertiary, opacity: withdrawing ? 0.5 : 1 }]}
              >
                <Text style={[styles.barBtnText, { color: c.content.primary }]}>Keep it</Text>
              </Pressable>
              <Pressable
                onPress={onWithdrawPress}
                disabled={withdrawing}
                accessibilityRole="button"
                accessibilityLabel="withdraw-confirm"
                accessibilityState={{ disabled: withdrawing }}
                style={[styles.barBtn, { backgroundColor: c.accent.glowInk, borderColor: c.accent.glowInk, opacity: withdrawing ? 0.6 : 1 }]}
              >
                <Text style={[styles.barBtnText, { color: c.content.onAccent }]}>Withdraw</Text>
              </Pressable>
            </View>
          </View>
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, padding: space.lg, gap: space.md },
  title: { fontSize: typography.size.subheading, fontWeight: typography.weight.semibold },
  caption: { fontSize: typography.size.footnote, lineHeight: typography.size.footnote * typography.leading.normal },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  check: { fontSize: typography.size.caption, fontWeight: typography.weight.bold },
  statusWord: { flex: 1, fontSize: typography.size.footnote, lineHeight: typography.size.footnote * typography.leading.normal },
  syncCta: { width: '100%', paddingVertical: space.lg, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  syncLabel: { fontSize: typography.size.body, fontWeight: typography.weight.semibold },
  withdrawLink: { paddingVertical: space.md },
  withdrawLinkText: { fontSize: typography.size.footnote, fontWeight: typography.weight.semibold },
  confirm: { gap: space.md, padding: space.lg, borderRadius: radius.lg, backgroundColor: 'transparent' },
  confirmTitle: { fontSize: typography.size.callout, fontWeight: typography.weight.semibold },
  microSection: { gap: space.xs },
  microHeading: { fontSize: typography.size.footnote, fontWeight: typography.weight.semibold },
  microBody: { fontSize: typography.size.footnote, lineHeight: typography.size.footnote * typography.leading.normal },
  actionBar: { flexDirection: 'row', gap: space.md, paddingTop: space.xs },
  barBtn: { flex: 1, paddingVertical: space.lg, borderRadius: radius.pill, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  barBtnText: { fontSize: typography.size.body, fontWeight: typography.weight.semibold },
});
