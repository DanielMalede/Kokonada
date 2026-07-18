import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../design/theme';
import { space, radius, type as typography } from '../../design/tokens';

// The shared neutral provider mark — the service's initial in a tinted circle. NEVER an official
// colored logo/wordmark (compliance §4.7 supersede): a plain monochrome glyph belongs on setup
// chrome only; brand marks live on active playback/attribution surfaces. Decorative → a11y-hidden
// so the row's composed label carries the meaning. Reused by both §4 ProviderRow and §10
// ProfileIntegrationRow so the two setup surfaces stay visually identical.

export function ProviderGlyph({ label }: { label: string }) {
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

const styles = StyleSheet.create({
  glyph: { width: space['2xl'], height: space['2xl'], borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  glyphText: { fontSize: typography.size.callout, fontWeight: typography.weight.semibold },
});
