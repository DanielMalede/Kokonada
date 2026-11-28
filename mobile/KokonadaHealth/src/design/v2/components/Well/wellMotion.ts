// The Well's motion (LEDGER §3 L9 and §7; DEC-174; the designer's F3). The hint holds the action's place, so it
// crossfades against the action, in place, each turn from wherever it is. Reduced motion, the still tier, takes
// motion.fadeReduced, linear, both ways. Battery saver drops only the field's tier, so the low tier moves the UI as the
// full one does (LEDGER §7). The easing is the token's cubic-bezier through the field's own ramp (crossfade.ts), so a
// hint and a crossfade on the same token move alike.
//
//   · The commit host (CommitCTA, P2 and P10): the CTA draws its own show and hide, so only the hint moves. It gives way
//     on the CTA's show ramp (motion.settle) and comes back on its hide ramp (motion.respond).
//   · The button host (a Button, P1·AGE): a Button draws no show or hide of its own, so the Well crossfades it against
//     the hint, both over motion.respond both ways. Each turn ends inside well.hold, the hold that spaces its turns.

import { rampProgress } from '../../field/crossfade.ts';
import type { MotionTier } from '../../motion/useMotionPolicy.ts';
import type { Tokens } from '../../tokens/useTokens.ts';

/** The motion tokens: useTokens().base.motion. */
export type MotionTokens = Tokens['base']['motion'];

/** Who the Well hosts (the designer's F3): CommitCTA, under DEC-174's limits, or a Button the Well fades and holds. */
export type WellHost = 'commit' | 'button';

/** One fade: where an opacity goes, over how long in ms, and on which cubic-bezier. */
export interface HintFade {
  readonly opacity: 0 | 1;
  readonly duration: number;
  readonly easing: readonly number[];
}

/** The hint's fade toward `visible`, in `tier`, for the Well's host. */
export function hintFade(motion: MotionTokens, visible: boolean, tier: MotionTier, host: WellHost = 'commit'): HintFade {
  const ramp = tier === 'still' ? motion.fadeReduced : host === 'button' || visible ? motion.respond : motion.settle;
  return { opacity: visible ? 1 : 0, duration: ramp.duration, easing: ramp.easing };
}

/** A hosted Button's fade toward `shown` (the button host; CommitCTA draws its own): the hint's ramp, the other way. */
export function actionFade(motion: MotionTokens, shown: boolean, tier: MotionTier): HintFade {
  const ramp = tier === 'still' ? motion.fadeReduced : motion.respond;
  return { opacity: shown ? 1 : 0, duration: ramp.duration, easing: ramp.easing };
}

/** A token's cubic-bezier as the worklet a timing animation samples, at t in [0, 1]. */
export function hintEasing(easing: readonly number[]): (t: number) => number {
  return (t: number) => {
    'worklet';
    return rampProgress(t, 1, easing);
  };
}
