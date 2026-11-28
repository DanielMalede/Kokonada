'use strict';
// shadow.errorHandlerUpstream401 (RA-3, #320). A provider's 401 is never sent to the app as its own
// 401, and a typed error keeps its code on the wire. Under B1 C1 a codeless 401 on a retried request
// ends the mobile session, so a revoked Spotify grant must not look like a refused Kokonada token.
process.env.NODE_ENV = 'test';
jest.mock('../app/config/sentry', () => ({ captureException: jest.fn() }));
const errorHandler = require('../app/middleware/errorHandler');

const buildRes = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });
const req = { originalUrl: '/api/integrations/spotify/play', method: 'POST' };
// The shape axios 1.x rejects with: AxiosError carries the upstream status on `response` and `status`.
const upstream = (status) => Object.assign(new Error(`Request failed with status code ${status}`), {
  isAxiosError: true, status, response: { status, data: {} },
});

describe('shadow.errorHandlerUpstream401', () => {
  it.each([401, 403, 404, 429, 400])('an upstream axios %i is answered 502, never forwarded', (status) => {
    const res = buildRes();
    errorHandler(upstream(status), req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(502);
  });

  it('an upstream 5xx is answered 502', () => {
    const res = buildRes();
    errorHandler(upstream(503), req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' });
  });

  it('a typed reconnect_required keeps its status and its code', () => {
    const err = Object.assign(new Error('Spotify session expired'), { statusCode: 401, code: 'reconnect_required' });
    const res = buildRes();
    errorHandler(err, { originalUrl: '/api/integrations/spotify/saved-tracks', method: 'PUT' }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Spotify session expired', code: 'reconnect_required' });
  });

  it('a typed error with its own statusCode wins over an upstream response it wraps', () => {
    const err = Object.assign(new Error('Spotify session expired'), {
      statusCode: 401, code: 'reconnect_required', response: { status: 400 },
    });
    const res = buildRes();
    errorHandler(err, req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('a body-parser error keeps its own 4xx status (err.status, no response)', () => {
    const err = Object.assign(new Error('request entity too large'), { status: 413, type: 'entity.too.large' });
    const res = buildRes();
    errorHandler(err, req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(413);
  });

  it('a 5xx never sends a code (a system code like ECONNREFUSED stays server-side)', () => {
    const err = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const res = buildRes();
    errorHandler(err, req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' });
  });

  it('a non-string code is not sent', () => {
    const err = Object.assign(new Error('bad'), { statusCode: 400, code: 42 });
    const res = buildRes();
    errorHandler(err, req, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith({ error: 'bad' });
  });
});
