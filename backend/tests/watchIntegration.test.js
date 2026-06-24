'use strict';

const crypto = require('crypto');

// Mock the socket layer so requiring the controller does not boot socket.io
// or the full biometric pipeline. Task 5 uses these mocks for ingest tests.
jest.mock('../app/sockets', () => ({ getIo: jest.fn(), createSocketServer: jest.fn() }));
jest.mock('../app/sockets/biometricHandler', () => ({
  handleBiometricReading: jest.fn(),
  registerBiometricHandler: jest.fn(),
  generateAndEmitPlaylist: jest.fn(),
}));
jest.mock('../app/models/User');

const User = require('../app/models/User');
const { getIo } = require('../app/sockets');
const { handleBiometricReading } = require('../app/sockets/biometricHandler');
const {
  issueWatchToken, revokeWatchToken, watchHrIngest,
} = require('../app/controllers/integrationsController');

function makeRes() {
  const res = { statusCode: 200, body: null, ended: false };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.body = data; return res; };
  res.end = () => { res.ended = true; return res; };
  return res;
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const next = jest.fn();

beforeEach(() => jest.clearAllMocks());

// ── issueWatchToken ─────────────────────────────────────────────────────────

describe('issueWatchToken', () => {
  it('returns a whr_ token, stores its hash, and marks provider garmin', async () => {
    const user = { _id: 'u1', save: jest.fn().mockResolvedValue(undefined) };
    const req = { user };
    const res = makeRes();

    await issueWatchToken(req, res, next);

    expect(res.statusCode).toBe(201);
    expect(res.body.token).toMatch(/^whr_[A-Za-z0-9_-]+$/);
    expect(user.watchToken.hash).toBe(sha256(res.body.token));
    expect(user.watchToken.createdAt).toBeInstanceOf(Date);
    expect(user.wearableProvider).toBe('garmin');
    expect(user.save).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
  });

  it('does not store the plaintext token anywhere on the user', async () => {
    const user = { _id: 'u1', save: jest.fn().mockResolvedValue(undefined) };
    const res = makeRes();
    await issueWatchToken({ user }, res, next);
    expect(JSON.stringify(user.watchToken)).not.toContain(res.body.token);
  });

  it('forwards errors to next', async () => {
    const err = new Error('db down');
    const user = { _id: 'u1', save: jest.fn().mockRejectedValue(err) };
    const res = makeRes();
    await issueWatchToken({ user }, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

// ── revokeWatchToken ────────────────────────────────────────────────────────

describe('revokeWatchToken', () => {
  it('clears watchToken and responds 200', async () => {
    const user = {
      _id: 'u1',
      watchToken: { hash: 'abc', createdAt: new Date(), lastSeenAt: new Date() },
      save: jest.fn().mockResolvedValue(undefined),
    };
    const res = makeRes();

    await revokeWatchToken({ user }, res, next);

    expect(user.watchToken).toBeNull();
    expect(user.save).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toMatch(/disconnect/i);
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards errors to next', async () => {
    const err = new Error('db down');
    const user = {
      _id: 'u1',
      watchToken: { hash: 'abc', createdAt: new Date(), lastSeenAt: new Date() },
      save: jest.fn().mockRejectedValue(err),
    };
    const res = makeRes();
    await revokeWatchToken({ user }, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

// ── watchHrIngest ─────────────────────────────────────────────────────────

describe('watchHrIngest', () => {
  // Builds a fake io whose room for `user:<id>` contains one socket.
  function makeIo(userId) {
    const socket = { id: `sock_${userId}`, emit: jest.fn(), data: { user: { _id: userId } } };
    const rooms = new Map([[`user:${userId}`, new Set([socket.id])]]);
    const sockets = new Map([[socket.id, socket]]);
    return { io: { sockets: { adapter: { rooms }, sockets } }, socket };
  }

  function reqWith(token, body) {
    return { headers: token ? { authorization: `Bearer ${token}` } : {}, body };
  }

  beforeEach(() => {
    User.findOne = jest.fn();
    User.updateOne = jest.fn().mockResolvedValue({});
  });

  it('202 on valid token + connected socket; calls handleBiometricReading immediate', async () => {
    const userId = 'u_live';
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: userId }) });
    const { io, socket } = makeIo(userId);
    getIo.mockReturnValue(io);
    const res = makeRes();

    await watchHrIngest(reqWith('whr_tok', { heartRate: 142, activityType: 1, ts: '2026-06-24T10:00:00Z' }), res, next);

    expect(res.statusCode).toBe(202);
    expect(handleBiometricReading).toHaveBeenCalledWith(
      socket,
      'garmin',
      { heartRate: 142, activityType: 1, startTimeLocal: '2026-06-24T10:00:00Z' },
      { immediate: true }
    );
    expect(User.updateOne).toHaveBeenCalled(); // lastSeenAt touched
  });

  it('401 when the Authorization header is missing', async () => {
    const res = makeRes();
    await watchHrIngest(reqWith(null, { heartRate: 120 }), res, next);
    expect(res.statusCode).toBe(401);
    expect(handleBiometricReading).not.toHaveBeenCalled();
  });

  it('401 when the token matches no user', async () => {
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(null) });
    const res = makeRes();
    await watchHrIngest(reqWith('whr_bad', { heartRate: 120 }), res, next);
    expect(res.statusCode).toBe(401);
  });

  it('400 when heartRate is out of range or non-numeric', async () => {
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: 'u1' }) });
    const res1 = makeRes();
    await watchHrIngest(reqWith('whr_tok', { heartRate: 5 }), res1, next);
    expect(res1.statusCode).toBe(400);

    const res2 = makeRes();
    await watchHrIngest(reqWith('whr_tok', { heartRate: 'fast' }), res2, next);
    expect(res2.statusCode).toBe(400);
    expect(handleBiometricReading).not.toHaveBeenCalled();
    expect(User.updateOne).not.toHaveBeenCalled(); // validation rejects before the liveness update
  });

  it('409 { live:false } when the user has no connected browser socket', async () => {
    const userId = 'u_offline';
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: userId }) });
    getIo.mockReturnValue({ sockets: { adapter: { rooms: new Map() }, sockets: new Map() } });
    const res = makeRes();

    await watchHrIngest(reqWith('whr_tok', { heartRate: 142, activityType: 1 }), res, next);

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ live: false });
    expect(handleBiometricReading).not.toHaveBeenCalled();
  });

  it('defaults activityType to 0 and supplies startTimeLocal when ts is absent', async () => {
    const userId = 'u_def';
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: userId }) });
    const { io } = makeIo(userId);
    getIo.mockReturnValue(io);
    const res = makeRes();

    await watchHrIngest(reqWith('whr_tok', { heartRate: 88 }), res, next);

    const raw = handleBiometricReading.mock.calls[0][2];
    expect(raw.heartRate).toBe(88);
    expect(raw.activityType).toBe(0);
    expect(typeof raw.startTimeLocal).toBe('string');
  });

  // ── TDD FIX 1: heartRate NaN must be rejected (400) ─────────────────────
  it('[FIX1] heartRate: NaN → 400; handleBiometricReading and User.updateOne NOT called', async () => {
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: 'u1' }) });
    const res = makeRes();
    await watchHrIngest(reqWith('whr_tok', { heartRate: NaN }), res, next);
    expect(res.statusCode).toBe(400);
    expect(handleBiometricReading).not.toHaveBeenCalled();
    expect(User.updateOne).not.toHaveBeenCalled();
  });

  // ── TDD FIX 2: garbage ts must be coerced to now, not passed through ────
  it('[FIX2] ts: "not-a-date" with live socket → 202; startTimeLocal coerced to valid ISO (NOT "not-a-date")', async () => {
    const userId = 'u_ts_fix';
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: userId }) });
    const { io } = makeIo(userId);
    getIo.mockReturnValue(io);
    const res = makeRes();

    await watchHrIngest(reqWith('whr_tok', { heartRate: 100, ts: 'not-a-date' }), res, next);

    expect(res.statusCode).toBe(202);
    expect(handleBiometricReading).toHaveBeenCalledTimes(1);
    const raw = handleBiometricReading.mock.calls[0][2];
    expect(raw.startTimeLocal).not.toBe('not-a-date');
    expect(Number.isNaN(new Date(raw.startTimeLocal).getTime())).toBe(false);
  });

  // ── Test 2: Infinity and -Infinity → 400 ────────────────────────────────
  it('heartRate: Infinity → 400; heartRate: -Infinity → 400', async () => {
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: 'u1' }) });

    const res1 = makeRes();
    await watchHrIngest(reqWith('whr_tok', { heartRate: Infinity }), res1, next);
    expect(res1.statusCode).toBe(400);

    const res2 = makeRes();
    await watchHrIngest(reqWith('whr_tok', { heartRate: -Infinity }), res2, next);
    expect(res2.statusCode).toBe(400);

    expect(handleBiometricReading).not.toHaveBeenCalled();
  });

  // ── Test 3: boundary values ──────────────────────────────────────────────
  it('boundary: heartRate 30 and 230 → 202; 29.999 and 230.001 → 400', async () => {
    const userId = 'u_boundary';
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: userId }) });
    const { io } = makeIo(userId);
    getIo.mockReturnValue(io);

    const res30 = makeRes();
    await watchHrIngest(reqWith('whr_tok', { heartRate: 30 }), res30, next);
    expect(res30.statusCode).toBe(202);

    const res230 = makeRes();
    await watchHrIngest(reqWith('whr_tok', { heartRate: 230 }), res230, next);
    expect(res230.statusCode).toBe(202);

    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: 'u1' }) });

    const resLow = makeRes();
    await watchHrIngest(reqWith('whr_tok', { heartRate: 29.999 }), resLow, next);
    expect(resLow.statusCode).toBe(400);

    const resHigh = makeRes();
    await watchHrIngest(reqWith('whr_tok', { heartRate: 230.001 }), resHigh, next);
    expect(resHigh.statusCode).toBe(400);
  });

  // ── Test 4: wrong-type heartRate → 400 ─────────────────────────────────
  it('heartRate as string/bool/array/object/missing → 400; handleBiometricReading NOT called', async () => {
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: 'u1' }) });
    const badValues = ['120', true, [120], {}, undefined];

    for (const hr of badValues) {
      const body = hr === undefined ? {} : { heartRate: hr };
      const res = makeRes();
      await watchHrIngest(reqWith('whr_tok', body), res, next);
      expect(res.statusCode).toBe(400);
    }
    expect(handleBiometricReading).not.toHaveBeenCalled();
  });

  // ── Test 6: various invalid ts values → startTimeLocal is a valid ISO ───
  it('ts: empty string/number/array/null → startTimeLocal coerced to valid ISO date', async () => {
    const userId = 'u_ts_coerce';
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: userId }) });
    const { io } = makeIo(userId);
    getIo.mockReturnValue(io);

    const badTs = ['', 12345, [1, 2], null];
    for (const ts of badTs) {
      jest.clearAllMocks();
      User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: userId }) });
      User.updateOne = jest.fn().mockResolvedValue({});
      getIo.mockReturnValue(io);

      const res = makeRes();
      await watchHrIngest(reqWith('whr_tok', { heartRate: 80, ts }), res, next);
      expect(res.statusCode).toBe(202);
      const raw = handleBiometricReading.mock.calls[0][2];
      expect(Number.isNaN(new Date(raw.startTimeLocal).getTime())).toBe(false);
    }
  });

  // ── Test 7: activityType coercion ────────────────────────────────────────
  it('activityType non-integer values → raw.activityType === 0; out-of-range integers preserved', async () => {
    const userId = 'u_act';
    const { io } = makeIo(userId);

    const nonIntegers = [1.5, '1', null, {}];
    for (const activityType of nonIntegers) {
      jest.clearAllMocks();
      User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: userId }) });
      User.updateOne = jest.fn().mockResolvedValue({});
      getIo.mockReturnValue(io);

      const res = makeRes();
      await watchHrIngest(reqWith('whr_tok', { heartRate: 80, activityType }), res, next);
      expect(res.statusCode).toBe(202);
      const raw = handleBiometricReading.mock.calls[0][2];
      expect(raw.activityType).toBe(0);
    }

    // Out-of-range integers are preserved as-is
    for (const [activityType, expected] of [[-1, -1], [999999, 999999]]) {
      jest.clearAllMocks();
      User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: userId }) });
      User.updateOne = jest.fn().mockResolvedValue({});
      getIo.mockReturnValue(io);

      const res = makeRes();
      await watchHrIngest(reqWith('whr_tok', { heartRate: 80, activityType }), res, next);
      const raw = handleBiometricReading.mock.calls[0][2];
      expect(raw.activityType).toBe(expected);
    }
  });

  // ── Test 8: multi-socket room → exactly one handleBiometricReading call (pins Limitation 3) ──
  it('multi-socket room: handleBiometricReading called exactly once (single-delivery limitation)', async () => {
    const userId = 'u_multi';
    // Two sockets in the room
    const socket1 = { id: 'sock_a', emit: jest.fn(), data: {} };
    const socket2 = { id: 'sock_b', emit: jest.fn(), data: {} };
    const rooms = new Map([[`user:${userId}`, new Set([socket1.id, socket2.id])]]);
    const sockets = new Map([[socket1.id, socket1], [socket2.id, socket2]]);
    const io = { sockets: { adapter: { rooms }, sockets } };

    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: userId }) });
    User.updateOne = jest.fn().mockResolvedValue({});
    getIo.mockReturnValue(io);

    const res = makeRes();
    await watchHrIngest(reqWith('whr_tok', { heartRate: 100 }), res, next);

    expect(res.statusCode).toBe(202);
    // Exactly ONE call despite two sockets — deliberate single-delivery limitation
    expect(handleBiometricReading).toHaveBeenCalledTimes(1);
  });

  // ── Test 9: malformed Authorization header edge cases → 401 ─────────────
  it('Authorization: "Bearer " (empty token) with User.findOne null → 401', async () => {
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(null) });
    const req = { headers: { authorization: 'Bearer ' }, body: { heartRate: 100 } };
    const res = makeRes();
    await watchHrIngest(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(handleBiometricReading).not.toHaveBeenCalled();
  });

  it('Authorization: "Bearer" (no space) → 401 without any DB lookup', async () => {
    const req = { headers: { authorization: 'Bearer' }, body: { heartRate: 100 } };
    const res = makeRes();
    await watchHrIngest(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(User.findOne).not.toHaveBeenCalled();
    expect(handleBiometricReading).not.toHaveBeenCalled();
  });

  // ── Test 10: getIo() returns null → 409 { live: false } ─────────────────
  it('getIo() returns null → 409 { live: false }; handleBiometricReading NOT called', async () => {
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: 'u1' }) });
    User.updateOne = jest.fn().mockResolvedValue({});
    getIo.mockReturnValue(null);

    const res = makeRes();
    await watchHrIngest(reqWith('whr_tok', { heartRate: 100 }), res, next);

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ live: false });
    expect(handleBiometricReading).not.toHaveBeenCalled();
  });

  // ── Test 11: socket id in room but vanished from sockets map → 409 ───────
  it('socket id in room but missing from sockets map (vanished) → 409 { live: false }', async () => {
    const userId = 'u_vanished';
    // Room has the socket id, but sockets map does NOT
    const rooms = new Map([[`user:${userId}`, new Set(['ghost_sock'])]]);
    const sockets = new Map(); // empty — socket vanished
    const io = { sockets: { adapter: { rooms }, sockets } };

    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: userId }) });
    User.updateOne = jest.fn().mockResolvedValue({});
    getIo.mockReturnValue(io);

    const res = makeRes();
    await watchHrIngest(reqWith('whr_tok', { heartRate: 100 }), res, next);

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ live: false });
    expect(handleBiometricReading).not.toHaveBeenCalled();
  });

  // ── Test 12: req.body entirely undefined → 400, no throw ────────────────
  it('req.body undefined → 400, no throw, next not called with error', async () => {
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: 'u1' }) });
    const res = makeRes();
    await watchHrIngest(reqWith('whr_tok', undefined), res, next);
    expect(res.statusCode).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });

  // ── Test 13: User.updateOne rejects (DB down) → still 202; next NOT called ──
  it('User.updateOne rejects (DB down) → still 202; next NOT called with error', async () => {
    const userId = 'u_dberr';
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: userId }) });
    const { io } = makeIo(userId);
    getIo.mockReturnValue(io);

    // Reject after a tick to simulate async fire-and-forget failure
    let rejectFn;
    const rejectedPromise = new Promise((_, reject) => { rejectFn = reject; });
    User.updateOne = jest.fn().mockReturnValue(rejectedPromise);

    const res = makeRes();
    await watchHrIngest(reqWith('whr_tok', { heartRate: 100 }), res, next);

    // The 202 must be sent before the promise settles
    expect(res.statusCode).toBe(202);

    // Settle the rejected promise and drain microtask queue so the .catch() fires
    rejectFn(new Error('DB down'));
    await Promise.resolve();

    // next must NOT have been called — fire-and-forget swallows the error
    expect(next).not.toHaveBeenCalled();
  });
});
