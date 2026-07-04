# Design Spec — Kokonada Spotify Playback: Custom TurboModule

- **Date:** 2026-07-04
- **Status:** Approved (design); implementation plan to follow
- **Owner persona:** A9 Playback Orchestration (Staff Software Architect)
- **Branch:** `feat/spotify-playback-turbomodule`

---

## 1. Context & Problem

Squad 6 (On-Device Verification) attempted the first real device build of `mobile/KokonadaHealth`
(bare RN 0.86, New Architecture + Hermes). Two native build blockers surfaced:

1. **Reanimated 4 / worklets (fixed, in-scope here):** `react-native-reanimated@4.5.1` requires the
   separate `react-native-worklets@0.10.x` peer package (Reanimated 4 split worklets into its own
   module). It sat in `node_modules` undeclared, so RN autolinking skipped it and Reanimated's Gradle
   plugin aborted. Fixed by declaring `react-native-worklets@^0.10.1` in `package.json` + lockfile.
   Babel config was already correct (`react-native-reanimated/plugin` cleanly re-exports
   `react-native-worklets/plugin`).

2. **Spotify playback (the subject of this spec):** `react-native-spotify-remote@0.3.10` (circa 2021,
   AGP 3.4.1 / compileSdk 28) is unmaintained and its Android `build.gradle` is incompatible with the
   modern toolchain (AGP 8 / Gradle 9.3.1): it applies the removed `maven` plugin, uses dead
   `jcenter()`, a removed `mavenDeployer`/`Upload` block, the obsolete `com.facebook.react:react-native:+`
   coordinate, and declares no `namespace`. Its own dependency `react-native-events` (wants RN ~0.63)
   is equally rotten. This is a multi-library dead end, not a one-line patch.

**Product decision (Daniel, product owner):** do NOT patch or exclude the dead library. Replace it with
a robust, production-ready, future-proof integration of the official Spotify App Remote SDK.

**Research findings that shaped this design:**
- **No maintained fork** of `react-native-spotify-remote` with New-Architecture/TurboModule support
  exists. The "adopt a fork" path is closed.
- The official Spotify SDK is now cleanly consumable as Gradle dependencies (no hand-vendored AAR):
  **App Remote `0.8.0`** via **JitPack** (`spotify/android-app-remote-sdk`), and **`spotify-auth 2.1.0`**
  on **Maven Central** (`com.spotify.android:auth`).
- The RN New Architecture is enabled (`newArchEnabled=true`) and Hermes is on, so the correct,
  future-proof shape is a **TurboModule** (codegen), not a legacy bridge module.

## 2. Approved Decisions

| # | Decision | Choice |
|---|----------|--------|
| D1 | Platform scope | **Android now, iOS-ready seam.** Real Android impl; cross-platform JS codegen spec; iOS native stub that rejects `UNSUPPORTED` so it compiles. iOS is a clean future drop-in. |
| D2 | App Remote token source | **Backend-minted, unified.** Add `app-remote-control` to backend Spotify OAuth scopes; expose a short-lived token endpoint. One Spotify auth surface for the whole app; backend-managed refresh. |
| D3 | Module packaging | **Local library module** at `modules/spotify-remote/` (scaffolded via `create-react-native-library` local template). Isolated, independently testable, extractable to a standalone package later with zero rework. |

## 3. Guiding Principle

**Swap the native implementation behind the port that already exists.** The app already has the exact
seam we need:
- `src/experience/player/spotifyController.ts` — `SpotifyRemoteLike` port + `SpotifyPlayerController`,
  fully unit-tested against a fake remote. Its whole design goal is "no native failure ever escapes to
  crash the JS bundle."
- `src/experience/player/spotifyRemoteAdapter.ts` — the **only** file that imports the native library.

Therefore the controller, the `PlaybackOrchestrator`, the status/now-playing/error stores, and all of
their unit tests are the **stable core and DO NOT CHANGE**. Only the native module and the single
adapter change, plus a small backend token endpoint.

## 4. Non-Goals (YAGNI)

- No iOS native implementation now (stub only).
- No on-device Spotify Auth UI flow (backend mints the token — D2).
- No expansion of the playback surface beyond what `SpotifyRemoteLike` already needs (no queue
  management, no volume, no seek, no image API) — add later only if a feature demands it.
- No Web Playback SDK / standalone playback — App Remote controls the installed Spotify app by design.

## 5. Architecture

### 5.1 New local library — `modules/spotify-remote/`

```
modules/spotify-remote/
  package.json                         name: "@kokonada/spotify-remote"
  react-native.config.js               local autolink
  src/
    NativeSpotifyRemote.ts             TurboModule codegen spec (cross-platform)
    index.ts                           typed JS wrapper + event emitter
  android/
    build.gradle                       JitPack + Maven Central deps, namespace, codegen
    src/main/java/com/kokonada/spotifyremote/
      SpotifyRemoteModule.kt           impl against Spotify App Remote 0.8.0
      SpotifyRemotePackage.kt          TurboReactPackage registration
  ios/
    SpotifyRemote.swift                stub: every method rejects UNSUPPORTED
  spotify-remote.podspec
```

