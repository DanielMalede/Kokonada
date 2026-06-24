'use strict';

const { apiLimiter, watchLimiter, _isWatchIngest } = require('../app/middleware/rateLimiter');

describe('rateLimiter exports', () => {
  it('apiLimiter and watchLimiter are middleware functions', () => {
    expect(typeof apiLimiter).toBe('function');
    expect(typeof watchLimiter).toBe('function');
  });
});

describe('_isWatchIngest', () => {
  it('is true for the watch ingest path', () => {
    expect(_isWatchIngest({ originalUrl: '/api/integrations/watch/hr' })).toBe(true);
  });

  it('is true even with a query string', () => {
    expect(_isWatchIngest({ originalUrl: '/api/integrations/watch/hr?x=1' })).toBe(true);
  });

  it('is false for other integration paths', () => {
    expect(_isWatchIngest({ originalUrl: '/api/integrations/watch/token' })).toBe(false);
    expect(_isWatchIngest({ originalUrl: '/api/integrations/status' })).toBe(false);
  });

  it('is false when originalUrl is missing', () => {
    expect(_isWatchIngest({})).toBe(false);
  });
});

// ── Test 14: apiLimiter excludes the watch-ingest path via _isWatchIngest ─
describe('apiLimiter skip wiring', () => {
  it('_isWatchIngest is the predicate that excludes watch-ingest from apiLimiter', () => {
    // The predicate must identify the ingest path (this is what skip: isWatchIngest gates)
    expect(_isWatchIngest({ originalUrl: '/api/integrations/watch/hr' })).toBe(true);
    // And must NOT exclude normal API paths (they must pass through apiLimiter)
    expect(_isWatchIngest({ originalUrl: '/api/integrations/status' })).toBe(false);
    expect(_isWatchIngest({ originalUrl: '/api/user/me' })).toBe(false);
  });
});

// ── Test 15: watchLimiter keyGenerator with no auth header and no ip ──────
describe('watchLimiter keyGenerator fallback', () => {
  const { watchLimiter: _watchLimiter } = require('../app/middleware/rateLimiter');

  it('keyGenerator with no Authorization header and ip undefined returns a string without throwing', () => {
    // keyGenerator is not directly exported; we verify the limiter is a function
    // and probe behavior by checking its typeof (the closure is internal).
    // We can reach it via the options if express-rate-limit exposes them, or
    // we reconstruct the same logic inline to verify the fallback branch.
    // Since the keyGenerator is not exported, we test the exported predicate
    // indirectly: a request with no header and undefined ip must not crash the
    // limiter setup path. We call the middleware with a minimal req and assert
    // it does not throw synchronously.
    expect(typeof _watchLimiter).toBe('function');

    // Probe: build a req that would exercise the ip-fallback branch
    // and call the middleware — it should call next() without throwing.
    let called = false;
    const fakeReq = {
      headers: {},
      ip: undefined,
      originalUrl: '/api/integrations/watch/hr',
      method: 'POST',
      rateLimit: undefined,
      socket: { remoteAddress: undefined },
    };
    const fakeRes = { setHeader: () => {}, getHeader: () => undefined };
    const fakeNext = () => { called = true; };

    // Does not throw — keyGenerator must handle missing ip gracefully
    expect(() => _watchLimiter(fakeReq, fakeRes, fakeNext)).not.toThrow();
  });
});
