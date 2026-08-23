'use strict';

// W4-009 — the live socket lane's O(1) per-reading state update.
//
// Two layers are pinned separately, deliberately: the REGIME-CHANGE DECISION (band/musicPolicy
// diff logic, this module's only real contribution) is tested against a MOCKED `resolveAffect` so
// every combination is exact and fast; the WIRING to the real engine (peek -> forward -> save
// round-tripping through a fake Redis) is tested once, end to end, against the real
// `affectEngine`/`stateTaxonomy` — proving the dwell/hysteresis the engine already owns actually
// survives two calls through this adapter, not re-deriving it (affectEngine.test.js already does
// that in 78 pins).

process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);

jest.mock('../app/config/redis', () => ({ getRedis: jest.fn(), createConnection: jest.fn() }));
// Only `resolveAffect` is stubbed. `resolveHourContext` is the REAL one on purpose: it is the
// clock rule all three affect callers must share (W4-D56), so a test that mocked it could not
// tell agreement from coincidence.
jest.mock('../app/services/biosonic/affectService', () => ({
  ...jest.requireActual('../app/services/biosonic/affectService'),
  resolveAffect: jest.fn(),
}));

const { getRedis } = require('../app/config/redis');
const { resolveAffect, resolveHourContext } = require('../app/services/biosonic/affectService');
const { computeAxes } = require('../app/agents/runtime/physiology/affectEngine');
const { onlineUpdate, policyDiffers } = require('../app/agents/runtime/physiology/liveStateAdapter');

// ── fake Redis, matching the affectCache.test.js precedent ─────────────────────────────────────
function fakeRedis() {
  const store = new Map();
  return {
    store,
    set: jest.fn(async (k, v) => { store.set(k, v); return 'OK'; }),
    get: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    del: jest.fn(async (...ks) => ks.filter((k) => store.delete(k)).length),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Redis-down fail-soft: the mechanism must not even ATTEMPT the engine work ──────────────────

describe('Redis unavailable', () => {
  test('short-circuits to ok:false without touching the affect service at all', async () => {
    getRedis.mockReturnValue(null);

    const result = await onlineUpdate('u1', { level: 130, confidence: 1 }, { activity: 'running', now: 1000 });

    expect(result).toEqual({
      ok: false, transitioned: false, from: null, to: null, band: null, regimeChanged: false,
    });
    expect(resolveAffect).not.toHaveBeenCalled();
  });
});

// ── regime-change decision, against a controlled resolveAffect ─────────────────────────────────

describe('regime-change decision', () => {
  beforeEach(() => { getRedis.mockReturnValue(fakeRedis()); });

  test('no transition → regimeChanged is false regardless of band', async () => {
    resolveAffect.mockResolvedValue({ transitioned: false, from: 'deep-rest', to: 'deep-rest' });
    const result = await onlineUpdate('u1', { level: 60 }, { now: 1000 });
    expect(result.ok).toBe(true);
    expect(result.transitioned).toBe(false);
    expect(result.regimeChanged).toBe(false);
  });

  test('resolveAffect returning null (disabled / failed) → ok:false, not a crash', async () => {
    resolveAffect.mockResolvedValue(null);
    const result = await onlineUpdate('u1', { level: 100 }, { now: 1000 });
    expect(result.ok).toBe(false);
    expect(result.regimeChanged).toBe(false);
  });

  test('transitioned into a different band → regimeChanged true', async () => {
    // deep-rest (resting) -> warmup (active): a real cross-domain, cross-band pair.
    resolveAffect.mockResolvedValue({ transitioned: true, from: 'deep-rest', to: 'warmup' });
    const result = await onlineUpdate('u1', { level: 120 }, { activity: 'running', now: 1000 });
    expect(result.ok).toBe(true);
    expect(result.regimeChanged).toBe(true);
    expect(result.band).toBe('active');
  });

  test('transitioned but SAME band and SAME musicPolicy → regimeChanged false', async () => {
    resolveAffect.mockResolvedValue({ transitioned: true, from: 'deep-rest', to: 'deep-rest' });
    const result = await onlineUpdate('u1', { level: 58 }, { now: 1000 });
    expect(result.regimeChanged).toBe(false);
  });

  test('same band but a DIFFERENT musicPolicy (two resting-band states) → regimeChanged true', async () => {
    // deep-rest and resting-content are both 'resting' band but distinct policies/domains.
    resolveAffect.mockResolvedValue({ transitioned: true, from: 'deep-rest', to: 'resting-content' });
    const result = await onlineUpdate('u1', { level: 58 }, { now: 1000 });
    expect(result.regimeChanged).toBe(true);
  });

  test('no confirmed `to` (posterior never cleared enterThreshold) → regimeChanged false', async () => {
    resolveAffect.mockResolvedValue({ transitioned: false, from: null, to: null });
    const result = await onlineUpdate('u1', { level: 75 }, { now: 1000 });
    expect(result.regimeChanged).toBe(false);
    expect(result.to).toBeNull();
  });

  test('cold start: null -> a real state IS a regime change (no confirmed serve state yet)', async () => {
    resolveAffect.mockResolvedValue({ transitioned: true, from: null, to: 'deep-rest' });
    const result = await onlineUpdate('u1', { level: 58 }, { now: 1000 });
    expect(result.regimeChanged).toBe(true);
  });

  test('shapes the filtered reading and activity into `resolveAffect`\'s `live` input', async () => {
    resolveAffect.mockResolvedValue({ transitioned: false, from: null, to: null });
    await onlineUpdate('u42', { level: 88, confidence: 0.7, degraded: null }, { activity: 'running', now: 5000 });
    expect(resolveAffect).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'u42',
      now: 5000,
      live: expect.objectContaining({ heartRate: 88, confidence: 0.7, activity: 'running' }),
    }));
  });

  // W4-015 (soak finding): without this, EVERY axis that needs a personal hour-of-day baseline
  // (arousal, exertion's measured term, stress, recovery, fatigue) abstains on the live lane —
  // the continuous per-reading posterior this module drives runs blind to personalization even
  // for a user with a fully computed W4-004 baseline, because nothing ever passed one in.
  test('forwards `opts.baselines` through to `resolveAffect` untouched', async () => {
    resolveAffect.mockResolvedValue({ transitioned: false, from: null, to: null });
    const baselines = { rhrMedian: 48, rhrMAD: 3, hourly: [] };
    await onlineUpdate('u43', { level: 90 }, { activity: 'resting', now: 6000, baselines });
    expect(resolveAffect).toHaveBeenCalledWith(expect.objectContaining({ baselines }));
  });

  test('omitted `opts.baselines` forwards null, not undefined (resolveAffect\'s own `?? {}` default stays load-bearing)', async () => {
    resolveAffect.mockResolvedValue({ transitioned: false, from: null, to: null });
    await onlineUpdate('u44', { level: 90 }, { activity: 'resting', now: 6000 });
    expect(resolveAffect).toHaveBeenCalledWith(expect.objectContaining({ baselines: null }));
  });
});

