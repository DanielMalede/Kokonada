# TASKS — Kokonada

The single running list of everything still open in this repo. **If it is not written here, it does not exist.**
A task that lives only in a conversation is already lost — that is what this file exists to stop.

**Last updated:** 2026-08-27
**Next free IDs:** `BE-014` · `MB-008` · `UI-004` · `OPS-015` · `ARCH-004` · `DAN-010`

---

## How this file is maintained — read this, every session

**Read `TASKS.md` at session start, right after `CLAUDE.md` and the `docs/ORCHESTRATOR_FABLE.md` session-start protocol. Recommend the next job from it.**

**1 · Capture immediately, not later.**
The moment Daniel says something should happen afterwards — "we'll do that next", "remind me", "not now", "אחר כך" — write the row *before* continuing the current work. Not at the end of the session. Not "I'll remember".

**2 · When the section is unclear, use `## Inbox`.**
Quote his own words verbatim and move on. Never drop a task because it did not fit a heading. Sort the inbox at the start of the next session.

**3 · Close only on evidence.**
A row moves to the archive when the work is done **and proven** — a passing test, a real on-device run, a commit hash. Never on intent, never on "should work", never on a green mock. If it is half done, leave it open and add what is left.

**4 · Never silently delete a row.**
If a task becomes irrelevant, move it to the archive marked `dropped` with one line of why. The archive is how we avoid re-litigating the same question in three weeks.

**5 · Every seeded row is a claim, not truth.**
Rows carrying `#verify` were written from outside the code and have not been proven against the tree. Before acting on one: challenge the assumption, prove each claim against the actual files, fix what is wrong, add what is missing. **Nothing gets deleted or changed on an unverified assumption.** If a claim cannot be proven either way, mark it `#inconclusive`, leave the code alone, and say so. Drop the `#verify` tag only once you have checked it yourself and cite the `file:line` you checked.

**6 · Update this file in the same commit as the work.**
That is what keeps it from drifting. Commit message stays short and single-line, no body, no trailers, no attribution of any kind (`CLAUDE.md` → Attribution policy).

**7 · IDs are never reused.**
Take the next free ID from the header and bump it there in the same edit.

**8 · Tasks go here, not into a new `.md` file.**
Daniel does not want the repo flooded with markdown. A task gets a row here; only a genuinely large piece of work earns its own doc under `docs/plans/`, and then this file carries the row that links to it.

### Row format

```
- [ ] `BE-004` `P2` One sentence — what is wrong or what must exist.
  - where: `path/to/file.js:41` · done when: the observable condition · src: where this came from · added: YYYY-MM-DD
```

**Priorities:** `P0` blocking or a live security/data risk · `P1` next up · `P2` should happen · `P3` nice to have.
**Tags:** `#verify` unproven claim · `#inconclusive` checked, could not be settled · `#blocked` waiting on something named in the row.

---

## Inbox — uncategorised, sort at next session start

_(empty — put anything you are unsure about here rather than losing it)_

---

## Backend

