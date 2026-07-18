import React, { useRef, useState } from 'react';
import { Animated, View, Text, Pressable, StyleSheet, Easing } from 'react-native';
import { useTheme, useMotion } from '../../design/theme';
import { space, radius, type as typography, elevation, motion } from '../../design/tokens';
import { SourceGlyph } from './SourceGlyph';
import { friendlyTitle, inferSource, metaLine, relativeTime, rowA11yLabel } from './historyFormat';
import type { SessionItem } from './sessionsApi';

// §9 History — one moment, as a calm material card. The moment is content; chrome recedes. The WHOLE
// card is a single accessible button (children not focusable) carrying a composed spoken label. Two
// tiers only: a friendly title (never a raw moodKey) + one meta line "Live · Running", with the
// relative time trailing. A leading token-drawn medallion signals Manual/Live by SHAPE (WCAG 1.4.1).
// Rows are surface.raised → ONLY content.primary/secondary (tertiary is AA on base only). Memoized like
// UpNextRow so an unrelated feed change never re-renders a row. Tokens only; zero raw hex/px.

// The press micro-scale — a design value with no design token (the UpNextRow CURSOR_RAIL precedent).
// Motion only: reduced motion drops the scale and keeps just the reduced-safe fill shift.
export const PRESS_SCALE = 0.985;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const ENTER_BEZIER = Easing.bezier(...motion.easing.enter);
const MEDALLION = space['2xl']; // 32 — the leading source medallion

export interface HistoryRowProps {
  item: SessionItem;
  now: Date;
  onPress: (item: SessionItem) => void;
}

function HistoryRowBase({ item, now, onPress }: HistoryRowProps) {
  const { c } = useTheme();
  const { reduced, duration } = useMotion();
  const [pressed, setPressed] = useState(false);
  const scale = useRef(new Animated.Value(1)).current;

  const source = inferSource(item);
  const title = friendlyTitle(item);
  const meta = metaLine(item);
  const time = relativeTime(item.createdAt, now);

  const animateScale = (to: number) => {
    if (reduced) return; // reduced: fill shift only, no transform
    Animated.timing(scale, { toValue: to, duration: duration.fast, easing: ENTER_BEZIER, useNativeDriver: true }).start();
  };
  const onPressIn = () => { setPressed(true); animateScale(PRESS_SCALE); };
  const onPressOut = () => { setPressed(false); animateScale(1); };

  return (
    <AnimatedPressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={rowA11yLabel(item, now)}
      accessibilityHint="Opens this moment to replay its soundtrack."
      onPress={() => onPress(item)}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={[
        styles.card,
        elevation.e1,
        { backgroundColor: pressed ? c.surface.overlay : c.surface.raised, transform: [{ scale }] },
      ]}
    >
      <View testID="history-medallion" style={[styles.medallion, { backgroundColor: c.surface.overlay }]}>
        <SourceGlyph source={source} />
      </View>
      <View style={styles.textCol}>
        <Text numberOfLines={2} style={[styles.title, { color: c.content.primary }]}>{title}</Text>
        <Text numberOfLines={1} style={[styles.meta, { color: c.content.secondary }]}>{meta}</Text>
      </View>
      <Text numberOfLines={1} style={[styles.time, { color: c.content.secondary }]}>{time}</Text>
    </AnimatedPressable>
  );
}

// Memoized: the feed passes stable items + a stable onPress + a per-mount-stable `now`, so scrolling
// never re-renders a row that did not change (the UpNextRow V2 precedent).
export const HistoryRow = React.memo(HistoryRowBase);

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderRadius: radius.lg,
    padding: space.lg, // min-height derives from padding + medallion (≥48dp), never a fixed height
    overflow: 'hidden',
  },
  medallion: { width: MEDALLION, height: MEDALLION, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  textCol: { flex: 1, gap: space.xs },
  title: { fontSize: typography.size.body, fontWeight: typography.weight.semibold },
  meta: { fontSize: typography.size.footnote, fontWeight: typography.weight.medium },
  time: { fontSize: typography.size.caption, fontWeight: typography.weight.regular, textAlign: 'right' },
});
