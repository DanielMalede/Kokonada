# Frontend Tooling Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install and wire Tamagui, Moti, Lottie, Size Matters, Vector Icons, Haptic Feedback,
and BootSplash into `mobile/KokonadaHealth` for future screens only, with zero behavior change
to the five existing A8–A10 Experience screens.

**Architecture:** Each dependency is added in its own task, ordered lowest-risk first (pure-JS,
zero-consumer packages) to highest-risk last (BootSplash: native resource generation + Kotlin
wiring + on-device verification). Only two shared files gain new imports — `babel.config.js`
(Tamagui's babel plugin) and `App.tsx` (`TamaguiProvider` wrap + `BootSplash.hide()`) — because
Tamagui and BootSplash are the only two packages with a runtime consumer in this pass. The other
five packages (Moti, Size Matters, Lottie, Vector Icons, Haptic Feedback) are installed and
natively linked but have zero JS call sites, matching the spec's "tooling only" scope.

**Tech Stack:** React Native 0.86 (New Architecture, Hermes), TypeScript, Jest
(`@react-native/jest-preset`), npm, Gradle (Android), CocoaPods (iOS, config-only — not
buildable on this Windows toolchain).

## Global Constraints

- Zero diffs to `src/experience/wheel/RadialWheel.tsx`, `src/experience/aura/BioAura.tsx`,
  `src/experience/generate/GenerateScreen.tsx`, `src/experience/pulse/PulseScreen.tsx`,
  `src/experience/playback/NowPlayingScreen.tsx`, or any of their tests. (Design spec D1.)
- React Three Fiber is out of scope for this plan entirely. (Design spec D3.)
- Mobile jest suite must stay green (42 suites / 361 tests at the start of this plan, verified as
  the clean baseline on `main` in the isolated worktree) after
  every single task — never leave it red between commits.
- Package versions are pinned exactly as researched below; do not let `npm install` float to a
  newer major without re-verifying the API surface used in this plan.
- Icon set: MaterialCommunityIcons + Feather only. (Design spec D4.)
- BootSplash artwork: placeholder wordmark now, real art later. (Design spec D5.)
- iOS native wiring is written but **not build-verified** on this Windows machine — same
  config-only pattern used for the Spotify TurboModule iOS stub. Android **is** build-verified
  on-device (device `RFCT40SGAWM` is connected via `adb`).
- Commit messages: short, single-line, no body (matches this repo's existing style).

---

### Task 0: Branch setup — DONE

The design spec (§7, step 1) calls for a fresh branch off `main`, independent of
`feat/spotify-playback-turbomodule` (which hasn't merged yet and covers unrelated native-build
work — conflating the two in one branch/PR would complicate review). This plan's work has no
dependency on the Spotify TurboModule changes.

Satisfied via an isolated git worktree (`.claude/worktrees/frontend-tooling-foundation`, branch
`worktree-frontend-tooling-foundation`, based on `origin/main` at commit `b705498`). `npm install`
was run and the clean baseline captured: **42 suites / 361 tests** (this superseded the plan's
original assumed baseline of 44/369, which was actually the `feat/spotify-playback-turbomodule`
branch's count — corrected throughout this plan). One full-suite run showed 3 flaky failures
(`HistoryScreen.test.tsx` among them) that vanished on immediate re-run — a known pre-existing
flake pattern in this codebase, not a regression; not caused by anything in this plan.

---

### Task 1: Pure-JS dependencies — Moti + Size Matters

**Files:**
- Modify: `mobile/KokonadaHealth/package.json` (via `npm install`)
- Modify: `mobile/KokonadaHealth/package-lock.json` (via `npm install`)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `moti` and `react-native-size-matters` available as importable packages for future
  screens. No exports from this task are consumed by later tasks in this plan.

- [ ] **Step 1: Install the packages**

```bash
cd mobile/KokonadaHealth
npm install moti@0.30.0 react-native-size-matters@0.4.2
```

- [ ] **Step 2: Run the full mobile suite — confirm no regression**

Run: `npm test -- --silent`
Expected: `Test Suites: 42 passed, 42 total` / `Tests: 361 passed, 361 total` (unchanged — neither
package has a consumer yet, so this is a pure regression check, not a new-behavior test).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add moti and react-native-size-matters (no consumers yet)"
```

---

### Task 2: Tamagui — install, babel wiring, config, App root provider

**Files:**
- Modify: `mobile/KokonadaHealth/package.json`, `package-lock.json` (via `npm install`)
- Modify: `mobile/KokonadaHealth/babel.config.js`
- Modify: `mobile/KokonadaHealth/jest.config.js`
- Create: `mobile/KokonadaHealth/tamagui.config.ts`
- Create: `mobile/KokonadaHealth/__tests__/tamaguiConfig.test.ts`
- Modify: `mobile/KokonadaHealth/App.tsx`

**Interfaces:**
- Consumes: nothing new from Task 1.
- Produces: `tamagui.config.ts` default-exports a built `TamaguiInternalConfig` object (call it
  `tamaguiConfig`) that any later task or future screen imports as
  `import tamaguiConfig from '../../tamagui.config'` (path relative to caller). `App.tsx`'s root
  tree is now wrapped in `<TamaguiProvider config={tamaguiConfig} defaultTheme="dark">` — no
  later task in this plan depends on this directly, but future screens will.

- [ ] **Step 1: Install the packages**

```bash
cd mobile/KokonadaHealth
npm install tamagui@2.4.1 @tamagui/core@2.4.1 @tamagui/config@2.4.1 @tamagui/babel-plugin@2.4.1
```

- [ ] **Step 2: Write the failing config-validity test**

Create `mobile/KokonadaHealth/__tests__/tamaguiConfig.test.ts`:

```ts
/**
 * @format
 */

import tamaguiConfig from '../tamagui.config';

test('tamagui config builds without throwing', () => {
  expect(tamaguiConfig).toBeDefined();
  expect(tamaguiConfig.fonts).toBeDefined();
  expect(tamaguiConfig.themes).toBeDefined();
});
```

- [ ] **Step 3: Run it — confirm it fails**

Run: `npx jest __tests__/tamaguiConfig.test.ts`
Expected: FAIL — `Cannot find module '../tamagui.config'` (file doesn't exist yet).

- [ ] **Step 4: Create `tamagui.config.ts`**

Create `mobile/KokonadaHealth/tamagui.config.ts`:

```ts
import { createTamagui } from '@tamagui/core';
import { defaultConfig } from '@tamagui/config/v4';

const tamaguiConfig = createTamagui(defaultConfig);

export default tamaguiConfig;

export type AppTamaguiConfig = typeof tamaguiConfig;

declare module '@tamagui/core' {
  interface TamaguiCustomConfig extends AppTamaguiConfig {}
}
```

- [ ] **Step 5: Allowlist Tamagui in the jest transform**

Tamagui ships ESM in `node_modules` (like Redux Toolkit / Zustand already allowlisted here), so
Jest's default node_modules transform-skip must be widened.

Modify `mobile/KokonadaHealth/jest.config.js` — change the `transformIgnorePatterns` line from:

```js
    'node_modules/(?!(?:@react-native|react-native|@reduxjs/toolkit|immer|redux|reselect|redux-thunk|react-redux|zustand|@react-navigation|react-native-screens)/)',
```

to:

```js
    'node_modules/(?!(?:@react-native|react-native|@reduxjs/toolkit|immer|redux|reselect|redux-thunk|react-redux|zustand|@react-navigation|react-native-screens|@tamagui|tamagui)/)',
```

- [ ] **Step 6: Wire the babel plugin**

Modify `mobile/KokonadaHealth/babel.config.js` — the Tamagui plugin must run before Reanimated's
worklet plugin (which stays last, per the existing comment):

```js
module.exports = {
  presets: ['module:@react-native/babel-preset'],
  // @tamagui/babel-plugin extracts styled-component usage at compile time; it must run
  // BEFORE Reanimated's worklet plugin, which in turn MUST be listed last. Required by
  // the hot-lane gesture worklets in the radial wheel; a no-op for files without worklets.
  plugins: [
    [
      '@tamagui/babel-plugin',
      {
        components: ['tamagui'],
        config: './tamagui.config.ts',
        disableExtraction: process.env.NODE_ENV === 'development',
      },
    ],
    'react-native-reanimated/plugin',
  ],
};
```

- [ ] **Step 7: Run the new test — confirm it passes**

Run: `npx jest __tests__/tamaguiConfig.test.ts`
Expected: PASS.

- [ ] **Step 8: Run the full suite — confirm the babel change didn't break anything else**

Run: `npm test -- --silent`
Expected: `Test Suites: 43 passed, 43 total` / `Tests: 362 passed, 362 total` (one new test; the
babel plugin reorder is the riskiest shared-infra change in this whole plan, since babel runs
project-wide — this is the checkpoint that proves it didn't break the existing screens' own
tests, e.g. `wheelGeometry.test.ts`, `auraUniforms.test.ts`).

- [ ] **Step 9: Wrap `App.tsx` root in `TamaguiProvider`**

Modify `mobile/KokonadaHealth/App.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { Provider } from 'react-redux';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TamaguiProvider } from 'tamagui';
import { store } from './src/state/store';
import RootNavigator from './src/navigation/RootNavigator';
import { SignInScreen } from './src/auth/SignInScreen';
import { AppLifecycle } from './src/experience/playback/AppLifecycle';
import { currentUserStore } from './src/auth/currentUser';
import { startApp } from './src/prodBootstrap';
import tamaguiConfig from './tamagui.config';

export default function App() {
  const [user, setUser] = useState(() => currentUserStore.getState().user);

  useEffect(() => {
    void startApp();
    // The gate is reactive: identity recovery (startApp), login, and logout all flow
    // through currentUserStore, so this single subscription drives tabs ↔ SignIn.
    return currentUserStore.subscribe((s) => setUser(s.user));
  }, []);

  return (
    <TamaguiProvider config={tamaguiConfig} defaultTheme="dark">
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Provider store={store}>
          <SafeAreaProvider>
            {user ? (
              <>
                <AppLifecycle />
                <RootNavigator />
              </>
            ) : (
              <SignInScreen />
            )}
          </SafeAreaProvider>
        </Provider>
      </GestureHandlerRootView>
    </TamaguiProvider>
  );
}
```

(Only the wrapping element and the two new imports changed — the auth-gated tree inside is
byte-for-byte the same as before.)

- [ ] **Step 10: Run the full suite — confirm `App.test.tsx` still renders headlessly**

Run: `npm test -- --silent`
Expected: `Test Suites: 43 passed, 43 total` / `Tests: 362 passed, 362 total` (unchanged from
Step 8 — `TamaguiProvider` is pure JS/RN-View based, same category as `SafeAreaProvider`, which
already renders un-mocked in this same headless test).

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json babel.config.js jest.config.js tamagui.config.ts __tests__/tamaguiConfig.test.ts App.tsx
git commit -m "feat: install and wire tamagui (new-screens-only, App root provider)"
```

---

### Task 3: react-native-vector-icons (MaterialCommunityIcons + Feather)

**Files:**
- Modify: `mobile/KokonadaHealth/package.json`, `package-lock.json` (via `npm install`)
- Modify: `mobile/KokonadaHealth/android/app/build.gradle`
- Modify: `mobile/KokonadaHealth/ios/KokonadaHealth/Info.plist`

**Interfaces:**
- Consumes: nothing from Tasks 1–2.
- Produces: `MaterialCommunityIcons.ttf` + `Feather.ttf` font files linked into the Android app
  and declared for iOS; no JS call site yet (future screens will
  `import Icon from 'react-native-vector-icons/MaterialCommunityIcons'`).

- [ ] **Step 1: Install the packages**

```bash
cd mobile/KokonadaHealth
npm install react-native-vector-icons@10.3.0
npm install --save-dev @types/react-native-vector-icons@6.4.18
```

- [ ] **Step 2: Wire Android font linking**

Modify `mobile/KokonadaHealth/android/app/build.gradle` — add right after the three
`apply plugin: "..."` lines at the very top of the file (before the `react { ... }` codegen
config block; do not touch the `android { ... }` block or the manifest placeholder added by the
Spotify TurboModule work):

```gradle
project.ext.vectoricons = [
    iconFontNames: ['MaterialCommunityIcons.ttf', 'Feather.ttf']
]
apply from: file("../../node_modules/react-native-vector-icons/fonts.gradle")
```

- [ ] **Step 3: Wire iOS font declaration (config-only, not build-verified here)**

Modify `mobile/KokonadaHealth/ios/KokonadaHealth/Info.plist` — add a `UIAppFonts` array entry
right after the existing `UISupportedInterfaceOrientations~ipad` array closes (before
`UIViewControllerBasedStatusBarAppearance`):

```xml
	<key>UIAppFonts</key>
	<array>
		<string>MaterialCommunityIcons.ttf</string>
		<string>Feather.ttf</string>
	</array>
```

- [ ] **Step 4: Run the full suite — confirm no regression**

Run: `npm test -- --silent`
Expected: `Test Suites: 43 passed, 43 total` / `Tests: 362 passed, 362 total` (unchanged — no JS
consumer, jest never touches Gradle or Info.plist).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json android/app/build.gradle ios/KokonadaHealth/Info.plist
git commit -m "chore: link react-native-vector-icons fonts (MaterialCommunityIcons + Feather)"
```

---

### Task 4: react-native-haptic-feedback

**Files:**
- Modify: `mobile/KokonadaHealth/package.json`, `package-lock.json` (via `npm install`)

**Interfaces:**
- Consumes: nothing from Tasks 1–3.
- Produces: `react-native-haptic-feedback`'s `trigger()` function available for future screens.
  No manual native wiring needed — its own `AndroidManifest.xml` already declares the `VIBRATE`
  permission, which Gradle's manifest merger picks up automatically (verified by reading the
  library's bundled manifest directly — no app-level manifest edit required).

- [ ] **Step 1: Install the package**

```bash
cd mobile/KokonadaHealth
npm install react-native-haptic-feedback@3.0.0
```

- [ ] **Step 2: Run the full suite — confirm no regression**

Run: `npm test -- --silent`
Expected: `Test Suites: 43 passed, 43 total` / `Tests: 362 passed, 362 total` (unchanged).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add react-native-haptic-feedback (no consumers yet)"
```

---

### Task 5: lottie-react-native

**Files:**
- Modify: `mobile/KokonadaHealth/package.json`, `package-lock.json` (via `npm install`)

**Interfaces:**
- Consumes: nothing from Tasks 1–4.
- Produces: `lottie-react-native`'s `LottieView` component available for future screens.
  Autolinked on Android (New Architecture codegen, same mechanism as
  `react-native-keychain`/`react-native-safe-area-context`); iOS needs `pod install`, which is
  deferred to Mac verification like the rest of this codebase's iOS work.

- [ ] **Step 1: Install the package**

```bash
cd mobile/KokonadaHealth
npm install lottie-react-native@7.3.8
```

- [ ] **Step 2: Run the full suite — confirm no regression**

Run: `npm test -- --silent`
Expected: `Test Suites: 43 passed, 43 total` / `Tests: 362 passed, 362 total` (unchanged).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add lottie-react-native (no consumers yet)"
```

---

### Task 6: react-native-bootsplash — placeholder wordmark + native wiring + on-device verification

**Files:**
- Modify: `mobile/KokonadaHealth/package.json`, `package-lock.json` (via `npm install`)
- Create: `mobile/KokonadaHealth/assets/bootsplash/logo.svg`
- Generated by CLI (Android): `android/app/src/main/res/values/colors.xml`,
  `android/app/src/main/res/values/styles.xml`, `android/app/src/main/res/mipmap-*/bootsplash_logo.png`,
  `android/app/src/main/res/drawable/bootsplash.xml` — exact filenames confirmed by inspecting
  `git status` after running the generator (a code-generation tool, not hand-written).
- Generated by CLI (iOS): `ios/KokonadaHealth/BootSplash.storyboard` + image assets.
- Modify: `mobile/KokonadaHealth/android/app/src/main/java/com/kokonadahealth/MainActivity.kt`
- Modify: `mobile/KokonadaHealth/ios/KokonadaHealth/Info.plist` (launch storyboard name)
- Modify: `mobile/KokonadaHealth/ios/KokonadaHealth/AppDelegate.swift`
- Modify: `mobile/KokonadaHealth/jest.setup.js`
- Modify: `mobile/KokonadaHealth/App.tsx`

**Interfaces:**
- Consumes: nothing from Tasks 1–5.
- Produces: native splash screen wired end-to-end; `App.tsx` calls
  `BootSplash.hide({ fade: true })` once `startApp()` settles.

- [ ] **Step 1: Install the package**

```bash
cd mobile/KokonadaHealth
npm install react-native-bootsplash@7.3.2
```

- [ ] **Step 2: Create the placeholder logo asset**

Create `mobile/KokonadaHealth/assets/bootsplash/logo.svg` (bio-neon placeholder wordmark — a
glowing "K" ring in the app's resting-aura blue, `hue: 210` from `auraUniforms.ts` converted to
hex; swap this single file for real art later with zero code changes):

```svg
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="14" result="blur" />
      <feMerge>
        <feMergeNode in="blur" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
  </defs>
  <circle cx="256" cy="256" r="180" fill="none" stroke="#4DA6FF" stroke-width="10" filter="url(#glow)" />
  <text x="256" y="290" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="180" font-weight="700" fill="#4DA6FF" filter="url(#glow)">K</text>
</svg>
```

- [ ] **Step 3: Run the asset generator**

```bash
cd mobile/KokonadaHealth
npx react-native-bootsplash generate assets/bootsplash/logo.svg --platforms android,ios --background "#0A0A14" --logo-width 120 --assets-output assets/bootsplash
```

- [ ] **Step 4: Inspect exactly what the generator touched**

Run: `git status --porcelain=v1 -- android/app/src/main/res ios/KokonadaHealth assets/bootsplash`
Expected: new/modified files under `android/app/src/main/res/{values,mipmap-*,drawable}` and
`ios/KokonadaHealth/BootSplash.storyboard` + image assets. Read `android/app/src/main/res/values/styles.xml`
to confirm it added a `BootTheme` style (extending `Theme.BootSplash`) — this is the style name
referenced in Step 5.

- [ ] **Step 5: Wire Android — `MainActivity.kt`**

This project uses `react-native-screens@4.25.2` (>= 4.16.0), which requires the
`RNScreensFragmentFactory` variant of BootSplash's documented wiring. Replace the full contents
of `mobile/KokonadaHealth/android/app/src/main/java/com/kokonadahealth/MainActivity.kt`:

```kotlin
package com.kokonadahealth

import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.swmansion.rnscreens.fragment.restoration.RNScreensFragmentFactory
import com.zoontek.rnbootsplash.RNBootSplash
import dev.matinzd.healthconnect.permissions.HealthConnectPermissionDelegate

class MainActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "KokonadaHealth"

  override fun onCreate(savedInstanceState: Bundle?) {
    supportFragmentManager.fragmentFactory = RNScreensFragmentFactory()
    RNBootSplash.init(this, R.style.BootTheme)
    super.onCreate(savedInstanceState)
    // Required so Health Connect permission-contract results route back to RN.
    HealthConnectPermissionDelegate.setPermissionDelegate(this)
  }

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
```

- [ ] **Step 6: Wire iOS (config-only, not build-verified here)**

Modify `mobile/KokonadaHealth/ios/KokonadaHealth/Info.plist` — change:

```xml
	<key>UILaunchStoryboardName</key>
	<string>LaunchScreen</string>
```

to:

```xml
	<key>UILaunchStoryboardName</key>
	<string>BootSplash</string>
```

Modify `mobile/KokonadaHealth/ios/KokonadaHealth/AppDelegate.swift`:

```swift
import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import RNBootSplash

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)

    factory.startReactNative(
      withModuleName: "KokonadaHealth",
      in: window,
      launchOptions: launchOptions
    )

    return true
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }

  override func customize(_ rootView: RCTRootView) {
    super.customize(rootView)
    RNBootSplash.initWithStoryboard("BootSplash", rootView: rootView)
  }
}
```

- [ ] **Step 7: Mock `react-native-bootsplash` for headless jest**

Modify `mobile/KokonadaHealth/jest.setup.js` — add alongside the other native-module mocks
(near the MMKV/Spotify block, same file):

```js
jest.mock('react-native-bootsplash', () => ({
  hide: jest.fn().mockResolvedValue(undefined),
  isVisible: jest.fn().mockResolvedValue(false),
}));
```

- [ ] **Step 8: Wire `App.tsx` to hide the splash after bootstrap settles**

Modify `mobile/KokonadaHealth/App.tsx` — only the `useEffect` body and one new import change:

```tsx
import BootSplash from 'react-native-bootsplash';
```

```tsx
  useEffect(() => {
    void startApp().finally(() => {
      void BootSplash.hide({ fade: true });
    });
    // The gate is reactive: identity recovery (startApp), login, and logout all flow
    // through currentUserStore, so this single subscription drives tabs ↔ SignIn.
    return currentUserStore.subscribe((s) => setUser(s.user));
  }, []);
