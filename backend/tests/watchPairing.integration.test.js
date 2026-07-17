'use strict';

// REAL-Mongo integration test (mongodb-memory-server) for the watch pairing-code
// exchange (T5). The unit test (watchIntegration.test.js) asserts findOneAndUpdate
// call SHAPE against a MOCKED User model — that proves the code calls Mongo correctly,
// but it cannot prove Mongo's atomic-update semantics actually reject a second
// concurrent exchange of the same code. This test proves it against a real database
// (resilience audit T5-2: closes the false-green gap in test depth).
process.env.NODE_ENV = 'test';

jest.mock('../app/sockets', () => ({ getIo: jest.fn(), createSocketServer: jest.fn() }));
jest.mock('../app/sockets/biometricHandler', () => ({
  handleBiometricReading: jest.fn(),
  registerBiometricHandler: jest.fn(),
  generateAndEmitPlaylist: jest.fn(),
}));

const crypto = require('crypto');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const User = require('../app/models/User');
const { exchangeWatchPairing } = require('../app/controllers/integrationsController');

jest.setTimeout(120000);

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function makeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.body = data; return res; };
  return res;
}

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_wave5_pairing_it' });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});
beforeEach(async () => {
  await User.deleteMany({});
});

describe('exchangeWatchPairing (real Mongo, concurrency)', () => {
  it('two parallel exchanges of one pairing code → exactly one 201, the other 401 (single-use holds under a real race)', async () => {
    const code = '482913';
    const hash = sha256(code);
    await User.create({
      ssoProvider: 'password', ssoId: 'watch-pairing-race', email: 'race@example.com',
      watchPairing: { hash, expiresAt: new Date(Date.now() + 60_000) },
    });

    const next = jest.fn();
    const res1 = makeRes();
    const res2 = makeRes();

    await Promise.all([
      exchangeWatchPairing({ body: { code } }, res1, next),
      exchangeWatchPairing({ body: { code } }, res2, next),
    ]);

    const codes = [res1.statusCode, res2.statusCode].sort((a, b) => a - b);
    expect(codes).toEqual([201, 401]);
    expect(next).not.toHaveBeenCalled();

    // Exactly one whr_ token was actually minted server-side.
    const winner = res1.statusCode === 201 ? res1 : res2;
    expect(winner.body.token).toMatch(/^whr_[A-Za-z0-9_-]+$/);
    const user = await User.findOne({ 'watchToken.hash': sha256(winner.body.token) });
    expect(user).not.toBeNull();

    // The pairing is truly consumed at the raw-driver level. (Checked via the raw
    // collection, not `user.watchPairing === null` in JS: Mongoose casts a $set-to-null
    // single-nested path into a Document wrapper with undefined leaves on hydrate —
    // truthy in JS despite serializing as `null` — so this is the real ground truth,
    // and also exactly what the atomic exchange's own filter query runs against.)
    const raw = await User.collection.findOne({ _id: user._id });
    expect(raw.watchPairing).toBeNull();

    // Functional proof, from the caller's point of view: a THIRD attempt with the
    // same code, after the race has settled, must also fail.
    const third = makeRes();
    await exchangeWatchPairing({ body: { code } }, third, next);
    expect(third.statusCode).toBe(401);

    // No second user/token was created by the loser.
    expect(await User.countDocuments({})).toBe(1);
  });

  it('a wrong guess does not consume a still-valid code — the correct code still exchanges right after', async () => {
    const code = '555222';
    const hash = sha256(code);
    await User.create({
      ssoProvider: 'password', ssoId: 'watch-pairing-wrongguess', email: 'wrongguess@example.com',
      watchPairing: { hash, expiresAt: new Date(Date.now() + 60_000) },
    });
    const next = jest.fn();

    const wrong = makeRes();
    await exchangeWatchPairing({ body: { code: '000000' } }, wrong, next);
    expect(wrong.statusCode).toBe(401);

    const right = makeRes();
    await exchangeWatchPairing({ body: { code } }, right, next);
    expect(right.statusCode).toBe(201);
  });

  it('an expired pairing (TTL elapsed) is rejected even though the hash still matches', async () => {
    const code = '111222';
    const hash = sha256(code);
    await User.create({
      ssoProvider: 'password', ssoId: 'watch-pairing-expired', email: 'expired@example.com',
      watchPairing: { hash, expiresAt: new Date(Date.now() - 1000) }, // already expired
    });
    const next = jest.fn();

    const res = makeRes();
    await exchangeWatchPairing({ body: { code } }, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
});
