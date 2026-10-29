import { breathCycles, breathLevel, type BreathLaw } from '../breathLaw.ts';
import {
  advanceBreath,
  breathPeriodOf,
  fixedTimeBreathPhase,
  MAX_STEP_MS,
  startBreath,
  startBreathFromStill,
  type BreathClock,
  type BreathState,
} from '../breathPhaser.ts';

// FIXTURE: direction A as signed in the V1 addendum §2.3, with base breath.changeLimit.
const LAW: BreathLaw = { masterPeriodMs: 60000, nRest: 11, nStress: 6, inhale: 0.4 };
const CLOCK: BreathClock = { masterPeriodMs: 60000, fasterWrapsPerStep: 2 };
const REST_N = breathCycles(LAW, 0);
const STRESSED_N = breathCycles(LAW, 1);
const FRAME_MS = 1000 / 60;
/** T = 6000 ms makes n 6 a 1000 ms breath, n 3 a 2000 ms one and n 12 a 500 ms one. */
const SHORT: BreathClock = { masterPeriodMs: 6000, fasterWrapsPerStep: 2 };

/** A small seeded generator, so the property run is the same every time. x·1664525 stays below
 *  2^53, so the arithmetic is exact. */
function seeded(seed: number): () => number {
  let x = seed % 4294967296;
  return () => {
    x = (x * 1664525 + 1013904223) % 4294967296;
    return x / 4294967296;
  };
}

describe('startBreath: the state on mount', () => {
  it('n is the target at mount, the phase starts at 0, and a faster step is allowed at the first wrap', () => {
    expect(startBreath(REST_N, CLOCK)).toEqual({ phase: 0, n: 11, wrapsSinceChange: 1 });
  });

  // Coming from the still (b = 0.5), the breath continues from 0.5 instead of jumping to 0.
  it('from the still, the phase starts at inhale / 2, where the level is 0.5', () => {
    const state = startBreathFromStill(REST_N, CLOCK, LAW.inhale);
    expect(state).toEqual({ phase: 0.2, n: 11, wrapsSinceChange: 1 });
    expect(breathLevel(state.phase, LAW.inhale)).toBeCloseTo(0.5, 15);
  });

  it('the period is T / n', () => {
    expect(breathPeriodOf(startBreath(STRESSED_N, CLOCK), CLOCK)).toBe(10000);
  });
});

