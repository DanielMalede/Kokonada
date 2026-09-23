'use strict';

// W4-003 — the wiring half: the A0 anomaly filter (session 16's pure core) plugged into
// `handleBiometricReading`, live BiometricLog persistence (D10), the S6 timestamp gates at
// the ingest seam, and the S11 kill-switch. `sim.replay.integration.test.js` proves this
// end-to-end against real production modules and a real Mongo; this file pins the specific
// mechanisms (throttle, dedupe, kill-switch, S6) at the unit level, with BiometricLog mocked
// so each one can be isolated and driven with explicit `now` values (S9: this suite is what
// `opts.now` on handleBiometricReading exists for).

process.env.NODE_ENV       = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET     = 'test-jwt-secret-for-tests-only';

const mockExists     = jest.fn();
const mockInsertMany = jest.fn();
jest.mock('../app/models/BiometricLog', () => ({
  exists:     (...a) => mockExists(...a),
  insertMany: (...a) => mockInsertMany(...a),
}));

const {
  handleBiometricReading, _debounceMap, _resetDebounceState,
  ANOMALY_FILTER_FLAG, LIVE_PERSIST_MIN_INTERVAL_MS,
} = require('../app/sockets/biometricHandler');

const RAW_OK = (heartRate, offsetSec = 0) => ({
  heartRate, activityType: 6, startTimeLocal: new Date(T0 + offsetSec * 1000).toISOString(),
});
const T0 = Date.UTC(2026, 7, 19, 8, 0, 0); // safely recent, well inside every S6/retention window

function makeSocket(id, userId = '507f1f77bcf86cd799439011') {
  return { id, emit: jest.fn(), data: { user: { _id: userId } } };
}

const INSERTED_OK = { acknowledged: true, insertedCount: 1, insertedIds: { 0: 'x' }, mongoose: { validationErrors: [] } };

beforeEach(() => {
  _resetDebounceState();
  mockExists.mockReset().mockResolvedValue(false);
  mockInsertMany.mockReset().mockResolvedValue(INSERTED_OK);
  delete process.env[ANOMALY_FILTER_FLAG];
});
afterEach(() => { _resetDebounceState(); delete process.env[ANOMALY_FILTER_FLAG]; });

describe('W4-003 wiring — the debounce/trigger machinery consumes the FILTERED estimate', () => {
  it('the first reading seeds the filter and the confirmed HR exactly (no smoothing to seed against)', () => {
    const socket = makeSocket('lw-1');
    handleBiometricReading(socket, 'garmin', RAW_OK(72), { now: T0 });
    expect(_debounceMap.get(socket.id).stableHR).toBe(72);
    expect(_debounceMap.get(socket.id).filterState.acceptedCount).toBe(1);
  });

  it('flags ANOMALY_FILTER_FLAG as the documented S11 kill-switch name', () => {
    expect(ANOMALY_FILTER_FLAG).toBe('WAVE4_ANOMALY_FILTER_DISABLED');
  });
});

describe('W4-003 — S11 kill-switch restores W4-001 behaviour without a revert', () => {
  it('a future-dated reading is REJECTED (no filter state advances) with the flag unset', async () => {
    const socket = makeSocket('lw-kill-off');
    // atMs far beyond FUTURE_TOLERANCE relative to `now`.
    const future = { heartRate: 90, activityType: 6, startTimeLocal: new Date(T0 + 3600_000).toISOString() };
    handleBiometricReading(socket, 'garmin', future, { now: T0 });
    expect(_debounceMap.get(socket.id).stableHR).toBeNull();
    await Promise.resolve();
    expect(mockInsertMany).not.toHaveBeenCalled();
  });

  it('the SAME future-dated reading drives stableHR RAW when the flag is set (byte-for-byte W4-001)', () => {
    process.env[ANOMALY_FILTER_FLAG] = 'true';
    const socket = makeSocket('lw-kill-on');
    const future = { heartRate: 90, activityType: 6, startTimeLocal: new Date(T0 + 3600_000).toISOString() };
    handleBiometricReading(socket, 'garmin', future, { now: T0 });
    expect(_debounceMap.get(socket.id).stableHR).toBe(90); // raw, unfiltered — the pre-W4-003 path
    expect(_debounceMap.get(socket.id).filterState).toBeNull(); // filter never engaged
  });

  it('is forgiving about the flag value (=1, mixed case), like RECAL_HYSTERESIS_FLAG', () => {
    process.env[ANOMALY_FILTER_FLAG] = '1';
    const socket = makeSocket('lw-kill-1');
    const future = { heartRate: 90, activityType: 6, startTimeLocal: new Date(T0 + 3600_000).toISOString() };
    handleBiometricReading(socket, 'garmin', future, { now: T0 });
    expect(_debounceMap.get(socket.id).stableHR).toBe(90);
  });

  it('the disabled flag also suppresses D10 persistence (no kill-switch half-measure)', async () => {
    process.env[ANOMALY_FILTER_FLAG] = 'true';
    const socket = makeSocket('lw-kill-persist');
    handleBiometricReading(socket, 'garmin', RAW_OK(72), { now: T0 });
    await Promise.resolve(); await Promise.resolve();
    expect(mockInsertMany).not.toHaveBeenCalled();
  });
});

