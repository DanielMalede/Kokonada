'use strict';

/**
 * Seeded synthetic-biometric generator (W4-002).
 *
 *   HR(t) = cosinor(t) + noise(t) + Σ episodes(t)
 *
 * and, on top of the clean signal, a separately-seeded artifact injector that emits what a
 * bad sensor emits. The clean series is the ANSWER KEY; the emitted lanes are the exam.
 *
 * Contract the rest of the wave depends on:
 *
 *  1. `truth` is never touched by artifacts. Toggling `artifacts` must leave every clean
 *     sample byte-identical, so a filter can be graded against the same body it was fed a
 *     corrupted view of. This is why the artifact RNG is a forked substream: sharing one
 *     stream would make the control run a different body (see sim/rng.js `fork`).
 *
 *  2. Nothing here reads the clock or the global RNG (§0.4 S9). `startAt` and `seed` are
 *     required parameters, and there is no default for either — a simulator that silently
 *     defaults to "now" produces runs nobody can reproduce, which is the one thing a
 *     replay harness may not do. A source-level tripwire in the test suite enforces it.
 *
 *  3. Both lanes emit through the shapes the REAL adapters accept:
 *       · socket      — `{ source: 'garmin', raw: { heartRate, activityType, startTimeLocal } }`
 *                       exactly as `scripts/biometric-mock.js` sends it (W4-000 review (f))
 *       · health store — `{ type, value, startDate, endDate }` for `normalizeHealthStoreSamples`
 *     The activity map below is a local copy of the adapter's, and a test round-trips EVERY
 *     entry through the real `normalize()` — the one-definition lesson from D11/W4-D05
 *     applied to a fixture: a copy is acceptable only when drift is caught loudly.
 *
 *  4. Ground truth is exposed twice, deliberately: `restingHeartRate` is the PARAMETRIC
 *     truth (the persona's declared circadian trough) and `empiricalRestingHeartRate` is
 *     what a P10-over-sleep estimator actually sees in this finite, noisy realisation.
 *     They differ by a bpm or two, and a later test that tightens its tolerance against
 *     the wrong one would be chasing sampling error, not estimator error.
 */

const { getPersona, karvonenZones } = require('./personas');
const { createRng } = require('./rng');
const { HR_MIN } = require('../app/services/wearable/hrRange');

const GENERATOR_VERSION = 1;

const DAY_MS  = 86400000;
const HOUR_MS = 3600000;
const OMEGA   = (2 * Math.PI) / 24; // rad per local hour

// healthStore.ingestBatch caps a request at 2000 samples; the mobile client chunks a
// backfill to match. The simulator chunks the same way so a replay exercises the real
// per-request path rather than one impossible mega-batch.
const MAX_BATCH = 2000;

/**
 * activity name → Garmin `activityType` id, the inverse of adapter.js's ACTIVITY_MAP.
 * `unknown` maps to an id the adapter does NOT know, so it resolves through the real
 * `?? 'unknown'` fallback instead of being special-cased here.
 */
const ACTIVITY_TO_GARMIN_TYPE = Object.freeze({
  resting: 0,
  running: 1,
  cycling: 2,
  swimming: 5,
  walking: 6,
  strength: 13,
  unknown: 99,
});

const HEALTH_STORE_TYPES = Object.freeze([
  'heart_rate', 'resting_heart_rate', 'hrv', 'sleep_deep', 'sleep_light', 'sleep_rem',
]);

// Per-sample probabilities. Sized so a one-week run at 60 s contains a few dozen of each
// class — enough for a filter's rejection rate to be measurable, far too few to dominate
// the signal (a stream that is 20% garbage tests nothing but the gate).
const DEFAULT_ARTIFACT_RATES = Object.freeze({
  dropout:            0.010,
  zero:               0.004,
  doubleCount:        0.004,
  spike:              0.006,
  flatline:           0.0015,
  timestampDuplicate: 0.004,
  timestampJitter:    0.010,
  futureTimestamp:    0.003,
});

// The batch lane comes off the phone's health store, which has already had one pass of
// vendor cleaning — same classes, an order of magnitude rarer.
const BATCH_ARTIFACT_SCALE = 0.35;

const ARTIFACT_ORDER = Object.freeze([
  'zero', 'doubleCount', 'spike', 'dropout', 'timestampDuplicate', 'timestampJitter', 'futureTimestamp',
]);

