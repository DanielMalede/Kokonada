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
