'use strict';

// W4-D63 — THE SECOND SOAK LANE: how many taxonomy states can the REAL seams reach?
//
// W4-015's first Definition of Done is "every taxonomy state hit". Three suites bear on it and
// until now none of them could answer it:
//
//   · `stateTaxonomy.reachability.test.js` reaches all 34 — but drives `updateAffect` DIRECTLY,
//     handing it the whole evidence bundle. It measures the engine, not the product.
//   · `sim.fullStackSoak.test.js` reaches 11 over a simulated day of the whole persona
//     population — through the real socket stack — and asserts only `hit.length > 2`. Honest
//     about being a floor, but a floor is not a number a closeout can cite.
//   · nothing measured the SERVING path at all, which is the lane that actually shapes a mix.
//
// The reflex reading of 34-vs-11 is "the corpus is too small; simulate more days". Measured, that
// is wrong, and this suite is the measurement. The limit is the SEAM: each of the seven axes only
// carries mass when some lane supplied its evidence, and the two production lanes forward very
// different bundles into the one composition (`affectService.resolveAffect`) they share:
//
//   live    → liveStateAdapter.onlineUpdate  → { live, baselines }
//   serving → targetsBuilder.buildTargets    → { live, baselines, state, sleep, taps }
//
// THE EXPERIMENT IS CONTROLLED ON PURPOSE. Both lanes get the SAME 34 authored moments from
// `sim/stateScripts.js` and the SAME personal baseline blob, written through the real
// `cacheBaselines` and read back through the real `peekBaselines`. The corpus, the baselines, the
// engine, the taxonomy and the clock are therefore held constant across the two lanes, so the
// ONLY variable left is which evidence the seam forwards — which is the variable under test. A
// lane that re-derived its own baselines would confound "this seam is blind to sleep" with "this
// persona's blob came out slightly different", and those two need different fixes.
//
// WHAT IS OBSERVED, AND HOW. `resolveAffect` is wrapped in a PASS-THROUGH spy: the real
// implementation runs, its real return value is returned, and the projection is recorded on the
// way past. It has to be a `jest.mock` factory rather than a `spyOn` because both lanes destructure
// `resolveAffect` at require time. Nothing about either lane's behaviour changes — the spy reads,
// it does not answer.
//
// GATING (W4-D60's rule, applied to the corpus rather than to the persona list): the full
// 34-script sweep is `RUN_SOAK=1`; the default budget runs a strided six that spans the domains.
// The number W4-015 cites comes from the gated run, and the ungated one keeps the wiring alive.

process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET = 'test-jwt-secret-for-tests-only';
// W4-000/S1a: a shell-exported REDIS_URL would make the baseline refresh construct a real BullMQ
// Queue against a host that does not exist.
delete process.env.REDIS_URL;

jest.mock('../app/config/redis', () => ({ getRedis: jest.fn(), createConnection: jest.fn() }));

// The pass-through spy. `calls` lives inside the factory because jest hoists it above every
// import; nothing outside may be referenced from here.
jest.mock('../app/services/biosonic/affectService', () => {
  const actual = jest.requireActual('../app/services/biosonic/affectService');
  const calls = [];
  return {
    ...actual,
    __calls: calls,
    resolveAffect: jest.fn(async (args) => {
      const affect = await actual.resolveAffect(args);
      calls.push({ args, affect });
      return affect;
    }),
  };
});

jest.mock('../app/config/sentry', () => ({
  initSentry: jest.fn(), getSentry: jest.fn(() => null),
  captureException: jest.fn(), scrubEvent: jest.fn((e) => e),
}));

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { SCRIPTS, momentFor, startOfScript } = require('../sim/stateScripts');
const {
  measureStateCoverage, coverageScope, formatMisses, MISS_REASONS,
} = require('../sim/stateCoverage');
const { STATES, byId } = require('../app/agents/runtime/knowledge/stateTaxonomy');
const { getRedis } = require('../app/config/redis');
const affectService = require('../app/services/biosonic/affectService');
const { cacheBaselines, peekBaselines } = require('../app/services/biosonic/baselines');
const { buildTargets } = require('../app/services/generation/targetsBuilder');
const { onlineUpdate } = require('../app/agents/runtime/physiology/liveStateAdapter');
const MedicalProfile = require('../app/models/MedicalProfile');

