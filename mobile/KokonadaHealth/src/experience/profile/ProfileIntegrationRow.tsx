import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../../design/theme';
import { space, type as typography } from '../../design/tokens';
import { ProviderGlyph } from '../connect/ProviderGlyph';

// §10 integration row — the same calm grammar for all four rows (Spotify · YouTube · Wearable ·
// Health data): [neutral glyph] [name + reason] ··· [status word + decorative ✓]. Color is never
// the sole signal — every state carries a status WORD; the success ✓ rides a decorative,
// a11y-hidden glyph. Contrast contract: names = content.primary, reason/status = content.secondary
// (both card-safe on surface.raised; content.tertiary is NOT used here).
//
// A status-only row (Wearable/Health/halted-or-deferred music) is one accessible group with a
// composed label. A row WITH an action (Reconnect/Disconnect) keeps the button separately focusable
// so the row is never one big disabled group — the action is a borderless text button (content
// .secondary), NOT an underlined link, sized ≥44/48dp via paddingVertical + hitSlop.

export interface RowAction {
  label: string;
  busyLabel?: string;
  testId: string; // stable selector; the human accessibilityLabel is composed (see below)
  onPress: () => void;
  busy?: boolean;
}

export interface ProfileIntegrationRowProps {
  label: string;
  reason: string;
  statusWord: string;
  connected: boolean;
  action?: RowAction;
}

export function ProfileIntegrationRow({ label, reason, statusWord, connected, action }: ProfileIntegrationRowProps) {
  const { c } = useTheme();

  const trailing = (
    <View style={styles.trailing} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {connected ? <Text style={[styles.check, { color: c.state.success }]}>✓</Text> : null}
      <Text style={[styles.statusWord, { color: c.content.secondary }]}>{statusWord}</Text>
    </View>
  );

  const glyphAndBody = (
    <>
      <ProviderGlyph label={label} />
      <View style={styles.body}>
        <Text style={[styles.name, { color: connected ? c.content.primary : c.content.secondary }]}>{label}</Text>
        <Text style={[styles.reason, { color: c.content.secondary }]}>{reason}</Text>
      </View>
    </>
  );

  // Interactive row: text + status stay visible; the action button is its own focusable control.
  // The status word is folded into the button's HUMAN accessibilityLabel (e.g. "Reconnect Spotify.
  // Connected.") so a screen reader announces the connection state on these rows — the trailing
  // status word is decorative/hidden here, so without this the state was never spoken. Selection
  // uses a stable testID (the button label is human, not a dev token).
  if (action) {
    const busy = !!action.busy;
    return (
      <View style={styles.row}>
        {glyphAndBody}
        {trailing}
        <Pressable
          onPress={action.onPress}
          disabled={busy}
          testID={action.testId}
          accessibilityRole="button"
          accessibilityLabel={`${action.label} ${label}. ${statusWord}.`}
          accessibilityState={{ disabled: busy }}
          hitSlop={space.sm}
          style={[styles.actionBtn, { opacity: busy ? 0.6 : 1 }]}
        >
          <Text style={[styles.actionLabel, { color: c.content.secondary }]}>{busy ? (action.busyLabel ?? action.label) : action.label}</Text>
        </Pressable>
      </View>
    );
  }

  // Status-only row: a single accessible group carrying a composed label.
  return (
    <View
      accessible
      accessibilityLabel={`${label}. ${statusWord}. ${reason}`}
      accessibilityState={{ disabled: !connected }}
      style={styles.row}
    >
      {glyphAndBody}
      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  body: { flex: 1, gap: space.xs },
  name: { fontSize: typography.size.body, fontWeight: typography.weight.semibold },
  reason: { fontSize: typography.size.footnote, lineHeight: typography.size.footnote * typography.leading.normal },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  statusWord: { fontSize: typography.size.caption, fontWeight: typography.weight.semibold },
  check: { fontSize: typography.size.caption, fontWeight: typography.weight.bold },
  // Borderless text action — retires the old grey underline; hit target ≥44dp via padding + hitSlop.
  actionBtn: { paddingVertical: space.md, paddingHorizontal: space.sm, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontSize: typography.size.footnote, fontWeight: typography.weight.semibold },
});