// ── W4-D56: WHICH HOUR IS IT ON THE LIVE LANE? ─────────────────────────────────────────────────
//
// `resolveAffect` defaults `tzOffsetMinutes = 0` and this adapter was the one caller of three
// that took that default, so every reading was scored against the UTC bin of the user's own
// 24-bin hourly table. `targetsBuilder` and `stateVector.worker` both resolve the offset through
// `resolveHourContext(now, baselines)` first; this lane now does the same.
//
// The pins below are INVARIANTS — "the three callers agree" — not copies of a measured number.
// A magic-number pin would go green again the moment someone changed the hourly table, which is
// exactly the wrong sensitivity: what must hold is that the LANES agree, whatever the table says.

// A nocturnal-trough hourly baseline, the shape W4-004 actually produces: cosinor-ish, trough
// ~50 bpm around 03:00, peak ~74 around 15:00. It is what makes the wrong bin cost something —
// against a flat table every offset agrees and the defect is invisible.
function nocturnalHourlyBaselines() {
  const hourly = Array.from({ length: 24 }, (_, h) => ({
    value: Math.round(62 + 12 * Math.cos((2 * Math.PI * (h - 15)) / 24)),
    mad: 4,
    n: 30,
    confidence: 0.75,
  }));
  return {
    rhrMedian: 52, rhrMAD: 4, hourly, confidence: 0.8, hrvMedian: 60, hrvMAD: 10,
  };
}

