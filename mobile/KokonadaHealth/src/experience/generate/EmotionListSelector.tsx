import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { addTap, undoTap, clearTaps, type Tap } from '../../state/cold/emotionSlice';
import { useTheme } from '../../design/theme';
import { space, radius, type as typography } from '../../design/tokens';
import type { EmotionQuadrant } from '../../design/tokens';

// The REQUIRED text/list alternative to the Skia wheel (A11y). Four named emotional states — each
// a representative circumplex point committed through the SAME addTap path, so a screen-reader
// user produces an IDENTICAL taps payload (no new socket shape). Colour is never the sole signal:
// every item pairs a word + a descriptor + a shape glyph. Magnitude 0.55 clears the 0.15 deadzone
// so each preset lands squarely in its own quadrant.

export interface EmotionPreset {
  quadrant: EmotionQuadrant;
  label: string;
  descriptor: string;
  glyph: string;
  coord: Tap;
}

export const EMOTION_PRESETS: EmotionPreset[] = [
  { quadrant: 'calm', label: 'Calm', descriptor: 'settled and easy', glyph: '◐', coord: { x: 0.55, y: -0.55 } },
  { quadrant: 'joyful', label: 'Joyful', descriptor: 'bright and lifted', glyph: '☀', coord: { x: 0.55, y: 0.55 } },
  { quadrant: 'intense', label: 'Intense', descriptor: 'charged and strong', glyph: '◆', coord: { x: -0.55, y: 0.55 } },
  { quadrant: 'reflective', label: 'Reflective', descriptor: 'quiet and inward', glyph: '☾', coord: { x: -0.55, y: -0.55 } },
];

export function EmotionListSelector() {
  const dispatch = useDispatch();
  const { c } = useTheme();
  const count = useSelector((s: any) => (s.emotion.taps as Tap[]).length);

  return (
    <View style={styles.root} accessibilityLabel="Choose how you feel from a list">
      <Text style={[styles.heading, { color: c.content.secondary }]}>Choose how you feel</Text>
      {EMOTION_PRESETS.map((p) => (
        <Pressable
          key={p.quadrant}
          testID={`emotion-preset-${p.quadrant}`}
          accessibilityRole="button"
          accessibilityLabel={`${p.label} — ${p.descriptor}`}
          onPress={() => dispatch(addTap(p.coord))}
          style={[styles.item, { backgroundColor: c.surface.raised, borderColor: c.surface.hairline }]}
        >
          <Text testID={`emotion-preset-glyph-${p.quadrant}`} style={[styles.glyph, { color: c.emotionAccent[p.quadrant].ink }]}>
            {p.glyph}
          </Text>
          <View style={styles.itemText}>
            <Text style={[styles.itemLabel, { color: c.content.primary }]}>{p.label}</Text>
            <Text style={[styles.itemDescriptor, { color: c.content.secondary }]}>{p.descriptor}</Text>
          </View>
        </Pressable>
      ))}
      {count > 0 ? (
        <View style={styles.controls}>
          <Pressable
            testID="emotion-list-undo"
            accessibilityRole="button"
            accessibilityLabel="Undo last"
            onPress={() => dispatch(undoTap())}
            style={styles.control}
          >
            <Text style={[styles.controlLabel, { color: c.content.secondary }]}>↺ Undo</Text>
          </Pressable>
          <Pressable
            testID="emotion-list-clear"
            accessibilityRole="button"
            accessibilityLabel="Clear all"
            onPress={() => dispatch(clearTaps())}
            style={styles.control}
          >
            <Text style={[styles.controlLabel, { color: c.content.secondary }]}>Clear</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: '100%', paddingHorizontal: space.xl, gap: space.sm },
  heading: { fontSize: typography.size.footnote, fontWeight: typography.weight.semibold, letterSpacing: typography.tracking.caption },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: space['3xl'], // 48dp ≥ 44 target
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  glyph: { fontSize: typography.size.subheading, fontWeight: typography.weight.semibold, width: space.xl, textAlign: 'center' },
  itemText: { flex: 1 },
  itemLabel: { fontSize: typography.size.callout, fontWeight: typography.weight.semibold },
  itemDescriptor: { fontSize: typography.size.footnote },
  controls: { flexDirection: 'row', gap: space.lg, justifyContent: 'center' },
  control: { minHeight: space['3xl'], justifyContent: 'center', paddingHorizontal: space.md },
  controlLabel: { fontSize: typography.size.callout, fontWeight: typography.weight.medium },
});
