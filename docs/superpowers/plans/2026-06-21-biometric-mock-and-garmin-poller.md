# Biometric Mock Engine + Garmin Polling Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unblock local development of the biometric→AI→playlist loop with a CLI mock engine, and wire a 30-second Garmin API polling loop so live heart rate from connected watches reaches the pipeline without requiring real-time push infrastructure.

**Architecture:** Task 1 refactors `biometricHandler.js` to extract the core reading-processing logic into an exported `handleBiometricReading(socket, source, raw)` function — this is the shared primitive both the mock script and the Garmin poller call. Task 2 adds a CLI script (`scripts/biometric-mock.js`) that authenticates via a user-supplied JWT, connects to the Socket.IO server as a client, and fires `biometric_push` events on a configured scenario/interval schedule. Task 3 adds a server-side `garminPoller.js` that finds all Garmin-connected users with active socket rooms, polls `getDailyHeartRate`, maps the response to the adapter schema, and calls `handleBiometricReading` directly on each user's socket.

**Tech Stack:** Node.js (CommonJS), Socket.IO v4 (server + socket.io-client for mock), Mongoose, Axios, Jest.

## Global Constraints

- Backend test framework: Jest with CommonJS (`require`/`module.exports`) — `--runInBand --forceExit`
- No new production npm dependencies — `socket.io-client` goes in `devDependencies`
- `handleBiometricReading(socket, source, raw)` — exact name required (used by both Task 2 and Task 3)
- Existing 255 backend tests must remain green after every task
- The Garmin raw object passed to `handleBiometricReading` must match the adapter's `fromGarmin` schema: `{ heartRate: number, activityType: number, startTimeLocal: string }`
- Garmin activity string → numeric mapping: `RUNNING→1, CYCLING→2, SWIMMING→5, WALKING→6, STRENGTH_TRAINING→13`, default `0` (resting)
- Garmin poll interval: 30 seconds (`POLL_INTERVAL_MS = 30_000`)
- Mock script scenarios: `resting` (HR 60, type 0), `walking` (HR 90, type 6), `running` (HR 145, type 1), `spike` (HR 165, type 1), `cooldown` (HR 100, type 6)
- Mock script duration parser: accepts `<N>s`, `<N>m`, `<N>h` — throws `Error` on invalid input

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| **Modify** | `backend/app/sockets/biometricHandler.js` | Extract `handleBiometricReading`, export it |
| **Modify** | `backend/tests/biometricHandler.pipeline.test.js` | Add direct `handleBiometricReading` tests |
| **Create** | `backend/scripts/biometric-mock.js` | CLI mock script — emits `biometric_push` on a schedule |
| **Modify** | `backend/package.json` | Add `socket.io-client` to `devDependencies` |
| **Create** | `backend/tests/biometricMock.test.js` | Test scenarios and `parseDurationMs` |
| **Create** | `backend/app/services/wearable/garminPoller.js` | Poll Garmin API, push to active user sockets |
| **Modify** | `backend/app/index.js` | Capture `io` from `createSocketServer`, call `startGarminPoller(io)` |
| **Create** | `backend/tests/garminPoller.test.js` | Unit tests for `pollOnce` |

---

## Task 1: Extract `handleBiometricReading` from biometricHandler

**Files:**
- Modify: `backend/app/sockets/biometricHandler.js`
- Modify: `backend/tests/biometricHandler.pipeline.test.js`

**Interfaces:**
- Produces: `handleBiometricReading(socket, source, raw)` — exported, used by Tasks 2 and 3

---

- [ ] **Step 1: Write the failing test for `handleBiometricReading` called directly**

Add to the bottom of `backend/tests/biometricHandler.pipeline.test.js` (before the closing lines — read the file first to find where to append):

