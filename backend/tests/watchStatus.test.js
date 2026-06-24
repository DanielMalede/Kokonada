'use strict';

// Mock the socket + biometric layers so requiring the controller does not boot
// socket.io. Mirrors backend/tests/watchIntegration.test.js.
jest.mock('../app/sockets', () => ({ getIo: jest.fn(), createSocketServer: jest.fn() }));
jest.mock('../app/sockets/biometricHandler', () => ({
  handleBiometricReading: jest.fn(),
  registerBiometricHandler: jest.fn(),
  generateAndEmitPlaylist: jest.fn(),
}));
jest.mock('../app/models/User');

const { watchStatus } = require('../app/controllers/integrationsController');

function makeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.body = JSON.parse(JSON.stringify(data)); return res; };
  return res;
}

describe('watchStatus', () => {
  it('returns connected:false and lastSeenAt:null when no token', () => {
    const res = makeRes();
    watchStatus({ user: { watchToken: null } }, res);
    expect(res.body).toEqual({ connected: false, lastSeenAt: null });
  });

  it('returns connected:true and the lastSeenAt date when a token exists', () => {
    const res = makeRes();
    watchStatus({ user: { watchToken: { hash: 'abc', createdAt: new Date(), lastSeenAt: new Date('2026-06-24T17:00:00.000Z') } } }, res);
    expect(res.body).toEqual({ connected: true, lastSeenAt: '2026-06-24T17:00:00.000Z' });
  });

  it('returns connected:true and lastSeenAt:null when token exists but never seen', () => {
    const res = makeRes();
    watchStatus({ user: { watchToken: { hash: 'abc', createdAt: new Date(), lastSeenAt: null } } }, res);
    expect(res.body).toEqual({ connected: true, lastSeenAt: null });
  });
});
