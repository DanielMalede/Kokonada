'use strict';

// Wave-4 W4-D05 — the band-transition trigger stops flapping at the cuts.
//
// W4-001 replaced D11's ±10/±25 bpm gates with a BAND trigger, which was the right key
// (the shadow buffer is keyed `bio:<band>:<activity>`) but a symmetric one: any crossing
// of a cut fired, in either direction, as long as it beat the 3 bpm sensor noise floor.
// Reflection #1 measured the consequence on the REAL exported predicate — 88→93 true,
// 93→88 true, 87→92 true, 92→87 true, 119→122 true, 122→119 true — so an ordinary resting
// oscillation across the 90 cut re-served the buffer on every 5-minute watch ping, where
// the retired ±25 bpm gate produced none.
//
// The fix is a Schmitt trigger: asymmetric enter/exit cuts, latched to the band actually
// being SERVED. Fast attack (entering a higher band is unmargined beyond the noise floor,
// so a real activation is never delayed), slow release (falling back demands clearing the
// cut by HR_BAND_RELEASE_MARGIN). Both halves are needed: the margin alone does nothing on
// the watch lane, because `stableHR` tracks every ping and so every oscillation looks like
// a fresh crossing. W4-009 replaces the whole mechanism with taxonomy-state transitions.

process.env.NODE_ENV       = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET     = 'test-jwt-secret-for-tests-only';

// W4-003: handleBiometricReading fire-and-forgets a D10 persistence attempt against
// BiometricLog. This suite is pure trigger-logic under test with no real Mongo connection
// and a non-ObjectId fixture userId — mocked so that attempt is a harmless no-op instead of
// a noisy cast-error console.error on every reading.
jest.mock('../app/models/BiometricLog', () => ({
  exists:     jest.fn().mockResolvedValue(false),
  insertMany: jest.fn().mockResolvedValue({ acknowledged: true, insertedCount: 1, insertedIds: {}, mongoose: { validationErrors: [] } }),
}));

const {
  _shouldRecalibrate, _debounceMap, _resetDebounceState, handleBiometricReading,
  HR_NOISE_FLOOR, HR_BAND_RELEASE_MARGIN, RECAL_HYSTERESIS_FLAG,
} = require('../app/sockets/biometricHandler');
const { bandFromHeartRate, BAND_LOWER_CUT } = require('../app/services/moodDescriptors');

const call = (prevHR, nextHR, activityChanged = false) =>
  _shouldRecalibrate({ prevHR, nextHR, activityChanged });

const makeSocket = (id) => ({ id, emit: jest.fn(), data: { user: { _id: 'u-d05' } } });

// Drives the watch lane the way integrationsController.watchHrIngest does, and counts how
// often the trigger decided to recalibrate. liveMode is left FALSE on purpose: the mode-gate
// lives inside recalibrateForBand, so the trigger decision is observable here without
// standing up the whole generation stack (the pipeline suite pins the served side).
function pingSeries(socketId, hrs, { activity } = {}) {
  const socket = makeSocket(socketId);
  const fired = [];
  hrs.forEach((hr, i) => {
    const before = _debounceMap.get(socket.id)?.servedHR ?? null;
    handleBiometricReading(socket, 'garmin', {
      heartRate: hr,
      activityType: activity,
      // The real adapter builds recordedAt from this, and isValidReading rejects an
      // unparseable one — 5 minutes apart, the way the watch lane actually pings.
      startTimeLocal: new Date(Date.UTC(2026, 7, 19, 8, 5 * i)).toISOString(),
    }, { immediate: true });
    const state = _debounceMap.get(socket.id);
    expect(state).toBeDefined();  // a rejected reading would silently read as "no flap"
    if (state.servedHR !== before) fired.push(hr);
  });
  return fired;
}

afterEach(() => {
  delete process.env[RECAL_HYSTERESIS_FLAG];
  _resetDebounceState(); // W4-D06: releases armed 60 s timers, then clears
});

// ── The cuts have ONE definition ──────────────────────────────────────────────
// D11's lesson was that a trigger keyed on anything but the cut disagrees with the buffer.
// A release margin measured against a second, hand-copied 90/120 would re-open exactly that.

