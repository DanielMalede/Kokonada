import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../theme';
import { space, radius, type as typography } from '../tokens';
import type { EmotionQuadrant } from '../tokens';

// A reusable "New" discovery marker. The difference a user perceives is the PRESENCE of the
// badge + the ✦ shape glyph + the word "New" — never hue alone (WCAG 2.2 AA, color-independent).
// Flat fill + one hairline border + one glyph, so it is free to render in a virtualized list.
//
// Compliance C4: it must not resemble the Spotify icon (no three-bar soundwave-in-circle) and
// must never use Spotify green — the ✦ glyph on the bioluminescent emotionAccent palette clears
// both. It imports no Spotify asset.
export interface DiscoveryBadgeProps {
  // The session's valence×arousal accent quadrant (static per session — never flickers per track).
  quadrant: EmotionQuadrant;
  // `accent` (default) wears the session emotionAccent; `neutral` is the calm grey future-History
  // variant (content.secondary + surface.hairline), color-independent by design.
  variant?: 'accent' | 'neutral';
  // In-row usage (default) is decorative — its meaning folds into the row's accessibilityLabel.
  // A standalone placement (e.g. a History detail) exposes its own "New discovery" label.
  standalone?: boolean;
}

export function DiscoveryBadge({ quadrant, variant = 'accent', standalone = false }: DiscoveryBadgeProps) {
  const { c } = useTheme();
  const accent = c.emotionAccent[quadrant];
  const isNeutral = variant === 'neutral';

  const inkColor = isNeutral ? c.content.secondary : accent.ink;      // glyph (the shape signal)
  const labelColor = isNeutral ? c.content.secondary : c.content.primary;
  const borderColor = isNeutral ? c.surface.hairline : accent.ink;
  const fill = isNeutral ? 'transparent' : accent.wash;

  const a11y = standalone
    ? { accessibilityRole: 'text' as const, accessibilityLabel: 'New discovery' }
    : { importantForAccessibility: 'no-hide-descendants' as const, accessibilityElementsHidden: true };

  return (
    <View testID="discovery-badge" {...a11y} style={[styles.pill, { backgroundColor: fill, borderColor }]}>
      <Text testID="discovery-badge-glyph" style={[styles.glyph, { color: inkColor }]}>✦</Text>
      <Text testID="discovery-badge-label" style={[styles.label, { color: labelColor }]}>New</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    gap: space.xs,
  },
  glyph: { fontSize: typography.size.caption, fontWeight: typography.weight.semibold },
  label: { fontSize: typography.size.caption, fontWeight: typography.weight.semibold },
});
