// The stepped clock (MB-085): virtual time that moves only when the harness says so, for sweeps
// such as the contrast pass over one field cycle. Step k is ALWAYS the closed form
// (t0 + k * stepMs) mod T, never a running sum, so it cannot drift: adding 0.1 ms ten thousand
// times lands on 999.9999999998, not 1000, and two captures of the same step would differ.

export type SteppedClock = {
  /** The step count so far. */
  step(): number;
  /** The time at the current step, in [0, periodMs). */
  now(): number;
  /** Moves forward by `steps` (a positive integer) and returns the new time. */
  advance(steps: number): number;
};

export function createSteppedClock({ t0, stepMs, periodMs }: { t0: number; stepMs: number; periodMs: number }): SteppedClock {
  if (!(Number.isFinite(periodMs) && periodMs > 0)) {
    throw new Error(`the period must be a positive finite number of ms (got ${periodMs})`);
  }
  if (!(Number.isFinite(t0) && t0 >= 0 && t0 < periodMs)) throw new Error(`t0 must be in [0, ${periodMs}) (got ${t0})`);
  if (!(Number.isFinite(stepMs) && stepMs > 0)) throw new Error(`stepMs must be a positive finite number (got ${stepMs})`);

  let k = 0;
  const at = (n: number) => (t0 + n * stepMs) % periodMs;
  return {
    step: () => k,
    now: () => at(k),
    advance(steps: number) {
      if (!Number.isInteger(steps) || steps < 1) throw new Error(`steps must be a positive integer (got ${steps})`);
      k += steps;
      return at(k);
    },
  };
}