### 5.2 Codegen spec surface (`NativeSpotifyRemote.ts`)

Maps 1:1 onto what `SpotifyRemoteLike` requires — nothing more.

```ts
import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  configure(clientId: string, redirectUri: string): void;
  connect(token: string): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): Promise<boolean>;
  playUri(uri: string): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  getPlayerState(): Promise<{ isPaused: boolean; trackUri: string | null }>;
  addListener(eventName: string): void;    // RN NativeEventEmitter contract
  removeListeners(count: number): void;
}

export default TurboModuleRegistry.getEnforcing<Spec>('SpotifyRemote');
// Emitted events: 'remoteDisconnected'
```

`src/index.ts` wraps the spec: exposes the async methods and a `NativeEventEmitter` that surfaces the
`remoteDisconnected` event, so consumers never touch `TurboModuleRegistry` directly.

### 5.3 Android implementation (`SpotifyRemoteModule.kt`)

- Deps (module `build.gradle`):
  - `com.spotify.android:auth:2.1.0` (Maven Central) — for `AuthorizationClient` types; **not** used to
    run an on-device auth UI under D2, but part of the SDK surface.
  - Spotify App Remote `0.8.0` via JitPack: repo `https://jitpack.io`, artifact
    `com.github.spotify:android-app-remote-sdk:0.8.0-appremote_v2.1.0-auth` (exact coordinate pinned
    during implementation against the published JitPack build).
- `configure(clientId, redirectUri)` stores connection identity (see §7).
- `connect(token)` → `SpotifyAppRemote.connect(context, ConnectionParams.Builder(clientId)
  .setRedirectUri(redirectUri).setAccessToken(token).build(), Connector.ConnectionListener{…})`.
  Resolves on `onConnected`; rejects with a coded error on `onFailure` (mapping
  `CouldNotFindSpotifyApp → SPOTIFY_NOT_INSTALLED`, `NotLoggedInException → NOT_LOGGED_IN`, else
  `CONNECTION_FAILED`). Subscribes to `PlayerApi` connection termination → emits `remoteDisconnected`.
- `playUri/pause/resume` → `appRemote.playerApi.*`, each guarded for a null/disconnected remote
  (reject `CONNECTION_FAILED`) and never allowed to throw synchronously.
- `getPlayerState()` → `playerApi.playerState` once → `{ isPaused, trackUri }`.
- `disconnect()` → `SpotifyAppRemote.disconnect(appRemote)`, clears listeners; idempotent.

### 5.4 iOS stub (`SpotifyRemote.swift`)

Implements the same spec; every Promise method rejects `UNSUPPORTED`; `configure`/`addListener`/
`removeListeners` are no-ops. Compiles under codegen so the JS spec stays cross-platform.

### 5.5 Changed app files (exactly two)

- `src/experience/player/spotifyRemoteAdapter.ts` — import `@kokonada/spotify-remote` instead of
  `react-native-spotify-remote`; map its API onto `SpotifyRemoteLike` (same shape as today). Stays out
  of the jest graph. Calls `configure()` once with values from app config.
- `getSpotifyAccessToken()` — fetch the backend remote-token endpoint (D2) instead of reading a native
  Spotify session; returns `null` when Spotify isn't linked. Reuses the app's authenticated `fetch`
  path (`BACKEND_URL`).

### 5.6 Removed

- `react-native-spotify-remote` and `react-native-events` deleted from `package.json` (+ lockfile).
  No `react-native.config.js` exclusion is needed because the packages are gone.

## 6. Backend Changes (small)

- Add `app-remote-control` to the Spotify OAuth scope list (existing scope-request site).
- New route **`GET /api/integrations/spotify/remote-token`** (auth-gated) → `{ accessToken, expiresIn }`
  for the logged-in user, minted/refreshed via the stored Spotify refresh token using existing refresh
  plumbing. Returns `401` when Spotify isn't linked or the refresh token is dead (app treats as
  "not linked" → `null` token → controller stays `disconnected`). The raw token is returned only to the
  authenticated owner and never logged.

## 7. Connection Config (clientId / redirectUri)

`clientId` and `redirectUri` are **app identity**, not module identity, so they live in the app
(`src/health/config.ts`, alongside `BACKEND_URL` / `GOOGLE_WEB_CLIENT_ID`) and are pushed into the
module via `configure(clientId, redirectUri)` at playback bootstrap. Because D2 uses a backend-minted
token, **no on-device auth UI and no redirect intent-filter are required**; `redirectUri` is only the
value ConnectionParams needs, and it must match a redirect URI registered in the Spotify dashboard.

## 8. Data Flow (connect → play)