// ── pure time helpers (epoch arithmetic only — never host-local Date accessors) ──

/** Local hour-of-day in [0, 24) for an epoch ms and a tz offset in minutes. */
function _hourOfDay(tMs, tzOffsetMinutes) {
  const shifted = tMs + tzOffsetMinutes * 60000;
  const h = (shifted / HOUR_MS) % 24;
  return h < 0 ? h + 24 : h;
}

function _localMidnightMs(tMs, tz) {
  const shifted = tMs + tz * 60000;
  return Math.floor(shifted / DAY_MS) * DAY_MS - tz * 60000;
}

function _dateKey(tMs, tz) {
  return new Date(tMs + tz * 60000).toISOString().slice(0, 10);
}

function _dayOfWeek(tMs, tz) {
  return new Date(tMs + tz * 60000).getUTCDay();
}

function _clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
function _round1(x) { return Math.round(x * 10) / 10; }

function _quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const i = _clamp(Math.floor(q * (sorted.length - 1)), 0, sorted.length - 1);
  return sorted[i];
}

/** The persona's rhythm, in the exact parameterisation §M.3 inverts. */
function _cosinorAt(persona, tMs) {
  const h = _hourOfDay(tMs, persona.tzOffsetMinutes);
  return persona.cosinor.mesor
    + persona.cosinor.amplitude * Math.cos(OMEGA * (h - persona.cosinor.acrophaseHours));
}

/** Wrapping sleep window on local hour-of-day. */
function _isAsleep(persona, tMs) {
  const h = _hourOfDay(tMs, persona.tzOffsetMinutes);
  const start = persona.sleep.onsetHour;
  const end = (start + persona.sleep.durationHours) % 24;
  return start <= end ? (h >= start && h < end) : (h >= start || h < end);
}

/** Trapezoid in [0,1]: ramp up, plateau, ramp down. */
function _trapezoid(uMs, durMs, rampMs) {
  const ramp = Math.min(rampMs, durMs / 2);
  if (ramp <= 0) return 1;
  if (uMs < ramp) return uMs / ramp;
  if (uMs > durMs - ramp) return Math.max(0, (durMs - uMs) / ramp);
  return 1;
}

// ── episode scheduling ───────────────────────────────────────────────────────

