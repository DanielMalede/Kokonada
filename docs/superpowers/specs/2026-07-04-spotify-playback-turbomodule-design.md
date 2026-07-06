# Design Spec — Kokonada Spotify Playback: Custom TurboModule

- **Date:** 2026-07-04
- **Status:** Approved (design); implementation plan to follow
- **Owner persona:** A9 Playback Orchestration (Staff Software Architect)
- **Branch:** `feat/spotify-playback-turbomodule`

> **Revision (2026-07-04, during planning):** Verified against Spotify's official Android
> sample that **App Remote's `connect()` takes no access token** — it authorizes on-device via
> dashboard-registered client (package + SHA-1) + the installed Spotify app + an in-app
> `showAuthView` consent. The original decision D2 (backend-minted token) rested on a false
> premise and is **superseded**: there is **no backend change**, and the "is Spotify ready"
> gate becomes a native `isSpotifyInstalled()` check. Sections below reflect the corrected design.

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
- **App Remote's `connect()` takes no token** (verified from Spotify's `app-remote-sample`
  `RemotePlayerActivity`): it uses `ConnectionParams.Builder(CLIENT_ID).setRedirectUri(REDIRECT_URI)
  .showAuthView(true).build()` and authorizes via the installed Spotify app + dashboard registration.
- The official App Remote SDK is distributed as a **vendored AAR** (`spotify-app-remote-release-0.8.0.aar`)
  in Spotify's own sample; `spotify-auth 2.1.0` is on Maven Central. (JitPack is a fallback.)
- The RN New Architecture is enabled (`newArchEnabled=true`) and Hermes is on, so the correct,
  future-proof shape is a **TurboModule** (codegen), not a legacy bridge module.

## 2. Approved Decisions

| # | Decision | Choice |
|---|----------|--------|
| D1 | Platform scope | **Android now, iOS-ready seam.** Real Android impl; cross-platform JS codegen spec; iOS native stub that rejects `UNSUPPORTED` so it compiles. iOS is a clean future drop-in. |
| D2 | ~~App Remote token source~~ **Auth mechanism** | **On-device App Remote auth (SUPERSEDES backend token).** `connect()` takes no token; authorization is dashboard registration (package + SHA-1) + installed Spotify app + `showAuthView(true)` consent. **No backend change.** |
| D3 | Module packaging | **Local library module** at `modules/spotify-remote/` (scaffolded via `create-react-native-library` local template). Isolated, independently testable, extractable later with zero rework. |
| D4 | Readiness gate | **Native `isSpotifyInstalled()`.** `getToken` returns a `'ready'` sentinel when the Spotify app is installed, `null` otherwise — controller & all its tests untouched, no network call. |

## 3. Guiding Principle

**Swap the native implementation behind the port that already exists.** The app already has the exact
seam we need:
- `src/experience/player/spotifyController.ts` — `SpotifyRemoteLike` port + `SpotifyPlayerController`,
  fully unit-tested against a fake remote. Its whole design goal is "no native failure ever escapes to
  crash the JS bundle."
- `src/experience/player/spotifyRemoteAdapter.ts` — the **only** file that imports the native library.

Therefore the controller, the `PlaybackOrchestrator`, the status/now-playing/error stores, and all of
their unit tests are the **stable core and DO NOT CHANGE**. Only the native module and the single
adapter change. **The backend is untouched.**

## 4. Non-Goals (YAGNI)

- No iOS native implementation now (stub only).
- **No backend endpoint / no OAuth scope change** — App Remote self-authorizes on-device (D2 revised).
- No expansion of the playback surface beyond what `SpotifyRemoteLike` needs (no queue, volume, seek,
  image API) — add later only if a feature demands it.
- No Web Playback SDK / standalone playback — App Remote controls the installed Spotify app by design.

## 5. Architecture

### 5.1 New local library — `modules/spotify-remote/`

```
modules/spotify-remote/
  package.json                         name: "@kokonada/spotify-remote"; codegenConfig
  src/
    NativeSpotifyRemote.ts             TurboModule codegen spec (cross-platform)
    index.ts                           typed JS wrapper + event emitter
  android/
    build.gradle                       namespace, codegen, spotify-auth (Maven), vendored AAR
    libs/spotify-app-remote-release-0.8.0.aar   vendored SDK
    src/main/AndroidManifest.xml
    src/main/java/com/kokonada/spotifyremote/
      SpotifyRemoteModule.kt           impl against Spotify App Remote 0.8.0
      SpotifyRemotePackage.kt          TurboReactPackage registration
  ios/
    SpotifyRemote.swift                stub: every Promise method rejects UNSUPPORTED
    SpotifyRemote.mm                   ObjC++ codegen glue (stub)
  spotify-remote.podspec
```

### 5.2 Codegen spec surface (`NativeSpotifyRemote.ts`)

Maps onto what `SpotifyRemoteLike` requires — plus `configure`/`isSpotifyInstalled` for the corrected
auth model. **`connect()` takes no token.**

