# Spotify Web Playback SDK Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken `fetch()`-based `AudioPlayerService` with a real Spotify Web Playback SDK integration so that `playlist_ready` events result in actual audio playing in the browser.

**Architecture:** A `SpotifyPlayerService` singleton wraps the Spotify SDK and relays player state changes to Redux via a callback. A `useSpotifyPlayer` hook handles SDK script loading and initialization on `AppPage` mount. The LivePlayer component reads its state entirely from Redux and calls service methods for user controls. Playback is triggered from `AppPage` via a `useEffect` that watches the Redux `playlist` field — clean separation between socket events, Redux state, and SDK calls.

**Tech Stack:** Spotify Web Playback SDK (browser script), TypeScript, Redux Toolkit, React hooks, Vitest (frontend), Jest (backend), Axios (backend Spotify calls already in place).

> **Spotify Premium requirement:** The Web Playback SDK only works with Spotify Premium accounts. Document this in error handling but do not gate the UI around it.

## Global Constraints

- Backend test framework: Jest with CommonJS (`require`/`module.exports`) — match existing test file patterns
- Frontend test framework: Vitest with ESM — use `vi.*` not `jest.*`
- No new npm dependencies in frontend — Spotify SDK loads via `<script>` tag at runtime
- All backend files follow the existing pattern: controllers export named functions, routes wire them, services are pure functions
- AES-256-GCM token decryption uses `user.getToken('spotifyToken')` (already implemented on the User model)
- `getValidToken(user)` in `spotify.js` handles refresh automatically — call it in both new endpoints
- The existing `spotify.js` `SCOPES` array already includes `streaming` and `user-modify-playback-state` — no OAuth re-auth required
- Track `uri` fields in the Redux `playlist[]` array contain Spotify URI format: `spotify:track:<id>`
- Existing Tailwind class palette: bg-`[#16213e]`, text-`[#e63946]`, `[#e9c46a]`, `[#0f3460]` — match LivePlayer's existing style

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| **Modify** | `backend/app/services/spotify.js` | Add `playTracks(accessToken, uris, deviceId)` |
| **Modify** | `backend/app/controllers/integrationsController.js` | Add `getSpotifyToken`, `playSpotifyTracks` handlers |
| **Modify** | `backend/app/routes/integrations.js` | Wire `GET /spotify/token`, `POST /spotify/play` |
| **Create** | `backend/tests/spotifyPlayback.test.js` | Backend unit tests |
| **Modify** | `frontend/src/store/slices/playerSlice.ts` | Add SDK state fields + `setSdkState` reducer |
| **Create** | `frontend/src/services/spotifyPlayer.ts` | SDK singleton service |
| **Create** | `frontend/src/hooks/useSpotifyPlayer.ts` | Script loading + SDK init hook |
| **Modify** | `frontend/src/pages/AppPage.tsx` | Call hook, add playback trigger effect |
| **Modify** | `frontend/src/components/LivePlayer/LivePlayer.tsx` | Rewire controls + progress to SDK state |
| **Modify** | `frontend/src/__tests__/LivePlayer.test.tsx` | Update tests for new props/service |

---

## Task 1: Backend — Token & Play Endpoints

**Files:**
- Modify: `backend/app/services/spotify.js`
- Modify: `backend/app/controllers/integrationsController.js`
- Modify: `backend/app/routes/integrations.js`
- Create: `backend/tests/spotifyPlayback.test.js`

**Interfaces:**
- Produces: `GET /api/integrations/spotify/token` → `{ access_token: string }`
- Produces: `POST /api/integrations/spotify/play` body `{ uris: string[], deviceId: string }` → 204

---

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/spotifyPlayback.test.js`:

```javascript
const { getSpotifyToken, playSpotifyTracks } = require('../app/controllers/integrationsController');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRes() {
  const res = { statusCode: 200, body: null, ended: false };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.body = data; return res; };
  res.end = () => { res.ended = true; return res; };
  return res;
}

const next = jest.fn();

// ── getSpotifyToken ───────────────────────────────────────────────────────────

jest.mock('../app/services/spotify', () => ({
  getValidToken: jest.fn(),
  playTracks:    jest.fn(),
  getAuthUrl: jest.fn(),
  exchangeCode: jest.fn(),
  getProfile: jest.fn(),
  getTopTrackFeatures: jest.fn(),
  paginateLikedSongs: jest.fn(),
  paginatePlaylistTracks: jest.fn(),
  batchAudioFeatures: jest.fn(),
  getRecommendations: jest.fn(),
}));

const spotify = require('../app/services/spotify');

