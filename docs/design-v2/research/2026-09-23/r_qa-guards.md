# Resilience audit: clean-slate redesign — what protects the app today, what will break, and the per-page gate

**Read-only.** I did not run any suite. Every "green" below comes from reading the code, not from a test run.

**Scope checked:**
- 117 test files under `src`, plus 11 tooling tests (lint plugin, lint ratchet, brand scripts, `App.test`).
- CI (`C:\Users\danie\Videos\Kokonada\.github\workflows\ci.yml:77-91`) runs only jest and `lint:design-system`.
- CI has no `tsc` (`:75-76`), no canvas-board check, no device run and no performance measurement.
- The handoff line "23 boards pass" refers to `C:\Users\danie\Videos\Kokonada\scripts\design\board.py`. That is headless Chrome checking the HTML boards. It is not in CI and it checks nothing in the app.

---

## 1. Prioritized findings

### Blockers (must land before page 1)

**B1 — Deleting a screen deletes its guards, and the suite stays green.** A rewrite from zero replaces a screen together with its test file. Many pinned contracts live only inside screen test files:
- S10-1 parity, `NowPlayingScreen.test.tsx:260`
- T7–T10 and D1, `ProfileScreen.test.tsx:219-420`
- M1 reveal-cancel and NP-ATTR, `NowPlayingScreen.test.tsx:407-754`
- honest-empty, `PulseScreen.test.tsx:128-175`
- inline retry and screen-reader list, `GenerateScreen.test.tsx:223-348`

Nothing counts contracts, so the mutation "delete the screen and its test" passes.

*Fix:* add a contract registry, `src/__contracts__/manifest.ts`, listing IDs (S9-1, S10-1, S11-1, S12-1, D-1…D-9, T7–T10, NP-ATTR, H1, M1, L1, L2, Fork-4A, and so on). A CI test fails if any ID has no matching test title, or if the test count drops without a RETIRE entry signed off by `resilience-auditor`.

**B2 — The low-power/thermal branch of the Definition of Done cannot be implemented.** There is no power or thermal signal anywhere in the client (`C:\Users\danie\Videos\Kokonada\docs\plans\DEV_AMBIENT_FIELD_SCOPE_AND_DEGRADATION.md:36-53`). The tokens ship only `duration` and `durationReduced` (`C:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\src\design\tokens.ts:269-271`).

*Fix, as a foundation step:*
- A native source: `PowerManager.isPowerSaveMode` plus the `ACTION_POWER_SAVE_MODE_CHANGED` broadcast, and `getCurrentThermalStatus` plus a thermal listener (API 29+).
- One `useMotionPolicy()` returning `{reduced, lowPower, thermal}`.
- A `durationLowPower` token map, with the parity test extended the way `tokens.test.ts:203-205` already does it for reduced motion.
- A stateful fake of the power source for tests.

**B3 — The "60fps floor" (`C:\Users\danie\Videos\Kokonada\docs\SCREENS.md:196`) has never been measured.** No repo doc mentions Perfetto, `gfxinfo`, Flashlight, Reassure, Maestro frame work or frame time. The only on-device checklist (`docs\qa\2026-07-07-squad6-on-device-checklist.md`) is logcat-based. A measurement method is defined in §4 below.

### High

**H1 — Reduced-motion "stillness" is checked by pose, not by whether frames are still being drawn. The claim is probably false.**
- `LivingAurora.tsx:12-13` claims reduced motion "stops Skia re-rendering the field entirely".
- But `useClock()` is an always-on frame callback (`node_modules\@shopify\react-native-skia\src\external\reanimated\interpolators.ts:57-67`).
- The derived transform captures `clock` in its closure (`C:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\src\experience\aurora\LivingAurora.tsx:29,37-41`), so it recomputes every frame and returns a new array each time.
- The same pattern exists in `NeuralAnalysisLoader.tsx:48,67-143`, which also rebuilds three `Skia.Path.Make()` paths per frame, about 1,000 `lineTo` calls.
- `LivingAurora.test.tsx:54-72` only checks the stub's identity pose, so it cannot see this.
- **Unconfirmed.** Closing evidence is a Perfetto FrameTimeline trace showing the Skia layer producing zero frames under `transition_animation_scale=0` while the scene is static.

