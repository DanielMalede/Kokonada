// The fieldCost bench's histogram (B8-3; the architect's B8 plan: "histogram quantiles exact on planted samples, fixed memory
// over 1e5 records"). It runs on the UI thread inside the bench's frame callback, so every function is a worklet and the
// memory is one plain array made once: recording a sample never allocates.
//
// Durations are whole microseconds (a fraction rounds to the nearest). Below HIST_EXACT_US every microsecond is its own
// bucket, so a quantile there is a recorded sample itself. From HIST_EXACT_US up the buckets are log-linear, HIST_SUB per
// octave, so a bucket's floor is within 1/512 of every value in it; at or past HIST_TOP_US everything shares the last
// bucket. The maximum is kept exactly. A quantile is the nearest rank: the smallest bucket floor with at least ceil(q·n)
// samples at or below it, never above the maximum.
//
// Informational only: DEC-082 (the cost budget) is open, and nothing here holds a number to a threshold.

/** Every whole microsecond below this is its own bucket. */
export const HIST_EXACT_US = 1024;
/** Buckets per octave from HIST_EXACT_US up. */
export const HIST_SUB = 512;
/** The first value of the last octave's end: values at or past it share the last bucket. */
export const HIST_TOP_US = 2 ** 23;
const OCTAVES = 13; // 2^10 .. 2^23
export const HIST_BUCKETS = HIST_EXACT_US + OCTAVES * HIST_SUB;

export interface Histogram {
  /** Samples per bucket; its length never changes. */
  readonly counts: number[];
  n: number;
  max: number;
}

export function histogram(): Histogram {
  'worklet';
  const counts: number[] = new Array(HIST_BUCKETS);
  for (let i = 0; i < HIST_BUCKETS; i++) counts[i] = 0;
  return { counts, n: 0, max: 0 };
}

/** The bucket of a whole, non-negative number of microseconds. */
export function bucketOf(us: number): number {
  'worklet';
  if (us < HIST_EXACT_US) return us;
  if (us >= HIST_TOP_US) return HIST_BUCKETS - 1;
  let e = 10;
  while (us >= 2 ** (e + 1)) e += 1;
  const width = 2 ** (e - 9);
  return HIST_EXACT_US + (e - 10) * HIST_SUB + Math.floor((us - 2 ** e) / width);
}

/** The smallest value a bucket holds. */
export function bucketFloor(index: number): number {
  'worklet';
  if (index < HIST_EXACT_US) return index;
  const e = 10 + Math.floor((index - HIST_EXACT_US) / HIST_SUB);
  const sub = (index - HIST_EXACT_US) % HIST_SUB;
  return 2 ** e + sub * 2 ** (e - 9);
}

/** One duration, in microseconds. A negative or non-finite one is a RangeError and is not recorded. */
export function histRecord(h: Histogram, us: number): void {
  'worklet';
  if (!Number.isFinite(us) || us < 0) throw new RangeError(`a duration of ${us} µs cannot be recorded`);
  const v = Math.round(us);
  h.counts[bucketOf(v)] += 1;
  h.n += 1;
  if (v > h.max) h.max = v;
}

/** The nearest-rank quantile q in (0, 1]. */
export function histQuantile(h: Histogram, q: number): number {
  'worklet';
  if (h.n === 0) throw new Error('the histogram has no samples');
  const rank = Math.max(1, Math.ceil(q * h.n));
  let seen = 0;
  for (let i = 0; i < HIST_BUCKETS; i++) {
    seen += h.counts[i];
    if (seen >= rank) return Math.min(bucketFloor(i), h.max);
  }
  return h.max;
}

export function histSummary(h: Histogram): { p50: number; p95: number; max: number } {
  'worklet';
  if (h.n === 0) throw new Error('the histogram has no samples');
  return { p50: histQuantile(h, 0.5), p95: histQuantile(h, 0.95), max: h.max };
}
