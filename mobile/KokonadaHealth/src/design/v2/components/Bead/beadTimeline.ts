// The bead's two opacities over time (F1, P0, the designer's rulings of 2026-11-25): a bead is never translucent in
// colour over the field. Below opacity 1 its fill and highlight are drawn achromatic, at the fill's own OKLab L with
// chroma 0 (beadModel.ts beadTwinPaint); the colour lives on an inner disc that fades only while the bead is opaque.
//
//   · Entrance: the bead's opacity 0 to 1 over motion.press, then the colour disc 0 to 1 over motion.respond from the
//     moment the opacity is 1. The colour is exactly 0 while the opacity is below 1.
//   · Exit, from where the bead is: the colour disc to 0 over motion.press, then the opacity to 0 over motion.respond.
//     A bead caught translucent in its entrance carries no colour, so its opacity fades at once.
//   · The still tier plays neither: the bead is whole from its first frame and gone in one (beadPresence.ts).
//
// Each step is the token's duration on its own curve (field/crossfade.ts rampProgress, the field's worklet). Every
// function here is a worklet: hero A's rim words read a leaving bead's opacity on the UI thread (beadOpacityAt,
// ruling 2), from its presence entry. `leftAt` and `nowMs` must be read on one clock (performance.now()).

import { rampProgress } from '../../field/crossfade.ts';
import { BASE } from '../../tokens/tokens.generated.ts';

/** motion.press: the entrance's opacity step and the exit's colour step. */
export const PRESS_MS = BASE.motion.press.duration;
const PRESS_EASING = BASE.motion.press.easing;
/** motion.respond: the entrance's colour step and the exit's opacity step. */
export const RESPOND_MS = BASE.motion.respond.duration;
const RESPOND_EASING = BASE.motion.respond.easing;

/** The bead's opacity `elapsedMs` into its entrance: 0 to 1 over motion.press, on its curve. */
export function entranceOpacity(elapsedMs: number): number {
  'worklet';
  return rampProgress(elapsedMs, PRESS_MS, PRESS_EASING);
}

/** The colour disc's opacity `elapsedMs` into the entrance: 0 until the bead is opaque, then 0 to 1 over motion.respond. */
export function entranceColour(elapsedMs: number): number {
  'worklet';
  return rampProgress(elapsedMs - PRESS_MS, RESPOND_MS, RESPOND_EASING);
}

/** How long an exit holds the bead's opacity while its colour fades: motion.press when it was opaque, else nothing. */
export function exitHold(startOpacity: number): number {
  'worklet';
  return startOpacity >= 1 ? PRESS_MS : 0;
}

/** The exit's length from a start opacity: the hold, then motion.respond. */
export function exitDuration(startOpacity: number): number {
  'worklet';
  return exitHold(startOpacity) + RESPOND_MS;
}

/** The bead's opacity `elapsedMs` into its exit from `startOpacity`: held through the colour's step, then to 0 over motion.respond. */
export function exitOpacity(startOpacity: number, elapsedMs: number): number {
  'worklet';
  const from = startOpacity >= 1 ? 1 : startOpacity > 0 ? startOpacity : 0;
  return from * (1 - rampProgress(elapsedMs - exitHold(from), RESPOND_MS, RESPOND_EASING));
}

/** The colour disc's opacity `elapsedMs` into the exit: from its start to 0 over motion.press; none for a translucent bead. */
export function exitColour(startOpacity: number, startColour: number, elapsedMs: number): number {
  'worklet';
  if (!(startOpacity >= 1)) return 0;
  return startColour * (1 - rampProgress(elapsedMs, PRESS_MS, PRESS_EASING));
}

/** What beadOpacityAt reads of a presence entry: hero A's RimBead without its point. */
export interface BeadExitStamp {
  readonly leaving: boolean;
  /** When its exit began, on the JS clock (performance.now()); null while it is live. */
  readonly leftAt: number | null;
  /** Its opacity when its exit began. */
  readonly startOpacity: number;
}

/** A bead's opacity at `nowMs` (the clock leftAt was read on): 1 while live, else its exit's. */
export function beadOpacityAt(b: BeadExitStamp, nowMs: number): number {
  'worklet';
  if (!b.leaving || b.leftAt === null) return 1;
  return exitOpacity(b.startOpacity, nowMs - b.leftAt);
}