**H2 — Tab screens never unmount, so teardown tested at unmount is the wrong lifecycle.**
- `C:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\src\navigation\RootNavigator.tsx:32-41` uses bottom tabs with no freeze and no pause on blur.
- Generate's aurora clock, the `BioAura` loops and the Genesis loader keep ticking while the user is on another tab.
- Every parity test unmounts; none tests blur.
- *Fix:* the gate requires parity on blur (paused frame callbacks and loops) as well as on unmount.

**H3 — The Skia tests check stubs, not Skia.**
- `jest.setup.js:53-59` stubs every Skia primitive to render its children only.
- `BioAura.test.tsx:99-103` is titled "Skia crash guard", but a malformed colour never reaches Skia, so that test cannot fail.
- `advancePulsePhase` (`C:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\src\experience\aura\auraUniforms.ts:52`) has no production caller. It is pinned by three suites: `auraUniforms.test.ts:66-92`, `shadow.experience.test.tsx:53,169` and `shadow.qa4.uiux.test.tsx:15-31`.
- `deriveAuraUniforms` feeds only a View opacity (`BioAura.tsx:49,61`); `hue` and `pulseHz` are never consumed.
- So the "Skia NaN clamp" pins protect no Skia uniform.
- *Fix:* add a real-Skia jest project. It needs no new dependencies: `node_modules\@shopify\react-native-skia\jestEnv.js` and `jestSetup.js` are present, `canvaskit-wasm` is installed, and `drawAsImage` exists in `src\renderer\Offscreen.tsx:28`.

**H4 — Contrast is checked on assumed token pairs, not on what is actually rendered behind the text.**
- `EmotionTabBar.test.tsx:118-129` assumes the label sits on `surface.base`. A glass bar in the redesign would stay green.
- `tokens.test.ts:86-91` composites glass over `base`, never over the aurora.
- `canvasBottom` is missing from the surface matrix (`tokens.test.ts:28-33`).
- `muted`/`tertiary` text is tested only on `base` (`:43-45`), but it is rendered on `glassFallback` (`GenerateScreen.tsx:273,276,296,312`).
- Light `muted` on `canvasBottom` comes to about 4.9:1 by my own calculation, which is unpinned headroom.
- `textScrimFill` is the only AA-over-aurora mechanism, and it is used in exactly two places (`GenerateScreen.tsx:248,353`).
- The onboarding "disjoint zones" guarantee (`onboardingContrast.test.ts:78-104`) is proven by tree membership plus `flex>0`, not by measured bounds. An overspilling aura (as with `AURA_SCALE 1.6`) passes it.
- `ConsentSheet.test.tsx:274-288` is the only test that measures the rendered pair. That is the model to generalize.

**H5 — There is no type-check gate, so a token rename becomes a transparent colour silently.**
- Babel strips types. `ctaTreatment(mode, c: any, …)` (`GenerateScreen.tsx:369`) and 46 `any` sites across 21 files mean a renamed token reads as `undefined`, which renders transparent (for example, a scrim that is no longer there).
- Jest stays green unless a test asserts that exact value.
- *Fix:* a scoped `tsc --noEmit` job over `src/design` and the new pages, excluding the documented `src/health` debt.

**H6 — The S10-1 parity guard is hand-enumerated.**
- `GenerateScreen.test.tsx:351-383` spies on four stores and the Keyboard. It misses `AccessibilityInfo` (`GenerateScreen.tsx:139`) and `useMotion`'s listener (`C:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\src\design\theme.ts:30`).
- `useMotion` itself has no test, and it is mocked out in six suites.
- The jest preset's `AccessibilityInfo`/`AppState` mocks return `{remove: jest.fn()}` with no listener registry, so a leak or a mid-session toggle cannot be observed.
- A new subscription in a new page is not counted.

