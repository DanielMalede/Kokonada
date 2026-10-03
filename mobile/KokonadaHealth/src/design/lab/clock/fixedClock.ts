// The fixed clock (MB-085): one instant, the same on every launch, for the look captures.

/** The fixed instant itself, after checking it lies within one period. */
export function fixedClockTime(t: number, periodMs: number): number {
  if (!(Number.isFinite(periodMs) && periodMs > 0)) {
    throw new Error(`the period must be a positive finite number of ms (got ${periodMs})`);
  }
  if (!(Number.isFinite(t) && t >= 0 && t < periodMs)) throw new Error(`t must be in [0, ${periodMs}) (got ${t})`);
  return t;
}
