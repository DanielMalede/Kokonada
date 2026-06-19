# Live Biometric WebSocket Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Attach an authenticated Socket.io server to the existing Express app that receives live biometric pushes from wearables, normalizes them, and fires a `playlist_recalibration` event only when a physiological change is sustained for >60 seconds.

**Architecture:** Two new files in `backend/app/sockets/` — `index.js` (server factory + JWT handshake auth) and `biometricHandler.js` (event handlers + per-user debounce state machine). `app/index.js` is minimally refactored to expose an `http.Server` handle so Socket.io can share the same TCP port. Auth tests use a real socket.io-client against a live test server; debounce-logic tests use a mock socket object for speed and determinism.

**Tech Stack:** socket.io ^4.8.3 (already installed), socket.io-client (new dev dep), cookie (transitive dep of cookie-parser, already present), Jest fake timers for debounce assertions.

## Global Constraints

- Node.js; CommonJS (`require`/`module.exports`) — no ESM
- Cookie name for JWT is `kokonada_token` (exported as `COOKIE_NAME` from `utils/jwt.js`)
- HR delta threshold for recalibration: **10 BPM**
- Debounce duration: **60 000 ms**
- Auth `select()` projection: `'-spotifyToken -youtubeMusicToken -wearableToken'` — same as HTTP auth middleware
- CORS origin locked to `process.env.FRONTEND_URL`
- All tests: `jest --runInBand --forceExit` (no parallel workers)

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `backend/app/index.js` | Swap `app.listen()` → `http.createServer(app)` + call `createSocketServer` |
| Create | `backend/app/sockets/index.js` | Socket.io server factory + JWT handshake auth middleware |
| Create | `backend/app/sockets/biometricHandler.js` | biometric_push/emotion_update/track_skipped handlers + 60s debounce state machine |
| Create | `backend/tests/websocket.test.js` | Integration tests (auth) + unit tests (biometric events, debounce, skip loop) |

---

## Task 1: Install dev dep + refactor HTTP server

**Files:**
- Modify: `backend/app/index.js`

**Interfaces:**
- Produces: `createServer(app)` pattern that Tasks 2–5 tests rely on to attach Socket.io

- [ ] **Step 1: Install socket.io-client as dev dependency**

```bash
cd backend && npm install --save-dev socket.io-client
```

Expected: `package.json` devDependencies gains `"socket.io-client": "^4.x.x"`

- [ ] **Step 2: Refactor app/index.js**

Replace the file with this content (everything identical except the `start()` function):

```js
require('dotenv').config();
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { initSentry } = require('./config/sentry');
const connectDB = require('./config/db');
const { connectRedis } = require('./config/redis');
const { apiLimiter } = require('./middleware/rateLimiter');
const errorHandler = require('./middleware/errorHandler');
const authRouter         = require('./routes/auth');
const integrationsRouter = require('./routes/integrations');
const { createSocketServer } = require('./sockets');

const app = express();

initSentry(app);

app.use(helmet());

app.use(cors({
  origin: process.env.FRONTEND_URL,
  credentials: true,
}));

app.use(cookieParser());

app.use((req, res, next) => {
  if (req.path === '/api/integrations/suunto/webhook') {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => { req.rawBody = data; next(); });
  } else {
    next();
  }
});
app.use(express.json({ limit: '10kb' }));

app.use('/api/', apiLimiter);

app.use('/api/auth',         authRouter);
app.use('/api/integrations', integrationsRouter);

app.get('/health', (req, res) => res.json({ status: 'ok', ts: Date.now() }));

app.use(errorHandler);

const PORT = process.env.PORT || 5000;

async function start() {
  await connectDB();
  await connectRedis();
  const httpServer = http.createServer(app);
  createSocketServer(httpServer);
  httpServer.listen(PORT, () =>
    console.log(`Kokonada backend on port ${PORT} [${process.env.NODE_ENV}]`)
  );
}

start().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
```

- [ ] **Step 3: Verify existing tests still pass**

```bash
cd backend && npm test
```

Expected: same pass count as before (60 tests). If anything fails, the refactor broke something — do not proceed.

- [ ] **Step 4: Commit**

```bash
git add backend/app/index.js backend/package.json backend/package-lock.json
git commit -m "feat: attach socket.io to http.createServer for WebSocket support"
```