describe('W4-D05 — the band cuts are defined once and the trigger reads them', () => {
  it('exports the lower cut of every band above resting', () => {
    expect(BAND_LOWER_CUT).toEqual({ resting: null, active: 90, peak: 120 });
    expect(Object.isFrozen(BAND_LOWER_CUT)).toBe(true);
  });

  it('bandFromHeartRate agrees with the cut table across the whole physiological range', () => {
    for (let hr = 30; hr <= 220; hr += 1) {
      const expected = hr < BAND_LOWER_CUT.active ? 'resting'
        : hr < BAND_LOWER_CUT.peak ? 'active' : 'peak';
      expect(bandFromHeartRate(hr)).toBe(expected);
    }
  });
});

// ── The margin ────────────────────────────────────────────────────────────────

describe('W4-D05 — the release margin is asymmetric by construction', () => {
  it('is strictly wider than the sensor noise floor, or there is no asymmetry at all', () => {
    expect(HR_BAND_RELEASE_MARGIN).toBeGreaterThan(HR_NOISE_FLOOR);
  });

  it('covers the oscillation amplitudes reflection #1 actually measured (3-5 bpm)', () => {
    expect(HR_BAND_RELEASE_MARGIN).toBeGreaterThan(5);
  });
});

// ── Attack: a real activation is never delayed ────────────────────────────────

describe('W4-D05 — entering a higher band stays fast (attack is unmargined)', () => {
  it('still fires on the crossings W4-001 promised, including the DoD 115→121 case', () => {
    expect(call(115, 121)).toBe(true);  // the reflection's own genuine-crossing pin
    expect(call(115, 125)).toBe(true);
    expect(call(100, 120)).toBe(true);  // lands exactly ON the cut
    expect(call(85, 95)).toBe(true);
  });

  it('keeps the noise floor on the way up, so 1-2 bpm across a cut is still not a crossing', () => {
    expect(call(119, 120)).toBe(false);
    expect(call(89, 91)).toBe(false);
  });

  it('never fires inside one band, however large the jump', () => {
    expect(call(60, 85)).toBe(false);
    expect(call(95, 119)).toBe(false);
    expect(call(130, 190)).toBe(false);
  });
});

// ── Release: falling back demands clearing the cut ────────────────────────────

describe('W4-D05 — leaving a band downward requires clearing its cut by the margin', () => {
  it('refuses every downward flap reflection #1 measured as firing', () => {
    expect(call(93, 88)).toBe(false);    // was true — the 90-cut resting oscillation
    expect(call(92, 87)).toBe(false);    // was true
    expect(call(122, 119)).toBe(false);  // was true — the 120-cut case
  });

  it('holds the band right up to the release threshold, then lets go', () => {
    const floor = BAND_LOWER_CUT.active - HR_BAND_RELEASE_MARGIN; // 84
    expect(call(93, floor)).toBe(false);      // exactly at the threshold — still active
    expect(call(93, floor - 1)).toBe(true);   // one bpm past it — genuinely resting
  });

  it('releases peak the same way, from the peak cut', () => {
    const floor = BAND_LOWER_CUT.peak - HR_BAND_RELEASE_MARGIN; // 114
    expect(call(121, floor)).toBe(false);
    expect(call(121, floor - 1)).toBe(true);
  });

  it('a real recovery from a workout still drops the band immediately', () => {
    expect(call(165, 110)).toBe(true);  // peak → active
    expect(call(165, 70)).toBe(true);   // peak → resting, two levels at once
    expect(call(110, 62)).toBe(true);   // active → resting
  });
});

// ── Unchanged contract ────────────────────────────────────────────────────────

describe('W4-D05 — the rest of the trigger contract is untouched', () => {
  it('an activity change always fires, whatever the HR did', () => {
    expect(call(100, 100, true)).toBe(true);
    expect(call(60, 61, true)).toBe(true);
    expect(call(93, 88, true)).toBe(true);  // even a suppressed release
  });

  it('is total: a missing or unusable heart rate never throws', () => {
    expect(call(null, 120)).toBe(true);
    expect(call(120, null)).toBe(false);
    expect(call(null, null)).toBe(false);
    expect(call(undefined, 95)).toBe(true);
    expect(call(NaN, 95)).toBe(true);
    expect(call(95, NaN)).toBe(false);
    expect(call(Infinity, 95)).toBe(true);
    expect(call(95, Infinity)).toBe(false);
    expect(call(0, 95)).toBe(true);
    expect(call(95, -5)).toBe(false);
  });
});

