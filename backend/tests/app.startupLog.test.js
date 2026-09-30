'use strict';

process.env.NODE_ENV       = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET     = 'test-jwt-secret-for-tests-only';
process.env.PORT           = '0'; // an ephemeral port: this test really listens
delete process.env.RUN_WORKERS_IN_PROCESS;

// The startup line is the one place the RUNNING process states what it is. `/health` returns only
// `{status, ts}` (OPS-018), so after a deploy this line in the platform log is how the Node.js
// runtime is proven — Node 20 reached end-of-life on 2026-04-30 and the backend moved to Node 24.
// The line carries NODE_ENV already; it must carry `process.version` too.
//
// `start()` runs for real here: the real express app, the real http server, the real socket.io
// server, the real Sentry wiring (no DSN, so it logs and skips) and the real in-process worker
// switch (off). Only the two datastore connectors are replaced — the log line cannot depend on a
// database — and dotenv, so a developer's local .env (loaded with override:true) cannot rewrite
// PORT or NODE_ENV underneath the test.
jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('../app/config/db', () => jest.fn().mockResolvedValue(undefined));
jest.mock('../app/config/redis', () => ({
  connectRedis: jest.fn().mockResolvedValue(null),
  getRedis: jest.fn(() => null),
  createConnection: jest.fn(),
}));

// Loaded at module scope, outside any test timeout: a cold transform of the whole app is slow on
// Windows (docs/COLD_JEST_TIMEOUT_TASK.md), and that cost says nothing about the line under test.
const { start } = require('../app/index');

const STARTUP_LINE = /^Kokonada backend on port /;

jest.setTimeout(30000);

describe('startup log line', () => {
  let logSpy;
  let signalListenersBefore;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    signalListenersBefore = {
      SIGTERM: process.listeners('SIGTERM'),
      SIGINT: process.listeners('SIGINT'),
    };
  });

  afterEach(async () => {
    // start() arms SIGTERM/SIGINT shutdown handlers; remove only the ones it added.
    for (const signal of ['SIGTERM', 'SIGINT']) {
      for (const fn of process.listeners(signal)) {
        if (!signalListenersBefore[signal].includes(fn)) process.removeListener(signal, fn);
      }
    }
    // io.close() closes the socket.io server AND the http server it is attached to.
    const io = require('../app/sockets').getIo();
    if (io) await new Promise((resolve) => { io.close(() => resolve()); });
    jest.restoreAllMocks();
  });

  it('states the Node.js runtime version next to NODE_ENV', async () => {
    await start();

    const deadline = Date.now() + 5000;
    let line;
    while (!(line = logSpy.mock.calls.map((c) => String(c[0])).find((l) => STARTUP_LINE.test(l)))) {
      if (Date.now() > deadline) throw new Error('the startup line was never logged');
      await new Promise((r) => { setTimeout(r, 10); });
    }

    expect(line).toBe(
      `Kokonada backend on port 0 [${process.env.NODE_ENV}] node=${process.version} routes:ok`,
    );
  });
});
