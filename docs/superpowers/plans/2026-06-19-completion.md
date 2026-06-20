# Kokonada Completion Plan — All Remaining Gaps

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every remaining gap in Kokonada: Apple + Facebook SSO frontend, AI timeout with static fallback, Web Audio crossfade engine, and offline track buffer with exponential backoff reconnect.

**Architecture:** Four independent subsystems. (1) Apple/Facebook SSO: both backend handlers (`appleAuth`, `facebookAuth`) already exist in `authController.js`; this wires the frontend buttons that are currently `disabled title="Coming soon"`. (2) AI fallback: add `generateFallbackPlaylist()` to `playlistMixer.js`, a `Promise.race` timeout wrapper inside `geminiEngine.js`, and populate `fallbackTracks` in `biometricHandler.js`'s error path. (3) Web Audio: new singleton `audioPlayer.ts` manages two GainNodes for 2-second crossfade and pre-schedules 150ms ahead to absorb Bluetooth codec latency. (4) Offline buffer: two new fields in `playerSlice.ts` plus `window` online/offline events and an exponential-backoff reconnect loop in `useSocket.ts`.

**Tech Stack:**
- Frontend: React 19, Redux Toolkit, TypeScript 5.8, Vite, Web Audio API (built-in browser)
- Backend: Node.js/Express 5, Socket.io, `@google/generative-ai`, Jest
- Apple Sign In JS SDK — CDN, no npm package needed
- Facebook JS SDK — CDN, no npm package needed

## Global Constraints

- No new npm packages — Web Audio API is built-in; Apple/FB SDKs load from CDN at runtime; all backend deps already installed
- TypeScript strict mode — every new `.ts`/`.tsx` file must pass `cd frontend && npx tsc -b --noEmit` with zero errors
- All backend changes must keep `npm test --prefix backend` green
- Never log or forward user PII; anonymise before any external call
- Commit after each task using short single-line messages (no body, no trailers)

---

## File Map

**Created:**
- `frontend/src/services/audioPlayer.ts` — Web Audio crossfade singleton

**Modified:**
- `frontend/src/pages/LoginPage.tsx` — Apple + Facebook SSO flows (buttons currently `disabled`)
- `frontend/src/pages/LoginPage.css` — Apple + Facebook brand border colours
- `frontend/src/store/slices/playerSlice.ts` — add `offlineBuffer: Track[]`, `isOnline: boolean`, actions
- `frontend/src/hooks/useSocket.ts` — `playlist_ready` dispatch, online/offline events, exponential backoff
- `frontend/src/components/PlaylistView/PlaylistView.tsx` — wire AudioPlayerService + offline indicator
- `frontend/src/components/PlaylistView/PlaylistView.css` — offline banner style
- `backend/app/services/playlistMixer.js` — add `generateFallbackPlaylist()`
- `backend/app/services/geminiEngine.js` — add `_withTimeout()` race wrapper
- `backend/app/sockets/biometricHandler.js` — populate `fallbackTracks` on error

**Created (tests):**
- `backend/tests/playlistMixer.fallback.test.js`
- `backend/tests/geminiEngine.timeout.test.js`

---

### Task 1: Apple SSO Frontend

**Files:**
- Modify: `frontend/src/pages/LoginPage.tsx`
- Modify: `frontend/src/pages/LoginPage.css`

**Interfaces:**
- Consumes: `POST /api/auth/apple` body `{ identityToken: string }` → `{ id, displayName, avatarUrl, email, wearableProvider }`
- Consumes: Apple Sign In JS SDK from `https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js`
- Produces: `dispatch(setUser(data))` + `dispatch(setAuthStatus('authenticated'))` — identical to Google flow

- [ ] **Step 1: Baseline — note current disabled state**

Run `cd frontend && npm run dev` and open `http://localhost:5173`. Confirm "Continue with Apple" is disabled (`opacity: 0.4`, title="Coming soon"). Stop the dev server. This is the before state.

- [ ] **Step 2: Replace LoginPage.tsx with Apple SSO wired**