describe('W4-003 — S6 timestamp gate at the live seam', () => {
  it('a future-dated FIRST reading acks but never confirms a heart rate', () => {
    const socket = makeSocket('lw-s6-future');
    const future = { heartRate: 90, activityType: 6, startTimeLocal: new Date(T0 + 3600_000).toISOString() };
    handleBiometricReading(socket, 'garmin', future, { now: T0 });
    expect(socket.emit).toHaveBeenCalledWith('biometric_ack', expect.anything());
    expect(_debounceMap.get(socket.id).stableHR).toBeNull();
    expect(_debounceMap.get(socket.id).filterState.rejectedCount).toBe(1);
  });

  it('a stale FIRST reading (>90 days old) is rejected the same way', () => {
    const socket = makeSocket('lw-s6-stale');
    const stale = { heartRate: 90, activityType: 6, startTimeLocal: new Date(T0 - 200 * 24 * 3600_000).toISOString() };
    handleBiometricReading(socket, 'garmin', stale, { now: T0 });
    expect(_debounceMap.get(socket.id).stableHR).toBeNull();
    expect(_debounceMap.get(socket.id).filterState.rejectedCount).toBe(1);
  });

  it('a future-dated reading AFTER a good baseline never overwrites the confirmed HR', () => {
    const socket = makeSocket('lw-s6-mid');
    handleBiometricReading(socket, 'garmin', RAW_OK(70, 0), { now: T0 });
    const future = { heartRate: 200, activityType: 6, startTimeLocal: new Date(T0 + 3600_000).toISOString() };
    handleBiometricReading(socket, 'garmin', future, { now: T0 + 300_000 });
    // Rejected: propagates the prior estimate, never the implausible 200 the artifact carried.
    expect(_debounceMap.get(socket.id).stableHR).not.toBe(200);
  });
});

describe('W4-003 — D10 live persistence', () => {
  it('persists an accepted reading with the RAW value, real activity and source', async () => {
    const socket = makeSocket('lw-persist-1', '507f1f77bcf86cd799439012');
    handleBiometricReading(socket, 'garmin', RAW_OK(72), { now: T0 });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    expect(mockInsertMany).toHaveBeenCalledTimes(1);
    const [docs] = mockInsertMany.mock.calls[0];
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      userId: '507f1f77bcf86cd799439012',
      heartRate: 72,
      activity: 'walking',
      source: 'garmin',
    });
  });

  it('throttles to <=1 write per minute per socket', async () => {
    const socket = makeSocket('lw-throttle');
    handleBiometricReading(socket, 'garmin', RAW_OK(70, 0), { now: T0 });
    await Promise.resolve(); await Promise.resolve();
    handleBiometricReading(socket, 'garmin', RAW_OK(71, 30), { now: T0 + 30_000 }); // 30s later — inside the window
    await Promise.resolve(); await Promise.resolve();

    expect(mockInsertMany).toHaveBeenCalledTimes(1); // the second write was throttled

    handleBiometricReading(socket, 'garmin', RAW_OK(72, 65), { now: T0 + LIVE_PERSIST_MIN_INTERVAL_MS + 1000 });
    await Promise.resolve(); await Promise.resolve();
    expect(mockInsertMany).toHaveBeenCalledTimes(2); // outside the window — writes again
  });

  it('dedupes on source@recordedAt so a reconnect replaying the same reading cannot double-write', async () => {
    mockExists.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const socket1 = makeSocket('lw-dedupe-1');
    handleBiometricReading(socket1, 'garmin', RAW_OK(70, 0), { now: T0 });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(mockInsertMany).toHaveBeenCalledTimes(1);

    // A second socket (reconnect) replays the SAME recordedAt well outside the first
    // socket's own throttle window (throttle is per-socket state, not global).
    const socket2 = makeSocket('lw-dedupe-2');
    handleBiometricReading(socket2, 'garmin', RAW_OK(70, 0), { now: T0 + LIVE_PERSIST_MIN_INTERVAL_MS + 5000 });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    expect(mockExists).toHaveBeenCalledTimes(2);
    expect(mockInsertMany).toHaveBeenCalledTimes(1); // exists() short-circuited the second insert
  });

  it('never persists a rejected (S6) reading', async () => {
    const socket = makeSocket('lw-persist-reject');
    const future = { heartRate: 90, activityType: 6, startTimeLocal: new Date(T0 + 3600_000).toISOString() };
    handleBiometricReading(socket, 'garmin', future, { now: T0 });
    await Promise.resolve(); await Promise.resolve();
    expect(mockInsertMany).not.toHaveBeenCalled();
  });

  it('a persistence failure never throws out of the handler (fire-and-forget)', async () => {
    mockInsertMany.mockRejectedValueOnce(new Error('boom'));
    const socket = makeSocket('lw-persist-fail');
    expect(() => handleBiometricReading(socket, 'garmin', RAW_OK(72), { now: T0 })).not.toThrow();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  });
});

// The "no usable device timestamp" pass-through branch (`_filterHeartRate` in
// biometricHandler.js) is unreachable through any of the three REAL adapters: they always
// construct `new Date(raw.something)`, which is either a valid Date or an INVALID one — and
// an invalid Date is rejected by `isValidReading` before it ever reaches the filter. The
// branch exists for a caller whose adapter output omits `recordedAt` entirely (a genuinely
// absent key, not an Invalid Date) — exactly what `biometricHandler.pipeline.test.js`'s
// mocked adapter does for ~130 pre-existing tests. That suite IS this branch's coverage;
// duplicating it here against a hand-rolled adapter mock would risk exactly the drift W4-D07
// found (a mock whose semantics diverge from the real one), so it is not repeated.
