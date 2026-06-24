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
});
