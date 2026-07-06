# Design Spec — Frontend Tooling Foundation (Phase B/C/D, New-Screens-Only)

- **Date:** 2026-07-04
- **Status:** Approved (design); implementation plan to follow
- **Branch:** new branch off `main`, cut after `feat/spotify-playback-turbomodule` merges
- **Owner persona:** Frontend Experience (continuation of A8–A10)

## 1. Context & Problem

Daniel proposed a forward-looking "living organism" UI architecture (Skia liquid mesh
gradients, Lottie micro-interactions, gyroscope-reactive 3D via React Three Fiber, Tamagui
stacks + design tokens, Size Matters scaling, Vector Icons, Reanimated/Moti physics, Gesture
Handler, Haptic Feedback, React Navigation + BootSplash) with an operational mandate banning
`StyleSheet.create` for core visual panels, binding all active UI properties to biometric
state, and a bio-neon dark aesthetic.

This lands on top of an app that is **not greenfield**: Sprints A6–A10 of the approved
"Monster Machine" blueprint already shipped and shadow-QA'd a live Experience layer —
`RadialWheel.tsx` (Skia canvas + gesture-handler), `BioAura.tsx` (Skia Blur bio-aura shader),
`GenerateScreen`, `PulseScreen`, `NowPlayingScreen`, `HistoryScreen` — all Reanimated 4 +
Skia + `StyleSheet`-free-but-not-Tamagui, all pinned by regression tests (PRs #42–46).

**Decision (Daniel, product owner):** hybrid/additive scope. The five existing screens are
frozen — out of bounds for refactoring unless explicitly requested. The new tooling and
Mandate 4 operational rules apply **only** to screens, components, and sprints built from
this point forward.

## 2. Approved Decisions

| # | Decision | Choice |
|---|----------|--------|
| D1 | Existing-screen protection | RadialWheel, BioAura, GenerateScreen, PulseScreen, NowPlayingScreen keep their current architecture and styling untouched. |
| D2 | New-tooling scope | Tamagui, Moti, Lottie, Size Matters, Vector Icons, Haptic Feedback, BootSplash apply strictly to new screens/components going forward. |
| D3 | React Three Fiber | **Deferred.** Bare RN CLI app (no Expo) has no GL/WebGPU backend installed; R3F needs `expo-gl` (bare-workflow Expo modules) or `react-native-wgpu`. Given the recent unmaintained-native-library dead end (Spotify AAR), R3F gets its own follow-up spec once a backend is chosen and a concrete 3D screen exists. Not part of this pass. |
| D4 | Icon set | `react-native-vector-icons` ships with **MaterialCommunityIcons + Feather** initially. |
| D5 | Boot splash artwork | Placeholder Kokonada wordmark now (native wiring complete and testable); swap real art later with zero code changes. |
| D6 | Branch hygiene | In-flight `feat/spotify-playback-turbomodule` work committed first (9036db9) for a clean tree before any new dependency touches `package.json`. |

## 3. Guiding Principle

**Additive, not disruptive.** Every change in this pass either (a) adds a new dependency with
zero consumers yet, or (b) touches shared root infrastructure (`babel.config.js`, `App.tsx`,
`MainActivity.kt`, `Info.plist`) in a way that is behavior-neutral for existing screens because
the new capabilities are opt-in per component. No existing screen's render output or test
changes as a result of this spec.

## 4. Non-Goals (YAGNI)

- No new screens or components built in this pass — tooling only.
- No changes to RadialWheel, BioAura, GenerateScreen, PulseScreen, NowPlayingScreen, or their
  tests.
- No React Three Fiber (D3 — separate future spec).
- No custom BootSplash artwork design (D5 — placeholder wordmark).
- No retrofit of Mandate 4 styling rules onto anything that already exists.

## 5. Architecture

### 5.1 New dependencies

| Package | Version | Native surface | Notes |
|---|---|---|---|
| `tamagui`, `@tamagui/config`, `@tamagui/core` | 2.4.1 | None (JS + babel) | Peer `react >=19` — satisfied (19.2.3). Animation driver resolves to `@tamagui/animations-reanimated`, reusing the Reanimated 4.5.1 already installed — no second animation runtime. |
| `@tamagui/babel-plugin` | 2.4.1 | Babel only | Compile-time style extraction; disabled in dev for fast refresh. |
| `moti` | 0.30.0 | None (JS) | Peer `react-native-reanimated` (already installed) — thin declarative layer, no new native code. |
| `lottie-react-native` | 7.3.8 | Android + iOS native module | Optional peers (`@lottiefiles/dotlottie-react`, `react-native-windows`) — not needed, not installed. |
| `react-native-size-matters` | 0.4.2 | None (pure JS) | Scaling helpers only. |
| `react-native-vector-icons` | 10.3.0 | Android + iOS native module + fonts | MaterialCommunityIcons + Feather font files only (not the full icon-set bundle). |
| `@types/react-native-vector-icons` | 6.4.18 | — | Dev-only types. |
| `react-native-haptic-feedback` | 3.0.0 | Android + iOS native module | Peer `react-native >=0.71.0` — satisfied (0.86.0). Declares `VIBRATE` permission via manifest merge. |
| `react-native-bootsplash` | 7.3.2 | Android + iOS native module + generated assets | Placeholder wordmark per D5. |

### 5.2 Shared infra touches

- **`babel.config.js`** — add `@tamagui/babel-plugin` **before** `react-native-reanimated/plugin`
  (Tamagui's plugin must run first; Reanimated's worklet plugin stays last per the existing
  code comment).
- **`App.tsx`** — wrap the existing root tree in `<TamaguiProvider config={tamaguiConfig}
  defaultTheme="dark">`. Purely additive: no existing child screen consumes Tamagui yet, so
  nothing downstream changes. Also mount `RNBootSplash.hide({ fade: true })` after the app's
  first meaningful paint (existing bootstrap effect).
- **`android/app/src/main/java/.../MainActivity.kt`** — call `RNBootSplash.init(this,
  R.style.BootTheme)` before `super.onCreate(null)`, per BootSplash's documented pattern.
- **`android/app/src/main/res/`** — generated BootSplash drawable/style resources (placeholder
  wordmark); `styles.xml` gains `BootTheme`.
- **`android/app/src/main/AndroidManifest.xml`** — `VIBRATE` permission (merged automatically
  from `react-native-haptic-feedback`, listed explicitly for clarity); BootSplash theme
  reference on the launcher activity.
- **iOS `Info.plist`** — `UIAppFonts` array listing the MaterialCommunityIcons + Feather `.ttf`
  files. iOS stays config-only (not build-verified on this Windows toolchain), matching the
  Spotify TurboModule precedent — verified later on a Mac.
- **`tamagui.config.ts`** (new file, repo root of `mobile/KokonadaHealth`) — minimal config
  importing `@tamagui/config/v4` defaults plus a dark bio-neon theme token override (accent
  colors for the mood/HR states already established in `auraUniforms.ts`), so future screens
  have tokens ready without re-deriving the palette.

### 5.3 What does NOT change

- No existing screen imports Tamagui/Moti/Lottie/icons/haptics in this pass.
- No existing test file changes.
- `playbackServices`, `socketClient`, the three-lane state architecture, and all A6–A10
  deliverables are untouched.

## 6. Testing Strategy

- Mobile jest suite (44 suites / 369 tests) must stay green after each dependency add —
  installing a library with zero consumers should never break existing tests; if it does,
  that's a signal the library's autolinking/codegen conflicts with something existing (e.g.
  Tamagui's babel plugin interacting with the Reanimated plugin) and needs isolation before
  proceeding.
- New pure-logic smoke test: `tamagui.config.ts` loads without throwing (config validity), run
  under jest via a plain `require`.
- No new UI-behavior tests yet — there is no new UI behavior, only plumbing.
- Android: buildable and on-device smoke-testable here (same toolchain as the Spotify
  TurboModule work). iOS: config-only, Mac verification deferred.

## 7. Rollout — Pause & Guide

1. Cut a new branch off `main` after `feat/spotify-playback-turbomodule` merges.
2. Install dependencies; wire babel, `App.tsx`, `tamagui.config.ts`.
3. Native wiring: BootSplash (`MainActivity.kt`, manifest, generated placeholder assets),
   vector-icons fonts (Android autolink + iOS `Info.plist`), haptic-feedback permission.
4. Full mobile suite green; Android on-device smoke (app launches, boot splash shows and
   hides, no crash) — the minimum bar since there's no consuming UI yet.
5. **Pause & Guide:** none required — no dashboard registrations or external accounts needed
   for this pass (contrast with the Spotify TurboModule's dashboard/SHA-1 step).

## 8. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Tamagui babel plugin ordering conflicts with Reanimated's worklet plugin | Plugin order pinned (Tamagui first, Reanimated last); full suite run after the babel change specifically, before adding anything else. |
| `react-native-bootsplash` asset generation needs a source image | Use a generated placeholder text wordmark now (D5); swapping real art later is a config-only change. |
| Vector-icons font linking drift between Android autolink and iOS manual `Info.plist` step | Document both steps explicitly in the plan; verify Android on-device now, flag iOS step for Mac verification alongside the existing Spotify iOS-stub backlog item. |
| Scope creep into "let's also touch an existing screen while we're in here" | D1/D2 are hard boundaries — any temptation to touch RadialWheel/BioAura/etc. surfaces as a separate, explicitly-requested task. |

## 9. Definition of Done

- All eight dependencies installed at the pinned versions above; `package.json` +
  `package-lock.json` updated.
- `babel.config.js`, `App.tsx`, `tamagui.config.ts`, `MainActivity.kt`, Android manifest/res,
  iOS `Info.plist` wired per §5.2.
- Mobile suite green (44+ suites, 369+ tests — count may grow by the one config smoke test).
- Android on-device smoke: app builds, boot splash placeholder shows/hides, no crash.
- Zero diffs to RadialWheel, BioAura, GenerateScreen, PulseScreen, NowPlayingScreen, or their
  tests.
- React Three Fiber explicitly out of scope, tracked as a follow-up spec.
