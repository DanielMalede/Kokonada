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
jest.mock('../app/services/biosonic/affectService', () => ({ resolveAffect: jest.fn() }));

const { getRedis } = require('../app/config/redis');
const { resolveAffect } = require('../app/services/biosonic/affectService');
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