1. `startPlayback()` (post-login) → `player.connect()`.
2. Controller `getToken()` → adapter → `GET /api/integrations/spotify/remote-token` → backend returns a
   short-lived `app-remote-control` token (or 401 → `null`).
3. `remote.connect(token)` → TurboModule → `SpotifyAppRemote.connect(ConnectionParams…setAccessToken)`.
4. Native connects to the installed Spotify app; resolve on success.
5. Playlist arrives on the socket → `orchestrator.handlePlaylist` → `player.play(uri)` →
   `playerApi.play(uri)`.
6. Any severance/failure/revoked-auth → native emits `remoteDisconnected` → controller marks
   `disconnected` → `playerStatusStore` (the live Spotify badge wired by QA4 Suspect #4).

## 9. Error Handling — "never crash JS" is preserved

Native methods reject with coded errors (`NOT_LOGGED_IN`, `SPOTIFY_NOT_INSTALLED`, `CONNECTION_FAILED`,
`UNSUPPORTED`). `SpotifyPlayerController.run()` / `ensureConnected()` already catch **every** rejection,
mark `disconnected`, and return `{ ok: false }`, spending a capped reconnect budget so a dead remote
can't spin forever. We are only changing *what throws underneath*; the controller contract is unchanged.
"Spotify not installed / not logged in" is surfaced to the user through the existing `playbackErrorStore`
path.

## 10. Testing Strategy (strict TDD)

- **Mobile jest** stays green by adding a module mock for `@kokonada/spotify-remote` (mirroring the
  current `react-native-spotify-remote` mock). `SpotifyPlayerController` keeps testing against the fake
  `SpotifyRemoteLike`. No controller/orchestrator test changes.
- **Adapter-contract test** (new, pure): assert `spotifyRemoteAdapter` maps a fake module object onto
  `SpotifyRemoteLike` correctly (play/pause/resume/getPlayerState shape, listener wiring).
- **Backend**: TDD `/remote-token` — happy path returns token + scope present; refresh path; `401` when
  unlinked / refresh dead; token never appears in logs. Add as a permanent regression guard.
- **Native Kotlin**: on-device smoke is the primary verification (Squad 6). Optional JUnit for the pure
  error-mapping function.
- **Gate:** full mobile suite (42 suites / 361 tests) and full backend suite stay green.

## 11. Rollout — Pause & Guide (human/portal steps)

1. **Spotify Developer Dashboard:** register Android package `com.kokonadahealth` + the release & debug
   SHA-1 fingerprints; register the redirect URI; confirm `app-remote-control` is available to the app.
2. **On the Galaxy:** install the Spotify app and log in (App Remote controls the installed app; it
   cannot play standalone).
3. **Backend deploy** (Railway auto-deploy from GitHub) of the scope + endpoint change; existing users
   **reconnect Spotify once** to grant `app-remote-control` (consistent with the established reconnect
   pattern).

## 12. Sequencing (skeleton — full plan produced by writing-plans)

1. **Backend**: scope + `/remote-token` (TDD) → PR → merge (Railway deploys).
2. **Scaffold** `modules/spotify-remote/` (codegen spec + Kotlin impl + iOS stub) via
   `create-react-native-library` local template.
3. **Implement** Kotlin against App Remote 0.8.0 (JitPack) + spotify-auth 2.1.0.
4. **Re-point** `spotifyRemoteAdapter.ts` + `getSpotifyAccessToken()`; add jest mock; delete dead deps.
5. **Build on device**; smoke-test connect / play / pause / resume / disconnect.
6. **Shadow QA** attack pass: token expiry mid-song, Spotify app killed, not-installed, revoked auth,
   rapid connect/disconnect storms, backend 401, offline.
7. **Resume Squad 6** (A11 verification) on the now-fully-building app.

## 13. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| JitPack App Remote coordinate/version drift | Pin the exact JitPack coordinate during impl; fall back to the GitHub-release AAR vendored under `modules/spotify-remote/android/libs/` if JitPack is unreliable. |
| App Remote requires Spotify installed + logged in | Explicit coded errors → existing `playbackErrorStore` user hint; not a crash. |
| Backend token lacks `app-remote-control` for existing users | One-time reconnect (established pattern); `401` degrades gracefully to `disconnected`. |
| New Architecture codegen setup friction | Use `create-react-native-library` (canonical TurboModule scaffolder); keep the spec minimal. |
| Other native libs also fail after Spotify is removed | Spotify is the clear outlier (2021-era); the rest (BLE/Skia/MMKV/Reanimated/HealthConnect/keychain) are RN-0.86-current. Verify on the first post-fix build. |

## 14. Definition of Done

- App builds and installs on the Galaxy with no dead-library dependencies.
- `connect / play / pause / resume / disconnect` verified on-device against a real Spotify account.
- Failure paths (no Spotify app, revoked auth, backend 401) degrade to `disconnected` without crashing.
- Mobile + backend suites green; new backend route + adapter-contract tests pinned.
- Squad 6 A11 verification resumes on the fully-building app.