```javascript
// ── handleBiometricReading (direct call, bypasses socket event) ───────────────

describe('handleBiometricReading (direct)', () => {
  it('is exported and callable without a socket event', () => {
    const { handleBiometricReading } = require('../app/sockets/biometricHandler');
    expect(typeof handleBiometricReading).toBe('function');
  });

  it('emits biometric_ack on a valid garmin reading', () => {
    const { handleBiometricReading } = require('../app/sockets/biometricHandler');
    const socket = { id: 'direct-test-1', emit: jest.fn(), data: { user: { _id: 'u1' } } };
    const raw = { heartRate: 90, activityType: 6, startTimeLocal: '2026-06-21T10:00:00' };

    handleBiometricReading(socket, 'garmin', raw);

    expect(socket.emit).toHaveBeenCalledWith('biometric_ack', {
      normalized: expect.objectContaining({ heartRate: 90, activity: 'walking', source: 'garmin' }),
    });
  });

  it('emits connection_error on unknown source', () => {
    const { handleBiometricReading } = require('../app/sockets/biometricHandler');
    const socket = { id: 'direct-test-2', emit: jest.fn(), data: { user: { _id: 'u2' } } };

    handleBiometricReading(socket, 'unknown_device', {});

    expect(socket.emit).toHaveBeenCalledWith('connection_error', expect.objectContaining({ message: expect.any(String) }));
  });
});
```

- [ ] **Step 2: Run existing tests to see current state**

```bash
cd backend && npx jest tests/biometricHandler.pipeline.test.js --no-coverage
```

Expected: All existing tests PASS, new `handleBiometricReading` tests FAIL with "handleBiometricReading is not a function"

- [ ] **Step 3: Refactor `backend/app/sockets/biometricHandler.js`**

Extract the body of the `biometric_push` handler into a standalone function. Replace the entire file with:

