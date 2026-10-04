import { fixedClockTime } from '../clock/fixedClock';
import { createSteppedClock } from '../clock/steppedClock';

// MB-085. The look captures run on virtual time, so they must be exact: a fixed clock is the same
// instant on every launch, whatever the device does, and a stepped clock reaches step k by the
// closed form (t0 + k * step) mod T, never by adding a step k times. Adding 0.1 ms ten thousand
// times lands on 999.9999999998 instead of 1000, and two captures of "the same" step would differ.

describe('the fixed clock', () => {
  it('is exactly the requested instant', () => {
    expect(fixedClockTime(1500, 6000)).toBe(1500);
    expect(fixedClockTime(0, 6000)).toBe(0);
  });

  it('refuses an instant outside one period, or a period that is not a positive finite number', () => {
    expect(() => fixedClockTime(6000, 6000)).toThrow(/\[0, 6000\)/);
    expect(() => fixedClockTime(-1, 6000)).toThrow(/\[0, 6000\)/);
    expect(() => fixedClockTime(1, 0)).toThrow(/period/);
    expect(() => fixedClockTime(1, NaN)).toThrow(/period/);
  });
});

describe('the stepped clock', () => {
  it('starts at t0 on step 0', () => {
    const clock = createSteppedClock({ t0: 1250, stepMs: 250, periodMs: 6000 });
    expect(clock.step()).toBe(0);
    expect(clock.now()).toBe(1250);
  });

  it('reaches step k by the closed form, with no drift: 10 000 steps of 0.1 ms is exactly 1000', () => {
    const clock = createSteppedClock({ t0: 0, stepMs: 0.1, periodMs: 6000 });
    for (let i = 0; i < 10000; i += 1) clock.advance(1);
    expect(clock.step()).toBe(10000);
    expect(clock.now()).toBe(1000);
  });

  it('advancing n at once equals advancing 1, n times', () => {
    const a = createSteppedClock({ t0: 10, stepMs: 0.7, periodMs: 6000 });
    const b = createSteppedClock({ t0: 10, stepMs: 0.7, periodMs: 6000 });
    a.advance(337);
    for (let i = 0; i < 337; i += 1) b.advance(1);
    expect(a.now()).toBe(b.now());
  });

  it('wraps at the period to exactly 0, never to T', () => {
    const clock = createSteppedClock({ t0: 5750, stepMs: 250, periodMs: 6000 });
    expect(clock.advance(1)).toBe(0);
    expect(clock.advance(24)).toBe(0);
    expect(clock.advance(1)).toBe(250);
  });

  it('only moves forward: a step count below 1 is refused', () => {
    const clock = createSteppedClock({ t0: 0, stepMs: 250, periodMs: 6000 });
    expect(() => clock.advance(0)).toThrow(/steps/);
    expect(() => clock.advance(-1)).toThrow(/steps/);
    expect(() => clock.advance(1.5)).toThrow(/steps/);
  });

  it('refuses a start, a step or a period it cannot honour', () => {
    expect(() => createSteppedClock({ t0: 6000, stepMs: 250, periodMs: 6000 })).toThrow(/t0/);
    expect(() => createSteppedClock({ t0: 0, stepMs: 0, periodMs: 6000 })).toThrow(/stepMs/);
    expect(() => createSteppedClock({ t0: 0, stepMs: 250, periodMs: Infinity })).toThrow(/period/);
  });
});
