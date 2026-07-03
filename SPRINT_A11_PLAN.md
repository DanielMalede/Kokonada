# Kokonada — QA4 Stress Audit + Sprint A11 Blueprint

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) Run a four-agent, full-system QA stress audit across backend Phases 1–7 and mobile Sprints A6–A10; (2) build Sprint A11: server-side session history feed + HistoryScreen fetch, Profile + Integrations screen with logout/GDPR deletion, and a richer Pulse screen driven by the state vector.

**Architecture:** Two sequential PRs. PR-QA (`feat/monster-qa4-stress`): four specialized QA personas write hostile attack tests first, fix every CONFIRMED finding, pin every held defense. PR-A11 (`feat/monster-s11-intelligence`): backend `GET /api/sessions` + `GET /api/pulse/state` with explicit whitelist DTOs, mobile token-plane unification onto `AuthSession`, shared `apiClient` with single-flight 401-refresh-retry, ProfileScreen replacing the placeholder tab, HistoryScreen server feed, Pulse enrichment.

**Tech Stack:** Backend — Express 5, Mongoose 9, Jest 29 (controller-direct tests, mocked models), AES-256-GCM field encryption. Mobile — RN 0.86, React 19.2, RTK cold / zustand warm / Reanimated hot, Jest 29 + react-test-renderer, MMKV+Keychain SecureStore.

## Global Constraints (from KOKONADA_ARCHITECTURE_MASTER.md — binding)

- **Strict TDD**: no production code without a failing test watched first (RED → GREEN → REFACTOR).
- **Regression gates**: full backend suite (909/909 baseline — re-verify exact count at run time) and full mobile suite (23 suites / 213 tests baseline) must stay green after every task.
- **Git**: short single-line commit messages, no body, no trailers. Branches `feat/monster-qa4-stress` then `feat/monster-s11-intelligence`. PR per phase via `gh pr create --body-file …`; PR bodies end with the Claude Code attribution footer. **STOP and await merge approval after each PR + audit comment.**
- **Backend test env**: `cd /c/Users/danie/Videos/AI-Music-App/backend && npm test` through the Bash tool, filter with `2>&1 | grep -aE "Test Suites:|Tests:"`. PowerShell mangles jest stderr. `npm install` may prune devDeps → restore with `npm install --include=dev`.
- **Mobile test env**: run from `mobile/KokonadaHealth` with `./node_modules/.bin/jest` (bare `npx jest` resolves a stale global no-op). New ESM deps go in `jest.config.js` `transformIgnorePatterns`. Mobile is NOT in CI — run locally, report counts honestly. `tsc --noEmit` verified **per sprint-owned file only** (pre-existing errors in `src/health/*` and test files are out of scope).
- **Zero-knowledge boundary**: raw vitals encrypted in Mongo; ledger stores coarse bands only; `bio:/hr:/biometric:` SecureStore denylist; worker job payloads carry no biometric values. **Approved posture extension (this sprint, product-owner ruling 2026-07-03): decrypted numeric vitals may be served to their OWNER via an explicit JWT-authed whitelist DTO — never via document serialization, never persisted on device.**
- **Serialization trap (applies to ALL new endpoints)**: `PlaylistSession` and `MedicalProfile` set `toJSON:{getters:true}` and encrypted-field getters DECRYPT. `res.json(doc)` leaks plaintext. Every new endpoint builds an explicit field-whitelist DTO (pattern: `publicUser()` in `backend/app/controllers/authController.js:34`). `.lean()` bypasses getters and returns ciphertext — equally wrong. This rule gets its own pinned attack test.
- **GDPR completeness**: any new user-owned Mongo collection must be added to the `Promise.all` in `backend/app/services/privacy/erasure.js` AND `scripts/gdpr-delete.js`; any new user-scoped Redis key must be added to `patternsFor()` in `backend/app/utils/userRedisPurge.js`. (A11 adds neither — pin a test that asserts this stays true.)
- **Never add a `railway up` CI job.** GitGuardian scans PRs — no token-shaped fixtures; alias Keychain `Password` accessors.

---

# PART 1 — THE QA4 SPECIALIZED STRESS-AUDIT TEAM (PR-QA)

The previous single Shadow auditor is retired. Four independent QA personas attack with fresh eyes, in sequence, on branch `feat/monster-qa4-stress`. Doctrine per agent: **hostile tests FIRST** (RED where a defect is suspected), **stateful fakes with real semantics** (in-memory MMKV Map, EventEmitter sockets, flaky Spotify remotes, real ZSET/Mongo semantics — never stub theater), **OPEN MANDATE** to exploit beyond the dictated list. Every CONFIRMED finding is fixed in the same PR; every held defense is pinned as a permanent test.

