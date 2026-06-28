# Watch HR Ingest — Backend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the backend foundation for real-time Garmin watch heart-rate streaming — a public HTTP ingest endpoint that authenticates a sideloaded watch app by an opaque device token and feeds readings into the existing Socket.IO biometric pipeline, plus token issue/revoke endpoints and a guard that disables the legacy Garmin Web-API poller.

**Architecture:** The watch POSTs HR to `POST /api/integrations/watch/hr` with an `Authorization: Bearer whr_…` token. The handler hashes the token, finds the owning user, looks up that user's live browser socket via a new `getIo()` accessor, and calls the existing `handleBiometricReading(socket, 'garmin', raw)` — reusing the entire downstream pipeline (normalize → 60s/10bpm debounce → AI → Spotify/YouTube → `playlist_ready`) unchanged. Device tokens are stored only as a sha256 hash on the User model and minted/revoked behind the existing auth middleware.

**Tech Stack:** Node.js (CommonJS), Express, Mongoose, Socket.IO v4, `express-rate-limit`, Node `crypto`, Jest (`--runInBand --forceExit`).

## Global Constraints

- Backend test framework: Jest with CommonJS (`require`/`module.exports`) — run with `--runInBand --forceExit --no-coverage`.
- No new production npm dependencies — everything used (`crypto`, `express-rate-limit`, `socket.io`, `mongoose`) is already present.
- Controllers export named functions; routes wire them; services are pure functions (existing pattern in `backend/app/controllers/integrationsController.js`).
- Public routes (no session cookie/JWT) are mounted **above** `router.use(auth)` in `backend/app/routes/integrations.js`; authenticated routes below it. The watch ingest endpoint is PUBLIC (device-token auth); the token issue/revoke endpoints are AUTHENTICATED.
- `csrfOriginGuard` already lets no-`Origin` POSTs through (non-browser clients), so the watch POST needs no CSRF changes.
- Adapter contract: the raw object passed to `handleBiometricReading` for source `'garmin'` must be `{ heartRate: number, activityType: number, startTimeLocal: string }` (matches `backend/app/services/wearable/adapter.js` `fromGarmin`).
- Garmin numeric activity IDs (from `ACTIVITY_MAP.garmin`): `0` resting, `1` running, `2` cycling, `5` swimming, `6` walking, `13` strength. Unknown → `0`.
- Device token format: `whr_` + `crypto.randomBytes(32).toString('base64url')`. Stored as `sha256(token)` hex; plaintext returned to the client exactly once.
- HR validation range: number, `30 <= heartRate <= 230`. Out of range / non-number → `400`.
- **Commit messages: short, single-line, no body, no trailers** (user preference).
- All existing backend tests must remain green after every task (`0 failed`).

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `backend/app/models/User.js` | Add hashed `watchToken` subdoc + index on `watchToken.hash` |
| Modify | `backend/app/sockets/index.js` | Add module-level `getIo()` accessor returning the live `io` |
| Modify | `backend/app/middleware/rateLimiter.js` | Add `watchLimiter` + `isWatchIngest` skip; exclude ingest path from `apiLimiter` |
| Modify | `backend/app/controllers/integrationsController.js` | Add `issueWatchToken`, `revokeWatchToken`, `watchHrIngest` |
| Modify | `backend/app/routes/integrations.js` | Wire `POST /watch/hr` (public + `watchLimiter`); `POST`/`DELETE /watch/token` (auth) |
| Modify | `backend/app/index.js` | Gate `startGarminPoller(io)` behind `ENABLE_GARMIN_POLLER` (default off) |
| Create | `backend/tests/userModel.watchToken.test.js` | Schema-path + index assertions |
| Create | `backend/tests/socketGetIo.test.js` | `getIo()` returns the io after `createSocketServer` |
| Create | `backend/tests/rateLimiter.test.js` | `isWatchIngest` predicate + `watchLimiter` shape |
| Create | `backend/tests/watchIntegration.test.js` | Controller unit tests for issue/revoke + ingest |

---

## Task 1: User model — `watchToken` field + index

**Files:**
- Modify: `backend/app/models/User.js`
- Test: `backend/tests/userModel.watchToken.test.js`

**Interfaces:**
- Produces: User schema paths `watchToken.hash` (String, indexed), `watchToken.createdAt` (Date), `watchToken.lastSeenAt` (Date) — consumed by Tasks 4 and 5.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/userModel.watchToken.test.js`:

```javascript
'use strict';

const User = require('../app/models/User');