describe('advanceBreath: n changes only at a wrap (QA-066)', () => {
  it('within a cycle, the phase moves by dt / period and a new target is not taken', () => {
    const state = advanceBreath(startBreath(REST_N, CLOCK), 1000, STRESSED_N, CLOCK);
    expect(state.phase).toBeCloseTo(1000 / (60000 / 11), 15);
    expect(state.n).toBe(11);
  });

  // QA-066: "a mid-cycle stress change alters no frame before the next boundary".
  it('a mid-cycle stress change alters no frame before the boundary, and takes effect at it', () => {
    let steady: BreathState = startBreath(REST_N, CLOCK);
    let changed: BreathState = startBreath(REST_N, CLOCK);
    let frame = 0;
    // Run to the middle of the first cycle on both.
    while (steady.phase < 0.5) {
      steady = advanceBreath(steady, FRAME_MS, REST_N, CLOCK);
      changed = advanceBreath(changed, FRAME_MS, REST_N, CLOCK);
      frame++;
    }
    // From here the second phaser is asked to breathe the stressed target.
    let wrapped = false;
    while (!wrapped) {
      const before = changed.phase;
      steady = advanceBreath(steady, FRAME_MS, REST_N, CLOCK);
      changed = advanceBreath(changed, FRAME_MS, STRESSED_N, CLOCK);
      frame++;
      wrapped = changed.phase < before;
      if (!wrapped) {
        expect(changed).toEqual(steady);
        expect(breathLevel(changed.phase, LAW.inhale)).toBe(breathLevel(steady.phase, LAW.inhale));
      }
    }
    expect(frame).toBeGreaterThan(300);
    // DSN-035: toward a slower target n moves one step per wrap.
    expect(changed.n).toBe(REST_N - 1);
    expect(steady.n).toBe(REST_N);
  });

  it('carries the time left over at the boundary into the new cycle', () => {
    const state = advanceBreath({ phase: 0.9, n: 6, wrapsSinceChange: 1 }, 300, 3, SHORT);
    // DSN-035: one step toward the slower target, so n 5, a 1200 ms breath.
    expect(state.n).toBe(5);
    expect(state.phase).toBeCloseTo(200 / 1200, 12);
  });

  it('a step longer than a cycle lands on the right phase of the new cycle', () => {
    const state = advanceBreath({ phase: 0.5, n: 6, wrapsSinceChange: 1 }, 1600, 12, SHORT);
    // DSN-035, wrap by wrap: at 500 ms n steps up to 7 (857.14 ms); at the next wrap, 857.14 ms
    // later, the step back up waits (fewer than fasterWrapsPerStep wraps); 242.86 ms remain.
    expect(state.n).toBe(7);
    expect(state.wrapsSinceChange).toBe(1);
    expect(state.phase).toBeCloseTo(17 / 60, 12);
  });

  // Property, over 20 000 frames of irregular timing and a target that changes at random.
  it('never changes n on a frame that did not cross a wrap', () => {
    const random = seeded(20261002);
    const targets = [REST_N, breathCycles(LAW, 0.5), STRESSED_N];
    let state = startBreath(REST_N, CLOCK);
    let target = REST_N;
    let changes = 0;
    for (let i = 0; i < 20000; i++) {
      if (random() < 0.01) target = targets[Math.floor(random() * targets.length)];
      const dt = random() * 50;
      const next = advanceBreath(state, dt, target, CLOCK);
      if (next.n !== state.n) {
        changes++;
        expect(state.phase + dt / breathPeriodOf(state, CLOCK)).toBeGreaterThanOrEqual(1);
      }
      expect(next.phase).toBeGreaterThanOrEqual(0);
      expect(next.phase).toBeLessThan(1);
      state = next;
    }
    expect(changes).toBeGreaterThan(10);
  });

  // Pause and resume keep the whole state; only a remount resets it. The state is plain data with
  // nothing kept elsewhere, so a copy of it carries on exactly as the original would.
  it('keeps its whole state in the state object, so pausing and resuming loses nothing', () => {
    const state = advanceBreath(startBreath(REST_N, CLOCK), 7777, STRESSED_N, CLOCK);
    const copy: BreathState = JSON.parse(JSON.stringify(state));
    expect(advanceBreath(copy, 12345, STRESSED_N, CLOCK)).toEqual(advanceBreath(state, 12345, STRESSED_N, CLOCK));
  });

});