**H7 — The consent equal-weight guard is weaker than the legal contract.**
- `ConsentSheet.test.tsx:215-228` compares only `flex`, `paddingVertical` and `borderRadius`.
- `SCREENS.md:175` requires identical type size and weight, stroke, hit area, Decline first in reading order, and no scroll-gating.
- Today these hold only because both buttons share `styles.btn`/`styles.btnText` (`ConsentSheet.tsx:272-273`). If the redesign splits them into `AcceptButton`/`DeclineButton` components, a lighter Decline label would still pass.

**H8 — The AI Act Art. 50 notice (UI-005, P0) has no code and no tests.**
- A grep for "Art. 50", "AI Act" and "emotion recognition" in `src` returns 0 hits.
- Its target surfaces (`C:\Users\danie\Videos\Kokonada\TASKS.md:249-253`) — Generate, onboarding chrome, Pulse, ConsentSheet fixed chrome, NowPlaying receipt — are exactly the pages being rewritten.

### Medium

- **M1 — Design-system lint bypasses.**
  - Identifier indirection: `CTA_LABEL_SIZE = 19`, which is off the type scale, passes via `fontSize: CTA_LABEL_SIZE` (`GenerateScreen.tsx:39,413`).
  - Shorthand `{padding}` and destructuring defaults are documented as valid (`tools\eslint-plugin-kokonada\__tests__\no-scale-literals.test.js:51-52`).
  - No coverage of `duration`/`delay`/`stiffness`/`damping`, width/height/insets, or `shadowRadius` (`no-scale-literals.js:13-26`). A hand-typed `withTiming(v,{duration:300})` bypasses both the motion tokens and the reduced-motion collapse.
  - No named colours (`no-color-literals.js:11-12`); `'transparent'` is used at 5 sites.
  - The baseline ratchet counts per rule, not per value (`designSystemBaseline.mjs:13-21`), so swapping one violation for another passes.
- **M2 — The default face contradicts the LOCKED light primary.**
  - `theme.ts:12-20` maps `null` to dark.
  - `tokens.test.ts:221-228` pins that.
  - `UI_UX_OVERHAUL_SPEC.md:13` and `tokens.ts:6` say light is primary.
  - The jest preset forces `'light'` (`node_modules\@react-native\jest-preset\jest\mocks\useColorScheme.js:13`), so any unforced render only ever exercises one face.
- **M3 — Touch-target floor is 44 where Android expects 48dp.** See `ActivityChips.test.tsx:38-40` and `NowPlayingScreen.test.tsx:353-359`. Android and Accessibility Scanner use 48dp, so 44–47dp passes the tests but gets flagged on device.
- **M4 — A machine ID is used as the TalkBack label.** `accessibilityLabel="live-mode-toggle"` (`GenerateScreen.tsx:290`). No test references it.
- **M5 — Mocks hide behaviour.**
  - The hand-written Reanimated mock (`jest.setup.js:43-50`) has no `Animated` default export, `cancelAnimation`, `withRepeat`, `useReducedMotion` or `useFrameCallback`.
  - The gesture-handler Proxy (`:61-68`) swallows every callback, so wheel gesture → `onCommit` is never exercised.
  - Even Reanimated's official mock stubs `cancelAnimation` as a no-op (`node_modules\react-native-reanimated\src\mock.ts:124`) and leaves `useReducedMotion` as "ADD ME IF NEEDED" (`:83`).
- **M6 — Two token sources and two contrast engines.**
  - `tokens.ts` and `docs\canvas\tokens.css` have known drift (UI-004, UI-006: boards load Google Fonts while the app uses System). The canvas-painted `fieldBreath 5670` is not in the tokens, and `motion.duration.flow=15000` is unused but pinned.
  - `contrast.ts` and `scripts\design\contrast.py` have no parity test.
- **M7 — Per-frame JSI allocation in worklets** (`NeuralAnalysisLoader.tsx:96,112,128`).
- **M8 — Genesis mounts two full-screen blurred aurora canvases** (`GenerateScreen.tsx:206` and `:350`).
- **M9 — Stale Definition of Done.** `C:\Users\danie\Videos\Kokonada\docs\ORCHESTRATOR_FABLE.md:92` still says "42 suites / 361 tests" and "Mobile NOT in CI". A 20% test loss would still exceed that baseline.