describe('User.watchToken schema', () => {
  it('defines a string watchToken.hash path', () => {
    const path = User.schema.path('watchToken.hash');
    expect(path).toBeDefined();
    expect(path.instance).toBe('String');
  });

  it('defines watchToken.createdAt and watchToken.lastSeenAt date paths', () => {
    expect(User.schema.path('watchToken.createdAt').instance).toBe('Date');
    expect(User.schema.path('watchToken.lastSeenAt').instance).toBe('Date');
  });

  it('declares an index on watchToken.hash', () => {
    const hasIndex = User.schema.indexes().some(
      ([fields]) => Object.prototype.hasOwnProperty.call(fields, 'watchToken.hash')
    );
    expect(hasIndex).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npx jest tests/userModel.watchToken.test.js --no-coverage --runInBand
```

Expected: FAIL — `Cannot read properties of undefined` / `path is undefined` (watchToken not defined yet).

- [ ] **Step 3: Add the `watchToken` subdoc to the schema**

In `backend/app/models/User.js`, inside the `userSchema` definition, add after the `wearableToken` line (line 20):

```javascript
  // Opaque device token for the sideloaded Garmin watch app (HR streaming).
  // We store ONLY the sha256 hash — the plaintext (whr_…) is shown to the user
  // once at generation time and pasted into Garmin Connect app settings.
  watchToken: {
    hash:       { type: String, default: null },
    createdAt:  { type: Date,   default: null },
    lastSeenAt: { type: Date,   default: null },
  },
```

- [ ] **Step 4: Add the index**

In `backend/app/models/User.js`, after the existing `userSchema.index(...)` lines (after line 36), add:

```javascript
userSchema.index({ 'watchToken.hash': 1 });
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd backend && npx jest tests/userModel.watchToken.test.js --no-coverage --runInBand
```

Expected: PASS — 3 tests.

- [ ] **Step 6: Commit**

```bash
git add backend/app/models/User.js backend/tests/userModel.watchToken.test.js
git commit -m "feat: add hashed watchToken field to User model"
```

---

## Task 2: `getIo()` accessor on the socket server

**Files:**
- Modify: `backend/app/sockets/index.js`
- Test: `backend/tests/socketGetIo.test.js`

**Interfaces:**
- Produces: `getIo()` → returns the live `io` Server (or `null` before `createSocketServer` runs). Consumed by Task 5's ingest handler.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/socketGetIo.test.js`:

```javascript
'use strict';

const http = require('http');
const { createSocketServer, getIo } = require('../app/sockets');

describe('getIo', () => {
  it('returns null before any socket server is created', () => {
    // Jest gives each test file its own module registry, so the module-level
    // `_io` is fresh here and reliably null until createSocketServer runs below.
    expect(getIo()).toBeNull();
  });

  it('returns the same io instance created by createSocketServer', () => {
    const httpServer = http.createServer();
    const io = createSocketServer(httpServer);
    try {
      expect(getIo()).toBe(io);
    } finally {
      io.close();
      httpServer.close();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npx jest tests/socketGetIo.test.js --no-coverage --runInBand
```

Expected: FAIL — `getIo is not a function` / not exported.

- [ ] **Step 3: Add the accessor**

Replace `backend/app/sockets/index.js` with (adds a module-level `_io` and `getIo`, leaves all existing logic intact):

```javascript
'use strict';

const { Server } = require('socket.io');
const cookie = require('cookie');
const { verifyToken, COOKIE_NAME } = require('../utils/jwt');
const User = require('../models/User');
const { registerBiometricHandler } = require('./biometricHandler');

// Live Socket.IO server instance, captured on creation so non-socket code
// (e.g. the watch HR ingest controller) can look up a user's browser socket.
let _io = null;

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

  _io = io;
  return io;
}

function getIo() {
  return _io;
}

module.exports = { createSocketServer, getIo };
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && npx jest tests/socketGetIo.test.js --no-coverage --runInBand
```

Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/app/sockets/index.js backend/tests/socketGetIo.test.js
git commit -m "feat: expose getIo accessor from socket server"
```

---

## Task 3: Rate limiter — `watchLimiter` + ingest skip

**Files:**
- Modify: `backend/app/middleware/rateLimiter.js`
- Test: `backend/tests/rateLimiter.test.js`

**Interfaces:**
- Produces: `watchLimiter` (Express middleware) — consumed by Task 5's route. `isWatchIngest(req)` → boolean, used as `apiLimiter`'s `skip`. Exported as `_isWatchIngest` for tests.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/rateLimiter.test.js`:

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npx jest tests/rateLimiter.test.js --no-coverage --runInBand
```

Expected: FAIL — `watchLimiter is not a function` / `_isWatchIngest is not a function`.

- [ ] **Step 3: Implement the limiter and skip**

Replace `backend/app/middleware/rateLimiter.js` with:

```javascript
const crypto = require('crypto');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const WATCH_INGEST_PATH = '/api/integrations/watch/hr';

// True for the high-frequency watch HR ingest endpoint, which has its own
// dedicated limiter and must NOT count against the general /api/ budget.
function isWatchIngest(req) {
  const url = req.originalUrl || '';
  return url.split('?')[0] === WATCH_INGEST_PATH;
}

exports.apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isWatchIngest, // watch streaming is governed by watchLimiter instead
  message: { error: 'Too many requests — please try again later' },
});

// Strict limit on auth endpoints to prevent credential stuffing
exports.authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts — please try again in 15 minutes' },
});