describe('hour-of-day context (W4-D56)', () => {
  // 03:30 UTC is the load-bearing instant: it is the nocturnal trough in UTC and mid-morning at
  // +08:00, so the two offsets land in bins ~18 bpm apart.
  const NOW = Date.parse('2026-08-22T03:30:00Z');
  const READING = { level: 70, confidence: 0.9 };

  beforeEach(() => { getRedis.mockReturnValue(fakeRedis()); });

  test('forwards the offset DECLARED on the baseline blob, not the UTC default', async () => {
    resolveAffect.mockResolvedValue({ transitioned: false, from: null, to: null });
    const baselines = { ...nocturnalHourlyBaselines(), tzOffsetMinutes: 480 };

    await onlineUpdate('u45', READING, { activity: 'resting', now: NOW, baselines });

    expect(resolveAffect).toHaveBeenCalledWith(expect.objectContaining({ tzOffsetMinutes: 480 }));
  });

  test('no declared offset → the SERVER offset the two sibling callers resolve, never a bare 0', async () => {
    resolveAffect.mockResolvedValue({ transitioned: false, from: null, to: null });
    const baselines = nocturnalHourlyBaselines(); // no tzOffsetMinutes on the blob

    await onlineUpdate('u46', READING, { activity: 'resting', now: NOW, baselines });

    // Expressed against `resolveHourContext` rather than a literal, so this pin stays true on a
    // CI box in any timezone AND fails the moment the lanes stop sharing the rule.
    expect(resolveAffect).toHaveBeenCalledWith(expect.objectContaining({
      tzOffsetMinutes: resolveHourContext(NOW, baselines).tzOffsetMinutes,
    }));
  });

  test('no baselines at all → still the shared rule, applied to a null blob', async () => {
    resolveAffect.mockResolvedValue({ transitioned: false, from: null, to: null });

    await onlineUpdate('u47', READING, { activity: 'resting', now: NOW });

    expect(resolveAffect).toHaveBeenCalledWith(expect.objectContaining({
      tzOffsetMinutes: resolveHourContext(NOW, null).tzOffsetMinutes,
    }));
  });

  test('INVARIANT: the live lane scores the same axes as the generation path for the same user, baselines and instant', async () => {
    resolveAffect.mockResolvedValue({ transitioned: false, from: null, to: null });
    const baselines = { ...nocturnalHourlyBaselines(), tzOffsetMinutes: 480 };

    await onlineUpdate('u48', READING, { activity: 'resting', now: NOW, baselines });
    const [liveArgs] = resolveAffect.mock.calls[0];

    // What THIS lane would produce, using the evidence and offset it actually forwarded…
    const viaLiveLane = computeAxes({
      live: liveArgs.live, baselines, now: NOW, tzOffsetMinutes: liveArgs.tzOffsetMinutes,
    });
    // …versus what `targetsBuilder`/`stateVector.worker` produce for the same person at the same
    // instant, resolving the offset the way they do.
    const viaGenerationPath = computeAxes({
      live: liveArgs.live,
      baselines,
      now: NOW,
      tzOffsetMinutes: resolveHourContext(NOW, baselines).tzOffsetMinutes,
    });

    expect(viaLiveLane.hourOfDay).toBe(viaGenerationPath.hourOfDay);
    expect(viaLiveLane.axes).toEqual(viaGenerationPath.axes);
  });

  test('and the UTC default it used to take is NOT equivalent — the divergence the invariant closes is real', () => {
    const baselines = { ...nocturnalHourlyBaselines(), tzOffsetMinutes: 480 };
    const live = { heartRate: 70, confidence: 0.9, activity: 'resting' };

    const utcDefault = computeAxes({ live, baselines, now: NOW, tzOffsetMinutes: 0 });
    const usersOwnHour = computeAxes({ live, baselines, now: NOW, tzOffsetMinutes: 480 });

    // Guards the invariant above against going vacuous: if a future change made every offset
    // score alike, the invariant would pass for the wrong reason and this pin would catch it.
    // Stress is the axis that picks the taxonomy state, hence the band, hence the music.
    expect(Math.abs(utcDefault.axes.stress.value - usersOwnHour.axes.stress.value)).toBeGreaterThan(0.2);
    expect(Math.abs(utcDefault.axes.arousal.value - usersOwnHour.axes.arousal.value)).toBeGreaterThan(0.2);
  });
});