### Low

- **L1** — `MAX_PULSE_HZ = 4` (`auraUniforms.ts:17`) is above WCAG 2.3.1's three flashes per second. It is unused today; if the redesign syncs a luminance pulse to heart rate, cap it below 3 Hz.
- **L2** — `react-test-renderer` is deprecated as of React 19. Write new page tests with React Native Testing Library (RNTL).
- **L3** — Stale comment at `NeuralAnalysisLoader.tsx:14` ("→ red"). The code itself is pinned cool (`neuralLoaderMath.test.ts:113-141`).

---

## 2. Inventory and classification

### KEEP (logic or contract; must survive untouched; about 75 files)
- **Network:** `src\net\__tests__\*` (S9-1 zombie socket, reqId gating, D-6).
- **State lanes:** `src\state\{cold,hot,warm}\__tests__\*` (S12-1 three-lane, sanitize, persistence).
- **Health, auth, storage:** `src\health\__tests__\*`, `src\auth\__tests__\{authSession,loginFlow}`, `src\storage\*`.
- **Controllers and stores:**
  - generate: `generateController`, `generationStatusStore`, `liveModeStore`, `promptSanitizer`, `neuralLoaderMath`
  - connect: `connectController`, `connectStore`, `providers`, `betaFlags`
  - history: `sessionsApi`, `sessionsFeed`, `historyFormat`
  - playback: `playback*` (D-1, D-7/D-8, S11-1), `coverArtResolver`, `foreground*`
  - player: `spotifyController` (D-2), `spotifyRemoteAdapter`, `spotifyLinkBack`, `playerStatusStore`
  - profile and pulse: `profileController` (D-9), `pulseStateStore`, `pulsePresentation`, `statusLabels`
  - wheel: `wheelGeometry`, `wheelInteraction`
- **Navigation and bootstrap:** `routeMachine`, `AppFlow`, `appBootstrap`, `App.test`.
- **Shadow suites:**
  - `shadow.generate.sacred` (T9)
  - `shadow.mobile`, `shadow.qa4.*`, `shadow.a11`, `shadow.authMigration`, `shadow.context`, `shadow.playback`
  - `shadow.experience`: ATTACK 2–4 only. ATTACK 1 and 5 exercise the aura math; ATTACK-6 is MIGRATE.
- **Design logic:**
  - WCAG maths (`tokens.test.ts:11-24`), `emotionAccent.test`, `accentInk.test`
  - `auroraGlow` hostile-input and continuity blocks
  - `onAuroraInk` max-min algorithm and `sampleGradient` totality
  - `haptics.test`, including its call-site scan
  - `useCalmPulse.test`: dispose on unmount and on a reduced-motion flip — the best teardown test in the repo; use it as the template.
  - `UpNextSheet.render` (re-render hygiene).
- **Behaviour and legal contracts:**
  - `OfflineBanner` timings and no-alarm behaviour, `Skeleton` "never a spinner", `EmptyState` "never a dead end" and "polite, not alert"
  - `ConsentSheet` state table and "`onProceed` only after 201"
  - `SpotifyAttribution` (brand), `DiscoveryBadge` "never Spotify green"
  - `SignInScreen` flow and Apple guideline 4.8 / HIG variants
  - The never-red property (blue ≥ red) everywhere, and the regulator-ethic property that breath never speeds up with arousal.
- **Lint tooling:** plugin rule tests, `designSystemBaseline`, `gate.integration`.

