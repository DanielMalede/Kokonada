# Kokonada from-zero redesign: ground-truth map and gated per-page plan

**Scope and method.** This is a read-only architect pass. Everything below was checked against the code on `main` (`bc2253c`, clean tree) using Read, Grep and Glob. Three things are **not verified** in this session:
- The runtime jest count (I did not run jest).
- Which 4 of the 23 canvas boards hold a designer SHIP (I only have the handoff's count).
- Anything about the three design tools Daniel named (I had no web access).

## 0. Ten findings that change the plan

1. **There is no component layer to redesign.** 46 non-test files import `design/tokens` or `design/theme` directly. The shared primitives are only these: `design/system/{Skeleton, EmptyState, OfflineBanner, useCalmPulse}`, `design/components/DiscoveryBadge`, and the de facto visual pieces in `experience/{aura, aurora, brand}`.
   - The pill/CTA pattern is hand-built about 11 times: SignIn, Onboarding, Connect wearable CTA, MoodOnlyBar, NowPlaying play button, Generate CTA/mini-pill/toggle, Consent (×2), Profile logout/delete/retry, VaultConsentPanel, LiveHeartRateCard, EmptyState.
   - The card pattern is built about 7 times.
   - So the only seam today is tokens plus `useTheme`. A from-zero redesign has to build primitives first.

2. **Three design generations exist side by side, and none is fully authoritative.**
   - ADR-0009 and `docs/UI_UX_OVERHAUL_SPEC.md` define "Calm × Bioluminescent", light "Clinical Premium", built on **Tamagui**.
   - The shipped `src/design/tokens.ts:1-8` is "AURORA, LOCKED 2026-07-13".
   - The canvas is "Quiet Instrument" (`docs/canvas/tokens.css`). `Plan.dc.html:22` lays out 14 PRs "on Tamagui / Reanimated / Skia". No ADR ratifies it; it is named only in the WAVE4 logs.
   - **Tamagui, Moti, Lottie and vector-icons are not installed.** `package.json` and `babel.config.js:5` (worklets plugin only) show none of them. Yet `UI_UX_OVERHAUL_SPEC.md:29,60` and `ADR-0009:24` claim a Tamagui token architecture.

3. **The theme default contradicts the spec.** `theme.ts:12-20` uses light only when the OS reports light and otherwise falls back to dark. `SignInScreen.tsx:58-59` says "dark-default". The spec says light is the primary face. There is no ThemeProvider and no user override.

4. **The "magic moment" cannot be reached by a public user.**
   - Playback is Spotify App Remote only (`backend/app/sockets/biometricHandler.js:216-225`, `NO_PLAYABLE_PROVIDER`).
   - Spotify connect is `halted` (`providers.ts:26-34`), and `SPOTIFY_BETA_CONNECT` is committed off (`ProfileScreen.tsx:279-285`, the 5-user cap).
   - So end-to-end checks per page can only run on allow-listed dev accounts. This is a product risk design cannot fix; it belongs with `sentinel` and Daniel.

5. **Some OS and third-party popups fire at startup and no screen owns them.**
   - On every signed-in boot and on sign-in, `startBiometrics` runs (`appBootstrap.ts:30-33`, `prodBootstrap.ts:93`). It mints the `whr_` token (`liveHrClient.ts:23`; the comment at `:14` says this flips `wearableProvider='garmin'` server-side). It then raises the **BLE runtime-permission dialog** (`liveHr.ts:26`, `blePermissions.ts:31-35`) with no explanation screen first, over Splash or Connect.
   - `player.connect()` runs at boot even when signed out (`appBootstrap.ts:26`). It can launch Spotify's authorize Activity (`spotifyRemoteAdapter.ts:35-53`).
   - The Connect and Onboarding redesign has to decide when these fire.

6. **The mobile app sends the learning loop nothing.**
   - The backend listens for `playback_event` and `track_skipped` (`biometricHandler.js:1841-1874`).
   - Mobile emits neither, and no `tzOffsetMinutes` either (0 grep hits).
   - Master §0:56-59 lists these as open mobile follow-ups.

7. **The server already sends data the UI throws away.**
   - Pulse `affect` and `morning` blocks (`pulseController.js:176-180`) are missing from `PulseState` (`pulseApi.ts:12-18`).
   - `receipt.why` (`biometricHandler.js:175-177`) is dropped by `sanitizeReceipt` (`playbackQueue.ts:36-49`). This is the 7b Mix receipt blocker.
   - `GET /api/auth/account/export` (`routes/auth.js:24`) has no mobile caller.
   - The socket event `profile_progress` (`integrationsController.js:164`) is never consumed.

8. **The shipped UI has buttons that do nothing.**
   - History rows announce "Opens this moment to replay its soundtrack" (`HistoryRow.tsx:53-54`). But `RootNavigator.tsx:39` passes no `onOpenSession` or `onGenerate`, so both the row tap and the empty-state "Generate a soundtrack" CTA fall to no-op defaults (`HistoryScreen.tsx:62`).
   - The OfflineBanner Retry button never renders, because `onRetry` is not passed (`RootNavigator.tsx:30`, `OfflineBanner.tsx:135`).

9. **Several legal and provider gates run on outside clocks.**
   - The AI Act Art. 50 disclosure (`UI-005`, P0, `TASKS.md:228-265`) is absent from code (0 hits for its wording).
   - The Garmin Developer Program Agreement §6.6 requires **30 days' prior written notice with mockups** before any new UI that displays Garmin data (`HALT_GARMIN_BRAND_AND_ATTRIBUTION.md:15`). Redesigning Pulse or the Generate body strip starts that clock.
   - Spotify Developer Policy §II.5 requires cover art wherever Spotify content plays, including any mini-player (`UI-003`).
   - `HALT_SPOTIFY_TRACK_IDS_TO_THIRD_PARTY` is unresolved.

10. **The test baselines in the docs disagree, and one CI claim is false.**
    - Docs give 42/361 (`ORCHESTRATOR_FABLE.md:92`), 48/416 (Master §0:26), 51/455 (`UI_UX spec:156`) and about 1,220 (`SCREENS.md:13`).
    - A static count gives **129 suites and 1,307 `it`/`test` call sites**. That is a lower bound, because `.each` expands at runtime.
    - The Fable DoD says "Mobile NOT in CI". That is false: `ci.yml:59-91` runs `jest --ci` and `lint:design-system`.

## 1. Every user-facing surface in code

**Route machine.** `App.tsx` sets up GestureHandlerRootView, the Redux Provider (cold lane), SafeAreaProvider and `AppFlow`.
- `AppFlow.tsx:72` computes `resolvePostSplashRoute(hasUser, seen, connectResolved)` in `routeMachine.ts:18-25`, giving splash, onboarding, signin, connect or app.
- The logout guard is sacred: `hasUser` is checked first (`routeMachine.ts:23`).
- Switching between routes is a **hard cut**; there are no transitions.
- The splash dwell is `motion.duration.breath/3` (`AppFlow.tsx:32`), so a routing timer depends on a design token.

| Surface | Files | What it renders | Data and integrations | States | Contracts and gaps |
|---|---|---|---|---|---|
| **S1 Splash** | `splash/SplashScreen.tsx` | Breathing glow, BrandMark, scrim, wordmark | None; `react-native-bootsplash` hide (`AppFlow.tsx:59`), native bootsplash assets | enter / reduced motion | Changing the `breath` token changes routing; bootsplash re-export is native |
| **S2 Onboarding** | `onboarding/OnboardingScreen.tsx`, `OnboardingPanel`, `AuraHero`, `PulseHero`, `WheelTeaseHero`, `onboardingStore` | 3-panel pager, Skip, Continue/Begin | `onboardingStore` (KV, **per device, one-way**; MB-009, `TASKS.md:214-220`); haptic `commit` | page 0–2, `beginReady`, reduced motion | UI-005 wants the AI line in the persistent bottom chrome (`:137`) |
| **S3 SignIn** | `auth/SignInScreen.tsx`, `auth.ts`, `currentUser.ts`, `session.ts` | Glow, wordmark, Google button, Apple button (iOS only) | `POST /api/auth/google` and `/apple`, then `setUser`, then `onSignedIn` (`prodBootstrap.ts:90-108`); Google Sign-In native, Apple native | idle / busy / error / cancelled | **Sacred** flow `SignInScreen.tsx:29-49` (`loginFlow.test`). No email path, though backend has `/signup` and `/login` (`DEV_EMAIL_SIGNIN_PATH` not started). No in-app privacy policy (`HALT_HEALTH_CONNECT_PLAY_BLOCKERS`). Google button is plain text (`DEV_SIGNIN_BRAND_ASSETS`). |
| **S4 Connect** | `experience/connect/{ConnectServicesScreen, ProviderRow, ProviderGlyph, WhyAccordion, MoodOnlyBar, connectController, connectStore, providers, betaFlags}` | Music card (honest, no CTA), Wearable card (one CTA), pinned mood-only bar | `GET /api/integrations/status`; consent GET/POST; Health Connect `checkAvailability`, `requestHealthPermissions`, store/settings deep links; `syncMedicalProfile` → `POST /api/integrations/health/batch`; `connectStore` KV `koko.connect.<uid>.{resolved,moodOnly}` | default / mood-only / wearable; outcomes unsupported / install-required / consent / permission-blocked / connected / sync-failed (4 `Alert.alert`) | **Sacred**: the OS Health Connect sheet opens only after a server-acknowledged grant (`connectController.ts:11-18`). No Garmin connect (MB-005). |
| **Shell** | `navigation/{RootNavigator, EmotionTabBar, TabIcon, SystemStateDock, tabRoutes}`, `design/system/OfflineBanner`, `experience/playback/AppLifecycle` (renders nothing) | 5 bottom tabs, **no stack navigator**; top offline dock; Skia tab glyphs tinted by emotion | `warmStore.connection`; `useSelector(emotion.taps → quadrant)`; AppState → `reconcileOnForeground` (player state, OS permissions, Pulse refresh) | online / offline / connecting; tab focus | `TAB_ROUTES` order (`tabRoutes.ts:6`). The emotion subscription lives only in the chrome, so screens do not re-render. Retry is not wired. |
| **S5 Generate + S6 Genesis** | `experience/generate/{GenerateScreen, generateController, ActivityChips, PromptBox, EmotionListSelector, NeuralAnalysisLoader, generationStatusStore, liveModeStore, promptSanitizer}`, `wheel/{RadialWheel, wheelGeometry, wheelInteraction}`, `aura/BioAura`, `aurora/{LivingAurora, AuroraGradientFill}` | Living aurora field, bio-aura, Skia wheel, quadrant words, undo/clear, Live/Manual toggle, 8 chips, prompt, list alternative, morphing CTA, Genesis overlay | Cold `emotion` slice; `warmStore.liveHr`; `liveModeStore` (KV); `playbackErrorStore`. Socket emits `emotion_update`, `request_playlist`, `request_heart_playlist`, `live_mode`; listens for `playlist_ready`, `_error`, `_building`, `live_assembling`, `auth_expired` (`socketClient.ts:113-118`). Uses Skia, Reanimated, gesture-handler, haptics, AccessibilityInfo, Keyboard. | CTA: generate / listen-to-heart / live-tuned / disabled (`generateController.ts:75-82`); 0–3 taps; typing mini-ring; list auto-open under a screen reader; error + retry; Genesis hidden / active / resolving; "building" copy | **Sacred**: ≤3 taps (`emotionSlice.ts:19,27-30`); `screenToCircumplex` (`wheelGeometry.ts:23-35`); single `runOnJS` (`RadialWheel.tsx:68-71`); byte-exact payload (`shadow.generate.sacred.test.ts:44-78`); `auroraGlow` is presentation-only. Gaps: UI-005 #1; the state-name card needs engine data; the field decision is open (`DECISION_TWO_LOBE_FIELD.md`). |
| **S7 Now Playing + Up Next** | `playback/{NowPlayingScreen, UpNextSheet, UpNextRow, playbackOrchestrator, playbackQueue, nowPlayingStore, coverArtResolver, foregroundReconcile, playbackServices}`, `player/{SpotifyAttribution, spotifyController, spotifyRemoteAdapter, spotifyLinkBack, playerStatusStore}`, `design/components/DiscoveryBadge` | Cover or ♪ fallback, breathing aura, title/artist, Spotify attribution + link-back, receipt pill or discovery caption, transport, Up-next Modal sheet | `nowPlayingStore` (track, isPlaying, coverUri); orchestrator `skipPrev`, `togglePlayPause`, `skipNext`, `jumpToId`, `getQueueTracks`; `playerStatusStore`; App Remote (`getTrackImage`, playerState stream) | nothing playing / playing / paused / cover failed; receipt familiar, discovery with caption, or none; sheet connection states | **Sacred**: S10-1 subscription cleanup is pinned *inside* `NowPlayingScreen.test.tsx` (port it, never delete it); the remote is the source of truth. Gaps: no progress or seek (`DEV_PLAYBACK_SEEK_AND_POSITION`); no buffering, foreign-track or end-of-queue copy; no feedback emit; `why` dropped; no route to 7b. |
| **S8 Pulse** | `experience/pulse/{PulseScreen, pulseApi, pulseStateStore, pulsePresentation, statusLabels}` | HR hero with halo, source and socket chips, 6 gauges in 3 groups, state card | `GET /api/pulse/state` (single-flight store that keeps stale data while refreshing); `warmStore` (liveHr, connection, biometricSource); `healthSync` counts subscription; `useFocusEffect` refresh; navigates to `'Profile'` | syncing skeleton / empty / live / honest-empty per metric / low confidence | Gaps: `affect` + `morning` superset; UI-005 #3; C5(b) "not a medical device" echo; Garmin title-level attribution; `friendlyStatus` wording needs compliance review (Master §0:56) |
| **S9 History** | `experience/history/{HistoryScreen, HistoryRow, SourceGlyph, historyFormat, sessionsFeed, sessionsApi}` | Pinned header plus skeleton / error / empty / list | `GET /api/sessions?limit&before&beforeId` (cursor) | chosen by the pure `selectHistoryBody`; footer loading / error / end | **Dead affordances** (Finding 8). No replay contract exists. `DEV_HISTORY_STATE_COLOUR` not started. |
| **S10 Profile / Vault** | `experience/profile/{ProfileScreen, ProfileIntegrationRow, LiveHeartRateCard, VaultConsentPanel, profileController, profileServices, sessionTeardown}` | Avatar seal, 4 integration rows, live-HR credential card, Vault panel, logout, inline delete confirm | `GET /api/auth/me` and `/api/integrations/status`; `POST /connect-token` then `Linking` to `/api/integrations/spotify/connect?ct=…&returnTo=app`; `DELETE /youtube/disconnect`; consent status/withdraw; `GET /watch/status`; `DELETE /watch/token`; `POST /api/auth/logout`; `DELETE /api/auth/account`; ordered teardown (`profileServices.ts:24-39`); AppState resume + focus reload | loading / `me == null` retry / loaded; consent on/off; delete confirm; 12 `Alert.alert` | Gaps vs `SCREENS §10` (CONNECTIONS / YOUR DATA / THE FIELD / HOW ADVENTUROUS, Vault sub-surface): Export, discovery dial, field toggle, UI-001, YouTube revocation HALT, Garmin connect and deregistration on delete |
| **S11 Consent** (Modal, hosted by S4 and S10) | `profile/ConsentSheet.tsx`, `health/{consentStore, consentApi}` | Shield glyph, title, scrollable 6-section notice, fixed Decline · Agree | `GET /api/consent/status?purpose=…`, `POST /api/consent {purpose, dataCategories, clientVersion}`; `CONSENT_SCREEN_VERSION=1` (`consentApi.ts:59`) | 9-state flow (`consentStore.ts:16-25`) | **Sacred**: `onProceed` fires only on `ready` or `granted_ack` (`ConsentSheet.tsx:125-128`). Copy is still placeholder (`:16,35`). `CONSENT_DATA_CATEGORIES` has **9** entries (5 Health Connect + 4 Garmin incl. `daily_readiness`, `consentApi.ts:45`), but `SCREENS §11` says 8. The canvas annotation (`canvas.json` "row-trust") says readiness is *not* from Garmin, which contradicts code from #188. |
| **Implicit surfaces** | — | Native bootsplash; BLE permission dialog at boot; Spotify authorize Activity at boot; Health Connect permission sheet; Play Store / Health Connect deep links; Spotify OAuth in the browser; 16 `Alert.alert`; 3 RN Modals | — | — | The redesign must own when and how these appear |

## 2. Integration matrix

- **REST calls from mobile.**
  - Auth: `auth/{google, apple, refresh, me, logout, account}`.
  - Integrations: `integrations/{status, connect-token, spotify/connect, youtube/disconnect, watch/token (POST and DELETE), watch/status, watch/hr, health/batch}`.
  - Consent: `consent`, `consent/status`, `consent/withdraw`.
  - Other: `pulse/state`, `sessions`, `discovery/playback-failed`.
- **Backend routes with no mobile caller:**
  - `auth/{signup, login, account/export}`
  - `integrations/{garmin/connect, garmin/disconnect, wearable/status, wearable/:provider, spotify/saved-tracks, hydrate-library}`
- **Socket, client to server:** `emotion_update`, `request_playlist`, `request_heart_playlist`, `live_mode`. Not emitted by the client: `playback_event`, `track_skipped`, `biometric_push`.
- **Socket, server to client, consumed:** `playlist_ready`, `playlist_error`, `playlist_building`, `live_assembling`, `auth_expired`.
- **Socket, server to client, not consumed:** `profile_progress`, `recalibration_pending`, `recalibration_cancelled`, `biometric_ack`, `connection_error`.
- **`playlist_ready` payload:** `{trigger, mode, reqId, params, tracks[{id, uri, recordingKey, title, artist, receipt{label, detail?, caption?, why?}}], familiar, discovery}` (`biometricHandler.js:1288-1296`). There is no `targets` object, which 7b needs.
- **Stores.**
  - Cold (Redux): `emotion` only, persisted through the allowlist (`emotionSlice.ts:68-108`).
  - Warm (zustand): `liveHr`, `connection`, `biometricSource`, `permissions`.
  - zustand singletons: `connectStore`, `onboardingStore`, `liveModeStore` (all KV-backed); `generationStatusStore`, `playbackErrorStore`, `nowPlayingStore`, `playerStatusStore`, `pulseStateStore`, `currentUserStore`.
- **Native modules:** Skia 2.6, Reanimated 4.5 with worklets, gesture-handler 3, `@kokonada/spotify-remote` (local module), Health Connect, ble-plx, keychain (session plus `com.kokonadahealth.watchToken`), encrypted MMKV (`platform/mmkvCipher`), haptic-feedback (lazy `require`), bootsplash, Google/Apple sign-in.
- **Not installed:** react-native-svg, Lottie, icon fonts, native-stack.
- **Fonts:** only `GeneralSans-Semibold.otf`; text and mono use the system face.

## 3. Sacred contracts and where they are pinned

| Contract | Code | Pinned by |
|---|---|---|
| ≤3-tap payload, byte-exact | `emotionSlice.ts` | `shadow.generate.sacred.test.ts`, `emotionSlice*.test` |
| `screenToCircumplex` geometry | `wheelGeometry.ts` | `wheelGeometry.test` (12), `RadialWheel.test` (9) |
| Three-lane state split | `state/store.ts` | `laneCommit.test`; S12-1 in `warmStore.test` |
| Socket reqId gating, reconnect re-hydrate, `auth_expired` storm cap | `socketClient.ts` | `socketClient.test` (33); S9-1 in `shadow.qa4.network` |
| Remote-as-truth playback, D-1 context, orchestrator guards | orchestrator | `playbackOrchestrator.test` (38), `playbackSyncToRemote.test` |
| Consent gate | `consentStore` / `connectController` | tests for both |
| Logout teardown order | `sessionTeardown` | its tests |
| Route-machine logout guard | `routeMachine.ts` | `routeMachine.test` |

**Screen tests that carry sacred pins:** `NowPlayingScreen.test.tsx` (S10-1), `GenerateScreen.test.tsx` (ATTACK-6 teardown), `PulseScreen.test`, `ProfileScreen.test`. A redesign must **port** these, not delete them.

## 4. The design-system layer as it stands

- **`tokens.ts`** is the leaf of the design graph and imports only the `Hex` type. It holds:
  - `ColorScheme`: `surface` (11), `content` (6), `accent` (9), `emotionAccent` (4 × {ink, wash}), `state` (4), `aurora` {blobs, blur, flow, focalGlow, glass}, in dark and light.
  - `emotionAnchors`.
  - Scales: `space` (9), `radius` (6), `stroke` (3), `type` {family, size (8), weight, leading, tracking}, `elevation` e0–e3.
  - `motion`: 7 durations plus reduced variants, 3 easings, 2 springs (springs used in only 2 places).
  - `haptics` (4).
- **`theme.ts`**: `useTheme()` reads the OS scheme directly. `useMotion()` gives every consumer its own AccessibilityInfo listener and sets all durations to 0 under reduced motion.
- **`emotionAccent.ts`**: `emotionAccentFor` (discrete quadrants, 0.15 deadzone) and `auroraGlow` (bilinear; must handle any input without throwing). `AURORA_CORNERS` duplicates the token hexes (`DEV_COLOUR_SINGLE_SOURCE.md`).
- **`auroraSurfaces.ts`**: `textScrimFill` (floor 0.88 / 0.9, proven against the v1 aurora blobs), `auroraCtaStops`, `onAuroraInk` (max-min rule).
- Also: `contrast.ts`, `accentInk.ts`, `haptics.ts`, and `brandMark.geometry.ts` (6 hardcoded colours).
- **How screens consume it:** `StyleSheet.create` plus inline `{color: c.*}`.
  - Motion is mostly the legacy RN `Animated` API (about 11 files). Reanimated appears only in the 8 Skia/wheel files.
  - There are no layout or screen transitions.
- **Presentation logic tied to tokens:** `pulsePresentation.ts`, `neuralLoaderMath.ts`, `auraBreath.ts`, `auroraField.ts`, and the `AppFlow` dwell.
- **Lint gates.**
  - Rules: `kokonada/no-color-literals`; `no-scale-literals` (padding\*, margin\*, gap, border\*Radius, fontSize, letterSpacing, lineHeight, border\*Width); `require-disable-reason`; `eslint-comments/no-use`. Scope is `src/**`.
  - Exemptions are only `src/design/*.ts` and `src/design/__tests__/**` (`eslint.design-system.js:47`). The glob is **single-level**.
  - The token index reads **one file**: `DEFAULT_TOKENS_PATH='src/design/tokens.ts'` (`resolveTokens.js:6`), parsed by a regex scanner (`tokenIndex.js`).
  - The CI gate `designSystemLint.mjs` runs 6 integrity checks plus a per-file ratchet (baseline total 70 across 20 files). The policy itself is pinned by `designSystemConfig.test` and `gate.integration.test`.
  - Not enforced: width, height, top and left numbers (e.g., NowPlaying `ART_SIZE 300`, `PLAY_SIZE 72`, SignIn `maxWidth 360`, `height 52`), opacities, shadows.
- **Consequence for a v2:** a v2 tokens file under `src/design/v2/` would be neither exempt nor indexed. The lint plumbing has to change.

## 5. (a) What the redesign can replace, and what it must keep

- **Replace (visual layer):** the render trees of every `*Screen.tsx`, the heroes, the aura, aurora and brand visuals, `design/system/*`, TabIcon glyphs, EmotionTabBar styling, the Consent and UpNext sheet chrome, all token values and even the token shape, the motion vocabulary, the bootsplash asset, and the type faces (subject to `UI-006`).
- **Keep verbatim (logic and contracts):**
  - `state/**`, `net/**`, `health/**`, `auth/**` except SignInScreen's view.
  - All controllers and stores: `generateController`, `connectController`, `consentStore`, `sessionsFeed`, `pulseStateStore`, the orchestrator, queue, sync and teardown modules, `providers.ts`.
  - The route machine; `wheelGeometry`; `laneCommit`; the `emotionAccentFor` semantics; `promptSanitizer`; the consent category constants and version.
  - All logic and `shadow.*` tests.
- **Re-author deliberately:**
  - Screen render tests. Keep **testIDs and a11y labels as a declared contract**, e.g. `generate-cta`, `consent-agree` / `consent-decline`, `live-mode-toggle`, `connect-wearable`, `delete-confirm`, so tests move with little churn.
  - The v1 token pins (`tokens.test`, `auroraSurfaces.test`, `EmotionTabBar.test`, `onboardingContrast.test`; 61 `contrastRatio` calls in 16 files). These stay while v1 exists, and v2 gets its own proofs.

## 6. (b) Where the new layer plugs in: decision tables

**A. How old and new coexist during a page-by-page rollout**

| | A1 In place (rewrite `tokens.ts`, restyle) | A2 **Parallel v2 namespace** (`src/design/v2/`: tokens leaf, theme hook, primitives; migrate each page; delete v1 last) | A3 Provider swap (keep the `ColorScheme` shape, serve v1 or v2 values per subtree) |
|---|---|---|---|
| Impact | Every unmigrated screen gets the new palette on its old layout at once | Each page switches completely in its own PR | Needs the new direction to fit the v1 shape |
| Blast radius | 46 files, 16 contrast-test files, `tokens.css` mirror, all 11 surfaces in one PR (`Plan.dc.html:36` admits "touches every screen") | One screen plus its tests per PR; a one-time lint change (`eslint.design-system.js`, `resolveTokens` tokensPath, `designSystemConfig.test`) | Every `useTheme` caller, since a provider is new |
| Tech debt | None structurally | Temporary duplicate of tokens and theme, bounded by a ratchet | Hidden aliasing between roles |
| Reversibility | Low once page PRs stack up | **High**: revert one PR | Medium |
| Failure modes | Untested hybrid screens; `textScrimFill` proofs invalid over a new field; one REVISE blocks everything; big-bang is forbidden by `UI_UX §0` | Visible seam between v2 pages and v1 chrome or shared sheets; drift if v1 keeps getting edited | Silent role aliasing (the `--inkbtn` class of bug, `tokens.css:98-109`); Quiet Instrument already changes the shape (plate/sunken, drops glass) |

**Recommendation: A2**, with three guardrails:
- (i) A guard test that fails if a migrated screen imports v1, plus a "v1 importers" count that can only shrink.
- (ii) v1 is frozen (enforced by a custodian guard).
- (iii) The shell and the shared sheets (Consent, UpNext, OfflineBanner) are migrated as explicit early tasks.

This is dependency inversion in practice: new pages depend on a new abstraction, and every step can be undone.

**B. Styling engine**

| | B1 StyleSheet + v2 tokens + own primitives | B2 Tamagui (what the docs assume) | B3 Unistyles 3 / NativeWind |
|---|---|---|---|
| New native deps | none | babel plugin placed before the worklets plugin; jest ESM allowlist (`jest.config.js:18-20`) | yes |
| Lint gate | works as is | the kokonada plugin cannot read `$token` props, so the gate must be rewritten | rewrite |
| Motion | Reanimated 4 CSS-style transitions already installed | own animation drivers | same as B1 |
| Reversibility | high | low | low |

**Recommendation: B1.** Amend ADR-0009 and `UI_UX §2` to drop the Tamagui claim; that needs an ADR. Check exact library APIs with context7 before any adoption.

**C. Navigation for pushed screens (7b Mix receipt, 10b Vault)**
- C1: add `@react-navigation/native-stack` per tab. `react-native-screens` is already present.
- C2: RN Modal sheets, the current pattern.
- C3: extend the route machine.

**Recommendation: C1.** It gives a real back affordance, Android back handling, focus management and deep links. Blast radius: `RootNavigator` plus its test, and EmotionTabBar hides on pushed screens. The `package.json` change triggers the `mobile-android-compile` CI job (`ci.yml:118-120`).

**D. Theme default**
- D1: follow the OS, fall back to dark (today).
- D2: follow the OS, fall back to light (matches the spec).
- D3: user setting stored in KV.

This is Daniel's call. It is small but touches every screen.

**E. Where the design is prototyped**
- E1: HTML canvas only.
- E2: **canvas for composition, copy and states, plus a dev-only on-device "Design Gallery" route** as the source of truth for motion, Skia and contrast over the field. `tokens.css` would then be generated from, or parity-tested against, v2 `tokens.ts`.
- E3: Figma.

**Recommendation: E2.** CSS is not Skia or Reanimated. It also closes `DEV_COLOUR_SINGLE_SOURCE` and `UI-006` by construction.

**F. Which direction the redesign starts from**
- F1: continue Quiet Instrument (23 boards, 4 SHIP, about 35 open findings).
- F2: **a fresh direction that inherits a Requirement Ledger**.
- F3: re-skin Aurora.

**Recommendation: F2.** Many canvas rulings are requirements, not style: consent layout per EDPB, Spotify cover-art slots, Garmin attribution, the disc-rim SC 1.4.11 exemption (`UI_UX §7.1`), danger vs destructive (`§7.2`), the ceiling encoding (`SCREENS §7b`). Pull these into a ledger *before* designing so nothing is re-argued. That is the direct fix for Daniel's "redone several times" pain.

## 7. (c) Where the catalog and the code disagree

**In `SCREENS.md` but not in code:**
- 7b Mix receipt: no screen, `why` dropped, no stack, no `targets` in the payload.
- UI-005 disclosure: absent from all 5 shipped files.
- §3 email sign-in.
- §7 progress/scrub, gyro parallax, buffering / foreign-track / end-of-queue states, open-playlist beyond the sheet.
- §8 gauge detail and the baseline warm-up card (Plan).
- §9 replay and offline cache.
- §10 Export (backend already exists), "Living background" toggle, "How adventurous" dial (`DEV_PROFILE_CONTROLS`), the Vault sub-surface layout, Garmin connect.
- §11 first-layer purpose and controller (`UI-003`), platform-conditional copy, version/date display (`DEV_CONSENT_FIELD_EXPOSURE`).
- The living field (the Field board; decision open).

**In code but not properly in `SCREENS.md`:**
- `LiveHeartRateCard` (the `whr_` revoke card). §10 and the rollout table still describe a "pairing-code" card, and so does `Plan.dc.html:92`, but it was retired.
- `UpNextSheet`, mentioned only as "open full playlist".
- All implicit OS and third-party surfaces.
- The 16 Alert-based outcome dialogs.

**Other drift in the docs:**
- The 8-vs-9 consent category count.
- The readiness-source contradiction.
- `CLAUDE.md` lists 7 agents, but `.claude/agents/` also contains `sentinel`.
- `/build-screen` (`.claude/commands/build-screen.md`) leaves out architect, regulatory-researcher, Garmin and HC triggers, and makes compliance conditional. That is the structural cause of late gates.

## 8. (d) Tests: baseline and how to run them

- **Static baseline:** 129 suites, ≥1,307 `it`/`test` sites. **Measure the real count before the first redesign PR.**
- **Commands** (run from `mobile/KokonadaHealth`):
  - `./node_modules/.bin/jest --ci` (on Windows: `node_modules\.bin\jest --ci`).
  - On a cold babel cache, add `--testTimeout=20000` (MB-006 flake).
  - Design gate: `npm run lint:design-system`. Full lint: `npm run lint`.
  - `tsc` is **not** gated, because of known pre-existing `src/health` typing errors. Recommend requiring tsc-clean for new v2 files.
- **Backend:** `cd backend && npm test` (Master §0 gives 232 suites / 3,866 tests).
- **jest reanimated mock:** `jest.setup.js:43-50` is minimal (no `withRepeat`, `withSequence`, layout animations or animated components). Any Reanimated-heavy v2 motion needs this mock extended first.

## 9. The canvas pipeline

- **How it works:** 23 `*.dc.html` boards read one `tokens.css` (SOURCE and APPLIED layers). `support.js` is a renderer reconstructed from the boards, not the original tool (`support.js:1-35`). `canvas.json` lays out 3 pages.
- **How it is tested:** `scripts/design/board.py <Board>` (structure, overflow, <44px targets, holes, screenshots in both themes) plus `--sweep`, `--all`, `--strict`; also `paint.py`, `palette.py` and `contrast.py`. These need Python and headless Chrome (`CHROME` env) and write to `.design-probe/`.
- **Is it usable for the new design?** Yes, for composition, copy, states and cheap measurement. It is **not** usable for motion, Skia fields, fonts or runtime parity:
  - Google Fonts vs system faces (`UI-006`).
  - Value drift from `tokens.ts`: danger `#9E3346` vs `#B4322F`, ok `#1E7A52` vs success `#1E9E6A`, plus `--plate` and `--violet` that do not exist in `tokens.ts`.
  - "Intended" states the app cannot render, such as the two-lobe field.
- **Tool limitation:** the designer agent is Read/Grep/Glob only. It can read screenshots but cannot run `board.py`, so the developer must produce the renders.

## 10. Gates built into every page (the fix for "redone several times")

Every page runs P0 through P7 in order. Nothing starts P5 until P1 and P3 are closed.

- **P0 Page brief** (`architect`): this page's integration slice, contract changes, and forks as decision tables.
- **P1 Requirement Ledger** (`compliance-auditor` and `regulatory-researcher` in parallel, **before design**): cited must / must-not rules, locked strings, and outside clocks.
- **P2 Design** (`designer`): board, states sweep and motion spec checked against the ledger; `board.py --sweep` clean.
- **P3 Human sign-off** (Daniel), plus a compliance pre-clear on the board. If Garmin data is shown, the §6.6 notice with mockups is sent here (Pause & Guide).
- **P4 Backend contract first** (developer + resilience), when needed.
- **P5 Mobile build** on v2 primitives (developer, TDD). Evidence: light/dark, reduced motion, font scale 1.3+, TalkBack, 60fps on the S22+.
- **P6 Parallel reviews:** designer SHIP on device screenshots; compliance on the **built** result; resilience audit; regulatory confirmation of legal copy placement.
- **P7 Merge approval** (Daniel). Then `custodian` removes that page's v1 leftovers and pins a guard.

**Which page-level features trigger which mandatory gate:**

| Page feature | Mandatory gate | Pages |
|---|---|---|
| Shows an inferred state or emotion input | regulatory (AI Act Art. 50) + compliance | Onboarding, Generate, Pulse, Consent, Now Playing / 7b |
| Shows Garmin-sourced data | compliance (DPA §6.6, 30-day notice; attribution above the fold) | Pulse, Generate body strip, 7b |
| Spotify content or playback | compliance (§II.4 attribution + link-back, §II.5 cover art, `HALT_SPOTIFY_TRACK_IDS`) | Now Playing, Up Next, any mini-player, 7b, History track lists (to verify) |
| OS permission or Health Connect | compliance (Play Health apps declaration, permission context, in-app privacy policy) | Connect, Profile, boot flow |
| Consent, retention, erasure copy | regulatory (GDPR Art. 7/9/13, EDPB layered notice) + compliance | Consent, Vault, Profile |
| OAuth or sign-in | compliance (Google branding, Apple HIG) | SignIn, Profile |
| YouTube | compliance (III.F.2.1 attribution, III.D.2.3.1 revocation) | Connect, Profile |

## 11. Design tools Daniel asked about (not verified: no web access here)

- "Taste Skill", "awesome-design-md" and "UI UX Pro Max" are, as far as I know, **web-first** prompt and skill packs (HTML, CSS, Tailwind). Their natural fit is P2 on the **HTML canvas**, not the RN code.
- They must be subordinate to VISION and the ledger. Generic taste rules could conflict with the regulator ethic: never red, no spinners, restraint.
- Installing them changes `.claude/` configuration and pulls third-party scripts. That needs **Daniel's own approval** and supply-chain vetting (`ORCHESTRATOR_FABLE.md:142`), with a web-capable agent verifying repo, licence and maintenance.
- Higher-leverage options already installed:
  - Reanimated 4 CSS-style animations and transitions.
  - Skia 2.6 runtime shaders (SkSL) for the field.
  - Skia's Skottie for Lottie playback without a new dependency (verify).
- Options that would need vetting: Rive (new native dependency), Storybook RN or the Design Gallery route, Maestro for on-device flows and screenshot evidence, Figma with a Tokens Studio / Style Dictionary pipeline.

## 12. Build order (dependency graph)

**Can start now, in parallel:**
- **T-H: UI-005 legal hotfix on the current v1 screens.**
  - Surface: developer + regulatory + compliance.
  - Scope: the invariant sentence in `GenerateScreen`, `OnboardingScreen` chrome, `PulseScreen`, and `ConsentSheet` fixed chrome (scope-framed variant), sitting on `textScrimFill`.
  - Tests: one exported constant, pinned; a11y-tree presence; AA both faces.
  - Why now: a P0 legal duty in force since 2026-08-02 must not wait months for the redesign. v2 inherits the constant.
- **T-C: docs truth reconciliation** (custodian + architect).
  - Baselines, Tamagui claims, the 8-vs-9 consent count, stale §10 and pairing-card rows, the agent roster, and adding the §10 trigger matrix to `/build-screen`.
  - Docs only; stage by path because another session edits docs in this tree.
- **T-L: global Requirement Ledger** (compliance ∥ regulatory).
  - Extract every ruling from `SCREENS.md`, the HALT and DEV plans, `UI_UX §7`, the canvas annotations and `TASKS` UI-001 to UI-006 into one per-page ledger with citations.
  - Verification: each entry cites its source; open items are marked UNVERIFIED.

**Then:**
- **T1: Daniel rules decisions A–F** (HITL).
- **T2: Vision Frame v2** (designer), after T1 and T-L. Covers:
  - Token values and shape; type faces (UI-006).
  - Motion vocabulary, including reconciling the breath law (canvas `4200+2000·stress`, 6200 ms vs shipped `BREATH_FLOOR×1.5`, 6300 ms).
  - Component inventory, 2–3 directions, the Generate hero board. HITL approval.
- **T3: v2 foundation** (developer), after T2. Covers:
  - `src/design/v2/tokens.ts` with a contrast contract test suite for both faces.
  - A theme hook that follows decision D.
  - Lint plumbing: v2 exemption, tokensPath for v2, config test.
  - The migration-ratchet guard, an extended jest Reanimated mock, and the Design Gallery route.
  - A `tokens.css` parity check.
  - Blast radius: design layer and lint only; zero screens.
- **T4: primitives** (developer + designer SHIP), after T3: Text, Button roles, Card/Row, Sheet, Screen scaffold, Chip, Toggle, v2 Skeleton/Empty/Offline, icon set, and the Field (after its decision).
- **T5: shell** (tab bar, dock with Retry wired, native-stack if C1, mini-player if chosen with the cover-art rule), after T4.
- **T-B: backend contract squad**, after T-L. Can run alongside T3–T5:
  - `targets` + evidence in `playlist_ready`; client `playback_event` / `tzOffsetMinutes` emission contract.
  - Pulse superset types; a preferences endpoint (discovery dial, field toggle); a History replay contract; consent version/date fields.
  - Each through TDD with DTO tests first.
- **T6…T16: pages, each running P0–P7.** Suggested order:
  - Consent (static, legal-critical, lowest motion risk), then Splash, Onboarding (+MB-009 ruling), SignIn, Connect (+ ownership of boot-time permission prompts).
  - Generate + Genesis, then Now Playing (+ feedback, seek), then 7b.
  - Pulse (+ Garmin notice clock), then History (+ replay), then Profile/Vault (+ Export, UI-001).

**Parallel squads:** L (ledger), B (backend), F (foundation), H (hotfix), C (docs). Pages run one at a time after T5.

## 13. Questions for Daniel

These decide the plan. Only he can answer them, and they should be asked before T2.
1. Should the new direction start fresh (F2), continue Quiet Instrument (F1), or evolve Aurora (F3)?
2. Default face: light, dark, or follow the phone (D)?
3. Five tabs or four? Should there be a persistent mini-player on the tab roots?
4. Should the living field be on by default, and which of the two breath laws wins?
5. Should UI-005 ship now on the current screens (recommended), or wait for the redesign?
6. Should onboarding be reseen per account or per device (MB-009)?
7. Which is the first page after the foundation?
8. May the design tools be installed into `.claude/`, after vetting?
9. Should an email sign-in path exist at launch?
10. Replay in History: build the contract, or remove the affordance?
11. The Spotify-only playback risk (Finding 4): is it accepted as out of scope for design?

Plan ready — approve before implementation.