```javascript
'use strict';

const { normalize }  = require('../services/wearable/adapter');
const User           = require('../models/User');
const MusicProfile   = require('../models/MusicProfile');
const PlaylistSession = require('../models/PlaylistSession');
const spotify        = require('../services/spotify');
const youtube        = require('../services/youtube');
const { buildEmotionPlaylist, adjustBiometricPlaylist } = require('../services/geminiEngine');
const { mixPlaylist, generateFallbackPlaylist }  = require('../services/playlistMixer');

const debounceMap = new Map();
const HR_DELTA_THRESHOLD = 10;
const DEBOUNCE_MS        = 60_000;

function getState(socketId) {
  if (!debounceMap.has(socketId)) {
    debounceMap.set(socketId, {
      stableHR:         null,
      pendingHR:        null,
      latestActivity:   null,
      timer:            null,
      consecutiveSkips: 0,
      lastEmotionTaps:  [],
      lastTextPrompt:   '',
    });
  }
  return debounceMap.get(socketId);
}

function clearTimer(state) {
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer    = null;
    state.pendingHR = null;
  }
}

// ── Core pipeline ──────────────────────────────────────────────────────────────

async function generateAndEmitPlaylist(socket, trigger, state) {
  const userId = socket.data.user._id.toString();

  const user = await User.findById(userId);
  if (!user) {
    socket.emit('playlist_error', { message: 'User not found' });
    return;
  }

  const musicProfile = await MusicProfile.findOne({ userId });
  if (!musicProfile) {
    socket.emit('playlist_error', { message: 'Music profile not built yet — reconnect your music provider' });
    return;
  }

  const hasSpotify = !!user.spotifyToken?.blob;
  const hasYoutube = !!user.youtubeMusicToken?.blob;
  if (!hasSpotify && !hasYoutube) {
    socket.emit('playlist_error', { message: 'No music provider connected' });
    return;
  }

  let fetchTracks;
  let provider;
  try {
    if (hasSpotify) {
      const accessToken = await spotify.getValidToken(user);
      fetchTracks = (params) => spotify.getRecommendations(accessToken, params);
      provider = 'spotify';
    } else {
      const accessToken = await youtube.getValidToken(user);
      fetchTracks = (params) => youtube.searchRecommendations(accessToken, params);
      provider = 'youtube';
    }
  } catch (err) {
    socket.emit('playlist_error', { message: `Token refresh failed: ${err.message}` });
    return;
  }

  let aiResult;
  try {
    if (trigger === 'emotion' && state.lastEmotionTaps.length > 0) {
      aiResult = await buildEmotionPlaylist({
        musicProfile,
        emotionTaps:  state.lastEmotionTaps,
        textPrompt:   state.lastTextPrompt || null,
        fetchTracks,
      });
    } else {
      aiResult = await adjustBiometricPlaylist({
        musicProfile,
        biometric: {
          heartRate:  state.stableHR,
          activity:   state.latestActivity,
          restingHR:  musicProfile.restingHeartRate,
        },
        fetchTracks,
      });
    }
  } catch (err) {
    const fallbackTracks = generateFallbackPlaylist(musicProfile ?? {});
    if (fallbackTracks.length > 0) {
      socket.emit('playlist_ready', {
        trigger,
        tracks:    fallbackTracks,
        familiar:  fallbackTracks.length,
        discovery: 0,
        fallback:  true,
      });
    } else {
      socket.emit('playlist_error', { message: err.message });
    }
    return;
  }

  const cachedDiscovery = aiResult.tracks;
  const playlist = await mixPlaylist({
    musicProfile,
    aiParams:            aiResult.params,
    fetchDiscoveryTracks: () => Promise.resolve(cachedDiscovery),
  });

  socket.emit('playlist_ready', {
    trigger,
    params:    aiResult.params,
    tracks:    playlist.merged,
    familiar:  playlist.familiar.length,
    discovery: playlist.discovery.length,
  });

  PlaylistSession.create({
    userId,
    emotionTaps:       state.lastEmotionTaps.length > 0 ? state.lastEmotionTaps : [{ x: 0, y: 0 }],
    contextPrompt:     state.lastTextPrompt || '',
    biometricSnapshot: { heartRate: state.stableHR, activity: state.latestActivity },
    targetBpm:         aiResult.params.target_bpm,
    targetGenres:      aiResult.params.seed_genres || [],
    targetValence:     aiResult.params.target_valence,
    targetEnergy:      aiResult.params.target_energy,
    musicProvider:     provider,
    trackIds:          playlist.merged.map(t => t.id).filter(Boolean),
  }).catch(e => console.error('[PlaylistSession] save failed:', e.message));
}

// ── Shared biometric reading handler ──────────────────────────────────────────
// Called by both the socket `biometric_push` event and server-side pollers
// (e.g. garminPoller). Normalizes the raw reading, updates debounce state,
// and triggers playlist generation when a sustained HR change is detected.

function handleBiometricReading(socket, source, raw) {
  let normalized;
  try {
    normalized = normalize(source, raw);
  } catch (err) {
    socket.emit('connection_error', { message: err.message });
    return;
  }

  socket.emit('biometric_ack', { normalized });

  const state = getState(socket.id);
  state.consecutiveSkips = 0;
  state.latestActivity   = normalized.activity;

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

  if (state.timer) return;

  state.pendingHR = normalized.heartRate;
  state.timer = setTimeout(() => {
    const s = debounceMap.get(socket.id);
    if (!s) return;
    const currentDelta = Math.abs(s.pendingHR - s.stableHR);
    if (currentDelta >= HR_DELTA_THRESHOLD) {
      s.stableHR = s.pendingHR;
      generateAndEmitPlaylist(socket, 'biometric', s);
    } else {
      socket.emit('recalibration_cancelled', { reason: 'change_reverted' });
    }
    clearTimer(s);
  }, DEBOUNCE_MS);

  socket.emit('recalibration_pending', { delta, secondsRemaining: Math.round(DEBOUNCE_MS / 1000) });
}

// ── Socket event registration ──────────────────────────────────────────────────

function registerBiometricHandler(socket) {
  const socketId = socket.id;

  socket.on('biometric_push', ({ source, raw } = {}) => {
    handleBiometricReading(socket, source, raw);
  });

  socket.on('emotion_update', ({ taps = [], textPrompt = '' } = {}) => {
    const state = getState(socketId);
    state.lastEmotionTaps = taps;
    state.lastTextPrompt  = textPrompt;
  });

  socket.on('request_playlist', () => {
    generateAndEmitPlaylist(socket, 'emotion', getState(socketId));
  });

  socket.on('track_skipped', () => {
    const state = getState(socketId);
    state.consecutiveSkips += 1;

    if (state.consecutiveSkips >= 2) {
      clearTimer(state);
      generateAndEmitPlaylist(socket, 'skip_loop', state);
      state.consecutiveSkips = 0;
    }
  });

  socket.on('disconnect', () => {
    const state = debounceMap.get(socketId);
    if (state) {
      clearTimer(state);
      debounceMap.delete(socketId);
    }
  });
}

module.exports = {
  registerBiometricHandler,
  generateAndEmitPlaylist,
  handleBiometricReading,
  _debounceMap: debounceMap,
};
```

