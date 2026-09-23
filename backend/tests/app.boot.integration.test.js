'use strict';

process.env.NODE_ENV       = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET     = 'test-jwt-secret-for-tests-only';

// OPS-013 — THE APP IS ASSEMBLED FOR REAL HERE, and nowhere else in this suite.
//
// Every other route test in backend/tests/ mounts a router onto its own throwaway express
// instance, because app/index.js used to auto-start on require. tests/discovery.route.test.js
// says so in its own header. The cost of that was not hypothetical: route-registration
// validity was covered by NOTHING. `router.post(path, undefined)` throws at module load, so
// five undefined handlers could be wired into routes/integrations.js and the entire suite
// would still go green — nothing ever loaded the module. That is exactly what happened
// during the web-removal work.
//
// This file loads the real thing. It is deliberately cheap: no DB, no Redis, no listening
// socket — `start()` is never called, only the module-scope express assembly runs.

// The heavy side-effect modules the app pulls in at require time. Stubbed so assembling the
// app costs nothing, WITHOUT stubbing any router, middleware or controller — the whole point
// is that the real ones are wired.
jest.mock('../app/config/db', () => jest.fn().mockResolvedValue(undefined));
jest.mock('../app/config/redis', () => ({
  connectRedis: jest.fn().mockResolvedValue(undefined),
  getRedis: jest.fn(() => null),
  createConnection: jest.fn(),
}));
jest.mock('../app/workers', () => ({ startInProcessWorkers: jest.fn(() => []) }));
jest.mock('../app/config/sentry', () => ({
  initSentry: jest.fn(),
  captureException: jest.fn(),
  sentryErrorHandler: (err, req, res, next) => next(err),
}));

describe('OPS-013 — the real app assembles', () => {
  let mod;

  it('requiring app/index.js does not throw, and does not start a server', () => {
    expect(() => { mod = require('../app/index'); }).not.toThrow();
    expect(typeof mod.app).toBe('function');   // an express app is a function
    expect(typeof mod.start).toBe('function'); // still exported, still the entry path
  });

  // This is the assertion that would have caught the five undefined handlers. A route whose
  // handler is undefined makes express throw during `router.post(...)` at module load, so if
  // this list can be produced at all, every registered handler resolved to a function.
  it('every registered route has a real handler — no `router.METHOD(path, undefined)`', () => {
    const { app } = require('../app/index');
    const routes = [];
    const walk = (stack, prefix = '') => {
      for (const layer of stack) {
        if (layer.route) {
          const methods = Object.keys(layer.route.methods).filter(Boolean);
          for (const m of methods) routes.push(`${m.toUpperCase()} ${prefix}${layer.route.path}`);
          for (const h of layer.route.stack) expect(typeof h.handle).toBe('function');
        } else if (layer.name === 'router' && layer.handle?.stack) {
          // Recover the mount path from the layer's regexp — good enough for a smoke list.
          const src = layer.regexp?.source ?? '';
          const mount = src
            .replace('^\\/', '/')
            .replace('\\/?(?=\\/|$)', '')
            .replace(/\\\//g, '/')
            .replace(/\$$/, '');
          walk(layer.handle.stack, prefix + (mount === '/^\\/?$/' ? '' : mount));
        }
      }
    };
    walk(app._router?.stack ?? app.router?.stack ?? []);

    expect(routes.length).toBeGreaterThan(20);
    // A couple of load-bearing ones, so a silently-empty list cannot pass this test.
    const flat = routes.join('\n');
    expect(flat).toMatch(/POST .*\/watch\/hr/);
    expect(flat).toMatch(/GET .*\/garmin\/callback/);
    expect(flat).toMatch(/DELETE .*\/account/);
  });

  // The middleware ORDER the suite could never see. This used to assert `csrfOriginGuard` sat
  // ahead of the routers; that guard was deleted with the web surface (CSRF needs an ambient
  // credential, and BE-009 removed the cookie plane). The ORDER question did not go away, so
  // the assertion moves to what can still be named.
  //
  // NOTE ON WHAT THIS CANNOT ASSERT: `apiLimiter` is an anonymous function in the stack —
  // measured, the layer names are ["helmetMiddleware","cookieParser","<anonymous>","jsonParser",
  // "jsonParser","jsonParser","<anonymous>","router",…] — so there is no name to match and a
  // positional guess would pin the Suunto raw-body reader just as happily. Matching `/limit/i`
  // silently found NOTHING and the test only failed because it also asserted "> -1"; without
  // that it would have passed vacuously. Left as named-middleware ordering rather than a
  // positional fiction.
  it('helmet and cookieParser are mounted ahead of every router', () => {
    const { app } = require('../app/index');
    const stack = app._router?.stack ?? app.router?.stack ?? [];
    const names = stack.map((l) => l.name);
    const firstRouter = names.indexOf('router');
    expect(firstRouter).toBeGreaterThan(-1);
    expect(names.indexOf('helmetMiddleware')).toBeGreaterThan(-1);
    expect(names.indexOf('helmetMiddleware')).toBeLessThan(firstRouter);
    expect(names.indexOf('cookieParser')).toBeGreaterThan(-1);
    expect(names.indexOf('cookieParser')).toBeLessThan(firstRouter);
  });

  // And the guard really is gone — not merely unmounted somewhere this test cannot see.
  it('no CSRF Origin guard and no CORS middleware are mounted', () => {
    const { app } = require('../app/index');
    const stack = app._router?.stack ?? app.router?.stack ?? [];
    const names = stack.map((l) => l.name);
    expect(names).not.toContain('csrfOriginGuard');
    expect(names).not.toContain('corsMiddleware');
  });
});
