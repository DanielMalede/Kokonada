import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../../design/theme';
import { space, radius, type as typography } from '../../design/tokens';
import type { Provider } from './providers';

// One music provider, rendered as a SINGLE accessible group: [glyph] [name + reason] ··· [status].
// The row's effective state is `connected` (from /api/integrations/status) if present, else the
// registry state. Halted and deferred share the SAME calm, action-less visual language — the only
// difference is the honest status word + reason (temporal expectation lives in words, never hue).
// Color is never the sole signal: every state carries a status WORD (+ a decorative glyph).
//
// Contrast contract (§0.4): inside a raised card, meaningful text is content.primary/secondary only
// (content.tertiary and bare state.* are NOT card-safe). So the "Connected" WORD is content.primary
// (AA on raised) and the success color rides on the decorative, a11y-hidden check glyph instead.

type DisplayState = 'connected' | 'enabled' | 'deferred' | 'halted';

const STATUS_WORD: Record<Exclude<DisplayState, 'enabled'>, string> = {
  connected: 'Connected',
  deferred: 'Not yet available',
  halted: 'Unavailable',
};
const CONNECTED_REASON = 'Playing your library.';

// A neutral monochrome mark — the provider's initial in a tinted circle. NEVER an official
// colored logo/wordmark (compliance): plain glyph on setup chrome only. Decorative → a11y-hidden.
function ProviderGlyph({ label }: { label: string }) {
  const { c } = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.glyph, { backgroundColor: c.surface.overlay }]}
    >
      <Text style={[styles.glyphText, { color: c.content.secondary }]}>{label.charAt(0)}</Text>
    </View>
  );
}

export interface ProviderRowProps {
  provider: Provider;
  connected?: boolean;
  onConnect?: () => void; // used ONLY by the (future) enabled state
}

export function ProviderRow({ provider, connected = false, onConnect }: ProviderRowProps) {
  const { c } = useTheme();
  const state: DisplayState = connected ? 'connected' : (provider.state as DisplayState);
  const reason = state === 'connected' ? CONNECTED_REASON : provider.why;

  // The enabled state is the only interactive row — its Connect pill is the focusable control, so
  // the row is not one big disabled group. (No music provider is enabled today; kept for the future.)
  if (state === 'enabled') {
    return (
      <View style={styles.row}>
        <ProviderGlyph label={provider.label} />
        <View style={styles.body}>
          <Text style={[styles.name, { color: c.content.primary }]}>{provider.label}</Text>
          <Text style={[styles.reason, { color: c.content.secondary }]}>{reason}</Text>
        </View>
        <Pressable
          testID={`provider-row-${provider.id}`}
          onPress={onConnect}
          accessibilityRole="button"
          accessibilityLabel={`connect-${provider.id}`}
          hitSlop={space.sm}
          style={[styles.connectPill, { borderColor: c.content.secondary }]}
        >
          <Text style={[styles.connectWord, { color: c.content.primary }]}>Connect</Text>
        </Pressable>
      </View>
    );
  }

  const statusWord = STATUS_WORD[state];
  const composedLabel = `${provider.label}. ${statusWord}. ${reason}`;

  return (
    <View
      testID={`provider-row-${provider.id}`}
      accessible
      accessibilityLabel={composedLabel}
      accessibilityState={{ disabled: state !== 'connected' }}
      style={styles.row}
    >
      <ProviderGlyph label={provider.label} />
      <View style={styles.body}>
        <Text style={[styles.name, { color: state === 'connected' ? c.content.primary : c.content.secondary }]}>
          {provider.label}
        </Text>
        <Text style={[styles.reason, { color: c.content.secondary }]}>{reason}</Text>
      </View>
      <View style={styles.trailing} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {state === 'connected' ? (
          <Text style={[styles.checkGlyph, { color: c.state.success }]}>✓</Text>
        ) : null}
        <Text style={[styles.statusWord, { color: c.content.secondary }]}>{statusWord}</Text>
      </View>
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
  checkGlyph: { fontSize: typography.size.caption, fontWeight: typography.weight.bold },
  connectPill: { paddingVertical: space.sm, paddingHorizontal: space.lg, borderRadius: radius.pill, borderWidth: 1.5, minHeight: space['2xl'], alignItems: 'center', justifyContent: 'center' },
  connectWord: { fontSize: typography.size.body, fontWeight: typography.weight.semibold },
  glyph: { width: space['2xl'], height: space['2xl'], borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  glyphText: { fontSize: typography.size.callout, fontWeight: typography.weight.semibold },
});
