'use strict';

// W4-002 — the synthetic-human simulator (personas + seeded generator).
//
// Why this exists: every engine from W4-003 onward (anomaly filter, baseline engine,
// chronobiology, affect engine, taxonomy reachability) is validated by REPLAY against a
// synthetic body whose ground truth we know exactly. That only works if the generator is
// (a) deterministic to the bit for a given seed, (b) physiologically plausible, and
// (c) parameterised in the SAME terms the engines estimate — otherwise a green test proves
// nothing about the estimator, only about the fixture.
//
// These pins are therefore about the FIXTURE'S honesty, not about product behaviour:
//   · determinism      — a replay that cannot be reproduced cannot root-cause anything
//   · ground truth     — the persona's declared {M, A, phi, RHR, HRmax} must be what the
//                        stream actually contains, otherwise W4-004's "±3 bpm" is theatre
//   · lane fidelity    — the emitted payloads must survive the REAL adapters, not mocks
//                        (§1 "never a green mock for an integration boundary"; W4-D07)
//   · holdout distinctness — holdouts must use a genuinely different noise family, or the
//                        "avoid circular validation" clause is decoration (R10)

process.env.NODE_ENV = 'test';

const fs   = require('fs');
const path = require('path');
const fc   = require('fast-check');

const { createRng } = require('../sim/rng');
const {
  PERSONAS,
  HOLDOUT_PERSONAS,
  ALL_PERSONAS,
  getPersona,
  listPersonaIds,
  listHoldoutIds,
  karvonenZones,
} = require('../sim/personas');
const {
  generate,
  ACTIVITY_TO_GARMIN_TYPE,
  HEALTH_STORE_TYPES,
  _hourOfDay,
} = require('../sim/generator');

const { normalize, normalizeHealthStoreSamples } = require('../app/services/wearable/adapter');
const { isPhysiologicalHR } = require('../app/services/wearable/hrRange');

jest.setTimeout(120000);

// A fixed wall-clock origin for every run in this file. S9: `now` is a PARAMETER —
// nothing in sim/ may read the clock, so the tests must supply one.
const T0 = Date.UTC(2026, 6, 6, 0, 0, 0); // Mon 2026-07-06 00:00:00Z

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const stdev = (xs) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};
// Lag-1 autocorrelation — the discriminator between an AR/OU noise family and an
// i.i.d. heavy-tailed one.
const lag1 = (xs) => {
  const m = mean(xs);
  let num = 0, den = 0;
  for (let i = 0; i < xs.length; i++) {
    den += (xs[i] - m) ** 2;
    if (i > 0) num += (xs[i] - m) * (xs[i - 1] - m);
  }
  return den === 0 ? 0 : num / den;
};
// Circular distance between two hour-of-day values, in hours (0..12).
// Written once: the inline modular form is easy to get backwards, and a silently
// inverted distance would turn two of the strongest pins in this file into no-ops.
const circDistH = (a, b) => {
  const d = ((a - b) % 24 + 24) % 24;
  return Math.min(d, 24 - d);
};
const excessKurtosis = (xs) => {
  const m = mean(xs);
  const s = stdev(xs);
  if (!(s > 0)) return 0;
  return mean(xs.map((x) => ((x - m) / s) ** 4)) - 3;
};

