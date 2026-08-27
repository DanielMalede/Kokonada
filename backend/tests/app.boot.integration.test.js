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

  // The middleware ORDER the suite could never see. csrfOriginGuard must sit AHEAD of the
  // routers, or it guards nothing — and cookieParser must precede it or `req.cookies` is
  // undefined inside it.
  it('csrfOriginGuard is mounted ahead of the API routers', () => {
    const { app } = require('../app/index');
    const stack = app._router?.stack ?? app.router?.stack ?? [];
    const names = stack.map((l) => l.name);
    const guardIdx  = names.indexOf('csrfOriginGuard');
    const routerIdx = names.indexOf('router');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(routerIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(routerIdx);
  });
});
