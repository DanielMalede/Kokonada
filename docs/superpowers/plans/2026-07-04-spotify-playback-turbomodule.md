# Spotify Playback TurboModule — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dead `react-native-spotify-remote` with a purpose-built local TurboModule that wraps the official Spotify App Remote 0.8.0 SDK, behind the existing `SpotifyRemoteLike` port, so Kokonada builds and controls playback on RN 0.86.

**Architecture:** A local RN library at `modules/spotify-remote/` exposing a New-Architecture TurboModule (`SpotifyRemote`). The Kotlin implementation wraps `SpotifyAppRemote` (connect/play/pause/resume/getPlayerState/disconnect + `remoteDisconnected` event). App Remote authorizes **on-device** (no token): dashboard-registered client + installed Spotify app + `showAuthView`. Only two app files change (`spotifyRemoteAdapter.ts`, `getSpotifyReadiness`); the controller, orchestrator, stores, and their tests are untouched. Backend is untouched.

**Tech Stack:** React Native 0.86 (New Architecture + Hermes), TypeScript, Kotlin, Spotify App Remote 0.8.0 (vendored AAR), `com.spotify.android:auth:2.1.0` (Maven Central), Jest.

## Global Constraints

- **RN 0.86, New Architecture ON** (`newArchEnabled=true`), Hermes ON — the module MUST be a TurboModule with `codegenConfig`.
- **TurboModule JS name:** `'SpotifyRemote'`. **npm name:** `@kokonada/spotify-remote`. **Android package/namespace:** `com.kokonada.spotifyremote`. **App package id:** `com.kokonadahealth`.
- **App Remote `connect()` takes NO access token.** Auth = `ConnectionParams.Builder(clientId).setRedirectUri(redirectUri).showAuthView(true)` + installed Spotify app + dashboard registration.
- **Coded native errors only:** `SPOTIFY_NOT_INSTALLED`, `NOT_LOGGED_IN`, `CONNECTION_FAILED`, `UNSUPPORTED` (iOS). Every native method resolves/rejects a Promise; never throws synchronously across the bridge.
- **Do NOT change** `spotifyController.ts`, `playbackOrchestrator.ts`, the stores, or their tests.
- **Git style:** short single-line commit messages, no body, no trailers.
- **Test gate:** full mobile suite green — `./node_modules/.bin/jest` from `mobile/KokonadaHealth` (baseline 42 suites / 361 tests). Mobile is NOT in CI — run locally.
- **All paths below are relative to `mobile/KokonadaHealth/` unless stated otherwise.**

---

## Task 1: Scaffold the local TurboModule package (JS spec + wrapper + wiring)

**Files:**
- Create: `modules/spotify-remote/package.json`
- Create: `modules/spotify-remote/src/NativeSpotifyRemote.ts`
- Create: `modules/spotify-remote/src/index.ts`
- Create: `react-native.config.js` (app root — does not exist yet)
- Test: `modules/spotify-remote/src/__tests__/index.test.ts`

**Interfaces:**
- Produces: the `Spec` TurboModule interface and a JS wrapper `SpotifyRemote` with methods
  `configure(clientId: string, redirectUri: string): void`, `isSpotifyInstalled(): Promise<boolean>`,
  `connect(): Promise<void>`, `disconnect(): Promise<void>`, `isConnected(): Promise<boolean>`,
  `playUri(uri: string): Promise<void>`, `pause(): Promise<void>`, `resume(): Promise<void>`,
  `getPlayerState(): Promise<{ isPaused: boolean; trackUri: string | null }>`, and an event emitter
  `onRemoteDisconnected(cb: () => void): () => void`.

- [ ] **Step 1: Create the module `package.json` with codegenConfig**

`modules/spotify-remote/package.json`:
```json
{
  "name": "@kokonada/spotify-remote",
  "version": "0.0.1",
  "description": "Kokonada Spotify App Remote TurboModule",
  "private": true,
  "source": "src/index.ts",
  "main": "src/index.ts",
  "react-native": "src/index.ts",
  "codegenConfig": {
    "name": "SpotifyRemoteSpec",
    "type": "modules",
    "jsSrcsDir": "src",
    "android": {
      "javaPackageName": "com.kokonada.spotifyremote"
    }
  }
}
```

- [ ] **Step 2: Create the codegen spec**

`modules/spotify-remote/src/NativeSpotifyRemote.ts`:
```ts
import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  configure(clientId: string, redirectUri: string): void;
  isSpotifyInstalled(): Promise<boolean>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): Promise<boolean>;
  playUri(uri: string): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  getPlayerState(): Promise<{ isPaused: boolean; trackUri: string | null }>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export default TurboModuleRegistry.getEnforcing<Spec>('SpotifyRemote');
```