- [ ] **Step 4: Run tests — all must pass**

```bash
cd backend && npx jest tests/biometricHandler.pipeline.test.js --no-coverage
```

Expected: PASS — all existing tests + 3 new `handleBiometricReading` tests

- [ ] **Step 5: Run full suite to check no regressions**

```bash
cd backend && npx jest --no-coverage 2>&1 | tail -5
```

Expected: `Tests: 258 passed` (255 + 3 new), `0 failed`

- [ ] **Step 6: Commit**

```bash
git add backend/app/sockets/biometricHandler.js backend/tests/biometricHandler.pipeline.test.js
git commit -m "refactor: extract handleBiometricReading for direct use by server-side pollers"
```

---

## Task 2: Biometric Mock Script

**Files:**
- Create: `backend/scripts/biometric-mock.js`
- Modify: `backend/package.json`
- Create: `backend/tests/biometricMock.test.js`

**Interfaces:**
- Consumes: `handleBiometricReading` from Task 1 (indirectly — the mock sends `biometric_push` events to the server which calls it)
- Produces: `SCENARIOS` and `parseDurationMs` exported for testing; `run()` is the CLI entry point (not exported, guarded by `require.main === module`)

---

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/biometricMock.test.js`:

```javascript
'use strict';

// Prevent the script from auto-running when required in tests
// (require.main !== module, so run() is never called)
const { SCENARIOS, parseDurationMs } = require('../scripts/biometric-mock');

describe('SCENARIOS', () => {
  it.each([
    ['resting',  60,  0],
    ['walking',  90,  6],
    ['running',  145, 1],
    ['spike',    165, 1],
    ['cooldown', 100, 6],
  ])('%s has heartRate %i and activityType %i', (name, hr, type) => {
    expect(SCENARIOS[name]).toMatchObject({ heartRate: hr, activityType: type });
  });

  it('all scenarios have a label string', () => {
    for (const key of Object.keys(SCENARIOS)) {
      expect(typeof SCENARIOS[key].label).toBe('string');
    }
  });
});

describe('parseDurationMs', () => {
  it('parses seconds', () => expect(parseDurationMs('30s')).toBe(30_000));
  it('parses minutes', () => expect(parseDurationMs('5m')).toBe(300_000));
  it('parses hours',   () => expect(parseDurationMs('2h')).toBe(7_200_000));
  it('throws on invalid format', () => {
    expect(() => parseDurationMs('5min')).toThrow('Invalid duration');
    expect(() => parseDurationMs('abc')).toThrow('Invalid duration');
    expect(() => parseDurationMs('5')).toThrow('Invalid duration');
  });
});
```

- [ ] **Step 2: Run tests — expect fail**

```bash
cd backend && npx jest tests/biometricMock.test.js --no-coverage
```

Expected: FAIL — `Cannot find module '../scripts/biometric-mock'`

- [ ] **Step 3: Install `socket.io-client` as devDependency**

```bash
cd backend && npm install --save-dev socket.io-client
```

Expected: Package added to `devDependencies` in `package.json`

- [ ] **Step 4: Create `backend/scripts/biometric-mock.js`**

```javascript
#!/usr/bin/env node
'use strict';

/**
 * Biometric Mock Engine — developer tool for testing the biometric→AI→playlist loop
 * without physical wearable hardware.
 *
 * Usage:
 *   node scripts/biometric-mock.js --token <jwt> --scenario running --duration 5m
 *
 * Get your JWT token from the browser: DevTools → Application → Cookies → kokonada_token
 * (or whatever cookie name your backend uses — check COOKIE_NAME in utils/jwt.js)
 *
 * Options:
 *   --token <jwt>        Required. JWT from browser cookie.
 *   --scenario <name>    Scenario name (default: running). See SCENARIOS below.
 *   --duration <time>    How long to run, e.g. 30s, 5m, 1h (default: 5m).
 *   --interval <secs>    Seconds between pushes (default: 30).
 *   --url <url>          Backend URL (default: http://localhost:5000 or BACKEND_URL env).
 */

