# Frontend Watch HR Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the frontend for the sideloaded-watch HR flow — a watch-token management UI plus "adjust upcoming queue only" playback so HR-driven playlists never interrupt the current track.

**Architecture:** A tiny new backend endpoint exposes watch connection status. The frontend gains watch state in `integrationsSlice`, a `WatchTokenCard` on the IntegrationsPage (replacing the defunct Garmin OAuth row), and a `pendingPlaylist` concept in `playerSlice`. Incoming `playlist_ready` events with `trigger: 'biometric'` queue into `pendingPlaylist` (when a track is actively playing) instead of replacing playback; a `usePendingPromotion` hook promotes the pending playlist at the next Spotify track boundary.

**Tech Stack:** React 19 + Redux Toolkit, Vitest + @testing-library/react (happy-dom), socket.io-client, Spotify Web Playback SDK; backend Express 5 + Jest.

## Global Constraints

- **Defer scope:** Only `trigger === 'biometric'` playlists defer; `emotion`/`skip_loop`/no-trigger replace immediately.
- **"Actively playing" is defined as:** `player.playlist.length > 0 && player.sdkIsPaused === false`. Paused or empty ⇒ not playing ⇒ immediate replace.
- **Staleness:** `WATCH_STALE_MS = 6 * 60 * 1000` (5-min ping cadence + 1-min jitter grace).
- **Token is shown once:** the backend only returns the plaintext `whr_…` at issue time (it stores the SHA-256 hash). Never attempt to re-display a stored token.
- **`Track` type:** `{ id: string; title: string; artist: string; uri: string }`.
- **`trigger` type:** `'emotion' | 'biometric' | 'skip_loop' | null`.
- **Commit style (this repo / user preference):** short, single-line conventional messages — **no body, no trailers** (e.g. `feat: add watch status endpoint`).
- **Test commands:** frontend tests run from `frontend/` via `npx vitest run <file>`; backend tests run from `backend/` via `npx jest <file>`.
- **Existing backend watch contract (do not change):** `POST /api/integrations/watch/token` → `201 {token}`; `DELETE /api/integrations/watch/token` → `200 {message}`; `POST /api/integrations/watch/hr` (public) → `202 {ok:true}` / `409 {live:false}` / `401` / `400`. HR ingest emits `playlist_ready` with `trigger:'biometric'`.

---

### Task 1: Backend — `GET /api/integrations/watch/status` endpoint

**Files:**
- Modify: `backend/app/controllers/integrationsController.js` (add `watchStatus` after `revokeWatchToken`, ~line 469)
- Modify: `backend/app/routes/integrations.js` (import + register route under `router.use(auth)`)
- Test: `backend/tests/watchStatus.test.js` (create)

**Interfaces:**
- Consumes: `req.user.watchToken` (`{ hash, createdAt, lastSeenAt }` or `null`).
- Produces: `GET /api/integrations/watch/status` → `{ connected: boolean, lastSeenAt: string | null }`. Frontend `fetchWatchStatus` (Task 3) relies on this exact shape.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/watchStatus.test.js`:

```js
'use strict';

// Mock the socket + biometric layers so requiring the controller does not boot
// socket.io. Mirrors backend/tests/watchIntegration.test.js.
jest.mock('../app/sockets', () => ({ getIo: jest.fn(), createSocketServer: jest.fn() }));
jest.mock('../app/sockets/biometricHandler', () => ({
  handleBiometricReading: jest.fn(),
  registerBiometricHandler: jest.fn(),
  generateAndEmitPlaylist: jest.fn(),
}));
jest.mock('../app/models/User');

const { watchStatus } = require('../app/controllers/integrationsController');

function makeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.body = data; return res; };
  return res;
}