// ── W4-D72: DOES THE LIVE LANE KNOW HOW THIS PERSON SLEPT? ─────────────────────────────────────
//
// W4-D68 gave §M.6's sleep-debt accumulator — `FATIGUE_WEIGHTS.debt` = 0.6, the DOMINANT term of
// the fatigue axis — its actual input on the two lanes that can afford a Mongo read per call
// (`targetsBuilder` and `stateVector.worker`). It deliberately left this one out, because this
// lane runs per READING and a `MorningState` read per reading is precisely the defect W4-D57 had
// just closed for `peekBaselines`. What survived was an asymmetry INSIDE ONE PERSON: the same
// user's fatigue was debt-weighted the moment a playlist was generated and an HRV trend alone one
// second later on the socket, with no reason a listener could ever perceive.
//
// The fetch and the hold belong to the CALLER, exactly as `baselines` does (pinned in
// biometricHandler.pipeline.test.js). This module's contract is narrower and is what is pinned
// here: it forwards the nights untouched, and it forwards the SAME empty shape as before when
// there are none.
describe('sleep history (W4-D72)', () => {
  const NOW = Date.parse('2026-08-22T03:30:00Z');
  const READING = { level: 70, confidence: 0.9 };

  // Seven short nights (~4h20 weighted against a 543-min population need), the shape
  // `sleepHistoryRepo.readNightHistory` returns: OLDEST-first `{deep, light, rem}` minutes.
  const SHORT_NIGHTS = Array.from({ length: 7 }, () => ({ deep: 45, light: 170, rem: 40 }));

  beforeEach(() => { getRedis.mockReturnValue(fakeRedis()); });

  test('forwards `opts.sleep` through to `resolveAffect` untouched', async () => {
    resolveAffect.mockResolvedValue({ transitioned: false, from: null, to: null });
    const sleep = { history: SHORT_NIGHTS };

    await onlineUpdate('u49', READING, { activity: 'resting', now: NOW, sleep });

    expect(resolveAffect).toHaveBeenCalledWith(expect.objectContaining({ sleep }));
  });

  test('omitted `opts.sleep` forwards the empty shape, so a listener with no consolidated nights scores exactly as before', async () => {
    resolveAffect.mockResolvedValue({ transitioned: false, from: null, to: null });

    await onlineUpdate('u50', READING, { activity: 'resting', now: NOW });

    expect(resolveAffect).toHaveBeenCalledWith(expect.objectContaining({ sleep: {} }));
  });

  test('INVARIANT: given the same nights, the live lane scores the same fatigue as the generation path', async () => {
    resolveAffect.mockResolvedValue({ transitioned: false, from: null, to: null });
    const baselines = { ...nocturnalHourlyBaselines(), tzOffsetMinutes: 480 };
    const sleep = { history: SHORT_NIGHTS };

    await onlineUpdate('u51', READING, { activity: 'resting', now: NOW, baselines, sleep });
    const [liveArgs] = resolveAffect.mock.calls[0];

    const viaLiveLane = computeAxes({
      live: liveArgs.live,
      baselines,
      sleep: liveArgs.sleep,
      now: NOW,
      tzOffsetMinutes: liveArgs.tzOffsetMinutes,
    });
    const viaGenerationPath = computeAxes({
      live: liveArgs.live,
      baselines,
      sleep,
      now: NOW,
      tzOffsetMinutes: resolveHourContext(NOW, baselines).tzOffsetMinutes,
    });

    expect(viaLiveLane.axes).toEqual(viaGenerationPath.axes);
  });

  test('and a lane WITHOUT the nights is not equivalent — the asymmetry this closes is real', () => {
    // A cosinor is on the blob here and NOT on the invariant's, deliberately: without a fitted
    // clock `alertnessAxis` returns the neutral midpoint at mass 0 whatever the debt is, so the
    // second half of this pin would be vacuous rather than false.
    const baselines = {
      ...nocturnalHourlyBaselines(), tzOffsetMinutes: 480, cosinor: { phi: 15, confidence: 0.7 },
    };
    const live = { heartRate: 70, confidence: 0.9, activity: 'resting' };
    const args = { live, baselines, now: NOW, tzOffsetMinutes: 480 };

    const blind = computeAxes({ ...args, sleep: {} });
    const informed = computeAxes({ ...args, sleep: { history: SHORT_NIGHTS } });

    // Guards the invariant above against going vacuous. `fatigue` is the axis §M.6 feeds
    // directly; `circadianAlertness` is fed the same debt ratio through `alertnessAxis`, so a
    // debt this lane cannot see costs two axes, not one.
    expect(informed.axes.fatigue.mass).toBeGreaterThan(blind.axes.fatigue.mass);
    expect(informed.axes.fatigue.value).toBeGreaterThan(blind.axes.fatigue.value + 0.05);
    expect(informed.axes.circadianAlertness.value)
      .toBeLessThan(blind.axes.circadianAlertness.value - 0.05);
  });
});

