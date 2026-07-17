import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSelector, useDispatch } from 'react-redux';
import { setActivity } from '../../state/cold/emotionSlice';
import { ACTIVITIES } from './activities';
import { useTheme } from '../../design/theme';
import { space, radius, type as typography } from '../../design/tokens';

// Single-select activity chips below the wheel. Re-tapping the active chip clears it (toggle off
// → null). Writes straight to the cold lane, so the committed value rides the existing
// emotion_update payload. Fully tokenised (light + dark): the active chip is distinguished beyond
// hue — an accent outline + wash fill + accessibilityState.selected — so colour is never the sole
// signal, and every target is ≥44dp (space['3xl'] = 48).
export function ActivityChips() {
  const dispatch = useDispatch();
  const { c } = useTheme();
  const selected = useSelector((s: any) => s.emotion.activity as string | null);

  return (
    <View style={styles.row}>
      {ACTIVITIES.map((a) => {
        const active = selected === a.key;
        return (
          <Pressable
            key={a.key}
            testID={`activity-chip-${a.key}`}
            accessibilityRole="button"
            accessibilityLabel={a.label}
            accessibilityState={{ selected: active }}
            onPress={() => dispatch(setActivity(active ? null : a.key))}
            style={[
              styles.chip,
              {
                backgroundColor: active ? c.emotionAccent.calm.wash : c.surface.raised,
                borderColor: active ? c.accent.glow : c.surface.hairline,
              },
            ]}
          >
            <Text style={[styles.label, { color: active ? c.content.primary : c.content.secondary }]}>
              {a.emoji} {a.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, justifyContent: 'center', paddingHorizontal: space.lg },
  chip: {
    minHeight: space['3xl'], // 48dp ≥ 44 target
    justifyContent: 'center',
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  label: { fontSize: typography.size.footnote, fontWeight: typography.weight.medium },
});
