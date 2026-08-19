'use strict';

/**
 * Synthetic-human personas (W4-002).
 *
 * A persona is a complete, declared description of one body: its circadian rhythm, its
 * noise process, when it sleeps, and what it does during the day. It is the GROUND TRUTH
 * every downstream engine is graded against, so the numbers here are the answer key —
 * `baselineEngine` recovering 48 bpm for the athlete is only meaningful because 48 is
 * written here first.
 *
 * Parameterisation notes, each deliberate:
 *
 * · The rhythm is a single-harmonic cosinor in EXACTLY the form §M.3 fits:
 *     HR(t) = mesor + amplitude · cos(ω · (localHour − acrophaseHours)),  ω = 2π/24
 *   Generating in one parameterisation and estimating in another is the classic way to
 *   build a test that passes for the wrong reason, so the generator and the fit share
 *   this definition and nothing else.
 *
 * · `restingHeartRate` is DEFINED as the circadian trough (mesor − amplitude), not carried
 *   as a free third number. Two independent fields would eventually disagree, and the
 *   answer key silently disagreeing with itself is the worst failure a fixture can have.
 *   A frozen invariant is cheaper than a reconciliation test. (Pinned.)
 *
 * · There is no extra "sleep dip" on top of the rhythm. Real cosinor fits are performed
 *   over all 24 hours INCLUDING sleep, so the measured amplitude already contains the
 *   nocturnal drop — adding a second dip would inflate the amplitude the generator
 *   claims versus the one it actually contains. What sleep does here is narrow the noise
 *   (`sleepNoiseFactor`), which is the real autonomic effect and leaves the rhythm honest.
 *
 * · `noise.family` is `ou` for the five core personas and `student-t` for the holdouts.
 *   Ornstein–Uhlenbeck is AR(1) written in continuous time, so the noise keeps the same
 *   stationary spread and correlation TIME whether the stream is sampled every 15 s or
 *   every 5 minutes. A plain fixed-ρ AR(1) would quietly mean something different at each
 *   sampling rate, and both lanes of this simulator sample at different rates.
 *
 * · Holdouts (R10, "avoid circular validation"): heavy-tailed and i.i.d. — a genuinely
 *   different generating process, not a re-parameterised core persona. An estimator tuned
 *   on OU noise has no structural advantage on them.
 *
 * Sources for the population figures are ordinary physiology: resting HR ~48 (trained
 * endurance) to ~72 (sedentary adult); RMSSD-style HRV falling roughly with age and rising
 * with fitness; circadian HR amplitude of a few bpm, flattening with age; HR acrophase in
 * the late afternoon (§M.3's population prior of 15.0 h).
 */

const PERSONA_SCHEMA_VERSION = 1;

// Karvonen zone lower bounds as fractions of heart-rate reserve (§M.7).
const ZONE_FRACTIONS = [0.5, 0.6, 0.7, 0.8, 0.9];

/**
 * §M.7 — HRR = HRmax − RHR, zone bounds at RHR + [.5 .6 .7 .8 .9 1.0]·HRR.
 * No age formula anywhere: the system stores no date of birth (§M.7).
 *
 * The `Math.max(1, …)` is the S8 guard for the degenerate body where HRmax ≈ RHR. It
 * cannot happen with the personas below, but `karvonenZones` is also the shape W4-004's
 * estimated zones will use, and there HRmax is ESTIMATED — an estimator that lands on or
 * below the resting rate must produce ordered finite bounds, not NaN.
 */
function karvonenZones(p) {
  const rhr = Number(p.restingHeartRate);
  const hrr = Math.max(1, Number(p.maxHeartRate) - rhr);
  const lower = ZONE_FRACTIONS.map((f) => rhr + f * hrr);
  const upper = ZONE_FRACTIONS.slice(1).map((f) => rhr + f * hrr).concat([rhr + hrr]);
  return { hrr, lower, upper };
}