### MIGRATE (contract survives; re-point it at the new system)
- **Token contrast matrices:** `tokens.test.ts:26-92` and `emotionAccent.contrast.test.ts:15-27` — add `canvasBottom`, `muted` on every surface, and glass over the aurora.
- **`auroraSurfaces` AA-over-aurora** (`:45-101`): the shape is right (worst blob + scrim + glass); the numbers change.
- **`shadow.experience` ATTACK 1 and 5 (`:24-61`, `:160-174`)** — they pin `deriveAuraUniforms` and the dead `advancePulsePhase`; re-point to the new uniform builder or retire with H3.
- **ATTACK-6 (`shadow.experience.test.tsx:177-210`) and the `GenerateScreen` parity test** — turn them into the generic harness (G4 below).
- **The rendered face-forced CTA pins:** `NowPlayingScreen.test.tsx:119-138`, `OnboardingScreen.test.tsx:135-157`, `EmptyState.test.tsx:124-164`.
- **`EmotionTabBar` (f)/(l):** switch to rendered-pair contrast.
- **Consent equal-weight:** harden per H7.
- **Onboarding disjointness:** switch to measured bounds.
- **`LivingAurora` reduced pose:** make frame-production evidence the closing proof.
- **`deriveAuraUniforms` clamps:** move them to whatever builds the new shader uniforms.
- **Touch-target asserts:** raise the floor to 48.
- **`designSystemConfig.test.ts:32-70`:** re-point the sampled paths at the new directories.
- **`board.py`:** point it at the new boards. It remains a spec gate, not an app gate.
- **Brand geometry:** the Android 12 safe circle is KEEP; the exact literals depend on the brand decision.

### RETIRE (pins old pixels or old design decisions; retire only with a registry entry)
- Exact hex, alpha and duration pins: `tokens.test.ts:107-162,210-215`, `emotionAccent.contrast.test.ts:31-64`, `auroraGlow.test.ts:20-34`, `brandMark.geometry.test.ts:44-78`.
- The dark default: `tokens.test.ts:221-228`. This is a correction, not just a retirement (see M2).
- `SignInScreen` "wordmark 600 not 700".
- `GenerateScreen` frosted quadrant words, Bug-3 corner layout, A1 aura 1.6×, and the genesis scrim face.
- `EMPTY_GLOW_OPACITY 0.4`.
- NowPlaying "attribution between meta and receipt" — this was Daniel's layout decision; retire only if the new layout changes it.
- The heroes' visual assertions.
- `advancePulsePhase` suites: delete unless the redesign actually wires it.

---

## 3. Redesign-specific false-greens: mutations that pass today

1. Delete a screen and its test together (B1).
2. Rename a token that is read through `c: any`, giving a transparent fill (H5).
3. Add a new store or `AccessibilityInfo` subscription without cleanup (H6).
4. Put `muted` text over the aurora without `textScrimFill` (H4).
5. Hand-type `withTiming(…,{duration:300})` (M1).
6. Write `const PAD=13; padding: PAD` (M1).
7. Give Decline a lighter weight or smaller size than Agree, or put it second (H7).
8. Keep the clock redrawing under reduced motion (H1).
9. Put the Art. 50 notice behind `pointerEvents="none"`, inside a scroll, or remove it (H8).
10. Use a kebab-case ID as `accessibilityLabel` (M4).
11. Ship a 46dp target (M3).
12. Ship an SkSL shader with a compile error — green in jest, crashes on device (H3).
13. Allocate a per-frame `Skia.Path` in a worklet (M7).
14. Re-record a snapshot. There are no snapshots today (0 `toMatchSnapshot`); ban them in lint so it stays that way.

---

## 4. Per-page gate (each gate is checked when its stage happens, not at the end)

### G0 — Foundation work before page 1 (the architect orders it)
- The contract registry and test-count ratchet (B1).
- The scoped `tsc` CI job (H5).
- Stateful fakes with real behaviour: listener registries with emit and live counts for `AccessibilityInfo`, `AppState`, `Keyboard`, `BackHandler` and `Dimensions`; wrapped zustand and redux `subscribe`; socket `on`/`off`; animation start/stop; frame callbacks; and the power/thermal source.
- `useMotionPolicy` and the native power/thermal module (B2).
- A single token source (DTCG JSON) that generates both `tokens.ts` and `tokens.css`, with a CI check that the generated files are current and a parity fixture between `contrast.ts` and `contrast.py` (M6).
- New lint rules: motion literals, named colours, identifier indirection on scale properties, ID-like accessibility labels, `toMatchSnapshot`, and `Skia.*.Make` inside worklets.
- New pages must stay at zero in the lint baseline; `--allow-increase` is not allowed for new paths.

