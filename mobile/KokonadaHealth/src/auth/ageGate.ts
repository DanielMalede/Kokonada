// The age contract (B1 P1 charter §2 "Age contract"): a pure gate. A normalised month and year, plus a
// trusted "today", give a boolean. Nothing here is stored, sent or logged; the caller keeps the input
// in page memory only.
//
// - The boundary month blocks (DEC-194 item 68): the screen asks only a month and a year, so a person
//   born in the current month 16 years back may be 15 or 16, and counts as not yet 16.
// - Trusted "today": the device clock, floored at a committed date and capped at the floor plus 3 years,
//   so a clock set far back or far ahead cannot move the boundary by more than that.
// - yearBounds() never reveals the threshold (regulatory P11-2): it depends on "today" alone.
// - checkBirth() gives one result per invalid line of the age screen (DEC-195 FY-2).

export const AGE_THRESHOLD_YEARS = 16; // DEC-149 / DEC-050
// The committed floor of the trusted clock: the date this contract was committed. A later build may
// raise it; it is never lowered.
export const AGE_CLOCK_FLOOR = '2026-11-28';
const CAP_YEARS_AFTER_FLOOR = 3;
const YEAR_SPAN = 120;

export interface YearMonth { year: number; month: number } // month 1-12
export type BirthCheck = 'ok' | 'invalidMonth' | 'invalidYear' | 'future';

export interface AgeGate {
  trustedToday(deviceNow: Date): YearMonth;
  yearBounds(today: YearMonth): { min: number; max: number };
  checkBirth(birth: YearMonth, today: YearMonth): BirthCheck;
  passes(birth: YearMonth, today: YearMonth): boolean;
}

function localDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

const monthIndex = (ym: YearMonth): number => ym.year * 12 + (ym.month - 1);

export function createAgeGate(opts: { thresholdYears?: number; floor?: string } = {}): AgeGate {
  const thresholdMonths = (opts.thresholdYears ?? AGE_THRESHOLD_YEARS) * 12;
  const floor = localDate(opts.floor ?? AGE_CLOCK_FLOOR);
  const cap = new Date(floor.getFullYear() + CAP_YEARS_AFTER_FLOOR, floor.getMonth(), floor.getDate());

  const yearBounds = (today: YearMonth) => ({ min: today.year - YEAR_SPAN, max: today.year });

  const checkBirth = (birth: YearMonth, today: YearMonth): BirthCheck => {
    if (!Number.isInteger(birth.month) || birth.month < 1 || birth.month > 12) return 'invalidMonth';
    const { min, max } = yearBounds(today);
    if (!Number.isInteger(birth.year) || birth.year < min || birth.year > max) return 'invalidYear';
    if (monthIndex(birth) > monthIndex(today)) return 'future';
    return 'ok';
  };

  return {
    trustedToday(deviceNow: Date): YearMonth {
      const t = deviceNow.getTime();
      let d = deviceNow;
      if (Number.isNaN(t) || t < floor.getTime()) d = floor;
      else if (t > cap.getTime()) d = cap;
      return { year: d.getFullYear(), month: d.getMonth() + 1 };
    },
    yearBounds,
    checkBirth,
    // Strictly more whole months than the threshold: the boundary month (exactly the threshold) blocks.
    passes(birth: YearMonth, today: YearMonth): boolean {
      if (checkBirth(birth, today) !== 'ok') return false;
      return monthIndex(today) - monthIndex(birth) > thresholdMonths;
    },
  };
}

export const ageGate = createAgeGate();
