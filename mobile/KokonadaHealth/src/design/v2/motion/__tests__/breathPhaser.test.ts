import { breathLevel, breathPeriodMs, type BreathLaw } from '../breathLaw.ts';
import {
  advanceBreath,
  cycleFor,
  fixedTimeBreathPhase,
  startBreath,
  type BreathCycle,
  type BreathPhase,
} from '../breathPhaser.ts';

// FIXTURE: direction A as signed in the V1 addendum §2.3.
const LAW: BreathLaw = { masterPeriodMs: 60000, nRest: 11, nStress: 6, inhale: 0.4 };
const REST = cycleFor(LAW, 0);
const STRESSED = cycleFor(LAW, 1);
const FRAME_MS = 1000 / 60;

/** A small seeded generator, so the property run is the same every time. x·1664525 stays below
 *  2^53, so the arithmetic is exact. */
function seeded(seed: number): () => number {
  let x = seed % 4294967296;
  return () => {
    x = (x * 1664525 + 1013904223) % 4294967296;
    return x / 4294967296;
  };
}

describe('cycleFor reads one cycle off the law', () => {
  it('takes the period from n(s) and the inhale share from the law', () => {
    expect(REST).toEqual({ periodMs: breathPeriodMs(LAW, 0), inhale: 0.4 });
    expect(STRESSED).toEqual({ periodMs: 10000, inhale: 0.4 });
  });
});

describe('advanceBreath: the period changes only at a cycle boundary (QA-066)', () => {
  it('within a cycle, the phase moves by dt / period and a new target is not taken', () => {
    const state = advanceBreath(startBreath(REST), 1000, STRESSED);
    expect(state.phase).toBeCloseTo(1000 / REST.periodMs, 15);
    expect(state.cycle).toBe(REST);
  });

  // QA-066: "a mid-cycle stress change alters no frame before the next boundary".
  it('a mid-cycle stress change alters no frame before the boundary, and takes effect at it', () => {
    let steady: BreathPhase = startBreath(REST);
    let changed: BreathPhase = startBreath(REST);
    let frame = 0;
    // Run to the middle of the first cycle on both.
    while (steady.phase < 0.5) {
      steady = advanceBreath(steady, FRAME_MS, REST);
      changed = advanceBreath(changed, FRAME_MS, REST);
      frame++;
    }
    // From here the second phaser is asked to breathe the stressed cycle.
    let wrapped = false;
    while (!wrapped) {
      const before = changed.phase;
      steady = advanceBreath(steady, FRAME_MS, REST);
      changed = advanceBreath(changed, FRAME_MS, STRESSED);
      frame++;
      wrapped = changed.phase < before;
      if (!wrapped) {
        expect(changed).toEqual(steady);
        expect(breathLevel(changed.phase, changed.cycle.inhale)).toBe(breathLevel(steady.phase, steady.cycle.inhale));
      }
    }
    expect(frame).toBeGreaterThan(300);
    expect(changed.cycle).toBe(STRESSED);
    expect(steady.cycle).toBe(REST);
  });

  it('carries the time left over at the boundary into the new cycle', () => {
    const state = advanceBreath({ phase: 0.9, cycle: { periodMs: 1000, inhale: 0.4 } }, 300, { periodMs: 2000, inhale: 0.42 });
    expect(state.cycle).toEqual({ periodMs: 2000, inhale: 0.42 });
    expect(state.phase).toBeCloseTo(200 / 2000, 12);
  });

  it('a step longer than a cycle lands on the right phase of the new cycle', () => {
    const state = advanceBreath({ phase: 0.5, cycle: { periodMs: 1000, inhale: 0.4 } }, 1600, { periodMs: 500, inhale: 0.4 });
    expect(state.cycle.periodMs).toBe(500);
    expect(state.phase).toBeCloseTo(0.2, 12);
  });

  // Property, over 20 000 frames of irregular timing and a target that changes at random.
  it('never changes the period on a frame that did not cross a boundary', () => {
    const random = seeded(20261002);
    const targets: BreathCycle[] = [REST, cycleFor(LAW, 0.5), STRESSED];
    let state = startBreath(REST);
    let target = REST;
    let changes = 0;
    for (let i = 0; i < 20000; i++) {
      if (random() < 0.01) target = targets[Math.floor(random() * targets.length)];
      const dt = random() * 50;
      const next = advanceBreath(state, dt, target);
      if (next.cycle !== state.cycle) {
        changes++;
        expect(state.phase + dt / state.cycle.periodMs).toBeGreaterThanOrEqual(1);
      }
      expect(next.phase).toBeGreaterThanOrEqual(0);
      expect(next.phase).toBeLessThan(1);
      state = next;
    }
    expect(changes).toBeGreaterThan(10);
  });

  it('a zero step changes nothing', () => {
    const state = startBreath(REST);
    expect(advanceBreath(state, 0, STRESSED)).toEqual(state);
  });

  it.each([-1, NaN, Infinity])('refuses the step %p ms: the clock only moves forward', (dt) => {
    expect(() => advanceBreath(startBreath(REST), dt, REST)).toThrow(RangeError);
  });

  it.each([
    [{ periodMs: 0, inhale: 0.4 }],
    [{ periodMs: NaN, inhale: 0.4 }],
    [{ periodMs: 5000, inhale: 0 }],
    [{ periodMs: 5000, inhale: 1 }],
  ])('refuses the cycle %j', (cycle) => {
    expect(() => startBreath(cycle)).toThrow(RangeError);
    expect(() => advanceBreath(startBreath(REST), 16, cycle)).toThrow(RangeError);
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