### Automated checks every page must ship (jest/CI)
- **G1 — Token-only styling.** Zero design-lint findings, `tsc` clean on the page.
- **G2 — Contrast matrix on the rendered tree.**
  - A helper walks each `Text` node's ancestors, composites any translucent backgrounds, and fails if it reaches a Canvas/aurora region with no declared scrim.
  - The matrix covers: every blob at worst case, both glass variants, `canvasBottom`, both faces, all four quadrants, and the CTA gradient band.
  - Thresholds: AA 4.5 for text, 3:1 for control boundaries and focus rings.
  - Also, in the real-Skia project: `drawAsImage` of the page's field at several clock times and emotion extremes, sampling luminance under each text rectangle.
- **G3 — Motion modes.** Render under {normal, reduced, lowPower, thermal-severe} × {light, dark}. Assert:
  - no loop or frame callback is active under reduced or low-power;
  - layout geometry is byte-identical across modes;
  - flipping the mode mid-life tears down running loops (the `useCalmPulse` pattern).
- **G4 — Generic teardown parity (S10-1).** Zero live listeners, loops or clocks after unmount **and** after blur. A manifest test iterates every route in `RootNavigator`, so no page can skip the harness.
- **G5 — Seam tests.** Page → controller → a stateful FakeSocket/ApiClient fake: the sacred payload, reqId gating, a single 401 refresh, fail-closed when offline. Driven from the screen, not the store.
- **G6 — Accessibility** (RNTL role/name queries).
  - Every control has a role and a human label, and a target of at least 48dp (`minHeight`/`minWidth` plus `hitSlop`).
  - Header landmarks and focus order are correct; live regions are polite.
  - Colour is never the only cue; Skia elements are hidden from accessibility and have an alternative.
  - Under `fontScale` 2.0, essential copy (legal, consent, Art. 50) is never truncated by `numberOfLines`.
- **G7 — Legal surfaces.**
  - Art. 50 exact-string pin: present, in the accessibility tree, not `pointerEvents="none"`, above the fold, on a scrim.
  - Consent parity extended to size, weight, stroke, height, and Decline first.
  - Brand pins: Spotify attribution and no Spotify green in any token.
- **G8 — Render-count contracts.** Screens do not re-render on emotion changes; lists re-render only changed rows.
- **G9 — Real-Skia compile check.** Every SkSL shader compiles via `Skia.RuntimeEffect.Make`, and NaN/Infinity uniforms render finite pixels.

### On-device closing evidence (Galaxy S22+; debug builds are not admissible)
- **E1 — Build.** A Hermes release build only.
- **E2 — Frame time.**
  - Primary: a Perfetto trace with the `android.surfaceflinger.frametimeline` data source, covering 30 seconds of steady state per page, each transition, and Genesis. Query `actual_frame_timeline_slice` per layer so the Skia surface is included; `gfxinfo` sees only HWUI and misses it.
  - Measure at Motion smoothness "Standard" (60 Hz): p90 frame time ≤ 16.7 ms and jank ≤ 1% (proposed thresholds for the owner and architect to ratify). Record the adaptive 120 Hz result as well.
  - Run a 10-minute Generate soak with live heart rate, logging `dumpsys thermalservice` and frame statistics at 0, 5 and 10 minutes.
  - `dumpsys gfxinfo <pkg> framestats` is only a cheap first pass.