// Build a persona, deriving everything derivable so the answer key cannot contradict
// itself, and freeze it so no test can mutate the fixture out from under another.
function definePersona(spec) {
  const cosinor = Object.freeze({
    mesor: spec.cosinor.mesor,
    amplitude: spec.cosinor.amplitude,
    acrophaseHours: spec.cosinor.acrophaseHours,
  });
  const persona = {
    id: spec.id,
    label: spec.label,
    holdout: Boolean(spec.holdout),
    schemaVersion: PERSONA_SCHEMA_VERSION,
    cosinor,
    // Derived, never declared twice.
    restingHeartRate: cosinor.mesor - cosinor.amplitude,
    maxHeartRate: spec.maxHeartRate,
    tzOffsetMinutes: spec.tzOffsetMinutes ?? 0,
    noise: Object.freeze({ ...spec.noise }),
    sleepNoiseFactor: spec.sleepNoiseFactor ?? 0.5,
    hrv: Object.freeze({ ...spec.hrv }),
    sleep: Object.freeze({
      onsetHour: spec.sleep.onsetHour,
      durationHours: spec.sleep.durationHours,
      durationJitterMin: spec.sleep.durationJitterMin ?? 35,
      stageFractions: Object.freeze({ ...spec.sleep.stageFractions }),
    }),
    // Short elevations from ordinary life (stairs, walking to the car). Without them every
    // non-artifact deviation in the stream is Gaussian, and a Hampel filter that only ever
    // meets Gaussian noise passes its test for free.
    dailyLife: Object.freeze({
      bumpsPerDay: spec.dailyLife?.bumpsPerDay ?? 6,
      durationMinRange: Object.freeze(spec.dailyLife?.durationMinRange ?? [4, 12]),
      amplitudeBpmRange: Object.freeze(spec.dailyLife?.amplitudeBpmRange ?? [8, 20]),
    }),
    // Two-state stillness chain driving the ambient activity LABEL (not the value):
    // still → 'resting', moving → 'unknown'. Both labels have to occur, because D3's fix
    // branches on exactly that distinction and a stream carrying only one of them would
    // leave half of it untested forever.
    stillness: Object.freeze({
      stillDwellMin: spec.stillness?.stillDwellMin ?? 25,
      movingDwellMin: spec.stillness?.movingDwellMin ?? 40,
    }),
    episodes: Object.freeze(spec.episodes.map((e) => Object.freeze({
      days: Object.freeze(e.days ?? [0, 1, 2, 3, 4, 5, 6]),
      startJitterMin: e.startJitterMin ?? 30,
      ...e,
    }))),
  };
  return Object.freeze(persona);
}

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [1, 2, 3, 4, 5];

// ── The five core personas named in the mission ──────────────────────────────

