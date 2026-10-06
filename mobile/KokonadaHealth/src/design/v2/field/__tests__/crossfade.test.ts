import { BASE } from '../../tokens/tokens.generated.ts';
import { crossfade, progress, rampProgress, type FadeMode } from '../crossfade.ts';

// QA-068, the event path (resilience test change 2): E1 and E2. Every lobe and halo change is one
// crossfade through the uniforms (designer 2.6): incoming fade u, outgoing fade 1 − u², over the eased
// progress u: motion.settle (600 ms, eased) normally, motion.fadeReduced (150 ms, linear) under reduced
// motion and in the still tier. The same curve and durations in every direction.

const MODES: FadeMode[] = ['settle', 'reduced'];
const DURATION: Record<FadeMode, number> = { settle: BASE.motion.settle.duration, reduced: BASE.motion.fadeReduced.duration };

describe('E1, the curve', () => {
  it('crossfade(0) is {in 0, out 1} and crossfade(1) is {in 1, out 0}', () => {
    expect(crossfade(0)).toEqual({ in: 0, out: 1 });
    expect(crossfade(1)).toEqual({ in: 1, out: 0 });
  });

  it('over u = i/1000: in strictly rises, out strictly falls, and 1 ≤ in + out ≤ 1.25', () => {
    let previous = crossfade(0);
    for (let i = 1; i <= 1000; i++) {
      const now = crossfade(i / 1000);
      expect(now.in).toBeGreaterThan(previous.in);
      expect(now.out).toBeLessThan(previous.out);
      expect(now.in + now.out).toBeGreaterThanOrEqual(1);
      expect(now.in + now.out).toBeLessThanOrEqual(1.25);
      previous = now;
    }
  });

  it('a u outside [0, 1] is clamped, and a NaN u ends the ramp: the outgoing fade is 0, never NaN', () => {
    expect(crossfade(-0.5)).toEqual({ in: 0, out: 1 });
    expect(crossfade(2)).toEqual({ in: 1, out: 0 });
    expect(crossfade(NaN)).toEqual({ in: 1, out: 0 });
  });
});

describe('E2, timing', () => {
  // Steepest slopes, per second, pinned at 1 ms finite differences to within 2%.
  const STEEPEST: Record<FadeMode, { in: number; out: number }> = {
    settle: { in: 4 / 0.6, out: 2.4512 / 0.6 },
    reduced: { in: 1 / 0.15, out: 2 / 0.15 },
  };

  it('the ramps last motion.settle.duration and motion.fadeReduced.duration', () => {
    expect([DURATION.settle, DURATION.reduced]).toEqual([600, 150]);
  });

  it.each(MODES)('%s: the steepest in and out slopes, at 1 ms finite differences, within 2%%', (mode) => {
    let steepIn = 0;
    let steepOut = 0;
    let previous = crossfade(progress(mode, 0));
    for (let ms = 1; ms <= DURATION[mode]; ms++) {
      const now = crossfade(progress(mode, ms));
      steepIn = Math.max(steepIn, (now.in - previous.in) * 1000);
      steepOut = Math.max(steepOut, (previous.out - now.out) * 1000);
      previous = now;
    }
    expect(Math.abs(steepIn / STEEPEST[mode].in - 1)).toBeLessThan(0.02);
    expect(Math.abs(steepOut / STEEPEST[mode].out - 1)).toBeLessThan(0.02);
  });

  it.each(MODES)('%s: the ramp ends exactly at its duration, and not a millisecond before', (mode) => {
    expect(crossfade(progress(mode, DURATION[mode]))).toEqual({ in: 1, out: 0 });
    expect(crossfade(progress(mode, DURATION[mode] - 1)).out).toBeGreaterThan(0);
    expect(progress(mode, 0)).toBe(0);
    expect(progress(mode, DURATION[mode] + 5000)).toBe(1);
  });

  it('the reduced ramp is linear', () => {
    for (let ms = 0; ms <= 150; ms += 15) expect(progress('reduced', ms)).toBeCloseTo(ms / 150, 12);
  });

  it('the settle ramp follows motion.settle’s easing: past halfway at a sixth of the time (ease-out)', () => {
    expect(BASE.motion.settle.easing).toEqual([0.25, 1, 0.5, 1]);
    expect(progress('settle', 100)).toBeGreaterThan(0.5);
    expect(progress('settle', 300)).toBeLessThan(1);
  });
});

describe('the progress guards (resilience finding 10)', () => {
  it('a duration of 0 or less gives u = 1', () => {
    expect(rampProgress(0, 0, null)).toBe(1);
    expect(rampProgress(50, -10, null)).toBe(1);
    expect(rampProgress(50, 0, BASE.motion.settle.easing)).toBe(1);
  });

  it('a negative or non-finite elapsed time gives u = 0; u never leaves [0, 1]', () => {
    expect(rampProgress(-5, 150, null)).toBe(0);
    expect(rampProgress(NaN, 150, null)).toBe(0);
    expect(rampProgress(Infinity, 150, null)).toBe(1);
  });
});