```ts
import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  configure(clientId: string, redirectUri: string): void;
  isSpotifyInstalled(): Promise<boolean>;
  connect(): Promise<void>;              // authorizes via installed app + showAuthView
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

`src/index.ts` wraps the spec: exposes the async methods + a `NativeEventEmitter` surfacing
`remoteDisconnected`, so consumers never touch `TurboModuleRegistry` directly.

### 5.3 Android implementation (`SpotifyRemoteModule.kt`)

- Deps (module `build.gradle`): `com.spotify.android:auth:2.1.0` (Maven Central) + the vendored
  `libs/spotify-app-remote-release-0.8.0.aar` (`implementation files("libs/…aar")`), plus `gson` (SDK
  transitive) + `com.spotify.android:auth` per Spotify's setup.
- `configure(clientId, redirectUri)` stores connection identity (from app config — §7).
- `isSpotifyInstalled()` → `SpotifyAppRemote.isSpotifyInstalled(reactContext)`.
- `connect()` → `SpotifyAppRemote.connect(reactContext, ConnectionParams.Builder(clientId)
  .setRedirectUri(redirectUri).showAuthView(true).build(), object : Connector.ConnectionListener {
  onConnected(appRemote) → resolve; onFailure(t) → reject coded })`. Maps
  `CouldNotFindSpotifyAppException → SPOTIFY_NOT_INSTALLED`, `NotLoggedInException → NOT_LOGGED_IN`,
  else `CONNECTION_FAILED`. Subscribes `playerApi.subscribeToPlayerState` and the connection
  termination → emits `remoteDisconnected`.
- `playUri/pause/resume` → `appRemote.playerApi.*`; each guards a null/disconnected remote (reject
  `CONNECTION_FAILED`) and never throws synchronously.
- `getPlayerState()` → `playerApi.playerState` once → `{ isPaused, trackUri }`.
- `disconnect()` → `SpotifyAppRemote.disconnect(appRemote)`; clears listeners; idempotent.

### 5.4 iOS stub (`SpotifyRemote.swift`)

Implements the same spec; every Promise method rejects `UNSUPPORTED`; `configure`/`addListener`/
`removeListeners` are no-ops. Compiles under codegen so the JS spec stays cross-platform. (Not
buildable on the current Windows toolchain; verified later on a Mac.)

### 5.5 Changed app files

- `src/experience/player/spotifyRemoteAdapter.ts` — import `@kokonada/spotify-remote` instead of
  `react-native-spotify-remote`; map its API onto `SpotifyRemoteLike` (`connect(token)` → native
  `connect()`, ignoring the token). Calls `configure()` once at module load with values from config.
  Stays out of the jest graph.
- Replace `getSpotifyAccessToken` with **`getSpotifyReadiness()`** → returns `'ready'` when
  `isSpotifyInstalled()`, else `null`. Update `playbackServices.ts` `getToken: getSpotifyReadiness`.
- `src/health/config.ts` — add `SPOTIFY_CLIENT_ID` + `SPOTIFY_REDIRECT_URI` (app identity, mirrors
  `BACKEND_URL` / `GOOGLE_WEB_CLIENT_ID`).

### 5.6 Removed

- `react-native-spotify-remote` and `react-native-events` deleted from `package.json` (+ lockfile).

## 6. Backend Changes

**None.** App Remote authorizes on-device; the backend Spotify integration is unaffected. (The existing
`GET /api/integrations/spotify/token` and OAuth scopes are left as-is for the Web-API features that use
them.)

## 7. Connection Config (clientId / redirectUri)

`clientId` and `redirectUri` are **app identity** and live in `src/health/config.ts`, pushed into the
module via `configure(clientId, redirectUri)` at adapter load. Both must match the values registered in
the Spotify Developer Dashboard. Because auth is `showAuthView` (in-app), **no browser redirect
intent-filter is required**; `redirectUri` is only the value `ConnectionParams` needs and the dashboard
match key. Default: `SPOTIFY_REDIRECT_URI = 'kokonadahealth://spotify-callback'` (final value is
whatever is registered in the dashboard).

## 8. Data Flow (connect → play)

1. `startPlayback()` (post-login) → `player.connect()`.
2. Controller `getToken()` → `getSpotifyReadiness()` → `isSpotifyInstalled()` → `'ready'` or `null`
   (bail if not installed).
3. `remote.connect(token)` → adapter → TurboModule `connect()` → `SpotifyAppRemote.connect(
   ConnectionParams…showAuthView(true))`; Spotify app grants `app-remote-control` (first time) and
   returns the remote.
4. Playlist arrives on the socket → `orchestrator.handlePlaylist` → `player.play(uri)` →
   `playerApi.play(uri)`.
5. Any severance/failure/revoked-auth → native emits `remoteDisconnected` → controller marks
   `disconnected` → `playerStatusStore` (the live Spotify badge wired by QA4 Suspect #4).

## 9. Error Handling — "never crash JS" is preserved

Native methods reject with coded errors (`NOT_LOGGED_IN`, `SPOTIFY_NOT_INSTALLED`, `CONNECTION_FAILED`,
`UNSUPPORTED`). `SpotifyPlayerController.run()` / `ensureConnected()` already catch **every** rejection,
mark `disconnected`, and return `{ ok: false }`, spending a capped reconnect budget so a dead remote
can't spin forever. We are only changing *what throws underneath*; the controller contract is unchanged.
"Spotify not installed / not logged in" surfaces through the existing `playbackErrorStore` path.

## 10. Testing Strategy (strict TDD)

- **Mobile jest** stays green by swapping the global `react-native-spotify-remote` mock in
  `jest.setup.js` for a `@kokonada/spotify-remote` mock. `SpotifyPlayerController` keeps testing against
  the fake `SpotifyRemoteLike`. No controller/orchestrator test changes.
- **Adapter-contract test** (new, pure): assert `spotifyRemoteAdapter` maps a fake module object onto
  `SpotifyRemoteLike` correctly (play/pause/resume/getPlayerState shape, listener wiring, token ignored).
- **Readiness test** (new, pure): `getSpotifyReadiness()` → `'ready'` when installed, `null` when not /
  on throw.
- **Native Kotlin**: on-device smoke is the primary verification (Squad 6). Optional JUnit for the pure
  error-mapping function.
- **Gate:** full mobile suite (42 suites / 361 tests) stays green. (Backend suite unaffected — no
  backend change.)

## 11. Rollout — Pause & Guide (human/portal steps)

1. **Spotify Developer Dashboard:** register Android package `com.kokonadahealth` + the **debug &
   release SHA-1** fingerprints; register the redirect URI (`kokonadahealth://spotify-callback`);
   confirm the app has App Remote access. **This is the auth mechanism — mandatory before the device
   test.** (I generate exact steps + extract your debug SHA-1 via `keytool`/gradle `signingReport`.)