function _buildEpisodes(persona, startAtMs, endAtMs, rng) {
  const tz = persona.tzOffsetMinutes;
  const zones = karvonenZones(persona);
  const placed = [];
  let nextId = 0;

  // Non-overlapping by construction. Overlap would make "the HR during episode X" an
  // ambiguous question, and every episode-scoped assertion downstream would inherit that
  // ambiguity; rejection-with-retry is a cheaper answer than a superposition model.
  const fits = (a, b) => !placed.some((p) => a < p.endMs && b > p.startMs);

  const place = (spec) => {
    for (let attempt = 0; attempt < 12; attempt++) {
      const jitterMs = (rng.next() * 2 - 1) * (spec.startJitterMin || 0) * 60000;
      const s = Math.round(spec.nominalStartMs + jitterMs);
      const e = s + spec.durationMs;
      if (e <= startAtMs || s >= endAtMs) return null; // outside the run entirely
      if (fits(s, e)) {
        const ep = { ...spec.episode, id: `e${nextId++}`, startMs: s, endMs: e };
        delete ep.nominalStartMs;
        placed.push(ep);
        return ep;
      }
    }
    return null;
  };

  const firstMidnight = _localMidnightMs(startAtMs, tz);
  for (let mid = firstMidnight; mid < endAtMs; mid += DAY_MS) {
    const dow = _dayOfWeek(mid + 12 * HOUR_MS, tz); // noon: immune to DST-ish edge cases
    const dateKey = _dateKey(mid + 12 * HOUR_MS, tz);

    for (const tpl of persona.episodes) {
      if (!tpl.days.includes(dow)) continue;
      const durationMs = tpl.durationMin * 60000;
      const nominalStartMs = mid + tpl.startHour * HOUR_MS;

      if (tpl.kind === 'stress') {
        // §M / mission: stress episodes are +15..25 bpm with HRV suppression. The clamp is
        // what makes that band a guarantee rather than an intention.
        const amplitudeBpm = _round1(_clamp(tpl.amplitudeBpm + rng.range(-2, 2), 15, 25));
        place({
          nominalStartMs, durationMs, startJitterMin: tpl.startJitterMin,
          episode: {
            kind: 'stress', activity: 'unknown', dateKey,
            amplitudeBpm, rampMs: Math.min(5 * 60000, durationMs / 3),
          },
        });
      } else {
        // workout / walk — a trapezoid into the template's Karvonen zone.
        const zi = _clamp(Math.round(tpl.zone), 1, 5) - 1;
        const band = zones.upper[zi] - zones.lower[zi];
        const targetHr = zones.lower[zi] + (0.25 + 0.5 * rng.next()) * band;
        place({
          nominalStartMs, durationMs, startJitterMin: tpl.startJitterMin,
          episode: {
            kind: tpl.kind, activity: tpl.activity, dateKey,
            zone: zi + 1, targetHr: _round1(targetHr),
            rampMs: (tpl.rampMin ?? 5) * 60000,
          },
        });
      }
    }

    // Ordinary-life bumps, scattered across the waking hours of this local day.
    const dl = persona.dailyLife;
    for (let i = 0; i < dl.bumpsPerDay; i++) {
      const hour = rng.range(0, 24);
      const at = mid + hour * HOUR_MS;
      if (_isAsleep(persona, at)) continue;
      const durationMs = Math.round(rng.range(dl.durationMinRange[0], dl.durationMinRange[1]) * 60000);
      const amplitudeBpm = _round1(rng.range(dl.amplitudeBpmRange[0], dl.amplitudeBpmRange[1]));
      place({
        nominalStartMs: at, durationMs, startJitterMin: 0,
        episode: {
          kind: 'dailyLife', activity: 'walking', dateKey,
          amplitudeBpm, rampMs: Math.round(durationMs / 3),
        },
      });
    }
  }

  placed.sort((a, b) => a.startMs - b.startMs);
  return placed;
}

// ── daily series (what the health store reports once a day) ──────────────────

function _buildDaily(persona, startAtMs, days, episodes, drift, rng) {
  const tz = persona.tzOffsetMinutes;
  const firstMidnight = _localMidnightMs(startAtMs, tz);
  const stressDays = new Set(episodes.filter((e) => e.kind === 'stress').map((e) => e.dateKey));
  const out = [];

  // Day-to-day wander in the resting rate: AR(1) so a drift detector (W4-012 CUSUM) has
  // realistic autocorrelated residuals to reject rather than white noise it beats trivially.
  let walk = rng.gaussian() * 1.2;
  let hrvWalk = rng.gaussian();

  for (let d = 0; d < days; d++) {
    const mid = firstMidnight + d * DAY_MS;
    const dateKey = _dateKey(mid + 12 * HOUR_MS, tz);
    walk = 0.6 * walk + Math.sqrt(1 - 0.36) * 1.2 * rng.gaussian();
    hrvWalk = 0.5 * hrvWalk + Math.sqrt(1 - 0.25) * rng.gaussian();

    const stressed = stressDays.has(dateKey);
    const suppression = stressed ? persona.hrv.stressSuppression : 0;

    let restingHeartRate = persona.restingHeartRate + walk;
    let hrv = persona.hrv.median * (1 - suppression) + hrvWalk * persona.hrv.mad * 0.6;

    // Injected monotone drift for change-point work (W4-012). Added AFTER the stochastic
    // series and consuming NO randomness, so a drifted run and its control share a stream
    // and differ by exactly the drift — otherwise "the detector fired" could just be a
    // different realisation.
    if (drift && d >= drift.startDay) {
      const delta = (d - drift.startDay) * drift.perDayBpm;
      if (drift.metric === 'restingHeartRate') restingHeartRate += delta;
      else if (drift.metric === 'hrv') hrv += delta;
    }

    const totalMin = _clamp(
      persona.sleep.durationHours * 60 + rng.range(-1, 1) * persona.sleep.durationJitterMin,
      181, 719,
    );
    const f = persona.sleep.stageFractions;
    const deepMin = _round1(totalMin * f.deep);
    const lightMin = _round1(totalMin * f.light);
    const remMin = _round1(_clamp(totalMin - deepMin - lightMin, 0, totalMin));

    out.push({
      dateKey,
      dayIndex: d,
      restingHeartRate: _round1(_clamp(restingHeartRate, HR_MIN, persona.maxHeartRate)),
      hrv: _round1(Math.max(1, hrv)),
      stressed,
      sleep: {
        deepMin, lightMin, remMin,
        totalMin: _round1(deepMin + lightMin + remMin),
        wakeMs: mid + (persona.sleep.onsetHour + persona.sleep.durationHours) * HOUR_MS,
      },
    });
  }
  return out;
}