- [ ] **Step 3: Create the JS wrapper**

`modules/spotify-remote/src/index.ts`:
```ts
import { NativeEventEmitter, NativeModules } from 'react-native';
import Native from './NativeSpotifyRemote';

const REMOTE_DISCONNECTED = 'remoteDisconnected';

// A single emitter over the native module. NativeModules.SpotifyRemote exists at
// runtime once the TurboModule is registered; the emitter is only constructed lazily.
let emitter: NativeEventEmitter | null = null;
function getEmitter(): NativeEventEmitter {
  if (!emitter) emitter = new NativeEventEmitter(NativeModules.SpotifyRemote as any);
  return emitter;
}

export const SpotifyRemote = {
  configure: (clientId: string, redirectUri: string): void =>
    Native.configure(clientId, redirectUri),
  isSpotifyInstalled: (): Promise<boolean> => Native.isSpotifyInstalled(),
  connect: (): Promise<void> => Native.connect(),
  disconnect: (): Promise<void> => Native.disconnect(),
  isConnected: (): Promise<boolean> => Native.isConnected(),
  playUri: (uri: string): Promise<void> => Native.playUri(uri),
  pause: (): Promise<void> => Native.pause(),
  resume: (): Promise<void> => Native.resume(),
  getPlayerState: (): Promise<{ isPaused: boolean; trackUri: string | null }> =>
    Native.getPlayerState(),
  onRemoteDisconnected: (cb: () => void): (() => void) => {
    const sub = getEmitter().addListener(REMOTE_DISCONNECTED, cb);
    return () => sub.remove();
  },
};

export type { Spec } from './NativeSpotifyRemote';
```

- [ ] **Step 4: Wire the local module into the app via `react-native.config.js`**

Create `react-native.config.js` at the app root (`mobile/KokonadaHealth/react-native.config.js`):
```js
const path = require('path');

// Local-library autolinking: treat modules/spotify-remote as an installed native
// dependency without publishing it to npm or copying it into node_modules.
module.exports = {
  dependencies: {
    '@kokonada/spotify-remote': {
      root: path.join(__dirname, 'modules/spotify-remote'),
    },
  },
};
```

- [ ] **Step 5: Write a failing test for the wrapper's event API**

`modules/spotify-remote/src/__tests__/index.test.ts`:
```ts
// The native spec calls TurboModuleRegistry.getEnforcing which throws under jest,
// so mock the spec module and the emitter. We verify the wrapper's thin mapping.
jest.mock('../NativeSpotifyRemote', () => ({
  __esModule: true,
  default: {
    configure: jest.fn(),
    isSpotifyInstalled: jest.fn().mockResolvedValue(true),
    connect: jest.fn().mockResolvedValue(undefined),
    playUri: jest.fn().mockResolvedValue(undefined),
  },
}));

const addListener = jest.fn(() => ({ remove: jest.fn() }));
jest.mock('react-native', () => ({
  NativeModules: { SpotifyRemote: {} },
  NativeEventEmitter: jest.fn().mockImplementation(() => ({ addListener })),
}));

import { SpotifyRemote } from '../index';

test('isSpotifyInstalled delegates to the native spec', async () => {
  await expect(SpotifyRemote.isSpotifyInstalled()).resolves.toBe(true);
});

test('onRemoteDisconnected subscribes and returns an unsubscribe', () => {
  const off = SpotifyRemote.onRemoteDisconnected(() => {});
  expect(addListener).toHaveBeenCalledWith('remoteDisconnected', expect.any(Function));
  expect(typeof off).toBe('function');
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `./node_modules/.bin/jest modules/spotify-remote --no-coverage`
Expected: FAIL — `Cannot find module '../index'` or the assertions fail (files not yet complete). If the files from Steps 2–3 are already present, expect PASS on the two assertions; if so, treat Steps 5–6 as pinning the contract.

- [ ] **Step 7: Confirm TypeScript compiles**

Run: `./node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: no errors referencing `modules/spotify-remote`.

- [ ] **Step 8: Run the test to verify it passes**

Run: `./node_modules/.bin/jest modules/spotify-remote --no-coverage`
Expected: PASS (2 tests).

- [ ] **Step 9: Commit**

```bash
git add modules/spotify-remote react-native.config.js
git commit -m "feat: scaffold spotify-remote turbomodule js spec and wrapper"
```

---

## Task 2: Android native module (vendored AAR + Gradle + Kotlin)

