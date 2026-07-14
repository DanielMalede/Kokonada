# KOKONADA — Screen Catalog (page-by-page spec)

> The single per-screen reference the `developer` agent builds each screen against. Design language: **Calm / Premium Wellness × Bioluminescent** (`docs/UI_UX_OVERHAUL_SPEC.md`); intent: `docs/VISION.md`. Every screen honors the sacred contracts (≤3-tap emotion payload, three-lane state, `screenToCircumplex`) and the honest, regulator-not-mirror ethic.
>
> **Compliance:** every screen and its brand assets (Spotify/YouTube marks + attribution, Sign in with Apple, store screenshots) must pass the `compliance-auditor` before ship.
>
> Each entry: **Purpose · Layout · Components · States · Interactions · Data · Design notes.**

---

## ROLLOUT STATUS & BUILD QUEUE (Wave 2.8.2 — updated 2026-07-12)

One screen at a time, in this order; each screen = its own branch + PR off fresh `main`. On merge, the queue auto-advances to the next row — no re-prompt.

| Queue | Screen | Status |
| :--- | :--- | :--- |
| ✅ | Auth (§3) | SHIPPED — #108, recovered to main via #120 |
| ✅ | Now Playing (§7) | SHIPPED — #121 redesign · #122 art/receipts payload · #124 SDK cover |
| **1 — NEXT** | FTUE / Onboarding (§2) + Splash (§1) | ready to start |
| 2 | Connect Services (§4) | queued |
| 3 | Generate — HERO (§5) + Genesis overlay (§6) | queued |
| 4 | History (§9) | queued |
| 5 | Profile / Privacy Vault (§10) | queued — must absorb the web `WatchTokenCard` (mint/copy/revoke `whr_` token UI); this unblocks the web sunset (Wave 2.5) |
| 6 | Tab bar + system states (§0) | queued |
| 7 | Pulse (§8) | **HELD** on issue #90 (orphaned HC medical-profile ingestion) — build last, once #90 closes |
| 8 | Brand identity | icon · wordmark · bootsplash · motion signature — final PR |

**Per-screen Definition of Done (spec §9):** tokens only (zero magic numbers) · light + dark · reduced-motion path · WCAG 2.2 AA · 60fps floor on device · on-device **before/after screenshots** in the PR · **`designer` SHIP verdict** (design-review pass on the built screen vs the design language) · resilience audit posted · `compliance-auditor` pass for any third-party mark/OAuth/permission surface · sacred contracts untouched (≤3-tap emotion payload, three-lane state, `screenToCircumplex`, socket/DTO contracts, pinned S/D-series tests).

**The queue stops ONLY at:** PR merge approval (never self-merge) · a `designer` REVISE verdict · a compliance HALT · the HELD Pulse screen · any cloud/device Pause & Guide.

---

## 0. Global shell

- **Tab bar** (`RootNavigator`): 5 tabs — Generate · Now Playing · Pulse · History · Profile. Calm iconography (real vector icons, not tofu), active tab tinted with the current `emotionAccent`. Minimal labels.
- **System states (every screen inherits):**
  - *Loading* → skeletons, never spinners (except the Genesis moment).
  - *Empty* → ghosted premium empty state with one guiding action, never a dead end.
  - *Error / offline* → soft OfflineBanner + cached content; the music never stops.
  - *Reduced-motion / low-power* → animations simplify or stop; layout unchanged.

---

## 1. Splash / Auth-check
- **Purpose:** brand breath while the app restores the session; route to Onboarding, Login, or Generate.
- **Layout:** centered wordmark on a slow-breathing gradient; nothing else.
- **Components:** brand mark, motion-signature "breath".
- **States:** checking session (default) → routed. No error UI (falls through to Login on failure).
- **Interactions:** none (auto-advance).
- **Data:** `AuthSession` token presence.
- **Design notes:** ≤1.5s; the first taste of calm; sets the palette to the resting/neutral aura.

## 2. Onboarding / Welcome (FTUE)
- **Purpose:** teach the body+mind→music idea as a sensory journey, almost no text, before asking for OAuth/health.
- **Layout:** 3-panel horizontal carousel; each panel is one idea (feel it → your body is heard → your soundtrack), full-bleed motion, one line of copy, progress dots, "Continue" / "Skip".
- **Components:** carousel, animated hero per panel (aura/wheel teasers), pager dots, CTA.
- **States:** per-panel; last panel CTA → Auth.
- **Interactions:** swipe between panels (interruptible), tap Continue/Skip.
- **Data:** none.
- **Design notes:** cinematic, wordless where possible; this is the value-prop moment *before* any permission ask.