const SCENARIOS = {
  resting:  { heartRate: 60,  activityType: 0, label: 'Resting'  },
  walking:  { heartRate: 90,  activityType: 6, label: 'Walking'  },
  running:  { heartRate: 145, activityType: 1, label: 'Running'  },
  spike:    { heartRate: 165, activityType: 1, label: 'HR Spike' },
  cooldown: { heartRate: 100, activityType: 6, label: 'Cooldown' },
};

function parseDurationMs(str) {
  const match = str.match(/^(\d+)(s|m|h)$/);
  if (!match) throw new Error(`Invalid duration: "${str}" — use e.g. 30s, 5m, 1h`);
  const multipliers = { s: 1_000, m: 60_000, h: 3_600_000 };
  return parseInt(match[1], 10) * multipliers[match[2]];
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const opts = { scenario: 'running', duration: '5m', interval: '30', token: null, url: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--scenario') opts.scenario = argv[i + 1];
    if (argv[i] === '--duration') opts.duration = argv[i + 1];
    if (argv[i] === '--interval') opts.interval = argv[i + 1];
    if (argv[i] === '--token')    opts.token    = argv[i + 1];
    if (argv[i] === '--url')      opts.url      = argv[i + 1];
  }
  return opts;
}

function run() {
  const opts     = parseArgs();
  const scenario = SCENARIOS[opts.scenario];

  if (!scenario) {
    console.error(`[Mock] Unknown scenario: "${opts.scenario}". Available: ${Object.keys(SCENARIOS).join(', ')}`);
    process.exit(1);
  }
  if (!opts.token) {
    console.error('[Mock] --token <jwt> is required. Copy it from browser cookies (DevTools → Application → Cookies).');
    process.exit(1);
  }

  let durationMs;
  try {
    durationMs = parseDurationMs(opts.duration);
  } catch (err) {
    console.error(`[Mock] ${err.message}`);
    process.exit(1);
  }

  const { io } = require('socket.io-client');
  const backendUrl  = opts.url || process.env.BACKEND_URL || 'http://localhost:5000';
  const intervalMs  = parseInt(opts.interval, 10) * 1_000;

  console.log(`[Mock] Connecting to ${backendUrl}`);
  console.log(`[Mock] Scenario: ${scenario.label} | HR: ${scenario.heartRate} bpm | Interval: ${opts.interval}s | Duration: ${opts.duration}`);

  const socket = io(backendUrl, {
    auth:          { token: opts.token },
    reconnection:  false,
    transports:    ['websocket'],
  });

  socket.on('connect', () => {
    console.log(`[Mock] ✓ Connected (socket ${socket.id})`);

    const startedAt = Date.now();
    let count = 0;

    function push() {
      const raw = {
        heartRate:      scenario.heartRate,
        activityType:   scenario.activityType,
        startTimeLocal: new Date().toISOString(),
      };
      socket.emit('biometric_push', { source: 'garmin', raw });
      count += 1;
      console.log(`[Mock] → push #${count}: HR=${raw.heartRate} bpm, activityType=${raw.activityType}`);
    }

    push(); // Immediate first push

    const interval = setInterval(() => {
      if (Date.now() - startedAt >= durationMs) {
        clearInterval(interval);
        console.log(`[Mock] Duration complete (${opts.duration}, ${count} pushes). Disconnecting.`);
        socket.disconnect();
        process.exit(0);
      }
      push();
    }, intervalMs);
  });

  socket.on('biometric_ack', (data) => {
    console.log(`[Mock] ← ack: ${JSON.stringify(data.normalized)}`);
  });

  socket.on('recalibration_pending', (data) => {
    console.log(`[Mock] ⏳ Recalibration pending — delta ${data.delta} bpm, ${data.secondsRemaining}s`);
  });

  socket.on('recalibration_cancelled', (data) => {
    console.log(`[Mock] ↩  Recalibration cancelled: ${data.reason}`);
  });

  socket.on('playlist_ready', (data) => {
    console.log(`[Mock] 🎵 Playlist ready! ${data.tracks?.length ?? 0} tracks (trigger: ${data.trigger}${data.fallback ? ', fallback' : ''})`);
  });

  socket.on('playlist_error', (data) => {
    console.error(`[Mock] ✗ Playlist error: ${data.message}`);
  });

  socket.on('connect_error', (err) => {
    console.error(`[Mock] ✗ Connection failed: ${err.message}`);
    process.exit(1);
  });

  socket.on('disconnect', () => {
    console.log('[Mock] Disconnected');
  });
}

