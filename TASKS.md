# TASKS — Kokonada

The single running list of everything still open in this repo. **If it is not written here, it does not exist.**
A task that lives only in a conversation is already lost — that is what this file exists to stop.

**Last updated:** 2026-08-26
**Next free IDs:** `BE-008` · `MB-007` · `UI-003` · `OPS-009` · `ARCH-004` · `DAN-008`

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

---

## Mobile

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
- [ ] `OPS-008` `P1` `mobile-ios-build` has never gone green. `pod install` dies on the Swift pod `AppCheckCore` (pulled in by the Google Sign-In pod chain) depending on `GoogleUtilities` and `RecaptchaInterop`, which do not define modules — so it cannot be integrated as a static library. `#blocked` → `DAN-006`
  - where: `mobile/KokonadaHealth/ios/Podfile` (no `use_modular_headers!` anywhere in it) · job `mobile-ios-build` in `.github/workflows/ci.yml` · done when: one green `mobile-ios-build` run that reaches **and passes** `xcodebuild`, with `mobile/KokonadaHealth/Gemfile.lock` committed from that same session · src: CI runs `32974962408` and `32975663708` on PR #180, 2026-08-26 · added: 2026-08-26
  - **Not caused by the dependency cleanup, and this was checked rather than assumed.** `da9e532` never touched the Podfile; the Podfile is byte-identical between `origin/main` and the branch; `@react-native-google-signin/google-signin` is `^16.1.2` on both. **`pod install` fails the same way on `main` today.** The job is simply the first thing that has ever run `pod install` in this repo's CI, and it surfaced a pre-existing defect that jest, the Android job and a Metro bundle check are all structurally blind to.
  - two candidate remedies, both named by CocoaPods in the error itself: `use_modular_headers!` globally in the Podfile, or `:modular_headers => true` on `GoogleUtilities` and `RecaptchaInterop` specifically. Prefer the narrow one if it works — the global switch changes how every pod in the project is built.
  - **`Gemfile.lock` is generated in the SAME session, not before it.** It is absent today, so bundler re-resolves on every run and two iOS runs are not comparable. A lockfile produced from a guessed `bundle install` pins a state nobody proved; one produced in the session where `pod install` succeeds **and** the app compiles pins a state that is known good. Both layers lock together or neither does.
  - **do not make `mobile-ios-build` a required check until this row closes** — it cannot pass, and until the lockfile exists its results are not reproducible run to run.
  - what only a Mac can settle: whether the app still **compiles for iOS** with `lottie-react-native` and `react-native-vector-icons` removed. Both were autolinked with codegen, so their removal touched the iOS native surface, and nothing in CI or on a Windows box can answer that. It is the question this job exists for and it is still unanswered.

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
- [ ] `DAN-002` `P0` **Order matters — do all of these BEFORE the Vercel project is deleted.** Deleting the deployment while these allow-lists still name it is an account-takeover surface, not untidiness. (1) Apple Developer → Identifiers → **Services IDs** → remove the Return URL `https://kokonada-frontend.vercel.app/auth/apple/callback`; if web login is gone for good, delete the Services ID and set backend `APPLE_CLIENT_ID` to the **iOS bundle id** `com.kokonadahealth` — the backend verifies with a single audience (`authController.js:25-32`), so a dangling Return URL means Apple keeps POSTing `id_token`s to a host you no longer control. (2) Google Cloud → Credentials → remove the Authorized **JavaScript origin** `https://kokonada-frontend.vercel.app` (and `http://localhost:5173`); leave the Railway **redirect URIs** alone, they are still in use. (3) Railway → repoint `FRONTEND_URL` to an owned origin — do **not** unset it, `backend/app/index.js:46-48` hard-throws in production. (4) Only then delete the Vercel project. **There is no Facebook console** — verified, no live Facebook registration exists anywhere in the repo. → `ARCH-002`, `DAN-007`
  - src: `compliance-auditor` 2026-08-26 · added: 2026-08-26