---

## Task 2: Socket.io server factory + JWT auth middleware

**Files:**
- Create: `backend/app/sockets/index.js`
- Create: `backend/tests/websocket.test.js` (auth section only; will be extended in Tasks 3–5)

**Interfaces:**
- Consumes: `verifyToken`, `COOKIE_NAME` from `utils/jwt.js`; `User.findById().select()` from `models/User`
- Produces: `createSocketServer(httpServer) → io` — used in `app/index.js` (Task 1) and in tests

- [ ] **Step 1: Write failing auth tests**

Create `backend/tests/websocket.test.js`:

```js
'use strict';

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET      = 'test-jwt-secret-for-tests-only';
process.env.JWT_EXPIRES_IN  = '1h';
process.env.NODE_ENV        = 'test';
process.env.FRONTEND_URL    = 'http://localhost:3000';

const http = require('http');
const { io: Client } = require('socket.io-client');
const { signToken, COOKIE_NAME } = require('../app/utils/jwt');

// ── Mocks ──────────────────────────────────────────────────────────────────────
const mockSelect  = jest.fn();
const mockFindById = jest.fn(() => ({ select: mockSelect }));
jest.mock('../app/models/User', () => ({ findById: (...a) => mockFindById(...a) }));

// ── Helpers ───────────────────────────────────────────────────────────────────
function waitFor(socket, event, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for "${event}"`)), timeoutMs);
    socket.once(event, (data) => { clearTimeout(t); resolve(data); });
  });
}

function connectSocket(port, opts = {}) {
  return Client(`http://localhost:${port}`, {
    forceNew: true,
    transports: ['websocket'],
    ...opts,
  });
}