// DSN-035 (designer rulings §2; resilience second voice §1): toward a slower target n moves one
// step per wrap; back toward rest, one step only at a wrap at least fasterWrapsPerStep wraps after
// the last change. QA-066's monotonicity applies to the target n(s); the n actually breathing
// depends on its history, which is the point of the rule.
describe('the change limit, wrap by wrap', () => {
  const F = CLOCK.fasterWrapsPerStep;

  // Property: 400 000 frames of a random walk of targets across [nStress, nRest]. Frames are at
  // most 50 ms and the shortest breath is 5 000 ms, so a frame crosses at most one wrap. The wrap
  // count since the last change is kept here, independently of the state's own counter.
  it('moves n only at wraps, one step at a time, never early and never past the target', () => {
    const random = seeded(31);
    let state = startBreath(REST_N, CLOCK);
    let target = REST_N;
    let wrapsSinceChange = F - 1;
    let ups = 0;
    let downs = 0;
    // Collected and asserted once: an expect per frame costs more than the phaser itself.
    const violations: string[] = [];
    for (let i = 0; i < 400000; i++) {
      if (random() < 0.002) target = STRESSED_N + Math.floor(random() * (REST_N - STRESSED_N + 1));
      const dt = random() * 50;
      const wraps = state.phase + dt / breathPeriodOf(state, CLOCK) >= 1;
      const next = advanceBreath(state, dt, target, CLOCK);
      let expected = state.n;
      if (wraps && target < state.n) {
        expected = state.n - 1;
        downs++;
        wrapsSinceChange = 0;
      } else if (wraps && target > state.n && wrapsSinceChange + 1 >= F) {
        expected = state.n + 1;
        ups++;
        wrapsSinceChange = 0;
      } else if (wraps) {
        wrapsSinceChange++;
      }
      if (next.n !== expected || next.n < STRESSED_N || next.n > REST_N) {
        violations.push(`frame ${i}: n ${state.n} -> ${next.n}, expected ${expected} (target ${target}, wrap ${wraps})`);
      }
      state = next;
    }
    expect(violations.slice(0, 5)).toEqual([]);
    expect(ups).toBeGreaterThan(20);
    expect(downs).toBeGreaterThan(20);
  });

  // Abyss: 5 wraps from rest to full tension, 5.45 + 6.0 + 6.67 + 7.5 + 8.57 s = 34.2 s; then 10
  // wraps back, two at each n from 6 to 10, 77.5 s.
  const sum = (ns: number[]) => ns.reduce((total, n) => total + 60000 / n, 0);
  const TO_FULL_MS = sum([11, 10, 9, 8, 7]);
  const TO_REST_MS = sum([6, 6, 7, 7, 8, 8, 9, 9, 10, 10]);

  it('takes 34.2 s from rest to full tension in Abyss', () => {
    expect(TO_FULL_MS / 1000).toBeCloseTo(34.2, 1);
    const start = startBreath(REST_N, CLOCK);
    expect(advanceBreath(start, TO_FULL_MS - 0.5, STRESSED_N, CLOCK).n).toBe(7);
    expect(advanceBreath(start, TO_FULL_MS + 0.5, STRESSED_N, CLOCK).n).toBe(STRESSED_N);
  });

  it('takes 77.5 s from full tension back to rest in Abyss', () => {
    expect(TO_REST_MS / 1000).toBeCloseTo(77.5, 1);
    const atFull = advanceBreath(startBreath(REST_N, CLOCK), TO_FULL_MS + 0.5, STRESSED_N, CLOCK);
    expect(atFull).toMatchObject({ n: STRESSED_N, wrapsSinceChange: 0 });
    expect(advanceBreath(atFull, TO_REST_MS - 1, REST_N, CLOCK).n).toBe(REST_N - 1);
    expect(advanceBreath(atFull, TO_REST_MS, REST_N, CLOCK).n).toBe(REST_N);
  });

  // The limit it replaces, planted: +1000 / −500 ms per wrap cannot be met with periods of T / n
  // (7 500 → 8 571 ms is already +1 071), so a phaser bound by it stalls at n 8.
  it('bites: the old millisecond limit never converges', () => {
    let n = REST_N;
    for (let wrap = 0; wrap < 100; wrap++) {
      const next = n > STRESSED_N ? n - 1 : n;
      if (60000 / next - 60000 / n <= 1000) n = next;
    }
    expect(n).toBe(8);
    expect(advanceBreath(startBreath(REST_N, CLOCK), TO_FULL_MS + 0.5, STRESSED_N, CLOCK).n).toBe(STRESSED_N);
  });
});

