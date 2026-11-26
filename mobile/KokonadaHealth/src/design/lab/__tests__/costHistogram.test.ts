import { HIST_BUCKETS, HIST_EXACT_US, HIST_TOP_US, bucketFloor, bucketOf, histQuantile, histRecord, histSummary, histogram } from '../cost/histogram';

// B8-3, the fieldCost bench's histogram (the architect's B8 plan, B8-3: "histogram quantiles exact on planted samples, fixed
// memory over 1e5 records"). Durations are recorded in whole microseconds. Below HIST_EXACT_US every microsecond is its own
// bucket, so a quantile there is the sample itself; above it the buckets are log-linear, the maximum is kept exactly, and the
// memory is the same fixed array however many samples go in. A quantile is the nearest rank: the smallest recorded value v
// with at least ceil(q·n) samples at or below v.

const fill = (values: readonly number[]) => {
  const h = histogram();
  for (const v of values) histRecord(h, v);
  return h;
};
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
// The nearest rank, computed the long way on the sorted samples: the reference the histogram must match exactly.
const nearestRank = (values: readonly number[], q: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(1, Math.ceil(q * sorted.length)) - 1];
};

describe('quantiles are exact on planted samples (nearest rank)', () => {
  it.each([
    ['1..100', range(1, 100), { p50: 50, p95: 95, max: 100 }],
    ['1..7 (ceil, not floor: rank 4 of 7)', range(1, 7), { p50: 4, p95: 7, max: 7 }],
    ['1..20 (rank 10 and 19)', range(1, 20), { p50: 10, p95: 19, max: 20 }],
    ['one sample', [333], { p50: 333, p95: 333, max: 333 }],
    ['a long tail: 99 at 200 µs, one at 9000 µs', [...Array(99).fill(200), 9000], { p50: 200, p95: 200, max: 9000 }],
    ['ties and order: 5 5 1 9 9 9 2', [5, 5, 1, 9, 9, 9, 2], { p50: 5, p95: 9, max: 9 }],
    ['zero is a sample', [0, 0, 0, 1], { p50: 0, p95: 1, max: 1 }],
  ])('%s', (_name, values, expected) => {
    const h = fill(values);
    expect(histSummary(h)).toEqual(expected);
    expect(histQuantile(h, 0.5)).toBe(nearestRank(values, 0.5));
    expect(histQuantile(h, 0.95)).toBe(nearestRank(values, 0.95));
  });

  it('every quantile of a shuffled planted set below the exact limit is the sorted sample at its rank', () => {
    // A fixed pseudo-random set (an LCG), so the test is the same on every run.
    let x = 12345;
    const values = Array.from({ length: 997 }, () => { x = (x * 1103515245 + 12345) % 2147483648; return x % HIST_EXACT_US; });
    const h = fill(values);
    for (const q of [0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99, 1]) expect(histQuantile(h, q)).toBe(nearestRank(values, q));
  });

  it('records whole microseconds: a fraction rounds to the nearest', () => {
    expect(histSummary(fill([99.4, 99.6, 100.5]))).toEqual({ p50: 100, p95: 101, max: 101 });
  });
});

describe('above the exact limit the buckets are log-linear and the maximum stays exact', () => {
  it('a value lands in a bucket whose floor is at or below it, within 1/512 of it', () => {
    for (const v of [HIST_EXACT_US, HIST_EXACT_US + 1, 1500, 4095, 4096, 65535, 1_000_000, HIST_TOP_US - 1]) {
      const floor = bucketFloor(bucketOf(v));
      expect(floor).toBeLessThanOrEqual(v);
      expect(v - floor).toBeLessThanOrEqual(v / 512);
    }
  });

  it('the buckets are in order and every index maps back to itself', () => {
    for (let i = 1; i < HIST_BUCKETS; i++) expect(bucketFloor(i)).toBeGreaterThan(bucketFloor(i - 1));
    for (let i = 0; i < HIST_BUCKETS; i++) expect(bucketOf(bucketFloor(i))).toBe(i);
  });

  it('a value at or past the top lands in the last bucket, and the maximum is the value itself', () => {
    const h = fill([10, HIST_TOP_US * 3 + 7]);
    expect(bucketOf(HIST_TOP_US * 3 + 7)).toBe(HIST_BUCKETS - 1);
    expect(histSummary(h).max).toBe(HIST_TOP_US * 3 + 7);
  });

  it('a quantile in a wide bucket is never above the maximum', () => {
    const h = fill([5000, 5001, 5002]);
    expect(histQuantile(h, 0.95)).toBeLessThanOrEqual(5002);
    expect(histSummary(h).max).toBe(5002);
  });
});

describe('fixed memory over 1e5 records', () => {
  it('the counts array keeps its length and the histogram grows no field, and the quantiles are still exact', () => {
    const h = histogram();
    const keys = Object.keys(h).sort();
    expect(h.counts).toHaveLength(HIST_BUCKETS);
    for (let i = 0; i < 100_000; i++) histRecord(h, i % 1000);
    expect(h.counts).toHaveLength(HIST_BUCKETS);
    expect(Object.keys(h).sort()).toEqual(keys);
    expect(h.n).toBe(100_000);
    // Each of 0..999 a hundred times: rank 50 000 is 499, rank 95 000 is 949.
    expect(histSummary(h)).toEqual({ p50: 499, p95: 949, max: 999 });
  });
});

describe('what it refuses', () => {
  it.each([['a negative duration', -1], ['NaN', NaN], ['Infinity', Infinity]])('%s is a RangeError, never a sample', (_name, v) => {
    const h = histogram();
    expect(() => histRecord(h, v)).toThrow(RangeError);
    expect(h.n).toBe(0);
  });

  it('a summary of no samples is an Error, never zeros', () => {
    expect(() => histSummary(histogram())).toThrow(/no samples/);
  });
});