Write the full updated file to `frontend/src/pages/LoginPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';
import type { AppDispatch } from '../store';
import { setUser, setAuthStatus } from '../store/slices/authSlice';
import './LoginPage.css';

declare const google: {
  accounts: { id: { initialize(cfg: object): void; prompt(): void } };
};

declare const AppleID: {
  auth: {
    init(cfg: object): void;
    signIn(): Promise<{ authorization: { id_token: string } }>;
  };
};

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:5000';

export default function LoginPage() {
  const dispatch = useDispatch<AppDispatch>();
  const [error, setError] = useState<string | null>(null);
  const [isGsiReady, setIsGsiReady] = useState(false);
  const [isAppleReady, setIsAppleReady] = useState(false);

  useEffect(() => {
    // Google GSI
    const gScript = document.createElement('script');
    gScript.src = 'https://accounts.google.com/gsi/client';
    gScript.async = true;
    gScript.onload = () => {
      google.accounts.id.initialize({
        client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
        callback: async ({ credential }: { credential: string }) => {
          try {
            const res = await fetch(`${BACKEND_URL}/api/auth/google`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ idToken: credential }),
            });
            if (!res.ok) throw new Error('auth failed');
            const data = await res.json();
            dispatch(setUser(data));
            dispatch(setAuthStatus('authenticated'));
          } catch {
            setError('Google login failed — please try again.');
          }
        },
      });
      setIsGsiReady(true);
    };
    document.body.appendChild(gScript);

    // Apple Sign In SDK
    const aScript = document.createElement('script');
    aScript.src = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';
    aScript.async = true;
    aScript.onload = () => {
      AppleID.auth.init({
        clientId: import.meta.env.VITE_APPLE_CLIENT_ID,
        scope: 'name email',
        redirectURI: import.meta.env.VITE_APPLE_REDIRECT_URI,
        usePopup: true,
      });
      setIsAppleReady(true);
    };
    document.body.appendChild(aScript);

    return () => {
      document.body.removeChild(gScript);
      document.body.removeChild(aScript);
    };
  }, [dispatch]);

  const handleGoogleClick = () => {
    setError(null);
    google.accounts.id.prompt();
  };

  const handleAppleClick = async () => {
    setError(null);
    try {
      const data = await AppleID.auth.signIn();
      const res = await fetch(`${BACKEND_URL}/api/auth/apple`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ identityToken: data.authorization.id_token }),
      });
      if (!res.ok) throw new Error('auth failed');
      const user = await res.json();
      dispatch(setUser(user));
      dispatch(setAuthStatus('authenticated'));
    } catch {
      setError('Apple login failed — please try again.');
    }
  };

  return (
    <div className="login-root">
      <div className="login-card">
        <h1 className="login-title">Kokonada</h1>
        <p className="login-tagline">Your music, tuned to your body.</p>
        <div className="sso-buttons">
          <button
            className="sso-btn sso-btn--google"
            onClick={handleGoogleClick}
            disabled={!isGsiReady}
            title={!isGsiReady ? 'Loading Google Sign-In…' : undefined}
          >
            Continue with Google
          </button>
          <button
            className="sso-btn sso-btn--apple"
            onClick={handleAppleClick}
            disabled={!isAppleReady}
            title={!isAppleReady ? 'Loading Apple Sign-In…' : undefined}
          >
            Continue with Apple
          </button>
          <button className="sso-btn" disabled title="Coming soon">
            Continue with Facebook
          </button>
        </div>
        {error && <p className="login-error">{error}</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add Apple brand colour to LoginPage.css**

Append to `frontend/src/pages/LoginPage.css`:

```css
.sso-btn--apple {
  border-color: #ffffff;
}
```

- [ ] **Step 4: Add Apple env vars to frontend .env.example**

Create `frontend/.env.example` (or append if it exists):

```
VITE_GOOGLE_CLIENT_ID=your_google_client_id
VITE_APPLE_CLIENT_ID=com.yourapp.web
VITE_APPLE_REDIRECT_URI=https://yourapp.com/auth/apple/callback
VITE_BACKEND_URL=http://localhost:5000
```

- [ ] **Step 5: Verify TypeScript**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: exits 0, zero errors

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/LoginPage.tsx frontend/src/pages/LoginPage.css
git commit -m "feat: wire Apple SSO frontend to existing backend handler"
```

---

### Task 2: Facebook SSO Frontend

**Files:**
- Modify: `frontend/src/pages/LoginPage.tsx`
- Modify: `frontend/src/pages/LoginPage.css`

**Interfaces:**
- Consumes: `POST /api/auth/facebook` body `{ accessToken: string }` → `{ id, displayName, avatarUrl, email, wearableProvider }`
- Consumes: Facebook JS SDK from `https://connect.facebook.net/en_US/sdk.js`
- Produces: `dispatch(setUser(data))` + `dispatch(setAuthStatus('authenticated'))`