2. **On the Galaxy:** install the Spotify app and log in (App Remote controls the installed app; it
   cannot play standalone).
3. **Vendor the AAR:** download `spotify-app-remote-release-0.8.0.aar` from the Spotify Android SDK
   GitHub release into `modules/spotify-remote/android/libs/`.

## 12. Sequencing (skeleton — full plan produced by writing-plans)

1. **Scaffold** `modules/spotify-remote/` (codegen spec + JS wrapper + package.json + app autolink).
2. **Android** Kotlin impl against App Remote 0.8.0 (vendored AAR) + spotify-auth 2.1.0.
3. **iOS stub** (create-only; build deferred).
4. **Re-point** `spotifyRemoteAdapter.ts` + `getSpotifyReadiness()` + `config.ts`; swap jest mock;
   delete dead deps; add adapter-contract + readiness tests. Mobile suite green.
5. **Pause & Guide**: Spotify Dashboard registration (package + SHA-1 + redirect); install Spotify on
   the Galaxy; vendor the AAR.
6. **Build on device**; smoke-test isSpotifyInstalled → connect (showAuthView consent) → play / pause /
   resume / disconnect.
7. **Shadow QA** attack pass: Spotify app not installed, not logged in, killed mid-song, revoked auth,
   rapid connect/disconnect storms, offline.
8. **Resume Squad 6** (A11 verification) on the now-fully-building app.

## 13. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Vendored AAR version drift | Pin `spotify-app-remote-release-0.8.0.aar`; JitPack `com.github.spotify:android-sdk` is the fallback if the AAR is problematic. |
| App Remote requires Spotify installed + logged in | `isSpotifyInstalled()` gate + coded `onFailure` errors → existing `playbackErrorStore` user hint; not a crash. |
| Dashboard registration (package + SHA-1) missing/wrong | `connect()` `onFailure` → `AUTHENTICATION_FAILED`/`UserNotAuthorizedException`; explicit Pause & Guide step extracts the exact debug + release SHA-1 before the device test. |
| New Architecture codegen setup friction | Use `create-react-native-library` (canonical TurboModule scaffolder); keep the spec minimal. |
| Other native libs also fail after Spotify is removed | Spotify is the clear outlier (2021-era); the rest (BLE/Skia/MMKV/Reanimated/HealthConnect/keychain) are RN-0.86-current. Verify on the first post-fix build. |

## 14. Definition of Done

- App builds and installs on the Galaxy with no dead-library dependencies.
- `isSpotifyInstalled → connect (showAuthView consent) → play / pause / resume / disconnect` verified
  on-device against a real Spotify account with the Spotify app installed.
- Failure paths (no Spotify app, not logged in, revoked auth) degrade to `disconnected` without crashing.
- Mobile suite green; new adapter-contract + readiness tests pinned.
- Squad 6 A11 verification resumes on the fully-building app.