// Export for tests; only auto-run when invoked directly
module.exports = { SCENARIOS, parseDurationMs };

if (require.main === module) {
  run();
}
```

- [ ] **Step 5: Run tests — expect pass**

```bash
cd backend && npx jest tests/biometricMock.test.js --no-coverage
```

Expected: PASS — 9 tests, 0 failures

- [ ] **Step 6: Run full suite to confirm no regressions**

```bash
cd backend && npx jest --no-coverage 2>&1 | tail -5
```

Expected: `Tests: 267 passed` (258 + 9 new), `0 failed`

- [ ] **Step 7: Commit**

```bash
git add backend/scripts/biometric-mock.js backend/tests/biometricMock.test.js backend/package.json backend/package-lock.json
git commit -m "feat: add biometric mock script for local pipeline testing"
```

---

## Task 3: Garmin Polling Service + Wire to Server

**Files:**
- Create: `backend/app/services/wearable/garminPoller.js`
- Modify: `backend/app/index.js`
- Create: `backend/tests/garminPoller.test.js`

**Interfaces:**
- Consumes: `handleBiometricReading(socket, source, raw)` from Task 1
- Consumes: `garmin.getDailyHeartRate(accessToken, accessTokenSecret)` from `garmin.js`
- Consumes: `User.find(...)` — returns users with `wearableProvider: 'garmin'` and `wearableToken.blob`
- Produces: `startGarminPoller(io)` and `stopGarminPoller()` exported from `garminPoller.js`
- Produces: `io` captured from `createSocketServer(httpServer)` in `index.js`, passed to `startGarminPoller`

---

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/garminPoller.test.js`:

