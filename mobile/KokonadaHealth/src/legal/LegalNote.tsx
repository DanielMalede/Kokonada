import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../design/theme';
import { textScrimFill } from '../design/auroraSurfaces';
import { space, radius, type as typography } from '../design/tokens';
import type { LegalLine } from './legalCopy';

// The ONE primitive every interim legal line renders through, so the three surfaces cannot drift.
// It owns every colour and type value and takes no style/colour/tone prop: callers wrap it in their
// own View for width and margin, and nothing a caller holds (an emotion, an inferred state) can
// tint it. A quiet band on the AA-proven text scrim (legalContrast.test.ts proves content.secondary
// on it over every aurora, aura and canvas backdrop), one Text node per line so each line is one
// screen-reader utterance, font scaling on, never truncated, never dismissible, and no motion.
// Only useTheme() — no motion or keyboard subscription that could leak.
export function LegalNote({ lines }: { lines: readonly LegalLine[] }) {
  const { name, c } = useTheme();
  return (
    <View testID="legal-note" style={[styles.band, { backgroundColor: textScrimFill(c, name) }]}>
      {lines.map((line) => (
        <Text key={line} allowFontScaling style={[styles.line, { color: c.content.secondary }]}>
          {line}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  band: { paddingVertical: space.sm, paddingHorizontal: space.lg, borderRadius: radius.md, gap: space.sm },
  line: {
    fontSize: typography.size.body,
    fontWeight: typography.weight.regular,
    lineHeight: typography.size.body * typography.leading.normal,
    letterSpacing: typography.tracking.body,
    textAlign: 'center',
  },
});