describe('watchStatus', () => {
  it('returns connected:false and lastSeenAt:null when no token', () => {
    const res = makeRes();
    watchStatus({ user: { watchToken: null } }, res);
    expect(res.body).toEqual({ connected: false, lastSeenAt: null });
  });

  it('returns connected:true and the lastSeenAt date when a token exists', () => {
    const seen = new Date('2026-06-24T17:00:00.000Z');
    const res = makeRes();
    watchStatus({ user: { watchToken: { hash: 'abc', createdAt: new Date(), lastSeenAt: seen } } }, res);
    expect(res.body).toEqual({ connected: true, lastSeenAt: seen });
  });

  it('returns connected:true and lastSeenAt:null when token exists but never seen', () => {
    const res = makeRes();
    watchStatus({ user: { watchToken: { hash: 'abc', createdAt: new Date(), lastSeenAt: null } } }, res);
    expect(res.body).toEqual({ connected: true, lastSeenAt: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `backend/`): `npx jest tests/watchStatus.test.js`
Expected: FAIL — `watchStatus is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `backend/app/controllers/integrationsController.js`, add after the `revokeWatchToken` export (around line 469):

```js
// GET /api/integrations/watch/status  (auth required)
// Powers the frontend connection badge. lastSeenAt is updated on each successful
// HR ingest (see watchHrIngest); it is null until the first ping.
exports.watchStatus = (req, res) => {
  res.json({
    connected:  !!req.user.watchToken?.hash,
    lastSeenAt: req.user.watchToken?.lastSeenAt ?? null,
  });
};
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `backend/`): `npx jest tests/watchStatus.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Register the route**

In `backend/app/routes/integrations.js`, add `watchStatus` to the controller destructure (line ~14, next to `issueWatchToken, revokeWatchToken, watchHrIngest`):

```js
  issueWatchToken, revokeWatchToken, watchHrIngest, watchStatus,
```

Then register the GET route beside the other watch-token routes (after line ~68, below `router.use(auth)`):

```js
// Garmin watch device-token (sideloaded app HR streaming)
router.post('/watch/token',   issueWatchToken);
router.delete('/watch/token', revokeWatchToken);
router.get('/watch/status',   watchStatus);
```

- [ ] **Step 6: Run the full backend suite to confirm no regressions**

Run (from `backend/`): `npx jest`
Expected: PASS (all existing suites + the new `watchStatus.test.js`).

- [ ] **Step 7: Commit**

```bash
git add backend/app/controllers/integrationsController.js backend/app/routes/integrations.js backend/tests/watchStatus.test.js
git commit -m "feat: add GET watch/status endpoint for connection badge"
```

---

### Task 2: Frontend — `integrationsSlice` watch state + liveness selector

**Files:**
- Modify: `frontend/src/store/slices/integrationsSlice.ts`
- Test: `frontend/src/__tests__/integrationsSlice.watch.test.ts` (create)

**Interfaces:**
- Consumes: nothing new.
- Produces (relied on by Tasks 7, 8):
  - State fields: `watchToken: string | null`, `watchConnected: boolean`, `watchLastSeenAt: string | null`, `watchStatus: 'idle' | 'loading' | 'error'`.
  - Actions: `setWatchToken(token: string | null)`, `setWatchConnection({ connected: boolean; lastSeenAt: string | null })`, `markWatchSeen()`, `clearWatchToken()`, `setWatchStatus('idle'|'loading'|'error')`.
  - Selector: `selectWatchLiveness(state: RootState, now: number): 'connected' | 'offline'`.
  - Constant: `WATCH_STALE_MS` (number).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/__tests__/integrationsSlice.watch.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { RootState } from '../store';
import integrationsReducer, {
  setWatchToken,
  setWatchConnection,
  markWatchSeen,
  clearWatchToken,
  selectWatchLiveness,
  WATCH_STALE_MS,
} from '../store/slices/integrationsSlice';

const base = {
  musicProvider: null,
  biometricProvider: null,
  moodOnly: false,
  status: 'idle' as const,
  watchToken: null,
  watchConnected: false,
  watchLastSeenAt: null,
  watchStatus: 'idle' as const,
};

describe('integrationsSlice — watch', () => {
  it('setWatchToken stores the plaintext token', () => {
    const state = integrationsReducer(base, setWatchToken('whr_abc'));
    expect(state.watchToken).toBe('whr_abc');
  });

  it('setWatchConnection sets connected + lastSeenAt', () => {
    const state = integrationsReducer(base, setWatchConnection({ connected: true, lastSeenAt: '2026-06-24T17:00:00.000Z' }));
    expect(state.watchConnected).toBe(true);
    expect(state.watchLastSeenAt).toBe('2026-06-24T17:00:00.000Z');
  });

  it('markWatchSeen marks connected and stamps lastSeenAt to ~now', () => {
    const before = Date.now();
    const state = integrationsReducer(base, markWatchSeen());
    expect(state.watchConnected).toBe(true);
    expect(Date.parse(state.watchLastSeenAt!)).toBeGreaterThanOrEqual(before);
  });

  it('clearWatchToken resets all watch fields', () => {
    const populated = { ...base, watchToken: 'whr_abc', watchConnected: true, watchLastSeenAt: '2026-06-24T17:00:00.000Z' };
    const state = integrationsReducer(populated, clearWatchToken());
    expect(state.watchToken).toBeNull();
    expect(state.watchConnected).toBe(false);
    expect(state.watchLastSeenAt).toBeNull();
  });

  it('selectWatchLiveness returns "connected" when seen within WATCH_STALE_MS', () => {
    const now = 1_000_000_000_000;
    const rootState = { integrations: { ...base, watchConnected: true, watchLastSeenAt: new Date(now - 60_000).toISOString() } } as unknown as RootState;
    expect(selectWatchLiveness(rootState, now)).toBe('connected');
  });

  it('selectWatchLiveness returns "offline" when last seen exceeds WATCH_STALE_MS', () => {
    const now = 1_000_000_000_000;
    const rootState = { integrations: { ...base, watchConnected: true, watchLastSeenAt: new Date(now - WATCH_STALE_MS - 1000).toISOString() } } as unknown as RootState;
    expect(selectWatchLiveness(rootState, now)).toBe('offline');
  });

  it('selectWatchLiveness returns "offline" when not connected', () => {
    const rootState = { integrations: { ...base } } as unknown as RootState;
    expect(selectWatchLiveness(rootState, Date.now())).toBe('offline');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `frontend/`): `npx vitest run src/__tests__/integrationsSlice.watch.test.ts`
Expected: FAIL — exports `setWatchToken`/`selectWatchLiveness`/`WATCH_STALE_MS` do not exist.

- [ ] **Step 3: Write minimal implementation**

Replace the contents of `frontend/src/store/slices/integrationsSlice.ts` with:

```ts
import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from '../index';

/** Watch is considered live if seen within the 5-min ping cadence + 1-min jitter grace. */
export const WATCH_STALE_MS = 6 * 60 * 1000;

interface IntegrationsState {
  musicProvider: 'spotify' | 'youtube' | null;
  biometricProvider: 'garmin' | 'applehealth' | null;
  /** User opted into the wearable-free "mood only" experience. */
  moodOnly: boolean;
  status: 'idle' | 'loading' | 'error';
  // Watch HR device token (sideloaded Garmin app). watchToken holds the plaintext
  // ONLY in-memory immediately after generation — the backend never returns it again.
  watchToken: string | null;
  watchConnected: boolean;
  watchLastSeenAt: string | null;
  watchStatus: 'idle' | 'loading' | 'error';
}

const initialState: IntegrationsState = {
  musicProvider: null,
  biometricProvider: null,
  moodOnly: false,
  status: 'idle',
  watchToken: null,
  watchConnected: false,
  watchLastSeenAt: null,
  watchStatus: 'idle',
};

const integrationsSlice = createSlice({
  name: 'integrations',
  initialState,
  reducers: {
    setMusicProvider: (state, action: PayloadAction<'spotify' | 'youtube' | null>) => {
      state.musicProvider = action.payload;
    },
    setBiometricProvider: (state, action: PayloadAction<'garmin' | 'applehealth' | null>) => {
      state.biometricProvider = action.payload;
    },
    setMoodOnly: (state, action: PayloadAction<boolean>) => {
      state.moodOnly = action.payload;
    },
    setIntegrationsStatus: (state, action: PayloadAction<'idle' | 'loading' | 'error'>) => {
      state.status = action.payload;
    },
    setWatchToken: (state, action: PayloadAction<string | null>) => {
      state.watchToken = action.payload;
    },
    setWatchConnection: (state, action: PayloadAction<{ connected: boolean; lastSeenAt: string | null }>) => {
      state.watchConnected = action.payload.connected;
      state.watchLastSeenAt = action.payload.lastSeenAt;
    },
    markWatchSeen: (state) => {
      state.watchConnected = true;
      state.watchLastSeenAt = new Date().toISOString();
    },
    setWatchStatus: (state, action: PayloadAction<'idle' | 'loading' | 'error'>) => {
      state.watchStatus = action.payload;
    },
    clearWatchToken: (state) => {
      state.watchToken = null;
      state.watchConnected = false;
      state.watchLastSeenAt = null;
      state.watchStatus = 'idle';
    },
    clearIntegrations: () => initialState,
  },
});

export const {
  setMusicProvider, setBiometricProvider, setMoodOnly, setIntegrationsStatus,
  setWatchToken, setWatchConnection, markWatchSeen, setWatchStatus, clearWatchToken,
  clearIntegrations,
} = integrationsSlice.actions;

// A music source is always required; a wearable is optional when the user
// chooses the "mood only" path.
export const selectIsIntegrationsComplete = (state: RootState) =>
  state.integrations.musicProvider !== null &&
  (state.integrations.biometricProvider !== null || state.integrations.moodOnly === true);

/** 'connected' if the watch is connected AND seen within WATCH_STALE_MS of `now`. */
export const selectWatchLiveness = (state: RootState, now: number): 'connected' | 'offline' => {
  const { watchConnected, watchLastSeenAt } = state.integrations;
  if (!watchConnected || !watchLastSeenAt) return 'offline';
  return now - Date.parse(watchLastSeenAt) <= WATCH_STALE_MS ? 'connected' : 'offline';
};

export default integrationsSlice.reducer;
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `frontend/`): `npx vitest run src/__tests__/integrationsSlice.watch.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Confirm the existing slice test still passes**

Run (from `frontend/`): `npx vitest run src/__tests__/integrationsSlice.test.ts`
Expected: PASS (4 tests — unchanged).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/store/slices/integrationsSlice.ts frontend/src/__tests__/integrationsSlice.watch.test.ts
git commit -m "feat: add watch connection state and liveness selector"
```

---

### Task 3: Frontend — watch API helpers in `lib/api.ts`

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Test: `frontend/src/__tests__/api.watch.test.ts` (create)

**Interfaces:**
- Consumes: existing `authHeaders()`.
- Produces (relied on by Task 8):
  - `issueWatchToken(backendUrl: string): Promise<string>` — POSTs, returns the plaintext token; throws on non-2xx.
  - `revokeWatchToken(backendUrl: string): Promise<void>` — DELETEs; throws on non-2xx.
  - `fetchWatchStatus(backendUrl: string): Promise<{ connected: boolean; lastSeenAt: string | null }>`.
  - (Signatures mirror the existing `buildConnectUrl(backendUrl, path)` convention.)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/__tests__/api.watch.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { issueWatchToken, revokeWatchToken, fetchWatchStatus } from '../lib/api';

const BACKEND = 'http://localhost:5000';

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('watch API helpers', () => {
  it('issueWatchToken POSTs and returns the token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ token: 'whr_abc' }) });
    vi.stubGlobal('fetch', fetchMock);

    const token = await issueWatchToken(BACKEND);

    expect(token).toBe('whr_abc');
    expect(fetchMock).toHaveBeenCalledWith(
      `${BACKEND}/api/integrations/watch/token`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('issueWatchToken throws on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));
    await expect(issueWatchToken(BACKEND)).rejects.toThrow();
  });

  it('revokeWatchToken DELETEs the token route', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: 'Watch disconnected' }) });
    vi.stubGlobal('fetch', fetchMock);

    await revokeWatchToken(BACKEND);

    expect(fetchMock).toHaveBeenCalledWith(
      `${BACKEND}/api/integrations/watch/token`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('fetchWatchStatus returns the parsed status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ connected: true, lastSeenAt: '2026-06-24T17:00:00.000Z' }),
    }));

    const status = await fetchWatchStatus(BACKEND);
    expect(status).toEqual({ connected: true, lastSeenAt: '2026-06-24T17:00:00.000Z' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `frontend/`): `npx vitest run src/__tests__/api.watch.test.ts`
Expected: FAIL — `issueWatchToken` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `frontend/src/lib/api.ts`:

```ts
/** Mint a new watch device token (plaintext returned once). Throws on failure. */
export async function issueWatchToken(backendUrl: string): Promise<string> {
  const res = await fetch(`${backendUrl}/api/integrations/watch/token`, {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`issueWatchToken failed: ${res.status}`);
  const { token } = await res.json();
  return token as string;
}

/** Revoke the current watch device token. Throws on failure. */
export async function revokeWatchToken(backendUrl: string): Promise<void> {
  const res = await fetch(`${backendUrl}/api/integrations/watch/token`, {
    method: 'DELETE',
    credentials: 'include',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`revokeWatchToken failed: ${res.status}`);
}

/** Fetch watch connection status for the badge (hydrate on page load). */
export async function fetchWatchStatus(
  backendUrl: string,
): Promise<{ connected: boolean; lastSeenAt: string | null }> {
  const res = await fetch(`${backendUrl}/api/integrations/watch/status`, {
    credentials: 'include',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`fetchWatchStatus failed: ${res.status}`);
  return res.json();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `frontend/`): `npx vitest run src/__tests__/api.watch.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/__tests__/api.watch.test.ts
git commit -m "feat: add watch token api helpers"
```

---

### Task 4: Frontend — `playerSlice` pending playlist + current track URI

**Files:**
- Modify: `frontend/src/store/slices/playerSlice.ts`
- Test: `frontend/src/__tests__/playerSlice.pending.test.ts` (create)

**Interfaces:**
- Consumes: existing `Track`, `SpotifySDKState`, `setSdkState`.
- Produces (relied on by Tasks 5, 6, 7, 9):
  - State: `pendingPlaylist: Track[]` (default `[]`), `sdkCurrentTrackUri: string | null` (default `null`).
  - `SpotifySDKState` gains optional `currentTrackUri?: string | null`.
  - Actions: `setPendingPlaylist(tracks: Track[])`, `promotePendingPlaylist()`.
  - `setSdkState` now also applies `currentTrackUri` when present.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/__tests__/playerSlice.pending.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import playerReducer, {
  setPendingPlaylist,
  promotePendingPlaylist,
  setSdkState,
} from '../store/slices/playerSlice';

const track = (id: string) => ({ id, title: `T${id}`, artist: `A${id}`, uri: `spotify:track:${id}` });

const base = {
  playlist: [track('1')], offlineBuffer: [track('1')], currentIndex: 0,
  isPlaying: true, isOnline: true, trigger: 'emotion' as const, playbackMode: 'live' as const,
  sdkReady: true, deviceId: 'dev', sdkIsPaused: false, sdkPositionMs: 1000, sdkDurationMs: 200000,
  pendingPlaylist: [], sdkCurrentTrackUri: 'spotify:track:1',
};

describe('playerSlice — pending playlist', () => {
  it('setPendingPlaylist stores tracks without touching the active playlist', () => {
    const next = playerReducer(base as never, setPendingPlaylist([track('9'), track('8')]));
    expect(next.pendingPlaylist).toHaveLength(2);
    expect(next.playlist).toEqual([track('1')]); // unchanged
  });

  it('setPendingPlaylist replaces any existing pending (newest wins)', () => {
    const withPending = { ...base, pendingPlaylist: [track('5')] };
    const next = playerReducer(withPending as never, setPendingPlaylist([track('9')]));
    expect(next.pendingPlaylist).toEqual([track('9')]);
  });

  it('promotePendingPlaylist moves pending to active, resets index, clears pending', () => {
    const withPending = { ...base, currentIndex: 3, pendingPlaylist: [track('9'), track('8')] };
    const next = playerReducer(withPending as never, promotePendingPlaylist());
    expect(next.playlist).toEqual([track('9'), track('8')]);
    expect(next.currentIndex).toBe(0);
    expect(next.offlineBuffer).toEqual([track('9'), track('8')]);
    expect(next.pendingPlaylist).toEqual([]);
  });

  it('promotePendingPlaylist is a no-op when pending is empty', () => {
    const next = playerReducer(base as never, promotePendingPlaylist());
    expect(next.playlist).toEqual([track('1')]);
    expect(next.pendingPlaylist).toEqual([]);
  });

  it('setSdkState applies currentTrackUri', () => {
    const next = playerReducer(base as never, setSdkState({ currentTrackUri: 'spotify:track:2' }));
    expect(next.sdkCurrentTrackUri).toBe('spotify:track:2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `frontend/`): `npx vitest run src/__tests__/playerSlice.pending.test.ts`
Expected: FAIL — `setPendingPlaylist`/`promotePendingPlaylist` not exported.

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/store/slices/playerSlice.ts`:

(a) Add `currentTrackUri` to the `SpotifySDKState` interface:

```ts
export interface SpotifySDKState {
  deviceId?: string | null;
  isReady?: boolean;
  isPaused?: boolean;
  positionMs?: number;
  durationMs?: number;
  currentTrackUri?: string | null;
}
```

(b) Add two fields to the `PlayerState` interface (after `sdkDurationMs: number;`):

```ts
  // "Adjust upcoming queue only" — HR-driven playlists wait here until the
  // current track ends, then usePendingPromotion promotes them.
  pendingPlaylist: Track[];
  sdkCurrentTrackUri: string | null;
```

(c) Add to `initialState` (after `sdkDurationMs: 0,`):

```ts
  pendingPlaylist: [],
  sdkCurrentTrackUri: null,
```

(d) Add two reducers inside `reducers: { ... }` (after `skipTrack`):

```ts
    setPendingPlaylist(state, action: PayloadAction<Track[]>) {
      state.pendingPlaylist = action.payload;
    },
    promotePendingPlaylist(state) {
      if (state.pendingPlaylist.length === 0) return;
      state.playlist = state.pendingPlaylist;
      state.currentIndex = 0;
      state.offlineBuffer = state.pendingPlaylist.slice(0, 10);
      state.sdkPositionMs = 0;
      state.pendingPlaylist = [];
    },
```

(e) In the `setSdkState` reducer, apply `currentTrackUri` (add after the `durationMs` line):

```ts
      if (action.payload.currentTrackUri !== undefined) state.sdkCurrentTrackUri = action.payload.currentTrackUri;
```

(f) Add both new actions to the export list:

```ts
export const {
  setPlaylist, skipTrack, setPlaying, setIsOnline, setPlaybackMode, setSdkState,
  setPendingPlaylist, promotePendingPlaylist,
} = playerSlice.actions;
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `frontend/`): `npx vitest run src/__tests__/playerSlice.pending.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Confirm the existing player slice test still passes**

Run (from `frontend/`): `npx vitest run src/__tests__/playerSlice.test.ts`
Expected: PASS (2 tests — unchanged).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/store/slices/playerSlice.ts frontend/src/__tests__/playerSlice.pending.test.ts
git commit -m "feat: add pendingPlaylist and current track uri to player state"
```

---

### Task 5: Frontend — SDK service emits `currentTrackUri`

**Files:**
- Modify: `frontend/src/services/spotifyPlayer.ts`
- Test: `frontend/src/__tests__/spotifyPlayer.test.ts` (add one test)

**Interfaces:**
- Consumes: `SpotifySDKState.currentTrackUri` (Task 4).
- Produces: on every `player_state_changed`, the service's state callback receives `currentTrackUri` read from `data.track_window.current_track.uri` (or `null` if absent).

- [ ] **Step 1: Write the failing test**

Add this test inside the `describe('SpotifyPlayerService', …)` block in `frontend/src/__tests__/spotifyPlayer.test.ts`:

```ts
  it('emits currentTrackUri from player_state_changed', async () => {
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

    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ currentTrackUri: 'spotify:track:abc' }));
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `frontend/`): `npx vitest run src/__tests__/spotifyPlayer.test.ts -t "currentTrackUri"`
Expected: FAIL — `currentTrackUri` is not present in the emitted patch.

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/services/spotifyPlayer.ts`, update the `player_state_changed` listener (around line 75). Change the destructured type and the `emit` call:

```ts
    this.player.addListener('player_state_changed', (data: unknown) => {
      if (!data) return;
      const s = data as {
        paused: boolean;
        position: number;
        duration: number;
        track_window?: { current_track?: { uri?: string } };
      };
      this.isCurrentlyPaused = s.paused;
      this.currentPositionMs = s.position;
      this.currentDurationMs = s.duration;
      this.emit({
        isPaused: s.paused,
        positionMs: s.position,
        durationMs: s.duration,
        currentTrackUri: s.track_window?.current_track?.uri ?? null,
      });

      if (!s.paused) {
        this.startProgressInterval();
      } else {
        this.stopProgressInterval();
      }
    });
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `frontend/`): `npx vitest run src/__tests__/spotifyPlayer.test.ts`
Expected: PASS (all existing tests + the new one).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/spotifyPlayer.ts frontend/src/__tests__/spotifyPlayer.test.ts
git commit -m "feat: emit current track uri from spotify sdk service"
```

---

### Task 6: Frontend — `receivePlaylist` thunk + wire `useSocket`

**Files:**
- Modify: `frontend/src/store/slices/playerSlice.ts` (add `receivePlaylist` thunk)
- Modify: `frontend/src/hooks/useSocket.ts` (dispatch the thunk + `markWatchSeen`)
- Test: `frontend/src/__tests__/receivePlaylist.test.ts` (create)

**Interfaces:**
- Consumes: `setPlaylist`, `setPlaybackMode`, `setPendingPlaylist` (Task 4); `RootState`, `AppDispatch` (type-only).
- Produces (relied on by Task 7's behavior and used by `useSocket`):
  - `receivePlaylist(payload: { tracks: Track[]; trigger: PlayerState['trigger']; mode?: 'live' | 'export' }): (dispatch, getState) => void`
  - Routing: biometric + actively playing → `setPendingPlaylist`; otherwise → `setPlaylist` + `setPlaybackMode`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/__tests__/receivePlaylist.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import {
  receivePlaylist,
  setPendingPlaylist,
  setPlaylist,
  setPlaybackMode,
} from '../store/slices/playerSlice';

const track = (id: string) => ({ id, title: `T${id}`, artist: `A${id}`, uri: `spotify:track:${id}` });

function run(payload: Parameters<typeof receivePlaylist>[0], playerState: Record<string, unknown>) {
  const dispatch = vi.fn();
  const getState = () => ({ player: playerState }) as never;
  receivePlaylist(payload)(dispatch, getState);
  return dispatch;
}

describe('receivePlaylist thunk', () => {
  it('queues a biometric playlist as pending when actively playing', () => {
    const dispatch = run(
      { tracks: [track('9')], trigger: 'biometric' },
      { playlist: [track('1')], sdkIsPaused: false },
    );
    expect(dispatch).toHaveBeenCalledWith(setPendingPlaylist([track('9')]));
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: setPlaylist.type }));
  });

  it('replaces immediately for a biometric playlist when paused', () => {
    const dispatch = run(
      { tracks: [track('9')], trigger: 'biometric', mode: 'live' },
      { playlist: [track('1')], sdkIsPaused: true },
    );
    expect(dispatch).toHaveBeenCalledWith(setPlaylist({ tracks: [track('9')], trigger: 'biometric' }));
    expect(dispatch).toHaveBeenCalledWith(setPlaybackMode('live'));
  });

  it('replaces immediately for a biometric playlist when nothing is loaded', () => {
    const dispatch = run(
      { tracks: [track('9')], trigger: 'biometric' },
      { playlist: [], sdkIsPaused: false },
    );
    expect(dispatch).toHaveBeenCalledWith(setPlaylist({ tracks: [track('9')], trigger: 'biometric' }));
  });

  it('replaces immediately for an emotion playlist even while actively playing', () => {
    const dispatch = run(
      { tracks: [track('9')], trigger: 'emotion' },
      { playlist: [track('1')], sdkIsPaused: false },
    );
    expect(dispatch).toHaveBeenCalledWith(setPlaylist({ tracks: [track('9')], trigger: 'emotion' }));
    expect(dispatch).not.toHaveBeenCalledWith(setPendingPlaylist([track('9')]));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `frontend/`): `npx vitest run src/__tests__/receivePlaylist.test.ts`
Expected: FAIL — `receivePlaylist` not exported.

- [ ] **Step 3: Write minimal implementation (thunk)**

In `frontend/src/store/slices/playerSlice.ts`:

(a) Add a type-only import at the top (after the existing imports):

```ts
import type { RootState, AppDispatch } from '../index';
```

(b) Add the thunk after the `export const { … } = playerSlice.actions;` line (before `export default`):

```ts
/**
 * Route an incoming playlist. Biometric (watch-HR) playlists defer to the
 * pending queue when a track is actively playing so they never interrupt the
 * current song; everything else replaces playback immediately.
 */