- [x] `BE-008` `P0` ~~CROSS-SITE WEBSOCKET HIJACKING — live in production right now. Any website on the internet can open a fully authenticated duplex socket for any logged-in user and read back Art.9 biometric data.~~ **CLOSED ON EVIDENCE 2026-09-02 — the hole is shut on `main` (PR #184) and verified in this merge.** `backend/app/sockets/index.js` now takes `handshake.auth.token` ONLY — the raw `Cookie:` fallback is deleted and every remaining mention in that file is explanatory comment. The `done when` condition is met: `backend/tests/socket.crossSite.test.js` exists and the cross-site handshake is REJECTED, and the `socket.auth.test.js` case that used to prove the hole is INVERTED rather than deleted, so the old behaviour cannot return unnoticed. This is the most serious defect surfaced in this effort, and it lands directly on the `<locked_decisions>` zero-knowledge-biometrics guarantee.
  - **The mechanism, four facts that only compose into a hole together:** (1) `backend/app/sockets/index.js:27-33` falls back to parsing the raw `Cookie:` header when `handshake.auth.token` is absent. (2) `backend/app/utils/jwt.js:17` sets the session cookie `sameSite:'none', secure:true` in production, so the browser attaches it to cross-site requests. (3) WebSocket upgrades are **exempt from the same-origin policy** — there is no preflight and no ACAO check to fail. (4) `/socket.io/` never reaches Express middleware at all: Engine.IO intercepts the `request`/`upgrade` listeners ahead of Express, so `csrfOriginGuard` (mounted at `/api/`, `app/index.js:95`) can never see the handshake. `engine.io/build/server.js:61-63` wires `opts.cors` as the same `cors` npm middleware, which sets headers and calls `next()` — it does **not** reject the upgrade.
  - **Impact:** `io('https://…railway.app', {transports:['websocket'], withCredentials:true})` from `evil.example` yields an authenticated socket able to emit `biometric_push`, `emotion_update`, `request_playlist`, `playback_event`, `track_skipped` (`sockets/biometricHandler.js:1772-1876`) and read every payload emitted back.
  - **A PASSING TEST SITS ON TOP OF THE MECHANISM.** `backend/tests/socket.auth.test.js:193-197` — *"accepts a valid session cookie when no handshake.auth.token is present"* — proves it over a real WebSocket (`transports:['websocket']` :60, `extraHeaders:{Cookie:…}` :63). The only thing it omits is an `Origin` header, and no code path reads one. The suite is not blind here; it is *documenting* the hole as intended behaviour.
  - fix: delete the cookie fallback — `handshake.auth.token` only. Both real clients already use it (`mobile/.../net/socketFactory.ts:17`); the web client that needed `withCredentials` is being deleted. Lands in `BE-009`.
  - done when: `backend/tests/socket.crossSite.test.js` exists (clone `socket.auth.test.js:58-67`, add `Origin: 'https://evil.example'`) and the handshake is REJECTED. It currently connects — the test is RED today and should be. · src: `resilience-auditor`, 2026-08-26 · added: 2026-08-26
- [x] `BE-009` `P0` ~~Retire the cookie auth plane — its own branch, lands BEFORE the web removal.~~ **CLOSED ON EVIDENCE 2026-09-02 — the cookie auth plane is retired on `main` (PR #184) and verified in this merge.** `backend/app/middleware/auth.js` is Bearer-only; `req.cookies[COOKIE_NAME]` is no longer read and the `?ct=` connect-token path is preserved as specified. `clearAuthCookie` remains at `authController.js:106/143/179/185/217/249`, which is the prescribed unconditional clear so cookies already in the wild die on next login. Cookie-borne auth reaches every state-changing route: `middleware/auth.js:36` reads `req.cookies[COOKIE_NAME]` **before** the Bearer header, and `auth.middleware.test.js:138-155` pins that the cookie WINS when both are present. Deleting `frontend/` does not retire it — `authController.js:178` sets the cookie on **every refresh with no client check**, and the mobile app's own session refresh calls that endpoint (`mobile/.../auth/session.ts:25-28`).
  - steps: stop issuing at `authController.js:102`, `:139`, `:178` (keep `clearAuthCookie` at `:175/:210/:242`, and add an unconditional clear on every successful auth response for one release so cookies already in the wild die on next login) · delete the read at `middleware/auth.js:36`, Bearer only, KEEP the `?ct=` connect-token path at `:19-34` which the OAuth navigation genuinely needs · delete the socket cookie fallback `sockets/index.js:27-33` (closes `BE-008`) · fix or confirm-dead the legacy client `mobile/src/auth/auth.ts:37`, which omits `client:'mobile'` and therefore gets a cookie issued.
  - **This branch MUST also close `OPS-013`** — retiring the cookie changes auth middleware order, and the suite provably cannot see middleware order or route registration. Exporting the app from `index.js` is a legitimate part of this branch, not scope creep: without it there is no way to prove the retirement worked.
  - `auth.middleware.test.js:107-122` and `:138-155` must be INVERTED in the same commit, never silently deleted — they are the pin that the old behaviour is gone. · src: `resilience-auditor` ordering (d), 2026-08-26 · added: 2026-08-26
- [ ] `BE-010` `P1` `POST /api/integrations/suunto/webhook` is registered at `routes/integrations.js:97`, **below** `router.use(auth)` at `:56`, but `suuntoWebhook` reads `req.user._id` (`integrationsController.js:641`). A server-to-server Suunto push carries no session, so it can never authenticate — the endpoint is unreachable by its only caller. `#verify`
  - Related: `middleware/csrf.js:10-11` justifies its fail-open by citing "the server-to-server Suunto webhook using HMAC" — a rationale that is stale for a route now sitting behind `auth`. · src: `resilience-auditor`, 2026-08-26 · added: 2026-08-26
- [ ] `BE-001` `P0` With `FRONTEND_URL` unset, the `'web'` fallback in `_returnTarget` emits `undefined/integrations?…`, which Express sends as a **relative** redirect against the Railway origin — a silent 404, no exception, no log line, reached whenever a signed OAuth state is unreadable or tampered. `#verify`
  - where: `backend/app/controllers/integrationsController.js:41` (`:48-56` is the live deep-link branch) · done when: the `'web'` fallback is a **constant** deep link with an error param — never derived from the request — falling back to a logged 400 when the state is unreadable · src: web-removal analysis, 2026-08-26 · added: 2026-08-26
- [ ] `BE-002` `P0` Web removal is a backend security redesign, not a deletion: `FRONTEND_URL` gates CORS, the CSRF origin and the socket.io origin, and the backend **refuses to boot in production without it**. `#verify` `#blocked` → `ARCH-002`
  - where: `backend/app/index.js:45-48,55` · `backend/app/middleware/csrf.js:26` · `backend/app/sockets/index.js:18` · done when: each of the three guards has a mobile-only origin policy that is designed, reviewed and tested — not removed · src: custodian surface-removal analysis, 2026-08-26 · added: 2026-08-26
- [ ] `BE-003` `P1` Garmin is the only provider whose OAuth callback has no app deep-link branch; its five call sites must move inside the web-removal work, since they edit the same function and would otherwise be left pointing at a dead `FRONTEND_URL`. `#verify`
  - where: `backend/app/controllers/integrationsController.js:496,509,512,542,550` · done when: Garmin sits exactly where YouTube is today — mechanism built, no mobile caller yet (`MB-005` is the caller) · src: sequencing ruled 2026-08-26 · added: 2026-08-26
- [ ] `BE-004` `P1` H13 — embedding v2 never activated in production; root cause was a stale Railway deploy running a pre-Wave-4 build, so `EMBEDDING_V2_WRITE=true` had no effect. `#verify`
  - where: runbook at `docs/runbooks/h13-v2-activation-deploy.md` · done when: the deployed commit is confirmed current *and* v2 writes are observed on live data · src: Wave-4 H13, still open at last check · added: 2026-08-26
- [ ] `BE-005` `P2` `TrackEmbedding.vector` is declared `required: true`, but mongoose's implicit `[]` default means a missing vector is never rejected. `#verify`
  - where: the `TrackEmbedding` model · done when: a vectorless save is rejected and a regression test pins it · src: `docs/plans/WAVE4_STATE.md` row W4-D55 (session 55) · added: 2026-08-26
- [ ] `BE-006` `P2` The kill-switch spelling tripwire guards only the DISABLE direction, so the ENABLE flags gating the W4-014 cutover can still drift. `#verify`
  - where: the kill-switch guard test · done when: a misspelled ENABLE flag fails a test the same way a misspelled DISABLE flag does · src: `docs/plans/WAVE4_STATE.md` row W4-D61 (session 64) · added: 2026-08-26
- [ ] `BE-007` `P3` The `/watch/*` route names now describe a surface that no longer exists — the lane is live and served by the phone's BLE reader, only the name is stale. `#verify`
  - where: `backend` watch routes; live clients are `mobile/.../health/bleHeartRate.ts`, `liveHrClient.ts`, `restFallback.ts` · done when: renamed down the deprecation ladder (this is a live-API change — **never** folded into a cleanup batch) · src: watch-removal analysis, 2026-08-26 · added: 2026-08-26

- [ ] `BE-012` `P1` **Withdrawing health consent must also erase the music-learning collections — decided 2026-08-26, and the notice copy is already written against it.** `PersonalWeights` and `RewardEvent` are *deliberately* excluded from withdrawal today (`services/privacy/wearableErasure.js:62-82`), so withdrawal deletes the body baseline but leaves the taste model standing. Daniel's call: withdrawal takes both.
  - **Ordering is load-bearing and runs the opposite way to the usual.** The canvas copy now states plainly that withdrawing "also erases what the app has learned about your taste — that doesn't come back". **That copy must not ship before this code lands**, or it becomes a false retention statement in the *other* direction: promising a deletion that does not happen, inside an Art. 9 notice. Land the erasure first, or hold the copy.
  - where: `backend/app/services/privacy/wearableErasure.js:62-82` · canvas already updated: `Consent.dc.html` (KEPT row, WITHDRAW row, §6, §7) + `YouVault.dc.html:57` · done when: `withdrawConsent` deletes both collections, a test asserts it, and the shipped `ConsentSheet`/`VaultConsentPanel` copy matches · src: closed-screen compliance audit HALT-1, Daniel's decision 2026-08-26 · added: 2026-08-26
- [ ] `BE-013` `P1` **`dailyReadiness` is a consumer with no producer — give it a real source.** It is read at `medicalProfileService.js:89` (`lowReadinessLowSteps`) and listed in `PROFILE_SCALAR_METRICS` at `:246`, but **nothing anywhere writes it**: `normalizeGarminSummaries` never emits it and a grep for `readiness` under `services/wearable/` returns zero. Decided 2026-08-26: it is not deleted and it does not stay sourceless.
  - **It cannot be Garmin.** Garmin's Health API supplies no readiness metric of any kind (verified against their live product page), and the Garmin lane is blocked upstream anyway → `DAN-009`. The comments calling it "Garmin Training Readiness" (`medicalProfileService.js:246`) and "Garmin/Whoop readiness score" (`models/MedicalProfile.js:65`) are both wrong and should go with the fix.
  - **The available source is our own Health Connect lane.** HRV, resting heart rate and sleep stages are exactly the conventional readiness inputs, we already read all three at consent v1, and `medicalProfileService` already computes the per-user medians a readiness score needs as its baseline. That makes it **Kokonada's derived metric with a stated method**, not a vendor's — which also answers Apple 1.4.1 ("clearly disclose data and methodology to support accuracy claims relating to health measurements").
  - **Route to `architect` first** — the score's definition is a modelling decision, not an implementation detail, and it must not reuse Garmin's feature name. Also reconcile the other session's in-flight `b0c7a82`/`72a5079`, which disclosed and gated "Garmin Training Readiness" without ever wiring an ingest path.
  - where: `backend/app/services/medicalProfileService.js:89,246` · `backend/app/models/MedicalProfile.js:65` · canvas already de-attributed: `Pulse.dc.html`, `Components.dc.html` now read "Not available · no connected source supplies it" · done when: a documented computation writes the metric, or the row is removed from every surface · src: Garmin compliance audit F4b, Daniel's decision 2026-08-26 · added: 2026-08-26

---

## Mobile

- [ ] `MB-007` `P2` iOS registers **no URL scheme**: there is no `CFBundleURLTypes` key anywhere in `mobile/KokonadaHealth/ios/KokonadaHealth/Info.plist`, so the `kokonada://integrations` deep link every OAuth callback returns to cannot open the app on iOS. Android declares it (`AndroidManifest.xml:72`). `#verify`
  - **Deliberately NOT done inside the web-removal branch.** Registering a scheme is new functionality, and features do not ride in removals — it is additive and safe, but it belongs to whoever makes iOS shippable, alongside the missing health/Bluetooth usage strings and the empty location string.
  - where: `mobile/KokonadaHealth/ios/KokonadaHealth/Info.plist` (keys are alphabetical; it would sit between `CFBundleSignature` and `CFBundleVersion`) · done when: an iOS build opens the app from a `kokonada://integrations?…` link · src: web-removal design pass, 2026-08-26 · added: 2026-08-26
- [ ] `MB-001` `P1` Email sign-in: the server path is complete and tested, the client has none. `auth.ts` exports only Google/Apple, so the "Continue with email" button on screen 03 has nothing to call. `#verify`
  - where: spec in `docs/plans/DEV_EMAIL_SIGNIN_PATH.md` · client `mobile/KokonadaHealth/src/auth/auth.ts`, `SignInScreen.tsx:29` · done when: `signUpWithEmail` / `signInWithEmail` funnel through the **same** `runSignIn` handler (provider → `setUser` → `onSignedIn`), with the four server error reasons mapped onto the existing inline alert · src: screen-03 design review, 2026-08-26 · added: 2026-08-26
- [ ] `MB-002` `P1` Now Playing draws a draggable scrubber the client cannot perform — `positionMs`/`durationMs` arrive from the Spotify remote but are used only for end-of-track detection, and no `seek` method exists anywhere. `#verify`
  - where: spec in `docs/plans/DEV_PLAYBACK_SEEK_AND_POSITION.md` · `playbackServices.ts:49`, `playbackOrchestrator.js:342`, `spotifyRemoteAdapter` · done when: position/duration are in `nowPlayingStore` (null-safe, not per-frame), `seek()` is on the interface, drag-then-release emits exactly one clamped seek, tests first · src: screen-08 design review, 2026-08-26 · added: 2026-08-26
  - ⚠ shipping the screen before this puts a dead scrubber in front of users. Interim: read-only progress bar, no thumb.
- [ ] `MB-003` `P2` Colour still resolves from two sources in the app: `AURORA_CORNERS` restates the four brand hues as raw channel triples instead of deriving them from `tokens.ts`, and `brandMark.geometry.ts` hardcodes six colours. Drift is caught by a test, not prevented. `#verify`
  - where: `mobile/KokonadaHealth/src/design/emotionAccent.ts:66-71`, `design/brandMark.geometry.ts:72-79` · done when: a palette change is **one** edit and `auroraGlow.test.ts` becomes impossible to fail — derivation resolves once at module load, never per frame, and `auroraGlow` stays total (no throw path, any input yields `#RRGGBB`) · src: `docs/plans/DEV_COLOUR_SINGLE_SOURCE.md` · added: 2026-08-26
- [ ] `MB-004` `P2` History rows are meant to be tinted by emotional state, but no title→quadrant mapping exists in the repo, and `metaLine()` does not compose the track count the board renders. `#verify` `#blocked` → `DAN-004`
  - where: `docs/plans/DEV_HISTORY_STATE_COLOUR.md` · `historyFormat.ts` · done when: a `moodKey`-keyed map exists (not title-keyed), `A moment` and `Active` get **no** colour, and `metaLine()` composes the count · src: screen-11 design review, 2026-08-26 · added: 2026-08-26
  - two rules that hold whatever is decided: the generic gets no colour; never infer valence from arousal alone.
- [ ] `MB-005` `P2` No mobile Garmin connect button — the backend lane will exist with no caller. This is a feature branch of its own, after the web removal, not part of it. `#verify` `#blocked` → `BE-003`
  - where: `ProfileScreen.tsx:113` shows the `returnTo=app` pattern Spotify already uses · done when: Garmin connects end-to-end from the app and returns via the deep link · src: sequencing ruled 2026-08-26 · added: 2026-08-26
- [ ] `MB-006` `P3` Mobile jest fails on a cold babel transform cache (9 failures at default 5000 ms; 62 after a `jest.setup.js` edit) and is fully green warm, or cold at `--testTimeout=20000`. Zero assertion failures — the first transform of a render-heavy tree does not fit the per-test budget. `#verify`
  - where: `mobile/KokonadaHealth`, full write-up in `docs/COLD_JEST_TIMEOUT_TASK.md` · done when: a cold `jest --ci` after `npm ci` is green without hiding a real slow test · src: found 2026-08-26 during the dependency cleanup, not caused by it · added: 2026-08-26

---

## Design & UI

- [ ] `UI-001` `P1` "Delete my account" and "Withdraw health consent" must be **real, reachable actions** on the You screen — a standing requirement across every canvas stage, explicitly not to be satisfied by trimming copy. `#verify`
  - where: You / Profile screen, `docs/SCREENS.md` · done when: both actions exist in the shipped app and do what they say, verified on device · src: `docs/STAGE_2_6_PROMPT.md`, `docs/STAGE_2_END_PROMPT.md` · added: 2026-08-26
- [ ] `UI-002` `P2` Confirm every reviewed screen carries an explicit `designer` **SHIP** verdict, or record why it does not — `CLAUDE.md` forbids merging a screen without one. `#verify`
  - where: the twelve reviews in `docs/review/01-splash.html` … `12-profile.html` · done when: one line per screen, SHIP or a named reason · src: `docs/STAGE_2_END_PROMPT.md` handover requirement · added: 2026-08-26

- [ ] `UI-003` `P1` **Open canvas items from the six-audit compliance pass (2026-08-26/27).** Most of that pass is closed on the boards; these are the ones still outstanding, each already written up in full. `#blocked` on nothing — they are ordinary design work.
  - **Cover art is required, and the boards paint a gradient.** Spotify Developer Policy II.5: no playback of Spotify Content without showing relevant cover art. Every mini-player artwork tile is a mood gradient. Convert to labelled cover-art slots, the same way the marks were, and pin "the gradient placeholder may never ship" into the per-screen DoD. Artwork radii 20px/10px must become 4px/8px. → `docs/plans/DEV_SPOTIFY_CANVAS_ASSETS.md`
  - **The YouTube icon slot needs the shipped half.** The Components board now states the rule and carries both slots; the app still has no provider discriminator on the attribution slot. → `docs/plans/HALT_YOUTUBE_ATTRIBUTION_AND_REVOCATION.md` YT-2
  - **Consent first layer.** Purpose and controller identity still sit inside collapsed sections, and the accordion closes one to open another while claiming "this is the whole notice". EDPB 05/2020 para 64 wants both visible before the consent action. Promote them; allow multiple sections open.
  - **The notice is Android-only.** `BiometricLog.source` includes `apple_health`; on iOS the copy misdescribes both the source and the flow. Needs platform-conditional copy. (The Google-brand naming half is done.)
  - **`You.dc.html` connections card** is marked INTENDED END-STATE now, but still draws a live Connect CTA for a provider `providers.ts` refuses. Either a truth/intended variant like `Connect.dc.html`, or mirror the registry.
  - **Store screenshots must not use "Holocene" / "Bon Iver"** — a real recording by a living artist paired with our own mood label is exactly what Spotify Developer Policy II.3 exists to prevent. Fictitious strings in every listing asset.
  - where: `scratchpad/canvas/*.dc.html`, `docs/SCREENS.md` DoD · done when: each bullet is closed or explicitly dropped with a reason · src: six `compliance-auditor` passes, 2026-08-26 · added: 2026-08-27
---

## Infra · CI · repo hygiene

- [ ] `OPS-001` `P0` The Wave-4 mission loop is stopped — `docs/plans/WAVE4_HALT` is present (2026-08-25 16:05) and no session has run since. `W4-015` (soak, closeout & package) is the **only remaining MUST** and has never seriously started; the 24 h `RUN_SOAK=1` run has never executed. `#verify`
  - where: `docs/plans/WAVE4_STATE.md` · restart with `.\scripts\run-mission.ps1` from the repo root (resumes cleanly from STATE.md) · done when: W4-015 is closed or the run is deliberately ended · **hard backstop:** `day4CutoffAt` = 2026-08-31 22:56 local, extend with `scripts/extend-cutoff.ps1` · added: 2026-08-26
- [ ] `OPS-002` `P1` The keystore ignore rule matches a **basename**, so the next path-flattened copy of the Android release signing passwords lands as an untracked file again. `#verify`
  - where: root `.gitignore` · done when: a path-flattened `keystore.properties` anywhere in the tree is ignored, with a test or check pinning it · src: `docs/plans/WAVE4_STATE.md` row W4-D83 (session 78, MUST) · added: 2026-08-26
- [ ] `OPS-003` `P2` `scripts/update-h13-diagnosis.ps1` still carries the old attribution wording and would reintroduce a forbidden credit string into `WAVE4_STATE.md` if re-run. `#verify`
  - where: `scripts/update-h13-diagnosis.ps1` · done when: the string is gone from the script (the guard test added by W4-D78 stays) · src: W4-D78 follow-up · added: 2026-08-26
- [ ] `OPS-004` `P2` Backend lint runs in no CI job — `wave4.lintGuard.test.js` covers only `app/`, leaving `sim/`, `tests/`, `jest/` and `scripts/` ungated (the W4-D08 `ReferenceError` class of bug). `#verify`
  - where: `.github/workflows/` · done when: a CI job lints the whole backend tree · src: custodian prevention gaps, 2026-08-26 · added: 2026-08-26
- [ ] `OPS-005` `P2` `core.hooksPath` is dead, and nothing detects it going dead again. `#verify`
  - where: git config + `scripts/check-setup.ps1` · done when: the hooks path works and `check-setup.ps1` fails loudly if it breaks · src: custodian prevention gaps, 2026-08-26 · added: 2026-08-26
- [ ] `OPS-006` `P2` A stale git worktree at `.worktree-surface-removal` (branch `remove/watch-connectiq`, commit `3b3a427`) is listed as **prunable**. `#verify`
  - where: `git worktree list` · done when: the branch's work is either landed or explicitly abandoned, and the worktree is pruned · added: 2026-08-26
- [ ] `OPS-007` `P3` ~20 untracked files sit in the tree (design handoff folder, a 940 KB zip at the repo root, several `docs/*_PROMPT.md`, `.claude/agents/custodian.md`, three `scripts/close-*.ps1`). Decide per file: commit, ignore, or delete. `#verify`
  - where: `git status --short` · done when: `git status` is clean or every remaining entry is deliberately ignored · added: 2026-08-26
  - note: the custodian agent never touches untracked files, so this one is human-decided by design.
- [ ] `OPS-008` `P2` ~~`mobile-ios-build` has never gone green.~~ **MODULAR-HEADERS HALF CLOSED ON EVIDENCE 2026-08-26 — iOS now builds.** Fixed by two targeted lines in `mobile/KokonadaHealth/ios/Podfile:35-36` (`pod 'GoogleUtilities', :modular_headers => true` / `pod 'RecaptchaInterop', :modular_headers => true`), deliberately targeted rather than a global `use_modular_headers!` which would change how all ~70 RN pods build. **Proof, checked per `OPS-010` rather than trusting the badge:** run `32992549921`, `event=push`, sha `0e19ad8` on `main` — `Run ruby/setup-ruby@v1 -> success`, `CocoaPods install -> success`, **`Xcode build (simulator, unsigned) -> success`**. Every step executed; nothing was filtered out. **Still open:** the second half of this row's own DoD — no `mobile/KokonadaHealth/Gemfile.lock` is committed, so CocoaPods re-resolves from scratch on every run and a future upstream release can break it again with no diff to point at. → `DAN-006`
  - where: `mobile/KokonadaHealth/ios/Podfile` (no `use_modular_headers!` anywhere in it) · job `mobile-ios-build` in `.github/workflows/ci.yml` · done when: one green `mobile-ios-build` run that reaches **and passes** `xcodebuild`, with `mobile/KokonadaHealth/Gemfile.lock` committed from that same session · src: CI runs `32974962408` and `32975663708` on PR #180, 2026-08-26 · added: 2026-08-26
  - **Not caused by the dependency cleanup, and this was checked rather than assumed.** `da9e532` never touched the Podfile; the Podfile is byte-identical between `origin/main` and the branch; `@react-native-google-signin/google-signin` is `^16.1.2` on both. **`pod install` fails the same way on `main` today.** The job is simply the first thing that has ever run `pod install` in this repo's CI, and it surfaced a pre-existing defect that jest, the Android job and a Metro bundle check are all structurally blind to.
  - two candidate remedies, both named by CocoaPods in the error itself: `use_modular_headers!` globally in the Podfile, or `:modular_headers => true` on `GoogleUtilities` and `RecaptchaInterop` specifically. Prefer the narrow one if it works — the global switch changes how every pod in the project is built.
  - **`Gemfile.lock` is generated in the SAME session, not before it.** It is absent today, so bundler re-resolves on every run and two iOS runs are not comparable. A lockfile produced from a guessed `bundle install` pins a state nobody proved; one produced in the session where `pod install` succeeds **and** the app compiles pins a state that is known good. Both layers lock together or neither does.
  - **do not make `mobile-ios-build` a required check until this row closes** — it cannot pass, and until the lockfile exists its results are not reproducible run to run.
  - what only a Mac can settle: whether the app still **compiles for iOS** with `lottie-react-native` and `react-native-vector-icons` removed. Both were autolinked with codegen, so their removal touched the iOS native surface, and nothing in CI or on a Windows box can answer that. It is the question this job exists for and it is still unanswered.

---

- [x] `OPS-013` `P0` ~~NO TEST IN THIS REPO EVER ASSEMBLES THE REAL APP — the fourth way a green check means nothing here.~~ **CLOSED ON EVIDENCE 2026-09-02 — closed on `main` by PR #184 and verified in this merge.** `backend/app/index.js` no longer auto-starts: it exports `{ app, start }`, so requiring it connects nothing. `backend/tests/app.boot.integration.test.js` (`describe('OPS-013 — the real app assembles')`) pins all three gaps the row named — requiring the app does not throw and starts no server, every registered route has a real handler, and `csrfOriginGuard` is mounted ahead of the API routers — with `app.chain.integration.test.js` alongside it. `backend/app/index.js` auto-starts (connects DB/Redis) and does not export the app, so every route test builds its own toy Express instead. The suite says so in its own words at `backend/tests/discovery.route.test.js:6-8`: *"app/index.js auto-starts … and does not export the app, so we mount the REAL discovery router … on a minimal express app."*
  - **What is therefore uncovered:** real middleware ORDER, route-registration validity, and the `FRONTEND_URL` boot assertion (`index.js:46-48`). **Proven, not theorised:** five `router.post(path, undefined)` handlers can be wired in and the entire suite stays green — `router.post()` throws at module load, and no test ever loads the module. `backend/tests/csrf.test.js:7-18` calls `csrfOriginGuard` on a hand-built object literal; it proves the function's branches and nothing about whether it is mounted, where, or ahead of what.
  - fix: refactor `index.js` to export `createApp()`; add `backend/tests/app.boot.integration.test.js` (assert `createApp()` does not throw + snapshot every registered method+path) and `backend/tests/app.chain.integration.test.js` (supertest against the REAL assembled app). Lands as part of `BE-009` — see that row.
  - The four ways a green check means nothing here: `OPS-010` (paths-filtered job passes without executing a step) · `OPS-011` (stacked PR gets no CI; its checks are for a merge that will never exist) · `OPS-014` (assertions loose enough to pass on the bug) · this row (the real app is never assembled). · src: `resilience-auditor`, 2026-08-26 · added: 2026-08-26
- [ ] `OPS-014` `P1` **The suite has been PASSING ON `BE-001`'s BUG — the third way a green check means nothing here.** `backend/tests/integrations.test.js` never sets `FRONTEND_URL`, so `frontendRedirect` (`integrationsController.js:41`) emits the literal string `undefined/integrations?music=spotify`. The assertion at `:239` is `expect.stringContaining('/integrations?music=spotify')` — which that string **satisfies** (verified in node: `'undefined/integrations?music=spotify'.includes('/integrations?music=spotify') === true`). A loose assertion is hiding a live P0 defect.
  - fix: tighten to **exact equality** against the constant deep link, in the same commit that fixes the redirect — a fixed redirect under a loose assertion is the same blindness wearing a different face. Same treatment for `backend/tests/integrationsController.test.js` at `:214, :227, :236, :246, :255, :293, :306, :315, :325` and the Garmin sites `:349, :363, :371, :380`.
  - done when: no redirect assertion in the backend suite uses `stringContaining` · src: adversarial review of the web-removal design, 2026-08-26 · added: 2026-08-26
- [ ] `OPS-011` `P0` **A PR into any branch other than `main` gets no CI whatsoever, so every stacked PR this project has merged was merged unverified.** `on.pull_request.branches: [main]` fires only for main-targeted PRs. Verified: PR #182 (`fix/ios-pods-modular-headers` → `feat/intelligence-wave`) has **zero** Actions runs.
  - **DO NOT CITE A STACKED PR'S GREEN CHECKS AS EVIDENCE.** PR #181 displays green only because it was *created* against `main` and retargeted to `feat/intelligence-wave` afterwards. A `pull_request` run tests the **merge of head into base**, and at run time that base was `main` — so #181's checks are evidence for `merge(3b3a427, main)`, **a tree that will never exist**. Merging #181 creates `merge(3b3a427, feat/intelligence-wave)`, which nothing has ever tested, and the wave branch has moved (`b821d3b` → `cc5a23c`) since that run. The head sha is unchanged, which is exactly why the checks look trustworthy and are not.
  - This is the second independent way a green check means nothing in this repo — see `OPS-010` for the first (paths-filtered native jobs reporting success without executing a step). Together they mean "CI is green" is not a statement about the code unless you have checked *which jobs ran* and *which merge they ran against*.
  - where: `.github/workflows/ci.yml:3-7` · done when: `OPS-012` lands and a stacked PR can be verified against its real base · src: observed while fixing #180's iOS red, 2026-08-26 · added: 2026-08-26
- [ ] `OPS-012` `P1` **The instrument fix for `OPS-011`: `ci.yml` must trigger for PRs targeting any branch, not only `main`.** Today `on.pull_request.branches: [main]` is the entire reason stacked work cannot be verified. Removing the `branches` filter (or widening it to include long-lived integration branches such as `feat/*`) makes a stacked PR run against its real base; adding `workflow_dispatch` additionally allows an on-demand run.
  - **NOT ACTIONABLE YET, deliberately:** `.github/workflows/ci.yml` currently carries the other session's uncommitted `+78` lines (the `mobile-ios-build` job and the design-system lint step). Editing it now would either collide with that work or absorb it. Do this once that work is committed and the file is clean.
  - where: `.github/workflows/ci.yml:3-7` · done when: a PR into a non-`main` branch produces a full check run against its actual base, proven by one real stacked PR · src: `OPS-011`, 2026-08-26 · added: 2026-08-26
- [ ] `OPS-009` `P2` The `mobile-ios-build` job pins no Ruby: there is **no `.ruby-version` or `.tool-versions` anywhere in the repo** (checked `da9e532`, `b821d3b` and `origin/main`) and the workflow does not pass a `ruby-version` input — so it depends entirely on whatever the floating `ruby/setup-ruby@v1` tag decides to do that day. It has been observed both ways within one afternoon: PR #181 run `32978085109` failed with `input ruby-version needs to be specified if no .ruby-version or .tool-versions file exists`, while PR #180 run `32979141443` passed the same step and failed later at CocoaPods. A gate that flips on upstream behaviour is not a gate.
  - where: `.github/workflows/ci.yml:211-216` · done when: the Ruby version is pinned — either a committed `mobile/KokonadaHealth/.ruby-version` or an explicit `ruby-version:` input — and two consecutive runs agree · src: observed during the watch-removal PR, 2026-08-26 · added: 2026-08-26
- [ ] `OPS-010` `P1` **A paths-filtered native job reports `success` without executing a single step, so its green is not evidence the native build works.** `mobile-ios-build` and `mobile-android-compile` are gated on `dorny/paths-filter`; a PR touching neither filter skips every step and the job still passes. Verified live: PR #181's iOS job re-ran green with `setup-node`, `setup-ruby`, `CocoaPods install` and `Xcode build` all `skipped`. Skipping is correct for cost — macOS runners bill at 10x — but the check is indistinguishable from a real pass in the PR UI.
  - This is one of **two** independent ways a green check means nothing here; `OPS-011` is the other. Before trusting any check on this repo, confirm **which jobs actually ran** (`gh run view <id> --json jobs`, read the per-step conclusions) and **which merge they ran against**.
  - where: `.github/workflows/ci.yml` (`dorny/paths-filter` steps in both native jobs) · done when: a skipped native job is distinguishable from a passing one at a glance — e.g. the job name or summary states it was filtered out · src: observed on PR #181, 2026-08-26 · added: 2026-08-26

---

## Architecture & surface removals

- [ ] `ARCH-001` `P1` Delete `watch/` — the abandoned Garmin Connect IQ app. Verified as a true leaf: no path reference from backend or mobile, nothing in CI, docker or any `package.json`. `#verify`
  - **THE TRAP:** the backend `/watch/*` lane is **live** and is the app's only real-time HR ingress — its client is the phone (`bleHeartRate.ts`, `liveHrClient.ts`, `restFallback.ts`, started on every app boot via `appBootstrap.ts:33`). Only the pairing-code flow is dead: `/watch/pair`, `/watch/pair/exchange`, `WatchPairingCard`, the pairing half of `watchPairingClient.ts`. One careless grep on "watch" or "garmin" takes out a live lane.
  - `watchPairingStore.ts:26` shows the dead card reaching into the live credential path — the revoke must be **re-homed, not dropped**.
  - preserve the provenance comment at `hrMeasurement.ts:11` (`HR_DELTA_BPM = 8`, `LIVENESS_MS = 45000` were mirrored from the sideloaded watch app). Keep no `garmin/` subfolder — that recreates the surface being deleted.
  - needs `architect` + an ADR (it amends the locked surface split in `ORCHESTRATOR_FABLE.md` `<standards>`) + `compliance-auditor`.
- [ ] `ARCH-002` `P1` Delete `frontend/` — the web app, no users, actively costing money. Nothing needs to be served to a browser. `#verify` `#blocked` → `BE-002`, `DAN-002`, `DAN-003`
  - deleting the web does **not** break Spotify or YouTube OAuth returns — the deep-link branch already ships and Spotify uses it end to end. Only `BE-001`'s `'web'` fallback and `BE-003`'s Garmin sites need work.
  - needs `architect` + an ADR + `compliance-auditor`; `BE-002` is the real cost of this task.
  - `/watch/pair` and `/watch/pair/exchange` are removed **here**, not with the watch app — their last consumer is `frontend/src/lib/api.ts:153` and it dies in this branch.
- [ ] `ARCH-003` `P1` Stand up a minimal landing page — the smallest thing that satisfies the store requirements. One static site, no framework, no build step, no design system, no dependency added anywhere; placeholder content, marked as such. **Do not salvage it out of `frontend/`** — a page carved from the app being deleted drags the build, the deps and the drift back in, and then the removal was theatre. `#blocked` → `DAN-007`
  - **minimum content, from the cited terms:** a real home page that is not a login page and not a redirect; a visible link from it to the privacy policy (a Google verification requirement); a **privacy policy** covering developer identity + contact, every data type collected, the sub-processor list (Groq, MongoDB Atlas, Railway), "never for advertising, never sold", the retention windows from `PRIVACY_DECLARATIONS.md:92-104`, how to revoke consent and request deletion, GDPR Art.9 basis and Art.15/17/20 rights; a **dedicated account-deletion page** at its own URL, prominently discoverable, usable by someone who has lost app access; and a **support page** with real contact details (Apple requires legal address, email, phone as local law demands).
  - Apple needs deletion **in-app** (already satisfied — `ProfileScreen.tsx:354` → `DELETE /api/auth/account`); Google needs it **as a URL**. Both are required; neither substitutes for the other.
  - the page's text must not drift from `docs/PRIVACY_DECLARATIONS.md`, `docs/store/play-health-connect-declaration.md` and the in-app consent copy — drift between them is itself a Health Connect rejection risk.
  - src: `compliance-auditor` 2026-08-26 · added: 2026-08-26

---

## Blocked — only Daniel can do these (Pause & Guide)

- [ ] `DAN-001` `P0` Restart the Wave-4 mission loop: `.\scripts\run-mission.ps1` from the repo root. A full shutdown kills it outright with nothing to auto-relaunch; it resumes cleanly from `WAVE4_STATE.md`, no risk of lost work. → `OPS-001`
  - added: 2026-08-26
- [ ] `DAN-002` `P1` **Console cleanup before the Vercel teardown — the numbered runbook is below. The ORDER is the whole point and it costs nothing.** → `ARCH-002`, `DAN-007`
  - **Severity re-rated P0 → P1 on evidence, 2026-08-26.** Two independent mitigations, neither of which removes the ordering requirement:
    - **No victim population.** Nothing is in production, the app is unpublished on both stores (`DAN-003`), and there are no real users. A dangling Return URL harms someone only when a real person completes a web Apple sign-in through it. Nobody does.
    - **The takeover mechanism is UNCONFIRMED, and the evidence leans against it.** `#inconclusive` — Vercel's generated-URL docs (`vercel.com/docs/deployments/generated-urls`) describe how `<project-name>-<scope-slug>.vercel.app` names are *formed* and say nothing about a name being released or reusable after project deletion. Multiple independent community reports say the opposite of "free pool": after deletion the name becomes **stuck/orphaned** and even the *original owner* cannot reclaim it, some receiving "already assigned to another team". No published security research shows a bare `*.vercel.app` name being claimed by a third party post-deletion; documented Vercel takeovers are **custom** domains with dangling CNAMEs, which is a different mechanism. Vercel publishes no official policy either way, so this is not refuted — only unsupported.
  - **What is NOT mitigated, and why the ordering stands anyway:** the exposure window opens at whichever comes first — the Vercel project being deleted, or the first real user. Doing the console steps first closes it before either can happen, at a cost of about five minutes. Do them in order and this is a chore; skip the order and it is an incident that needs Apple's audit log to unpick.
  - **Worst realistic case if the mechanism does turn out to be live:** an attacker who controls the host and holds a valid Apple `id_token` minted for our Services ID could present it to `authController.js:25-32`, which verifies only `aud == APPLE_CLIENT_ID`. That is unauthorised *account creation/access as themselves*, not takeover of a specific existing user — takeover additionally requires phishing a real user through the dangling host, and there are none.
  - **There is no Facebook console** — verified, no live Facebook registration exists anywhere in the repo.
  - src: `compliance-auditor` 2026-08-26 + independent verification of the Vercel subdomain question 2026-08-26 · added: 2026-08-26

  **RUNBOOK — do these in this order. Do not skip ahead to step 4.**

  **1 · Apple Developer — retire the web Return URL.** developer.apple.com → Account → Certificates, Identifiers & Profiles → **Identifiers** → switch the filter (top right) from *App IDs* to **Services IDs** → open the Kokonada web Services ID (its identifier looks like `com.kokonadahealth.web` or similar — it is *not* the iOS bundle id).
  - Click **Configure** next to *Sign in with Apple*. Under **Return URLs**, remove `https://kokonada-frontend.vercel.app/auth/apple/callback`. Save.
  - Web sign-in is not coming back, so **delete the Services ID entirely** once the Return URL is gone (Identifiers → select it → Remove).
  - **Then set backend `APPLE_CLIENT_ID` to the iOS bundle id `com.kokonadahealth`** (Railway → backend service → Variables). It can hold only one value, and the native flow's `aud` is the bundle id (`mobile/KokonadaHealth/src/auth/auth.ts:69-82` sends `platform:'ios'`). If it currently holds the web Services ID, native Sign in with Apple will fail verification the moment iOS is testable — and a broken Sign in with Apple is an App Store 4.8 rejection, not just a bug.
  - **Verify:** the Services ID no longer appears under Identifiers, and Railway shows `APPLE_CLIENT_ID=com.kokonadahealth`.

  **2 · Google Cloud — drop the dead JavaScript origins.** console.cloud.google.com → the Kokonada project → **APIs & Services → Credentials** → open the OAuth 2.0 Client ID used for login (the one starting `225621926146-…`).
  - Under **Authorized JavaScript origins**, remove `https://kokonada-frontend.vercel.app` and `http://localhost:5173`.
  - **Leave Authorized redirect URIs alone** — the `…up.railway.app/api/integrations/{youtube,spotify}/callback` entries are backend-hosted and still in use. Removing them breaks YouTube connect.
  - **Verify:** the origins list is empty or contains only origins you own; then confirm a Google login still works from the mobile app (it uses the native SDK, not a browser origin, so it should be unaffected — that is the point of checking).

  **3 · Railway — repoint `FRONTEND_URL`, never unset it.** railway.app → the backend service → **Variables**.
  - Set `FRONTEND_URL` to an origin you own. Until `kokonada.app` exists (`DAN-007`), any stable placeholder you control is fine — **but do not delete the variable**: `backend/app/index.js:46-48` throws `FRONTEND_URL must be set in production — refusing to start with unsafe CORS` and the service will not boot.
  - **Verify:** after the redeploy, `https://kokonada-backend-production.up.railway.app/health` returns 200, and the mobile app can still open a socket and generate a playlist. If `/health` does not return 200, put the old value back before doing anything else.

  **4 · Vercel — only now, delete the project.** vercel.com → the `kokonada` team → the `kokonada-frontend` project → **Settings → General →** scroll to the bottom → **Delete Project**.
  - Note there are **two** Vercel projects (`kokonada-frontend` and `kokonada`). Confirm which one serves `kokonada-frontend.vercel.app` before deleting anything — Settings → Domains on each.
  - **Verify:** `https://kokonada-frontend.vercel.app` no longer serves the app, and CI on the repo no longer shows a `Vercel – kokonada-frontend` check.
  - **If anything in steps 1-3 is not done, stop here and finish them first.**
- [x] `DAN-003` `P1` ~~Check whether any store listing or privacy-policy URL is hosted on the web app before deleting it.~~ **ANSWERED 2026-08-26 — no URL is declared anywhere, so deleting `frontend/` from the repo breaks nothing live.** No account-deletion URL, no privacy-policy URL, no support URL exists; there is no privacy policy document in the repo at all; no `.well-known`, no App Links, no AASA; `frontend/public/` is 7 icons and `vercel.json` has no `.well-known` rewrite. `PRIVACY_DECLARATIONS.md:137`'s "will be provided" is literal. **The HALT is on tearing down the Vercel deployment, not on the repo deletion — see `DAN-002`.** One console check remains: confirm in Play Console → Release → Releases overview that no track has ever had a release (the machine holds `keystore.properties`, so a hand-uploaded bundle cannot be ruled out from the repo). → `ARCH-002`
  - src: `compliance-auditor` 2026-08-26 · added: 2026-08-26
- [ ] `DAN-004` `P2` Decide the two unresolved history quadrants: `Active` (a raised heart rate carries no valence — joyful on a walk, intense in a panic) and `A moment` (the generic exists precisely because the state is unknown). The proposal is that **neither gets a colour**. This is a product decision with an owner, not a default. → `MB-004`
  - added: 2026-08-26
- [ ] `DAN-005` `P2` Before orphaning any watch data: check production Atlas for `watchToken` records or HR samples that originated from the Connect IQ path. That is `wearableErasure` and `compliance-auditor` territory, not a code deletion. → `ARCH-001`
  - added: 2026-08-26
- [ ] `DAN-006` `P2` ~~On a Mac, in one session: fix the iOS Podfile modular-headers problem, then…~~ **The Podfile half is DONE and did not need a Mac** — CI fixed and proved it (`OPS-008`, run `32992549921`, `Xcode build -> success`). What remains is only committing a `Gemfile.lock`. → `OPS-008`
  - **This row's premise is now falsified and that is worth more than the row.** It asserted *"no CI job can produce a lockfile whose state has actually been proven."* Run `32992549921` did exactly that: a macOS runner ran `bundle install` (via `setup-ruby` `bundler-cache: true`) → `pod install` → `xcodebuild`, all green. A lockfile generated by that run **is** proven — by the same build that consumed it. So this no longer needs a human with a Mac at all; it needs a CI step that uploads the generated `Gemfile.lock` (and `Podfile.lock`) as an artifact, which is then committed. Reclassify to `OPS-*` if you agree, rather than leaving it queued behind hardware nobody has.
  - done when: `mobile/KokonadaHealth/Gemfile.lock` is committed and a subsequent run consumes it rather than re-resolving · src: premise re-checked against run `32992549921`, 2026-08-26 · added: 2026-08-26
- [ ] `DAN-008` `P0` **ON-DEVICE CAPTURE: does React Native send an `Origin` header?** `BE-009`/`ARCH-002` want the CSRF guard inverted to deny-all-origins. If RN sets an `Origin` on POST, that inversion **403s the entire mobile app**. This cannot be settled from source — `mobile/.../net/apiClient.ts:35-37` sets only `Content-Type` and `Authorization`, but the header may be added by the platform networking stack below JS. Nothing that can 403 the whole app ships on "React Native probably does X". → `BE-009`
  - **This touches NO repo code.** It is a 20-line throwaway logger the phone talks to instead of the real backend.
  - **1 · Save this as `C:\Users\danie\Desktop\hdrlog.js`:**
    ```js
    const http = require('http');
    http.createServer((req, res) => {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        console.log('\n=== ' + req.method + ' ' + req.url);
        console.log('  origin : ' + (req.headers.origin  ?? '<ABSENT>'));
        console.log('  cookie : ' + (req.headers.cookie  ?? '<ABSENT>'));
        console.log('  auth   : ' + (req.headers.authorization ? 'Bearer present' : '<ABSENT>'));
        console.log('  referer: ' + (req.headers.referer ?? '<ABSENT>'));
        console.log('  ua     : ' + (req.headers['user-agent'] ?? '<ABSENT>'));
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end('{"ok":false,"error":"capture-stub"}');
      });
    }).listen(5000, () => console.log('listening on :5000 — waiting for the app'));
    ```
  - **2 · Run it:** `node C:\Users\danie\Desktop\hdrlog.js` — leave the window open.
  - **3 · Point the phone at it:** `adb reverse tcp:5000 tcp:5000` (adb lives at `C:\Users\danie\AppData\Local\Android\Sdk\platform-tools\adb.exe`). Then set `BACKEND_URL` to `http://localhost:5000` in `mobile/KokonadaHealth/src/health/config.ts` — **local edit only, revert it afterwards, do not commit.** Rebuild/reload the app.
  - **4 · Make the app POST.** Open the app and tap anything that hits the server — Sign in is ideal (`POST /api/auth/google`), and any generate/consent action also works. The request will fail; that is fine, we only need the headers.
  - **5 · WHAT TO LOOK FOR, and this is the whole answer:** in the terminal, the `origin :` line on any **POST**.
    - `origin : <ABSENT>` → **the inverted deny-all guard is SAFE to ship.** RN sends no Origin, so `csrf.js:24`'s fail-open keeps letting the app through while every real browser origin gets a 403.
    - `origin : <anything>` → **STOP. Do not ship the inverted guard** — it would 403 the app. Tell me the exact value and I will redesign around it (allowlist that value, or gate on the Bearer plane instead).
    - Also report the `cookie :` line — if it ever shows `kokonada_token=…`, the RN app is holding a cookie in a native jar, which changes `BE-009` step 1.
  - **6 · Clean up:** Ctrl-C the logger, `adb reverse --remove tcp:5000`, revert the `config.ts` edit (`git diff` it to be sure), rebuild.
  - src: `resilience-auditor` — flagged as the one thing source cannot settle, 2026-08-26 · added: 2026-08-26
- [ ] `DAN-007` `P1` **Buy `kokonada.app`** (or another apex domain you own and can add a DNS TXT record to), then verify it in Google Search Console as a **Domain property (DNS-level)** and add it as an Authorized Domain on the OAuth consent screen. Registering a domain is a portal action only Daniel can take. → `ARCH-003`
  - **why it must be an owned apex domain, not a subdomain of someone else's:** Google requires the OAuth homepage on a DNS-verified *Domain Property* — *"You must verify the Domain Property (DNS-level), rather than a 'URL prefix' or 'Site,' property."* Neither `kokonada-frontend.vercel.app` nor `kokonada-backend-production.up.railway.app` can ever satisfy that, because we do not control those DNS zones. So a landing page on the backend as a static route, or rebuilt on the same Vercel host, **does not work** — this is not a hosting preference, it is a hard constraint.
  - **what it blocks:** the landing page has no legal home until it exists (`ARCH-003`), and the landing page is what the Play **account-deletion URL** and **privacy-policy URL** will point at — both mandatory, both currently non-existent. Also gates: the in-app privacy link both stores require; the Health Connect rationale WebView, which today shows the user *Google's own developer docs* (`PermissionsRationaleActivity.kt:19`); and Google OAuth verification, without which `youtube.readonly` is capped at 100 total users.
  - also live independent of any store: Spotify Developer Terms §V.12 requires a privacy policy shown to end users, which is a condition of current API access, not a submission gate.
  - done when: the domain is registered, DNS-verified in Search Console, and added as an Authorized Domain · src: `compliance-auditor` 2026-08-26 · added: 2026-08-26
- [ ] `DAN-009` `P2` **Garmin is blocked upstream — no developer relationship, so nothing Garmin-shaped can start.** Garmin are not issuing developer accounts at present. **This is the root dependency for every Garmin item in this repo**, and none of them can be worked around from inside the codebase. `#blocked`
  - **The 30-day clock cannot start.** Developer Program Agreement §6.6 requires *"no less than thirty (30) calendar days' prior written notice"* with mockups, sent to `connect-support@developer.garmin.com`, before shipping any new UI that displays Garmin data. **There is no one to serve notice to and no agreement to be bound by.** So the redesign is not late — it is not yet eligible to start the clock. When an account exists, serve the notice *after* the brand/attribution fixes land, so the clock runs on the design that actually ships.
  - **What else is gated behind the same door:** the deregistration-on-delete fix cannot be tested against a real endpoint (`DEV_GARMIN_DEREGISTRATION_ON_DELETE.md`); the Consumer Brand Style Guide sits behind Garmin's Confidentiality Agreement, so the trademark-marking rule stays UNVERIFIED; whether the Health API exposes a device model is behind the portal login; and §5.3's Garmin-benefit ToS clauses cannot be drafted against an agreement we have not signed.
  - **Write the code anyway where it is a latent landmine, not a feature.** The deregistration fix is worth landing unbuilt-against: after `User.deleteOne` the credentials are gone and the registration can *never* be cleaned up, so the bug is unrecoverable-by-construction rather than merely dormant.
  - src: Garmin compliance audit G1 + Daniel 2026-08-27 · added: 2026-08-27

  **What the product currently promises about Garmin that it cannot deliver today** — same class as the Now Playing ambient field: a surface describing behaviour the product cannot produce.

  | # | Promise | Where | Status |
  |---|---|---|---|
  | 1 | A live Garmin data source — `source: 'garmin'` renders a **"Garmin · live"** SOURCE tile | `Pulse.dc.html:150`, `Main.dc.html:52` | Canvas only. No ingest path exists; the lane is pre-production and gated. **Honest fix:** the `garmin` prop value is an end-state variant and should be labelled as one, exactly like `Connect.dc.html`'s `intended` chip. |
  | 2 | SpO₂ / respiration / Body Battery™ *"if you connect a Garmin account"* | `Consent.dc.html` ALSO COVERED, `ConsentSheet.tsx:27-29` | **Honest already** — it says "None is read today; we ask again first", and `garminConsentVersionGate` *enforces* the dormancy. This is the pattern the rest should copy: disclose-before-read, gated in code, stated in copy. Keep it. |
  | 3 | A pairable **Connect IQ watch app** — pairing-code UI, `whr_` device tokens, a live-HR card | `WatchPairingCard.tsx`, `watchPairingStore.ts`, `watchPairingClient.ts`, `liveHrClient.ts`, `watch/` | Live on `main` **and** in this branch. Already being retired by the other session's in-flight PR #181 (`8683c93` — replaces it with `LiveHeartRateCard` and adds `surfaceBoundaryGuard.test.js`), **not merged anywhere yet.** Nothing to do here beyond letting it land; note that a Connect IQ store listing would need its own agreement and its own audit regardless. |
  | 4 | *"Open Garmin Connect → Settings → Health Connect"* as the no-data remedy | `ProfileScreen.tsx:162` | **Deliverable today and correct** — this is the Health Connect lane, not the Garmin API lane, and it uses the required full app name. Not blocked. |
  | 5 | Body Battery™ / Daily readiness as named Garmin metrics on Pulse | `pulsePresentation.ts:32,107`, `Pulse.dc.html`, `Components.dc.html` | Body Battery is genuinely Garmin's and genuinely unreachable today (honest-empty, correct). **Daily readiness was never Garmin's at all** → `BE-013`. |
  | 6 | Any generic BLE strap silently stamped `wearableProvider = 'garmin'` | `liveHrClient.ts:14` | A false provenance claim waiting to become visible. Harmless while nothing renders it; **must be fixed before** any Garmin attribution ships → `HALT_GARMIN_BRAND_AND_ATTRIBUTION.md` G5. |

---

<details>
<summary><strong>Archive — completed and dropped</strong> (newest first)</summary>

<br>

Format: `` `ID` `done|dropped` YYYY-MM-DD — one line, and the commit or the reason. ``

_(nothing archived yet)_

</details>