**Deliverable files** (new, permanent):
- Backend: `backend/tests/shadow.qa4.biometric.test.js`, `backend/tests/shadow.qa4.crypto.test.js`, `backend/tests/shadow.qa4.network.test.js`
- Mobile: `mobile/KokonadaHealth/src/__tests__/shadow.qa4.uiux.test.tsx`, `shadow.qa4.state.test.ts`, `shadow.qa4.network.test.ts`, `shadow.qa4.biometric.test.ts`

**Verdict format** (posted as the PR comment): one table per agent, rows = attack vectors, columns = `Attack | Target | Verdict (CONFIRMED→FIXED / DEFENDED-pinned / ACCEPTED-documented) | Pinned test`. End with a score line per agent and a combined scorecard.

**Known-suspect list** (recon findings the team must CONFIRM or REFUTE — do not assume, prove with a failing test first):
1. `authSession.setSession()` is never called in production; `bootstrap()` → false; the socket auth plane is dormant while REST uses `tokenStore`. (Crypto & State Agent)
2. `bootstrapColdPersistence()` (`src/state/store.ts:23`) is defined but never invoked from `App.tsx` — committed emotion intent may NOT survive a process restart despite the A7 architecture claiming persistence. (Crypto & State Agent)
3. `warmStore.setLiveHr` has no production caller — PulseScreen renders a `liveHr` that nothing feeds in the mounted app. (Biometric Validation Agent + UI/UX Agent)
4. `player` singleton is constructed without `onStateChange` — Spotify status changes are invisible to any UI. (Network Resilience Agent)

## Agent Q1 — The Biometric Validation Agent

**Persona:** physiologist-adversary. Mandate: break `translate()` math, physiological bounds, and the zero-knowledge boundary.
**Targets:** `backend/app/services/biosonic/translate.js`, `baselines.js`, `moodDescriptors.js` (`moodCoords`, `syntheticBioMoodKey`, `bandFromHeartRate`), `services/ledger/*`, `models/ServeEvent.js`, `models/BiometricLog.js`, mobile `src/state/warm/warmStore.ts` (HR plausibility gate), `src/experience/aura/auraUniforms.ts`.

**Exact test parameters:**
- **Structured fuzz, 1,000 rounds, seeded PRNG (seed=0xA11)** over the full `translate()` input shape: each field independently drawn from {valid range, NaN, +/-Infinity, -0, null, undefined, '', '42', 1e308, -1e308, {}, []}. Invariants asserted every round: all outputs finite; `bpmCenter∈[30,260]`-plausible; `bpmWidth>0`; `0≤energyFloor≤energyCeiling≤0.95`; `energyCeiling≥0.2`; `valenceTarget∈[0,1]`; `tempoBand∈{resting,active,peak}`; `confidence∈[0.3,1]`; `state.{recovery,stress,exertion}∈[0,1]`.
- **Boundary matrix** on `bandFromHeartRate` and the mobile plausibility gate: HR ∈ {29, 30, 31, 89, 90, 91, 119, 120, 121, 219, 220, 221} — assert band edges (<90 resting, <120 active, ≥120 peak) and mobile gate (30–220 accepts, outside keeps last good value). **Cross-check consistency**: document any semantic gap between mobile's 30–220 gate and backend bands.
- **Degenerate statistics**: MAD = 0 (constant HR series), MAD = 1e-12, negative MAD, median = null with MAD present (the `Number(null)===0` gotcha class) — robust-z must not explode or NaN-poison downstream.
- **Temporal attacks**: `hourOfDay ∈ {-1, 0, 4.99, 5, 20.99, 21, 23.99, 24, 25, NaN}` — windDown ×0.8 boundary exactness; clock-drift (future `servedAt`) age-clamp regression on `exposureScore`.
- **Golden-vector regression**: re-assert the pinned "4h sleep + high stress + walking" exact numbers and the well-rested control; cadence locks 118/162/145; "wrecked body gets no bangers" (R low → energyCeiling ≤ 0.35+0.6R ceiling even with energize tap).
- **Cross-boundary interaction**: `confidence < 0.7` → `hardFilters` must NOT apply the energy ceiling; a track without features must never be ceiling-filtered.
- **Zero-knowledge sweep** (grep-level + behavioral): ServeEvent rows contain ONLY coarse `{tempoBand, activity}`; `recordServes` payloads carry no raw HR; queue job payloads (`state-vector-recompute`, `feature-hydration`) contain no vitals; baseline cache blob is AAD-bound (cross-user replay → fresh compute, not decrypt); `<10 samples → null` never fabricated; mobile SecureStore denylist holds for `bio:x`, `hr:x`, `biometric:x`, mixed-case `Bio:x`, and namespaced `cold:v1:bio:x` variants (document exact denylist semantics if casing/namespacing passes — that is a finding).
- **Suspect #3**: prove with a rendered-PulseScreen + real warm store test whether any production path feeds `liveHr`; if none, verdict CONFIRMED (fix lands in A11 Pulse task; document cross-reference).

## Agent Q2 — The UI/UX Edge-Case Agent

