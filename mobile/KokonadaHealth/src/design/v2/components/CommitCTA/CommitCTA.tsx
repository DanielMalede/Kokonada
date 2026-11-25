// CommitCTA (F10 group A): Button variant "commit", the only tinted control (R3; DEC-174, DSN-018). It draws
// DEC-174's machine (ctaState.ts) at the present moment: the opacity and the branded PlacementTint. While a ramp
// runs it re-renders once per frame, and at rest it asks for no frame (zero frame work).
//
// No disabled state (R9, L9): while the machine says it may not be pressed (hidden, or hiding) it is out of touch
// and out of TalkBack, and the Well says why. A press commits only when the machine allows it at that moment, and
// P2's busy latch (after a commit) ignores presses and reports busy, with no visual change. The pill is ui.cta on a
// minimum of cta.height, as wide as its column, the label centred and never capped (R6, QA-013). A press scales it
// to cta.pressScale over motion.press with no colour change, and not at all under reduced motion. No elevation, no
// keyline in Abyss (cta.keyline 0), no spinner (R5, R9). Haptics are the page's (P2's commit only, L12).

import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text } from 'react-native';
import type { MotionTier } from '../../motion/useMotionPolicy.ts';
import { useTokens } from '../../tokens/useTokens.ts';
import { ctaInitial, ctaReduce, ctaState, type CtaMachine, type CtaMode, type CtaPaint, type CtaPlacement } from './ctaState.ts';

export interface CommitCTAProps {
  /** DEC-174's machine, owned by the page (useCtaMachine). */
  readonly machine: CtaMachine;
  /** The label, resolved (onboarding.continue, onboarding.begin, session.commit). */
  readonly label: string;
  readonly onCommit: () => void;
  readonly tier: MotionTier;
  /** P2's latch after a commit: presses ignored, TalkBack hears busy, nothing looks different. */
  readonly busy?: boolean;
}

const now = () => performance.now();
const HEBREW = /[֐-׿]/;

export function CommitCTA({ machine, label, onCommit, tier, busy = false }: CommitCTAProps) {
  const { id, face, base, direction } = useTokens();
  const paint: CtaPaint = { id, face };
  const view = ctaState(machine, now(), paint);

  // One frame at a time while a ramp runs; none at rest.
  const [, frame] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!view.animating) return undefined;
    const handle = requestAnimationFrame(() => frame());
    return () => cancelAnimationFrame(handle);
  });

  const [scale] = useState(() => new Animated.Value(1));
  const press = (toValue: number) => {
    if (tier === 'still') return;
    const e = base.motion.press.easing;
    Animated.timing(scale, { toValue, duration: base.motion.press.duration, easing: Easing.bezier(e[0], e[1], e[2], e[3]), useNativeDriver: true }).start();
  };
  const onPress = () => {
    if (!busy && ctaState(machine, now(), paint).pressable) onCommit();
  };

  const type = base.type.ui.cta[HEBREW.test(label) ? 'hebrew' : 'latin'];
  return (
    <Animated.View
      testID="cta.root"
      pointerEvents={view.pressable ? 'auto' : 'none'}
      importantForAccessibility={view.accessible ? 'auto' : 'no-hide-descendants'}
      accessibilityElementsHidden={!view.accessible}
      style={[styles.root, { opacity: view.opacity, transform: [{ scale }] }]}
    >
      <Pressable
        testID="cta"
        accessible={view.accessible}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={busy ? { busy: true } : undefined}
        onPress={onPress}
        onPressIn={() => press(direction.cta.pressScale)}
        onPressOut={() => press(1)}
        style={[
          styles.pill,
          { minHeight: base.cta.height, borderRadius: base.radius.pill, paddingHorizontal: base.spacing['7'], paddingVertical: base.spacing['5'], backgroundColor: view.tint?.fill },
        ]}
      >
        <Text
          testID="cta.label"
          style={[styles.label, { color: view.tint?.label, fontFamily: base.type.face.ui, fontSize: type.size, lineHeight: type.lineHeight, fontWeight: String(type.weight) as '600', letterSpacing: type.tracking * type.size }]}
        >
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

/** The page's DEC-174 machine: the store's tap count and the field's admitted starts, stamped on the JS clock. */
export function useCtaMachine(paint: CtaPaint, tier: MotionTier, initial: { readonly live: readonly CtaPlacement[]; readonly taps: number }) {
  const [machine, setMachine] = useState(() => ctaInitial(paint, initial.live, initial.taps, now()));
  const context = useRef({ paint, mode: (tier === 'still' ? 'reduced' : 'settle') as CtaMode });
  context.current = { paint, mode: tier === 'still' ? 'reduced' : 'settle' };
  const store = useCallback((taps: number) => {
    const t = now();
    setMachine((m) => ctaReduce(m, { kind: 'store', taps }, t, context.current.mode, context.current.paint));
  }, []);
  const start = useCallback((live: readonly CtaPlacement[]) => {
    const t = now();
    setMachine((m) => ctaReduce(m, { kind: 'start', live }, t, context.current.mode, context.current.paint));
  }, []);
  return { machine, store, start };
}

const styles = StyleSheet.create({
  root: { alignSelf: 'stretch' },
  pill: { alignItems: 'center', justifyContent: 'center' },
  label: { textAlign: 'center' },
});
