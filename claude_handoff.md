# Kokonada — Session Handoff (2026-07-19)

Everything below is committed/merged unless noted. Safe to `/clear` and resume from this.
This is a **cross-session** handoff — multiple parallel sessions update it. Always `git fetch origin main`
and re-verify PR/merge state before trusting a status here; this repo moves fast (5+ PRs/day is normal).
NOTE: on 2026-07-19 the main checkout was seen on a parallel branch `feat/aurum-amethyst-palette` — do
**not** assume the checked-out branch reflects your session; verify against `origin/main` directly.

## 🏁 MILESTONE — the standalone app runs 24/7 and plays music (verified on-device 2026-07-19)
Kokonada is now an installable, standalone Android app you can run all day without Metro, and it plays real music end to end.
- **Standalone release build** (JS+Hermes bundle embedded → no Metro): `cd mobile/KokonadaHealth/android && JAVA_HOME="C:\Program Files\Android\Android Studio\jbr" ./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a` → `app/build/outputs/apk/release/app-release.apk` (~50 MB, arm64-v8a). Install: `adb install -r <apk>` (same release key ⇒ keeps login/data). Backup copy staged at `C:\Users\danie\Videos\Kokonada-standalone.apk` (sideloadable).
- **Release keystore (PERMANENT — BACK IT UP):** `android/app/kokonada-release.keystore` (gitignored), alias `kokonada`, creds in `android/keystore.properties` (gitignored). **Release SHA-1: `79:DC:AF:76:84:47:45:55:80:C2:72:93:38:52:36:A0:A8:40:55:AC`** — registered in Google Cloud Console (Android OAuth client, project `225621926146`) + Spotify dashboard. Losing the keystore/password ⇒ can never update the installed app.
- **Verified flow (2026-07-19):** Google login → Spotify connected → taste profile built from Spotify history (~90 s first connect) → Generate → 50 real `spotify:track:` tracks → Spotify App Remote PLAYED (player position advanced in logcat).

## ✅ Shipped & merged (main) — Wave 2.8.2 rollout + standalone follow-ups
Screen rollout (all 7 screens + brand):
- **#160** Connect Services (§4) — provider registry `{enabled|deferred|halted}`, mood-only path, wearable→Art.9 consent handoff.
- **#161** §0 shared system-state components (Skeleton, EmptyState, OfflineBanner, useCalmPulse).
- **#162** Generate HERO (§5) + Genesis overlay (§6) — reactive emotion wheel, aura, tap-rewind, magic-moment.
- **#163** History (§9) — quiet-archive redesign. · **#164** Pulse (§8) — honest body dashboard (Garmin-only source truth).
- **#165** Profile / Privacy Vault (§10) — integration rows, watch pairing-code, consent-withdrawal echo, GDPR delete.
- **#166** §0 tab bar chrome + system-state shell — Skia glyphs (tofu-proof), emotion-tinted active tab, offline banner.
- **#167** Brand identity — Aurora Seed icon, wordmark 600, adaptive/monochrome icons, bootsplash, Splash breath-seam. · **#168** General Sans Semibold bundled + display token flipped.
- **#169** docs: Wave 2.8.2 rollout marked complete (SCREENS.md).

Standalone + follow-ups (this session):
- **#170** Garmin special-category **consent-version gate** — prose "MUST bump" comment → enforced test; `GARMIN_CONSENT_MIN_VERSION=2`, `CURRENT_CONSENT_VERSION` stays 1 (Garmin S2S lane dormant). Resilience 8.5/10.
- **#171** **Deterministic emotion-fallback playlist** (§5 Fork 4B) — when generation fails/empties, returns a library-only, emotion-honoring, never-empty playlist; closes G-1/G-2/G-4; fixes an anti-repetition parity bug. Zero mobile change. Resilience 9.2/10.
- **#172** Closed a pre-existing **GDPR Art.9 leak** — `/health/batch` could persist spO2/respiratory at consent v1; dropped them from the HC-lane map + added the same v2 gate (shared `wearable/specialCategoryMetrics.js`). "Special categories never persisted below v2" is now **system-wide TRUE**. Resilience 9.4/10.
- **#173** Fallback playlist **hardening** — serve-ledger records the *served* set (true canonicalKey), a T1≠T0 coverage test, port throw-safety.
- **#174** **Android release signing** — `buildTypes.release` uses the real keystore when `keystore.properties` exists, else debug (CI-safe fallback).
- **#175** **Beta-flagged Spotify connect** — `SPOTIFY_BETA_CONNECT` in `mobile/KokonadaHealth/src/experience/connect/betaFlags.ts`, committed **false** (tripwire test fails CI if ever true on main). Compliance SHIP. See "Providers" below.