**Persona:** chaos user with a 120 Hz finger. Mandate: freeze the Skia surface, corrupt Activity/Prompt state, shift layouts, leak subscriptions.
**Targets:** `src/experience/wheel/wheelGeometry.ts` + `RadialWheel.tsx`, `src/experience/aura/auraUniforms.ts`, `src/state/hot/laneCommit.ts`, `src/experience/generate/*` (`GenerateScreen`, `GenerateController`, `ActivityChips`, `PromptBox`, `activities.ts`, `promptSanitizer.ts`), `src/state/cold/emotionSlice.ts`, all five screens.

**Exact test parameters:**
- **Skia NaN-crash sweep**: `deriveAuraUniforms(hr)` for hr ∈ {null, undefined, NaN, ±Infinity, -1, 0, 29, 300, 9999, 1e308}: every uniform finite, hue∈[0,360], intensity∈[0,1], pulseHz∈[0.1,4] (strobe cap). `advancePulsePhase` with dt ∈ {0, -16, 1e6 ms (app slept), NaN}: phase stays in [0,2π), finite, monotone under normal dt.
- **Wheel geometry torture**: `screenToCircumplex` at zero radius, negative dims, NaN dims, touches at (±1e9, ±1e9), signed-zero normalization; Y-flip invariant (assert the documented arousal-UP flip exactly); round-trip `circumplexToScreen∘screenToCircumplex` within ε on 100 random disc points.
- **TapCommitter aliasing + storm**: reuse ONE mutable frame object across 50 gesture cycles, mutating it after each commit — committed taps must be immune (COPY semantics). 20 taps/sec burst: exactly one commit per gesture-end (debounce), ring buffer never exceeds 3, oldest evicted in order.
- **Prompt corruption corpus**: 50k-char paste; 500 emoji-ZWJ family sequences; RTL override U+202E; zero-width joiners; `\x00–\x1F` + DEL flood; newline flood; control-only string (must yield empty ⇒ CTA disabled, no phantom generate); idempotence `sanitizePrompt(sanitizePrompt(x)) === sanitizePrompt(x)` over the whole corpus; sanitizer enforced in BOTH `setTextPrompt` reducer AND `deserializeForPersist` (bypass the TextInput, dispatch straight to the store).
- **Activity state corruption**: rapid same-chip toggle ×100 (select/clear parity → ends null or selected, never undefined/stale); `hydrate` with activity = `{}`, 5k-char string, emoji key not in the 8 presets — define and pin expected behavior (allowlist to presets is the expected defense; if arbitrary strings pass to the Groq prompt verbatim, that is a CONFIRMED finding — the backend prints activity into the LLM prompt); race: activity changed between CTA press and socket emit — payload must be the committed-at-press snapshot or the latest, but deterministically ONE of them (pin which).
- **CTA morph matrix**: all combinations of {taps: 0/1/3} × {liveHr: null/valid} × {generationPending: t/f} × {textPrompt: empty/control-only/valid} → exact CTA state (disabled / Generate / Listen-to-your-heart), no impossible states.
- **Subscription parity on EVERY screen** (the S10-1 lesson generalized): mount/unmount ×100 for Generate, NowPlaying, Pulse, History (and A11's Profile when it lands) — subscribe count === unsubscribe count for warmStore, nowPlayingStore, playbackErrorStore; React 18 removed the unmounted-setState warning, so parity counting is the ONLY valid method.
- **Layout shift probes**: keyboard-focus mini-ring state with taps committed (taps stay visible per blueprint); FlatList key stability in HistoryScreen (`${id}-${index}` keys — duplicate track ids at different indexes must not recycle wrong rows).

## Agent Q3 — The Cryptography & State Agent

**Persona:** forensic locksmith. Mandate: break MMKV/SecureStore encryption limits, the JWT lifecycle, rehydration, and find 3-lane memory leaks.
**Targets:** `src/storage/secureStore.ts` + `src/state/cold/coldPersistence.ts` + `src/state/store.ts`, `src/auth/authSession.ts` + `src/auth/tokenStore.ts` + `src/auth/auth.ts`, backend `utils/encryption.js`, `utils/jwt.js`, `utils/tokenDenylist.js`, `middleware/auth.js`, `models/*` encrypted fields, `services/medicalProfileService.js` (`stateVector.status` explicit-encrypt), `services/privacy/erasure.js` + `utils/userRedisPurge.js`.

**Exact test parameters:**
- **Poisoned persisted blob corpus** (inject via a fake KVBackend, then rehydrate): `__proto__`/`constructor.prototype` pollution payloads; taps array length 4, 400, 4e6; taps with `{x:'1e2',y:{}}` type confusion; injected `liveHr`/`accessToken`/`isAdmin` fields; truncated JSON at every byte offset of a valid blob (sampled: 20 offsets); random 4KB of bytes; empty string; the string `null`. Invariant: rehydrate yields defaults or the sanitized allowlist shape — never throws, never grows taps past 3, never injects a foreign field.
- **MMKV limits**: 1 MB and 8 MB single-value writes through SecureStore (fail-soft `false`, never throw); write during a backend that throws on every 3rd call (interrupted-device simulation); `wipe()` ordering — subscribe a writer, wipe, assert ZERO post-wipe writes (detach-before-reset race), then assert store re-populated defaults are NOT re-persisted until next explicit attach.
- **Cross-user isolation**: persist as user A, rehydrate as user B → B gets defaults; wipe as B → A's namespaced blob untouched.
- **JWT lifecycle**: concurrent `auth_expired` (socket) + two REST 401s within one tick → exactly ONE refresh call (single-flight), one rotation; refresh returning 401 (family burned) → clean signed-out state, no retry loop, no crash; `refresh()` called with no session → null, no throw. **Suspect #1 (dual token plane)**: a test that boots the app factories exactly as `App.tsx`/`playbackServices.ts` do and asserts whether `authSession.getAccessToken()` can EVER be non-null via the production login path (`auth.ts` → tokenStore only). Expected verdict: CONFIRMED (fix = A11 Task 0; the QA PR documents it and pins the failing behavior as a TODO-linked test that A11 flips green — or fixes it in-PR if the team judges it blocking).
- **Suspect #2 (dormant rehydration)**: assert `bootstrapColdPersistence` is invoked by app bootstrap; if not, CONFIRMED — decide with evidence whether to fix in QA PR (wire the call) or hand to A11 Task 0 (which touches the same bootstrap seam); either way pin the test.
- **Backend crypto**: AAD cross-user replay on `bio:baseline:{userId}` (blob for user A presented under user B → fresh compute); `ENCRYPTION_KEY_PREVIOUS` rotation (encrypt under old, decrypt under new config); `findOneAndUpdate` setter bypass class — grep + behavioral test that every `$set` on an encrypted field goes through explicit `encrypt()` (the `metricStore.persistMetrics` pattern); `stateVector.status` round-trip: it is a plain String field written pre-encrypted — assert any reader decrypts (a reader that forgets shows ciphertext; A11's pulse DTO is the first real reader — pin the contract NOW with a red test the A11 build turns green, or a unit test on the service layer).
- **Denylist fail-posture**: `isRevoked` with Redis down — document and pin whether auth fails open or closed; flag the chosen posture in the report.
- **GDPR erasure completeness**: enumerate Mongo collections with a `userId` field via model registry vs the `erasure.js` `Promise.all` list — assert set equality (this test permanently guards A11+ against orphaned collections); assert `patternsFor()` covers `ledger:*`, `pool:*`, `bio:baseline:*` and nothing user-scoped is missing (grep Redis key literals in `app/`).
- **3-lane leak hunt**: 50 socket connect/disconnect cycles → listener count on the fake socket constant (S9-1 amplification); orchestrator scheduler timers cleared after skip-coalesce bursts; `AppLifecycle` AppState listener parity across 100 mount/unmount cycles.

## Agent Q4 — The Network Resilience Agent

**Persona:** hostile network + hostile Spotify. Mandate: desync the player, race the server, storm the socket.
**Targets:** `src/net/socketClient.ts` + `socketFactory.ts`, `src/experience/player/spotifyController.ts` + `spotifyRemoteAdapter.ts`, `src/experience/playback/*` (`PlaybackQueue`, `PlaybackOrchestrator`, `foregroundReconcile`, `playbackServices`, `nowPlayingStore`, `playbackErrorStore`), backend `sockets/biometricHandler.js` emit path, `controllers/authController.js` `deleteAccount` socket force-disconnect.

**Exact test parameters:**
- **Reconnect storm**: 50 rapid connect→disconnect cycles on an EventEmitter fake — exactly one live socket at the end; `emotion_update` re-emitted on EVERY connect (server cache is socketId-keyed); zero listeners on any replaced socket (teardown regression S9-1); buffered late event on a dead socket → dropped, not processed.
- **Auth-expiry storm**: `auth_expired` fired 10× in 100 ms with a refresh that takes 50 ms → ONE refresh, ONE reconnect (loop cap); refresh permanently failing → socket stays down cleanly, no infinite backoff-fight with socket.io's own reconnection.
- **reqId gating fuzz**: responses delivered out of order (req 3's playlist before req 2's error); stale `playlist` and stale `playlist_error` both dropped; reqId type confusion (server echoes `"7"` for 7) — pin exact comparison semantics; duplicate delivery of the SAME playlist event (at-least-once) → idempotent handling.
- **Generation single-flight under chaos**: 20 skip-past-end taps → exactly 1 `request_playlist`; `playlist_error` unblocks; disconnect WHILE `generationPending=true` → pending cleared or re-armed on reconnect (pin which — a stuck-forever spinner is a CONFIRMED finding); logout mid-generation → no late playlist processed after teardown.
- **Spotify desync suite**: `remoteDisconnected` exactly at track-end (stale-end guard × dead remote); play command throw mid-song → `{ok:false}` + `disconnected` state, NO unhandled rejection (assert via process-level rejection hook in the test); `getPlaybackState()` returning null/garbage/foreign URI → URI-aware reconcile (S11-1 regression) + reconcile IDEMPOTENCE under 10 rapid AppState active/background flaps; capped reconnect exhaustion → stable disconnected, UI shows it.
- **Client-server races (backend side, stateful fakes)**: `emotion_update` racing `request_playlist` on the same tick (cache keyed by socketId — assert the playlist uses the just-set emotion or a deterministic fallback, never a cross-socket bleed); two `request_playlist` from the same socket back-to-back (server-side dedup/last-wins — pin observed semantics); `deleteAccount` force-disconnect (`user:<id>` room) while a generation is in flight → no post-deletion emit reaches the socket, no orphaned ServeEvent write after erasure (write-after-erase = CONFIRMED GDPR finding).
- **Suspect #4**: assert Spotify `PlayerState` changes are observable by ANY store/UI in the composed production graph (`playbackServices`) — expected CONFIRMED (invisible status), fix lands in A11 Profile task; pin the contract test.
- **A11 pre-pin (red tests handed to the A11 build)**: sessions-feed fetch racing logout (401 mid-pagination → clean empty state, no retry storm); pull-to-refresh spam → single-flight; account-deletion semantics = SERVER-FIRST (local wipe only after 200; network failure → error surfaced, NO local wipe; server 200 then app killed → idempotent re-wipe on next boot via signed-out bootstrap).

**QA PR gate & sequence:** Q1 → Q2 → Q3 → Q4, each: write attacks (RED) → fix CONFIRMED → full suite green → single-line commit per fix/pin. Then full backend + mobile suites, PR, verdict tables as PR comment, **STOP for merge approval.**

---

# PART 2 — SPRINT A11 BLUEPRINT (`feat/monster-s11-intelligence`, PR-A11)

Persona: **Agent A11 "Intelligence"** — the sprint that makes the app remember (server history), self-govern (profile/GDPR), and self-report (state-vector Pulse). Build order is Task 0 → 6; each task is TDD'd, committed, and keeps both suites green.

## Locked contracts (product-owner rulings 2026-07-03)

1. **Pulse privacy**: `GET /api/pulse/state` returns the OWNER's decrypted numeric vitals via explicit whitelist DTO (hrv, bodyBattery, dailyReadiness, restingHeartRate, lastNightSleep, stateVector.status decrypted + confidence + computedAt). Never persisted on device; warm/ephemeral only.
2. **Token plane**: unify onto `AuthSession`. Login populates the rotating `{access, refresh}` pair; the new `apiClient` AND the socket read `authSession.getAccessToken()`; 401 → single-flight `authSession.refresh()` → retry ONCE.
3. **History DTO**: metadata + trackSummary + decrypted `contextPrompt`. Encrypted HR snapshot NEVER serialized.

## Task 0 — Token-Plane Unification (mobile + possibly backend)

**Files:** Modify `mobile/KokonadaHealth/src/auth/auth.ts`, `src/auth/authSession.ts` (only if API gaps), `src/experience/playback/playbackServices.ts`, `App.tsx`; possibly `backend/app/controllers/authController.js` (google/apple/login response shape); wire `bootstrapColdPersistence()` (`src/state/store.ts:23`) into app bootstrap (closes QA Suspect #2 if QA left it red).
**Interfaces:** Produces — a single authoritative token source: `authSession.bootstrap(): Promise<boolean>`, `getAccessToken(): string|null`, `refresh(): Promise<string|null>`, `setSession(pair: {access, refresh})`, `clear()`. Login flow calls `setSession` with the server pair.
**Steps:**
- [ ] VERIFY FIRST (read, don't assume): what `POST /api/auth/google` actually returns (`backend/app/controllers/authController.js`). A6 built rotating refresh tokens — confirm whether the response body carries the refresh token for mobile or only sets an HTTP-only cookie. If body lacks it: extend the backend response (TDD: controller-direct test asserting `{token, refreshToken, user}` or agreed shape) — cookies don't serve a React Native socket+fetch client cleanly.
- [ ] Mobile: failing test — production login path results in `authSession.getAccessToken() !== null` (flips QA Q3's pinned red test green). Then implement: `auth.ts` login → `authSession.setSession(pair)`; keep `tokenStore` writes temporarily for the 4 legacy ad-hoc fetches OR migrate them to `apiClient` in Task 1 and delete `tokenStore` usage (preferred — one plane, delete dead code per doctrine).
- [ ] Wire `bootstrapColdPersistence()` into `App.tsx` startup (before `startPlayback()`), with its existing rehydrate/attach semantics; failing test first via the app-bootstrap composition.
- [ ] Full mobile suite green; single-line commits per RED→GREEN cycle.

## Task 1 — Shared Mobile REST Client

**Files:** Create `mobile/KokonadaHealth/src/net/apiClient.ts` + `src/net/__tests__/apiClient.test.ts`.
**Interfaces:** Produces — `apiGet<T>(path): Promise<ApiResult<T>>`, `apiDelete<T>(path)`, `apiPost<T>(path, body)` where `ApiResult<T> = {ok:true, data:T} | {ok:false, status?: number, error: string}`. Consumes — `authSession` (Task 0), `BACKEND_URL` from `src/health/config.ts`. Never throws; network failure → `{ok:false}`.
**Test scenarios (write first):** injects `Authorization: Bearer` from authSession; 401 → exactly one `refresh()` then one retry (mock fetch sequence 401→200); refresh null → `{ok:false, status:401}` and NO retry; concurrent 401s → single-flight refresh (delegated to authSession — assert one refresh call); malformed JSON body → `{ok:false}`; fetch throw (airplane mode) → `{ok:false}`.
**Steps:** RED suite → implement → GREEN → migrate `liveHrClient.ts`/`uploadClient.ts`/`playbackServices.ts` refresh fetch onto it only if trivially safe, else document as follow-up → commit.

## Task 2 — Backend: `GET /api/sessions` (history feed)

**Files:** Create `backend/app/routes/sessions.js`, `backend/app/controllers/sessionsController.js`, `backend/tests/sessions.test.js`; Modify `backend/app/index.js` (mount `app.use('/api/sessions', sessionsRouter)` after the auth/csrf middleware block, lines ~84–91), `backend/app/models/PlaylistSession.js` (add `trackSummary: [{id, title, artist}]`, cap 50), `backend/app/sockets/biometricHandler.js` (write `trackSummary` from the merged playlist at session-save).
**Interfaces:** Produces — `GET /api/sessions?limit=20&before=<ISO createdAt>&beforeId=<id>` (auth middleware; limit clamped 1–50) → `{items: SessionDTO[], nextCursor: {before, beforeId} | null}`. `SessionDTO = {id, createdAt, moodKey, provider (musicProvider), activity (biometricSnapshot.activity), contextPrompt (decrypted via getter, explicit field read), isFallback, skipCount, trackCount, tracks: trackSummary[] (fallback [] for pre-A11 sessions, trackCount from trackIds.length)}`. **NEVER** in the DTO: `biometricSnapshot.heartRate`, `trackKeys`, `llmCacheKey`, raw doc spread.
**Test scenarios (controller-direct, mocked models per `backend/tests/accountDeletion.test.js` pattern):** DTO whitelist — a session doc with heartRate + prompt yields a response containing the decrypted prompt but NO heartRate key anywhere (deep scan of the JSON); pagination — 3 pages via cursor, stable order (createdAt desc, `_id` tiebreak on equal timestamps), no duplicates/omissions across page boundaries; limit clamp (0→1, 500→50, 'abc'→default 20); cross-user isolation (query is `{userId: req.user._id}` — a forged cursor cannot leak another user's rows); pre-A11 session (no trackSummary) → `tracks: []`, `trackCount` from trackIds; empty history → `{items: [], nextCursor: null}`; uses the existing `{userId:1, createdAt:-1}` index (assert query shape, no new index needed).
**Steps:** RED → controller+route+mount → GREEN → `trackSummary` write-path test (session save includes ≤50 `{id,title,artist}` from merged tracks; missing title/artist fields tolerated) → GREEN → full backend suite → commits.

## Task 3 — Backend: `GET /api/pulse/state`

**Files:** Create `backend/app/routes/pulse.js`, `backend/app/controllers/pulseController.js`, `backend/tests/pulse.test.js`; Modify `backend/app/index.js` (mount `/api/pulse`).
**Interfaces:** Produces — `GET /api/pulse/state` (auth) → `PulseStateDTO = {stateVector: {status: string|null (DECRYPTED — the model field is a plain String holding ciphertext, service encrypts explicitly; reader MUST decrypt), confidence, computedAt}, vitals: {hrv, bodyBattery, dailyReadiness, restingHeartRate}, sleep: {lastNight: {deep, light, rem, date}, updatedAt}, lastAnalyzed, sampleCount}`. All-null-safe shape when no MedicalProfile exists (200 with nulls, not 404 — the screen renders empty gauges).
**Test scenarios:** decrypted status round-trip (write via `upsertStateVector`-style encrypted fixture, read shows plaintext); no-profile → full null shape, 200; DTO whitelist — response NEVER contains `spO2`, `hrZones`, `gpsVelocityKmh`, raw encrypted blobs, or any unlisted field (deep-scan assertion); getter-vs-lean trap pinned (the controller reads via a doc with getters OR explicit `decrypt()` — whichever is chosen, a test proves plaintext out AND proves `res.json` was fed a hand-built object, not the doc); auth required (no `req.user` → 401 shape `{error}`).
**Steps:** RED → implement (explicit DTO builder function, exported for tests, `publicUser()` pattern) → GREEN → full suite → commit.

## Task 4 — Mobile: HistoryScreen server feed + ProfileScreen

**Files:** Create `mobile/KokonadaHealth/src/experience/history/sessionsApi.ts` (+ test), `src/experience/profile/ProfileScreen.tsx`, `src/experience/profile/profileController.ts` (pure: logout/delete orchestration + status assembly) (+ tests), minimal `src/auth/SignInScreen.tsx` + auth gate in `App.tsx`; Modify `src/experience/history/HistoryScreen.tsx`, `src/navigation/RootNavigator.tsx` (replace the `Placeholder` Profile tab, line ~35), `src/experience/playback/playbackServices.ts` (construct `player` WITH `onStateChange` → a `playerStatusStore` or warm-store field — closes QA Suspect #4).
**Interfaces:**
- `sessionsApi.fetchSessions(cursor?): Promise<ApiResult<{items, nextCursor}>>` over `apiGet` (Task 1).
- `profileController`: `loadProfile(): Promise<{me (GET /api/auth/me), integrations (GET /api/integrations/status)}>`; `logout(): Promise<void>` — order: best-effort `POST /api/auth/logout` → socket `teardown()` → `player.dispose()` → `authSession.clear()` + `clearWatchToken()` (+ `tokenStore.clearToken()` if any remains) → `ColdPersistence.wipe()` → `warmStore.reset()` → nowPlaying/error store resets → auth gate flips to SignIn; `deleteAccount(): Promise<ApiResult>` — SERVER-FIRST: `DELETE /api/auth/account`; on `{ok:true}` run the local logout teardown (skip the server logout call); on `{ok:false}` surface error, NO local wipe.
**Test scenarios (write first):**
- HistoryScreen: renders server items (mood, time, track summary); infinite scroll appends next cursor page exactly once per end-reach (single-flight — QA Q4's pre-pinned red tests go green here); pull-to-refresh resets to page 1; `{ok:false}` → error state with retry, no crash; unmount mid-fetch → no state update (parity + no act warnings); empty feed → "Nothing yet" state; pre-A11 sessions (empty tracks) render trackCount fallback.
- ProfileScreen: shows displayName/email/avatar from `/me`; Spotify/wearable badges from integrations status + live `player` state via the new `onStateChange` wiring; logout button runs the full teardown ORDER (assert call sequence on fakes); delete flows through a two-step confirm (type-to-confirm or double-tap pattern — one deliberate friction step), server-first semantics per QA Q4 pre-pins; subscription parity on unmount.
- Auth gate: no session → SignInScreen; successful sign-in → tabs + `startPlayback()`; logout → back to SignIn; killed-after-delete → next boot lands signed-out cleanly (bootstrap false path).
**Steps:** RED per unit (controller logic first, screens after) → GREEN → RootNavigator swap → full mobile suite → per-file `tsc --noEmit` → commits.

## Task 5 — Mobile: Richer Pulse

**Files:** Create `src/experience/pulse/pulseStateStore.ts` (zustand vanilla, EPHEMERAL — never persisted; shape mirrors `PulseStateDTO` + `fetchedAt`) and `src/experience/pulse/pulseApi.ts` (+ tests); Modify `src/experience/pulse/PulseScreen.tsx`, `src/experience/playback/foregroundReconcile.ts` (add guarded pulse refresh on foreground), `src/health/liveHr.ts` wiring so `onHr` ALSO feeds `warmStore.setLiveHr` (closes QA Suspect #3 — additive callback, `pushLiveHr` backend path untouched).
**Interfaces:** Consumes `apiGet('/api/pulse/state')` (Task 1), warm store. Produces PulseScreen sections: live HR (now actually fed), HRV, body battery, readiness, last-night sleep, `stateVector.status` + confidence — each null-safe (`'—'` placeholders), fetched on tab focus + foreground reconcile, single-flight, stale-while-revalidate (show `fetchedAt` data instantly, refresh in background).
**Test scenarios (write first):** null-shape DTO renders all placeholders without crash; fetch failure keeps last good state + never throws into render; foreground reconcile triggers ≤1 refresh per activation burst (10 rapid AppState flaps → 1 fetch — mirrors reconcile idempotence); liveHr wiring — fake BLE `onHr(72)` → warm store 72 → PulseScreen shows it (plausibility gate still applied); subscription parity; store reset on logout (hook into Task 4's teardown, assert in the logout-order test).
**Steps:** RED → GREEN per unit → full mobile suite → per-file tsc → commits.

## Task 6 — A11 Shadow Audit + PR

- [ ] Run the standing Shadow Audit (unrestricted, full-system) against A11's new surface with the QA4 doctrine: DTO leak deep-scans, cursor forgery, delete-vs-inflight-generation race, logout-order mutation testing, pulse fetch storms. New attack files: `backend/tests/shadow.a11.test.js`, `mobile/.../src/__tests__/shadow.a11.test.tsx`.
- [ ] Confirm the Q3 GDPR set-equality test still passes (A11 added no collections/keys) — if `trackSummary` or any cache changed that calculus, extend `erasure.js`/`patternsFor()` + `scripts/gdpr-delete.js` in lockstep.
- [ ] Full backend + mobile suites green; per-file tsc clean; PR `feat/monster-s11-intelligence` with audit verdict table as comment; **STOP for merge approval.**

## Verification (end-to-end)

1. Backend: `cd /c/Users/danie/Videos/AI-Music-App/backend && npm test 2>&1 | grep -aE "Test Suites:|Tests:"` — everything green, count strictly greater than baseline (new suites added, zero removed).
2. Mobile: from `mobile/KokonadaHealth`: `./node_modules/.bin/jest 2>&1 | grep -aE "Test Suites:|Tests:"` — green, count > 213 baseline.
3. Manual REST smoke (against local backend with a real JWT): `GET /api/sessions` twice with cursor → disjoint pages; deep-grep response for `heartRate` → absent; `GET /api/pulse/state` for a user with no MedicalProfile → null shape.
4. On-device (Galaxy S22+, per master doc §D): login → History tab loads server sessions → Profile shows real integration status → logout lands on SignIn with zero residual state (relaunch stays signed out) → sign back in → Pulse shows state-vector gauges.
5. Honest reporting: exact suite counts in the PR body; any deviation from this plan called out explicitly.

---

# PART 3 — EXECUTION HANDOFF PROMPT (copy-paste to the execution model)

```
Read C:\Users\danie\Videos\AI-Music-App\KOKONADA_ARCHITECTURE_MASTER.md in full and adopt its persona, TDD iron law, Shadow doctrine, git/PR protocol, and environment gotchas exactly. Then read the approved strategy document at C:\Users\danie\Videos\AI-Music-App\SPRINT_A11_PLAN.md — it is your binding execution contract. Execute it in two sequential phases:

PHASE 1 — QA4 STRESS AUDIT (branch feat/monster-qa4-stress):
Adopt each of the four QA personas IN SEQUENCE — Q1 Biometric Validation, Q2 UI/UX Edge-Case, Q3 Cryptography & State, Q4 Network Resilience — and execute each agent's charter from PART 1 of the strategy document exactly: hostile attack tests FIRST (RED where a defect is suspected), stateful fakes with real semantics (never stub theater), the exact fuzz corpora, boundary matrices, and iteration counts specified. You hold an OPEN MANDATE to exploit beyond the dictated scenarios. Prove or refute all four Known Suspects with failing tests before touching any fix. Fix every CONFIRMED finding in the same PR; pin every held defense as a permanent test in the specified shadow.qa4.* files. Gate: full backend suite AND full mobile suite green (backend via Bash from /c/Users/danie/Videos/AI-Music-App/backend with `npm test 2>&1 | grep -aE "Test Suites:|Tests:"`; mobile via ./node_modules/.bin/jest from mobile/KokonadaHealth). Short single-line commits per RED→GREEN cycle. Open the PR with gh pr create --body-file, post the four verdict tables (CONFIRMED→FIXED / DEFENDED-pinned / ACCEPTED-documented) plus a combined scorecard as a PR comment, then STOP and await merge approval.

PHASE 2 — SPRINT A11 (branch feat/monster-s11-intelligence, only after Phase 1 merge approval):
Adopt Agent A11 "Intelligence". Execute PART 2 of the strategy document task-by-task in order (Task 0 token-plane unification → Task 1 apiClient → Task 2 GET /api/sessions → Task 3 GET /api/pulse/state → Task 4 HistoryScreen feed + ProfileScreen + auth gate → Task 5 richer Pulse → Task 6 A11 shadow audit). Honor the three locked product-owner rulings (owner-decrypted pulse vitals via whitelist DTO; single AuthSession token plane with single-flight 401-refresh-retry; history DTO with decrypted contextPrompt and NEVER the HR snapshot). Strict TDD on every unit: watch the failing test fail before implementing. Respect the serialization trap (never res.json a mongoose doc from PlaylistSession/MedicalProfile — explicit whitelist DTOs only, with deep-scan leak tests) and the GDPR lockstep rule (erasure.js + userRedisPurge.js + scripts/gdpr-delete.js). Verify Task 0's backend assumption by reading authController before coding. Finish with the Task 6 shadow audit, both suites green with counts strictly above baseline (backend 909 / mobile 213), per-file tsc --noEmit clean on sprint-owned files, PR + audit comment, then STOP and await merge approval.

Non-negotiables for both phases: no code without a failing test watched first; delete code written before its test; stateful fakes over mocks wherever semantics matter; short single-line commit messages; report exact suite counts honestly (never claim green without pasted output); never add a railway up CI job; no token-shaped test fixtures (GitGuardian); mobile is not in CI — run it locally and paste the counts. If reality contradicts the strategy document at any point, stop, state the contradiction explicitly with evidence, and adjust with the smallest faithful deviation rather than improvising silently.
```