// Watch HR ingest: a low-frequency stream — one ping per ~5 minutes (0.2/min)
// to preserve watch battery. Keyed on a hash of the device token (NOT IP —
// testers share carrier NAT). 5/min is far above the expected rate but still
// caps a looping/misbehaving watch app.
exports.watchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const header = req.headers.authorization;
    if (header && header.startsWith('Bearer ')) {
      return crypto.createHash('sha256').update(header.slice(7)).digest('hex');
    }
    // ipKeyGenerator normalizes IPv6 to a /64 subnet (express-rate-limit v8) so a
    // client can't rotate addresses within its subnet to bypass the limit.
    return ipKeyGenerator(req.ip);
  },
  message: { error: 'Too many heart-rate posts — slow down' },
});

exports._isWatchIngest = isWatchIngest;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && npx jest tests/rateLimiter.test.js --no-coverage --runInBand
```

Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/app/middleware/rateLimiter.js backend/tests/rateLimiter.test.js
git commit -m "feat: add watchLimiter and exclude ingest path from apiLimiter"
```

---

## Task 4: Token issue / revoke endpoints

**Files:**
- Modify: `backend/app/controllers/integrationsController.js`
- Modify: `backend/app/routes/integrations.js`
- Test: `backend/tests/watchIntegration.test.js`

**Interfaces:**
- Consumes: `req.user` (set by auth middleware) with `.save()`.
- Produces: `exports.issueWatchToken(req, res, next)` → `201 { token: 'whr_…' }`, sets `req.user.watchToken.hash` (sha256 hex), `watchToken.createdAt`, `req.user.wearableProvider = 'garmin'`. `exports.revokeWatchToken(req, res, next)` → `200 { message }`, clears `watchToken`. Both consumed by Task 4's routes; the stored hash is consumed by Task 5's ingest lookup.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/watchIntegration.test.js`:

```javascript
'use strict';

const crypto = require('crypto');

// Mock the socket layer so requiring the controller does not boot socket.io
// or the full biometric pipeline. Task 5 uses these mocks for ingest tests.
jest.mock('../app/sockets', () => ({ getIo: jest.fn(), createSocketServer: jest.fn() }));
jest.mock('../app/sockets/biometricHandler', () => ({
  handleBiometricReading: jest.fn(),
  registerBiometricHandler: jest.fn(),
  generateAndEmitPlaylist: jest.fn(),
}));
jest.mock('../app/models/User');

const User = require('../app/models/User');
const { getIo } = require('../app/sockets');
const { handleBiometricReading } = require('../app/sockets/biometricHandler');
const {
  issueWatchToken, revokeWatchToken, watchHrIngest,
} = require('../app/controllers/integrationsController');

function makeRes() {
  const res = { statusCode: 200, body: null, ended: false };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.body = data; return res; };
  res.end = () => { res.ended = true; return res; };
  return res;
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const next = jest.fn();

beforeEach(() => jest.clearAllMocks());

// ── issueWatchToken ─────────────────────────────────────────────────────────

