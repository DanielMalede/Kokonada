import {
  breathCycles,
  breathLawViolations,
  breathLevel,
  breathPeriodMs,
  type BreathLaw,
  type BreathRules,
} from '../breathLaw.ts';

// QA-066 and QA-067, from DEC-015 ("5 to 6 s at rest, up to about 10 s under stress, exhale
// longer than inhale") and DSN-035 ("T0 in [5.0, 6.0] s, T(1) ≤ 10.0 s, T(s) monotone").
const RULES: BreathRules = { restMinMs: 5000, restMaxMs: 6000, ceilingMs: 10000, stressStep: 0.01 };

// FIXTURES until the token files exist: the values the designer signed in the V1 addendum §2.3
// (field.breath.nRest / nStress / inhale, and field.clock.T = 60 000 ms). The token rules test the
// committed token files themselves.
const T = 60000;
const DIRECTIONS: ReadonlyArray<readonly [string, BreathLaw]> = [
  ['A (11 / 6, inhale 0.40)', { masterPeriodMs: T, nRest: 11, nStress: 6, inhale: 0.4 }],
  ['B (10 / 6, inhale 0.38)', { masterPeriodMs: T, nRest: 10, nStress: 6, inhale: 0.38 }],
  ['C (12 / 7, inhale 0.42)', { masterPeriodMs: T, nRest: 12, nStress: 7, inhale: 0.42 }],
];

const A: BreathLaw = DIRECTIONS[0][1];
const grid = Array.from({ length: 101 }, (_, i) => i / 100);

describe('the period is T / n(s), n(s) = round(nRest − (nRest − nStress)·s)', () => {
  it('at rest and at full stress', () => {
    expect(breathCycles(A, 0)).toBe(11);
    expect(breathCycles(A, 1)).toBe(6);
    expect(breathPeriodMs(A, 0)).toBeCloseTo(60000 / 11, 9);
    expect(breathPeriodMs(A, 1)).toBe(10000);
  });

  it('every period divides the master period exactly, so t can wrap modulo T', () => {
    for (const s of grid) {
      const n = breathCycles(A, s);
      expect(Number.isInteger(n)).toBe(true);
      expect(n * breathPeriodMs(A, s)).toBeCloseTo(T, 6);
    }
  });

  // A stress value that is not a number means no tension was inferred, which is rest.
  it('clamps stress to [0, 1] and reads NaN as rest', () => {
    expect(breathCycles(A, -0.5)).toBe(11);
    expect(breathCycles(A, 7)).toBe(6);
    expect(breathCycles(A, NaN)).toBe(11);
  });
});

describe('the breath curve: cosine halves, inhale rising over the inhale share', () => {
  it('starts empty, is full at the end of the inhale, and empties again by the end', () => {
    expect(breathLevel(0, 0.4)).toBe(0);
    expect(breathLevel(0.4, 0.4)).toBe(1);
    expect(breathLevel(0.999999, 0.4)).toBeLessThan(1e-9);
  });

  it('rises through the inhale and falls through the exhale, staying in [0, 1]', () => {
    let previous = -1;
    for (let p = 0; p <= 0.4; p += 0.01) {
      const b = breathLevel(p, 0.4);
      expect(b).toBeGreaterThanOrEqual(previous);
      previous = b;
    }
    previous = breathLevel(0.4, 0.4);
    for (let p = 0.41; p < 1; p += 0.01) {
      const b = breathLevel(p, 0.4);
      expect(b).toBeLessThanOrEqual(previous + 1e-12);
      expect(b).toBeGreaterThanOrEqual(0);
      previous = b;
    }
  });

  it('is halfway at the middle of each half', () => {
    expect(breathLevel(0.2, 0.4)).toBeCloseTo(0.5, 12);
    expect(breathLevel(0.7, 0.4)).toBeCloseTo(0.5, 12);
  });

  it('wraps a phase outside [0, 1)', () => {
    expect(breathLevel(1.2, 0.4)).toBeCloseTo(breathLevel(0.2, 0.4), 12);
    expect(breathLevel(-0.8, 0.4)).toBeCloseTo(breathLevel(0.2, 0.4), 12);
  });

  it.each([0, 1, -0.1, NaN])('refuses the inhale share %p', (inhale) => {
    expect(() => breathLevel(0.3, inhale)).toThrow(RangeError);
  });
});

describe.each(DIRECTIONS)('QA-066 and QA-067 hold for direction %s', (_name, law) => {
  it('passes every rule', () => {
    expect(breathLawViolations(law, RULES)).toEqual([]);
  });

  it('rests within 5000–6000 ms', () => {
    expect(breathPeriodMs(law, 0)).toBeGreaterThanOrEqual(5000);
    expect(breathPeriodMs(law, 0)).toBeLessThanOrEqual(6000);
  });

  it('never shortens as stress rises, on a 0.01 grid', () => {
    for (let i = 1; i < grid.length; i++) {
      expect(breathPeriodMs(law, grid[i])).toBeGreaterThanOrEqual(breathPeriodMs(law, grid[i - 1]));
    }
  });

  it('stays at or under the 10 000 ms ceiling', () => {
    for (const s of grid) expect(breathPeriodMs(law, s)).toBeLessThanOrEqual(10000);
  });

  it('exhales for longer than it inhales', () => {
    expect((1 - law.inhale) / law.inhale).toBeGreaterThan(1);
  });
});

// Each planted law breaks one rule, so each rule is shown to bite.
describe('breathLawViolations names the rule a law breaks', () => {
  it.each([
    ['rests too fast (nRest 13: 4615 ms)', { ...A, nRest: 13 }, 'rest-out-of-band'],
    ['rests too slow (nRest 9: 6667 ms)', { ...A, nRest: 9 }, 'rest-out-of-band'],
    ['speeds up under stress (nStress 14)', { ...A, nStress: 14 }, 'shortens-under-stress'],
    ['passes the ceiling (nStress 5: 12 000 ms)', { ...A, nStress: 5 }, 'above-ceiling'],
    ['inhales as long as it exhales (0.5)', { ...A, inhale: 0.5 }, 'exhale-not-longer'],
    ['inhales for longer (0.6)', { ...A, inhale: 0.6 }, 'exhale-not-longer'],
  ])('a law that %s', (_name, law, rule) => {
    expect(breathLawViolations(law as BreathLaw, RULES).map((v) => v.rule)).toEqual([rule]);
  });

  it.each([
    [{ ...A, masterPeriodMs: 0 }],
    [{ ...A, nRest: 0 }],
    [{ ...A, nStress: 6.5 }],
    [{ ...A, inhale: NaN }],
  ])('refuses a malformed law %j', (law) => {
    expect(() => breathLawViolations(law, RULES)).toThrow(RangeError);
  });
});
