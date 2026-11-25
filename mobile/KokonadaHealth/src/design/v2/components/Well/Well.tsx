// The Well (F10 group A, G8-2a; LEDGER §3 L9, §5.5–5.8 and §12; DEC-174, DEC-066; the designer's F3): the place under
// the plate where the page's one action appears. A hint holds the action's place until the action can appear (L9), so
// nothing is ever disabled (R9): the action is shown, or it is absent and the hint says what makes it appear.
//
//   · A full-column slot whose height is a minimum (R6): well.height, or well.consentSlotHeight while it holds DEC-066's
//     reserved consent slot. The hint and the action share one row in its flow, each in a full-width cell, the
//     action's cell pulled back over the hint's by marginStart −100% (it mirrors with the page), both centred across.
//     So the Well is as tall as the taller of the two from its first layout, with nothing measured and no second pass
//     (the designer's ruling 6a, option 1): the two keep each other's place, and a 2.0 label is never clipped, from
//     the first painted frame.
//   · The hint: ui.body in text.secondary, never capped, scaled or ellipsised (DSN-037), centred (P10) or at the start
//     of the page's direction (P1·AGE). It is plain text, never a live region (the Announcer speaks, LEDGER §10).
//   · They take turns on the page's word, `actionShown`. While the action is not shown its cell can be neither pressed
//     nor reached: never an invisible, pressable action. While it is, the hint is hidden from TalkBack.
//   · Its host (F3). The commit host, CommitCTA (P2, P10): `actionShown` is DEC-174's "shown" (from the start of its
//     show ramp until its hide begins), read off ctaState, and DEC-174 limits it there; the CTA draws its own show and
//     hide, and the hint gives way and returns on its ramps (wellMotion.ts). The button host, a Button (P1·AGE): the
//     Well crossfades the Button against the hint itself, and changes state at most once per well.hold (QA-068): a
//     turn starts at most once per hold, and when a hold ends the Well takes the latest state the page asked for, if
//     it differs from the one it shows. While a hide is held the Button stays shown, and so pressable: the page's own
//     action checks its own condition.
//   · It arrives with the page: no fade of its own at mount, no hold, and nothing runs while nothing changes.
//   · Not part of the plate: it mirrors with the page in RTL. No tint, no fill, no elevation (R3, R9).

import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View, type TextStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import type { MotionTier } from '../../motion/useMotionPolicy.ts';
import { useTokens, type Tokens } from '../../tokens/useTokens.ts';
import { actionFade, hintEasing, hintFade, type WellHost } from './wellMotion.ts';

export type { WellHost } from './wellMotion.ts';

/** The scripts the hint's type is set for: the keys of ui.body (LEDGER §5.4). */
export type WellScript = keyof Tokens['base']['type']['ui']['body'];

export interface WellProps {
  /** The page's word: the action is shown. For CommitCTA, DEC-174's "shown", as ctaState reports it. */
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
  /**
   * Who the Well hosts (F3): 'commit', CommitCTA (P2, P10), which draws its own show and hide under DEC-174's limits, by
   * default; or 'button', a Button (P1·AGE), which the Well crossfades against the hint and holds for well.hold.
   */
  readonly host?: WellHost;
  /** Where the hint sits across: centred (P10), by default, or at the start of the page's direction (P1·AGE). */
  readonly hintAlign?: 'center' | 'start';
  /** The action: CommitCTA (P2, P10), a Button (P1·AGE), or the reserved consent slot. */
  readonly children?: ReactNode;
}

/**
 * The state the Well shows. The commit host shows the page's word at once. The button host holds each turn for `holdMs`
 * (well.hold; QA-068): a turn starts at most once per hold, and when a hold ends the Well takes the latest state the
 * page asked for, if it differs from the one it shows, which is a turn with a hold of its own. The mount is no turn.
 */
function useHeldTurns(asked: boolean, held: boolean, holdMs: number): boolean {
  const [shown, setShown] = useState(asked);
  if (!held && shown !== asked) setShown(asked);
  const gate = useRef({ shown: asked, wanted: asked, timer: null as ReturnType<typeof setTimeout> | null });
  useEffect(() => {
    const g = gate.current;
    g.wanted = asked;
    if (!held) {
      g.shown = asked;
      if (g.timer !== null) clearTimeout(g.timer);
      g.timer = null;
      return;
    }
    if (g.timer !== null || asked === g.shown) return;
    const turn = (to: boolean) => {
      g.shown = to;
      setShown(to);
      g.timer = setTimeout(() => {
        g.timer = null;
        if (g.wanted !== g.shown) turn(g.wanted);
      }, holdMs);
    };
    turn(asked);
  }, [asked, held, holdMs]);
  useEffect(
    () => () => {
      const { timer } = gate.current;
      if (timer !== null) clearTimeout(timer);
    },
    [],
  );
  return held ? shown : asked;
}

export function Well({ actionShown, hint, script, tier, consentSlot = false, host = 'commit', hintAlign = 'center', children }: WellProps) {
  const tokens = useTokens();
  const shown = useHeldTurns(actionShown, host === 'button', tokens.base.well.hold);
  const hasHint = hint !== undefined && !consentSlot;
  const hintShown = hasHint && !shown;
  const actionReachable = consentSlot || shown;

  // The hint's opacity: where it should be at mount, then animated on each turn, never on a tier change alone.
  const opacity = useSharedValue(hintShown ? 1 : 0);
  const turned = useRef(hintShown);
  useEffect(() => {
    if (turned.current === hintShown) return;
    turned.current = hintShown;
    const fade = hintFade(tokens.base.motion, hintShown, tier, host);
    opacity.value = withTiming(fade.opacity, { duration: fade.duration, easing: hintEasing(fade.easing) });
  }, [hintShown, tier, host, tokens, opacity]);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  // A hosted Button's opacity, the hint's the other way (the button host only: CommitCTA draws its own show and hide).
  const actionOpacity = useSharedValue(shown ? 1 : 0);
  const actionTurned = useRef(shown);
  useEffect(() => {
    if (actionTurned.current === shown) return;
    actionTurned.current = shown;
    if (host !== 'button') {
      actionOpacity.value = shown ? 1 : 0;
      return;
    }
    const fade = actionFade(tokens.base.motion, shown, tier);
    actionOpacity.value = withTiming(fade.opacity, { duration: fade.duration, easing: hintEasing(fade.easing) });
  }, [shown, tier, host, tokens, actionOpacity]);
  const actionStyle = useAnimatedStyle(() => ({ opacity: actionOpacity.value }));

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
          <Text style={[hintAlign === 'start' ? styles.hintStart : styles.hintCentred, hintType]}>{hint}</Text>
        </Animated.View>
      )}
      <Animated.View
        style={[styles.cell, hasHint && styles.overHint, host === 'button' && actionStyle]}
        pointerEvents={actionReachable ? 'box-none' : 'none'}
        accessibilityElementsHidden={!actionReachable}
        importantForAccessibility={actionReachable ? 'auto' : 'no-hide-descendants'}
      >
        {children}
      </Animated.View>
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
  hintCentred: { textAlign: 'center' },
  // React Native lays 'left' at the paragraph's start, the right under RTL: Fabric aligns it to the paragraph's
  // direction (TextLayoutManager), and Paper and iOS swap left and right under RTL.
  hintStart: { textAlign: 'left' },
});
