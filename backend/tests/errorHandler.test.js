'use strict';

// The 5xx→Sentry path must NEVER include the query string: several endpoints carry
// secrets there (webhook ?secret=, OAuth ?code=/?state=). This guards that fix.

const mockCapture = jest.fn();
jest.mock('../app/config/sentry', () => ({ captureException: (...a) => mockCapture(...a) }));

const errorHandler = require('../app/middleware/errorHandler');

function buildRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

describe('errorHandler — Sentry capture', () => {
  beforeEach(() => mockCapture.mockClear());

  it('captures the PATH ONLY (no query string) for 5xx on a secret-bearing URL', () => {
    const req = { method: 'POST', originalUrl: '/api/integrations/garmin/webhook?secret=SUPERSECRET' };
    const err = Object.assign(new Error('db down'), { statusCode: 500 });

    errorHandler(err, req, buildRes(), jest.fn());

    expect(mockCapture).toHaveBeenCalledTimes(1);
    const ctx = mockCapture.mock.calls[0][1];
    expect(ctx.path).toBe('/api/integrations/garmin/webhook');
    expect(ctx.path).not.toContain('secret');
    expect(ctx.path).not.toContain('?');
  });

  it('does NOT report 4xx client errors to Sentry', () => {
    const err = Object.assign(new Error('bad input'), { statusCode: 400 });
    errorHandler(err, { method: 'GET', originalUrl: '/x?token=abc' }, buildRes(), jest.fn());
    expect(mockCapture).not.toHaveBeenCalled();
  });
});