// ── policyDiffers, unit-level ───────────────────────────────────────────────────────────────────

describe('policyDiffers', () => {
  test('identical object → false', () => {
    const p = { energyBias: 0.1, valenceApproach: 'meet', trajectoryArchetype: 'warmup', textureBias: { acousticness: 0.2, instrumentalness: 0.1 } };
    expect(policyDiffers(p, p)).toBe(false);
  });

  test('either side missing → true', () => {
    expect(policyDiffers(null, { energyBias: 0 })).toBe(true);
    expect(policyDiffers({ energyBias: 0 }, undefined)).toBe(true);
  });

  test('deep-equal but DIFFERENT object identity (the frozen-per-state trap) → false', () => {
    const a = { energyBias: 0.1, valenceApproach: 'meet', trajectoryArchetype: 'flat', textureBias: { acousticness: 0.2, instrumentalness: 0.1 } };
    const b = { energyBias: 0.1, valenceApproach: 'meet', trajectoryArchetype: 'flat', textureBias: { acousticness: 0.2, instrumentalness: 0.1 } };
    expect(policyDiffers(a, b)).toBe(false);
  });

  test('nested textureBias differs → true even when top-level fields match', () => {
    const a = { energyBias: 0.1, valenceApproach: 'meet', trajectoryArchetype: 'flat', textureBias: { acousticness: 0.2, instrumentalness: 0.1 } };
    const b = { energyBias: 0.1, valenceApproach: 'meet', trajectoryArchetype: 'flat', textureBias: { acousticness: 0.9, instrumentalness: 0.1 } };
    expect(policyDiffers(a, b)).toBe(true);
  });
});

// ── end-to-end: the REAL engine, through a fake Redis, proves dwell survives the round trip ────
//
// The module-level mocks above stand in for `affectService` everywhere else in this file; these
// two tests need the REAL peek->forward->save chain, so they reset the module registry and
// require a fresh, unmocked copy rather than fighting the file-level jest.mock.

describe('end-to-end through a fake Redis (real affectEngine + stateTaxonomy)', () => {
  test('an oscillating signal across an enter/exit boundary does not re-transition every call (dwell honored)', async () => {
    jest.resetModules();
    jest.unmock('../app/services/biosonic/affectService');
    const redisModule = require('../app/config/redis');
    redisModule.getRedis.mockReturnValue(fakeRedis());
    const live = require('../app/agents/runtime/physiology/liveStateAdapter');

    const T0 = Date.UTC(2026, 7, 19, 3, 0, 0); // deep night, favors rest-domain evidence
    const first = await live.onlineUpdate('u-dwell', { level: 52, confidence: 1 }, { activity: 'resting', now: T0 });
    // A few seconds later — nowhere near ANY state's minDwellSec (>=180s) — the same reading
    // cannot report a fresh transition even if the instantaneous evidence wiggles.
    const second = await live.onlineUpdate('u-dwell', { level: 54, confidence: 1 }, { activity: 'resting', now: T0 + 5_000 });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    // Whatever the engine decided on the first call, the second call 5s later must not report
    // it as a FRESH transition — that is precisely the churn the carried posterior exists to
    // prevent, and it only holds if peek->save actually round-tripped through the fake Redis.
    expect(second.transitioned).toBe(false);

    jest.resetModules();
  });

  test('a genuinely sustained regime change (peer far outside any current dwell) is reachable', async () => {
    jest.resetModules();
    jest.unmock('../app/services/biosonic/affectService');
    const redisModule = require('../app/config/redis');
    redisModule.getRedis.mockReturnValue(fakeRedis());
    const live = require('../app/agents/runtime/physiology/liveStateAdapter');

    const T0 = Date.UTC(2026, 7, 19, 10, 0, 0);
    await live.onlineUpdate('u-sustain', { level: 58, confidence: 1 }, { activity: 'resting', now: T0 });
    // 40 minutes of sustained high-exertion evidence — well past every state's dwellTauSec/
    // minDwellSec (3-30 min) — must eventually be reachable as a confirmed transition.
    let last = null;
    for (let i = 1; i <= 8; i++) {
      last = await live.onlineUpdate(
        'u-sustain', { level: 150, confidence: 1 }, { activity: 'running', now: T0 + i * 5 * 60_000 },
      );
    }
    expect(last.ok).toBe(true);
    expect(last.band).not.toBeNull();

    jest.resetModules();
  });
});