// ── the clean signal ─────────────────────────────────────────────────────────

function _buildSamples(persona, startAtMs, n, stepMs, episodes, rng, stillRng) {
  const samples = new Array(n);
  const sigma = persona.noise.sigmaBpm;
  const isOu = persona.noise.family === 'ou';

  // A UNIT-variance process, scaled at use. Scaling the process itself would make the
  // sleep/wake sigma switch perturb the state, and the stationary spread would then depend
  // on how often the switch happened rather than on the persona.
  let u = isOu ? rng.gaussian() : 0;
  const tau = persona.noise.tauSeconds;
  const rho = isOu ? Math.exp(-(stepMs / 1000) / Math.max(1e-6, tau)) : 0;
  const rhoComp = isOu ? Math.sqrt(Math.max(0, 1 - rho * rho)) : 0;

  // Stillness chain: drives the ambient LABEL only, never the value.
  let still = true;
  const pLeaveStill = 1 - Math.exp(-(stepMs / 60000) / persona.stillness.stillDwellMin);
  const pLeaveMoving = 1 - Math.exp(-(stepMs / 60000) / persona.stillness.movingDwellMin);

  let ei = 0;
  for (let i = 0; i < n; i++) {
    const tMs = startAtMs + i * stepMs;

    if (isOu) u = rho * u + rhoComp * rng.gaussian();
    else u = rng.studentT(persona.noise.df);

    // advance the episode cursor (episodes are sorted and non-overlapping)
    while (ei < episodes.length && episodes[ei].endMs <= tMs) ei++;
    const ep = (ei < episodes.length && episodes[ei].startMs <= tMs) ? episodes[ei] : null;

    // `asleep` means asleep, not "inside the nominal sleep window". An episode whose start
    // jitter dips into that window (the athlete's 06:30 run at -30 min) means the body got
    // up early — and a sample carrying asleep:true at 168 bpm would both break the
    // "asleep implies resting" invariant and feed workout HR into the P10-over-sleep
    // resting estimate, which is the very contamination this fixture exists to expose.
    const asleep = !ep && _isAsleep(persona, tMs);
    const sigmaEff = sigma * (asleep ? persona.sleepNoiseFactor : 1);

    const base = _cosinorAt(persona, tMs);
    let hr = base + u * sigmaEff;
    let activity;

    if (ep) {
      const shape = _trapezoid(tMs - ep.startMs, ep.endMs - ep.startMs, ep.rampMs);
      const amp = ep.kind === 'workout' || ep.kind === 'walk'
        ? ep.targetHr - _cosinorAt(persona, ep.startMs)
        : ep.amplitudeBpm;
      hr += Math.max(0, amp) * shape;
      activity = ep.activity;
    } else if (asleep) {
      activity = 'resting';
    } else {
      if (still ? stillRng.next() < pLeaveStill : stillRng.next() < pLeaveMoving) still = !still;
      activity = still ? 'resting' : 'unknown';
    }

    samples[i] = {
      tMs,
      hr: _round1(_clamp(hr, HR_MIN, persona.maxHeartRate)),
      activity,
      asleep,
      episode: ep ? { id: ep.id, kind: ep.kind, activity: ep.activity } : null,
    };
  }
  return samples;
}

// ── artifacts ────────────────────────────────────────────────────────────────