export const receivePlaylist =
  (payload: { tracks: Track[]; trigger: PlayerState['trigger']; mode?: 'live' | 'export' }) =>
  (dispatch: AppDispatch, getState: () => RootState) => {
    const { player } = getState();
    const activelyPlaying = player.playlist.length > 0 && player.sdkIsPaused === false;
    if (payload.trigger === 'biometric' && activelyPlaying) {
      dispatch(setPendingPlaylist(payload.tracks));
    } else {
      dispatch(setPlaylist({ tracks: payload.tracks, trigger: payload.trigger }));
      dispatch(setPlaybackMode(payload.mode ?? 'live'));
    }
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `frontend/`): `npx vitest run src/__tests__/receivePlaylist.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire `useSocket` to use the thunk + mark watch liveness**

In `frontend/src/hooks/useSocket.ts`:

(a) Update the playerSlice import (line 6) to add `receivePlaylist` and drop the now-unused `setPlaybackMode` from this call site (keep `setPlaylist` — still used by the `playlist_error` fallback):

```ts
import { setPlaylist, skipTrack as skipTrackAction, setIsOnline, receivePlaylist } from '../store/slices/playerSlice';
```

(b) Add a `markWatchSeen` import from the integrations slice (new import line):

```ts
import { markWatchSeen } from '../store/slices/integrationsSlice';
```

(c) In the `biometric_ack` handler, mark the watch as seen (add inside the existing throttled block, after `dispatch(setBiometricAck(...))`):

```ts
      dispatch(markWatchSeen());
