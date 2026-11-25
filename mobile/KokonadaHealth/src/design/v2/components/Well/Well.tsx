// The Well (F10 group A, G8-2a; LEDGER §3 L9, §5.5–5.8 and §12; DEC-174, DEC-066): the place under the plate where the
// page's one action appears. A hint holds the action's place until the action can appear (L9), so nothing is ever
// disabled (R9): the action is shown, or it is absent and the hint says what makes it appear.
//
//   · A full-column slot whose height is a minimum (R6): well.height, or well.consentSlotHeight while it holds DEC-066's
//     reserved consent slot. The hint and the action share one row in its flow, each in a full-width cell, the
//     action's cell pulled back over the hint's by marginStart −100% (it mirrors with the page), both centred across.
//     So the Well is as tall as the taller of the two from its first layout, with nothing measured and no second pass
//     (the designer's ruling 6a, option 1): the two keep each other's place, and a 2.0 label is never clipped, from
//     the first painted frame.
//   · The hint: ui.body in text.secondary, centred, never capped, scaled or ellipsised (DSN-037). It is plain text,
//     never a live region (the Announcer speaks for the page, LEDGER §10).
//   · They take turns on the page's word: `actionShown` is DEC-174's "shown" (from the start of its show ramp until its
//     hide begins), read off ctaState. The action draws its own show and hide; the Well never fades it. The hint gives
//     way and returns on the action's ramps (wellMotion.ts). While the action is not shown its layer can be neither
//     pressed nor reached: never an invisible, pressable commit. While it is, the hint is hidden from TalkBack.
//   · It arrives with the page: no fade of its own at mount, and nothing runs while nothing changes.
//   · Not part of the plate: it mirrors with the page in RTL. No tint, no fill, no elevation (R3, R9).
//
// well.hold (LEDGER rev §3 L9: a Well hosting a Button changes state at most once per 400 ms) is not built: the token is
// not in tokens.generated.ts yet, and the Well hosting CommitCTA keeps DEC-174's own limits.

import React, { useEffect, useRef, type ReactNode } from 'react';
import { StyleSheet, Text, View, type TextStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import type { MotionTier } from '../../motion/useMotionPolicy.ts';
import { useTokens, type Tokens } from '../../tokens/useTokens.ts';
import { hintEasing, hintFade } from './wellMotion.ts';

/** The scripts the hint's type is set for: the keys of ui.body (LEDGER §5.4). */
export type WellScript = keyof Tokens['base']['type']['ui']['body'];

export interface WellProps {
  /** The action is shown: from the start of its show ramp until its hide begins (DEC-174), as ctaState reports it. */
  readonly actionShown: boolean;
  /**
   * What makes the action appear (L9), resolved by the page through the copy port. It holds the action's place while the
   * action is not shown. Without one the place is empty (P2: DEC-032 allows no second line at open).
   */
  readonly hint?: string;
  /** The script the hint is set in, for its line height (LEDGER §5.4). */
  readonly script: WellScript;
  /** The motion tier (useMotionPolicy): the still tier is reduced motion. */
  readonly tier: MotionTier;
  /** DEC-066's reserved consent slot: the Well holds it at well.consentSlotHeight, and shows no hint (the slot has no copy). */
  readonly consentSlot?: boolean;
  /** The action: CommitCTA (P2, P10), a Button (P1·AGE), or the reserved consent slot. */
  readonly children?: ReactNode;
}

export function Well({ actionShown, hint, script, tier, consentSlot = false, children }: WellProps) {
  const tokens = useTokens();
  const hasHint = hint !== undefined && !consentSlot;
  const hintShown = hasHint && !actionShown;
  const actionReachable = consentSlot || actionShown;

  // The hint's opacity: where it should be at mount, then animated on each turn, never on a tier change alone.
  const opacity = useSharedValue(hintShown ? 1 : 0);
  const turned = useRef(hintShown);
  useEffect(() => {
    if (turned.current === hintShown) return;
    turned.current = hintShown;
    const fade = hintFade(tokens.base.motion, hintShown, tier);
    opacity.value = withTiming(fade.opacity, { duration: fade.duration, easing: hintEasing(fade.easing) });
  }, [hintShown, tier, tokens, opacity]);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  const min = consentSlot ? tokens.base.well.consentSlotHeight : tokens.base.well.height;

  const body = tokens.base.type.ui.body[script];
  const hintType: TextStyle = {
    fontFamily: tokens.base.type.face.ui,
    fontSize: body.size,
    lineHeight: body.lineHeight,
    fontWeight: String(body.weight) as TextStyle['fontWeight'],
    letterSpacing: body.tracking * body.size,
    color: tokens.color.text.secondary.hex,
  };

  return (
    <View testID="hero.well" style={[styles.root, { minHeight: min }]}>
      {hasHint && (
        <Animated.View
          style={[styles.cell, fadeStyle]}
          pointerEvents="none"
          accessibilityElementsHidden={!hintShown}
          importantForAccessibility={hintShown ? 'auto' : 'no-hide-descendants'}
        >
          <Text style={[styles.hint, hintType]}>{hint}</Text>
        </Animated.View>
      )}
      <View
        style={[styles.cell, hasHint && styles.overHint]}
        pointerEvents={actionReachable ? 'box-none' : 'none'}
        accessibilityElementsHidden={!actionReachable}
        importantForAccessibility={actionReachable ? 'auto' : 'no-hide-descendants'}
      >
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // One row, so both cells are in the Well's own flow and its height is the taller one's in the first layout pass.
  root: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center' },
  cell: { width: '100%' },
  // The action's cell back over the hint's, whatever the page's direction: a full-width cell's start, pulled back by
  // the row's own width.
  overHint: { marginStart: '-100%' },
  hint: { textAlign: 'center' },
});
