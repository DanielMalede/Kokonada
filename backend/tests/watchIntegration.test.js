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
  });
});