## 3. Login / Auth
- **Purpose:** authenticate via Google, Apple, or email — the minimum gate.
- **Layout:** wordmark, provider buttons stacked (Apple to exact HIG when iOS), email fallback, legal microcopy.
- **Components:** Sign in with Apple (HIG-exact), Google button, email flow, error inline.
- **States:** idle · submitting · error (bad creds / network) · success → Connect Services (first run) or Generate.
- **Interactions:** tap provider → native sheet; email → validated form.
- **Data:** `/api/auth/*`; installs `AuthSession` (single-flight refresh).
- **Design notes:** trust-forward, uncluttered; providers get equal weight; no dark patterns.

## 4. Connect Services / Integrations setup
- **Purpose:** connect music (Spotify/YouTube) and, optionally, a wearable — with a clear "**Try with mood only**" escape so the wearable is never a hard gate.
- **Layout:** two grouped cards (Music · Wearable/Health), each with connect state + "why we ask" accordion; prominent "Try with mood only" secondary path.
- **Components:** integration rows (consistent status + action), "why" accordion, mood-only CTA.
- **States:** none connected · music connected · wearable connected · skipped (mood-only).
- **Interactions:** tap Connect → OAuth (Pause & Guide portal where needed); expand "why"; choose mood-only.
- **Data:** integration/connection status; OAuth scopes (least-privilege).
- **Design notes:** the Privacy-Vault tone starts here — explain *why* before requesting health access; never force the double gate.

## 5. Generate — THE HERO
- **Purpose:** capture conscious intent (emotion + activity + words) and fire generation; the heart of the app.
- **Layout (vertical):** Bio-aura (ambient, top) → **Radial emotion wheel** (hero) → Activity chips → Prompt box → morphing CTA.
- **Components:** `BioAura` (reactive to live HR/state), `RadialWheel` (Skia, ≤3 taps), **tap-rewind / clear control**, `ActivityChips` (single-select, 8 presets), `PromptBox` (500-char, sanitized), CTA morphing Generate ↔ "Listen to your heart" ↔ disabled.
- **States:** empty (no taps) · 1–3 taps placed (undo/clear available) · live-mode available (HR present) · submitting → Genesis overlay · error (soft, retryable).
- **Interactions:**
  - Wheel gesture (120 Hz worklet, single commit on gesture-end); up to 3 taps.
  - **Cancel / rewind taps:** the user can **undo the last tap** (removes the most recent dot — a rewind of the tap history) and **clear all taps** to start over. A visible affordance (undo control; tapping a placed dot removes it). Lets the user correct or fully cancel their selection before generating — the payload stays ≤3 and the contract is unchanged.
  - Activity chip select / clear (re-tap clears).
  - Prompt entry (wheel shrinks to a mini-ring on keyboard focus so committed taps stay visible).
  - CTA submit → socket `emotion_update` / `request_playlist`.
- **Data:** cold `emotionSlice` (`taps[]` ≤3 ring buffer, `activity`, `textPrompt`) with `undoTap` / `clearTaps` reducers (aliasing-safe, never grows past 3); warm `liveHr` / connection; socket contract unchanged.
- **Design notes:** the palette *is* the emotion (aura + `emotionAccent` follow the taps); the undo/clear is quiet and forgiving — never a jarring "delete"; maximum restraint everywhere else so the wheel and aura are the only stars.

## 6. AI Generating overlay — the "Genesis moment"
- **Purpose:** the magic beat between intent and music; make analysis feel like being read.
- **Layout:** full-screen takeover; a Skia "neural-analysis" fluid/particle field breathing on a sine wave; one calm status line.
- **Components:** Genesis Skia canvas, status label.
- **States:** analyzing (default) · resolving → soft transition to result · building/warming (first-run library) with honest copy · failure → deterministic fallback, never a hard toast.
- **Interactions:** none; auto-resolves. Music fades in as it dissolves.
- **Data:** socket `profile_progress` / `playlist_building` / `playlist_ready`.
- **Design notes:** **never a spinner**; reduced-motion → elegant static/skeleton; the moment the whole app protects — zero friction, zero error toasts.