- [ ] **Step 1: Add FB SDK type declaration**

At the top of `frontend/src/pages/LoginPage.tsx`, after the `AppleID` declare block, add:

```tsx
declare const FB: {
  init(cfg: object): void;
  login(
    callback: (response: { authResponse?: { accessToken: string } }) => void,
    opts: { scope: string }
  ): void;
};
```

- [ ] **Step 2: Add FB state and SDK load in useEffect**

Add `const [isFbReady, setIsFbReady] = useState(false);` alongside the other state declarations.

In the `useEffect`, after the Apple script block and before `return () => {`, add:

```tsx
    // Facebook SDK
    const fbScript = document.createElement('script');
    fbScript.src = 'https://connect.facebook.net/en_US/sdk.js';
    fbScript.async = true;
    fbScript.onload = () => {
      FB.init({
        appId: import.meta.env.VITE_FACEBOOK_APP_ID,
        version: 'v19.0',
      });
      setIsFbReady(true);
    };
    document.body.appendChild(fbScript);
```

Update the cleanup `return` to also remove `fbScript`:

```tsx
    return () => {
      document.body.removeChild(gScript);
      document.body.removeChild(aScript);
      document.body.removeChild(fbScript);
    };
```

- [ ] **Step 3: Add handleFacebookClick handler**

After `handleAppleClick`, add:

```tsx
  const handleFacebookClick = () => {
    setError(null);
    FB.login(async (response) => {
      if (!response.authResponse) {
        setError('Facebook login cancelled.');
        return;
      }
      try {
        const res = await fetch(`${BACKEND_URL}/api/auth/facebook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ accessToken: response.authResponse.accessToken }),
        });
        if (!res.ok) throw new Error('auth failed');
        const data = await res.json();
        dispatch(setUser(data));
        dispatch(setAuthStatus('authenticated'));
      } catch {
        setError('Facebook login failed — please try again.');
      }
    }, { scope: 'public_profile,email' });
  };
```

- [ ] **Step 4: Enable Facebook button in JSX**

Replace:
```tsx
          <button className="sso-btn" disabled title="Coming soon">
            Continue with Facebook
          </button>
```
With:
```tsx
          <button
            className="sso-btn sso-btn--facebook"
            onClick={handleFacebookClick}
            disabled={!isFbReady}
            title={!isFbReady ? 'Loading Facebook Sign-In…' : undefined}
          >
            Continue with Facebook
          </button>
```

- [ ] **Step 5: Add Facebook brand colour to LoginPage.css**

Append to `frontend/src/pages/LoginPage.css`:

```css
.sso-btn--facebook {
  border-color: #1877f2;
}
```

- [ ] **Step 6: Add FB env var to .env.example**

Append to `frontend/.env.example`:

```
VITE_FACEBOOK_APP_ID=your_facebook_app_id
```

- [ ] **Step 7: Verify TypeScript**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: exits 0, zero errors

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/LoginPage.tsx frontend/src/pages/LoginPage.css frontend/.env.example
git commit -m "feat: wire Facebook SSO frontend to existing backend handler"
```

---

### Task 3: AI Timeout + Static Playlist Fallback

**Files:**
- Modify: `backend/app/services/playlistMixer.js` — add `generateFallbackPlaylist(musicProfile, n?)`
- Modify: `backend/app/services/geminiEngine.js` — add `_withTimeout(ms, promise)` and wrap both Gemini calls
- Modify: `backend/app/sockets/biometricHandler.js` — import `generateFallbackPlaylist`, populate `fallbackTracks` in catch
- Create: `backend/tests/playlistMixer.fallback.test.js`
- Create: `backend/tests/geminiEngine.timeout.test.js`

**Interfaces:**
- `generateFallbackPlaylist(musicProfile: { library?: Track[] }, n?: number): Track[]` — exported from `playlistMixer.js`; returns top N library tracks sorted by `listenCount` descending, no AI
- `_withTimeout(ms: number, promise: Promise<T>): Promise<T>` — internal to `geminiEngine.js`; rejects with `Error('Gemini timeout after Xms')` if promise doesn't resolve within `ms`
- `biometricHandler.js` error path: `socket.emit('playlist_error', { message, fallbackTracks?: Track[] })`