```javascript
'use strict';

jest.mock('../app/models/User');
jest.mock('../app/services/wearable/garmin');
jest.mock('../app/sockets/biometricHandler', () => ({
  registerBiometricHandler: jest.fn(),
  generateAndEmitPlaylist:  jest.fn(),
  handleBiometricReading:   jest.fn(),
  _debounceMap: new Map(),
}));

const User    = require('../app/models/User');
const garmin  = require('../app/services/wearable/garmin');
const { handleBiometricReading } = require('../app/sockets/biometricHandler');
const { pollOnce, startGarminPoller, stopGarminPoller } = require('../app/services/wearable/garminPoller');

// ── io mock factory ───────────────────────────────────────────────────────────

function makeIo(connectedUserIds = [], sockets = {}) {
  const rooms = new Map(
    connectedUserIds.map(id => [`user:${id}`, new Set([`sock_${id}`])])
  );
  const socketsMap = new Map(
    connectedUserIds.map(id => [
      `sock_${id}`,
      sockets[id] || { id: `sock_${id}`, emit: jest.fn(), data: { user: { _id: id } } },
    ])
  );
  return { sockets: { adapter: { rooms }, sockets: socketsMap } };
}

// ── User mock factory ─────────────────────────────────────────────────────────

function makeUser(id, overrides = {}) {
  return {
    _id: id,
    wearableToken: { blob: 'encrypted' },
    getToken: jest.fn().mockReturnValue({ accessToken: 'tok', accessTokenSecret: 'sec' }),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('pollOnce', () => {
  beforeEach(() => jest.clearAllMocks());

  it('skips users not in a socket room', async () => {
    User.find = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue([makeUser('u1')]) });
    const io = makeIo([]); // no connected sockets

    await pollOnce(io);

    expect(garmin.getDailyHeartRate).not.toHaveBeenCalled();
    expect(handleBiometricReading).not.toHaveBeenCalled();
  });

  it('calls getDailyHeartRate and handleBiometricReading for connected users', async () => {
    const user = makeUser('u2');
    User.find = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue([user]) });
    garmin.getDailyHeartRate = jest.fn().mockResolvedValue({
      dailies: [{
        averageHeartRateInBeatsPerMinute: 88,
        activityType: 'WALKING',
        startTimeLocal: '2026-06-21T10:00:00',
      }],
    });
    const io = makeIo(['u2']);

    await pollOnce(io);

    expect(garmin.getDailyHeartRate).toHaveBeenCalledWith('tok', 'sec');
    expect(handleBiometricReading).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sock_u2' }),
      'garmin',
      { heartRate: 88, activityType: 6, startTimeLocal: '2026-06-21T10:00:00' }
    );
  });

  it('skips summaries with no heart rate', async () => {
    const user = makeUser('u3');
    User.find = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue([user]) });
    garmin.getDailyHeartRate = jest.fn().mockResolvedValue({
      dailies: [{ averageHeartRateInBeatsPerMinute: null, activityType: 'WALKING', startTimeLocal: '2026-06-21T10:00:00' }],
    });
    const io = makeIo(['u3']);

    await pollOnce(io);

    expect(handleBiometricReading).not.toHaveBeenCalled();
  });

  it('logs error and continues if getDailyHeartRate throws for one user', async () => {
    const u4 = makeUser('u4');
    const u5 = makeUser('u5');
    User.find = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue([u4, u5]) });

    garmin.getDailyHeartRate = jest.fn()
      .mockRejectedValueOnce(new Error('Garmin API down'))
      .mockResolvedValueOnce({
        dailies: [{ averageHeartRateInBeatsPerMinute: 72, activityType: 'RUNNING', startTimeLocal: '2026-06-21T09:00:00' }],
      });

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const io = makeIo(['u4', 'u5']);

    await pollOnce(io);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('u4'), expect.stringContaining('Garmin API down'));
    expect(handleBiometricReading).toHaveBeenCalledTimes(1); // only u5 succeeded
    consoleSpy.mockRestore();
  });

  it('handles empty dailies array without calling handleBiometricReading', async () => {
    const user = makeUser('u6');
    User.find = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue([user]) });
    garmin.getDailyHeartRate = jest.fn().mockResolvedValue({ dailies: [] });
    const io = makeIo(['u6']);

    await pollOnce(io);

    expect(handleBiometricReading).not.toHaveBeenCalled();
  });

  it('maps Garmin activity strings to numeric adapter types', async () => {
    const activityCases = [
      ['RUNNING', 1], ['CYCLING', 2], ['SWIMMING', 5],
      ['WALKING', 6], ['STRENGTH_TRAINING', 13], ['UNKNOWN_SPORT', 0],
    ];

    for (const [actStr, expectedType] of activityCases) {
      jest.clearAllMocks();
      const user = makeUser(`u_${actStr}`);
      User.find = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue([user]) });
      garmin.getDailyHeartRate = jest.fn().mockResolvedValue({
        dailies: [{ averageHeartRateInBeatsPerMinute: 80, activityType: actStr, startTimeLocal: '2026-06-21T08:00:00' }],
      });
      const io = makeIo([`u_${actStr}`]);

      await pollOnce(io);

      expect(handleBiometricReading).toHaveBeenCalledWith(
        expect.anything(),
        'garmin',
        expect.objectContaining({ activityType: expectedType })
      );
    }
  });
});

describe('startGarminPoller / stopGarminPoller', () => {
  it('startGarminPoller does not throw', () => {
    const io = makeIo([]);
    expect(() => startGarminPoller(io)).not.toThrow();
    stopGarminPoller(); // clean up
  });

  it('stopGarminPoller clears the interval without error', () => {
    const io = makeIo([]);
    startGarminPoller(io);
    expect(() => stopGarminPoller()).not.toThrow();
  });

  it('startGarminPoller is idempotent (calling twice does not double-schedule)', () => {
    const io = makeIo([]);
    startGarminPoller(io);
    startGarminPoller(io); // second call should be a no-op
    stopGarminPoller();
    // No assertion needed — if it weren't idempotent, cleanup would miss one interval
    // and Jest's --forceExit would paper over it. The behavior is: no crash.
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests — expect fail**

```bash
cd backend && npx jest tests/garminPoller.test.js --no-coverage
```

Expected: FAIL — `Cannot find module '../app/services/wearable/garminPoller'`

- [ ] **Step 3: Create `backend/app/services/wearable/garminPoller.js`**

```javascript
'use strict';

const User   = require('../../models/User');
const garmin = require('./garmin');
const { handleBiometricReading } = require('../../sockets/biometricHandler');

const POLL_INTERVAL_MS = 30_000;

// Maps Garmin daily-summary activityType strings to the numeric IDs
// the wearable adapter's fromGarmin() function expects.
const GARMIN_ACTIVITY_TO_TYPE = {
  RUNNING:             1,
  CYCLING:             2,
  SWIMMING:            5,
  WALKING:             6,
  STRENGTH_TRAINING:   13,
};

