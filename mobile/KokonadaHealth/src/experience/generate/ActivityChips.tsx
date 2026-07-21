import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSelector, useDispatch } from 'react-redux';
import { setActivity } from '../../state/cold/emotionSlice';
import { ACTIVITIES } from './activities';
import { AuroraGradientFill } from '../aurora/AuroraGradientFill';
import { useTheme } from '../../design/theme';
import { auroraGlow } from '../../design/emotionAccent';
import { CTA_INK } from '../../design/auroraSurfaces';
import { colors, space, radius, type as typography } from '../../design/tokens';

// Single-select activity chips below the wheel. Re-tapping the active chip clears it (toggle off →
// null). Writes straight to the cold lane, so the committed value rides the existing emotion_update
// payload. AURORA: the SELECTED chip wears the premium aurora → gold gradient with the deep indigo ink
// that clears AA-normal across that whole fill; the IDLE chip is a quiet frosted-glass surface with a
// muted label (AA over the moving aurora because RN degrades the glass to the opaque glassFallback).
// Distinction is never colour alone — accent outline + gradient + accessibilityState.selected — and
// every target is ≥44dp (space['3xl'] = 48).
const CHIP_GOLD = colors.dark.accent.gold;         // #F5B93A — the gold signature (shared by both faces)
const CHIP_STOPS = [auroraGlow(0, 0), CHIP_GOLD] as const; // neutral aurora → premium gold
const CHIP_INK = CTA_INK.dark;                      // #241B45 — AA-normal over the entire aurora→gold fill

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
                backgroundColor: active ? CHIP_GOLD : c.surface.glassFallback,
                borderColor: active ? c.accent.glow : c.surface.hairline,
              },
            ]}
          >
            {active ? <AuroraGradientFill colors={CHIP_STOPS} /> : null}
            <Text style={[styles.label, { color: active ? CHIP_INK : c.content.muted }]}>
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
    overflow: 'hidden', // clip the selected gradient fill to the pill
  },
  label: { fontSize: typography.size.footnote, fontWeight: typography.weight.medium },
});