function _resolveRates(artifacts, scale = 1) {
  const zeroes = {};
  for (const k of Object.keys(DEFAULT_ARTIFACT_RATES)) zeroes[k] = 0;
  if (artifacts === false) return zeroes;
  const base = {};
  for (const [k, v] of Object.entries(DEFAULT_ARTIFACT_RATES)) base[k] = v * scale;
  if (artifacts === true || artifacts === undefined || artifacts === null) return base;
  if (typeof artifacts !== 'object') {
    throw new TypeError('sim/generate: `artifacts` must be a boolean or a rate map');
  }
  const merged = { ...base };
  for (const [k, v] of Object.entries(artifacts)) {
    if (!(k in DEFAULT_ARTIFACT_RATES)) {
      throw new RangeError(`sim/generate: unknown artifact class "${k}"`);
    }
    if (!(Number.isFinite(v) && v >= 0 && v <= 1)) {
      throw new RangeError(`sim/generate: artifact rate for "${k}" must be in [0,1]`);
    }
    merged[k] = v;
  }
  return merged;
}

/**
 * Corrupt a point series. Points are `{atMs, hr, ...rest}`; the returned emitted series is
 * a NEW array (the input is never mutated — it is the answer key).
 *
 * At most ONE artifact class per sample. Overlapping classes would make the emitted/clean
 * count arithmetic unverifiable, and "how many samples did the filter reject" is exactly
 * the number W4-003 has to be graded on.
 */
function _injectArtifacts(points, rates, rng, lane, endAtMs) {
  const n = points.length;
  const claimed = new Array(n).fill(null);
  const artifacts = [];

  // Pass 1 — flatlines, which claim a RUN. A stuck sensor repeats a value for a while;
  // a one-sample "flatline" is indistinguishable from ordinary noise and would let a
  // filter score a hit it never earned.
  for (let i = 0; i < n; i++) {
    if (claimed[i]) continue;
    const roll = rng.next();
    const runLength = 3 + rng.int(5);
    if (roll >= rates.flatline) continue;
    const end = Math.min(n, i + runLength);
    if (end - i < 3) continue;
    for (let j = i; j < end; j++) claimed[j] = { kind: 'flatline', start: i };
    artifacts.push({
      kind: 'flatline', lane, index: i, atMs: points[i].atMs,
      emittedAtMs: points[i].atMs, truthHr: points[i].hr,
      emittedHr: points[i].hr, runLength: end - i,
    });
  }

  // Pass 2 — one draw per remaining sample across the mutually exclusive classes.
  for (let i = 0; i < n; i++) {
    if (claimed[i]) continue;
    const u = rng.next();
    let acc = 0;
    for (const kind of ARTIFACT_ORDER) {
      acc += rates[kind];
      if (u < acc) { claimed[i] = { kind, start: i }; break; }
    }
  }

  const emitted = [];
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const c = claimed[i];
    if (!c) { emitted.push({ ...p }); continue; }

    let hr = p.hr;
    let atMs = p.atMs;
    let duplicate = false;
    let dropped = false;

    switch (c.kind) {
      case 'flatline':
        hr = points[c.start].hr;
        break;
      case 'zero':
        hr = 0;
        break;
      case 'doubleCount':
        // PPG counting each beat twice. Below ~110 bpm this lands back inside the
        // physiological range and is the filter's problem; above it, the ingest gate's.
        hr = hr * 2;
        break;
      case 'spike':
        // Deliberately kept inside 30..220: an out-of-range spike is caught by
        // isValidReading and never reaches the statistical filter it exists to test.
        hr = Math.min(219, hr + 35 + rng.int(20));
        break;
      case 'timestampJitter':
        atMs = p.atMs + (rng.int(2) ? 1 : -1) * (1000 + rng.int(20000));
        break;
      case 'futureTimestamp':
        // The Garmin-backfill trap §0.4 S6 pins: a real reading carrying a timestamp
        // beyond the horizon. Placed well past the run's end so "future" is unambiguous.
        atMs = endAtMs + DAY_MS + rng.int(30) * DAY_MS;
        break;
      case 'timestampDuplicate':
        duplicate = true;
        break;
      case 'dropout':
        dropped = true;
        break;
      default:
        break;
    }

    if (c.kind !== 'flatline') {
      artifacts.push({
        kind: c.kind, lane, index: i, atMs: p.atMs,
        emittedAtMs: dropped ? p.atMs : atMs,
        truthHr: p.hr, emittedHr: dropped ? null : hr,
      });
    }

    if (dropped) continue;
    emitted.push({ ...p, atMs, hr });
    if (duplicate) emitted.push({ ...p, atMs, hr });
  }

  return { emitted, artifacts };
}

// ── lanes ────────────────────────────────────────────────────────────────────

