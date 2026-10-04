// The breath's phase, in the two clocks the field runs on.
//
// Real time: the state is { phase, n, wrapsSinceChange }, plain data and nothing else, so pausing
// and resuming keep it whole and only a remount resets it. The period is T / n. advanceBreath moves
// the phase by dt / period and handles the wraps one at a time, in a loop, so a long step (or an
// unclamped one) still meets the wrap rule at every wrap. n changes only at a wrap (QA-066: "a
// mid-cycle stress change alters no frame before the next boundary"), and time left over at a wrap
// runs at the new period, so the breath never jumps.
//
// Its dt is the field clock's clamped dt (motion.dtClamp), never a raw frame dt; the loop does not
// rely on that clamp.
//
// Fixed time (captures, stills, sweeps): fixedTimeBreathPhase is frac(n(s)·t / T) at a fixed n, a
// pure function of t that repeats exactly every master period T (DSN-050).
//
// Math.* and Number.* stay inline: these functions become worklets (see workletSafe.test.ts).

import { breathCycles, type BreathLaw } from './breathLaw.ts';

export interface BreathState {
  /** In [0, 1): 0 is the start of an inhale. */
  readonly phase: number;
  /** Breaths per master period now; the period is T / n. */
  readonly n: number;
  /** Wraps since n last changed. */
  readonly wrapsSinceChange: number;
}

export interface BreathClock {
  /** The field's master period T, in ms (field.clock.T). */
  readonly masterPeriodMs: number;
  /** Wraps that must pass before n may step back up (breath.changeLimit.fasterWrapsPerStep). */
  readonly fasterWrapsPerStep: number;
}

function assertClock(clock: BreathClock): void {
  if (!(clock.masterPeriodMs > 0 && Number.isFinite(clock.masterPeriodMs))) {
    throw new RangeError(`master period must be a finite number > 0, got ${clock.masterPeriodMs}`);
  }
  if (!(Number.isInteger(clock.fasterWrapsPerStep) && clock.fasterWrapsPerStep >= 1)) {
    throw new RangeError(`fasterWrapsPerStep must be a whole number >= 1, got ${clock.fasterWrapsPerStep}`);
  }
}

function assertN(n: number, what: string): void {
  if (!(Number.isInteger(n) && n >= 1)) {
    throw new RangeError(`${what} must be a whole number of breaths >= 1, got ${n}`);
  }
}

/** On mount: n is the target, the phase starts at 0, and a faster step is allowed at the first wrap. */
export function startBreath(n: number, clock: BreathClock): BreathState {
  assertClock(clock);
  assertN(n, 'n');
  return { phase: 0, n, wrapsSinceChange: clock.fasterWrapsPerStep - 1 };
}

/** Coming from the still (b = 0.5): start at inhale / 2, where the level is already 0.5. */
export function startBreathFromStill(n: number, clock: BreathClock, inhale: number): BreathState {
  if (!(inhale > 0 && inhale < 1)) {
    throw new RangeError(`inhale share must be in (0, 1), got ${inhale}`);
  }
  return { ...startBreath(n, clock), phase: inhale / 2 };
}

export function breathPeriodOf(state: BreathState, clock: BreathClock): number {
  return clock.masterPeriodMs / state.n;
}

/** What happens to n at one wrap, given the target n the law asks for now. */
function atWrap(n: number, wrapsSinceChange: number, targetN: number): { n: number; wrapsSinceChange: number } {
  return targetN !== n ? { n: targetN, wrapsSinceChange: 0 } : { n, wrapsSinceChange: wrapsSinceChange + 1 };
}

/**
 * `clampedDtMs` is the field clock's clamped dt. `targetN` is n(s) for the stress now
 * (breathCycles); it is adopted only at wraps, under the wrap rule.
 */
export function advanceBreath(state: BreathState, clampedDtMs: number, targetN: number, clock: BreathClock): BreathState {
  if (!(clampedDtMs >= 0 && Number.isFinite(clampedDtMs))) {
    throw new RangeError(`a breath step must be a finite number of ms >= 0, got ${clampedDtMs}`);
  }
  assertClock(clock);
  assertN(targetN, 'the target n');
  assertN(state.n, 'n');
  if (clampedDtMs === 0) {
    return state;
  }
  let { phase, n, wrapsSinceChange } = state;
  let remainingMs = clampedDtMs;
  for (;;) {
    const periodMs = clock.masterPeriodMs / n;
    const next = phase + remainingMs / periodMs;
    if (next < 1) {
      return { phase: next, n, wrapsSinceChange };
    }
    remainingMs = Math.max(0, remainingMs - (1 - phase) * periodMs);
    phase = 0;
    ({ n, wrapsSinceChange } = atWrap(n, wrapsSinceChange, targetN));
  }
}

/** frac(n(s)·t / T) at a fixed n: what a capture at time t shows. */
export function fixedTimeBreathPhase(tMs: number, law: BreathLaw, stress: number): number {
  if (!Number.isFinite(tMs)) {
    throw new RangeError(`time must be a finite number of ms, got ${tMs}`);
  }
  const T = law.masterPeriodMs;
  const n = breathCycles(law, stress);
  if (!(n >= 1 && T > 0)) {
    throw new RangeError(`the law gives ${n} breaths per ${T} ms`);
  }
  // Wrapping t first keeps the product small and exact for whole milliseconds.
  const wrapped = ((tMs % T) + T) % T;
  return ((n * wrapped) % T) / T;
}