jest.setTimeout(300000);

/** Long enough for the dwell gate to settle a label — the reachability suite's own hold. */
const HOLD_MINUTES = 30;

const FULL = process.env.RUN_SOAK === '1';
const SCOPE = coverageScope(SCRIPTS, { full: FULL });

// Assertions that only MEAN anything over the whole corpus. A strided six can tie on a metric the
// full 34 separate cleanly, and a floor pinned from a subset would be a number about the subset.
const soakTest = FULL ? test : test.skip;

function fakeRedis() {
  const store = new Map();
  return {
    store,
    get: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    set: jest.fn(async (k, v) => { store.set(k, v); return 'OK'; }),
    del: jest.fn(async (...ks) => ks.filter((k) => store.delete(k)).length),
  };
}

const flush = async (turns = 20) => { for (let i = 0; i < turns; i++) await Promise.resolve(); };

let mem;

beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_wave4_state_coverage' });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});

beforeEach(async () => {
  await MedicalProfile.deleteMany({});
  affectService.__calls.length = 0;
  getRedis.mockReturnValue(fakeRedis());
});

/**
 * Put one script's world into the real stores, and hand back the moment it describes.
 *
 * The baseline blob is stamped `computedAt: now` in REAL time even though every reading is
 * replayed in 2026-08 sim time, because `peekBaselines` grades freshness against the wall clock
 * and a blob it reads as stale would kick off a background refresh that has nothing to refresh
 * from. The stamp is the only value here that is not the corpus's own.
 */
async function seedWorld(script) {
  const uid = new mongoose.Types.ObjectId().toString();
  const moment = momentFor(script.persona, script.spec);

  await cacheBaselines(uid, { ...moment.baselines, computedAt: new Date().toISOString() });

  // The serving lane reads these off the encrypted profile; `create` runs the encrypting setters,
  // `findOneAndUpdate($set)` would not (§0.2.2).
  await MedicalProfile.create({
    userId: uid,
    hrv: moment.state.hrv,
    bodyBattery: moment.state.bodyBattery,
    dailyReadiness: moment.state.dailyReadiness,
    ...(moment.sleep.lastNight ? { lastNightSleep: { ...moment.sleep.lastNight, date: new Date() } } : {}),
  });

  return { uid, moment, t0: startOfScript(script.persona, script.spec) };
}

/** The last projection `resolveAffect` returned during this script's hold. */
function lastAffect() {
  const calls = affectService.__calls;
  for (let i = calls.length - 1; i >= 0; i--) if (calls[i].affect) return calls[i].affect;
  return null;
}

/** Drive one script through one lane and reduce it to the triple `measureStateCoverage` folds. */
async function runScript(script, drive) {
  affectService.__calls.length = 0;
  const world = await seedWorld(script);
  for (let m = 0; m < HOLD_MINUTES; m++) {
    await drive(world, world.t0 + m * 60e3);
    await flush();
  }
  const affect = lastAffect();
  const forwarded = affectService.__calls.length ? affectService.__calls.at(-1).args : {};
  return {
    target: script.target,
    persona: script.persona,
    label: affect?.label ?? null,
    axes: affect?.axes ?? null,
    forwarded: Object.keys(forwarded).filter((k) => forwarded[k] != null && k !== 'userId' && k !== 'now'),
  };
}

/** The SERVING lane, exactly as a generation calls it. */
const driveServing = ({ uid, moment }, now) => buildTargets({
  userId: uid, live: moment.live, taps: moment.taps, now,
});

/** The LIVE socket lane, exactly as `handleBiometricReading` calls it. */
async function driveLive({ uid, moment }, now) {
  const baselines = await peekBaselines(uid);
  return onlineUpdate(
    uid,
    { level: moment.live.heartRate, confidence: moment.live.confidence, degraded: moment.live.degraded },
    { activity: moment.live.activity, now, baselines },
  );
}