describe('issueWatchToken', () => {
  it('returns a whr_ token, stores its hash, and marks provider garmin', async () => {
    const user = { _id: 'u1', save: jest.fn().mockResolvedValue(undefined) };
    const req = { user };
    const res = makeRes();

    await issueWatchToken(req, res, next);

    expect(res.statusCode).toBe(201);
    expect(res.body.token).toMatch(/^whr_[A-Za-z0-9_-]+$/);
    expect(user.watchToken.hash).toBe(sha256(res.body.token));
    expect(user.watchToken.createdAt).toBeInstanceOf(Date);
    expect(user.wearableProvider).toBe('garmin');
    expect(user.save).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
  });

  it('does not store the plaintext token anywhere on the user', async () => {
    const user = { _id: 'u1', save: jest.fn().mockResolvedValue(undefined) };
    const res = makeRes();
    await issueWatchToken({ user }, res, next);
    expect(JSON.stringify(user.watchToken)).not.toContain(res.body.token);
  });

  it('forwards errors to next', async () => {
    const err = new Error('db down');
    const user = { _id: 'u1', save: jest.fn().mockRejectedValue(err) };
    const res = makeRes();
    await issueWatchToken({ user }, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

// ── revokeWatchToken ────────────────────────────────────────────────────────

describe('revokeWatchToken', () => {
  it('clears watchToken and responds 200', async () => {
    const user = {
      _id: 'u1',
      watchToken: { hash: 'abc', createdAt: new Date(), lastSeenAt: new Date() },
      save: jest.fn().mockResolvedValue(undefined),
    };
    const res = makeRes();

    await revokeWatchToken({ user }, res, next);

    expect(user.watchToken).toBeNull();
    expect(user.save).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toMatch(/disconnect/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && npx jest tests/watchIntegration.test.js --no-coverage --runInBand
```

Expected: FAIL — `issueWatchToken is not a function` (and `watchHrIngest` undefined — that handler arrives in Task 5; its `describe` block isn't added yet, so only issue/revoke run here).

- [ ] **Step 3: Add the `crypto` import to the controller**

In `backend/app/controllers/integrationsController.js`, add at the top of the require block (after line 1):

```javascript
const crypto = require('crypto');
```

- [ ] **Step 4: Add the handlers to the controller**

In `backend/app/controllers/integrationsController.js`, append after `exports.wearableStatus` (after line 438):

```javascript
// ── Garmin watch (sideloaded app — opaque device-token HR streaming) ─────────

const sha256Hex = (s) => crypto.createHash('sha256').update(s).digest('hex');

// POST /api/integrations/watch/token  (auth required)
// Mints a long-lived opaque device token for the watch app. Stores only the
// hash; returns the plaintext once. Re-issuing overwrites the hash, which
// instantly revokes any previously issued token.
exports.issueWatchToken = async (req, res, next) => {
  try {
    const token = `whr_${crypto.randomBytes(32).toString('base64url')}`;
    req.user.watchToken = { hash: sha256Hex(token), createdAt: new Date(), lastSeenAt: null };
    req.user.wearableProvider = 'garmin';
    await req.user.save();
    res.status(201).json({ token });
  } catch (err) { next(err); }
};

// DELETE /api/integrations/watch/token  (auth required)
exports.revokeWatchToken = async (req, res, next) => {
  try {
    req.user.watchToken = null;
    req.user.wearableProvider = null;
    await req.user.save();
    res.json({ message: 'Watch disconnected' });
  } catch (err) { next(err); }
};
```

- [ ] **Step 5: Wire the authenticated routes**

In `backend/app/routes/integrations.js`, add `issueWatchToken, revokeWatchToken` to the controller destructure (near line 12, after `wearableStatus,`):

```javascript
  wearableStatus,
  issueWatchToken, revokeWatchToken,
```

Then add the routes after `router.get('/wearable/status', wearableStatus);` (line 58):

```javascript
// Garmin watch device-token (sideloaded app HR streaming)
router.post('/watch/token',   issueWatchToken);
router.delete('/watch/token', revokeWatchToken);
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd backend && npx jest tests/watchIntegration.test.js --no-coverage --runInBand
```

Expected: PASS — issue/revoke tests (4) pass.

- [ ] **Step 7: Commit**

```bash
git add backend/app/controllers/integrationsController.js backend/app/routes/integrations.js backend/tests/watchIntegration.test.js
git commit -m "feat: add watch device-token issue and revoke endpoints"
```

---

## Task 5: Watch HR ingest endpoint (immediate-mode pipeline + public POST)

> **DESIGN DECISION (2026-06-24, resolved):** Option A. The watch sends ~1 reading / 5 min, so the 60s debounce is bypassed via an `immediate` flag on `handleBiometricReading`. In immediate mode the reading is **trusted on arrival** and triggers `generateAndEmitPlaylist` synchronously (no 60s timer), gated by a larger **25 bpm** delta (`WATCH_HR_DELTA_THRESHOLD = 25`) so a flat HR doesn't churn Spotify. The existing socket/mock debounce path (`HR_DELTA_THRESHOLD = 10`, 60s timer) is left **untouched** so its tests stay green. (Supersedes the 60s-debounce rationale in `do-not-write-the-spicy-thimble.md`, Component 4.)

This task has two parts: **(A)** add immediate mode to `handleBiometricReading`; **(B)** add the public ingest endpoint that calls it with `{ immediate: true }`.

**Files:**
- Modify: `backend/app/sockets/biometricHandler.js` (add `WATCH_HR_DELTA_THRESHOLD`; add `opts` param + immediate branch)
- Test: `backend/tests/biometricHandler.pipeline.test.js` (append immediate-mode tests)
- Modify: `backend/app/controllers/integrationsController.js` (add `watchHrIngest`)
- Modify: `backend/app/routes/integrations.js` (public `/watch/hr` + `watchLimiter`)
- Test: `backend/tests/watchIntegration.test.js` (append ingest tests)

**Interfaces:**
- Consumes: `getIo()` (Task 2), `User.findOne(...).select(...)` by `watchToken.hash` (Task 1), `User.updateOne(...)`, `watchLimiter` (Task 3), `generateAndEmitPlaylist` (existing, internal to `biometricHandler`).
- Produces: `handleBiometricReading(socket, source, raw, opts = {})` — when `opts.immediate` is true, trusts the reading and triggers directly (25 bpm gate, no debounce). `exports.watchHrIngest(req, res, next)` → `202 { ok: true }`; `401` bad/missing token; `400` invalid HR; `409 { live: false }` when no browser socket. Calls `handleBiometricReading(socket, 'garmin', { heartRate, activityType, startTimeLocal }, { immediate: true })`.

### Part A — immediate mode in `handleBiometricReading`

- [ ] **Step 1: Write the failing immediate-mode tests**

Append to `backend/tests/biometricHandler.pipeline.test.js`. The file already mocks `User`/`MusicProfile`/`spotify`/`geminiEngine`/`playlistMixer`/`adapter` in `beforeEach`, so a triggered `generateAndEmitPlaylist` is observable via `geminiEngine.adjustBiometricPlaylist`. Uses the existing `makeSocket()` helper:

```javascript
// ── handleBiometricReading — immediate (5-min watch) mode ─────────────────────

describe('handleBiometricReading immediate mode', () => {
  const { handleBiometricReading, _debounceMap } = require('../app/sockets/biometricHandler');

  it('still emits biometric_ack', () => {
    const socket = makeSocket();
    handleBiometricReading(socket, 'garmin', { heartRate: 100 }, { immediate: true });
    expect(socket.emit).toHaveBeenCalledWith('biometric_ack',
      expect.objectContaining({ normalized: expect.objectContaining({ heartRate: 100 }) }));
  });

  it('triggers generation on the first reading (no prior baseline)', async () => {
    const socket = makeSocket();
    handleBiometricReading(socket, 'garmin', { heartRate: 140 }, { immediate: true });
    await new Promise(r => setTimeout(r, 50));
    expect(geminiEngine.adjustBiometricPlaylist).toHaveBeenCalledTimes(1);
  });

  it('does NOT re-trigger when the change is < 25 bpm', async () => {
    const socket = makeSocket();
    handleBiometricReading(socket, 'garmin', { heartRate: 100 }, { immediate: true });
    await new Promise(r => setTimeout(r, 50));
    geminiEngine.adjustBiometricPlaylist.mockClear();
    handleBiometricReading(socket, 'garmin', { heartRate: 120 }, { immediate: true }); // delta 20
    await new Promise(r => setTimeout(r, 50));
    expect(geminiEngine.adjustBiometricPlaylist).not.toHaveBeenCalled();
  });

  it('re-triggers when the change is >= 25 bpm', async () => {
    const socket = makeSocket();
    handleBiometricReading(socket, 'garmin', { heartRate: 100 }, { immediate: true });
    await new Promise(r => setTimeout(r, 50));
    geminiEngine.adjustBiometricPlaylist.mockClear();
    handleBiometricReading(socket, 'garmin', { heartRate: 130 }, { immediate: true }); // delta 30
    await new Promise(r => setTimeout(r, 50));
    expect(geminiEngine.adjustBiometricPlaylist).toHaveBeenCalledTimes(1);
  });

  it('never starts the 60s debounce (no recalibration_pending, timer stays null)', () => {
    const socket = makeSocket();
    handleBiometricReading(socket, 'garmin', { heartRate: 100 }, { immediate: true });
    handleBiometricReading(socket, 'garmin', { heartRate: 130 }, { immediate: true });
    const events = socket.emit.mock.calls.map(c => c[0]);
    expect(events).not.toContain('recalibration_pending');
    expect(_debounceMap.get(socket.id).timer).toBeNull();
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

```bash
cd backend && npx jest tests/biometricHandler.pipeline.test.js --no-coverage --runInBand
```

Expected: the trigger/debounce tests FAIL (immediate mode not implemented — `adjustBiometricPlaylist` not called). The `biometric_ack` test may already pass since ack is emitted before the branch.

- [ ] **Step 3: Implement immediate mode in `biometricHandler.js`**

Add the constant after `const DEBOUNCE_MS = 60_000;`:

```javascript
// Watch (5-min cadence) path: each ping is trusted as the new sustained HR.
// A larger 25 bpm gate ensures we only re-adapt on a real activity-state change
// (vs the 10 bpm streaming threshold), so a flat HR never churns Spotify.
const WATCH_HR_DELTA_THRESHOLD = 25;
```

Change the signature from:

```javascript
function handleBiometricReading(socket, source, raw) {
```

to:

```javascript
function handleBiometricReading(socket, source, raw, opts = {}) {
```

Then insert the immediate branch immediately after `state.latestActivity   = normalized.activity;` and before the `if (state.stableHR === null) {` line:

```javascript
  // Immediate (trusted) mode for the 5-minute watch ingest path: no 60s debounce.
  // First reading (no baseline) or a change >= 25 bpm regenerates synchronously.
  if (opts.immediate) {
    const prev = state.stableHR;
    state.stableHR = normalized.heartRate;
    if (prev === null || Math.abs(normalized.heartRate - prev) >= WATCH_HR_DELTA_THRESHOLD) {
      generateAndEmitPlaylist(socket, 'biometric', state);
    }
    return;
  }
```

The socket `biometric_push` registration still calls `handleBiometricReading(socket, source, raw)` (no `opts`), so it keeps the full 60s/10bpm debounce — unchanged.

- [ ] **Step 4: Run the pipeline tests — new pass, existing still green**

```bash
cd backend && npx jest tests/biometricHandler.pipeline.test.js --no-coverage --runInBand
```

Expected: PASS — all existing pipeline tests + the 5 new immediate-mode tests.

- [ ] **Step 5: Commit**

```bash
git add backend/app/sockets/biometricHandler.js backend/tests/biometricHandler.pipeline.test.js
git commit -m "feat: add immediate 5-min watch mode to handleBiometricReading with 25bpm gate"
```

### Part B — public ingest endpoint

- [ ] **Step 6: Write the failing ingest tests (append to `watchIntegration.test.js`)**

Add this `describe` block to the end of `backend/tests/watchIntegration.test.js`:

```javascript
// ── watchHrIngest ─────────────────────────────────────────────────────────

describe('watchHrIngest', () => {
  // Builds a fake io whose room for `user:<id>` contains one socket.
  function makeIo(userId) {
    const socket = { id: `sock_${userId}`, emit: jest.fn(), data: { user: { _id: userId } } };
    const rooms = new Map([[`user:${userId}`, new Set([socket.id])]]);
    const sockets = new Map([[socket.id, socket]]);
    return { io: { sockets: { adapter: { rooms }, sockets } }, socket };
  }

  function reqWith(token, body) {
    return { headers: token ? { authorization: `Bearer ${token}` } : {}, body };
  }

  beforeEach(() => {
    User.findOne = jest.fn();
    User.updateOne = jest.fn().mockResolvedValue({});
  });

  it('202 on valid token + connected socket; calls handleBiometricReading immediate', async () => {
    const userId = 'u_live';
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: userId }) });
    const { io, socket } = makeIo(userId);
    getIo.mockReturnValue(io);
    const res = makeRes();

    await watchHrIngest(reqWith('whr_tok', { heartRate: 142, activityType: 1, ts: '2026-06-24T10:00:00Z' }), res, next);

    expect(res.statusCode).toBe(202);
    expect(handleBiometricReading).toHaveBeenCalledWith(
      socket,
      'garmin',
      { heartRate: 142, activityType: 1, startTimeLocal: '2026-06-24T10:00:00Z' },
      { immediate: true }
    );
    expect(User.updateOne).toHaveBeenCalled(); // lastSeenAt touched
  });

  it('401 when the Authorization header is missing', async () => {
    const res = makeRes();
    await watchHrIngest(reqWith(null, { heartRate: 120 }), res, next);
    expect(res.statusCode).toBe(401);
    expect(handleBiometricReading).not.toHaveBeenCalled();
  });

  it('401 when the token matches no user', async () => {
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(null) });
    const res = makeRes();
    await watchHrIngest(reqWith('whr_bad', { heartRate: 120 }), res, next);
    expect(res.statusCode).toBe(401);
  });

  it('400 when heartRate is out of range or non-numeric', async () => {
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: 'u1' }) });
    const res1 = makeRes();
    await watchHrIngest(reqWith('whr_tok', { heartRate: 5 }), res1, next);
    expect(res1.statusCode).toBe(400);

    const res2 = makeRes();
    await watchHrIngest(reqWith('whr_tok', { heartRate: 'fast' }), res2, next);
    expect(res2.statusCode).toBe(400);
    expect(handleBiometricReading).not.toHaveBeenCalled();
  });

  it('409 { live:false } when the user has no connected browser socket', async () => {
    const userId = 'u_offline';
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: userId }) });
    getIo.mockReturnValue({ sockets: { adapter: { rooms: new Map() }, sockets: new Map() } });
    const res = makeRes();

    await watchHrIngest(reqWith('whr_tok', { heartRate: 142, activityType: 1 }), res, next);

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ live: false });
    expect(handleBiometricReading).not.toHaveBeenCalled();
  });

  it('defaults activityType to 0 and supplies startTimeLocal when ts is absent', async () => {
    const userId = 'u_def';
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: userId }) });
    const { io } = makeIo(userId);
    getIo.mockReturnValue(io);
    const res = makeRes();

    await watchHrIngest(reqWith('whr_tok', { heartRate: 88 }), res, next);

    const raw = handleBiometricReading.mock.calls[0][2];
    expect(raw.heartRate).toBe(88);
    expect(raw.activityType).toBe(0);
    expect(typeof raw.startTimeLocal).toBe('string');
  });
});
```

- [ ] **Step 7: Run tests to verify they fail**

```bash
cd backend && npx jest tests/watchIntegration.test.js --no-coverage --runInBand
```

Expected: FAIL — `watchHrIngest is not a function`.

- [ ] **Step 8: Add the socket-layer imports to the controller**

In `backend/app/controllers/integrationsController.js`, add to the require block at the top (after the `crypto` import from Task 4):

```javascript
const { getIo } = require('../sockets');
const { handleBiometricReading } = require('../sockets/biometricHandler');
```

- [ ] **Step 9: Implement `watchHrIngest`**

In `backend/app/controllers/integrationsController.js`, append after `exports.revokeWatchToken` (from Task 4):

```javascript
// POST /api/integrations/watch/hr  (PUBLIC — device-token auth, not session)
// The sideloaded watch app POSTs live HR here ~every 5 minutes. We authenticate
// by hashing the Bearer token, look up the user's live browser socket, and feed
// the reading into the biometric pipeline in immediate mode (each ping trusted
// as the new sustained HR; see WATCH_HR_DELTA_THRESHOLD in biometricHandler).
exports.watchHrIngest = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing watch token' });
    }
    const hash = sha256Hex(header.slice(7));
    const user = await User.findOne({ 'watchToken.hash': hash, deletedAt: null }).select('_id');
    if (!user) return res.status(401).json({ error: 'Invalid watch token' });

    const { heartRate, activityType, ts } = req.body || {};
    if (typeof heartRate !== 'number' || heartRate < 30 || heartRate > 230) {
      return res.status(400).json({ error: 'heartRate must be a number between 30 and 230' });
    }
    const activity = Number.isInteger(activityType) ? activityType : 0;
    const startTimeLocal = typeof ts === 'string' && ts ? ts : new Date().toISOString();

    // Record liveness for the frontend staleness indicator (fire-and-forget).
    User.updateOne({ _id: user._id }, { $set: { 'watchToken.lastSeenAt': new Date() } })
      .catch((e) => console.error('[watchHrIngest] lastSeenAt update failed:', e.message));

    const io = getIo();
    const room = io?.sockets?.adapter?.rooms?.get(`user:${user._id}`);
    if (!room || room.size === 0) return res.status(409).json({ live: false });

    const socketId = room.values().next().value;
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) return res.status(409).json({ live: false });

    handleBiometricReading(socket, 'garmin', { heartRate, activityType: activity, startTimeLocal }, { immediate: true });
    return res.status(202).json({ ok: true });
  } catch (err) { next(err); }
};
```

- [ ] **Step 10: Wire the public route with `watchLimiter`**

In `backend/app/routes/integrations.js`:

Add the rate-limiter import near the top (after `const auth = require('../middleware/auth');`, line 2):

```javascript
const { watchLimiter } = require('../middleware/rateLimiter');
```

Add `watchHrIngest` to the controller destructure (alongside `issueWatchToken, revokeWatchToken` from Task 4):

```javascript
  issueWatchToken, revokeWatchToken, watchHrIngest,
```

Add the PUBLIC route in the public block, after `router.get('/garmin/callback', garminCallback);` (line 23) and BEFORE `router.use(auth);`:

```javascript
// Watch HR stream (PUBLIC — authenticated by the opaque device token, not the
// session cookie; same placement rationale as the webhooks above).
router.post('/watch/hr', watchLimiter, watchHrIngest);
```

- [ ] **Step 11: Run tests to verify they pass**

```bash
cd backend && npx jest tests/watchIntegration.test.js --no-coverage --runInBand
```

Expected: PASS — issue/revoke + ingest suites green (0 failed).

- [ ] **Step 12: Commit**

```bash
git add backend/app/controllers/integrationsController.js backend/app/routes/integrations.js backend/tests/watchIntegration.test.js
git commit -m "feat: add public watch HR ingest endpoint into biometric pipeline"
```

---

## Task 6: Gate the legacy Garmin Web-API poller

**Files:**
- Modify: `backend/app/index.js`

**Interfaces:**
- Consumes: `startGarminPoller(io)` (existing). Behavior change only — no new exported symbol.

> No new unit test: `index.js` runs `start()` on import (it connects to Mongo/Redis), so it is not unit-testable in isolation — this is why it has no existing test. Correctness is verified by the existing `garminPoller.test.js` staying green plus the manual log check in Step 3.

- [ ] **Step 1: Add the env gate**

In `backend/app/index.js`, replace the unconditional poller start (line 94):

```javascript
  startGarminPoller(io);
```

with:

```javascript
  // The Garmin Web API is delayed/batched and the OAuth app is restricted; the
  // sideloaded watch app pushes live HR instead. Keep the legacy poller off
  // unless explicitly enabled. (Set ENABLE_GARMIN_POLLER=true to re-enable.)
  if (process.env.ENABLE_GARMIN_POLLER === 'true') {
    startGarminPoller(io);
  }
```

- [ ] **Step 2: Run the full backend suite to confirm no regressions**

```bash
cd backend && npx jest --no-coverage --runInBand --forceExit
```

Expected: `0 failed` (all existing tests + the 4 new files: `userModel.watchToken`, `socketGetIo`, `rateLimiter`, `watchIntegration`). The `garminPoller.test.js` suite still passes because `startGarminPoller`/`pollOnce` are unchanged.

- [ ] **Step 3: Manual verification of the gate**

```bash
cd backend && node -e "require('dotenv').config(); console.log('ENABLE_GARMIN_POLLER=', process.env.ENABLE_GARMIN_POLLER)"
```

Expected: prints `undefined` or not `true`. Confirm that on a normal local boot the log line `[GarminPoller] started` does NOT appear (start the server briefly if desired), and that setting `ENABLE_GARMIN_POLLER=true` makes it appear.

- [ ] **Step 4: Commit**

```bash
git add backend/app/index.js
git commit -m "chore: gate legacy Garmin poller behind ENABLE_GARMIN_POLLER (default off)"
```

---

## Manual end-to-end smoke (no watch hardware)

After all tasks, verify the HTTP leg drives the real pipeline (requires the dev server + a logged-in browser session so a socket joins `user:<id>`):

1. Start backend (`cd backend && npm run dev` or `node app/index.js`) and the frontend; log in so the browser opens a Socket.IO connection.
2. Mint a token: `POST /api/integrations/watch/token` with your session cookie → copy the `whr_…` value.
3. Simulate the watch:
   ```bash
   curl -i -X POST "$BACKEND_URL/api/integrations/watch/hr" \
     -H "Authorization: Bearer whr_…" -H "Content-Type: application/json" \
     -d '{"heartRate":150,"activityType":1}'
   ```
   Expect `202 {"ok":true}` while the browser is open, and the browser should receive a `biometric_ack` (visible HR update). Sustain a >10 bpm change for 60s (loop the curl) to observe `recalibration_pending` → `playlist_ready`.
4. With the browser closed (no socket), the same curl returns `409 {"live":false}`.

---

## Self-Review

**Spec coverage (Components 1, 2, 6 + getIo):**

| Foundation requirement | Task |
|---|---|
| Public `POST /watch/hr` ingest, device-token auth, no bottleneck | Task 5 |
| Reuse `handleBiometricReading` with garmin raw shape | Task 5 |
| sha256-hash token lookup; 401/400/409/202 status contract | Task 5 |
| `getIo()` accessor so the controller reaches `io` | Task 2 |
| Hashed `watchToken` storage on User + index | Task 1 |
| Token issue (plaintext once) + revoke (overwrite hash) | Task 4 |
| `watchLimiter` (token-hash keyed) + exclude from `apiLimiter` | Task 3 |
| `lastSeenAt` liveness for staleness UI | Task 5 |
| Disable legacy Garmin poller (env flag, default off) | Task 6 |

**Placeholder scan:** none — every code/test step contains complete content.

**Type/name consistency:**
- `getIo()` defined in Task 2, mocked + consumed in Task 5 — ✓
- `handleBiometricReading(socket, source, raw)` raw shape `{ heartRate, activityType, startTimeLocal }` matches `adapter.fromGarmin` and the Task 5 assertion — ✓
- `watchToken.hash` defined in Task 1, written in Task 4 (`issueWatchToken`), read in Task 5 (`findOne`) — ✓
- `sha256Hex` defined once in the controller (Task 4), reused by `watchHrIngest` (Task 5) — ✓
- `watchLimiter` exported in Task 3, imported in Task 5's route — ✓
- `_isWatchIngest` exported for tests and used as `apiLimiter.skip` — ✓

**Out of scope (later plans):** frontend token UI + staleness badge (Component 3), `queueMode:'next'` deferred-swap playback (Component 4), the Monkey C `watch/` app (Component 5).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-24-watch-hr-ingest-backend-foundation.md`. Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task with two-stage review between tasks; fast iteration, clean context per task.
2. **Inline Execution** — execute the tasks in this session with checkpoints for review.

Which approach?