```

(d) Replace the `playlist_ready` handler (lines ~77-80) with:

```ts
  socket.on('playlist_ready', (data: { tracks: Track[]; trigger: 'emotion' | 'biometric' | 'skip_loop'; mode?: 'live' | 'export' }) => {
    if (data.trigger === 'biometric') dispatch(markWatchSeen());
    dispatch(receivePlaylist({ tracks: data.tracks, trigger: data.trigger, mode: data.mode }));
  });
```

- [ ] **Step 6: Confirm the full frontend suite still passes (no behavior regressions)**

Run (from `frontend/`): `npx vitest run`
Expected: PASS (all suites).

- [ ] **Step 7: Typecheck**

Run (from `frontend/`): `npx tsc -b --noEmit`
Expected: no errors (confirms the dropped `setPlaybackMode` import and thunk types are clean).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/store/slices/playerSlice.ts frontend/src/hooks/useSocket.ts frontend/src/__tests__/receivePlaylist.test.ts
git commit -m "feat: route biometric playlists to pending queue via thunk"
```

---

### Task 7: Frontend — `usePendingPromotion` hook + mount in AppShell

**Files:**
- Create: `frontend/src/hooks/usePendingPromotion.ts`
- Modify: `frontend/src/components/AppShell.tsx` (mount the hook)
- Test: `frontend/src/__tests__/usePendingPromotion.test.tsx` (create)

