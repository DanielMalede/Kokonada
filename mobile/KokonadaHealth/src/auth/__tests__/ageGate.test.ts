// The age contract (B1 P1 charter §2 "Age contract"; DEC-194 item 68; DEC-195 FY-2): a pure gate. A
// normalised month and year, plus a trusted "today", give a boolean; the boundary month blocks; the
// trusted "today" is the device clock floored at a committed date and capped at the floor plus 3
// years; yearBounds() never reveals the threshold.

import { ageGate, createAgeGate, AGE_CLOCK_FLOOR, AGE_THRESHOLD_YEARS, type YearMonth } from '../ageGate';

const at = (y: number, m: number, d = 15): Date => new Date(y, m - 1, d, 12, 0, 0);
const TODAY: YearMonth = { year: 2027, month: 6 };

describe('ageGate — trusted today', () => {
  it('reads the device clock in its own calendar, month 1-12', () => {
    expect(ageGate.trustedToday(at(2027, 6))).toEqual({ year: 2027, month: 6 });
    expect(ageGate.trustedToday(at(2028, 1))).toEqual({ year: 2028, month: 1 });
  });

  it('a device clock before the committed floor reads as the floor', () => {
    const floor = new Date(`${AGE_CLOCK_FLOOR}T12:00:00`);
    const expected = { year: floor.getFullYear(), month: floor.getMonth() + 1 };
    expect(ageGate.trustedToday(at(2001, 3))).toEqual(expected);
    expect(ageGate.trustedToday(new Date(0))).toEqual(expected);
  });

  it('a device clock more than 3 years past the floor is capped at the floor plus 3 years', () => {
    const floor = new Date(`${AGE_CLOCK_FLOOR}T12:00:00`);
    const cap = { year: floor.getFullYear() + 3, month: floor.getMonth() + 1 };
    expect(ageGate.trustedToday(at(2040, 1))).toEqual(cap);
    expect(ageGate.trustedToday(at(9999, 12))).toEqual(cap);
  });

  it('an invalid device date reads as the floor, never as NaN', () => {
    const floor = new Date(`${AGE_CLOCK_FLOOR}T12:00:00`);
    expect(ageGate.trustedToday(new Date(Number.NaN))).toEqual({ year: floor.getFullYear(), month: floor.getMonth() + 1 });
  });
});

describe('ageGate — yearBounds never reveals the threshold (regulatory P11-2)', () => {
  it('max is the trusted current year and min is that year minus 120', () => {
    expect(ageGate.yearBounds(TODAY)).toEqual({ min: 2027 - 120, max: 2027 });
  });

  it('changing the threshold constant leaves yearBounds unchanged', () => {
    for (const thresholdYears of [1, 13, 16, 18, 21, 99]) {
      expect(createAgeGate({ thresholdYears }).yearBounds(TODAY)).toEqual(ageGate.yearBounds(TODAY));
    }
  });

  it('the default threshold is 16 (DEC-149)', () => {
    expect(AGE_THRESHOLD_YEARS).toBe(16);
  });
});

describe('ageGate — the three invalid results, one per line (FY-2)', () => {
  it.each([
    [0, 2000, 'invalidMonth'],
    [13, 2000, 'invalidMonth'],
    [1.5, 2000, 'invalidMonth'],
    [Number.NaN, 2000, 'invalidMonth'],
    [6, 1906, 'invalidYear'], // min is 1907
    [6, 2028, 'invalidYear'], // above max
    [6, 199, 'invalidYear'],
    [6, 2000.5, 'invalidYear'],
    [7, 2027, 'future'], // the month after today
    [12, 2027, 'future'],
    [6, 2027, 'ok'],
    [6, 1907, 'ok'],
    [1, 2000, 'ok'],
  ] as const)('month %p year %p is %s', (month, year, result) => {
    expect(ageGate.checkBirth({ month, year }, TODAY)).toBe(result);
  });
});

describe('ageGate — the boundary month blocks (item 68)', () => {
  it('the current month, 16 years back, counts as not yet 16', () => {
    expect(ageGate.passes({ month: 6, year: 2011 }, TODAY)).toBe(false);
  });

  it('the month before it passes', () => {
    expect(ageGate.passes({ month: 5, year: 2011 }, TODAY)).toBe(true);
  });

  it('the month after it blocks', () => {
    expect(ageGate.passes({ month: 7, year: 2011 }, TODAY)).toBe(false);
  });

  it('across a year turn: born December 16 years back, today January', () => {
    const jan: YearMonth = { year: 2028, month: 1 };
    expect(ageGate.passes({ month: 1, year: 2012 }, jan)).toBe(false); // boundary month
    expect(ageGate.passes({ month: 12, year: 2011 }, jan)).toBe(true);
  });

  it('every invalid input fails closed', () => {
    expect(ageGate.passes({ month: 13, year: 1990 }, TODAY)).toBe(false);
    expect(ageGate.passes({ month: 6, year: 1800 }, TODAY)).toBe(false);
    expect(ageGate.passes({ month: 12, year: 2027 }, TODAY)).toBe(false);
  });

  it('a different threshold moves the boundary, and only that', () => {
    const gate18 = createAgeGate({ thresholdYears: 18 });
    expect(gate18.passes({ month: 5, year: 2011 }, TODAY)).toBe(false);
    expect(gate18.passes({ month: 5, year: 2009 }, TODAY)).toBe(true);
    expect(gate18.passes({ month: 6, year: 2009 }, TODAY)).toBe(false);
  });

  it('is pure: the same input gives the same answer, and the input is not touched', () => {
    const birth = Object.freeze({ month: 5, year: 2011 });
    const today = Object.freeze({ ...TODAY });
    expect(ageGate.passes(birth, today)).toBe(ageGate.passes(birth, today));
  });
});
