# KOKONADA — Screen Catalog (page-by-page spec)

> The single per-screen reference the `developer` agent builds each screen against. Design language: **Calm / Premium Wellness × Bioluminescent** (`docs/UI_UX_OVERHAUL_SPEC.md`); intent: `docs/VISION.md`. Every screen honors the sacred contracts (≤3-tap emotion payload, three-lane state, `screenToCircumplex`) and the honest, regulator-not-mirror ethic.
>
> **Compliance:** every screen and its brand assets (Spotify/YouTube marks + attribution, Sign in with Apple, store screenshots) must pass the `compliance-auditor` before ship.
>
> Each entry: **Purpose · Layout · Components · States · Interactions · Data · Design notes.**

---

## ROLLOUT STATUS & BUILD QUEUE (Wave 2.8.2 — ✅ COMPLETE, updated 2026-07-18)

**The Wave 2.8.2 screen rollout is fully shipped** — every screen + the brand identity is on `main`, each through the full architect → designer → TDD → resilience → compliance gate. Mobile suite ~1,220 tests, all green. Tab bar, §4, §5, the Aurora Seed bootsplash, and the General Sans wordmark are device-verified on the Galaxy S22+.

| Queue | Screen | Status |
| :--- | :--- | :--- |
| ✅ | Auth (§3) | SHIPPED — #108, recovered to main via #120 |
| ✅ | Now Playing (§7) | SHIPPED — #121 redesign · #122 art/receipts payload · #124 SDK cover |
| ✅ | FTUE / Onboarding (§2) + Splash (§1) | SHIPPED — #141 |
| ✅ | Connect Services (§4) | SHIPPED — #160 (device-verified light + dark) |
| ✅ | Generate — HERO (§5) + Genesis overlay (§6) | SHIPPED — #162 (device-verified dark; reactive aura restored, regulator-ethic breath, Genesis exhale) |
| ✅ | History (§9) | SHIPPED — #163 (quiet archive; friendly titles, silhouette source cue, skeleton/empty states) |
| ✅ | Profile / Privacy Vault (§10) | SHIPPED — #165 (absorbed `WatchTokenCard` as a **pairing-code** flow — `whr_` never rendered, L-15 preserved; consent-withdrawal echo; GDPR delete) |
| ✅ | Health-Data Consent — Art.9 gate (§11) | SHIPPED — #154 (backend + `ConsentSheet`); reused unchanged by §4 (#160) and §10's withdrawal echo (#165) |
| ✅ | §0 shared system-state components (E1) | SHIPPED — #161 (Skeleton · EmptyState · OfflineBanner · useCalmPulse) |
| ✅ | Tab bar + system-state shell (§0 E2) | SHIPPED — #166 (Skia glyphs — structurally tofu-proof · emotion-tinted active tab · live offline banner) |
| ✅ | Pulse (§8) | SHIPPED — #164 (un-**HELD**: issue #90 was already closed via #99/#110; honest-empty gauges, Garmin-only source truth, regulating aura) |
| ✅ | Brand identity | SHIPPED — #167 (Aurora Seed icon · wordmark · bootsplash · Splash breath-seam · motion signature) + #168 (General Sans font bundle) — device-verified |