## 7. Now Playing
- **Purpose:** full-screen playback of the generated set, synced to the real player.
- **Layout:** large album art (subtle gyro-parallax) → track/artist → transport (prev/play/skip) → progress → mix-receipt / "why this" affordance.
- **Components:** `NowPlayingScreen`, transport via `PlaybackOrchestrator`, art parallax, mix receipt.
- **States:** playing · paused · buffering · foreign-track (user changed Spotify externally → reconcile) · disconnected (soft) · end-of-queue.
- **Interactions:** play/pause/skip/prev; scrub; open full playlist. UI reconciles to the remote's real URI (source of truth).
- **Data:** player state (remote-as-truth), `nowPlayingStore`, queue cursor.
- **Design notes:** art and motion carry it; controls recede until touched; must mirror Spotify-side changes (no phantom desync).

## 8. Pulse — the body dashboard (state vector)
- **Purpose:** show how the app reads the body right now — the whole-body picture, honestly.
- **Layout:** live tiles (HR, source, socket) → advanced gauges (HRV · resting HR · sleep · body battery · readiness) → a friendly **State** headline (e.g. "Resting / Calm").
- **Components:** `PulseScreen`, gauges, live tiles, state headline.
- **States:** live HR only (BLE) · full vitals (wearable synced) · **honest empty** per metric ("Not shared by your watch" for Garmin-absent HRV/body-battery/readiness) · syncing · no-data (guides to Connect).
- **Interactions:** pull-to-refresh / re-sync; tap a gauge for detail (future).
- **Data:** `/api/pulse/state`, `MedicalProfile.stateVector`; movement/stress/recovery included, not just vitals.
- **Design notes:** never bare dashes — always intent or an honest note; calm gauge fills; where "the body is a first-class input" is made visible.

## 9. History
- **Purpose:** the user's past sessions — revisit a moment and its soundtrack.
- **Layout:** reverse-chronological list; each row = friendly **title** ("Peak Energy"), subtext ("Manual · Run" / "Live · running"), time, tap to replay.
- **Components:** `HistoryScreen`, session rows.
- **States:** populated · empty ("your moments will live here") · loading (skeleton rows) · offline (cached).
- **Interactions:** tap row → replay/detail; scroll (virtualized).
- **Data:** `GET /api/sessions` (title + source DTO); Manual vs Live inferred from `moodKey`.
- **Design notes:** material-like rows; friendly names, never raw `bio:resting:resting`; calm density.

## 10. Profile / Integrations — the "Privacy Vault"
- **Purpose:** identity, integrations, health-data control, logout, and GDPR delete — wrapped in a premium, trust-establishing aesthetic.
- **Layout:** header (name/avatar/email) → Integrations (Spotify · YouTube Music · Wearable · Health data — consistent status + action) → Health-data "Vault" panel (sync, permissions, what we read/why) → Log out → Delete account.
- **Components:** `ProfileScreen`, integration rows, Health-Connect sync + native permission trigger, GDPR delete flow.
- **States:** each integration connected/disconnected/needs-reconnect; health granted/denied (→ native permission sheet, never OS-settings); delete confirm.
- **Interactions:** connect/reconnect (Pause & Guide portals); Sync → native HC permission sheet if missing; logout (full teardown incl. Spotify pause + wipe); delete (server-first cascade + local wipe).
- **Data:** integration status, `AuthSession`, `/api/auth/account` (delete), Health-Connect permissions.
- **Design notes:** the "Vault" tone — impenetrable, premium, trust-first; consistent rows (fixes the current YouTube inconsistency); destructive actions clearly separated.

---

## Cross-screen design invariants
- One design-token system; **zero magic numbers**; light + dark.
- `emotionAccent` (valence×arousal) + the bio-aura tint the whole app to the user's state.
- Motion is **regulating** (calms under stress), frame-rate-independent, reduced-motion-aware.
- 60fps floor on device; UI-thread animation; dispose graphics on unmount.
- WCAG 2.2 AA; screen-reader labels + a text/list alternative to the wheel; color never the only signal.
- Raw biometrics stay zero-knowledge; nothing sensitive rendered from unencrypted sources.
- **Brand/store compliance:** third-party marks, attribution, Sign in with Apple, and store screenshots pass the `compliance-auditor` before ship.