async function sweep(lane, drive) {
  const results = [];
  for (const script of SCOPE) results.push(await runScript(script, drive));
  const report = measureStateCoverage({ lane, states: STATES, results });
  console.log(report.line);
  for (const line of formatMisses(report)) console.log(line);
  return { report, results };
}

// ── the sweeps ───────────────────────────────────────────────────────────────────────────────
//
// Both lanes are swept ONCE in a `beforeAll`, because a sweep is the expensive part (34 scripts ×
// 30 held minutes × real Mongo and cache I/O) and every assertion below is a different question
// about the same two measurements. Re-sweeping per assertion would buy nothing: the sweep is
// deterministic — a fixed corpus, fixed baselines, injected sim time, no randomness anywhere.

let serving;
let live;

describe(`taxonomy coverage through the real seams (${FULL ? 'FULL' : 'default'} scope: ${SCOPE.length}/${SCRIPTS.length} scripts)`, () => {
  beforeAll(async () => {
    getRedis.mockReturnValue(fakeRedis());
    serving = await sweep('serving', driveServing);
    live = await sweep('live', driveLive);
  }, 280000);

  test('the scope is the RUN_SOAK-gated corpus, and every script in it produced a result', () => {
    expect(SCOPE.length).toBe(FULL ? SCRIPTS.length : 6);
    if (FULL) expect(SCOPE.map((s) => s.target)).toEqual(SCRIPTS.map((s) => s.target));
    for (const r of [serving, live]) {
      expect(r.results).toHaveLength(SCOPE.length);
      expect(r.report.targetedCount).toBe(SCOPE.length);
      expect(r.report.unknownLabels).toEqual([]);
    }
  });

  test('coverage is reported as a NUMBER on both lanes, not as a floor', () => {
    for (const { report } of [serving, live]) {
      expect(Number.isFinite(report.coverage)).toBe(true);
      expect(report.coverage).toBeGreaterThanOrEqual(0);
      expect(report.coverage).toBeLessThanOrEqual(1);
      expect(report.reachedCount + report.missed.length).toBeGreaterThanOrEqual(report.targetedCount);
      expect(report.taxonomySize).toBe(STATES.length);
    }
  });

  test('EVERY state the lane did not reach is named with a reason from the closed vocabulary', () => {
    // This is W4-D63's Definition of Done. A closeout may say "23 states were not reached and
    // here is why each one was not" — it may not say "the soak hit the states it hit".
    for (const { report } of [serving, live]) {
      for (const m of report.missed) {
        expect(Object.values(MISS_REASONS)).toContain(m.reason);
        expect(byId(m.id)).not.toBeNull();
        expect(m.explain).toEqual(expect.any(String));
        expect(m.explain.length).toBeGreaterThan(0);
        if (m.reason === MISS_REASONS.SIGNAL_ABSENT) {
          expect(m.abstainedRequired.length).toBeGreaterThan(0);
          // the named axes are ones the state genuinely requires, never a scattergun list
          for (const a of m.abstainedRequired) expect(m.requiredSignals).toContain(a);
        }
      }
      expect(report.reachedCount).toBe(new Set(report.reached).size);
    }
  });

  test('the serving lane never reaches FEWER states than the live lane', () => {
    // Scope-independent half of the load-bearing claim. The serving bundle is a strict superset
    // of the live one, so on identical corpus, baselines, engine and clock the richer lane can
    // never come out behind — at any scope, including the strided six.
    expect(serving.report.reachedCount).toBeGreaterThanOrEqual(live.report.reachedCount);
    expect(serving.report.coverage).toBeGreaterThanOrEqual(live.report.coverage);
  });

  soakTest('over the WHOLE corpus the serving lane reaches strictly more, and the numbers are pinned', () => {
    // THE NUMBER W4-015 CITES. Measured, not claimed:
    //
    //   serving  21/34 states, coverage 0.618, 13 unreached,  0 structural blind spots
    //   live     13/34 states, coverage 0.382, 21 unreached,  7 structural blind spots
    //
    // Floors rather than equalities: a retune that reaches MORE states is the point of the wave
    // and must not turn this suite red, while a regression that reaches fewer must.
    expect(serving.report.reachedCount).toBeGreaterThanOrEqual(21);
    expect(live.report.reachedCount).toBeGreaterThanOrEqual(13);
    expect(serving.report.reachedCount).toBeGreaterThan(live.report.reachedCount);
    expect(serving.report.coverage).toBeGreaterThan(live.report.coverage);
  });

  soakTest('the live lane has STRUCTURAL blind spots and the serving lane has none', () => {
    // The sharpest thing this measurement says, and the reason "simulate more days" was the wrong
    // reading of the 34-vs-11 gap:
    //
    //   · every serving-lane miss is a CONTEST — the lane saw every axis the state requires and
    //     another state won the posterior. More simulated days would not change that; the states
    //     are reachable there and the misses are a tuning question.
    //   · seven live-lane misses are BLIND SPOTS — `valence` (no mood tap crosses the seam),
    //     `recovery` and `stress` (no sleep, HRV, body battery or readiness cross it). No amount
    //     of simulated time reaches those, because the evidence never arrives.
    const blind = (r) => r.report.missed.filter((m) => m.reason === MISS_REASONS.SIGNAL_ABSENT);
    expect(blind(serving)).toEqual([]);
    expect(blind(live).length).toBeGreaterThanOrEqual(7);

    // and the blindness is attributable to specific axes, not diffuse
    const axes = new Set(blind(live).flatMap((m) => m.abstainedRequired));
    expect([...axes].sort()).toEqual(['recovery', 'stress', 'valence']);
  });

  test('the live lane forwards a strictly SMALLER evidence bundle, which is why', () => {
    // Measured at the seam rather than read off the source, so a future lane that starts
    // forwarding sleep makes this test fail rather than quietly making its comment wrong.
    const bundleOf = (r) => new Set(r.results.flatMap((x) => x.forwarded));
    const servingBundle = bundleOf(serving);
    const liveBundle = bundleOf(live);
    for (const k of liveBundle) expect([...servingBundle]).toContain(k);
    expect(servingBundle.size).toBeGreaterThan(liveBundle.size);
    expect([...liveBundle].sort()).toEqual(['baselines', 'live', 'tzOffsetMinutes']);
    for (const k of ['state', 'sleep', 'taps']) expect([...servingBundle]).toContain(k);
  });

  test('every live-lane blind spot is a state requiring an axis the live bundle cannot feed', () => {
    // `sleep`, `state` (HRV / body battery / readiness) and `taps` never cross the live seam, so
    // `recovery`, `fatigue` and `valence` are the axes that can abstain there for a STRUCTURAL
    // reason. An abstention on `arousal` or `exertion` would be a different bug — the live lane
    // does forward a heart rate — and this pin is what tells the two apart.
    const structural = new Set(['recovery', 'fatigue', 'valence', 'stress', 'circadianAlertness']);
    for (const m of live.report.missed) {
      if (m.reason !== MISS_REASONS.SIGNAL_ABSENT) continue;
      for (const a of m.abstainedRequired) expect([...structural]).toContain(a);
    }
  });

  test('no state is reported on a lane that never saw the evidence it requires', () => {
    // The honesty guarantee, in the coverage report's own terms: a REACHED state must have had
    // mass on every axis it declares required, on the run that reached it. A lane that named a
    // recovery state without a single recovery signal would be fabricating.
    for (const { results } of [serving, live]) {
      for (const r of results) {
        if (!r.label) continue;
        for (const axis of byId(r.label).requiredSignals) {
          expect(r.axes?.[axis]?.mass).toBeGreaterThan(0);
        }
      }
    }
  });

  test('the report reveals no numeric vital (§0.2.2)', () => {
    // The coverage report is destined for a soak log and the closeout package, so it is held to
    // the same bar as every other line this wave emits: state vocabulary and counts, never a
    // reading. `coverage=` is a ratio in [0,1] and the counts are bounded by the corpus.
    for (const { report } of [serving, live]) {
      const text = [report.line, ...formatMisses(report)].join('\n');
      expect(text).not.toMatch(/heartRate|bpm|hrv=|\bhr=/i);
      expect(text).not.toMatch(/\b(?:[7-9]\d|1\d\d|2[0-2]\d)\.\d/);
    }
  });
});
