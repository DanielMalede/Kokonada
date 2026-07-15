import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  View,
  Text,
  Pressable,
  StyleSheet,
  Dimensions,
  Easing,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, useMotion } from '../design/theme';
import { space, radius, type as typography, motion, type HapticKey } from '../design/tokens';
import { fireHaptic } from '../design/haptics';
import { onboardingStore } from './onboardingStore';
import { OnboardingPanel } from './OnboardingPanel';
import { AuraHero } from './AuraHero';
import { PulseHero } from './PulseHero';
import { WheelTeaseHero } from './WheelTeaseHero';

// The FTUE: three full-bleed panels, one idea each, near-wordless. Horizontal, paging
// swipe (interruptible). Skip (top-right, persistent) bypasses to Sign-in; Continue
// advances; on the last panel it becomes "Begin" (the one terminal moment with a haptic).
// Both exits call onComplete → markSeen, so the App route machine flips to Sign-in (never
// back to Onboarding). Every motion is token-driven and stills under reduced motion; the
// layout is byte-identical either way, so swipe always works.

const PANEL_COUNT = 3;
const HERO_FRACTION = 0.7;     // hero size vs the viewport width (proportional)
const DOT_ACTIVE_WIDTH = space.lg; // the active dot widens into a pill (shape encodes state)
const PARALLAX_FRACTION = 0.2; // hero drifts at a fraction of the swipe (slower than copy)
const CTA_MAX_WIDTH = 360;     // matches the SignInScreen primary-button measure (precedent)
const LAST = PANEL_COUNT - 1;
const ENTER_BEZIER = Easing.bezier(...motion.easing.enter);
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const COPY = ['Feel it.', 'Your body is heard.', 'Your soundtrack, tuned to you.'];

export function OnboardingScreen({
  onComplete = () => onboardingStore.getState().markSeen(),
  triggerHaptic = fireHaptic,
}: {
  onComplete?: () => void;
  triggerHaptic?: (key: HapticKey) => void;
} = {}) {
  const { c } = useTheme();
  const { reduced, duration } = useMotion();
  const insets = useSafeAreaInsets();
  const width = Dimensions.get('window').width;
  const heroSize = width * HERO_FRACTION;

  const [page, setPage] = useState(0);
  const [beginReady, setBeginReady] = useState(false);
  const scrollX = useRef(new Animated.Value(0)).current;
  const beginFade = useRef(new Animated.Value(0)).current;
  const listRef = useRef<any>(null);

  // "Begin" fades in once the wheel-tease dot has settled AND we are on the last panel.
  useEffect(() => {
    if (!(beginReady && page === LAST)) return;
    const anim = Animated.timing(beginFade, { toValue: 1, duration: duration.base, easing: ENTER_BEZIER, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [beginReady, page, duration.base, beginFade]);

  const goTo = (next: number) => {
    const clamped = Math.max(0, Math.min(LAST, next));
    setPage(clamped);
    listRef.current?.scrollTo?.({ x: clamped * width, animated: !reduced });
  };

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    if (width > 0) setPage(Math.round(x / width));
  };

  const complete = () => { onComplete(); };
  const onBegin = () => { triggerHaptic('commit'); complete(); };

  return (
    <View style={[styles.screen, { backgroundColor: c.surface.base }]}>
      <Animated.ScrollView
        ref={listRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={reduced ? undefined : Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: true })}
        onMomentumScrollEnd={onMomentumEnd}
      >
        {COPY.map((copy, i) => {
          // Parallax: the hero drifts slower than the panel as the carousel swipes. OFF
          // under reduced motion (no transform at all → identical layout).
          const heroStyle = reduced
            ? undefined
            : {
                transform: [
                  {
                    translateX: scrollX.interpolate({
                      inputRange: [(i - 1) * width, i * width, (i + 1) * width],
                      outputRange: [width * PARALLAX_FRACTION, 0, -width * PARALLAX_FRACTION],
                      extrapolate: 'clamp' as const,
                    }),
                  },
                ],
              };
          const Hero =
            i === 0 ? (
              <AuraHero size={heroSize} />
            ) : i === 1 ? (
              <PulseHero size={heroSize} />
            ) : (
              <WheelTeaseHero size={heroSize} onSettle={() => setBeginReady(true)} />
            );
          return (
            <OnboardingPanel key={i} width={width} copy={copy} heroStyle={heroStyle}>
              {Hero}
            </OnboardingPanel>
          );
        })}
      </Animated.ScrollView>

      {/* Skip — quiet, persistent, top-right (safe-area aware) */}
      <Pressable
        onPress={complete}
        accessibilityRole="button"
        accessibilityLabel="Skip"
        style={[styles.skip, { top: insets.top + space.md }]}
        hitSlop={space.sm}
      >
        <Text style={{ color: c.content.secondary, fontSize: typography.size.callout, fontWeight: typography.weight.medium }}>Skip</Text>
      </Pressable>

      {/* Bottom chrome: pager dots + the primary CTA (safe-area aware) */}
      <View style={[styles.chrome, { paddingBottom: insets.bottom + space.xl }]}>
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityValue={{ text: `Page ${page + 1} of ${PANEL_COUNT}` }}
          style={styles.dots}
        >
          {COPY.map((_, i) => {
            const active = i === page;
            return (
              <View
                key={i}
                testID={`pager-dot-${i}`}
                style={{
                  width: active ? DOT_ACTIVE_WIDTH : space.sm,
                  height: space.sm,
                  borderRadius: radius.pill,
                  marginHorizontal: space.xs,
                  backgroundColor: active ? c.accent.glow : c.content.tertiary,
                }}
              />
            );
          })}
        </View>

        {page < LAST ? (
          <Pressable
            onPress={() => goTo(page + 1)}
            accessibilityRole="button"
            accessibilityLabel="Continue"
            style={[styles.cta, { backgroundColor: c.accent.glowInk }]}
          >
            <Text style={[styles.ctaText, { color: c.content.onAccent }]}>Continue</Text>
          </Pressable>
        ) : (
          <AnimatedPressable
            onPress={onBegin}
            accessibilityRole="button"
            accessibilityLabel="Begin"
            style={[styles.cta, { backgroundColor: c.accent.glowInk, opacity: reduced ? 1 : beginFade }]}
          >
            <Text style={[styles.ctaText, { color: c.content.onAccent }]}>Begin</Text>
          </AnimatedPressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  skip: { position: 'absolute', right: space.xl, paddingVertical: space.sm, paddingHorizontal: space.sm },
  chrome: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', paddingHorizontal: space.xl },
  dots: { flexDirection: 'row', alignItems: 'center', marginBottom: space.xl },
  cta: { width: '100%', maxWidth: CTA_MAX_WIDTH, paddingVertical: space.lg, alignItems: 'center', borderRadius: radius.pill },
  ctaText: { fontSize: typography.size.body, fontWeight: typography.weight.semibold },
});