// ─────────────────────────────────────────────────────────────────────────────
describe('sim/rng — the seeded stream everything else is built on', () => {
  test('same seed reproduces the identical uniform sequence', () => {
    const a = createRng(1234);
    const b = createRng(1234);
    const xs = Array.from({ length: 500 }, () => a.next());
    const ys = Array.from({ length: 500 }, () => b.next());
    expect(xs).toEqual(ys);
  });

  test('different seeds diverge', () => {
    const a = createRng(1);
    const b = createRng(2);
    const xs = Array.from({ length: 200 }, () => a.next());
    const ys = Array.from({ length: 200 }, () => b.next());
    expect(xs).not.toEqual(ys);
  });

  test('string seeds are accepted and are stable', () => {
    expect(createRng('athlete').next()).toBe(createRng('athlete').next());
    expect(createRng('athlete').next()).not.toBe(createRng('sedentary').next());
  });

  test('next() stays in [0,1) and unit() in (0,1] — the log-domain guard (S8)', () => {
    const r = createRng(7);
    for (let i = 0; i < 20000; i++) {
      const u = r.next();
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
      const v = r.unit();
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(Number.isFinite(Math.log(v))).toBe(true);
    }
  });

  test('gaussian() is standard normal to within sampling error, and always finite', () => {
    const r = createRng(99);
    const xs = Array.from({ length: 40000 }, () => r.gaussian());
    expect(xs.every(Number.isFinite)).toBe(true);
    expect(Math.abs(mean(xs))).toBeLessThan(0.03);
    expect(Math.abs(stdev(xs) - 1)).toBeLessThan(0.03);
    expect(Math.abs(excessKurtosis(xs))).toBeLessThan(0.3);
  });

  test('studentT(df) is standardised to unit variance but keeps heavy tails', () => {
    const r = createRng(5);
    const xs = Array.from({ length: 40000 }, () => r.studentT(5));
    expect(xs.every(Number.isFinite)).toBe(true);
    expect(Math.abs(mean(xs))).toBeLessThan(0.06);
    // Standardised: unit variance is the whole point — otherwise a holdout persona's
    // sigmaBpm would silently mean something different from an AR persona's.
    expect(Math.abs(stdev(xs) - 1)).toBeLessThan(0.15);
    // df=5 has a large sample kurtosis; the discriminator against gaussian() only needs
    // it to be clearly positive.
    expect(excessKurtosis(xs)).toBeGreaterThan(1.5);
  });

  test('fork(label) yields independent, reproducible substreams', () => {
    const base = () => createRng(42);
    expect(base().fork('a').next()).toBe(base().fork('a').next());
    expect(base().fork('a').next()).not.toBe(base().fork('b').next());
    // Forking must not consume the parent stream: an artifact substream that advanced the
    // HR stream would make `artifacts: false` produce a DIFFERENT clean signal.
    const p1 = base(); const first1 = p1.next();
    const p2 = base(); p2.fork('artifacts'); const first2 = p2.next();
    expect(first2).toBe(first1);
  });

  test('two forks of the same parent are decorrelated', () => {
    const p = createRng(2026);
    const a = p.fork('hr');
    const b = p.fork('artifacts');
    const xs = Array.from({ length: 4000 }, () => a.gaussian());
    const ys = Array.from({ length: 4000 }, () => b.gaussian());
    const mx = mean(xs), my = mean(ys);
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < xs.length; i++) {
      num += (xs[i] - mx) * (ys[i] - my);
      dx += (xs[i] - mx) ** 2;
      dy += (ys[i] - my) ** 2;
    }
    expect(Math.abs(num / Math.sqrt(dx * dy))).toBeLessThan(0.06);
  });

  test('property: for any 32-bit seed the first 64 draws are finite and in range', () => {
    fc.assert(
      fc.property(fc.integer({ min: -2147483648, max: 2147483647 }), (seed) => {
        const r = createRng(seed);
        for (let i = 0; i < 64; i++) {
          const u = r.next();
          if (!(u >= 0 && u < 1)) return false;
          if (!Number.isFinite(r.gaussian())) return false;
        }
        return true;
      }),
      { numRuns: 120 },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('sim/personas — the declared ground truth', () => {
  test('the five core personas from the mission all exist', () => {
    expect(listPersonaIds().slice().sort()).toEqual(
      ['athlete', 'olderAdult', 'sedentary', 'shiftWorker', 'stressedProfessional'].sort(),
    );
  });

  test('holdout personas exist from day one and are flagged as such (R10)', () => {
    expect(listHoldoutIds().length).toBeGreaterThanOrEqual(2);
    for (const id of listHoldoutIds()) {
      expect(HOLDOUT_PERSONAS[id].holdout).toBe(true);
      // The circular-validation guard: a holdout must not share the core noise family.
      expect(HOLDOUT_PERSONAS[id].noise.family).not.toBe('ou');
    }
    for (const id of listPersonaIds()) expect(PERSONAS[id].holdout).toBe(false);
    expect(Object.keys(ALL_PERSONAS).slice().sort())
      .toEqual([...listPersonaIds(), ...listHoldoutIds()].sort());
  });

  test('every persona carries the full parameter set with sane values', () => {
    for (const p of Object.values(ALL_PERSONAS)) {
      expect(typeof p.id).toBe('string');
      expect(p.cosinor.amplitude).toBeGreaterThan(0);
      expect(p.cosinor.acrophaseHours).toBeGreaterThanOrEqual(0);
      expect(p.cosinor.acrophaseHours).toBeLessThan(24);
      // RHR is DEFINED as the circadian trough, so the two can never drift apart.
      expect(p.restingHeartRate).toBeCloseTo(p.cosinor.mesor - p.cosinor.amplitude, 6);
      expect(isPhysiologicalHR(p.restingHeartRate)).toBe(true);
      expect(p.maxHeartRate).toBeGreaterThan(p.restingHeartRate + 40);
      expect(isPhysiologicalHR(p.maxHeartRate)).toBe(true);
      expect(p.noise.sigmaBpm).toBeGreaterThan(0);
      expect(p.hrv.median).toBeGreaterThan(0);
      expect(p.hrv.mad).toBeGreaterThan(0);
      expect(p.sleep.durationHours).toBeGreaterThan(3);
      expect(p.sleep.durationHours).toBeLessThan(12);
      const f = p.sleep.stageFractions;
      expect(f.deep + f.light + f.rem).toBeCloseTo(1, 6);
      expect(Array.isArray(p.episodes)).toBe(true);
    }
  });

  test('personas are frozen — a test cannot mutate the fixture for later tests', () => {
    expect(Object.isFrozen(PERSONAS)).toBe(true);
    expect(Object.isFrozen(PERSONAS.athlete)).toBe(true);
    expect(Object.isFrozen(PERSONAS.athlete.cosinor)).toBe(true);
    expect(() => { PERSONAS.athlete.restingHeartRate = 99; }).toThrow();
  });

  test('the mission stated persona figures are the ones actually encoded', () => {
    // athlete (RHR~48, HRV~85, amplitude~6)
    expect(PERSONAS.athlete.restingHeartRate).toBeCloseTo(48, 0);
    expect(PERSONAS.athlete.hrv.median).toBeCloseTo(85, 0);
    expect(PERSONAS.athlete.cosinor.amplitude).toBeCloseTo(6, 0);
    // sedentary (72/35)
    expect(PERSONAS.sedentary.restingHeartRate).toBeCloseTo(72, 0);
    expect(PERSONAS.sedentary.hrv.median).toBeCloseTo(35, 0);
    // older adult (65/25, flattened amplitude)
    expect(PERSONAS.olderAdult.restingHeartRate).toBeCloseTo(65, 0);
    expect(PERSONAS.olderAdult.hrv.median).toBeCloseTo(25, 0);
    expect(PERSONAS.olderAdult.cosinor.amplitude)
      .toBeLessThan(PERSONAS.sedentary.cosinor.amplitude);
    // shift worker (acrophase +8h vs the population prior of 15.0, M.3)
    expect(PERSONAS.shiftWorker.cosinor.acrophaseHours).toBeCloseTo((15 + 8) % 24, 1);
    // stressed professional: frequent stress episodes + short sleep
    const stressEps = PERSONAS.stressedProfessional.episodes.filter((e) => e.kind === 'stress');
    expect(stressEps.length).toBeGreaterThanOrEqual(2);
    expect(PERSONAS.stressedProfessional.sleep.durationHours).toBeLessThan(6.5);
  });

  test('getPersona resolves by id and fails loudly on an unknown one', () => {
    expect(getPersona('athlete')).toBe(PERSONAS.athlete);
    expect(getPersona(PERSONAS.athlete)).toBe(PERSONAS.athlete);
    expect(() => getPersona('nope')).toThrow(/unknown persona/i);
  });

  test('karvonenZones follows M.7 exactly and never divides by zero (S8)', () => {
    const p = PERSONAS.athlete;
    const z = karvonenZones(p);
    expect(z.hrr).toBe(p.maxHeartRate - p.restingHeartRate);
    expect(z.lower).toHaveLength(5);
    [0.5, 0.6, 0.7, 0.8, 0.9].forEach((frac, i) => {
      expect(z.lower[i]).toBeCloseTo(p.restingHeartRate + frac * z.hrr, 6);
    });
    expect(z.upper[4]).toBeCloseTo(p.maxHeartRate, 6);
    // Degenerate body: HRmax == RHR must not produce NaN/Infinity anywhere.
    const degenerate = karvonenZones({ restingHeartRate: 60, maxHeartRate: 60 });
    expect(degenerate.lower.every(Number.isFinite)).toBe(true);
    expect(degenerate.upper.every(Number.isFinite)).toBe(true);
    expect(degenerate.hrr).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('sim/generator — determinism (S9)', () => {
  test('the same seed reproduces a byte-identical run', () => {
    const opts = { persona: 'athlete', seed: 11, startAt: T0, days: 2 };
    const a = generate(opts);
    const b = generate(opts);
    // `timings`/`telemetry` carry a wall-clock duration by design; everything the
    // engines consume must be reproducible to the byte.
    const strip = (r) => { const { timings, telemetry, ...rest } = r; return rest; };
    expect(JSON.stringify(strip(a))).toBe(JSON.stringify(strip(b)));
  });

  test('a different seed changes the noise but not the declared ground truth', () => {
    const base = { persona: 'athlete', startAt: T0, days: 2 };
    const a = generate({ ...base, seed: 1 });
    const b = generate({ ...base, seed: 2 });
    expect(a.truth.samples.map((s) => s.hr)).not.toEqual(b.truth.samples.map((s) => s.hr));
    expect(a.truth.cosinor).toEqual(b.truth.cosinor);
    expect(a.truth.restingHeartRate).toBe(b.truth.restingHeartRate);
    expect(a.truth.samples.length).toBe(b.truth.samples.length);
  });

  test('nothing in sim/ reads the clock or the global RNG (S9 source tripwire)', () => {
    const dir = path.join(__dirname, '..', 'sim');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
    expect(files.length).toBeGreaterThan(0);
    // Built by concatenation so this file never matches its own scan (W4-D06 lesson).
    const banned = [
      { re: new RegExp('Date' + '\\.' + 'now\\s*\\('), name: 'Date.now()' },
      { re: new RegExp('Math' + '\\.' + 'random\\s*\\('), name: 'Math.random()' },
      { re: new RegExp('new\\s+Date\\s*\\(\\s*\\)'), name: 'new Date()' },
    ];
    const offenders = [];
    for (const f of files) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      for (const b of banned) if (b.re.test(src)) offenders.push(`${f}: ${b.name}`);
    }
    expect(offenders).toEqual([]);
  });

  test('the S9 tripwire can actually fail (detector self-test)', () => {
    const banned = new RegExp('Date' + '\\.' + 'now\\s*\\(');
    expect(banned.test('const t = Date' + '.now();')).toBe(true);
    expect(banned.test('const t = clock();')).toBe(false);
  });

  test('hour-of-day is pure epoch arithmetic, not host-local time', () => {
    // 2026-07-06T00:00Z is local 00:00 at offset 0 and local 02:00 at +120.
    expect(_hourOfDay(T0, 0)).toBeCloseTo(0, 9);
    expect(_hourOfDay(T0, 120)).toBeCloseTo(2, 9);
    expect(_hourOfDay(T0, -120)).toBeCloseTo(22, 9);
    expect(_hourOfDay(T0 + 5.5 * 3600e3, 0)).toBeCloseTo(5.5, 9);
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 4 * 365 * 24 * 3600 }),
        fc.integer({ min: -840, max: 720 }),
        (sec, tz) => {
          const h = _hourOfDay(T0 + sec * 1000, tz);
          return h >= 0 && h < 24 && Number.isFinite(h);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('sim/generator — physiological plausibility', () => {
  const runs = {};
  beforeAll(() => {
    for (const id of Object.keys(ALL_PERSONAS)) {
      runs[id] = generate({ persona: id, seed: 4242, startAt: T0, days: 3 });
    }
  });

  test('every CLEAN sample is a heart rate a body can produce', () => {
    for (const [id, run] of Object.entries(runs)) {
      for (const s of run.truth.samples) {
        expect(Number.isFinite(s.hr)).toBe(true);
        if (!isPhysiologicalHR(s.hr)) {
          throw new Error(`${id}: clean sample out of range at ${s.tMs} (${s.hr})`);
        }
        expect(s.hr).toBeLessThanOrEqual(ALL_PERSONAS[id].maxHeartRate);
      }
    }
  });

  test('the circadian rhythm points the way the persona declares', () => {
    // NOT "night is lower than day" — the shift worker exists precisely to break that.
    // The invariant that holds for every persona is about its OWN acrophase.
    for (const [id, run] of Object.entries(runs)) {
      const p = ALL_PERSONAS[id];
      const tz = p.tzOffsetMinutes || 0;
      const quiet = run.truth.samples.filter((s) => !s.episode);
      const near = (centre) => quiet.filter((s) => circDistH(_hourOfDay(s.tMs, tz), centre) <= 2)
        .map((s) => s.hr);
      const peak = near(p.cosinor.acrophaseHours);
      const trough = near((p.cosinor.acrophaseHours + 12) % 24);
      expect(peak.length).toBeGreaterThan(10);
      expect(trough.length).toBeGreaterThan(10);
      expect(mean(peak)).toBeGreaterThan(mean(trough));
      // and by roughly the declared peak-to-trough swing (2A), within noise
      expect(mean(peak) - mean(trough)).toBeGreaterThan(p.cosinor.amplitude);
    }
  });

  test('declared RHR is the circadian trough, and the realised trough agrees', () => {
    for (const [id, run] of Object.entries(runs)) {
      const p = ALL_PERSONAS[id];
      expect(run.truth.restingHeartRate).toBe(p.restingHeartRate);
      // The honest second number: what a P10 estimator over the sleep window would see.
      expect(Math.abs(run.truth.empiricalRestingHeartRate - p.restingHeartRate))
        .toBeLessThanOrEqual(4);
    }
  });

  test('workout episodes are trapezoids that actually reach zones 3-5', () => {
    const run = runs.athlete;
    const z = karvonenZones(PERSONAS.athlete);
    const workouts = run.truth.episodes.filter((e) => e.kind === 'workout');
    expect(workouts.length).toBeGreaterThan(0);
    for (const w of workouts) {
      const inside = run.truth.samples.filter((s) => s.episode && s.episode.id === w.id);
      expect(inside.length).toBeGreaterThan(5);
      const hrs = inside.map((s) => s.hr);
      expect(Math.max(...hrs)).toBeGreaterThanOrEqual(z.lower[2]); // >= zone 3 floor
      expect(Math.max(...hrs)).toBeLessThanOrEqual(PERSONAS.athlete.maxHeartRate);
      // trapezoid: the middle of the episode is higher than either edge
      const mid = hrs[Math.floor(hrs.length / 2)];
      expect(mid).toBeGreaterThan(hrs[0]);
      expect(mid).toBeGreaterThan(hrs[hrs.length - 1]);
      // and the label is the workout's own activity for its whole span
      expect([...new Set(inside.map((s) => s.activity))]).toEqual([w.activity]);
    }
  });

  test('stress episodes raise HR into the mission +15..25 bpm band and suppress HRV', () => {
    const run = runs.stressedProfessional;
    const stress = run.truth.episodes.filter((e) => e.kind === 'stress');
    expect(stress.length).toBeGreaterThan(0);
    for (const e of stress) {
      expect(e.amplitudeBpm).toBeGreaterThanOrEqual(15);
      expect(e.amplitudeBpm).toBeLessThanOrEqual(25);
    }
    const stressDays = new Set(stress.map((e) => e.dateKey));
    const suppressed = run.truth.daily.filter((d) => stressDays.has(d.dateKey)).map((d) => d.hrv);
    expect(suppressed.length).toBeGreaterThan(0);
    // A stressed day's HRV must sit below the persona's own median, not merely differ.
    expect(mean(suppressed)).toBeLessThan(PERSONAS.stressedProfessional.hrv.median);
  });

  test('sleep is labelled resting, quieter, and the stage minutes add up', () => {
    for (const run of Object.values(runs)) {
      for (const d of run.truth.daily) {
        const { deepMin, lightMin, remMin, totalMin } = d.sleep;
        expect(deepMin + lightMin + remMin).toBeCloseTo(totalMin, 3);
        expect(totalMin).toBeGreaterThan(3 * 60);
        expect(totalMin).toBeLessThan(12 * 60);
        expect(d.hrv).toBeGreaterThan(0);
        expect(isPhysiologicalHR(d.restingHeartRate)).toBe(true);
      }
      const asleep = run.truth.samples.filter((s) => s.asleep);
      const awake  = run.truth.samples.filter((s) => !s.asleep && !s.episode);
      expect(asleep.length).toBeGreaterThan(50);
      expect(asleep.every((s) => s.activity === 'resting')).toBe(true);
      // Autonomic quieting: minute-to-minute variability is lower asleep than awake.
      expect(stdev(asleep.map((s) => s.hr))).toBeLessThan(stdev(awake.map((s) => s.hr)));
    }
  });

  test('waking non-episode samples carry BOTH resting and unknown labels (D2/D3 fixture)', () => {
    // D3's fix branches on activity==='resting' vs null/'unknown' AND hr<110. A generator
    // that only ever emits one of them would leave half that fix untested forever.
    const labels = new Set(runs.sedentary.truth.samples.map((s) => s.activity));
    expect(labels.has('resting')).toBe(true);
    expect(labels.has('unknown')).toBe(true);
  });

  test('daily-life bumps exist so not every deviation is Gaussian noise', () => {
    const run = runs.sedentary;
    const bumps = run.truth.episodes.filter((e) => e.kind === 'dailyLife');
    expect(bumps.length).toBeGreaterThan(0);
    for (const b of bumps) {
      const inside = run.truth.samples.filter((s) => s.episode && s.episode.id === b.id);
      expect(inside.length).toBeGreaterThan(0);
      // Real signal, not artifact: must stay inside the physiological range.
      expect(inside.every((s) => isPhysiologicalHR(s.hr))).toBe(true);
    }
  });

  test('property: no seed produces a non-finite or out-of-range clean sample', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100000 }),
        fc.constantFrom(...Object.keys(ALL_PERSONAS)),
        (seed, id) => {
          const run = generate({ persona: id, seed, startAt: T0, days: 1 });
          return run.truth.samples.every((s) => isPhysiologicalHR(s.hr));
        },
      ),
      { numRuns: 25 },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('sim/generator — the cosinor ground truth is recoverable (feeds W4-004)', () => {
  // The M.3 fit is implemented HERE, in the test, deliberately: if the generator shipped
  // the fit and W4-004 imported it, "the fit recovers the parameters" would be a tautology.
  // This proves the generator is parameterised in M.3's own terms, no more.
  function fitCosinor(binMeans, binCounts) {
    const w = (2 * Math.PI) / 24;
    let Sw = 0, Sc = 0, Ss = 0, Scc = 0, Sss = 0, Scs = 0, Sy = 0, Syc = 0, Sys = 0;
    for (let h = 0; h < 24; h++) {
      const n = binCounts[h];
      if (!n) continue;
      const c = Math.cos(w * h), s = Math.sin(w * h), y = binMeans[h];
      Sw += n; Sc += n * c; Ss += n * s;
      Scc += n * c * c; Sss += n * s * s; Scs += n * c * s;
      Sy += n * y; Syc += n * y * c; Sys += n * y * s;
    }
    const A = [[Sw, Sc, Ss], [Sc, Scc, Scs], [Ss, Scs, Sss]];
    const b = [Sy, Syc, Sys];
    // 3x3 Gaussian elimination with partial pivoting
    for (let i = 0; i < 3; i++) {
      let p = i;
      for (let r = i + 1; r < 3; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
      [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
      for (let r = i + 1; r < 3; r++) {
        const f = A[r][i] / A[i][i];
        for (let c = i; c < 3; c++) A[r][c] -= f * A[i][c];
        b[r] -= f * b[i];
      }
    }
    const x = [0, 0, 0];
    for (let i = 2; i >= 0; i--) {
      let s = b[i];
      for (let c = i + 1; c < 3; c++) s -= A[i][c] * x[c];
      x[i] = s / A[i][i];
    }
    const [M, beta, gamma] = x;
    const amp = Math.hypot(beta, gamma);
    let phi = (Math.atan2(gamma, beta) * 24) / (2 * Math.PI);
    if (phi < 0) phi += 24;
    return { M, A: amp, phi };
  }

  test.each(['athlete', 'sedentary', 'olderAdult', 'shiftWorker'])(
    'M.3 recovers %s {M, A, phi} from the quiet-hour bins',
    (id) => {
      const p = ALL_PERSONAS[id];
      const run = generate({ persona: id, seed: 808, startAt: T0, days: 14 });
      const tz = p.tzOffsetMinutes || 0;
      const sums = new Array(24).fill(0);
      const counts = new Array(24).fill(0);
      for (const s of run.truth.samples) {
        if (s.episode) continue; // episodes are additive on top of the rhythm
        const h = Math.floor(_hourOfDay(s.tMs, tz));
        sums[h] += s.hr; counts[h] += 1;
      }
      const means = sums.map((v, i) => (counts[i] ? v / counts[i] : 0));
      const fit = fitCosinor(means, counts);
      expect(Math.abs(fit.M - p.cosinor.mesor)).toBeLessThan(1.5);
      expect(Math.abs(fit.A - p.cosinor.amplitude)).toBeLessThan(1.5);
      expect(circDistH(fit.phi, p.cosinor.acrophaseHours)).toBeLessThan(1.5);
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
describe('sim/generator — artifact injection', () => {
  let clean;
  let dirty;
  beforeAll(() => {
    clean = generate({ persona: 'sedentary', seed: 77, startAt: T0, days: 3, artifacts: false });
    dirty = generate({ persona: 'sedentary', seed: 77, startAt: T0, days: 3, artifacts: true });
  });

  test('artifacts never touch the ground truth', () => {
    expect(dirty.truth.samples.map((s) => s.hr)).toEqual(clean.truth.samples.map((s) => s.hr));
    expect(clean.artifacts).toEqual([]);
    expect(dirty.artifacts.length).toBeGreaterThan(0);
  });

  test('every artifact class the mission lists is actually produced', () => {
    const long = generate({ persona: 'sedentary', seed: 5, startAt: T0, days: 7, artifacts: true });
    const kinds = new Set(long.artifacts.map((a) => a.kind));
    for (const k of ['dropout', 'zero', 'doubleCount', 'flatline', 'timestampDuplicate',
      'timestampJitter', 'spike', 'futureTimestamp']) {
      expect([...kinds]).toContain(k);
    }
  });

  test('each artifact is logged with enough detail to grade a filter against it', () => {
    for (const a of dirty.artifacts) {
      expect(typeof a.kind).toBe('string');
      expect(Number.isFinite(a.atMs)).toBe(true);
      expect(Number.isInteger(a.index)).toBe(true);
      expect(a.index).toBeGreaterThanOrEqual(0);
      expect(a.lane === 'socket' || a.lane === 'healthStore').toBe(true);
    }
  });

  test('out-of-range artifacts survive to the emitted stream (the gate is the SUT, not us)', () => {
    // zero readings and x2 spikes on an already-fast HR are exactly what isValidReading and
    // W4-003's Hampel stage must reject. Sanitising them here would make those tests green
    // for free — the whole point is that the simulator emits what a bad sensor emits.
    const emitted = dirty.socket.events.map((e) => e.payload.raw.heartRate);
    expect(emitted.some((hr) => hr === 0)).toBe(true);
    expect(emitted.some((hr) => !isPhysiologicalHR(hr))).toBe(true);
  });

  test('dropouts remove samples and duplicates add them', () => {
    const drops = dirty.artifacts.filter((a) => a.kind === 'dropout' && a.lane === 'socket').length;
    const dupes = dirty.artifacts.filter((a) => a.kind === 'timestampDuplicate' && a.lane === 'socket').length;
    expect(dirty.socket.events.length).toBe(clean.socket.events.length - drops + dupes);
  });

  test('the future-timestamp trap (S6) lands beyond the run own end', () => {
    const future = dirty.artifacts.filter((a) => a.kind === 'futureTimestamp');
    expect(future.length).toBeGreaterThan(0);
    for (const f of future) {
      expect(f.emittedAtMs).toBeGreaterThan(dirty.meta.endAtMs + 5 * 60 * 1000);
    }
  });

  test('flatlines are runs, not single samples', () => {
    const long = generate({ persona: 'sedentary', seed: 5, startAt: T0, days: 7, artifacts: true });
    const flats = long.artifacts.filter((a) => a.kind === 'flatline');
    expect(flats.length).toBeGreaterThan(0);
    for (const f of flats) expect(f.runLength).toBeGreaterThanOrEqual(3);
  });

  test('artifact rates are configurable and zero means zero', () => {
    const none = generate({
      persona: 'sedentary',
      seed: 77,
      startAt: T0,
      days: 3,
      artifacts: {
        zero: 0, doubleCount: 0, dropout: 0, flatline: 0,
        timestampDuplicate: 0, timestampJitter: 0, spike: 0, futureTimestamp: 0,
      },
    });
    expect(none.artifacts).toEqual([]);
    expect(none.socket.events.length).toBe(clean.socket.events.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('sim/generator — both lanes speak the REAL adapters', () => {
  let run;
  beforeAll(() => {
    run = generate({ persona: 'athlete', seed: 909, startAt: T0, days: 2, artifacts: false });
  });

  test('socket events use the exact biometric_push payload shape', () => {
    expect(run.socket.events.length).toBeGreaterThan(100);
    for (const e of run.socket.events.slice(0, 50)) {
      expect(e.event).toBe('biometric_push');
      expect(Object.keys(e.payload).slice().sort()).toEqual(['raw', 'source']);
      expect(e.payload.source).toBe('garmin');
      expect(Object.keys(e.payload.raw).slice().sort())
        .toEqual(['activityType', 'heartRate', 'startTimeLocal']);
      expect(typeof e.payload.raw.startTimeLocal).toBe('string');
    }
  });

  test('every clean socket event normalises to a valid reading through the REAL adapter', () => {
    for (const e of run.socket.events) {
      const n = normalize(e.payload.source, e.payload.raw);
      expect(n.recordedAt instanceof Date).toBe(true);
      expect(Number.isNaN(n.recordedAt.getTime())).toBe(false);
      expect(isPhysiologicalHR(n.heartRate)).toBe(true);
      expect(n.source).toBe('garmin');
    }
  });

  test('the activity map round-trips through the REAL adapter for every entry', () => {
    // The sim declares its own name->garmin-id map. This pin is what stops that copy from
    // silently drifting from adapter.js (the one-definition lesson from D11 / W4-D05).
    for (const [activity, typeId] of Object.entries(ACTIVITY_TO_GARMIN_TYPE)) {
      const n = normalize('garmin', {
        heartRate: 100, activityType: typeId, startTimeLocal: new Date(T0).toISOString(),
      });
      expect(n.activity).toBe(activity);
    }
  });

  test('health-store batches respect MAX_BATCH and the real normaliser recognises every type', () => {
    expect(run.healthStore.platform).toBe('health_connect');
    expect(run.healthStore.batches.length).toBeGreaterThan(0);
    for (const batch of run.healthStore.batches) {
      expect(batch.length).toBeGreaterThan(0);
      expect(batch.length).toBeLessThanOrEqual(2000); // healthStore.MAX_BATCH
      const out = normalizeHealthStoreSamples(run.healthStore.platform, batch);
      // Nothing we emit may be silently dropped by the real normaliser.
      expect(out.length).toBe(batch.length);
      for (const m of out) {
        expect(Number.isFinite(m.value)).toBe(true);
        expect(m.recordedAt instanceof Date).toBe(true);
        expect(Number.isNaN(m.recordedAt.getTime())).toBe(false);
      }
    }
  });

  test('the batch lane carries HR, resting HR, HRV and all three sleep stages', () => {
    const types = new Set(run.healthStore.batches.flat().map((s) => s.type));
    for (const t of HEALTH_STORE_TYPES) expect([...types]).toContain(t);
    expect([...types].sort()).toEqual([...HEALTH_STORE_TYPES].sort());
  });

  test('batch HR rows include workout-elevated samples (the D2 pooling fixture)', () => {
    // metricStore hardcodes activity:'unknown' on every batch row, so the batch lane is
    // exactly where "resting baseline pooled with workouts" happens. W4-004 has to
    // decontaminate that, which needs contaminated input to exist here.
    const hr = run.healthStore.batches.flat()
      .filter((s) => s.type === 'heart_rate').map((s) => s.value);
    const z = karvonenZones(PERSONAS.athlete);
    expect(hr.some((v) => v >= z.lower[2])).toBe(true);
    expect(hr.some((v) => v <= PERSONAS.athlete.restingHeartRate + 5)).toBe(true);
  });

  test('the run is self-describing and versioned (S15)', () => {
    expect(run.v).toBe(1);
    expect(run.meta.personaId).toBe('athlete');
    expect(run.meta.seed).toBe(909);
    expect(run.meta.startAtMs).toBe(T0);
    expect(run.meta.endAtMs).toBeGreaterThan(T0);
    expect(run.meta.sampleCount).toBe(run.truth.samples.length);
  });

  test('telemetry is one house-style line and carries no numeric vital', () => {
    expect(run.telemetry).toMatch(/^\[sim\.generate\] /);
    expect(run.telemetry).not.toContain('\n');
    expect(run.telemetry).toMatch(/persona=athlete/);
    expect(run.telemetry).toMatch(/samples=\d+/);
    // Zero-knowledge habit: counts and timings only, never a bpm/HRV value.
    expect(run.telemetry).not.toMatch(/\b(hr|bpm|hrv|rhr)=/i);
    const logged = [];
    generate({ persona: 'athlete', seed: 909, startAt: T0, days: 1, logger: (l) => logged.push(l) });
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatch(/^\[sim\.generate\] /);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('sim/generator — holdout personas break circularity (R10)', () => {
  test('holdout noise is heavy-tailed and NOT autocorrelated; core noise is the reverse', () => {
    const detrend = (run, p) => {
      const tz = p.tzOffsetMinutes || 0;
      const w = (2 * Math.PI) / 24;
      return run.truth.samples
        .filter((s) => !s.episode && !s.asleep)
        .map((s) => s.hr - (p.cosinor.mesor + p.cosinor.amplitude *
          Math.cos(w * (_hourOfDay(s.tMs, tz) - p.cosinor.acrophaseHours))));
    };
    const core = generate({ persona: 'sedentary', seed: 31, startAt: T0, days: 5 });
    const coreRes = detrend(core, PERSONAS.sedentary);
    expect(lag1(coreRes)).toBeGreaterThan(0.4); // OU memory

    for (const id of listHoldoutIds()) {
      const p = HOLDOUT_PERSONAS[id];
      const run = generate({ persona: id, seed: 31, startAt: T0, days: 5 });
      const res = detrend(run, p);
      expect(Math.abs(lag1(res))).toBeLessThan(0.2);     // i.i.d., no AR memory
      expect(excessKurtosis(res)).toBeGreaterThan(0.8);  // heavier tails than Gaussian
      expect(res.every(Number.isFinite)).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('sim/generator — numerical hygiene and input validation (S8)', () => {
  test('a missing or non-finite seed / startAt is rejected loudly, not coerced', () => {
    expect(() => generate({ persona: 'athlete', startAt: T0 })).toThrow(/seed/i);
    expect(() => generate({ persona: 'athlete', seed: NaN, startAt: T0 })).toThrow(/seed/i);
    expect(() => generate({ persona: 'athlete', seed: 1 })).toThrow(/startAt/i);
    expect(() => generate({ persona: 'athlete', seed: 1, startAt: NaN })).toThrow(/startAt/i);
    expect(() => generate({ persona: 'athlete', seed: 1, startAt: T0, days: 0 })).toThrow(/days/i);
    expect(() => generate({ persona: 'athlete', seed: 1, startAt: T0, sampleIntervalSec: 0 }))
      .toThrow(/sampleIntervalSec/i);
  });

  test('startAt accepts a Date as well as epoch ms and gives the same run', () => {
    const a = generate({ persona: 'athlete', seed: 3, startAt: T0, days: 1 });
    const b = generate({ persona: 'athlete', seed: 3, startAt: new Date(T0), days: 1 });
    expect(a.truth.samples).toEqual(b.truth.samples);
  });

  test('a drift injection is available for W4-012 change-point work', () => {
    const flat = generate({ persona: 'sedentary', seed: 12, startAt: T0, days: 20 });
    const drifted = generate({
      persona: 'sedentary',
      seed: 12,
      startAt: T0,
      days: 20,
      drift: { metric: 'restingHeartRate', startDay: 10, perDayBpm: 0.8 },
    });
    const rhr = (r) => r.truth.daily.map((d) => d.restingHeartRate);
    expect(mean(rhr(drifted).slice(0, 9))).toBeCloseTo(mean(rhr(flat).slice(0, 9)), 6);
    expect(mean(rhr(drifted).slice(-5))).toBeGreaterThan(mean(rhr(flat).slice(-5)) + 3);
  });

  test('sub-minute and coarse sampling both work and scale the sample count', () => {
    const fine   = generate({ persona: 'athlete', seed: 8, startAt: T0, days: 1, sampleIntervalSec: 15 });
    const coarse = generate({ persona: 'athlete', seed: 8, startAt: T0, days: 1, sampleIntervalSec: 300 });
    expect(fine.truth.samples.length).toBe(24 * 60 * 4);
    expect(coarse.truth.samples.length).toBe(24 * 12);
    // The OU noise is parameterised by a correlation TIME, so the stationary spread of the
    // signal must not depend on how often we sample it. A plain fixed-rho AR(1) would fail
    // this, and every persona would silently mean something different per sampling rate.
    const quiet = (r) => r.truth.samples.filter((s) => !s.episode && s.asleep).map((s) => s.hr);
    expect(Math.abs(stdev(quiet(fine)) - stdev(quiet(coarse)))).toBeLessThan(1.5);
  });
});