**Remaining follow-ons (not screens; tracked separately):** runtime-agent backend deterministic-fallback playlist (§5 Fork 4B); pin PR #159's Garmin-lane consent version-bump as a test; store submission (playback-surface Spotify/YouTube attribution, Groq DPA/ZDR, Play/Apple declaration forms, iOS icon build on a Mac, store-icon export/upload).

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
- **Interactions:** tap Connect → OAuth (Pause & Guide portal where needed); expand "why"; choose mood-only. The wearable/health path routes through **§ 11 (Art.9 consent)** before the OS Health Connect sheet.
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
- **Interactions:** connect/reconnect (Pause & Guide portals); Sync → native HC permission sheet if missing (routes through **§ 11** first if consent isn't current); logout (full teardown incl. Spotify pause + wipe); delete (server-first cascade + local wipe); "Withdraw health-data consent" → two-step confirm (neutral tone, not the delete-account danger styling) → `POST /api/consent/withdraw`.
- **Data:** integration status, `AuthSession`, `/api/auth/account` (delete), Health-Connect permissions, `/api/consent/status` + `/api/consent/withdraw`.
- **Design notes:** the "Vault" tone — impenetrable, premium, trust-first; consistent rows (fixes the current YouTube inconsistency); destructive actions clearly separated. The withdrawal panel echoes **§ 11**'s section headings and body rhythm so the two read as one continuous trust surface.

## 11. Health-Data Consent — the Art.9 gate (just-in-time interstitial)
- **Purpose:** capture explicit, informed, versioned **GDPR Art.9** consent for processing special-category health/biometric data — the lawful basis an OS/OAuth permission grant alone does **not** provide (2026-07-16 compliance audit, finding H-9). Shown **only** the instant a user chooses to connect health/a wearable, **immediately before** the OS Health Connect sheet — never a login wall. Mood-only users never see it. The sanctuary explaining itself honestly, not a permission trap. Reached from **§ 4** and **§ 10**; not a tab. Build queue position **5.5**, alongside § 10 (shared trust surface + withdrawal echo).
- **Layout (vertical):** a serious, legible sheet on a **static** surface (`surface.base`) — no hero, no reactive aura. Top: a single calm brand mark + one title + one plain-language subtitle. Middle: a **real, scrollable** consent document (native scroll view, selectable live text — never an image) of short, headed sections. Bottom: a **persistent, non-scrolling action bar** carrying two equal-weight choices (Decline · Agree), always visible and tappable regardless of scroll position. A quiet, static shield/lock glyph in `accent.glow` is the only ornament.
- **Components:** `ConsentSheet` (route/modal), `ConsentDocument` (scrollable, section-landmarked text), `ConsentSectionCard` (`surface.raised`, `radius.lg`, `elevation.e1`, hairline dividers), a visible scroll affordance, a fixed `ConsentActionBar` with equal-measure `AcceptButton` + `DeclineButton`.
- **States:** `checking` (`GET /api/consent/status`) · short-circuit (already current → skip straight to the OS sheet) · `consent_required` (first time) · `consent_stale` (granted at an older version → re-confirm) · `submitting_grant` · `submit_error`/`offline` (blocks — never opens the OS sheet) · `granted_ack` (server-confirmed → hands off to the OS sheet) · `declined` (returns to caller, no penalty, no re-prompt loop).
- **Interactions:** open on health/wearable intent → check status → present or short-circuit. **Agree** → `POST /api/consent` → await the 201 canonical echo → only then call `requestHealthPermissions()`. **Decline** → dismiss, mood-only path intact. Re-reads status on focus/resume so a withdrawal made elsewhere (§ 10) is reflected immediately.
- **Data:** `GET /api/consent/status?purpose=health_biometric_processing` → `{granted, currentVersion, staleVersion}`; `POST /api/consent` `{purpose:'health_biometric_processing', dataCategories:[…]}`; `POST /api/consent/withdraw` `{purpose}` (§ 10). `dataCategories` canonical identifiers: `['heart_rate','hrv','sleep','resting_heart_rate','historical_access_182d']` — scope-minimized to the real Health Connect request set (permissions.ts, PR #152 T3: SpO2/respiratory/background dropped, zero readers); must mirror the on-screen data list exactly. `CURRENT_CONSENT_VERSION = 1` is the cross-package staleness contract.
- **Design notes:** calm/premium here means **legible and serious**, the inverse of Genesis (§ 6) — the bio-aura **recedes entirely** and the CTA does **not** re-tint to the current emotion (the one app-wide exception: a legal choice is never emotionally nudged). Decline is exactly as easy as Accept — equal size/position/contrast, no pre-checked state, no scroll-gating, no confirmshaming; its border must clear WCAG 2.2 1.4.11 (3:1) using `content.tertiary`/`accent.glow`, never the decorative `hairline` token. A failed/unconfirmed grant blocks the OS sheet — the one place "the music never stops" yields to legal integrity. Recommend pre-checking Health Connect device availability before showing this screen, so no one consents to something their device can't deliver.

---

## Cross-screen design invariants
- One design-token system; **zero magic numbers**; light + dark.
- `emotionAccent` (valence×arousal) + the bio-aura tint the whole app to the user's state.
- Motion is **regulating** (calms under stress), frame-rate-independent, reduced-motion-aware.
- 60fps floor on device; UI-thread animation; dispose graphics on unmount.
- WCAG 2.2 AA; screen-reader labels + a text/list alternative to the wheel; color never the only signal.
- Raw biometrics stay zero-knowledge; nothing sensitive rendered from unencrypted sources.
- **Brand/store compliance:** third-party marks, attribution, Sign in with Apple, and store screenshots pass the `compliance-auditor` before ship.