describe('advanceBreath: refusals', () => {
  it('a zero step changes nothing', () => {
    const state = startBreath(REST_N, CLOCK);
    expect(advanceBreath(state, 0, STRESSED_N, CLOCK)).toEqual(state);
  });

  // A phase that is not in [0, 1) would make the wrap loop spin forever (NaN and ±Infinity never
  // get below 1), which on the UI thread is a hang. Refuse it, and a broken wrap count, at entry.
  it.each([NaN, Infinity, -Infinity, 1, 1.5, -0.1])('refuses the phase %p instead of looping forever', (phase) => {
    expect(() => advanceBreath({ phase, n: 11, wrapsSinceChange: 1 }, 16, REST_N, CLOCK)).toThrow(RangeError);
  });

  it.each([-1, 0.5, NaN, Infinity])('refuses the wrap count %p', (wrapsSinceChange) => {
    expect(() => advanceBreath({ phase: 0.5, n: 11, wrapsSinceChange }, 16, REST_N, CLOCK)).toThrow(RangeError);
  });

  it.each([-1, NaN, Infinity])('refuses the step %p ms: the clock only moves forward', (dt) => {
    expect(() => advanceBreath(startBreath(REST_N, CLOCK), dt, REST_N, CLOCK)).toThrow(RangeError);
  });

  // A finite but huge step would keep the wrap loop busy for ages; at Number.MAX_VALUE, taking one
  // period off the time left no longer changes it, so the loop never ends. One hour is the most.
  it.each([3_600_001, 1e12, Number.MAX_VALUE])('refuses the step %p ms: longer than MAX_STEP_MS', (dt) => {
    expect(() => advanceBreath(startBreath(REST_N, CLOCK), dt, REST_N, CLOCK)).toThrow(RangeError);
  });

  it('accepts a step of exactly MAX_STEP_MS, one hour: 720 wraps at n 12, wrap by wrap', () => {
    expect(MAX_STEP_MS).toBe(3_600_000);
    expect(advanceBreath({ phase: 0, n: 12, wrapsSinceChange: 1 }, MAX_STEP_MS, 12, CLOCK)).toEqual({
      phase: 0,
      n: 12,
      wrapsSinceChange: 721,
    });
  });

  it.each([0, 6.5, NaN])('refuses the target n %p: n is a whole number of breaths per T', (target) => {
    expect(() => advanceBreath(startBreath(REST_N, CLOCK), 16, target, CLOCK)).toThrow(RangeError);
    expect(() => startBreath(target, CLOCK)).toThrow(RangeError);
  });

  it.each([
    [{ masterPeriodMs: 0, fasterWrapsPerStep: 2 }],
    [{ masterPeriodMs: NaN, fasterWrapsPerStep: 2 }],
    [{ masterPeriodMs: 60000, fasterWrapsPerStep: 0 }],
    [{ masterPeriodMs: 60000, fasterWrapsPerStep: 1.5 }],
  ])('refuses the clock %j', (clock) => {
    expect(() => startBreath(REST_N, clock)).toThrow(RangeError);
    expect(() => advanceBreath({ phase: 0, n: 11, wrapsSinceChange: 1 }, 16, REST_N, clock)).toThrow(RangeError);
  });
});

describe('fixedTimeBreathPhase: phase = frac(n(s)·t / T), a pure function of t', () => {
  it('gives the same phase for the same t, whatever was asked before', () => {
    const times = [0, 1234, 59999, 30000, 1234, 7, 45000.5];
    const first = times.map((t) => fixedTimeBreathPhase(t, LAW, 0));
    const again = [...times].reverse().map((t) => fixedTimeBreathPhase(t, LAW, 0)).reverse();
    expect(again).toEqual(first);
  });

  it('repeats exactly every master period, so t can wrap modulo T', () => {
    for (const t of [0, 1, 999, 12345, 59999]) {
      expect(fixedTimeBreathPhase(t + 60000, LAW, 0)).toBe(fixedTimeBreathPhase(t, LAW, 0));
      expect(fixedTimeBreathPhase(t + 7 * 60000, LAW, 1)).toBe(fixedTimeBreathPhase(t, LAW, 1));
      expect(fixedTimeBreathPhase(t - 60000, LAW, 0)).toBe(fixedTimeBreathPhase(t, LAW, 0));
    }
  });

  it('runs n(s) breaths per master period', () => {
    expect(fixedTimeBreathPhase(0, LAW, 1)).toBe(0);
    expect(fixedTimeBreathPhase(5000, LAW, 1)).toBe(0.5);
    expect(fixedTimeBreathPhase(10000, LAW, 1)).toBe(0);
    expect(fixedTimeBreathPhase(60000 / 22, LAW, 0)).toBeCloseTo(0.5, 12);
  });

  it.each([NaN, Infinity])('refuses the time %p', (t) => {
    expect(() => fixedTimeBreathPhase(t, LAW, 0)).toThrow(RangeError);
  });
});