- [x] `DAN-003` `P1` ~~Check whether any store listing or privacy-policy URL is hosted on the web app before deleting it.~~ **ANSWERED 2026-08-26 — no URL is declared anywhere, so deleting `frontend/` from the repo breaks nothing live.** No account-deletion URL, no privacy-policy URL, no support URL exists; there is no privacy policy document in the repo at all; no `.well-known`, no App Links, no AASA; `frontend/public/` is 7 icons and `vercel.json` has no `.well-known` rewrite. `PRIVACY_DECLARATIONS.md:137`'s "will be provided" is literal. **The HALT is on tearing down the Vercel deployment, not on the repo deletion — see `DAN-002`.** One console check remains: confirm in Play Console → Release → Releases overview that no track has ever had a release (the machine holds `keystore.properties`, so a hand-uploaded bundle cannot be ruled out from the repo). → `ARCH-002`
  - src: `compliance-auditor` 2026-08-26 · added: 2026-08-26
- [ ] `DAN-004` `P2` Decide the two unresolved history quadrants: `Active` (a raised heart rate carries no valence — joyful on a walk, intense in a panic) and `A moment` (the generic exists precisely because the state is unknown). The proposal is that **neither gets a colour**. This is a product decision with an owner, not a default. → `MB-004`
  - added: 2026-08-26
- [ ] `DAN-005` `P2` Before orphaning any watch data: check production Atlas for `watchToken` records or HR samples that originated from the Connect IQ path. That is `wearableErasure` and `compliance-auditor` territory, not a code deletion. → `ARCH-001`
  - added: 2026-08-26
- [ ] `DAN-006` `P1` On a Mac, in **one** session: fix the iOS Podfile modular-headers problem, then `bundle install` → `pod install` → `xcodebuild`, and commit the `Gemfile.lock` that session produced. No agent has a Mac, and no CI job can produce a lockfile whose state has actually been proven. → `OPS-008`
  - added: 2026-08-26
- [ ] `DAN-007` `P1` **Buy `kokonada.app`** (or another apex domain you own and can add a DNS TXT record to), then verify it in Google Search Console as a **Domain property (DNS-level)** and add it as an Authorized Domain on the OAuth consent screen. Registering a domain is a portal action only Daniel can take. → `ARCH-003`
  - **why it must be an owned apex domain, not a subdomain of someone else's:** Google requires the OAuth homepage on a DNS-verified *Domain Property* — *"You must verify the Domain Property (DNS-level), rather than a 'URL prefix' or 'Site,' property."* Neither `kokonada-frontend.vercel.app` nor `kokonada-backend-production.up.railway.app` can ever satisfy that, because we do not control those DNS zones. So a landing page on the backend as a static route, or rebuilt on the same Vercel host, **does not work** — this is not a hosting preference, it is a hard constraint.
  - **what it blocks:** the landing page has no legal home until it exists (`ARCH-003`), and the landing page is what the Play **account-deletion URL** and **privacy-policy URL** will point at — both mandatory, both currently non-existent. Also gates: the in-app privacy link both stores require; the Health Connect rationale WebView, which today shows the user *Google's own developer docs* (`PermissionsRationaleActivity.kt:19`); and Google OAuth verification, without which `youtube.readonly` is capped at 100 total users.
  - also live independent of any store: Spotify Developer Terms §V.12 requires a privacy policy shown to end users, which is a condition of current API access, not a submission gate.
  - done when: the domain is registered, DNS-verified in Search Console, and added as an Authorized Domain · src: `compliance-auditor` 2026-08-26 · added: 2026-08-26

---

<details>
<summary><strong>Archive — completed and dropped</strong> (newest first)</summary>

<br>

Format: `` `ID` `done|dropped` YYYY-MM-DD — one line, and the commit or the reason. ``

_(nothing archived yet)_

</details>