describe('getSpotifyToken', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns access_token when Spotify is connected', async () => {
    spotify.getValidToken.mockResolvedValue('tok_abc');
    const req = { user: { getToken: () => ({ accessToken: 'tok_abc', refreshToken: 'ref', expiresAt: Date.now() + 99999 }) } };
    const res = makeRes();

    await getSpotifyToken(req, res, next);

    expect(res.body).toEqual({ access_token: 'tok_abc' });
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next with error when getValidToken throws', async () => {
    const err = Object.assign(new Error('Spotify not connected'), { statusCode: 400 });
    spotify.getValidToken.mockRejectedValue(err);
    const req = { user: {} };
    const res = makeRes();

    await getSpotifyToken(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

// ── playSpotifyTracks ─────────────────────────────────────────────────────────

describe('playSpotifyTracks', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls spotify.playTracks and responds 204', async () => {
    spotify.getValidToken.mockResolvedValue('tok_abc');
    spotify.playTracks.mockResolvedValue();
    const req = {
      user: {},
      body: { uris: ['spotify:track:aaa', 'spotify:track:bbb'], deviceId: 'dev_123' },
    };
    const res = makeRes();

    await playSpotifyTracks(req, res, next);

    expect(spotify.playTracks).toHaveBeenCalledWith('tok_abc', ['spotify:track:aaa', 'spotify:track:bbb'], 'dev_123');
    expect(res.statusCode).toBe(204);
    expect(res.ended).toBe(true);
  });

  it('returns 400 when uris is empty', async () => {
    const req = { user: {}, body: { uris: [], deviceId: 'dev_123' } };
    const res = makeRes();

    await playSpotifyTracks(req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringContaining('uris') });
    expect(spotify.playTracks).not.toHaveBeenCalled();
  });

  it('returns 400 when deviceId is missing', async () => {
    const req = { user: {}, body: { uris: ['spotify:track:aaa'] } };
    const res = makeRes();

    await playSpotifyTracks(req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringContaining('deviceId') });
  });

  it('calls next with error when spotify.playTracks throws', async () => {
    spotify.getValidToken.mockResolvedValue('tok_abc');
    const err = new Error('Device not found');
    spotify.playTracks.mockRejectedValue(err);
    const req = {
      user: {},
      body: { uris: ['spotify:track:aaa'], deviceId: 'dev_123' },
    };
    const res = makeRes();

    await playSpotifyTracks(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd backend && npx jest tests/spotifyPlayback.test.js --no-coverage
```

Expected: FAIL — `getSpotifyToken is not a function` (not yet exported)

- [ ] **Step 3: Add `playTracks` to `backend/app/services/spotify.js`**

Append before `module.exports` (after `getRecommendations`):

```javascript
/**
 * Sends a play command to the Spotify Web Playback SDK device.
 * @param {string} accessToken
 * @param {string[]} uris  Spotify track URIs — e.g. ['spotify:track:abc123']
 * @param {string} deviceId  Device ID from the SDK 'ready' event
 */
async function playTracks(accessToken, uris, deviceId) {
  await axios.put(
    `${BASE_API}/me/player/play`,
    { uris },
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      params:  { device_id: deviceId },
      timeout: 8_000,
    }
  );
}
```

Update `module.exports` line to include `playTracks`:

```javascript
module.exports = {
  getAuthUrl, exchangeCode, getValidToken, getProfile, getTopTrackFeatures,
  paginateLikedSongs, paginatePlaylistTracks, batchAudioFeatures, getRecommendations,
  playTracks,
};
```

- [ ] **Step 4: Add controller handlers to `backend/app/controllers/integrationsController.js`**

Append after `exports.spotifyStatus`:

```javascript
// GET /api/integrations/spotify/token
// Returns a valid (auto-refreshed) decrypted Spotify access token for the Web Playback SDK.
exports.getSpotifyToken = async (req, res, next) => {
  try {
    const accessToken = await spotify.getValidToken(req.user);
    res.json({ access_token: accessToken });
  } catch (err) {
    next(err);
  }
};

// POST /api/integrations/spotify/play
// Body: { uris: string[], deviceId: string }
// Instructs the Spotify player (identified by deviceId) to play the given track URIs.
exports.playSpotifyTracks = async (req, res, next) => {
  try {
    const { uris, deviceId } = req.body;
    if (!Array.isArray(uris) || uris.length === 0) {
      return res.status(400).json({ error: 'uris must be a non-empty array' });
    }
    if (!deviceId) {
      return res.status(400).json({ error: 'deviceId is required' });
    }
    const accessToken = await spotify.getValidToken(req.user);
    await spotify.playTracks(accessToken, uris, deviceId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
};
```

- [ ] **Step 5: Wire routes in `backend/app/routes/integrations.js`**

Add the two imports at the top of the destructure and add the routes:

```javascript
const {
  getIntegrationsStatus,
  spotifyConnect, spotifyCallback, spotifyDisconnect, spotifyStatus,
  getSpotifyToken, playSpotifyTracks,           // ← add these two
  youtubeConnect, youtubeCallback, youtubeDisconnect, youtubeStatus,
  garminConnect, garminCallback, garminDisconnect,
  appleHealthPush,
  suuntoWebhook,
  wearableStatus,
} = require('../controllers/integrationsController');
```

Add routes after the existing `router.get('/spotify/status', spotifyStatus);` line:

```javascript
router.get('/spotify/token',        getSpotifyToken);
router.post('/spotify/play',        playSpotifyTracks);
```

- [ ] **Step 6: Run tests — expect pass**

```bash
cd backend && npx jest tests/spotifyPlayback.test.js --no-coverage
```

Expected: PASS — 6 tests, 0 failures

- [ ] **Step 7: Commit**

```bash
cd backend && git add app/services/spotify.js app/controllers/integrationsController.js app/routes/integrations.js tests/spotifyPlayback.test.js
git commit -m "feat: add spotify token and play endpoints for Web Playback SDK"
```

---

## Task 2: Redux playerSlice — Add SDK State Fields

**Files:**
- Modify: `frontend/src/store/slices/playerSlice.ts`

**Interfaces:**
- Produces: `setSdkState(state: SpotifySDKState)` action — used by Task 3
- Produces: Redux fields `sdkReady`, `deviceId`, `sdkIsPaused`, `sdkPositionMs`, `sdkDurationMs` — used by Tasks 4 and 5

---

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/__tests__/integrationsSlice.test.ts` (or create a new file `frontend/src/__tests__/playerSlice.test.ts`):

```typescript
import { describe, it, expect } from 'vitest';
import playerReducer, { setSdkState } from '../store/slices/playerSlice';

describe('playerSlice — SDK state', () => {
  const base = {
    playlist: [], offlineBuffer: [], currentIndex: 0,
    isPlaying: false, isOnline: true, trigger: null, playbackMode: null,
    sdkReady: false, deviceId: null,
    sdkIsPaused: true, sdkPositionMs: 0, sdkDurationMs: 0,
  };

  it('setSdkState updates SDK fields', () => {
    const next = playerReducer(base as never, setSdkState({
      deviceId: 'dev_abc',
      isReady: true,
      isPaused: false,
      positionMs: 5000,
      durationMs: 210000,
    }));
    expect(next.deviceId).toBe('dev_abc');
    expect(next.sdkReady).toBe(true);
    expect(next.sdkIsPaused).toBe(false);
    expect(next.sdkPositionMs).toBe(5000);
    expect(next.sdkDurationMs).toBe(210000);
  });

  it('setSdkState partial update preserves other fields', () => {
    const state = { ...base, sdkPositionMs: 3000, sdkDurationMs: 180000 };
    const next = playerReducer(state as never, setSdkState({ positionMs: 4000 }));
    expect(next.sdkPositionMs).toBe(4000);
    expect(next.sdkDurationMs).toBe(180000); // unchanged
  });
});
```

- [ ] **Step 2: Run test — expect fail**

```bash
cd frontend && npx vitest run src/__tests__/playerSlice.test.ts
```

Expected: FAIL — `setSdkState is not exported from playerSlice`

- [ ] **Step 3: Update `frontend/src/store/slices/playerSlice.ts`**

Replace the entire file with the extended version:

```typescript
import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';

interface Track {
  id: string;
  title: string;
  artist: string;
  uri: string;
}

export interface SpotifySDKState {
  deviceId?: string | null;
  isReady?: boolean;
  isPaused?: boolean;
  positionMs?: number;
  durationMs?: number;
}

interface PlayerState {
  playlist: Track[];
  offlineBuffer: Track[];
  currentIndex: number;
  isPlaying: boolean;
  isOnline: boolean;
  trigger: 'emotion' | 'biometric' | 'skip_loop' | null;
  playbackMode: 'live' | 'export' | null;
  // Spotify Web Playback SDK state
  sdkReady: boolean;
  deviceId: string | null;
  sdkIsPaused: boolean;
  sdkPositionMs: number;
  sdkDurationMs: number;
}

const initialState: PlayerState = {
  playlist: [],
  offlineBuffer: [],
  currentIndex: 0,
  isPlaying: false,
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  trigger: null,
  playbackMode: null,
  sdkReady: false,
  deviceId: null,
  sdkIsPaused: true,
  sdkPositionMs: 0,
  sdkDurationMs: 0,
};

const playerSlice = createSlice({
  name: 'player',
  initialState,
  reducers: {
    setPlaylist(state, action: PayloadAction<{ tracks: Track[]; trigger: PlayerState['trigger'] }>) {
      state.playlist = action.payload.tracks;
      state.trigger = action.payload.trigger;
      state.currentIndex = 0;
      state.offlineBuffer = action.payload.tracks.slice(0, 10);
      state.sdkPositionMs = 0;
    },
    skipTrack(state) {
      const list = state.isOnline ? state.playlist : state.offlineBuffer;
      if (list.length === 0) return;
      state.currentIndex = (state.currentIndex + 1) % list.length;
      state.sdkPositionMs = 0;
    },
    setPlaying(state, action: PayloadAction<boolean>) {
      state.isPlaying = action.payload;
    },
    setIsOnline(state, action: PayloadAction<boolean>) {
      state.isOnline = action.payload;
    },
    setPlaybackMode(state, action: PayloadAction<'live' | 'export' | null>) {
      state.playbackMode = action.payload;
    },
    setSdkState(state, action: PayloadAction<SpotifySDKState>) {
      const { deviceId, isReady, isPaused, positionMs, durationMs } = action.payload;
      if (deviceId !== undefined) state.deviceId = deviceId;
      if (isReady !== undefined) state.sdkReady = isReady;
      if (isPaused !== undefined) state.sdkIsPaused = isPaused;
      if (positionMs !== undefined) state.sdkPositionMs = positionMs;
      if (durationMs !== undefined) state.sdkDurationMs = durationMs;
    },
  },
});

export const {
  setPlaylist, skipTrack, setPlaying, setIsOnline, setPlaybackMode, setSdkState,
} = playerSlice.actions;
export default playerSlice.reducer;
```

- [ ] **Step 4: Run test — expect pass**

```bash
cd frontend && npx vitest run src/__tests__/playerSlice.test.ts
```

Expected: PASS — 2 tests, 0 failures

- [ ] **Step 5: Commit**

```bash
cd frontend && git add src/store/slices/playerSlice.ts src/__tests__/playerSlice.test.ts
git commit -m "feat: add Spotify SDK state fields to playerSlice"
```

---

## Task 3: SpotifyPlayerService Singleton

**Files:**
- Create: `frontend/src/services/spotifyPlayer.ts`
- Create: `frontend/src/__tests__/spotifyPlayer.test.ts`

**Interfaces:**
- Consumes: `SpotifySDKState` from `playerSlice.ts` (Task 2)
- Produces: `spotifyPlayerService` singleton with: `init(fetchToken)`, `onStateChange(cb)`, `getDeviceId()`, `pause()`, `resume()`, `nextTrack()`, `destroy()`

---

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/__tests__/spotifyPlayer.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We import the module AFTER setting up window.Spotify so the singleton gets a
// fresh start each test — we reset it by calling destroy() in afterEach.
vi.mock('../hooks/useSocket', () => ({ useSocket: vi.fn() }));

function makeMockPlayer() {
  return {
    connect:      vi.fn().mockResolvedValue(true),
    disconnect:   vi.fn(),
    pause:        vi.fn().mockResolvedValue(undefined),
    resume:       vi.fn().mockResolvedValue(undefined),
    nextTrack:    vi.fn().mockResolvedValue(undefined),
    _listeners:   {} as Record<string, ((data: unknown) => void)[]>,
    addListener(event: string, cb: (data: unknown) => void) {
      this._listeners[event] = this._listeners[event] ?? [];
      this._listeners[event].push(cb);
      return true;
    },
    removeListener: vi.fn().mockReturnValue(true),
    _emit(event: string, data: unknown) {
      (this._listeners[event] ?? []).forEach(cb => cb(data));
    },
  };
}

describe('SpotifyPlayerService', () => {
  let mockPlayer: ReturnType<typeof makeMockPlayer>;

  beforeEach(() => {
    mockPlayer = makeMockPlayer();
    (global as unknown as { Spotify: unknown }).Spotify = {
      Player: vi.fn().mockImplementation(() => mockPlayer),
    };
  });

  afterEach(async () => {
    const { spotifyPlayerService } = await import('../services/spotifyPlayer');
    spotifyPlayerService.destroy();
    vi.resetModules();
  });

  it('init connects the SDK player', async () => {
    const { spotifyPlayerService } = await import('../services/spotifyPlayer');
    await spotifyPlayerService.init(async () => 'test_token');
    expect(mockPlayer.connect).toHaveBeenCalledOnce();
  });

  it('emits deviceId when SDK fires ready event', async () => {
    const { spotifyPlayerService } = await import('../services/spotifyPlayer');
    const cb = vi.fn();
    spotifyPlayerService.onStateChange(cb);

    await spotifyPlayerService.init(async () => 'test_token');
    mockPlayer._emit('ready', { device_id: 'dev_xyz' });

    expect(cb).toHaveBeenCalledWith(expect.objectContaining({
      deviceId: 'dev_xyz',
      isReady: true,
    }));
    expect(spotifyPlayerService.getDeviceId()).toBe('dev_xyz');
  });

  it('emits isPaused=false when player_state_changed fires with paused=false', async () => {
    const { spotifyPlayerService } = await import('../services/spotifyPlayer');
    const cb = vi.fn();
    spotifyPlayerService.onStateChange(cb);

    await spotifyPlayerService.init(async () => 'test_token');
    mockPlayer._emit('player_state_changed', {
      paused: false,
      position: 5000,
      duration: 210000,
      track_window: { current_track: { uri: 'spotify:track:abc' } },
    });

    expect(cb).toHaveBeenCalledWith(expect.objectContaining({
      isPaused: false,
      positionMs: 5000,
      durationMs: 210000,
    }));
  });

  it('pause() delegates to player.pause()', async () => {
    const { spotifyPlayerService } = await import('../services/spotifyPlayer');
    await spotifyPlayerService.init(async () => 'test_token');
    await spotifyPlayerService.pause();
    expect(mockPlayer.pause).toHaveBeenCalledOnce();
  });

  it('resume() delegates to player.resume()', async () => {
    const { spotifyPlayerService } = await import('../services/spotifyPlayer');
    await spotifyPlayerService.init(async () => 'test_token');
    await spotifyPlayerService.resume();
    expect(mockPlayer.resume).toHaveBeenCalledOnce();
  });

  it('nextTrack() delegates to player.nextTrack()', async () => {
    const { spotifyPlayerService } = await import('../services/spotifyPlayer');
    await spotifyPlayerService.init(async () => 'test_token');
    await spotifyPlayerService.nextTrack();
    expect(mockPlayer.nextTrack).toHaveBeenCalledOnce();
  });

  it('destroy() disconnects and resets state', async () => {
    const { spotifyPlayerService } = await import('../services/spotifyPlayer');
    await spotifyPlayerService.init(async () => 'test_token');
    spotifyPlayerService.destroy();
    expect(mockPlayer.disconnect).toHaveBeenCalledOnce();
    expect(spotifyPlayerService.getDeviceId()).toBeNull();
  });

  it('init() is a no-op if called again before destroy()', async () => {
    const { spotifyPlayerService } = await import('../services/spotifyPlayer');
    await spotifyPlayerService.init(async () => 'test_token');
    await spotifyPlayerService.init(async () => 'test_token');
    expect(mockPlayer.connect).toHaveBeenCalledOnce(); // not twice
  });
});
```

- [ ] **Step 2: Run tests — expect fail**

```bash
cd frontend && npx vitest run src/__tests__/spotifyPlayer.test.ts
```

Expected: FAIL — `Cannot find module '../services/spotifyPlayer'`

- [ ] **Step 3: Create `frontend/src/services/spotifyPlayer.ts`**

```typescript
import type { SpotifySDKState } from '../store/slices/playerSlice';

// Minimal Spotify Web Playback SDK type declarations
declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady: () => void;
    Spotify: {
      Player: new (options: SpotifyPlayerOptions) => SpotifyPlayer;
    };
  }
}

interface SpotifyPlayerOptions {
  name: string;
  getOAuthToken: (cb: (token: string) => void) => void;
  volume: number;
}

interface SpotifyPlayer {
  connect(): Promise<boolean>;
  disconnect(): void;
  pause(): Promise<void>;
  resume(): Promise<void>;
  nextTrack(): Promise<void>;
  addListener(event: string, cb: (data: unknown) => void): boolean;
  removeListener(event: string, cb?: (data: unknown) => void): boolean;
}

type SDKStateCallback = (state: SpotifySDKState) => void;

class SpotifyPlayerService {
  private static _instance: SpotifyPlayerService;
  private player: SpotifyPlayer | null = null;
  private deviceId: string | null = null;
  private stateCallback: SDKStateCallback | null = null;
  private positionInterval: ReturnType<typeof setInterval> | null = null;
  private currentPositionMs = 0;
  private currentDurationMs = 0;
  private isCurrentlyPaused = true;

  static getInstance(): SpotifyPlayerService {
    if (!SpotifyPlayerService._instance) {
      SpotifyPlayerService._instance = new SpotifyPlayerService();
    }
    return SpotifyPlayerService._instance;
  }

  onStateChange(callback: SDKStateCallback): void {
    this.stateCallback = callback;
  }

  private emit(patch: SpotifySDKState): void {
    this.stateCallback?.(patch);
  }

  async init(fetchToken: () => Promise<string>): Promise<void> {
    if (this.player) return;

    this.player = new window.Spotify.Player({
      name: 'Kokonada',
      getOAuthToken: (cb) => { fetchToken().then(cb).catch(console.error); },
      volume: 0.8,
    });

    this.player.addListener('ready', (data: unknown) => {
      const { device_id } = data as { device_id: string };
      this.deviceId = device_id;
      this.emit({ deviceId: device_id, isReady: true });
    });

    this.player.addListener('not_ready', () => {
      this.emit({ isReady: false });
    });

    this.player.addListener('player_state_changed', (data: unknown) => {
      if (!data) return;
      const s = data as { paused: boolean; position: number; duration: number };
      this.isCurrentlyPaused = s.paused;
      this.currentPositionMs = s.position;
      this.currentDurationMs = s.duration;
      this.emit({ isPaused: s.paused, positionMs: s.position, durationMs: s.duration });

      if (!s.paused) {
        this.startProgressInterval();
      } else {
        this.stopProgressInterval();
      }
    });

    await this.player.connect();
  }

  private startProgressInterval(): void {
    if (this.positionInterval) return;
    this.positionInterval = setInterval(() => {
      if (!this.isCurrentlyPaused) {
        this.currentPositionMs = Math.min(
          this.currentPositionMs + 1000,
          this.currentDurationMs,
        );
        this.emit({ positionMs: this.currentPositionMs });
      }
    }, 1000);
  }

  private stopProgressInterval(): void {
    if (this.positionInterval) {
      clearInterval(this.positionInterval);
      this.positionInterval = null;
    }
  }

  getDeviceId(): string | null {
    return this.deviceId;
  }

  async pause(): Promise<void> {
    await this.player?.pause();
  }

  async resume(): Promise<void> {
    await this.player?.resume();
  }

  async nextTrack(): Promise<void> {
    await this.player?.nextTrack();
  }

  destroy(): void {
    this.stopProgressInterval();
    this.player?.disconnect();
    this.player = null;
    this.deviceId = null;
    this.stateCallback = null;
    this.currentPositionMs = 0;
    this.currentDurationMs = 0;
    this.isCurrentlyPaused = true;
  }
}

export const spotifyPlayerService = SpotifyPlayerService.getInstance();
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd frontend && npx vitest run src/__tests__/spotifyPlayer.test.ts
```

Expected: PASS — 8 tests, 0 failures

- [ ] **Step 5: Commit**

```bash
cd frontend && git add src/services/spotifyPlayer.ts src/__tests__/spotifyPlayer.test.ts
git commit -m "feat: add SpotifyPlayerService singleton wrapping Web Playback SDK"
```

---

## Task 4: useSpotifyPlayer Hook + AppPage Integration

**Files:**
- Create: `frontend/src/hooks/useSpotifyPlayer.ts`
- Modify: `frontend/src/pages/AppPage.tsx`

**Interfaces:**
- Consumes: `spotifyPlayerService` from Task 3, `setSdkState` from Task 2
- Produces: `useSpotifyPlayer(musicProvider)` hook — no return value; side effects only

---

- [ ] **Step 1: Create `frontend/src/hooks/useSpotifyPlayer.ts`**

```typescript
import { useEffect } from 'react';
import { useDispatch } from 'react-redux';
import type { AppDispatch } from '../store';
import { setSdkState } from '../store/slices/playerSlice';
import { spotifyPlayerService } from '../services/spotifyPlayer';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:5000';

async function fetchSpotifyToken(): Promise<string> {
  const res = await fetch(`${BACKEND_URL}/api/integrations/spotify/token`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`Spotify token fetch failed: ${res.status}`);
  const data = await res.json() as { access_token: string };
  return data.access_token;
}

function loadSpotifyScript(): Promise<void> {
  return new Promise((resolve) => {
    if (window.Spotify) { resolve(); return; }
    window.onSpotifyWebPlaybackSDKReady = resolve;
    if (!document.querySelector('script[src*="spotify-player"]')) {
      const script = document.createElement('script');
      script.src = 'https://sdk.scdn.co/spotify-player.js';
      script.async = true;
      document.head.appendChild(script);
    }
  });
}

export function useSpotifyPlayer(musicProvider: string | null): void {
  const dispatch = useDispatch<AppDispatch>();

  useEffect(() => {
    if (musicProvider !== 'spotify') return;

    let cancelled = false;

    spotifyPlayerService.onStateChange((state) => {
      if (!cancelled) dispatch(setSdkState(state));
    });

    loadSpotifyScript()
      .then(() => {
        if (!cancelled) return spotifyPlayerService.init(fetchSpotifyToken);
      })
      .catch((err) => console.error('[SpotifySDK] init failed:', err));

    return () => {
      cancelled = true;
      spotifyPlayerService.destroy();
    };
  }, [musicProvider, dispatch]);
}
```

- [ ] **Step 2: Update `frontend/src/pages/AppPage.tsx`**

Replace the entire file:

```typescript
import { useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '../store';
import { clearUser, setAuthStatus } from '../store/slices/authSlice';
import { addTap } from '../store/slices/emotionSlice';
import { useSocket } from '../hooks/useSocket';
import { useSpotifyPlayer } from '../hooks/useSpotifyPlayer';
import ActivityPanel from '../components/ActivityPanel';
import ContextPrompt from '../components/ContextPrompt';
import EmotionCircle from '../components/EmotionCircle';
import PlaylistView from '../components/PlaylistView';
import LivePlayer from '../components/LivePlayer';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:5000';

export default function AppPage() {
  const dispatch = useDispatch<AppDispatch>();
  const user = useSelector((state: RootState) => state.auth.user);
  const taps = useSelector((state: RootState) => state.emotion.taps);
  const musicProvider = useSelector((state: RootState) => state.integrations.musicProvider);
  const { playlist, playbackMode, deviceId } = useSelector((state: RootState) => state.player);
  const { disconnect, emitEmotionUpdate } = useSocket();

  // Initialize Spotify Web Playback SDK if the user's music provider is Spotify
  useSpotifyPlayer(musicProvider);

  // When a new playlist arrives in live mode, start Spotify playback
  useEffect(() => {
    if (
      playbackMode !== 'live' ||
      musicProvider !== 'spotify' ||
      !deviceId ||
      playlist.length === 0
    ) return;

    const uris = playlist.map((t) => t.uri);
    fetch(`${BACKEND_URL}/api/integrations/spotify/play`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris, deviceId }),
    }).catch((err) => console.error('[Spotify] play failed:', err));
  }, [playlist]); // Re-run only when the playlist itself changes

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  const handleLogout = async () => {
    try {
      await fetch(`${BACKEND_URL}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // network failure — still clear client-side auth so user is never stuck
    } finally {
      dispatch(clearUser());
      dispatch(setAuthStatus('idle'));
    }
  };

  return (
    <div className="min-h-screen bg-[#1a1a2e]">
      <header className="bg-[#0f3460] px-6 py-3 flex justify-between items-center">
        <span className="text-xl font-bold text-[#e9c46a]">Kokonada</span>
        <div className="flex items-center gap-3">
          {user?.avatarUrl && (
            <img className="w-8 h-8 rounded-full object-cover" src={user.avatarUrl} alt={user.displayName} />
          )}
          <span className="text-sm text-gray-200">{user?.displayName}</span>
          <button
            className="border border-white/30 text-gray-200 hover:bg-white/10 px-3 py-1.5 rounded-lg transition-colors"
            onClick={handleLogout}
          >
            Logout
          </button>
        </div>
      </header>
      <main className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 max-w-6xl mx-auto">
        <div className="flex flex-col gap-4">
          <ActivityPanel />
          <button
            onClick={() => {
              dispatch(addTap({ x: 0, y: 0 }));
              emitEmotionUpdate([...taps, { x: 0, y: 0 }]);
            }}
            disabled={taps.length >= 3}
            className="w-full border border-[#e9c46a]/40 text-[#e9c46a] hover:bg-[#e9c46a]/10 disabled:opacity-30 disabled:cursor-not-allowed py-2 rounded-lg transition-colors text-sm font-medium"
          >
            Neutral / Skip
          </button>
          <ContextPrompt />
        </div>
        <div className="flex flex-col gap-4">
          <EmotionCircle />
          <PlaylistView />
          <LivePlayer />
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles cleanly**

```bash
cd frontend && npx tsc --noEmit
```

Expected: No errors (or only pre-existing errors unrelated to these files)

- [ ] **Step 4: Commit**

```bash
cd frontend && git add src/hooks/useSpotifyPlayer.ts src/pages/AppPage.tsx
git commit -m "feat: add useSpotifyPlayer hook and wire AppPage playback trigger"
```

---

## Task 5: Rewire LivePlayer to SDK State

**Files:**
- Modify: `frontend/src/components/LivePlayer/LivePlayer.tsx`
- Modify: `frontend/src/__tests__/LivePlayer.test.tsx`

**Interfaces:**
- Consumes: `spotifyPlayerService` (Task 3), Redux `sdkIsPaused`, `sdkPositionMs`, `sdkDurationMs` (Task 2)
- Replaces: all `audioPlayer` calls (the old `AudioPlayerService` import is removed from this file)

---

- [ ] **Step 1: Write the updated failing tests**

Replace `frontend/src/__tests__/LivePlayer.test.tsx` with:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import LivePlayer from '../components/LivePlayer';
import playerReducer from '../store/slices/playerSlice';
import authReducer from '../store/slices/authSlice';
import biometricsReducer from '../store/slices/biometricsSlice';
import emotionReducer from '../store/slices/emotionSlice';
import integrationsReducer from '../store/slices/integrationsSlice';

// Mock spotifyPlayerService
vi.mock('../services/spotifyPlayer', () => ({
  spotifyPlayerService: {
    pause:     vi.fn().mockResolvedValue(undefined),
    resume:    vi.fn().mockResolvedValue(undefined),
    nextTrack: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock useSocket
vi.mock('../hooks/useSocket', () => ({
  useSocket: () => ({ skipTrack: vi.fn(), emitEmotionUpdate: vi.fn(), connected: true, disconnect: vi.fn() }),
}));

function buildStore(playerOverrides = {}) {
  return configureStore({
    reducer: {
      auth: authReducer,
      biometrics: biometricsReducer,
      emotion: emotionReducer,
      player: playerReducer,
      integrations: integrationsReducer,
    },
    preloadedState: {
      player: {
        playlist: [
          { id: 'aaa', title: 'Song A', artist: 'Artist X', uri: 'spotify:track:aaa' },
          { id: 'bbb', title: 'Song B', artist: 'Artist Y', uri: 'spotify:track:bbb' },
        ],
        offlineBuffer: [],
        currentIndex: 0,
        isPlaying: false,
        isOnline: true,
        trigger: 'emotion' as const,
        playbackMode: 'live' as const,
        sdkReady: true,
        deviceId: 'dev_123',
        sdkIsPaused: true,
        sdkPositionMs: 0,
        sdkDurationMs: 210000,
        ...playerOverrides,
      },
    } as never,
  });
}

describe('LivePlayer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders track title and artist', () => {
    render(<Provider store={buildStore()}><LivePlayer /></Provider>);
    expect(screen.getByText('Song A')).toBeInTheDocument();
    expect(screen.getByText('Artist X')).toBeInTheDocument();
  });

  it('shows play button when SDK is paused', () => {
    render(<Provider store={buildStore({ sdkIsPaused: true })}><LivePlayer /></Provider>);
    expect(screen.getByRole('button', { name: /play/i })).toBeInTheDocument();
  });

  it('shows pause button when SDK is playing', () => {
    render(<Provider store={buildStore({ sdkIsPaused: false })}><LivePlayer /></Provider>);
    expect(screen.getByRole('button', { name: /pause/i })).toBeInTheDocument();
  });

  it('calls spotifyPlayerService.resume() on play click', async () => {
    const { spotifyPlayerService } = await import('../services/spotifyPlayer');
    render(<Provider store={buildStore({ sdkIsPaused: true })}><LivePlayer /></Provider>);
    fireEvent.click(screen.getByRole('button', { name: /play/i }));
    expect(spotifyPlayerService.resume).toHaveBeenCalledOnce();
  });

  it('calls spotifyPlayerService.pause() on pause click', async () => {
    const { spotifyPlayerService } = await import('../services/spotifyPlayer');
    render(<Provider store={buildStore({ sdkIsPaused: false })}><LivePlayer /></Provider>);
    fireEvent.click(screen.getByRole('button', { name: /pause/i }));
    expect(spotifyPlayerService.pause).toHaveBeenCalledOnce();
  });

  it('calls spotifyPlayerService.nextTrack() on skip click', async () => {
    const { spotifyPlayerService } = await import('../services/spotifyPlayer');
    render(<Provider store={buildStore()}><LivePlayer /></Provider>);
    fireEvent.click(screen.getByRole('button', { name: /skip/i }));
    expect(spotifyPlayerService.nextTrack).toHaveBeenCalledOnce();
  });

  it('skip button is disabled when on last track', () => {
    render(
      <Provider store={buildStore({ currentIndex: 1 })}><LivePlayer /></Provider>
    );
    expect(screen.getByRole('button', { name: /skip/i })).toBeDisabled();
  });

  it('renders progress bar width from SDK position', () => {
    // 50% through a 200s track
    const store = buildStore({ sdkPositionMs: 100000, sdkDurationMs: 200000 });
    const { container } = render(<Provider store={store}><LivePlayer /></Provider>);
    const bar = container.querySelector('.bg-\\[\\#e9c46a\\]') as HTMLElement;
    expect(bar.style.width).toBe('50%');
  });

  it('returns null when playbackMode is not live', () => {
    const { container } = render(
      <Provider store={buildStore({ playbackMode: null })}><LivePlayer /></Provider>
    );
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — expect fail**

```bash
cd frontend && npx vitest run src/__tests__/LivePlayer.test.tsx
```

Expected: FAIL — tests reference `sdkIsPaused` / `spotifyPlayerService` which LivePlayer doesn't use yet

- [ ] **Step 3: Replace `frontend/src/components/LivePlayer/LivePlayer.tsx`**

```typescript
import { useDispatch, useSelector } from 'react-redux';
import type { RootState, AppDispatch } from '../../store';
import { skipTrack as skipTrackAction } from '../../store/slices/playerSlice';
import { spotifyPlayerService } from '../../services/spotifyPlayer';
import { useSocket } from '../../hooks/useSocket';

export default function LivePlayer() {
  const dispatch = useDispatch<AppDispatch>();
  const { skipTrack } = useSocket();
  const {
    playbackMode, playlist, currentIndex,
    sdkIsPaused, sdkPositionMs, sdkDurationMs,
  } = useSelector((s: RootState) => s.player);

  if (playbackMode !== 'live' || playlist.length === 0) return null;

  const track = playlist[currentIndex];
  const progress = sdkDurationMs > 0 ? sdkPositionMs / sdkDurationMs : 0;

  const handlePlay = () => { spotifyPlayerService.resume().catch(console.error); };
  const handlePause = () => { spotifyPlayerService.pause().catch(console.error); };
  const handleSkip = () => {
    spotifyPlayerService.nextTrack().catch(console.error);
    dispatch(skipTrackAction());
    skipTrack();
  };

  return (
    <div className="bg-[#16213e] rounded-xl p-5 shadow-lg mt-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex-1 min-w-0 mr-3">
          <p className="text-white font-semibold text-sm truncate">{track.title}</p>
          <p className="text-gray-400 text-xs truncate">{track.artist}</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            aria-label={sdkIsPaused ? 'Play' : 'Pause'}
            onClick={sdkIsPaused ? handlePlay : handlePause}
            className="bg-[#e63946] hover:opacity-80 text-white rounded-full w-9 h-9 flex items-center justify-center transition-opacity"
          >
            {sdkIsPaused ? '▶' : '⏸'}
          </button>
          <button
            aria-label="Skip"
            onClick={handleSkip}
            disabled={currentIndex + 1 >= playlist.length}
            className="border border-white/20 hover:bg-white/10 disabled:opacity-30 text-white rounded-full w-9 h-9 flex items-center justify-center transition-colors"
          >
            ⏭
          </button>
        </div>
      </div>
      <div className="w-full bg-white/10 rounded-full h-1">
        <div
          className="bg-[#e9c46a] h-1 rounded-full transition-[width] duration-200"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run all frontend tests — expect pass**

```bash
cd frontend && npx vitest run
```

Expected: All tests pass. No test references `audioPlayer` in LivePlayer anymore.

- [ ] **Step 5: TypeScript check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: 0 errors

- [ ] **Step 6: Run all backend tests to ensure nothing regressed**

```bash
cd backend && npx jest --no-coverage
```

Expected: All 12 existing test files + new `spotifyPlayback.test.js` pass

- [ ] **Step 7: Final commit**

```bash
cd frontend && git add src/components/LivePlayer/LivePlayer.tsx src/__tests__/LivePlayer.test.tsx
git commit -m "feat: rewire LivePlayer to Spotify Web Playback SDK state and controls"
```

---

## Self-Review

**Spec coverage check:**

| Requirement | Covered by |
|---|---|
| `GET /api/integrations/spotify/token` endpoint | Task 1 |
| `POST /api/integrations/spotify/play` endpoint | Task 1 |
| SDK script loading | Task 4 (`useSpotifyPlayer`) |
| SDK init with device ID | Task 3 (`SpotifyPlayerService.init`) |
| `device_id` stored in Redux | Task 2 + Task 3 emit |
| `playlist_ready` → Spotify playback triggered | Task 4 (`AppPage` effect) |
| Play/Pause button wired to SDK | Task 5 |
| Skip button wired to SDK + Redux + Socket | Task 5 |
| Progress bar driven by SDK position | Task 5 |
| Token auto-refresh on SDK `getOAuthToken` callback | Task 3 (delegates to `fetchSpotifyToken` → backend `getValidToken`) |
| `AudioPlayerService` removed from LivePlayer | Task 5 |

**Placeholder scan:** None found.

**Type consistency check:**
- `SpotifySDKState` defined in `playerSlice.ts`, imported in `spotifyPlayer.ts` — ✓
- `setSdkState(SpotifySDKState)` reducer in Task 2, called in Task 3 via callback — ✓
- `spotifyPlayerService.resume/pause/nextTrack` signatures match between Task 3 (impl) and Task 5 (usage) — ✓
- `playlist[].uri` format `spotify:track:xxx` used in Task 4 playback trigger — ✓
