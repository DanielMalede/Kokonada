import React, { useEffect, useRef, useState } from 'react';
import { Animated, View, Text, Pressable, StyleSheet, Easing, LayoutAnimation, Platform, UIManager } from 'react-native';
import { useTheme, useMotion } from '../../design/theme';
import { space, radius, type as typography, motion } from '../../design/tokens';

// The "why we ask" disclosure (§3). A DISCLOSURE, not a commit — no haptic. Collapsed by default;
// a button header (a11y label = title, accessibilityState.expanded) toggles the honest reason body.
// Motion: body opacity cross-fade (native driver) + a height LayoutAnimation in lockstep, and a
// chevron rotate. Under reduced motion it toggles INSTANTLY with a byte-identical expanded layout
// (the same body renders — only the transition is skipped). Contrast: body is content.secondary,
// card-safe (never content.tertiary inside a raised card).

const EXPAND_BEZIER = Easing.bezier(...motion.easing.calm);
const COLLAPSE_BEZIER = Easing.bezier(...motion.easing.exit);

// Android needs LayoutAnimation explicitly enabled; guarded so a missing UIManager never throws.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

function Chevron({ rotate, color }: { rotate: Animated.AnimatedInterpolation<string> | string; color: string }) {
  return (
    <Animated.Text
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.chevron, { color, transform: [{ rotate }] }]}
    >
      ⌄
    </Animated.Text>
  );
}

export interface WhyAccordionProps {
  title: string;
  body: string;
}

export function WhyAccordion({ title, body }: WhyAccordionProps) {
  const { c } = useTheme();
  const { reduced, duration } = useMotion();
  const [expanded, setExpanded] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced) {
      opacity.setValue(expanded ? 1 : 0);
      spin.setValue(expanded ? 1 : 0);
      return;
    }
    const anim = Animated.parallel([
      Animated.timing(opacity, {
        toValue: expanded ? 1 : 0,
        duration: duration.base,
        easing: expanded ? EXPAND_BEZIER : COLLAPSE_BEZIER,
        useNativeDriver: true,
      }),
      Animated.timing(spin, {
        toValue: expanded ? 1 : 0,
        duration: duration.base,
        easing: expanded ? EXPAND_BEZIER : COLLAPSE_BEZIER,
        useNativeDriver: true,
      }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [expanded, reduced, duration.base, opacity, spin]);

  const toggle = () => {
    if (!reduced) {
      LayoutAnimation.configureNext({
        duration: duration.base,
        update: { type: LayoutAnimation.Types.easeInEaseOut },
      });
    }
    setExpanded((v) => !v);
  };

  const rotate = reduced
    ? (expanded ? '180deg' : '0deg')
    : spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });

  return (
    <View style={[styles.wrap, { backgroundColor: c.surface.overlay }]}>
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded }}
        style={styles.header}
      >
        <Text style={[styles.title, { color: c.content.primary }]}>{title}</Text>
        <Chevron rotate={rotate} color={c.content.secondary} />
      </Pressable>
      {expanded ? (
        <Animated.View style={{ opacity }}>
          <Text style={[styles.body, { color: c.content.secondary }]}>{body}</Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: radius.md, paddingHorizontal: space.md },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: space['3xl'], paddingVertical: space.md },
  title: { flex: 1, fontSize: typography.size.footnote, fontWeight: typography.weight.semibold },
  chevron: { fontSize: typography.size.body, marginLeft: space.sm },
  body: { fontSize: typography.size.footnote, lineHeight: typography.size.footnote * typography.leading.normal, paddingTop: space.sm, paddingBottom: space.md },
});