// ── The latch: the watch lane compares against the band it is SERVING ─────────

describe('W4-D05 — the immediate lane latches to the served band, not the last ping', () => {
  it('an 88↔93 resting oscillation costs at most ONE recalibration after the baseline', () => {
    const fired = pingSeries('d05-osc', [88, 93, 88, 93, 88, 93, 88, 93, 88, 93]);
    expect(fired[0]).toBe(88);              // the baseline serve — first reading, no prior state
    expect(fired.slice(1)).toEqual([93]);   // exactly one band-driven recalibration, then silence
  });

  it('the same oscillation at the 120 cut is bounded too', () => {
    const fired = pingSeries('d05-osc-peak', [119, 122, 119, 122, 119, 122]);
    expect(fired.slice(1)).toEqual([122]);
  });

  it('bounds the wide oscillation the plain margin cannot catch (114↔121)', () => {
    // Without the latch this alternates: 114 releases peak, 121 re-enters it, forever.
    const fired = pingSeries('d05-osc-wide', [121, 114, 121, 114, 121, 114]);
    expect(fired.slice(1)).toEqual([]);
  });

  it('still recalibrates when the body genuinely leaves the band it was serving', () => {
    const fired = pingSeries('d05-real', [88, 93, 88, 130, 128, 70]);
    expect(fired).toEqual([88, 93, 130, 70]);
  });

  it('a sustained climb is never delayed by the latch', () => {
    const fired = pingSeries('d05-ramp', [70, 80, 95, 110, 125, 150]);
    expect(fired).toEqual([70, 95, 125]);  // one serve per band actually entered
  });
});

// ── S11 kill-switch ───────────────────────────────────────────────────────────

describe('W4-D05 — WAVE4_RECAL_STATE_TRIGGER_DISABLED restores W4-001 behaviour', () => {
  it('names the flag §0.4 S11 reserved', () => {
    expect(RECAL_HYSTERESIS_FLAG).toBe('WAVE4_RECAL_STATE_TRIGGER_DISABLED');
  });

  it('brings back the symmetric noise-floor release', () => {
    process.env[RECAL_HYSTERESIS_FLAG] = 'true';
    expect(call(93, 88)).toBe(true);      // W4-001: |Δ|=5 ≥ noise floor → fires
    expect(call(122, 119)).toBe(true);    // W4-001: |Δ|=3 ≥ noise floor → fires
    expect(call(93, 91)).toBe(false);     // W4-001: |Δ|=2 < noise floor → still suppressed
  });

  it('brings back the flap on the immediate lane', () => {
    process.env[RECAL_HYSTERESIS_FLAG] = 'true';
    const fired = pingSeries('d05-flag-osc', [88, 93, 88, 93, 88, 93]);
    expect(fired).toEqual([88, 93, 88, 93, 88, 93]);  // every ping — the defect, on demand
  });

  it('leaves the attack side identical either way', () => {
    const attack = [[115, 121], [115, 125], [100, 120], [85, 95], [119, 120], [89, 91]];
    const withFix = attack.map(([a, b]) => call(a, b));
    process.env[RECAL_HYSTERESIS_FLAG] = 'true';
    expect(attack.map(([a, b]) => call(a, b))).toEqual(withFix);
  });

  it('is a kill-switch, so it answers to the values an operator would actually type', () => {
    for (const v of ['true', '1', 'yes', 'on', 'TRUE']) {
      process.env[RECAL_HYSTERESIS_FLAG] = v;
      expect(call(93, 88)).toBe(true);
    }
    for (const v of ['', 'false', '0']) {
      process.env[RECAL_HYSTERESIS_FLAG] = v;
      expect(call(93, 88)).toBe(false);
    }
  });
});