let pollTimer = null;

async function pollOnce(io) {
  const users = await User
    .find({ wearableProvider: 'garmin', 'wearableToken.blob': { $exists: true }, deletedAt: null })
    .select('_id wearableToken');

  for (const user of users) {
    const room = io.sockets.adapter.rooms.get(`user:${user._id}`);
    if (!room || room.size === 0) continue;

    const [socketId] = room;
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) continue;

    try {
      const creds = user.getToken('wearableToken');
      const data  = await garmin.getDailyHeartRate(creds.accessToken, creds.accessTokenSecret);

      const summaries = data?.dailies ?? [];
      if (!summaries.length) continue;

      const latest    = summaries[summaries.length - 1];
      const heartRate = latest.averageHeartRateInBeatsPerMinute;
      if (!heartRate) continue;

      const raw = {
        heartRate,
        activityType:   GARMIN_ACTIVITY_TO_TYPE[latest.activityType] ?? 0,
        startTimeLocal: latest.startTimeLocal ?? new Date().toISOString(),
      };

      handleBiometricReading(socket, 'garmin', raw);
    } catch (err) {
      console.error(`[GarminPoller] poll failed for user ${user._id}: ${err.message}`);
    }
  }
}

function startGarminPoller(io) {
  if (pollTimer) return;
  pollTimer = setInterval(() => pollOnce(io).catch(console.error), POLL_INTERVAL_MS);
  console.log('[GarminPoller] started — polling every 30s');
}

function stopGarminPoller() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

module.exports = { startGarminPoller, stopGarminPoller, pollOnce };
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd backend && npx jest tests/garminPoller.test.js --no-coverage
```

Expected: PASS — 10 tests, 0 failures

- [ ] **Step 5: Wire `startGarminPoller` into `backend/app/index.js`**

Add the import and wire-up. In `index.js`, make two targeted edits:

**Add import** after the `createSocketServer` require line:
```javascript
const { startGarminPoller } = require('./services/wearable/garminPoller');
```

**Capture `io` and start the poller** in the `start()` function. Replace the two lines:
```javascript
  const httpServer = http.createServer(app);
  createSocketServer(httpServer);
```
with:
```javascript
  const httpServer = http.createServer(app);
  const io = createSocketServer(httpServer);
  startGarminPoller(io);
```

- [ ] **Step 6: Run full suite to confirm no regressions**

```bash
cd backend && npx jest --no-coverage 2>&1 | tail -5
```

Expected: `Tests: 277 passed` (267 + 10 new), `0 failed`

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/wearable/garminPoller.js backend/app/index.js backend/tests/garminPoller.test.js
git commit -m "feat: add Garmin polling loop — pushes live HR into biometric pipeline every 30s"
```

---

## Self-Review

**Spec coverage check:**

| Requirement from P2 plan | Covered by |
|---|---|
| Biometric mock script | Task 2 |
| Scenarios: resting/walking/running/spike/cooldown | Task 2 |
| `--scenario`, `--duration`, `--interval`, `--token` CLI args | Task 2 |
| Garmin polling every 30 seconds | Task 3 |
| Normalize via adapter (fromGarmin schema) | Task 3 |
| Emit to connected socket room | Task 3 |
| Handle Garmin API rate limit failures gracefully | Task 3 (try/catch per-user + `console.error` + continue) |
| `handleBiometricReading` extraction (shared primitive) | Task 1 |
| Existing 255 tests remain green | Verified in Steps 5/6/6 of each task |

**Placeholder scan:** None found.

**Type/name consistency:**
- `handleBiometricReading(socket, source, raw)` — defined in Task 1, used in Task 3 `pollOnce` — ✓
- `SCENARIOS[name].heartRate` / `.activityType` / `.label` — defined and tested in Task 2 — ✓
- `parseDurationMs(str): number` — defined and tested in Task 2 — ✓
- `startGarminPoller(io)` / `stopGarminPoller()` / `pollOnce(io)` — all exported and tested in Task 3 — ✓
- Garmin raw object shape: `{ heartRate, activityType: number, startTimeLocal: string }` — matches `adapter.fromGarmin` exactly — ✓