function _toSocketEvents(points) {
  return points.map((p) => ({
    atMs: p.atMs,
    event: 'biometric_push',
    payload: {
      source: 'garmin',
      raw: {
        heartRate: Math.round(p.hr),
        activityType: ACTIVITY_TO_GARMIN_TYPE[p.activity] ?? ACTIVITY_TO_GARMIN_TYPE.unknown,
        startTimeLocal: new Date(p.atMs).toISOString(),
      },
    },
  }));
}

function _chunk(rows, size) {
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

function _toHealthStoreBatches(hrPoints, daily, platform) {
  const rows = [];
  const sample = (type, value, atMs, endMs) => ({
    type,
    value,
    startDate: new Date(atMs).toISOString(),
    endDate: new Date(endMs ?? atMs).toISOString(),
  });

  for (const p of hrPoints) rows.push(sample('heart_rate', Math.round(p.hr), p.atMs));
  for (const d of daily) {
    const at = d.sleep.wakeMs;
    rows.push(sample('resting_heart_rate', Math.round(d.restingHeartRate), at));
    rows.push(sample('hrv', Math.round(d.hrv), at));
    rows.push(sample('sleep_deep', d.sleep.deepMin, at - d.sleep.totalMin * 60000, at));
    rows.push(sample('sleep_light', d.sleep.lightMin, at - d.sleep.totalMin * 60000, at));
    rows.push(sample('sleep_rem', d.sleep.remMin, at - d.sleep.totalMin * 60000, at));
  }

  rows.sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0));
  return { platform, batches: _chunk(rows, MAX_BATCH) };
}

// ── entry point ──────────────────────────────────────────────────────────────

/**
 * @param {object}  opts
 * @param {string|object} opts.persona            persona id or object (required)
 * @param {number|string} opts.seed               required — no default, by design
 * @param {number|Date}   opts.startAt            required — no default, by design (S9)
 * @param {number} [opts.days=1]
 * @param {number} [opts.sampleIntervalSec=60]    live/socket-lane cadence
 * @param {number} [opts.batchSampleIntervalSec=300] health-store cadence
 * @param {boolean|object} [opts.artifacts=true]  true | false | per-class rate map
 * @param {object} [opts.drift]                   {metric, startDay, perDayBpm}
 * @param {string} [opts.platform='health_connect']
 * @param {function} [opts.logger]                receives the single telemetry line
 */
