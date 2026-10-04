// The breath law (DEC-015, DSN-035; signed in the V1 addendum §2.5).
//
// Every breath period is a whole fraction of the field's master period T: period(s) = T / n(s),
// with n(s) = Math.round(nRest − (nRest − nStress)·s). Tension only lowers n, so the breath only ever
// slows as stress rises, and t can wrap modulo T without a seam. The curve is two cosine halves:
// it rises over the inhale share of the cycle and falls over the rest.
//
// breathLawViolations checks a direction's tokens against QA-066 and QA-067. The bounds are a
// parameter, because they belong to the QA rules and the owner's decision, not to this code.

export interface BreathLaw {
  /** The field's master period T, in ms (field.clock.T). */
  readonly masterPeriodMs: number;
  /** Breaths per T at rest (field.breath.nRest). */
  readonly nRest: number;
  /** Breaths per T at full stress (field.breath.nStress). */
  readonly nStress: number;
  /** The inhale's share of each cycle (field.breath.inhale). */
  readonly inhale: number;
}

export interface BreathRules {
  readonly restMinMs: number;
  readonly restMaxMs: number;
  readonly ceilingMs: number;
  /** The stress grid the period is checked on, e.g. 0.01. */
  readonly stressStep: number;
}

export type BreathRule = 'rest-out-of-band' | 'shortens-under-stress' | 'above-ceiling' | 'exhale-not-longer';

export interface BreathViolation {
  readonly rule: BreathRule;
  readonly stress: number;
  readonly periodMs: number;
}


/** Stress outside [0, 1] is clamped; a stress that is not a number is no inferred tension: rest. */
function clampStress(stress: number): number {
  if (!(stress >= 0)) {
    return 0;
  }
  return stress > 1 ? 1 : stress;
}

export function breathCycles(law: BreathLaw, stress: number): number {
  return Math.round(law.nRest - (law.nRest - law.nStress) * clampStress(stress));
}

export function breathPeriodMs(law: BreathLaw, stress: number): number {
  return law.masterPeriodMs / breathCycles(law, stress);
}

/** 0 = empty, 1 = full. The phase wraps, so any real phase is accepted. */
export function breathLevel(phase: number, inhale: number): number {
  if (!(inhale > 0 && inhale < 1)) {
    throw new RangeError(`inhale share must be in (0, 1), got ${inhale}`);
  }
  const p = phase - Math.floor(phase);
  if (p < inhale) {
    return 0.5 - 0.5 * Math.cos((Math.PI * p) / inhale);
  }
  return 0.5 + 0.5 * Math.cos((Math.PI * (p - inhale)) / (1 - inhale));
}

function assertLaw(law: BreathLaw): void {
  if (!(law.masterPeriodMs > 0 && Number.isFinite(law.masterPeriodMs))) {
    throw new RangeError(`master period must be a finite number > 0, got ${law.masterPeriodMs}`);
  }
  for (const n of [law.nRest, law.nStress]) {
    if (!(Number.isInteger(n) && n > 0)) {
      throw new RangeError(`breaths per master period must be whole numbers > 0, got ${law.nRest} and ${law.nStress}`);
    }
  }
  if (!(law.inhale > 0 && law.inhale < 1)) {
    throw new RangeError(`inhale share must be in (0, 1), got ${law.inhale}`);
  }
}

/** Every QA-066 / QA-067 rule the law breaks, each reported at the first stress where it breaks. */
export function breathLawViolations(law: BreathLaw, rules: BreathRules): BreathViolation[] {
  assertLaw(law);
  if (!(rules.stressStep > 0 && rules.stressStep <= 1)) {
    throw new RangeError(`stress step must be in (0, 1], got ${rules.stressStep}`);
  }
  const violations: BreathViolation[] = [];
  const rest = breathPeriodMs(law, 0);
  if (!(rest >= rules.restMinMs && rest <= rules.restMaxMs)) {
    violations.push({ rule: 'rest-out-of-band', stress: 0, periodMs: rest });
  }
  const steps = Math.round(1 / rules.stressStep);
  let previous = rest;
  let shortens: BreathViolation | null = null;
  let ceiling: BreathViolation | null = null;
  for (let i = 0; i <= steps; i++) {
    const stress = i / steps;
    const period = breathPeriodMs(law, stress);
    if (!shortens && period < previous) {
      shortens = { rule: 'shortens-under-stress', stress, periodMs: period };
    }
    if (!ceiling && period > rules.ceilingMs) {
      ceiling = { rule: 'above-ceiling', stress, periodMs: period };
    }
    previous = period;
  }
  if (shortens) {
    violations.push(shortens);
  }
  if (ceiling) {
    violations.push(ceiling);
  }
  // The inhale share is the same at every stress, so exhale / inhale is one number.
  if (!((1 - law.inhale) / law.inhale > 1)) {
    violations.push({ rule: 'exhale-not-longer', stress: 0, periodMs: rest });
  }
  return violations;
}