- **E3 — Reduced motion.** Set `animator_duration_scale`, `transition_animation_scale` and `window_animation_scale` to 0. Confirm through a logcat line that the app sees reduced motion, then confirm in Perfetto that the static layers produce zero frames.
- **E4 — Low power and thermal.** Force battery saver (`settings put global low_power 1` or `cmd power set-mode 1`) and a thermal level (`cmd thermalservice override-status 3`). Verify the correct degradation step fires. Check these commands against One UI.
- **E5 — Font scale.** `settings put system font_scale 2.0`, then screenshots of every page state.
- **E6 — TalkBack.** Screen-record a swipe through each page's focus order (Samsung ships its own TalkBack component name, which needs checking). Run Google Accessibility Scanner on each state; it measures real pixels, which is the only thing that closes the text-over-aurora contrast question on device.
- **E7 — Screenshot matrix.** Every page × state × face × font scale, archived. The designer SHIP cites these exact files. The ConsentSheet screenshot is filed per consent version (EDPB 05/2020 para 108).
- **E8 — Leaks.** Navigate away and back 50 times (a Maestro loop). `dumpsys meminfo` must plateau, logcat must show no Skia or unmounted-update errors, and a blurred tab must produce zero frames.

---

## 5. Tooling (realistic for this repo, with trade-offs)

| Tool | Use it for | Trade-off |
|---|---|---|
| Real-Skia jest project (`jestEnv.js`, `canvaskit-wasm`) | G2 pixel sampling, G9 shader compile, headless reference images for Skia components | Zero new dependencies. CanvasKit renders on the CPU, so compare with a tolerance; it does not replace the device. |
| Perfetto FrameTimeline | E2/E3 authority | Built in and free, but needs a SQL query script. |
| Flashlight | Optional CPU/RAM figures and a rough FPS score | Its FPS probably doesn't see the Skia layer. Windows support needs checking (WSL2 fallback). |
| Maestro | E5, E7, E8 flows and screenshot matrix on the S22+ | Free and local, but flaky around animations (use `waitForAnimationToEnd`). Keep it on the device, not in CI. Check the Windows install path. |
| Screenshot diff (pixelmatch or odiff over Maestro captures) | Visual regression against designer-approved baselines | Re-recording baselines must be a deliberate, reviewed act, like the lint ratchet. |
| React Native Testing Library (new pages only) | Accessibility-by-construction queries; replaces the deprecated `react-test-renderer` | Migration effort, so limit it to new pages. |
| Reassure | G8 render counts | Needs RNTL. Gate on counts only; render durations are noisy. |
| `eslint-plugin-react-native-a11y` (selected rules) | Static accessibility lint | Some rules are noisy. |
| Reanimated's official jest utilities (`setUpTests`, `advanceAnimationByTime`, `getAnimatedStyle`) | Values over time | Its mock no-ops `cancelAnimation`, so teardown still needs the project's own wrapper plus a fake. |
| Skip Loki and Owl | — | Owl appears unmaintained; Loki's RN support depends on an emulator. |

**On the design tools you asked about** ("Taste Skill", awesome-design-md, "UI UX Pro Max"): they help generate visual taste, but none of them produces verification evidence. Anything they produce must pass G0–G9 and E1–E8. `compliance-auditor` should check any brand DESIGN.md you borrow from for trade-dress risk.

---

## 6. Verdict per surface

| Surface | Verdict |
|---|---|
| S9-1, S11-1, S12-1 logic | KEEP. Untouched by a redesign; by reading, the guards look correct (not re-run). |
| S10-1 teardown | HARDENED per screen; generically OPEN (hand-enumerated list, unmount only, blur untested). |
| Token contrast maths | HARDENED as maths; OPEN on the rendered tree. |
| Design-lint ratchet | HARDENED; four bypass classes remain open (M1). |
| Reduced motion | OPEN (H1; `useMotion` untested; stillness unproven on device). |
| Low power / thermal | BLOCKED (B2). |
| Skia NaN clamps | Stub-only guarantee (H3): no real Skia runs in tests, and `advancePulsePhase` has no production caller. |
| Consent parity | Partially HARDENED (H7). |
| Art. 50 notice | ABSENT (H8, P0). |
| 60fps floor | UNVERIFIED (B3). |
| Canvas boards | Checks the HTML design boards only, not the app, and not in CI. |

**Stability score: 4/10 for redesign readiness.** The logic contracts are strong (about 75 files carry over untouched), but the visual gate is weak. The G0 foundation must land before the first page is built.