(Earlier the same day, before this session: #154 WS-5 consent gate, #155 Spotify resolver-URI recontamination, #156 Garmin disconnect erasure, #157 youtube-discovery short-circuit, #158 serve side-effects, #159 consent-gate gap closure.)

## 🎛️ Providers (Connect Services §4) — EXACT current facts (verified in code 2026-07-19)
- **Playback is Spotify-only.** `resolvePlaybackProvider(user)` returns literally `'spotify' | null` (`backend/app/utils/providerSelect.js:52`). There is **no YouTube player anywhere in the app** (`backend/app/sockets/biometricHandler.js:145` — "Playback is Spotify-only … NO client — web or mobile — has a YouTube player").
- **Spotify.** Two separate systems: (i) **App Remote playback** (the sink) — always on, works whenever the Spotify app is installed + the owner is Premium; (ii) **OAuth account-connect** (the source, builds the taste profile) — the surface that was halted.
  - Public onboarding shows Spotify **"halted"/Unavailable** (`connect/providers.ts:30`) because Spotify's 2026 Dev-Mode caps solo-dev apps at **5 authorized users** (Extended Quota needs a business + 250k MAU). **Do NOT flip `providers.ts` to `enabled` publicly** — it breaches the cap the moment a 6th installer connects.
  - **Beta path (Daniel's ≤5-tester build):** flip `SPOTIFY_BETA_CONNECT=true` locally (uncommitted) → a "Connect" button appears in Profile/Settings (reuses the existing OAuth handler). Compliance **SHIP** (the ≤5 cap is enforced *server-side by Spotify*; owner must hold Premium; before ANY beta wider than 5, add the Spotify logo + "Powered by Spotify"). **This is live + verified playing music for Daniel.**
- **YouTube is DATA-ONLY — not a playback sink.** Registry `deferred`/"Not yet available". If connected, it only builds the taste profile (source) + export; it produces **no audio**. Blocked on the Google OAuth sensitive-scope verification.
  - **YouTube playback player = APPROVED for a FUTURE session, NOT built.** The Source/Sink plan calls for an **attested-IFrame, Premium-only** YouTube player (YouTube ToS requires the official IFrame player showing the video; Premium can't be verified via API → self-attested). This does **not** exist in code today — it's new dev + a YouTube-terms compliance pass when picked up. (Reconciles the earlier "YouTube needs Premium + a running video" statement — that described this *plan*, not current capability.)

## ⏳ In progress / next up (Daniel-paced, not blocking)
- **YouTube OAuth sensitive-scope verification** — Artifact/checklist delivered (`youtube.readonly` is *sensitive*, not *restricted* ⇒ no CASA audit). Trap: move the app to "Production" before starting the review clock or sensitive-scope tokens expire every 7 days. Enriches the profile; does NOT add audio.
- **YouTube attested-IFrame Premium PLAYER** — new dev (see Providers). Daniel wants this in a future session.
- **Wave-3 store submission** — DEFERRED per Daniel (playback attribution, Groq DPA/ZDR, Play/Apple forms, store-icon export/upload, iOS icon build on a Mac).
- **Declined (deliberate):** GDPR audit LOW nits — centralize the special-category gate inside `persistMetrics` / graceful-degrade on a consent-DB read error. Daniel chose to keep strict fail-closed Art.9 + avoid store↔consent coupling; the invariant is already system-wide TRUE without them.

## Environment / gotchas
- `hermesEnabled=true`, `newArchEnabled=true`. `config.ts` `BACKEND_URL` targets prod Railway (`kokonada-backend-production.up.railway.app`) ⇒ standalone app works over WiFi/data, no `adb reverse`/Metro.
- **Spotify connect dashboard setup (new tester):** Spotify Dashboard → **User Management** (add tester's Spotify account, ≤5 total incl. owner) + **Redirect URIs** (`https://kokonada-backend-production.up.railway.app/api/integrations/spotify/callback` — must EXACTLY match Railway `SPOTIFY_REDIRECT_URI`, the #1 failure cause — and `kokonadahealth://spotify-callback`) + **Android** package `com.kokonadahealth` + the release SHA-1. Owner account must be Premium.
- **`gh pr merge` classifier hard-blocks agent-initiated merges** regardless of verbal permission — every PR needs Daniel's manual merge click (intermittently allows).
- **Flaky device USB** — the S22+ (`RFCT40SGAWM`) drops intermittently; re-check `adb devices` before an on-device step. Sideload alternative: copy `Kokonada-standalone.apk` to the phone, tap to install (same signature ⇒ keeps data/login).
- **git worktree on Windows:** `git worktree remove --force` unregisters the worktree but can leave the physical dir (with `node_modules`) on disk; delete leftovers with `cmd rmdir /s /q` (junction-safe — does NOT follow a `node_modules` junction into the main checkout). NEVER `rm -rf` / `Remove-Item -Recurse` a worktree dir that has a node_modules JUNCTION.
- **A worktree cut from `origin/main` has a placeholder `mobile/KokonadaHealth/src/health/config.ts`** — copy the real one from the main checkout + `git update-index --skip-worktree` before an on-device build.
- **Other parallel sessions are active in this repo** — always fetch/verify against `origin/main`; don't trust the checked-out branch.
- **MongoDB MCP is the real app DB** (named `test` — Mongoose default); read-only `count`/`find` are safe.
- Commit style: **short single-line, no body/trailers, no AI/Claude/Anthropic attribution** (CLAUDE.md standing order).