- [ ] **Step 1: Write the failing test for generateFallbackPlaylist**

Create `backend/tests/playlistMixer.fallback.test.js`:

```js
'use strict';

const { generateFallbackPlaylist } = require('../app/services/playlistMixer');

describe('generateFallbackPlaylist', () => {
  const library = Array.from({ length: 15 }, (_, i) => ({
    id: `track-${i}`,
    title: `Track ${i}`,
    artist: `Artist ${i}`,
    uri: `spotify:track:${i}`,
    tempo: 120 + i,
    energy: 0.5,
    listenCount: i,
  }));

  it('returns up to 10 tracks sorted by listenCount desc', () => {
    const result = generateFallbackPlaylist({ library });
    expect(result).toHaveLength(10);
    expect(result[0].id).toBe('track-14');
    expect(result[9].id).toBe('track-5');
  });

  it('returns all tracks when library has fewer than 10', () => {
    const result = generateFallbackPlaylist({ library: library.slice(0, 3) });
    expect(result).toHaveLength(3);
  });

  it('returns empty array for empty library', () => {
    expect(generateFallbackPlaylist({ library: [] })).toEqual([]);
  });

  it('handles tracks without listenCount (treats as 0)', () => {
    const noCount = [{ id: 'a', title: 'A', artist: 'B', uri: 'spotify:track:a', tempo: 120, energy: 0.5 }];
    expect(generateFallbackPlaylist({ library: noCount })).toHaveLength(1);
  });

  it('returns empty array when musicProfile is empty object', () => {
    expect(generateFallbackPlaylist({})).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

Run: `npm test --prefix backend -- --testPathPattern=playlistMixer.fallback`
Expected: FAIL — `generateFallbackPlaylist is not a function`

- [ ] **Step 3: Add generateFallbackPlaylist to playlistMixer.js**

Open `backend/app/services/playlistMixer.js`. Find the `module.exports` line at the bottom. Before it, add:

```js
/**
 * Emergency fallback — no AI. Returns the user's top N most-listened tracks.
 * @param {{ library?: Array<{ listenCount?: number }> }} musicProfile
 * @param {number} [n=10]
 * @returns {Array}
 */
function generateFallbackPlaylist(musicProfile, n = 10) {
  const lib = musicProfile?.library ?? [];
  return [...lib]
    .sort((a, b) => (b.listenCount ?? 0) - (a.listenCount ?? 0))
    .slice(0, n);
}
```

Update `module.exports` to include `generateFallbackPlaylist`:

```js
module.exports = { mixPlaylist, generateFallbackPlaylist };
```

- [ ] **Step 4: Run test to confirm it passes**

Run: `npm test --prefix backend -- --testPathPattern=playlistMixer.fallback`
Expected: PASS — 5 tests pass

- [ ] **Step 5: Write the failing test for geminiEngine timeout**

Create `backend/tests/geminiEngine.timeout.test.js`:

```js
'use strict';

jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({
      generateContent: jest.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 20_000))
      ),
    }),
  })),
}));

process.env.GEMINI_API_KEY = 'a'.repeat(39);
process.env.ENCRYPTION_KEY = 'a'.repeat(64);

const { buildEmotionPlaylist } = require('../app/services/geminiEngine');

describe('geminiEngine timeout', () => {
  it('rejects with a timeout error when Gemini takes longer than 5s', async () => {
    const profile = {
      topGenres: ['pop'],
      tempoBaseline: 120,
      energy: 0.6,
      valence: 0.7,
      acousticness: 0.3,
      library: [],
    };
    await expect(
      buildEmotionPlaylist({
        musicProfile: profile,
        emotionTaps: [{ x: 0.5, y: 0.5 }],
        fetchTracks: async () => [],
      })
    ).rejects.toThrow(/timeout/i);
  }, 8_000);
});
```

- [ ] **Step 6: Run test to confirm it fails**

Run: `npm test --prefix backend -- --testPathPattern=geminiEngine.timeout`
Expected: FAIL — test times out waiting for a rejection that never comes

- [ ] **Step 7: Add _withTimeout to geminiEngine.js**

Open `backend/app/services/geminiEngine.js`. After the `REQUIRED_FIELDS` array declaration add:

```js
const GEMINI_TIMEOUT_MS = 5_000;