function generate(opts = {}) {
  const t0 = process.hrtime.bigint();

  const persona = getPersona(opts.persona);

  const seed = opts.seed;
  if (!(typeof seed === 'string' || (typeof seed === 'number' && Number.isFinite(seed)))) {
    throw new TypeError('sim/generate: `seed` is required and must be a finite number or string');
  }
  const startAtMs = opts.startAt instanceof Date ? opts.startAt.getTime() : opts.startAt;
  if (!(typeof startAtMs === 'number' && Number.isFinite(startAtMs))) {
    throw new TypeError('sim/generate: `startAt` is required (epoch ms or Date) — sim never reads the clock');
  }
  const days = opts.days ?? 1;
  if (!(Number.isFinite(days) && days > 0)) {
    throw new RangeError('sim/generate: `days` must be > 0');
  }
  const sampleIntervalSec = opts.sampleIntervalSec ?? 60;
  if (!(Number.isFinite(sampleIntervalSec) && sampleIntervalSec > 0)) {
    throw new RangeError('sim/generate: `sampleIntervalSec` must be > 0');
  }
  const batchSampleIntervalSec = opts.batchSampleIntervalSec ?? 300;
  if (!(Number.isFinite(batchSampleIntervalSec) && batchSampleIntervalSec > 0)) {
    throw new RangeError('sim/generate: `batchSampleIntervalSec` must be > 0');
  }
  if (opts.drift) {
    const d = opts.drift;
    if (!['restingHeartRate', 'hrv'].includes(d.metric)) {
      throw new RangeError(`sim/generate: drift.metric must be restingHeartRate or hrv (got ${d.metric})`);
    }
    if (!Number.isFinite(d.startDay) || !Number.isFinite(d.perDayBpm)) {
      throw new RangeError('sim/generate: drift needs finite startDay and perDayBpm');
    }
  }

  const stepMs = sampleIntervalSec * 1000;
  const endAtMs = startAtMs + days * DAY_MS;
  const n = Math.floor((days * DAY_MS) / stepMs);

  // One root, four named substreams. Adding a fifth later cannot shift the existing four.
  const root = createRng(seed);
  const episodeRng  = root.fork(`${persona.id}:episodes`);
  const noiseRng    = root.fork(`${persona.id}:noise`);
  const stillRng    = root.fork(`${persona.id}:stillness`);
  const dailyRng    = root.fork(`${persona.id}:daily`);
  const socketArtRng = root.fork(`${persona.id}:artifacts:socket`);
  const batchArtRng  = root.fork(`${persona.id}:artifacts:batch`);

  const episodes = _buildEpisodes(persona, startAtMs, endAtMs, episodeRng);
  const daily = _buildDaily(persona, startAtMs, Math.round(days), episodes, opts.drift, dailyRng);
  const samples = _buildSamples(persona, startAtMs, n, stepMs, episodes, noiseRng, stillRng);

  const asleepHr = samples.filter((s) => s.asleep).map((s) => s.hr).sort((a, b) => a - b);
  const allHr = samples.map((s) => s.hr).sort((a, b) => a - b);
  const empiricalRestingHeartRate = _round1(
    asleepHr.length >= 10 ? _quantile(asleepHr, 0.10) : _quantile(allHr, 0.05),
  );

  // ── lanes ──
  const socketRates = _resolveRates(opts.artifacts, 1);
  const socketPoints = samples.map((s) => ({ atMs: s.tMs, hr: s.hr, activity: s.activity }));
  const socketOut = _injectArtifacts(socketPoints, socketRates, socketArtRng, 'socket', endAtMs);

  const batchRates = _resolveRates(opts.artifacts, BATCH_ARTIFACT_SCALE);
  const batchStep = Math.max(1, Math.round(batchSampleIntervalSec / sampleIntervalSec));
  const batchPoints = [];
  for (let i = 0; i < samples.length; i += batchStep) {
    batchPoints.push({ atMs: samples[i].tMs, hr: samples[i].hr, activity: samples[i].activity });
  }
  const batchOut = _injectArtifacts(batchPoints, batchRates, batchArtRng, 'healthStore', endAtMs);

  const healthStore = _toHealthStoreBatches(
    batchOut.emitted, daily, opts.platform ?? 'health_connect',
  );

  const run = {
    v: GENERATOR_VERSION,
    meta: {
      personaId: persona.id,
      holdout: persona.holdout,
      seed,
      startAtMs,
      endAtMs,
      days,
      sampleIntervalSec,
      batchSampleIntervalSec,
      sampleCount: samples.length,
      tzOffsetMinutes: persona.tzOffsetMinutes,
    },
    truth: {
      cosinor: { ...persona.cosinor },
      restingHeartRate: persona.restingHeartRate,
      empiricalRestingHeartRate,
      maxHeartRate: persona.maxHeartRate,
      zones: karvonenZones(persona),
      samples,
      episodes,
      daily,
    },
    socket: { events: _toSocketEvents(socketOut.emitted) },
    healthStore,
    artifacts: [...socketOut.artifacts, ...batchOut.artifacts],
  };

  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  run.timings = { ms: Math.round(ms * 100) / 100 };
  // House single-line telemetry (S15). Counts and timings ONLY — never a bpm/HRV value,
  // even a synthetic one: the habit is what keeps the zero-knowledge grep honest.
  run.telemetry = `[sim.generate] persona=${persona.id} holdout=${persona.holdout} `
    + `seed=${seed} days=${days} interval=${sampleIntervalSec}s samples=${samples.length} `
    + `episodes=${episodes.length} artifacts=${run.artifacts.length} `
    + `socketEvents=${run.socket.events.length} batches=${healthStore.batches.length} `
    + `ms=${run.timings.ms}`;
  if (typeof opts.logger === 'function') opts.logger(run.telemetry);

  return run;
}

module.exports = {
  generate,
  GENERATOR_VERSION,
  ACTIVITY_TO_GARMIN_TYPE,
  HEALTH_STORE_TYPES,
  DEFAULT_ARTIFACT_RATES,
  MAX_BATCH,
  _hourOfDay,
  _cosinorAt,
  _isAsleep,
  _trapezoid,
};