**Interfaces:**
- Consumes: `player.sdkCurrentTrackUri`, `player.pendingPlaylist` (Task 4); `promotePendingPlaylist` (Task 4).
- Produces:
  - `shouldPromote(prevUri: string | null, currentUri: string | null, pendingCount: number): boolean` — pure, true only on a real track change while pending exists.
  - `usePendingPromotion(): void` — mounts the boundary watcher.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/__tests__/usePendingPromotion.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import playerReducer, { setSdkState, setPendingPlaylist } from '../store/slices/playerSlice';
import { shouldPromote, usePendingPromotion } from '../hooks/usePendingPromotion';

const track = (id: string) => ({ id, title: `T${id}`, artist: `A${id}`, uri: `spotify:track:${id}` });

describe('shouldPromote', () => {
  it('true when the track uri changes and pending exists', () => {
    expect(shouldPromote('spotify:track:1', 'spotify:track:2', 1)).toBe(true);
  });
  it('false when pending is empty', () => {
    expect(shouldPromote('spotify:track:1', 'spotify:track:2', 0)).toBe(false);
  });
  it('false when the uri is unchanged', () => {
    expect(shouldPromote('spotify:track:1', 'spotify:track:1', 1)).toBe(false);
  });
  it('false on the first uri (prev is null) so initial play never promotes', () => {
    expect(shouldPromote(null, 'spotify:track:1', 1)).toBe(false);
  });
});