**Files:**
- Create: `modules/spotify-remote/android/build.gradle`
- Create: `modules/spotify-remote/android/src/main/AndroidManifest.xml`
- Create: `modules/spotify-remote/android/libs/spotify-app-remote-release-0.8.0.aar` (downloaded)
- Create: `modules/spotify-remote/android/src/main/java/com/kokonada/spotifyremote/SpotifyRemoteModule.kt`
- Create: `modules/spotify-remote/android/src/main/java/com/kokonada/spotifyremote/SpotifyRemotePackage.kt`

**Interfaces:**
- Consumes: the codegen `Spec` from Task 1 (generates the abstract class `NativeSpotifyRemoteSpec` in
  package `com.kokonada.spotifyremote` when the app builds).
- Produces: a registered native module named `SpotifyRemote` implementing the spec.

- [ ] **Step 1: Vendor the Spotify App Remote AAR**

Download `spotify-app-remote-release-0.8.0.aar` from the Spotify Android SDK GitHub release
(https://github.com/spotify/android-sdk/releases — the `app-remote-lib/` folder inside the release zip)
and place it at `modules/spotify-remote/android/libs/spotify-app-remote-release-0.8.0.aar`.
Verify: `ls -la modules/spotify-remote/android/libs/` shows the `.aar` (~2–3 MB).

- [ ] **Step 2: Create the module `build.gradle`**

`modules/spotify-remote/android/build.gradle`:
```gradle
buildscript {
  ext.getExtOrDefault = { name, fallback ->
    rootProject.ext.has(name) ? rootProject.ext.get(name) : fallback
  }
}

apply plugin: "com.android.library"
apply plugin: "org.jetbrains.kotlin.android"

android {
  namespace "com.kokonada.spotifyremote"
  compileSdk getExtOrDefault("compileSdkVersion", 35)

  defaultConfig {
    minSdkVersion getExtOrDefault("minSdkVersion", 24)
  }

  buildFeatures {
    buildConfig true
  }
}

repositories {
  google()
  mavenCentral()
}

dependencies {
  implementation "com.facebook.react:react-android"
  // Spotify App Remote (vendored AAR) + its runtime peers.
  implementation fileTree(dir: "libs", include: ["*.aar"])
  implementation "com.spotify.android:auth:2.1.0"
  implementation "com.google.code.gson:gson:2.10.1"
}
```
Note: the exact `compileSdkVersion`/`minSdkVersion` fall back to the app's root ext values, so the
module tracks the app. React Native codegen for New Architecture is applied automatically by the RN
Gradle plugin for autolinked libraries with a `codegenConfig`.

- [ ] **Step 3: Create the module manifest**

`modules/spotify-remote/android/src/main/AndroidManifest.xml`:
```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <!-- App Remote checks whether the Spotify app is installed; on Android 11+ this
       requires a <queries> entry for the Spotify package. -->
  <queries>
    <package android:name="com.spotify.music" />
  </queries>
</manifest>
```

- [ ] **Step 4: Create the Kotlin module**

`modules/spotify-remote/android/src/main/java/com/kokonada/spotifyremote/SpotifyRemoteModule.kt`:
```kotlin
package com.kokonada.spotifyremote

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.spotify.android.appremote.api.ConnectionParams
import com.spotify.android.appremote.api.Connector
import com.spotify.android.appremote.api.SpotifyAppRemote

// Extends the codegen-generated abstract spec NativeSpotifyRemoteSpec (produced from
// src/NativeSpotifyRemote.ts). If the generated method signatures differ (they are
// deterministic from the JS spec), align the overrides to the generated class.
@ReactModule(name = SpotifyRemoteModule.NAME)
class SpotifyRemoteModule(private val reactContext: ReactApplicationContext) :
  NativeSpotifyRemoteSpec(reactContext) {

  companion object { const val NAME = "SpotifyRemote" }

  private var clientId: String = ""
  private var redirectUri: String = ""
  private var appRemote: SpotifyAppRemote? = null
  private var listenerCount = 0

  override fun getName(): String = NAME

  override fun configure(clientId: String, redirectUri: String) {
    this.clientId = clientId
    this.redirectUri = redirectUri
  }

  override fun isSpotifyInstalled(promise: Promise) {
    promise.resolve(SpotifyAppRemote.isSpotifyInstalled(reactContext))
  }

  override fun connect(promise: Promise) {
    val params = ConnectionParams.Builder(clientId)
      .setRedirectUri(redirectUri)
      .showAuthView(true)
      .build()
    SpotifyAppRemote.connect(reactContext, params, object : Connector.ConnectionListener {
      override fun onConnected(remote: SpotifyAppRemote) {
        appRemote = remote
        remote.playerApi.subscribeToPlayerState().setErrorCallback {
          emit("remoteDisconnected")
        }
        promise.resolve(null)
      }
      override fun onFailure(error: Throwable) {
        // Verify exact SDK exception class names against the vendored AAR; map by
        // simpleName so a version rename does not silently fall through.
        val code = when (error.javaClass.simpleName) {
          "CouldNotFindSpotifyApp" -> "SPOTIFY_NOT_INSTALLED"
          "NotLoggedInException" -> "NOT_LOGGED_IN"
          else -> "CONNECTION_FAILED"
        }
        promise.reject(code, error.message ?: error.javaClass.simpleName, error)
      }
    })
  }

  override fun isConnected(promise: Promise) {
    promise.resolve(appRemote?.isConnected == true)
  }

  override fun playUri(uri: String, promise: Promise) {
    val remote = appRemote ?: return promise.reject("CONNECTION_FAILED", "not connected")
    remote.playerApi.play(uri)
      .setResultCallback { promise.resolve(null) }
      .setErrorCallback { promise.reject("CONNECTION_FAILED", it.message, it) }
  }

  override fun pause(promise: Promise) {
    val remote = appRemote ?: return promise.reject("CONNECTION_FAILED", "not connected")
    remote.playerApi.pause()
      .setResultCallback { promise.resolve(null) }
      .setErrorCallback { promise.reject("CONNECTION_FAILED", it.message, it) }
  }

  override fun resume(promise: Promise) {
    val remote = appRemote ?: return promise.reject("CONNECTION_FAILED", "not connected")
    remote.playerApi.resume()
      .setResultCallback { promise.resolve(null) }
      .setErrorCallback { promise.reject("CONNECTION_FAILED", it.message, it) }
  }

  override fun getPlayerState(promise: Promise) {
    val remote = appRemote ?: return promise.reject("CONNECTION_FAILED", "not connected")
    remote.playerApi.playerState
      .setResultCallback { state ->
        val map = Arguments.createMap()
        map.putBoolean("isPaused", state.isPaused)
        map.putString("trackUri", state.track?.uri)
        promise.resolve(map)
      }
      .setErrorCallback { promise.reject("CONNECTION_FAILED", it.message, it) }
  }

  override fun disconnect(promise: Promise) {
    appRemote?.let { SpotifyAppRemote.disconnect(it) }
    appRemote = null
    promise.resolve(null)
  }

  override fun addListener(eventName: String) { listenerCount += 1 }

  override fun removeListeners(count: Double) { listenerCount -= count.toInt() }

  private fun emit(event: String) {
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(event, null)
  }
}
```

- [ ] **Step 5: Create the package registration**

`modules/spotify-remote/android/src/main/java/com/kokonada/spotifyremote/SpotifyRemotePackage.kt`:
```kotlin
package com.kokonada.spotifyremote

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class SpotifyRemotePackage : BaseReactPackage() {
  override fun getModule(name: String, ctx: ReactApplicationContext): NativeModule? =
    if (name == SpotifyRemoteModule.NAME) SpotifyRemoteModule(ctx) else null

  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    mapOf(
      SpotifyRemoteModule.NAME to ReactModuleInfo(
        SpotifyRemoteModule.NAME,           // name
        SpotifyRemoteModule.NAME,           // className
        false,                              // canOverrideExistingModule
        false,                              // needsEagerInit
        false,                              // isCxxModule
        true,                               // isTurboModule
      ),
    )
  }
}
```

- [ ] **Step 6: Compile the module (generates codegen + verifies the AAR links)**

Run (from `mobile/KokonadaHealth/android`, PowerShell):
`.\gradlew.bat :spotify-remote:compileDebugKotlin -PreactNativeArchitectures=arm64-v8a`
Expected: `BUILD SUCCESSFUL`. If it fails on `NativeSpotifyRemoteSpec` not found, first run a codegen
pass by building the app module far enough to trigger `generateCodegenArtifactsFromSchema`
(`.\gradlew.bat :app:generateCodegenArtifactsFromSchema`), then re-run. If it fails on a Spotify
exception class name (Step 4 `when` block), open the AAR's classes and correct the `simpleName`
strings; the `else` branch keeps it safe meanwhile.

- [ ] **Step 7: Commit**

```bash
git add modules/spotify-remote/android
git commit -m "feat: android spotify-remote turbomodule against app remote 0.8.0"
```

---

## Task 3: iOS stub (create-only; build deferred to a Mac)

**Files:**
- Create: `modules/spotify-remote/ios/SpotifyRemote.swift`
- Create: `modules/spotify-remote/spotify-remote.podspec`

**Interfaces:**
- Produces: an iOS implementation of the spec where every Promise method rejects `UNSUPPORTED`, so the
  cross-platform JS spec compiles on iOS later without re-architecture.

- [ ] **Step 1: Create the Swift stub**

`modules/spotify-remote/ios/SpotifyRemote.swift`:
```swift
import Foundation
import React

@objc(SpotifyRemote)
class SpotifyRemote: NSObject {
  private func unsupported(_ reject: RCTPromiseRejectBlock) {
    reject("UNSUPPORTED", "Spotify App Remote is not implemented on iOS yet", nil)
  }

  @objc func configure(_ clientId: String, redirectUri: String) {}
  @objc func addListener(_ eventName: String) {}
  @objc func removeListeners(_ count: Double) {}

  @objc func isSpotifyInstalled(_ resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    resolve(false)
  }
  @objc func connect(_ resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) { unsupported(reject) }
  @objc func disconnect(_ resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) { unsupported(reject) }
  @objc func isConnected(_ resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) { resolve(false) }
  @objc func playUri(_ uri: String, resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) { unsupported(reject) }
  @objc func pause(_ resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) { unsupported(reject) }
  @objc func resume(_ resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) { unsupported(reject) }
  @objc func getPlayerState(_ resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) { unsupported(reject) }
}
```

- [ ] **Step 2: Create the podspec**

`modules/spotify-remote/spotify-remote.podspec`:
```ruby
require "json"
package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "spotify-remote"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = "https://kokonada.app"
  s.license      = "UNLICENSED"
  s.authors      = "Kokonada"
  s.platforms    = { :ios => "13.0" }
  s.source       = { :git => "" }
  s.source_files = "ios/**/*.{swift}"
  install_modules_dependencies(s)
end
```

- [ ] **Step 3: Commit** (no build — Windows toolchain cannot build iOS; verified later on a Mac)

```bash
git add modules/spotify-remote/ios modules/spotify-remote/spotify-remote.podspec
git commit -m "feat: ios spotify-remote stub rejecting unsupported"
```

---

## Task 4: App integration — adapter, readiness, config, jest mock, remove dead deps (TDD)

**Files:**
- Modify: `src/experience/player/spotifyRemoteAdapter.ts` (full rewrite)
- Modify: `src/experience/playback/playbackServices.ts:4,22-27` (import + getToken)
- Modify: `src/health/config.ts` (add Spotify client id + redirect uri)
- Modify: `jest.setup.js:78-90` (swap the mock)
- Modify: `package.json` (remove dead deps)
- Test: `src/experience/player/__tests__/spotifyRemoteAdapter.test.ts` (new)

**Interfaces:**
- Consumes: `SpotifyRemote` wrapper from Task 1; `SpotifyRemoteLike` from `spotifyController.ts`.
- Produces: `spotifyRemoteAdapter: SpotifyRemoteLike` and `getSpotifyReadiness(): Promise<string | null>`.

- [ ] **Step 1: Add Spotify config**

Add to `src/health/config.ts`:
```ts
// Spotify App Remote identity. MUST match the values registered in the Spotify
// Developer Dashboard (package com.kokonadahealth + signing SHA-1). App Remote
// authorizes on-device (installed Spotify app + showAuthView), so redirectUri is a
// registration match key, not a browser redirect target.
export const SPOTIFY_CLIENT_ID = '<SPOTIFY_CLIENT_ID>'; // from the Spotify dashboard
export const SPOTIFY_REDIRECT_URI = 'kokonadahealth://spotify-callback';
```
(Use the real client id from the Spotify dashboard — the same `SPOTIFY_CLIENT_ID` the backend uses.)

- [ ] **Step 2: Write the failing adapter-contract test**

`src/experience/player/__tests__/spotifyRemoteAdapter.test.ts`:
```ts
// Verify the adapter maps @kokonada/spotify-remote onto SpotifyRemoteLike, ignoring
// the token arg (App Remote has no token), and maps player state shape.
const mod = {
  configure: jest.fn(),
  isSpotifyInstalled: jest.fn().mockResolvedValue(true),
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  isConnected: jest.fn().mockResolvedValue(true),
  playUri: jest.fn().mockResolvedValue(undefined),
  pause: jest.fn().mockResolvedValue(undefined),
  resume: jest.fn().mockResolvedValue(undefined),
  getPlayerState: jest.fn().mockResolvedValue({ isPaused: true, trackUri: 'spotify:track:x' }),
  onRemoteDisconnected: jest.fn(() => () => {}),
};
jest.mock('@kokonada/spotify-remote', () => ({ SpotifyRemote: mod }));

import { spotifyRemoteAdapter, getSpotifyReadiness } from '../spotifyRemoteAdapter';

test('connect ignores the token arg and calls native connect', async () => {
  await spotifyRemoteAdapter.connect('IGNORED_TOKEN');
  expect(mod.connect).toHaveBeenCalledTimes(1);
  expect(mod.connect).toHaveBeenCalledWith(); // no args passed through
});

test('getPlayerState maps trackUri onto track.uri', async () => {
  const s = await spotifyRemoteAdapter.getPlayerState!();
  expect(s).toEqual({ isPaused: true, track: { uri: 'spotify:track:x' } });
});

test('getSpotifyReadiness returns "ready" when installed, null when not', async () => {
  mod.isSpotifyInstalled.mockResolvedValueOnce(true);
  await expect(getSpotifyReadiness()).resolves.toBe('ready');
  mod.isSpotifyInstalled.mockResolvedValueOnce(false);
  await expect(getSpotifyReadiness()).resolves.toBeNull();
});

test('addListener wires remoteDisconnected through onRemoteDisconnected', () => {
  const cb = jest.fn();
  spotifyRemoteAdapter.addListener('remoteDisconnected', cb);
  expect(mod.onRemoteDisconnected).toHaveBeenCalledWith(cb);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `./node_modules/.bin/jest spotifyRemoteAdapter --no-coverage`
Expected: FAIL — `getSpotifyReadiness` not exported / adapter still imports the old lib.

- [ ] **Step 4: Rewrite the adapter**

Replace the entire contents of `src/experience/player/spotifyRemoteAdapter.ts`:
```ts
import { SpotifyRemote } from '@kokonada/spotify-remote';
import type { SpotifyRemoteLike } from './spotifyController';
import { SPOTIFY_CLIENT_ID, SPOTIFY_REDIRECT_URI } from '../../health/config';

// Configure the native module once with app identity (dashboard-registered client +
// redirect). App Remote authorizes on-device; there is no access token — connect()
// takes none and the token passed by the controller is intentionally ignored.
SpotifyRemote.configure(SPOTIFY_CLIENT_ID, SPOTIFY_REDIRECT_URI);

// Track disconnect unsubscribers so removeAllListeners can detach them.
let offDisconnect: (() => void) | null = null;

export const spotifyRemoteAdapter: SpotifyRemoteLike = {
  connect: async (_token: string) => { await SpotifyRemote.connect(); },
  disconnect: async () => { await SpotifyRemote.disconnect(); },
  isConnectedAsync: () => SpotifyRemote.isConnected(),
  playUri: async (uri: string) => { await SpotifyRemote.playUri(uri); },
  pause: async () => { await SpotifyRemote.pause(); },
  resume: async () => { await SpotifyRemote.resume(); },
  getPlayerState: async () => {
    const s = await SpotifyRemote.getPlayerState();
    return { isPaused: !!s?.isPaused, track: s?.trackUri ? { uri: s.trackUri } : undefined };
  },
  addListener: (event: string, cb: (...args: any[]) => void) => {
    // The controller only listens for 'remoteDisconnected'.
    if (event === 'remoteDisconnected') offDisconnect = SpotifyRemote.onRemoteDisconnected(cb);
  },
  removeAllListeners: () => { offDisconnect?.(); offDisconnect = null; },
};

// Readiness gate replacing the old token fetch: App Remote can only connect when the
// Spotify app is installed. Returns a non-null sentinel so the controller's getToken
// gate passes; null (not installed / error) makes the controller stay disconnected.
export async function getSpotifyReadiness(): Promise<string | null> {
  try {
    return (await SpotifyRemote.isSpotifyInstalled()) ? 'ready' : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Point playbackServices at the new readiness fn**

In `src/experience/playback/playbackServices.ts`:
- Line 4, change the import:
```ts
import { spotifyRemoteAdapter, getSpotifyReadiness } from '../player/spotifyRemoteAdapter';
```
- In the `player` construction (around line 22–27), change `getToken`:
```ts
export const player = new SpotifyPlayerController({
  remote: spotifyRemoteAdapter,
  getToken: getSpotifyReadiness,
  onStateChange: (status) => playerStatusStore.getState().set(status),
});
```

- [ ] **Step 6: Swap the jest mock**

In `jest.setup.js`, replace the `react-native-spotify-remote` mock (lines ~78–90) with:
```js
jest.mock('@kokonada/spotify-remote', () => ({
  SpotifyRemote: {
    configure: jest.fn(),
    isSpotifyInstalled: jest.fn().mockResolvedValue(false),
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    isConnected: jest.fn().mockResolvedValue(false),
    playUri: jest.fn().mockResolvedValue(undefined),
    pause: jest.fn().mockResolvedValue(undefined),
    resume: jest.fn().mockResolvedValue(undefined),
    getPlayerState: jest.fn().mockResolvedValue({ isPaused: true, trackUri: null }),
    onRemoteDisconnected: jest.fn(() => () => {}),
  },
}));
```

- [ ] **Step 7: Remove the dead dependencies**

Edit `package.json`: delete the `"react-native-spotify-remote": "^0.3.10",` line. (`react-native-events`
is only its transitive dep and is not a direct dependency — nothing else to remove.) Then:
Run: `npm install --no-audit --no-fund`
Expected: `react-native-spotify-remote` removed from the tree; lockfile updated.

- [ ] **Step 8: Run the adapter test — verify it passes**

Run: `./node_modules/.bin/jest spotifyRemoteAdapter --no-coverage`
Expected: PASS (4 tests).

- [ ] **Step 9: Run the FULL mobile suite — verify the stable core is green**

Run: `./node_modules/.bin/jest`
Expected: all suites green (was 42 suites / 361 tests; now +1 adapter suite +1 module suite). If a
suite that imports the old lib fails, it is a leftover mock/import — fix the import, do not touch the
controller/orchestrator logic.

- [ ] **Step 10: Commit**

```bash
git add src/experience/player/spotifyRemoteAdapter.ts src/experience/player/__tests__/spotifyRemoteAdapter.test.ts src/experience/playback/playbackServices.ts src/health/config.ts jest.setup.js package.json package-lock.json
git commit -m "feat: route playback through spotify-remote turbomodule, drop dead lib"
```

---

## Task 5: Pause & Guide — Spotify Dashboard registration + device prerequisites

> This task is **human/portal work** (the AI cannot log into the Spotify dashboard). It MUST complete
> before Task 6. No code; the deliverable is a correctly registered app + a device ready to test.

- [ ] **Step 1: Extract the debug signing SHA-1**

Run (from `mobile/KokonadaHealth/android`, PowerShell):
`.\gradlew.bat :app:signingReport`
Copy the **SHA-1** under `Variant: debug` / `Config: debug`. (Also note the release SHA-1 when a release
keystore exists.)

- [ ] **Step 2: Register the app in the Spotify Developer Dashboard** (human)

At https://developer.spotify.com/dashboard → the Kokonada app → **Settings**:
- **Android Packages** → add package `com.kokonadahealth` with the debug SHA-1 from Step 1 (add the
  release SHA-1 too when available).
- **Redirect URIs** → add `kokonadahealth://spotify-callback` (must equal `SPOTIFY_REDIRECT_URI`).
- Save. Confirm the app has App Remote access (default for dashboard apps).

- [ ] **Step 3: Prepare the Galaxy** (human)
- Install the **Spotify** app from the Play Store and **log in** with a real account.
- Keep the device connected via USB with debugging authorized (`adb devices` shows it as `device`).

- [ ] **Step 4: Confirm readiness** — reply "DONE" once the dashboard shows the package + SHA-1 + redirect
  and Spotify is installed/logged in on the Galaxy.

---

## Task 6: Device build + on-device smoke test

**Interfaces:** Consumes everything above. Produces a running app on the Galaxy with working playback.

- [ ] **Step 1: Ensure Metro is running** (reuse the existing session or start it)

Run (from `mobile/KokonadaHealth`): `npm start` (leave running in its own terminal).

- [ ] **Step 2: Build + install the debug app**

Run (from `mobile/KokonadaHealth/android`, PowerShell):
`.\gradlew.bat :app:installDebug -PreactNativeDevServerPort=8081`
Expected: `BUILD SUCCESSFUL` and the app installs on the Galaxy. (This is the first build that should
succeed end-to-end — the dead library is gone and worklets is declared.)

- [ ] **Step 3: Launch the app**

Run: `adb shell am start -n com.kokonadahealth/.MainActivity`
Expected: the app opens on the device.

- [ ] **Step 4: Smoke-test playback** (on-device, manual)
- Log in; ensure Spotify is linked so a playlist can generate.
- Trigger a generation → a track should start playing via Spotify (App Remote `connect` shows the
  Spotify consent the first time → grant it).
- Verify **pause**, **resume**, and that killing the Spotify app surfaces a degraded (not crashed)
  state and the Profile Spotify badge flips to disconnected.
- Capture `adb logcat -s ReactNativeJS:* SpotifyRemote:*` if anything misbehaves.

- [ ] **Step 5: Commit any device-driven fixes** (e.g., corrected Spotify exception class names in
  `SpotifyRemoteModule.kt` from Task 2 Step 6).

```bash
git add -A
git commit -m "fix: on-device spotify app remote adjustments"
```

---

## Task 7: Shadow QA attack pass + Squad 6 handoff

**Interfaces:** Consumes the working module. Produces pinned regression guards + a green build for Squad 6.

- [ ] **Step 1: Write hostile adapter/controller tests** in
  `src/__tests__/shadow.spotifyRemote.test.ts` driving the `SpotifyPlayerController` against a fake
  `SpotifyRemoteLike` for: connect rejects `SPOTIFY_NOT_INSTALLED`; command rejects mid-play (severance)
  → controller degrades to `disconnected`, `{ ok:false }`; reconnect budget exhausts and stops;
  `getSpotifyReadiness` returns null on throw. (The controller already has this behavior — these pin it
  against the new adapter contract.)

```ts
import { SpotifyPlayerController, type SpotifyRemoteLike } from '../experience/player/spotifyController';

function fakeRemote(over: Partial<SpotifyRemoteLike> = {}): SpotifyRemoteLike {
  return {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    isConnectedAsync: jest.fn().mockResolvedValue(false),
    playUri: jest.fn().mockResolvedValue(undefined),
    pause: jest.fn().mockResolvedValue(undefined),
    resume: jest.fn().mockResolvedValue(undefined),
    addListener: jest.fn(),
    removeAllListeners: jest.fn(),
    ...over,
  };
}

test('connect failure (SPOTIFY_NOT_INSTALLED) degrades to disconnected', async () => {
  const remote = fakeRemote({ connect: jest.fn().mockRejectedValue(new Error('SPOTIFY_NOT_INSTALLED')) });
  const c = new SpotifyPlayerController({ remote, getToken: async () => 'ready' });
  expect(await c.connect()).toBe(false);
  expect(c.getState()).toBe('disconnected');
});

test('command severance mid-play returns ok:false and disconnects', async () => {
  const remote = fakeRemote({
    connect: jest.fn().mockResolvedValue(undefined),
    playUri: jest.fn().mockRejectedValue(new Error('CONNECTION_FAILED')),
  });
  const c = new SpotifyPlayerController({ remote, getToken: async () => 'ready' });
  await c.connect();
  expect(await c.play('spotify:track:x')).toEqual({ ok: false });
  expect(c.getState()).toBe('disconnected');
});
```

- [ ] **Step 2: Run the shadow suite — verify pass**

Run: `./node_modules/.bin/jest shadow.spotifyRemote --no-coverage`
Expected: PASS.

- [ ] **Step 3: Run the full mobile suite — final gate**

Run: `./node_modules/.bin/jest`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add src/__tests__/shadow.spotifyRemote.test.ts
git commit -m "test: pin spotify-remote failure-degradation guards"
```

- [ ] **Step 5: Open the PR**

```bash
git push -u origin feat/spotify-playback-turbomodule
gh pr create --title "Spotify playback: custom App Remote TurboModule (replaces dead lib)" --body-file <(printf '%s\n' "Replaces the unmaintained react-native-spotify-remote with a purpose-built local TurboModule wrapping Spotify App Remote 0.8.0, behind the existing SpotifyRemoteLike port. On-device auth (no backend token). Unblocks the RN 0.86 device build." "" "Spec: docs/superpowers/specs/2026-07-04-spotify-playback-turbomodule-design.md" "" "🤖 Generated with [Claude Code](https://claude.com/claude-code)")
```

- [ ] **Step 6: Handoff to Squad 6** — with the app now building end-to-end on the Galaxy, resume the
  A11 on-device verification checklist (login → history → profile → pulse → logout → GDPR).

---

## Self-Review Notes

- **Spec coverage:** §5 module → Tasks 1–3; §5.5 app changes + §5.6 removals → Task 4; §7 config → Task 4
  Step 1; §11 Pause & Guide → Task 5; §8 flow + Definition of Done device checks → Task 6; §10 testing →
  Tasks 1/4/7. §6 (no backend change) → correctly produces no backend task.
- **Placeholders:** the only intentional fill-ins are `<SPOTIFY_CLIENT_ID>` (a real secret pulled from
  the dashboard) and the exact Spotify exception class names (verified against the AAR in Task 2 Step 6,
  with a safe `else` fallback). Both are flagged, not silent.
- **Type consistency:** `getSpotifyReadiness` (not `getSpotifyAccessToken`) used consistently in Task 4
  Steps 4–5; wrapper method names (`onRemoteDisconnected`, `isSpotifyInstalled`, `getPlayerState`
  returning `{ isPaused, trackUri }`) consistent across Tasks 1, 4, and the mocks.