const PERSONAS = Object.freeze({
  athlete: definePersona({
    id: 'athlete',
    label: 'Endurance athlete',
    cosinor: { mesor: 54, amplitude: 6, acrophaseHours: 15.0 }, // RHR 48
    maxHeartRate: 190,
    noise: { family: 'ou', sigmaBpm: 2.8, tauSeconds: 180 },
    hrv: { median: 85, mad: 12, stressSuppression: 0.22 },
    sleep: { onsetHour: 22.5, durationHours: 8.2, stageFractions: { deep: 0.22, light: 0.53, rem: 0.25 } },
    dailyLife: { bumpsPerDay: 5 },
    episodes: [
      { kind: 'workout', activity: 'running', startHour: 6.5, durationMin: 55, rampMin: 8, zone: 4, days: [1, 3, 5, 6] },
      { kind: 'workout', activity: 'cycling', startHour: 17.5, durationMin: 70, rampMin: 12, zone: 3, days: [2, 4] },
      { kind: 'workout', activity: 'strength', startHour: 18.0, durationMin: 45, rampMin: 6, zone: 3, days: [0] },
    ],
  }),

  sedentary: definePersona({
    id: 'sedentary',
    label: 'Sedentary adult',
    cosinor: { mesor: 80, amplitude: 8, acrophaseHours: 15.5 }, // RHR 72
    maxHeartRate: 180,
    noise: { family: 'ou', sigmaBpm: 4.0, tauSeconds: 150 },
    hrv: { median: 35, mad: 8, stressSuppression: 0.2 },
    sleep: { onsetHour: 23.5, durationHours: 7.0, stageFractions: { deep: 0.15, light: 0.62, rem: 0.23 } },
    dailyLife: { bumpsPerDay: 7 },
    episodes: [
      { kind: 'walk', activity: 'walking', startHour: 12.75, durationMin: 22, rampMin: 4, zone: 1, days: ALL_DAYS },
      { kind: 'stress', startHour: 15.0, durationMin: 35, amplitudeBpm: 16, days: WEEKDAYS },
    ],
  }),

  olderAdult: definePersona({
    id: 'olderAdult',
    label: 'Older adult',
    // Flattened rhythm: circadian HR amplitude declines with age. Pinned to be strictly
    // below the sedentary adult's, because "flattened" relative to what is the whole point.
    cosinor: { mesor: 69.5, amplitude: 4.5, acrophaseHours: 14.0 }, // RHR 65
    maxHeartRate: 155,
    noise: { family: 'ou', sigmaBpm: 3.4, tauSeconds: 200 },
    hrv: { median: 25, mad: 6, stressSuppression: 0.18 },
    sleep: { onsetHour: 22.0, durationHours: 6.8, stageFractions: { deep: 0.10, light: 0.70, rem: 0.20 } },
    dailyLife: { bumpsPerDay: 4, amplitudeBpmRange: [6, 14] },
    episodes: [
      { kind: 'walk', activity: 'walking', startHour: 9.5, durationMin: 35, rampMin: 5, zone: 1, days: ALL_DAYS },
      { kind: 'walk', activity: 'walking', startHour: 16.5, durationMin: 25, rampMin: 5, zone: 1, days: [1, 3, 5] },
    ],
  }),

  shiftWorker: definePersona({
    id: 'shiftWorker',
    label: 'Night-shift worker',
    // Acrophase +8 h on the population prior (15.0 → 23.0): the rhythm peaks near midnight
    // and troughs late morning. This persona exists to break "night is lower than day",
    // which is an assumption a circadian engine must never be allowed to hard-code.
    cosinor: { mesor: 73, amplitude: 5, acrophaseHours: 23.0 }, // RHR 68
    maxHeartRate: 178,
    noise: { family: 'ou', sigmaBpm: 3.8, tauSeconds: 165 },
    hrv: { median: 40, mad: 10, stressSuppression: 0.24 },
    sleep: { onsetHour: 7.0, durationHours: 6.5, stageFractions: { deep: 0.13, light: 0.64, rem: 0.23 } },
    dailyLife: { bumpsPerDay: 6 },
    episodes: [
      { kind: 'walk', activity: 'walking', startHour: 21.0, durationMin: 30, rampMin: 5, zone: 1, days: ALL_DAYS },
      { kind: 'workout', activity: 'strength', startHour: 17.5, durationMin: 40, rampMin: 6, zone: 3, days: [2, 5] },
      { kind: 'stress', startHour: 3.0, durationMin: 50, amplitudeBpm: 18, days: [1, 2, 3, 4, 5] },
    ],
  }),

  stressedProfessional: definePersona({
    id: 'stressedProfessional',
    label: 'Stressed professional',
    cosinor: { mesor: 77, amplitude: 7, acrophaseHours: 16.0 }, // RHR 70
    maxHeartRate: 182,
    noise: { family: 'ou', sigmaBpm: 4.2, tauSeconds: 140 },
    hrv: { median: 32, mad: 9, stressSuppression: 0.3 },
    // Short sleep is this persona's defining second feature, alongside frequent stress.
    sleep: { onsetHour: 0.5, durationHours: 5.8, stageFractions: { deep: 0.11, light: 0.66, rem: 0.23 } },
    dailyLife: { bumpsPerDay: 8 },
    episodes: [
      { kind: 'stress', startHour: 9.5, durationMin: 45, amplitudeBpm: 22, days: ALL_DAYS },
      { kind: 'stress', startHour: 14.5, durationMin: 40, amplitudeBpm: 19, days: ALL_DAYS },
      { kind: 'stress', startHour: 20.5, durationMin: 30, amplitudeBpm: 17, days: WEEKDAYS },
      { kind: 'workout', activity: 'running', startHour: 7.0, durationMin: 35, rampMin: 6, zone: 3, days: [2, 6] },
    ],
  }),
});