describe('usePendingPromotion', () => {
  it('promotes the pending playlist when the track changes', () => {
    const store = configureStore({ reducer: { player: playerReducer } });
    const wrapper = ({ children }: { children: React.ReactNode }) => <Provider store={store}>{children}</Provider>;
    renderHook(() => usePendingPromotion(), { wrapper });

    // Establish the current track, then queue a pending playlist.
    act(() => { store.dispatch(setSdkState({ currentTrackUri: 'spotify:track:1' })); });
    act(() => { store.dispatch(setPendingPlaylist([track('9'), track('8')])); });

    // Current track ends → SDK reports the next uri.
    act(() => { store.dispatch(setSdkState({ currentTrackUri: 'spotify:track:2' })); });

    expect(store.getState().player.playlist).toEqual([track('9'), track('8')]);
    expect(store.getState().player.pendingPlaylist).toEqual([]);
  });

  it('does not promote when there is no pending playlist', () => {
    const store = configureStore({ reducer: { player: playerReducer } });
    const wrapper = ({ children }: { children: React.ReactNode }) => <Provider store={store}>{children}</Provider>;
    renderHook(() => usePendingPromotion(), { wrapper });

    act(() => { store.dispatch(setSdkState({ currentTrackUri: 'spotify:track:1' })); });
    act(() => { store.dispatch(setSdkState({ currentTrackUri: 'spotify:track:2' })); });

    expect(store.getState().player.playlist).toEqual([]); // initial empty, untouched
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `frontend/`): `npx vitest run src/__tests__/usePendingPromotion.test.tsx`
Expected: FAIL — module `../hooks/usePendingPromotion` not found.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/hooks/usePendingPromotion.ts`:

```ts
import { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch, RootState } from '../store';
import { promotePendingPlaylist } from '../store/slices/playerSlice';

/** True only when the current track changed to a new one while a pending playlist waits. */
export function shouldPromote(
  prevUri: string | null,
  currentUri: string | null,
  pendingCount: number,
): boolean {
  return pendingCount > 0 && prevUri !== null && currentUri !== null && currentUri !== prevUri;
}

/**
 * Watches the Spotify current-track URI. At the first track boundary after a
 * pending (HR-driven) playlist arrives, promotes it to active — AppShell's play
 * effect then starts it from track 1.
 */
export function usePendingPromotion(): void {
  const dispatch = useDispatch<AppDispatch>();
  const currentUri = useSelector((s: RootState) => s.player.sdkCurrentTrackUri);
  const pendingCount = useSelector((s: RootState) => s.player.pendingPlaylist.length);
  const prevUriRef = useRef<string | null>(null);

  useEffect(() => {
    if (shouldPromote(prevUriRef.current, currentUri, pendingCount)) {
      dispatch(promotePendingPlaylist());
    }
    prevUriRef.current = currentUri;
  }, [currentUri, pendingCount, dispatch]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `frontend/`): `npx vitest run src/__tests__/usePendingPromotion.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Mount the hook in AppShell**

In `frontend/src/components/AppShell.tsx`:

(a) Add the import (after the `useSpotifyPlayer` import, line ~6):

```ts
import { usePendingPromotion } from '@/hooks/usePendingPromotion';
```

(b) Call it alongside the other live-connection hooks (after `useSpotifyPlayer(musicProvider);`, line ~26):

```ts
  usePendingPromotion();
```

- [ ] **Step 6: Confirm full suite + typecheck**

Run (from `frontend/`): `npx vitest run`
Expected: PASS (all suites).
Run (from `frontend/`): `npx tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/hooks/usePendingPromotion.ts frontend/src/components/AppShell.tsx frontend/src/__tests__/usePendingPromotion.test.tsx
git commit -m "feat: promote pending playlist at spotify track boundary"
```

---

### Task 8: Frontend — `WatchTokenCard` component + IntegrationsPage integration

**Files:**
- Create: `frontend/src/components/WatchTokenCard/WatchTokenCard.tsx`
- Create: `frontend/src/components/WatchTokenCard/index.ts`
- Modify: `frontend/src/pages/IntegrationsPage.tsx` (replace the Garmin `ServiceRow` + remove `connectGarmin`; hydrate watch status on mount)
- Test: `frontend/src/__tests__/WatchTokenCard.test.tsx` (create)

**Interfaces:**
- Consumes: `issueWatchToken`, `revokeWatchToken`, `fetchWatchStatus` (Task 3); `setWatchToken`, `setWatchConnection`, `clearWatchToken`, `setWatchStatus`, `selectWatchLiveness` (Task 2).
- Produces: `<WatchTokenCard />` default export — self-contained card managing generate / copy / status / regenerate / disconnect.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/__tests__/WatchTokenCard.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import integrationsReducer from '../store/slices/integrationsSlice';
import WatchTokenCard from '../components/WatchTokenCard';

vi.mock('../lib/api', () => ({
  authHeaders: () => ({}),
  issueWatchToken: vi.fn().mockResolvedValue('whr_generated_token'),
  revokeWatchToken: vi.fn().mockResolvedValue(undefined),
  fetchWatchStatus: vi.fn().mockResolvedValue({ connected: false, lastSeenAt: null }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function buildStore(watchOverrides = {}) {
  return configureStore({
    reducer: { integrations: integrationsReducer },
    preloadedState: {
      integrations: {
        musicProvider: null, biometricProvider: null, moodOnly: false, status: 'idle',
        watchToken: null, watchConnected: false, watchLastSeenAt: null, watchStatus: 'idle',
        ...watchOverrides,
      },
    } as never,
  });
}

describe('WatchTokenCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });

  it('shows a set-up button when not connected', () => {
    render(<Provider store={buildStore()}><WatchTokenCard /></Provider>);
    expect(screen.getByRole('button', { name: /set up watch/i })).toBeInTheDocument();
  });

  it('generates and displays the token after clicking set up', async () => {
    render(<Provider store={buildStore()}><WatchTokenCard /></Provider>);
    fireEvent.click(screen.getByRole('button', { name: /set up watch/i }));
    expect(await screen.findByText('whr_generated_token')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument();
  });

  it('copies the token to the clipboard', async () => {
    render(<Provider store={buildStore({ watchToken: 'whr_generated_token', watchConnected: true })}><WatchTokenCard /></Provider>);
    fireEvent.click(screen.getByRole('button', { name: /copy/i }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('whr_generated_token'));
  });

  it('shows a connected badge plus regenerate and disconnect when connected', () => {
    const now = Date.now();
    render(
      <Provider store={buildStore({ watchConnected: true, watchLastSeenAt: new Date(now - 30_000).toISOString() })}>
        <WatchTokenCard />
      </Provider>,
    );
    expect(screen.getByText(/connected/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /regenerate/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /disconnect/i })).toBeInTheDocument();
  });

  it('revokes the token on disconnect', async () => {
    const api = await import('../lib/api');
    render(<Provider store={buildStore({ watchConnected: true, watchLastSeenAt: new Date().toISOString() })}><WatchTokenCard /></Provider>);
    fireEvent.click(screen.getByRole('button', { name: /disconnect/i }));
    await waitFor(() => expect(api.revokeWatchToken).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `frontend/`): `npx vitest run src/__tests__/WatchTokenCard.test.tsx`
Expected: FAIL — module `../components/WatchTokenCard` not found.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/components/WatchTokenCard/WatchTokenCard.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Copy, HeartPulse, Check } from 'lucide-react';
import { toast } from 'sonner';
import type { AppDispatch, RootState } from '../../store';
import {
  setWatchToken, setWatchConnection, clearWatchToken, setWatchStatus, selectWatchLiveness,
} from '../../store/slices/integrationsSlice';
import { issueWatchToken, revokeWatchToken, fetchWatchStatus } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:5000';

function relativeLastSeen(iso: string | null): string {
  if (!iso) return 'Never seen';
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return mins < 1 ? 'Last seen just now' : `Last seen ${mins}m ago`;
}

export default function WatchTokenCard() {
  const dispatch = useDispatch<AppDispatch>();
  const token = useSelector((s: RootState) => s.integrations.watchToken);
  const connected = useSelector((s: RootState) => s.integrations.watchConnected);
  const lastSeenAt = useSelector((s: RootState) => s.integrations.watchLastSeenAt);
  const status = useSelector((s: RootState) => s.integrations.watchStatus);
  // Re-render every 30s so the relative time + liveness age correctly.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const liveness = useSelector((s: RootState) => selectWatchLiveness(s, now));

  // Hydrate connection status on mount (handles hard refresh).
  useEffect(() => {
    fetchWatchStatus(BACKEND_URL)
      .then((st) => dispatch(setWatchConnection(st)))
      .catch(() => {});
  }, [dispatch]);

  const generate = async () => {
    dispatch(setWatchStatus('loading'));
    try {
      const t = await issueWatchToken(BACKEND_URL);
      dispatch(setWatchToken(t));
      dispatch(setWatchConnection({ connected: true, lastSeenAt: null }));
      dispatch(setWatchStatus('idle'));
    } catch {
      dispatch(setWatchStatus('error'));
      toast.error("Couldn't set up the watch — please try again.");
    }
  };

  const copy = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      toast.success('Token copied. Paste it into the watch app now.');
    } catch {
      toast.error('Copy failed — select and copy the token manually.');
    }
  };

  const disconnect = async () => {
    try {
      await revokeWatchToken(BACKEND_URL);
      dispatch(clearWatchToken());
      toast.success('Watch disconnected.');
    } catch {
      toast.error("Couldn't disconnect — please try again.");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <HeartPulse className="size-4 text-coral" /> Watch heart rate
          <span className="ml-auto">
            {connected ? (
              <Badge className={liveness === 'connected'
                ? 'gap-1 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                : 'gap-1 bg-muted text-muted-foreground'}>
                {liveness === 'connected' ? <><Check className="size-3" /> Connected</> : 'Offline'}
              </Badge>
            ) : (
              <span className="text-xs font-normal text-muted-foreground">Not set up</span>
            )}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!connected && !token && (
          <Button onClick={generate} disabled={status === 'loading'} className="h-10 rounded-full">
            {status === 'loading' ? 'Setting up…' : 'Set up watch'}
          </Button>
        )}

        {token && (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">
              Copy this token now — it won't be shown again. Paste it into the watch app.
            </p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-3 py-2 text-xs">{token}</code>
              <Button onClick={copy} variant="outline" size="sm" className="gap-1 shrink-0" aria-label="Copy token">
                <Copy className="size-3" /> Copy
              </Button>
            </div>
          </div>
        )}

        {connected && (
          <>
            <p className="text-xs text-muted-foreground">{relativeLastSeen(lastSeenAt)}</p>
            <div className="flex gap-2">
              <Button onClick={generate} variant="outline" size="sm" disabled={status === 'loading'}>
                Regenerate
              </Button>
              <Button onClick={disconnect} variant="outline" size="sm" className="text-destructive">
                Disconnect
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
```

Create `frontend/src/components/WatchTokenCard/index.ts`:

```ts
export { default } from './WatchTokenCard';
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `frontend/`): `npx vitest run src/__tests__/WatchTokenCard.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Integrate into IntegrationsPage (replace the Garmin OAuth row)**

In `frontend/src/pages/IntegrationsPage.tsx`:

(a) Add the import (after the other component imports, near line 36):

```ts
import WatchTokenCard from '@/components/WatchTokenCard';
```

(b) Remove the now-defunct `connectGarmin` constant (line ~147):

```ts
  const connectGarmin  = async () => { window.location.href = await buildConnectUrl(BACKEND_URL, '/api/integrations/garmin/connect'); };
```

(c) In the Biometric card body, replace the Garmin `ServiceRow` (line ~239) with the card. Change:

```tsx
              <ServiceRow name="Garmin" connected={biometric === 'garmin'} onConnect={connectGarmin} />
```

to:

```tsx
              <WatchTokenCard />
```

- [ ] **Step 6: Confirm full suite + typecheck + lint**

Run (from `frontend/`): `npx vitest run`
Expected: PASS (all suites).
Run (from `frontend/`): `npx tsc -b --noEmit`
Expected: no errors (note: `buildConnectUrl` is still used by `connectSpotify`, so its import stays).
Run (from `frontend/`): `npx eslint src/components/WatchTokenCard src/pages/IntegrationsPage.tsx`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/WatchTokenCard frontend/src/pages/IntegrationsPage.tsx frontend/src/__tests__/WatchTokenCard.test.tsx
git commit -m "feat: add watch token card to integrations page"
```

---

### Task 9: Frontend — "Mix queued" badge in LivePlayer & NowPlayingPage

**Files:**
- Modify: `frontend/src/components/LivePlayer/LivePlayer.tsx`
- Modify: `frontend/src/pages/NowPlayingPage.tsx`
- Test: `frontend/src/__tests__/LivePlayer.test.tsx` (add 2 tests)

**Interfaces:**
- Consumes: `player.pendingPlaylist` (Task 4).
- Produces: a non-intrusive "New heart-rate mix queued — starts after this track" indicator, shown only when `pendingPlaylist.length > 0`.

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/__tests__/LivePlayer.test.tsx` (the existing `buildStore` spreads `playerOverrides`, so `pendingPlaylist` can be passed through). Add inside the `describe('LivePlayer', …)` block:

```tsx
  it('shows the queued-mix badge when a pending playlist exists', () => {
    render(
      <Provider store={buildStore({ pendingPlaylist: [{ id: 'z', title: 'Z', artist: 'Q', uri: 'spotify:track:z' }] })}>
        <LivePlayer />
      </Provider>,
    );
    expect(screen.getByText(/heart-rate mix queued/i)).toBeInTheDocument();
  });

  it('hides the queued-mix badge when there is no pending playlist', () => {
    render(<Provider store={buildStore({ pendingPlaylist: [] })}><LivePlayer /></Provider>);
    expect(screen.queryByText(/heart-rate mix queued/i)).not.toBeInTheDocument();
  });
```

Note: the existing `buildStore` preloaded `player` state does not include `pendingPlaylist`/`sdkCurrentTrackUri`. Add both to its `preloadedState.player` object (after `sdkDurationMs: 210000,`) so the store shape matches the slice:

```tsx
        pendingPlaylist: [],
        sdkCurrentTrackUri: null,
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `frontend/`): `npx vitest run src/__tests__/LivePlayer.test.tsx -t "queued-mix"`
Expected: FAIL — the badge text is not rendered.

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/components/LivePlayer/LivePlayer.tsx`:

(a) Add `pendingPlaylist` to the destructured selector (line ~10-13):

```tsx
  const {
    playbackMode, playlist, currentIndex, pendingPlaylist,
    sdkIsPaused, sdkPositionMs, sdkDurationMs,
  } = useSelector((s: RootState) => s.player);
```

(b) Add the badge just above the progress bar `<div className="w-full bg-white/10 …">` (line ~53):

```tsx
      {pendingPlaylist.length > 0 && (
        <p className="mb-2 text-xs text-[#e9c46a]">
          ♥ New heart-rate mix queued — starts after this track
        </p>
      )}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `frontend/`): `npx vitest run src/__tests__/LivePlayer.test.tsx`
Expected: PASS (all existing tests + the 2 new ones).

- [ ] **Step 5: Add the same badge to NowPlayingPage**

In `frontend/src/pages/NowPlayingPage.tsx`:

(a) Add `pendingPlaylist` to the destructured `useSelector((s: RootState) => s.player)` (line ~23-26):

```tsx
    playlist, offlineBuffer, currentIndex, isOnline, pendingPlaylist,
    sdkIsPaused, sdkPositionMs, sdkDurationMs,
```

(b) Just above the "Up Next" list (the `upNext` render, near line 50's consumer in JSX), add an indicator. Place it directly before the up-next section markup:

```tsx
      {pendingPlaylist.length > 0 && (
        <p className="mb-3 flex items-center gap-1 text-xs text-coral">
          <Heart className="size-3" /> New heart-rate mix queued — starts after this track
        </p>
      )}
```

(`Heart` is already imported in NowPlayingPage from `lucide-react`.)

- [ ] **Step 6: Confirm full suite + typecheck**

Run (from `frontend/`): `npx vitest run`
Expected: PASS (all suites).
Run (from `frontend/`): `npx tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/LivePlayer/LivePlayer.tsx frontend/src/pages/NowPlayingPage.tsx frontend/src/__tests__/LivePlayer.test.tsx
git commit -m "feat: show queued heart-rate mix indicator"
```

---

### Task 10: Final integration verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full frontend suite**

Run (from `frontend/`): `npx vitest run`
Expected: PASS — all suites green (new: integrationsSlice.watch, api.watch, playerSlice.pending, receivePlaylist, usePendingPromotion, WatchTokenCard; updated: spotifyPlayer, LivePlayer).

- [ ] **Step 2: Run the full backend suite**

Run (from `backend/`): `npx jest`
Expected: PASS — all suites incl. `watchStatus.test.js`.

- [ ] **Step 3: Typecheck + lint the frontend**

Run (from `frontend/`): `npx tsc -b --noEmit`
Expected: no errors.
Run (from `frontend/`): `npx eslint .`
Expected: no errors.

- [ ] **Step 4: Manual smoke checklist (document results in the PR description)**

Verify end-to-end against a running backend + Spotify session:
1. IntegrationsPage → "Set up watch" shows a `whr_…` token + Copy works; badge becomes "Connected".
2. Reload the page → badge hydrates from `GET /watch/status` (Connected/Offline + "Last seen Xm ago"); token is NOT re-shown.
3. With a track actively playing, simulate a watch HR POST (≥25 bpm delta) → playback does NOT interrupt; the "queued mix" badge appears.
4. Current track ends (or skip) → the queued mix starts from its first track; badge clears.
5. With playback paused/empty, an HR ping starts music immediately (no queueing).
6. A mood (emotion) change still replaces playback immediately.
7. Regenerate invalidates the old token; Disconnect clears the badge.

- [ ] **Step 5: No commit** (verification only). If any check fails, return to the owning task.

---

## Self-Review

**Spec coverage:**
- Backend `GET /watch/status` → Task 1. ✓
- `integrationsSlice` watch state + `selectWatchLiveness` (WATCH_STALE_MS) → Task 2. ✓
- API helpers (`issueWatchToken`/`revokeWatchToken`/`fetchWatchStatus`) → Task 3. ✓
- `playerSlice` `pendingPlaylist` + `promotePendingPlaylist` + `sdkCurrentTrackUri` → Task 4. ✓
- SDK service emits `currentTrackUri` → Task 5. ✓
- `useSocket` routing (biometric→pending when playing, immediate otherwise) + `markWatchSeen` → Task 6. ✓
- Boundary promotion (`usePendingPromotion`, track-change detection) → Task 7. ✓
- `WatchTokenCard` on IntegrationsPage (generate/copy once/regenerate/revoke/badge + hydrate on mount) → Task 8. ✓
- "Mix queued" badge → Task 9. ✓
- Known limitations documented in spec; verification covers the blip, token-once, paused/empty fallthrough. ✓

**Type consistency:** `setPendingPlaylist`/`promotePendingPlaylist`/`receivePlaylist`/`setSdkState({currentTrackUri})`/`selectWatchLiveness(state, now)`/`shouldPromote(prev, current, count)`/`fetchWatchStatus → {connected, lastSeenAt}` are used identically across Tasks 4–9. ✓

**Placeholder scan:** every code/step contains complete code and exact commands; no TBD/TODO. ✓