// ── Suite ─────────────────────────────────────────────────────────────────────
describe('WebSocket auth', () => {
  let httpServer, io, port;
  const MOCK_USER = { _id: 'user123', deletedAt: null };

  beforeAll(done => {
    const express = require('express');
    const app = express();
    httpServer = http.createServer(app);
    const { createSocketServer } = require('../app/sockets');
    io = createSocketServer(httpServer);
    httpServer.listen(0, () => {
      port = httpServer.address().port;
      done();
    });
  });

  afterAll(done => {
    io.close(() => httpServer.close(done));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSelect.mockResolvedValue(MOCK_USER);
  });

  it('disconnects immediately when no token is provided', done => {
    const client = connectSocket(port);
    client.on('connect_error', err => {
      expect(err.message).toBe('unauthorized');
      client.close();
      done();
    });
  });

  it('disconnects when token is invalid', done => {
    const client = connectSocket(port, { auth: { token: 'bad.token.here' } });
    client.on('connect_error', err => {
      expect(err.message).toBe('unauthorized');
      client.close();
      done();
    });
  });

  it('disconnects when user is not found in DB', done => {
    mockSelect.mockResolvedValue(null);
    const token = signToken({ userId: 'ghost' });
    const client = connectSocket(port, { auth: { token } });
    client.on('connect_error', err => {
      expect(err.message).toBe('unauthorized');
      client.close();
      done();
    });
  });

  it('disconnects when user is soft-deleted', done => {
    mockSelect.mockResolvedValue({ _id: 'user123', deletedAt: new Date() });
    const token = signToken({ userId: 'user123' });
    const client = connectSocket(port, { auth: { token } });
    client.on('connect_error', err => {
      expect(err.message).toBe('unauthorized');
      client.close();
      done();
    });
  });

  it('connects successfully with a valid Bearer token in handshake.auth', done => {
    const token = signToken({ userId: MOCK_USER._id });
    const client = connectSocket(port, { auth: { token } });
    client.on('connect', () => {
      expect(mockFindById).toHaveBeenCalledWith(MOCK_USER._id);
      expect(mockSelect).toHaveBeenCalledWith('-spotifyToken -youtubeMusicToken -wearableToken');
      client.close();
      done();
    });
    client.on('connect_error', done);
  });

  it('connects successfully with a valid token in cookie header', done => {
    const token = signToken({ userId: MOCK_USER._id });
    const client = connectSocket(port, {
      extraHeaders: { cookie: `${COOKIE_NAME}=${token}` },
    });
    client.on('connect', () => {
      client.close();
      done();
    });
    client.on('connect_error', done);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && npm test -- --testPathPattern=websocket
```

Expected: FAIL — `Cannot find module '../app/sockets'`

- [ ] **Step 3: Create `backend/app/sockets/index.js`**

```js
'use strict';

const { Server } = require('socket.io');
const cookie = require('cookie');
const { verifyToken, COOKIE_NAME } = require('../utils/jwt');
const User = require('../models/User');
const { registerBiometricHandler } = require('./biometricHandler');

function createSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL,
      credentials: true,
    },
  });

  io.use(async (socket, next) => {
    try {
      let token = socket.handshake.auth?.token;

      if (!token) {
        const rawCookie = socket.handshake.headers.cookie;
        if (rawCookie) {
          const parsed = cookie.parse(rawCookie);
          token = parsed[COOKIE_NAME];
        }
      }

      if (!token) return next(new Error('unauthorized'));

      const payload = verifyToken(token);
      const user = await User.findById(payload.userId).select(
        '-spotifyToken -youtubeMusicToken -wearableToken'
      );

      if (!user || user.deletedAt) return next(new Error('unauthorized'));

      socket.data.user = user;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(`user:${socket.data.user._id}`);
    registerBiometricHandler(socket);
  });

  return io;
}

module.exports = { createSocketServer };
```

- [ ] **Step 4: Create stub `backend/app/sockets/biometricHandler.js`** (minimum to unblock auth tests)

```js
'use strict';

function registerBiometricHandler(_socket) {}

module.exports = { registerBiometricHandler };
```

- [ ] **Step 5: Run auth tests to verify they pass**

```bash
cd backend && npm test -- --testPathPattern=websocket
```

Expected: 6 tests PASS

- [ ] **Step 6: Run full suite to check for regressions**

```bash
cd backend && npm test
```

Expected: all previously passing tests still pass + 6 new ones.

- [ ] **Step 7: Commit**

```bash
git add backend/app/sockets/index.js backend/app/sockets/biometricHandler.js backend/tests/websocket.test.js
git commit -m "feat: socket.io server factory with JWT handshake auth"
```

---

## Task 3: biometric_push → normalize → biometric_ack

**Files:**
- Modify: `backend/app/sockets/biometricHandler.js`
- Modify: `backend/tests/websocket.test.js` (append new describe block)

**Interfaces:**
- Consumes: `normalize(source, raw)` from `services/wearable/adapter.js`
- Produces: `biometric_ack` event `{ normalized: NormalizedReading }` and `connection_error` event `{ message: string }`

- [ ] **Step 1: Append failing tests to `backend/tests/websocket.test.js`**

Add this `describe` block at the bottom of the file (outside the existing `describe` block):

```js
// ── Biometric handler unit tests ───────────────────────────────────────────────
// These tests use a mock socket object — no network needed.
describe('biometricHandler — normalize + ack', () => {
  const { registerBiometricHandler, _debounceMap } = require('../app/sockets/biometricHandler');

  function makeMockSocket(userId = 'user-abc') {
    const handlers = {};
    return {
      data: { user: { _id: userId } },
      emit: jest.fn(),
      on: jest.fn((event, fn) => { handlers[event] = fn; }),
      _trigger: (event, payload) => handlers[event]?.(payload),
    };
  }

  afterEach(() => {
    _debounceMap.clear();
  });

  it('emits biometric_ack with normalized data on valid garmin push', () => {
    const socket = makeMockSocket();
    registerBiometricHandler(socket);

    socket._trigger('biometric_push', {
      source: 'garmin',
      raw: { heartRate: 75, activityType: 1, startTimeLocal: '2026-01-01T10:00:00' },
    });

    expect(socket.emit).toHaveBeenCalledWith('biometric_ack', {
      normalized: expect.objectContaining({
        heartRate: 75,
        activity: 'running',
        source: 'garmin',
      }),
    });
  });

  it('emits biometric_ack with normalized data on valid apple_health push', () => {
    const socket = makeMockSocket();
    registerBiometricHandler(socket);

    socket._trigger('biometric_push', {
      source: 'apple_health',
      raw: {
        value: 88,
        workoutType: 'HKWorkoutActivityTypeRunning',
        startDate: '2026-01-01T10:00:00',
      },
    });

    expect(socket.emit).toHaveBeenCalledWith('biometric_ack', {
      normalized: expect.objectContaining({ heartRate: 88, source: 'apple_health' }),
    });
  });

  it('emits connection_error and does NOT disconnect on unknown source', () => {
    const socket = makeMockSocket();
    registerBiometricHandler(socket);

    socket._trigger('biometric_push', { source: 'fitbit', raw: {} });

    expect(socket.emit).toHaveBeenCalledWith('connection_error', {
      message: expect.stringContaining('Unknown wearable source'),
    });
    // biometric_ack must NOT have been emitted
    const ackCall = socket.emit.mock.calls.find(([e]) => e === 'biometric_ack');
    expect(ackCall).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && npm test -- --testPathPattern=websocket
```

Expected: 3 new tests FAIL — `_debounceMap` not exported, normalize not called.

- [ ] **Step 3: Implement `biometricHandler.js` (normalize + ack only)**

Replace the stub with this full implementation:

```js
'use strict';

const { normalize } = require('../services/wearable/adapter');

const debounceMap = new Map();
const HR_DELTA_THRESHOLD = 10;
const DEBOUNCE_MS = 60_000;

function getState(userId) {
  if (!debounceMap.has(userId)) {
    debounceMap.set(userId, {
      stableHR:        null,
      pendingHR:       null,
      latestActivity:  null,
      timer:           null,
      consecutiveSkips: 0,
      lastEmotionTaps: [],
    });
  }
  return debounceMap.get(userId);
}

function clearTimer(state) {
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer    = null;
    state.pendingHR = null;
  }
}

function registerBiometricHandler(socket) {
  const userId = String(socket.data.user._id);

  socket.on('biometric_push', ({ source, raw } = {}) => {
    let normalized;
    try {
      normalized = normalize(source, raw);
    } catch (err) {
      socket.emit('connection_error', { message: err.message });
      return;
    }

    socket.emit('biometric_ack', { normalized });

    const state = getState(userId);
    state.consecutiveSkips  = 0;
    state.latestActivity    = normalized.activity;

    if (state.stableHR === null) {
      state.stableHR = normalized.heartRate;
      return;
    }

    const delta = Math.abs(normalized.heartRate - state.stableHR);

    if (delta < HR_DELTA_THRESHOLD) {
      if (state.timer) {
        clearTimer(state);
        socket.emit('recalibration_cancelled', { reason: 'change_reverted' });
      }
      state.stableHR = normalized.heartRate;
      return;
    }

    // delta >= threshold
    if (state.timer) return;

    state.pendingHR = normalized.heartRate;
    state.timer = setTimeout(() => {
      const s = debounceMap.get(userId);
      if (!s) return;
      const currentDelta = Math.abs(s.pendingHR - s.stableHR);
      if (currentDelta >= HR_DELTA_THRESHOLD) {
        s.stableHR = s.pendingHR;
        socket.emit('playlist_recalibration', {
          heartRate:    s.stableHR,
          activity:     s.latestActivity,
          emotionTaps:  s.lastEmotionTaps,
          trigger:      'biometric',
        });
      } else {
        socket.emit('recalibration_cancelled', { reason: 'change_reverted' });
      }
      clearTimer(s);
    }, DEBOUNCE_MS);

    socket.emit('recalibration_pending', { delta, secondsRemaining: 60 });
  });

  socket.on('emotion_update', ({ taps = [] } = {}) => {
    getState(userId).lastEmotionTaps = taps;
  });

  socket.on('track_skipped', () => {
    const state = getState(userId);
    state.consecutiveSkips += 1;

    if (state.consecutiveSkips >= 2) {
      clearTimer(state);
      socket.emit('playlist_recalibration', {
        heartRate:   state.stableHR,
        activity:    state.latestActivity,
        emotionTaps: state.lastEmotionTaps,
        trigger:     'skip_loop',
      });
      state.consecutiveSkips = 0;
    }
  });

  socket.on('disconnect', () => {
    const state = debounceMap.get(userId);
    if (state) {
      clearTimer(state);
      debounceMap.delete(userId);
    }
  });
}

module.exports = { registerBiometricHandler, _debounceMap: debounceMap };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && npm test -- --testPathPattern=websocket
```

Expected: all 9 tests pass (6 auth + 3 normalize/ack).

- [ ] **Step 5: Commit**

```bash
git add backend/app/sockets/biometricHandler.js backend/tests/websocket.test.js
git commit -m "feat: biometric_push handler — normalize via adapter + emit biometric_ack"
```

---

## Task 4: 60-second debounce state machine

**Files:**
- No new implementation code — the full `biometricHandler.js` was written in Task 3
- Modify: `backend/tests/websocket.test.js` (append new describe block)

**Interfaces:**
- Consumes: `registerBiometricHandler`, `_debounceMap` from `biometricHandler.js`
- Produces: `recalibration_pending`, `recalibration_cancelled`, `playlist_recalibration` events

- [ ] **Step 1: Append failing debounce tests to `backend/tests/websocket.test.js`**

Add this block at the bottom of the file:

```js
describe('biometricHandler — 60-second debounce', () => {
  const { registerBiometricHandler, _debounceMap } = require('../app/sockets/biometricHandler');

  function makeMockSocket(userId = 'user-debounce') {
    const handlers = {};
    return {
      data: { user: { _id: userId } },
      emit: jest.fn(),
      on: jest.fn((event, fn) => { handlers[event] = fn; }),
      _trigger: (event, payload) => handlers[event]?.(payload),
    };
  }

  const GARMIN_RAW = (hr, activityType = 0) => ({
    source: 'garmin',
    raw: { heartRate: hr, activityType, startTimeLocal: '2026-01-01T10:00:00' },
  });

  beforeEach(() => {
    jest.useFakeTimers();
    _debounceMap.clear();
  });

  afterEach(() => {
    jest.useRealTimers();
    _debounceMap.clear();
  });

  it('does NOT emit recalibration_pending when delta < 10 BPM', () => {
    const socket = makeMockSocket();
    registerBiometricHandler(socket);

    socket._trigger('biometric_push', GARMIN_RAW(70)); // sets stableHR = 70
    socket._trigger('biometric_push', GARMIN_RAW(75)); // delta = 5, below threshold

    const pendingCall = socket.emit.mock.calls.find(([e]) => e === 'recalibration_pending');
    expect(pendingCall).toBeUndefined();
  });

  it('emits recalibration_pending when delta >= 10 BPM', () => {
    const socket = makeMockSocket();
    registerBiometricHandler(socket);

    socket._trigger('biometric_push', GARMIN_RAW(70));
    socket._trigger('biometric_push', GARMIN_RAW(85)); // delta = 15

    expect(socket.emit).toHaveBeenCalledWith('recalibration_pending', {
      delta: 15,
      secondsRemaining: 60,
    });
  });

  it('does NOT start a second timer if one is already running', () => {
    const socket = makeMockSocket();
    registerBiometricHandler(socket);

    socket._trigger('biometric_push', GARMIN_RAW(70));
    socket._trigger('biometric_push', GARMIN_RAW(85)); // starts timer
    socket._trigger('biometric_push', GARMIN_RAW(90)); // should be ignored

    const pendingCalls = socket.emit.mock.calls.filter(([e]) => e === 'recalibration_pending');
    expect(pendingCalls).toHaveLength(1); // only one timer ever started
  });

  it('emits playlist_recalibration after 60 seconds of sustained change', () => {
    const socket = makeMockSocket();
    registerBiometricHandler(socket);

    socket._trigger('biometric_push', GARMIN_RAW(70));
    socket._trigger('biometric_push', GARMIN_RAW(85));

    jest.advanceTimersByTime(60_000);

    expect(socket.emit).toHaveBeenCalledWith('playlist_recalibration', expect.objectContaining({
      heartRate: 85,
      trigger: 'biometric',
    }));
  });

  it('emits recalibration_cancelled and clears timer when HR returns below threshold', () => {
    const socket = makeMockSocket();
    registerBiometricHandler(socket);

    socket._trigger('biometric_push', GARMIN_RAW(70));
    socket._trigger('biometric_push', GARMIN_RAW(85)); // starts timer
    socket._trigger('biometric_push', GARMIN_RAW(72)); // delta = 2, below threshold

    // Timer was cancelled — advancing 60s should NOT emit recalibration
    jest.advanceTimersByTime(60_000);

    expect(socket.emit).toHaveBeenCalledWith('recalibration_cancelled', { reason: 'change_reverted' });
    const recalCalls = socket.emit.mock.calls.filter(([e]) => e === 'playlist_recalibration');
    expect(recalCalls).toHaveLength(0);
  });

  it('clears the timer and deletes state on disconnect — no event fires after', () => {
    const socket = makeMockSocket('user-disconnect-test');
    registerBiometricHandler(socket);

    socket._trigger('biometric_push', GARMIN_RAW(70));
    socket._trigger('biometric_push', GARMIN_RAW(85)); // starts timer

    socket._trigger('disconnect');

    jest.advanceTimersByTime(60_000);

    // No recalibration or cancelled event after disconnect
    const recalCalls = socket.emit.mock.calls.filter(
      ([e]) => e === 'playlist_recalibration' || e === 'recalibration_cancelled'
    );
    expect(recalCalls).toHaveLength(0);
    expect(_debounceMap.has('user-disconnect-test')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && npm test -- --testPathPattern=websocket
```

Expected: 6 new tests FAIL — the implementation doesn't exist yet for the debounce assertions.

> **Note:** The biometricHandler.js was already fully implemented in Task 3. If all 6 tests PASS at this step (not just fail), that means the implementation from Task 3 was complete. Skip Step 3 and go straight to Step 4.

- [ ] **Step 3: (Only if Step 2 tests failed) Verify biometricHandler.js matches the full implementation from Task 3**

Check that `backend/app/sockets/biometricHandler.js` contains the `setTimeout` / `clearTimer` logic from Task 3 Step 3. If it was replaced with a stub at any point, restore the full implementation.

- [ ] **Step 4: Run tests to verify all pass**

```bash
cd backend && npm test -- --testPathPattern=websocket
```

Expected: 15 tests pass (6 auth + 3 normalize/ack + 6 debounce).

- [ ] **Step 5: Commit**

```bash
git add backend/tests/websocket.test.js
git commit -m "test: 60-second debounce state machine — recalibration_pending, cancelled, recalibration"
```

---

## Task 5: Skip-loop bypass (two consecutive skips → immediate recalibration)

**Files:**
- No new implementation code
- Modify: `backend/tests/websocket.test.js` (append final describe block)

**Interfaces:**
- Consumes: `registerBiometricHandler`, `_debounceMap` from `biometricHandler.js`
- Produces: `playlist_recalibration` event with `trigger: 'skip_loop'`

- [ ] **Step 1: Append skip-loop tests to `backend/tests/websocket.test.js`**

Add this block at the bottom of the file:

```js
describe('biometricHandler — skip loop', () => {
  const { registerBiometricHandler, _debounceMap } = require('../app/sockets/biometricHandler');

  function makeMockSocket(userId = 'user-skip') {
    const handlers = {};
    return {
      data: { user: { _id: userId } },
      emit: jest.fn(),
      on: jest.fn((event, fn) => { handlers[event] = fn; }),
      _trigger: (event, payload) => handlers[event]?.(payload),
    };
  }

  beforeEach(() => {
    jest.useFakeTimers();
    _debounceMap.clear();
  });

  afterEach(() => {
    jest.useRealTimers();
    _debounceMap.clear();
  });

  it('does NOT recalibrate on a single skip', () => {
    const socket = makeMockSocket();
    registerBiometricHandler(socket);

    socket._trigger('track_skipped', {});

    const recalCalls = socket.emit.mock.calls.filter(([e]) => e === 'playlist_recalibration');
    expect(recalCalls).toHaveLength(0);
  });

  it('emits playlist_recalibration with trigger=skip_loop on two consecutive skips', () => {
    const socket = makeMockSocket();
    registerBiometricHandler(socket);

    socket._trigger('track_skipped', {});
    socket._trigger('track_skipped', {});

    expect(socket.emit).toHaveBeenCalledWith('playlist_recalibration', expect.objectContaining({
      trigger: 'skip_loop',
    }));
  });

  it('resets skip counter after two skips so a third pair is needed for another recalibration', () => {
    const socket = makeMockSocket();
    registerBiometricHandler(socket);

    socket._trigger('track_skipped', {});
    socket._trigger('track_skipped', {}); // fires recalibration, resets counter to 0

    socket.emit.mockClear();

    socket._trigger('track_skipped', {}); // counter = 1, no recalibration yet

    const recalCalls = socket.emit.mock.calls.filter(([e]) => e === 'playlist_recalibration');
    expect(recalCalls).toHaveLength(0);
  });

  it('resets skip counter on biometric_push so skips must be consecutive', () => {
    const socket = makeMockSocket();
    registerBiometricHandler(socket);

    socket._trigger('track_skipped', {}); // counter = 1
    // biometric_push resets the counter
    socket._trigger('biometric_push', {
      source: 'garmin',
      raw: { heartRate: 70, activityType: 0, startTimeLocal: '2026-01-01T10:00:00' },
    });
    socket._trigger('track_skipped', {}); // counter back to 1, not 2

    const recalCalls = socket.emit.mock.calls.filter(([e]) => e === 'playlist_recalibration');
    expect(recalCalls).toHaveLength(0);
  });

  it('two consecutive skips cancel any running debounce timer', () => {
    const socket = makeMockSocket();
    registerBiometricHandler(socket);

    // Start a debounce timer
    socket._trigger('biometric_push', {
      source: 'garmin',
      raw: { heartRate: 70, activityType: 0, startTimeLocal: '2026-01-01T10:00:00' },
    });
    socket._trigger('biometric_push', {
      source: 'garmin',
      raw: { heartRate: 85, activityType: 1, startTimeLocal: '2026-01-01T10:00:01' },
    });
    // Timer is now running

    socket._trigger('track_skipped', {});
    socket._trigger('track_skipped', {}); // fires skip_loop recalibration + clears timer

    socket.emit.mockClear();

    jest.advanceTimersByTime(60_000); // timer should be gone — no second recalibration

    const recalCalls = socket.emit.mock.calls.filter(([e]) => e === 'playlist_recalibration');
    expect(recalCalls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && npm test -- --testPathPattern=websocket
```

Expected: 5 new tests FAIL.

> Same note as Task 4: if they all PASS because the implementation from Task 3 was complete, skip Step 3.

- [ ] **Step 3: Run full suite**

```bash
cd backend && npm test
```

Expected: 20 WebSocket tests pass + all 60 original tests = 80 total. No regressions.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/websocket.test.js
git commit -m "test: skip-loop bypass — two consecutive skips trigger immediate playlist_recalibration"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered by |
|---|---|
| Socket.io attached to existing Express HTTP server | Task 1 |
| JWT auth: Bearer token (native mobile) | Task 2 — `handshake.auth.token` |
| JWT auth: cookie (web/PWA) | Task 2 — parsed from `handshake.headers.cookie` using `COOKIE_NAME` |
| Reject unauthenticated / soft-deleted user | Task 2 tests |
| `biometric_push` → normalize → `biometric_ack` | Task 3 |
| Unknown source → `connection_error`, no disconnect | Task 3 |
| Delta < 10 BPM → no pending | Task 4 |
| Delta >= 10 BPM → `recalibration_pending` | Task 4 |
| Sustained 60 s → `playlist_recalibration` (trigger: biometric) | Task 4 |
| Change reverts before 60 s → `recalibration_cancelled` | Task 4 |
| Disconnect mid-timer → timer cleared | Task 4 |
| 2 consecutive skips → `playlist_recalibration` (trigger: skip_loop) | Task 5 |
| Skip counter resets on biometric_push | Task 5 |
| Double-skip cancels running debounce timer | Task 5 |
| `emotion_update` stored in state | Implemented in Task 3, included in recalibration payloads |
| Multi-device: both sockets in same `user:<id>` room | Task 2 — `socket.join(...)` |

**Placeholder scan:** No TBD, TODO, or vague steps found.

**Type consistency:** `_debounceMap` exported and referenced identically across Tasks 3, 4, 5. `makeMockSocket()` helper is repeated in each describe block (Tasks 3–5) — intentional, so each task is independently readable. `GARMIN_RAW` helper defined in Task 4 only (not needed in Task 5 which sends its own inline raw objects). No cross-task naming drift found.