```

- [ ] **Step 9: Run the full suite — confirm green with the new mock**

Run: `npm test -- --silent`
Expected: `Test Suites: 43 passed, 43 total` / `Tests: 362 passed, 362 total` (unchanged —
`App.test.tsx` now exercises the mocked `BootSplash.hide` path).

- [ ] **Step 10: Verify zero diffs to the five protected screens**

Run: `git diff --stat -- src/experience/wheel/RadialWheel.tsx src/experience/aura/BioAura.tsx src/experience/generate/GenerateScreen.tsx src/experience/pulse/PulseScreen.tsx src/experience/playback/NowPlayingScreen.tsx`
Expected: empty output (no changes).

- [ ] **Step 11: Build, install, and smoke-test on the connected Android device**

```bash
cd mobile/KokonadaHealth/android
./gradlew installDebug
```

Expected: `BUILD SUCCESSFUL`. Then launch the app on device `RFCT40SGAWM`:

```bash
adb -s RFCT40SGAWM shell am start -n com.kokonadahealth/.MainActivity
```

Watch `adb -s RFCT40SGAWM logcat *:E` for ~10 seconds while the app launches. Expected: no crash
(no `FATAL EXCEPTION` line), the placeholder splash appears briefly, then the app's normal
SignIn/tab UI shows — matching the Definition of Done ("boot splash placeholder shows/hides, no
crash").

- [ ] **Step 12: Commit**

```bash
git add package.json package-lock.json assets/bootsplash android/app/src/main/res android/app/src/main/java/com/kokonadahealth/MainActivity.kt ios/KokonadaHealth/Info.plist ios/KokonadaHealth/AppDelegate.swift ios/KokonadaHealth/BootSplash.storyboard jest.setup.js App.tsx
git commit -m "feat: wire react-native-bootsplash with placeholder wordmark"
```

---

## Final Verification (Definition of Done)

- [ ] Full mobile suite green: `npm test -- --silent` → 43 suites / 362 tests (361 original + the
  new `tamaguiConfig.test.ts`).
- [ ] `git diff --stat -- src/experience/wheel/RadialWheel.tsx src/experience/aura/BioAura.tsx src/experience/generate/GenerateScreen.tsx src/experience/pulse/PulseScreen.tsx src/experience/playback/NowPlayingScreen.tsx` against `main` is empty.
- [ ] Android on-device smoke passed (Task 6, Step 11): app launches, splash shows/hides, no crash.
- [ ] All 8 packages present in `package.json` at the pinned versions in this plan's Global
  Constraints.
- [ ] No React Three Fiber package installed.
