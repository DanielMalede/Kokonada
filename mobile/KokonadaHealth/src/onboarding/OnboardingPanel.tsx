import React from 'react';
import { Animated, Text, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../design/theme';
import { space, type as typography } from '../design/tokens';

// One full-bleed panel: a decorative hero fills the upper ~60%, ONE copy line sits below.
// Near-wordless, token-only, centered. The hero is passed in as children so each panel can
// carry a different aura; the optional parallax transform lets the hero drift slower than
// the copy as the carousel swipes (OFF under reduced motion — the parent passes nothing).
//
// The copy's maxWidth follows SignInScreen's subtitle precedent (a comfortable measure).
const COPY_MAX_WIDTH = 300;
const HERO_FLEX = 3; // ~60% of the panel height
const COPY_FLEX = 2; // ~40%

export function OnboardingPanel({
  width,
  copy,
  children,
  heroStyle,
}: {
  width: number;
  copy: string;
  children: React.ReactNode;
  heroStyle?: StyleProp<ViewStyle>;
}) {
  const { c } = useTheme();
  return (
    <Animated.View style={[styles.panel, { width }]}>
      {/* heroZone (top ~60%) and copyZone (bottom ~40%) are DISJOINT siblings — the aura
          lives here, the copy there, so the bright glow core never sits behind the text. */}
      <Animated.View testID="onboarding-hero-zone" style={[styles.heroZone, heroStyle]}>{children}</Animated.View>
      <Animated.View testID="onboarding-copy-zone" style={styles.copyZone}>
        <Text
          style={{
            fontSize: typography.size.title,
            fontWeight: typography.weight.semibold,
            letterSpacing: typography.tracking.heading,
            color: c.content.primary,
            textAlign: 'center',
            maxWidth: COPY_MAX_WIDTH,
            lineHeight: typography.size.title * typography.leading.snug,
          }}
        >
          {copy}
        </Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1, paddingHorizontal: space.xl },
  heroZone: { flex: HERO_FLEX, alignItems: 'center', justifyContent: 'center' },
  copyZone: { flex: COPY_FLEX, alignItems: 'center', justifyContent: 'flex-start', paddingTop: space.xl },
});