function _withTimeout(ms, promise) {
  const timer = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Gemini timeout after ${ms}ms`)), ms)
  );
  return Promise.race([promise, timer]);
}
```

In `buildEmotionPlaylist`, find the line that calls `model.generateContent(...)`. Wrap it:

```js
const result = await _withTimeout(GEMINI_TIMEOUT_MS, model.generateContent(prompt));
```

In `adjustBiometricPlaylist`, find and wrap its `model.generateContent(...)` call the same way:

```js
const result = await _withTimeout(GEMINI_TIMEOUT_MS, model.generateContent(prompt));
```

- [ ] **Step 8: Run test to confirm it passes**

Run: `npm test --prefix backend -- --testPathPattern=geminiEngine.timeout`
Expected: PASS — 1 test passes within ~6 seconds

- [ ] **Step 9: Populate fallbackTracks in biometricHandler.js**

Open `backend/app/sockets/biometricHandler.js`. Find the import that brings in `mixPlaylist` from `playlistMixer`:

```js
const { mixPlaylist } = require('../services/playlistMixer');
```

Replace with:

```js
const { mixPlaylist, generateFallbackPlaylist } = require('../services/playlistMixer');
```

Find the `catch` block inside `generateAndEmitPlaylist` where `playlist_error` is emitted. It currently looks like:

```js
  } catch (err) {
    socket.emit('playlist_error', { message: err.message });
  }
```

Replace with:

```js
  } catch (err) {
    const fallbackTracks = generateFallbackPlaylist(state.musicProfile ?? {});
    socket.emit('playlist_error', {
      message: err.message,
      fallbackTracks: fallbackTracks.length > 0 ? fallbackTracks : undefined,
    });
  }
```

- [ ] **Step 10: Verify all backend tests pass**

Run: `npm test --prefix backend`
Expected: all tests pass (green)

- [ ] **Step 11: Commit**

```bash
git add backend/app/services/playlistMixer.js backend/app/services/geminiEngine.js backend/app/sockets/biometricHandler.js backend/tests/playlistMixer.fallback.test.js backend/tests/geminiEngine.timeout.test.js
git commit -m "feat: add 5s Gemini timeout race and static fallback playlist on AI failure"
```

---

### Task 4: Web Audio Crossfade Engine

**Files:**
- Create: `frontend/src/services/audioPlayer.ts`
- Modify: `frontend/src/components/PlaylistView/PlaylistView.tsx`
- Modify: `frontend/src/components/PlaylistView/PlaylistView.css`

**Interfaces:**
- `AudioPlayerService.getInstance(): AudioPlayerService` — module-level singleton, safe to call from any component
- `play(uri: string): Promise<void>` — resumes AudioContext, fetches + decodes audio from URI, starts immediately with 150ms BT pre-buffer
- `crossfadeTo(nextUri: string, durationMs?: number): Promise<void>` — fades current gain node from 1→0 and next from 0→1 over `durationMs` (default 2000ms); starts next source 150ms ahead to absorb BT latency
- `stop(): void` — sets gain to 0, stops current source

- [ ] **Step 1: Create audioPlayer.ts**

Create `frontend/src/services/audioPlayer.ts`:

```ts
const CROSSFADE_MS = 2_000;
const BLUETOOTH_BUFFER_MS = 150;

export class AudioPlayerService {
  private static instance: AudioPlayerService;
  private ctx: AudioContext | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private currentGain: GainNode | null = null;

  static getInstance(): AudioPlayerService {
    if (!AudioPlayerService.instance) {
      AudioPlayerService.instance = new AudioPlayerService();
    }
    return AudioPlayerService.instance;
  }

  private getContext(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') {
      this.ctx = new AudioContext();
    }
    return this.ctx;
  }

  private async fetchBuffer(uri: string): Promise<AudioBuffer> {
    const ctx = this.getContext();
    const res = await fetch(uri);
    if (!res.ok) throw new Error(`Audio fetch failed: ${res.status}`);
    const raw = await res.arrayBuffer();
    return ctx.decodeAudioData(raw);
  }

  async play(uri: string): Promise<void> {
    const ctx = this.getContext();
    if (ctx.state === 'suspended') await ctx.resume();

    const buffer = await this.fetchBuffer(uri);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(1, ctx.currentTime);
    gain.connect(ctx.destination);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    source.start(ctx.currentTime + BLUETOOTH_BUFFER_MS / 1000);

    this.currentSource = source;
    this.currentGain = gain;
  }

  async crossfadeTo(nextUri: string, durationMs: number = CROSSFADE_MS): Promise<void> {
    const ctx = this.getContext();
    if (ctx.state === 'suspended') await ctx.resume();

    const durationSec = durationMs / 1000;
    const startAt = ctx.currentTime + BLUETOOTH_BUFFER_MS / 1000;

    if (this.currentGain && this.currentSource) {
      this.currentGain.gain.setValueAtTime(this.currentGain.gain.value, ctx.currentTime);
      this.currentGain.gain.linearRampToValueAtTime(0, startAt + durationSec);
      const dyingSource = this.currentSource;
      setTimeout(
        () => { try { dyingSource.stop(); } catch { /* already ended */ } },
        BLUETOOTH_BUFFER_MS + durationMs + 200
      );
    }

    const buffer = await this.fetchBuffer(nextUri);
    const nextGain = ctx.createGain();
    nextGain.gain.setValueAtTime(0, ctx.currentTime);
    nextGain.gain.linearRampToValueAtTime(1, startAt + durationSec);
    nextGain.connect(ctx.destination);

    const nextSource = ctx.createBufferSource();
    nextSource.buffer = buffer;
    nextSource.connect(nextGain);
    nextSource.start(startAt);

    this.currentSource = nextSource;
    this.currentGain = nextGain;
  }

  stop(): void {
    if (this.currentGain) {
      this.currentGain.gain.setValueAtTime(0, this.getContext().currentTime);
    }
    try { this.currentSource?.stop(); } catch { /* already stopped */ }
    this.currentSource = null;
    this.currentGain = null;
  }
}
```

- [ ] **Step 2: Replace PlaylistView.tsx to wire AudioPlayerService**

Note: this also consumes `isOnline` and `offlineBuffer` from `playerSlice` — those fields are added in Task 5. Write this file now; it will TypeScript-error until Task 5 runs. If you are executing tasks in order, proceed. If running tasks in parallel, do Task 5 first.

Write `frontend/src/components/PlaylistView/PlaylistView.tsx`:

```tsx
import { useSelector } from 'react-redux';
import type { RootState } from '../../store';
import { useSocket } from '../../hooks/useSocket';
import { AudioPlayerService } from '../../services/audioPlayer';
import './PlaylistView.css';

export default function PlaylistView() {
  const playlist = useSelector((state: RootState) => state.player.playlist);
  const offlineBuffer = useSelector((state: RootState) => state.player.offlineBuffer);
  const currentIndex = useSelector((state: RootState) => state.player.currentIndex);
  const isPlaying = useSelector((state: RootState) => state.player.isPlaying);
  const isOnline = useSelector((state: RootState) => state.player.isOnline);
  const { skipTrack } = useSocket();
  const player = AudioPlayerService.getInstance();

  const displayList = isOnline ? playlist : offlineBuffer;
  const current = displayList[currentIndex] ?? null;

  const handlePlay = async () => {
    if (current?.uri) {
      await player.play(current.uri);
    }
  };

  const handleSkip = async () => {
    if (displayList.length < 2) return;
    const nextIndex = (currentIndex + 1) % displayList.length;
    const nextTrack = displayList[nextIndex];
    if (nextTrack?.uri) {
      await player.crossfadeTo(nextTrack.uri);
    }
    skipTrack();
  };

  if (displayList.length === 0) {
    return (
      <div className="playlist-view playlist-view--empty">
        {!isOnline ? (
          <p>Offline — no buffered tracks available.</p>
        ) : (
          <p>Set your emotion and hit Generate Playlist to start.</p>
        )}
      </div>
    );
  }

  return (
    <div className="playlist-view">
      {!isOnline && (
        <div className="playlist-view__offline-banner">Offline — playing buffered tracks</div>
      )}
      <ul className="playlist-view__list">
        {displayList.map((track, i) => (
          <li
            key={track.id}
            className={`playlist-view__track${i === currentIndex ? ' playlist-view__track--current' : ''}`}
          >
            <span className="playlist-view__title">{track.title}</span>
            <span className="playlist-view__artist"> — {track.artist}</span>
          </li>
        ))}
      </ul>
      {current && (
        <div className="playlist-view__controls">
          <button className="playlist-view__btn" onClick={handlePlay} disabled={isPlaying}>
            {isPlaying ? 'Playing' : 'Play'}
          </button>
          <button className="playlist-view__btn" onClick={handleSkip} disabled={displayList.length < 2}>
            Skip
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add offline banner CSS to PlaylistView.css**

Append to `frontend/src/components/PlaylistView/PlaylistView.css`:

```css
.playlist-view__offline-banner {
  background: #e63946;
  color: #fff;
  text-align: center;
  padding: 0.4rem 0.75rem;
  border-radius: 4px;
  font-size: 0.8rem;
  margin-bottom: 0.75rem;
}
```

- [ ] **Step 4: Verify TypeScript (run after Task 5 is also done)**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: exits 0 once `playerSlice.ts` has `offlineBuffer` and `isOnline` (Task 5)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/audioPlayer.ts frontend/src/components/PlaylistView/
git commit -m "feat: add Web Audio crossfade engine with 150ms Bluetooth pre-buffer"
```

---

### Task 5: Offline Buffer + Exponential Backoff Reconnect

**Files:**
- Modify: `frontend/src/store/slices/playerSlice.ts`
- Modify: `frontend/src/hooks/useSocket.ts`

**Interfaces:**
- New `playerSlice` fields: `offlineBuffer: Track[]` (up to 10 tracks), `isOnline: boolean` (seeded from `navigator.onLine`)
- New `playerSlice` actions: `setOfflineBuffer(Track[])`, `setIsOnline(boolean)`
- `setPlaylist` now also sets `offlineBuffer` to the first 10 tracks of the new playlist
- `skipTrack` now advances within `offlineBuffer` when `isOnline` is false
- `useSocket` additions: listens to `window` `online`/`offline` events; dispatches `setIsOnline`; exponential backoff reconnect (1→2→4→8→16s, max 5 retries) on `disconnect`/`connect_error`; dispatches `setPlaylist` on `playlist_ready`

- [ ] **Step 1: Replace playerSlice.ts**

Write `frontend/src/store/slices/playerSlice.ts`:

```ts
import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface Track {
  id: string;
  title: string;
  artist: string;
  uri: string;
}

interface PlayerState {
  playlist: Track[];
  offlineBuffer: Track[];
  currentIndex: number;
  isPlaying: boolean;
  isOnline: boolean;
  trigger: 'emotion' | 'biometric' | 'skip_loop' | null;
}

const initialState: PlayerState = {
  playlist: [],
  offlineBuffer: [],
  currentIndex: 0,
  isPlaying: false,
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  trigger: null,
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
    },
    skipTrack(state) {
      const list = state.isOnline ? state.playlist : state.offlineBuffer;
      if (list.length === 0) return;
      state.currentIndex = (state.currentIndex + 1) % list.length;
    },
    setPlaying(state, action: PayloadAction<boolean>) {
      state.isPlaying = action.payload;
    },
    setOfflineBuffer(state, action: PayloadAction<Track[]>) {
      state.offlineBuffer = action.payload;
    },
    setIsOnline(state, action: PayloadAction<boolean>) {
      state.isOnline = action.payload;
    },
  },
});

export const { setPlaylist, skipTrack, setPlaying, setOfflineBuffer, setIsOnline } = playerSlice.actions;
export default playerSlice.reducer;
```

- [ ] **Step 2: Replace useSocket.ts**

Write `frontend/src/hooks/useSocket.ts`:

```ts
import { useEffect, useRef } from 'react';
import { useDispatch } from 'react-redux';
import { io, Socket } from 'socket.io-client';
import type { AppDispatch } from '../store';
import { setPlaylist, skipTrack as skipTrackAction, setIsOnline } from '../store/slices/playerSlice';
import {
  setBiometricAck,
  setRecalibrationPending,
  setRecalibrationCancelled,
  setRecalibrating,
} from '../store/slices/biometricsSlice';

export interface EmotionTap {
  x: number;
  y: number;
}

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:5000';
const MAX_RETRIES = 5;

let socket: Socket | null = null;
let retryCount = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function clearRetryTimer() {
  if (retryTimer !== null) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function scheduleReconnect() {
  if (!socket || retryCount >= MAX_RETRIES) return;
  const delay = Math.min(1_000 * Math.pow(2, retryCount), 30_000);
  retryCount += 1;
  retryTimer = setTimeout(() => {
    if (socket && !socket.connected) socket.connect();
  }, delay);
}

function initSocket(dispatch: AppDispatch): Socket {
  if (socket) return socket;

  socket = io(BACKEND_URL, { withCredentials: true, autoConnect: true });

  socket.on('connect', () => {
    retryCount = 0;
    clearRetryTimer();
    dispatch(setIsOnline(true));
  });

  socket.on('disconnect', () => {
    dispatch(setIsOnline(false));
    scheduleReconnect();
  });

  socket.on('connect_error', () => {
    scheduleReconnect();
  });

  socket.on('biometric_ack', (data: unknown) => dispatch(setBiometricAck(data as never)));
  socket.on('recalibration_pending', (data: unknown) => dispatch(setRecalibrationPending(data as never)));
  socket.on('recalibration_cancelled', () => dispatch(setRecalibrationCancelled()));
  socket.on('playlist_recalibration', () => dispatch(setRecalibrating()));

  socket.on('playlist_ready', (data: { tracks: never[]; trigger: 'emotion' | 'biometric' | 'skip_loop' }) => {
    dispatch(setPlaylist({ tracks: data.tracks, trigger: data.trigger }));
  });

  return socket;
}

export function useSocket() {
  const dispatch = useDispatch<AppDispatch>();
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    socketRef.current = initSocket(dispatch);

    const handleOnline = () => {
      dispatch(setIsOnline(true));
      if (socket && !socket.connected) {
        retryCount = 0;
        socket.connect();
      }
    };
    const handleOffline = () => {
      dispatch(setIsOnline(false));
      scheduleReconnect();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [dispatch]);

  const skipTrack = () => {
    socketRef.current?.emit('track_skipped');
    dispatch(skipTrackAction());
  };

  const emitEmotionUpdate = (taps: EmotionTap[], textPrompt?: string) => {
    socketRef.current?.emit('emotion_update', { taps, textPrompt });
  };

  const disconnect = () => {
    clearRetryTimer();
    socket?.disconnect();
    socket = null;
  };

  return {
    connected: socket?.connected ?? false,
    skipTrack,
    emitEmotionUpdate,
    disconnect,
  };
}
```

- [ ] **Step 3: Verify TypeScript across all changed files**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: exits 0, zero errors across all files including PlaylistView.tsx from Task 4

- [ ] **Step 4: Verify backend tests unchanged**

Run: `npm test --prefix backend`
Expected: all tests still pass

- [ ] **Step 5: Commit**

```bash
git add frontend/src/store/slices/playerSlice.ts frontend/src/hooks/useSocket.ts
git commit -m "feat: offline track buffer, online/offline events, exponential backoff reconnect"
```

---

## Self-Review Against Spec

| Spec Requirement | Task | Covered |
|---|---|---|
| SSO: Apple login (frontend) | Task 1 | ✅ |
| SSO: Facebook login (frontend) | Task 2 | ✅ |
| AI timeout → music never stops | Task 3 | ✅ |
| Static fallback when Gemini fails/times out | Task 3 | ✅ |
| Crossfade between drastically different BPM tracks | Task 4 | ✅ |
| Bluetooth audio latency compensation (Marshall Motif II A.N.C.) | Task 4 | ✅ |
| Offline buffer 5–10 tracks based on last known state | Task 5 | ✅ |
| Exponential backoff reconnect | Task 5 | ✅ |
| `isOnline` reflected in UI | Task 5 + Task 4 | ✅ |

### Placeholder scan

No TBD, TODO, "implement later", "similar to Task N", or steps without code blocks. All function names and type signatures are consistent across tasks.

### Type consistency check

- `Track` interface (id, title, artist, uri) is defined once in `playerSlice.ts` and used by `PlaylistView.tsx` via Redux state — consistent
- `EmotionTap` (x, y) is defined in `useSocket.ts` and matches existing `emotionSlice.ts` shape — consistent
- `generateFallbackPlaylist` is exported from `playlistMixer.js` and imported in `biometricHandler.js` — consistent
- `setIsOnline`, `setOfflineBuffer`, `setPlaylist` are exported from `playerSlice.ts` and imported in `useSocket.ts` + `PlaylistView.tsx` — consistent

### Dependency note for Task 4

`PlaylistView.tsx` (Task 4) accesses `state.player.isOnline` and `state.player.offlineBuffer` which are added in Task 5. Run Task 5 before or alongside Task 4, or expect TypeScript errors in `PlaylistView.tsx` until Task 5 is complete.
