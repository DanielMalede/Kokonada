import React, { useEffect, useRef } from 'react';
import { Animated, View, Text, Pressable, StyleSheet, Easing, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme, useMotion } from '../theme';
import { space, radius, type as typography, motion } from '../tokens';
import type { EmotionQuadrant } from '../tokens';
import { SoftGlow } from '../../experience/aura/SoftGlow';

// "Never a dead end." An empty state is a calm, centred stack — a still (receding) glow halo, a
// title, a short body, and a SINGLE required action — so the user always has one clear way forward.
// The action is required at the type level, which makes a dead-end EmptyState unrepresentable.
// Tokens only: zero raw hex, zero magic numbers. The glow is STILL (SoftGlow, not BreathingGlow) so
// it recedes rather than pulling focus.

// The halo strength — dim enough to recede behind the message (a background field, not a beacon).
export const EMPTY_GLOW_OPACITY = 0.4;

const GLYPH_FIELD = space['4xl']; // 64 — the soft-glow field
const GLYPH_MARK = space.xl;      // 24 — the inner token-drawn mark
const ENTER_BEZIER = Easing.bezier(...motion.easing.enter);

export interface EmptyStateAction { label: string; onPress: () => void; }
export interface EmptyStateProps {
  title: string;
  body?: string;
  action: EmptyStateAction; // REQUIRED — a never-dead-end guarantee enforced by the type
  glyph?: React.ReactNode;
  tone?: 'brand' | 'quiet';
  accentQuadrant?: EmotionQuadrant; // only used by the quiet tone; 'intense' is violet, never red
  style?: StyleProp<ViewStyle>;
}

// The generic, token-drawn default mark — deliberately NOT a provider logo. A consumer passing a
// branded glyph owns that compliance surface (spec §3 compliance flag).
function DefaultGlyph({ color }: { color: string }) {
  return <View style={[styles.mark, { borderColor: color }]} />;
}

export function EmptyState({ title, body, action, glyph, tone = 'brand', accentQuadrant = 'calm', style }: EmptyStateProps) {
  const { c } = useTheme();
  const { reduced, duration } = useMotion();

  // Optional fade-in; reduced motion snaps to the end frame (opacity 1) with no animation. Opacity
  // only — layout never shifts, so motion and reduced are byte-identical.
  const entry = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) { entry.setValue(1); return; }
    entry.setValue(0);
    const anim = Animated.timing(entry, { toValue: 1, duration: duration.slow, easing: ENTER_BEZIER, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [reduced, duration.slow, entry]);

  const quiet = tone === 'quiet';
  const ctaLabelColor = quiet ? c.emotionAccent[accentQuadrant].ink : c.content.onAccent;
  // FILL is ALWAYS accent.glowInk when present — re-tinting it would break the onAccent AA proof.
  const ctaSurface = quiet ? { borderColor: c.content.tertiary } : { backgroundColor: c.accent.glowInk, borderColor: c.accent.glowInk };

  return (
    <Animated.View accessibilityLiveRegion="polite" style={[styles.root, { opacity: entry }, style]}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={styles.glyphWrap}>
        <View style={StyleSheet.absoluteFill}>
          <SoftGlow color={c.accent.glow} size={GLYPH_FIELD} opacity={EMPTY_GLOW_OPACITY} />
        </View>
        {glyph ?? <DefaultGlyph color={c.accent.glow} />}
      </View>

      <Text accessibilityRole="header" style={[styles.title, { color: c.content.primary }]}>{title}</Text>
      {body ? <Text style={[styles.body, { color: c.content.secondary }]}>{body}</Text> : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={action.label}
        onPress={action.onPress}
        style={[styles.cta, ctaSurface]}
      >
        <Text style={[styles.ctaText, { color: ctaLabelColor }]}>{action.label}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl },
  glyphWrap: { width: GLYPH_FIELD, height: GLYPH_FIELD, alignItems: 'center', justifyContent: 'center' },
  mark: { width: GLYPH_MARK, height: GLYPH_MARK, borderRadius: radius.pill, borderWidth: 2 },
  title: { marginTop: space.lg, fontSize: typography.size.subheading, fontWeight: typography.weight.semibold, textAlign: 'center' },
  body: { marginTop: space.lg, fontSize: typography.size.callout, lineHeight: typography.size.callout * typography.leading.normal, textAlign: 'center' },
  cta: {
    marginTop: space.xl,
    paddingVertical: space.lg,
    paddingHorizontal: space.xl,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: { fontSize: typography.size.body, fontWeight: typography.weight.semibold },
});
