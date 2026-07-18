import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSelector } from 'react-redux';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useTheme } from '../design/theme';
import { space, radius, type as typography, type HapticKey } from '../design/tokens';
import { fireHaptic } from '../design/haptics';
import { emotionAccentFor } from '../design/emotionAccent';
import { TabIcon } from './TabIcon';
import { TAB_LABELS, type TabRoute } from './tabRoutes';

// The bottom-tab CHROME. It — not the screens — owns the reactive emotion subscription: a
// DERIVED-PRIMITIVE selector that returns only the quadrant STRING, so the bar re-renders when the
// user's committed lean crosses a quadrant, never per tap, and the five heavy screens never
// re-render on an emotion change. A fresh session reads `calm` (emotionAccentFor self-defaults), so
// the app wears the brand accent out of the box — no fallback branch.
//
// Active tab  = filled Skia glyph + label, both in emotionAccent[q].ink, semibold, over a soft
//               wash lozenge (all AA-proven on surface.base — see EmotionTabBar.test contrast pin).
// Inactive    = outline glyph + label, both content.secondary, medium, no lozenge.
// Active/inactive is signalled by SHAPE (fill vs outline) + WEIGHT + the lozenge + the accent hue +
// accessibilityState.selected — colour is never the sole cue. haptics.selection fires on CHANGE only.
//
// The tint swaps instantly (which is exactly the mandated reduced-motion behaviour); the optional
// 240ms non-reduced ink/wash crossfade is a device-verified follow-up (it must animate the Skia
// glyph colour on the UI thread via the NeuralAnalysisLoader useDerivedValue pattern, which is not
// observable under the jest reanimated/skia stubs — so it is intentionally not built untested here).

export type EmotionTabBarProps = BottomTabBarProps & {
  triggerHaptic?: (key: HapticKey) => void;
};

export function EmotionTabBar({ state, navigation, triggerHaptic = fireHaptic }: EmotionTabBarProps) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const quadrant = useSelector((s: { emotion: { taps: { x: number; y: number }[] } }) => emotionAccentFor(s.emotion.taps));
  const accent = c.emotionAccent[quadrant];

  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.bar,
        { backgroundColor: c.surface.base, borderTopColor: c.surface.hairline, paddingBottom: space.sm + insets.bottom },
      ]}
    >
      {state.routes.map((route, index) => {
        const name = route.name as TabRoute;
        const focused = state.index === index;
        const tint = focused ? accent.ink : c.content.secondary;

        const onPress = () => {
          // v7 tabPress guard: honour a preventDefault, and only ACT on a real change — that keeps
          // the selection haptic + navigate off a re-press of the already-active tab.
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) {
            triggerHaptic('selection');
            navigation.navigate(route.name);
          }
        };

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={TAB_LABELS[name]}
            style={styles.tab}
          >
            {/* The lozenge padding is constant focused/unfocused, so only the fill toggles — zero
                layout shift. The wash alpha is baked into the hex (decorative, no AA burden). */}
            <View style={[styles.iconSlot, focused && { backgroundColor: accent.wash }]}>
              <TabIcon route={name} color={tint} filled={focused} />
            </View>
            <Text
              testID={`tab-label-${name}`}
              numberOfLines={1}
              style={[
                styles.label,
                { color: tint, fontWeight: focused ? typography.weight.semibold : typography.weight.medium },
              ]}
            >
              {TAB_LABELS[name]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // Opaque surface.base, a single top hairline — no glass, no drop shadow (the dock owns elevation).
  bar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.sm },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  iconSlot: { paddingVertical: space.xs, paddingHorizontal: space.sm, borderRadius: radius.pill },
  label: {
    fontSize: typography.size.caption,
    letterSpacing: typography.tracking.caption,
    marginTop: space.xs,
  },
});