// ── Holdouts: a different generating process, from day one (R10) ─────────────

const HOLDOUT_PERSONAS = Object.freeze({
  holdoutHeavyTail: definePersona({
    id: 'holdoutHeavyTail',
    label: 'Holdout — heavy-tailed, i.i.d. noise',
    holdout: true,
    cosinor: { mesor: 65, amplitude: 7, acrophaseHours: 15.0 }, // RHR 58
    maxHeartRate: 185,
    noise: { family: 'student-t', sigmaBpm: 4.0, df: 5 },
    hrv: { median: 55, mad: 14, stressSuppression: 0.2 },
    sleep: { onsetHour: 23.0, durationHours: 7.5, stageFractions: { deep: 0.18, light: 0.58, rem: 0.24 } },
    episodes: [
      { kind: 'workout', activity: 'swimming', startHour: 7.5, durationMin: 45, rampMin: 7, zone: 4, days: [1, 4] },
      { kind: 'walk', activity: 'walking', startHour: 13.0, durationMin: 20, rampMin: 4, zone: 1, days: ALL_DAYS },
    ],
  }),

  holdoutErratic: definePersona({
    id: 'holdoutErratic',
    label: 'Holdout — erratic, high-variance, i.i.d. noise',
    holdout: true,
    cosinor: { mesor: 89, amplitude: 9, acrophaseHours: 11.5 }, // RHR 80
    maxHeartRate: 170,
    noise: { family: 'student-t', sigmaBpm: 5.5, df: 6 },
    hrv: { median: 22, mad: 7, stressSuppression: 0.26 },
    sleep: { onsetHour: 1.5, durationHours: 6.2, stageFractions: { deep: 0.09, light: 0.70, rem: 0.21 } },
    dailyLife: { bumpsPerDay: 9, amplitudeBpmRange: [10, 24] },
    episodes: [
      { kind: 'stress', startHour: 11.0, durationMin: 55, amplitudeBpm: 24, days: ALL_DAYS },
      { kind: 'walk', activity: 'walking', startHour: 18.5, durationMin: 25, rampMin: 4, zone: 2, days: ALL_DAYS },
    ],
  }),
});

const ALL_PERSONAS = Object.freeze({ ...PERSONAS, ...HOLDOUT_PERSONAS });

function listPersonaIds() { return Object.keys(PERSONAS); }
function listHoldoutIds() { return Object.keys(HOLDOUT_PERSONAS); }

/** Accepts an id or a persona object. Unknown ids throw — a silent default persona would
 *  make a mistyped soak look like a passing one. */
function getPersona(idOrPersona) {
  if (idOrPersona && typeof idOrPersona === 'object' && idOrPersona.id) {
    const known = ALL_PERSONAS[idOrPersona.id];
    if (known) return known;
    return idOrPersona; // caller-supplied ad-hoc persona (used by tests/soak variants)
  }
  const p = ALL_PERSONAS[idOrPersona];
  if (!p) {
    throw new Error(`sim/personas: unknown persona "${idOrPersona}" — known: ${Object.keys(ALL_PERSONAS).join(', ')}`);
  }
  return p;
}

module.exports = {
  PERSONA_SCHEMA_VERSION,
  ZONE_FRACTIONS,
  PERSONAS,
  HOLDOUT_PERSONAS,
  ALL_PERSONAS,
  listPersonaIds,
  listHoldoutIds,
  getPersona,
  karvonenZones,
};
