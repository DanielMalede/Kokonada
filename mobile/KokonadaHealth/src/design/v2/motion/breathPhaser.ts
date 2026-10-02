// The breath's phase, in the two clocks the field runs on.
//
// Real time: advanceBreath moves the phase by dt / period and adopts a new cycle (period and
// inhale share) only when the current one completes (QA-066: "a mid-cycle stress change alters no
// frame before the next boundary"). Time left over at the boundary runs at the new period, so the
// breath never jumps.
//
// Fixed time (captures, stills, sweeps): fixedTimeBreathPhase is frac(n(s)·t / T), a pure function
// of t that repeats exactly every master period T (DSN-050).

import { breathCycles, breathPeriodMs, type BreathLaw } from './breathLaw.ts';

export interface BreathCycle {
  readonly periodMs: number;
  /** The inhale's share of the cycle, in (0, 1). */
  readonly inhale: number;
}

export interface BreathPhase {
  /** In [0, 1): 0 is the start of an inhale. */
  readonly phase: number;
  /** The cycle in progress; a new one is adopted only at a boundary. */
  readonly cycle: BreathCycle;
}

const { floor } = Math;
const numberIsFinite = Number.isFinite;

function assertCycle(cycle: BreathCycle): void {
  if (!(cycle.periodMs > 0 && numberIsFinite(cycle.periodMs))) {
    throw new RangeError(`breath period must be a finite number > 0, got ${cycle.periodMs}`);
  }
  if (!(cycle.inhale > 0 && cycle.inhale < 1)) {
    throw new RangeError(`inhale share must be in (0, 1), got ${cycle.inhale}`);
  }
}

export function cycleFor(law: BreathLaw, stress: number): BreathCycle {
  return { periodMs: breathPeriodMs(law, stress), inhale: law.inhale };
}

export function startBreath(cycle: BreathCycle): BreathPhase {
  assertCycle(cycle);
  return { phase: 0, cycle };
}

/** `target` is the cycle the law asks for now; it is adopted at the next boundary, not before. */
export function advanceBreath(state: BreathPhase, dtMs: number, target: BreathCycle): BreathPhase {
  if (!(dtMs >= 0 && numberIsFinite(dtMs))) {
    throw new RangeError(`a breath step must be a finite number of ms >= 0, got ${dtMs}`);
  }
  assertCycle(target);
  const next = state.phase + dtMs / state.cycle.periodMs;
  if (next < 1) {
    return dtMs === 0 ? state : { phase: next, cycle: state.cycle };
  }
  const leftoverMs = (next - 1) * state.cycle.periodMs;
  const turns = leftoverMs / target.periodMs;
  return { phase: turns - floor(turns), cycle: target };
}

export function fixedTimeBreathPhase(tMs: number, law: BreathLaw, stress: number): number {
  if (!numberIsFinite(tMs)) {
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
