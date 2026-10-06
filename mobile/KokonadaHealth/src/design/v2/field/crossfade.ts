// The field's one crossfade (designer 2.6, accepted with resilience's QA-068 amendments): every lobe
// and halo change is one crossfade through the uniforms, never a layer opacity. Over the eased
// progress u, the incoming node's fade is u and the outgoing node's is 1 − u², so the glow holds while
// the new one blooms (a linear pair halves every lobe mid-way: a blink).
//
// u runs over motion.settle (600 ms, its easing) normally, and over motion.fadeReduced (150 ms,
// linear) under reduced motion and in the still tier: the same in every direction (a direction's
// motion.placement easing moves its bead, not the field). The ledger (placementLedger.ts) owns the
// clock behind u: stamped on the first frame, clamped by motion.dtClamp, never decreasing.
//
// Every function here runs on the UI thread, so each is a worklet (workletSafe.test.ts).

import { BASE } from '../tokens/tokens.generated.ts';

export type FadeMode = 'settle' | 'reduced';

/** The incoming and outgoing fades at progress u. u is clamped to [0, 1]; a NaN u ends the ramp. */
export function crossfade(u: number): { in: number; out: number } {
  'worklet';
  const v = Number.isNaN(u) ? 1 : Math.min(1, Math.max(0, u));
  return { in: v, out: 1 - v * v };
}

/** CSS cubic-bezier(x1, y1, x2, y2) at x in [0, 1], by bisection on the x curve (monotone for x1, x2 in [0, 1]). */
function cubicBezier(easing: readonly number[], x: number): number {
  'worklet';
  const x1 = easing[0];
  const y1 = easing[1];
  const x2 = easing[2];
  const y2 = easing[3];
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 48; i++) {
    const s = (lo + hi) / 2;
    const xs = 3 * x1 * s * (1 - s) * (1 - s) + 3 * x2 * s * s * (1 - s) + s * s * s;
    if (xs < x) lo = s;
    else hi = s;
  }
  const s = (lo + hi) / 2;
  return 3 * y1 * s * (1 - s) * (1 - s) + 3 * y2 * s * s * (1 - s) + s * s * s;
}

/**
 * u after `elapsedMs` of a ramp lasting `durationMs`, eased by a cubic-bezier or linear (null). A
 * duration of 0 or less gives u = 1 (resilience finding 10); a negative or NaN elapsed time gives 0.
 */
export function rampProgress(elapsedMs: number, durationMs: number, easing: readonly number[] | null): number {
  'worklet';
  if (!(durationMs > 0)) return 1;
  if (!(elapsedMs > 0)) return 0;
  if (elapsedMs >= durationMs) return 1;
  const x = elapsedMs / durationMs;
  return easing === null ? x : Math.min(1, Math.max(0, cubicBezier(easing, x)));
}

/** u, `msSinceStart` into a crossfade in `mode`. */
export function progress(mode: FadeMode, msSinceStart: number): number {
  'worklet';
  return mode === 'reduced'
    ? rampProgress(msSinceStart, BASE.motion.fadeReduced.duration, null)
    : rampProgress(msSinceStart, BASE.motion.settle.duration, BASE.motion.settle.easing);
}

/** A crossfade's duration in `mode`. Starts are spaced by motion.settle.duration in every mode. */
export function rampDuration(mode: FadeMode): number {
  'worklet';
  return mode === 'reduced' ? BASE.motion.fadeReduced.duration : BASE.motion.settle.duration;
}
