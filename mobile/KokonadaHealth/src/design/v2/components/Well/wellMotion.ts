// The Well's one motion (LEDGER §3 L9 and §7; DEC-174). The hint holds the action's place, so it crossfades against the
// action, in place: it gives way on the action's show ramp (motion.settle, as the CTA shows) and comes back on its hide
// ramp (motion.respond, as the CTA hides), each from wherever it is. Reduced motion, the still tier, takes
// motion.fadeReduced, linear, both ways. Battery saver drops only the field's tier, so the low tier moves the UI as the
// full one does (LEDGER §7). The easing is the token's cubic-bezier through the field's own ramp (crossfade.ts), so a
// hint and a crossfade on the same token move alike.

import { rampProgress } from '../../field/crossfade.ts';
import type { MotionTier } from '../../motion/useMotionPolicy.ts';
import type { Tokens } from '../../tokens/useTokens.ts';

/** The motion tokens: useTokens().base.motion. */
export type MotionTokens = Tokens['base']['motion'];

export interface HintFade {
  /** Where the hint's opacity goes. */
  readonly opacity: 0 | 1;
  /** Over how long, in ms, and on which cubic-bezier. */
  readonly duration: number;
  readonly easing: readonly number[];
}

/** The hint's fade toward `visible`, in `tier`. */
export function hintFade(motion: MotionTokens, visible: boolean, tier: MotionTier): HintFade {
  const ramp = tier === 'still' ? motion.fadeReduced : visible ? motion.respond : motion.settle;
  return { opacity: visible ? 1 : 0, duration: ramp.duration, easing: ramp.easing };
}

/** A token's cubic-bezier as the worklet a timing animation samples, at t in [0, 1]. */
export function hintEasing(easing: readonly number[]): (t: number) => number {
  return (t: number) => {
    'worklet';
    return rampProgress(t, 1, easing);
  };
}
