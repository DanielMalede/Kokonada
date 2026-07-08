# Squad 6 — On-Device Verification Checklist (physical Galaxy)

> **Purpose:** the strict manual QA pass master §0 names as the immediate next action. Run on
> the **physical Galaxy** (emulators can't exercise Spotify App Remote or real biometrics).
> Scope has grown past the original A11 list to include **Spotify App Remote playback (#77)**
> and **Live-mode band-drive + shadow-buffer serve (#76/#77)** — the newly shipped surfaces
> that are unit-green but not device-verified.
>
> **How to run (Pause & Guide):** work top to bottom. Mark each row **PASS / FAIL / BLOCKED**
> and paste the note. Report results back; any FAIL becomes a filed defect task (template at
> the bottom). Do not skip a precondition — a wrong build invalidates the playback rows.

## 0. Preconditions (do these first — a miss here fakes later failures)

| # | Setup | Confirm |
| :-- | :--- | :--- |
| P1 | **Full native rebuild**, not a Metro reload: `cd mobile/KokonadaHealth/android && ./gradlew :app:installDebug`. The Spotify App Remote is a native module — a JS reload will NOT pick it up. | app installs fresh |
| P2 | **Spotify app** installed, logged in with a **Premium** account, and opened to **foreground** at least once before the playback rows. | Spotify foreground OK |
| P3 | Backend prod (Railway) reachable; you can log into Kokonada. | login screen loads |
| P4 | For the **Live-mode** rows: a biometric HR source is pushing — Garmin watch app sending HR, or a Health Connect source. | HR flowing |
| P5 | `adb logcat` attached with tags `SpotifyRemote` and `koko` visible (for evidence on the playback/socket rows). | logcat streaming |

## 1. Auth & bootstrap

| # | Steps | Expected | Result | Note |
| :-- | :--- | :--- | :-- | :-- |
| 1.1 | Cold-launch the app, log in. | Reaches the home/Generate screen; no crash. | ☐ | |
| 1.2 | Watch logcat `koko` on launch. | `socket opening (connecting)…` → `socket CONNECTED` (the prod socket-never-connected bug from QA4 must stay fixed). | ☐ | |
| 1.3 | Kill + relaunch (warm start). | Session persists (COLD lane rehydrated); no re-login; no persisted biometrics leaked. | ☐ | |

## 2. Generate — Manual mode (the default)

| # | Steps | Expected | Result | Note |
| :-- | :--- | :--- | :-- | :-- |
| 2.1 | Confirm the **Live/Manual switch** (above the Activity chips, label `live-mode-toggle`) reads **Manual**. | Manual is the default; Generate CTA is the active driver. | ☐ | |
| 2.2 | Pick a mood on the Skia wheel and/or an Activity chip + optional emotion text; press Generate. | The **Neural-Analysis "Genesis" loader** appears (translucent pearl, reticulated neural net, heats cyan→coral→red with engagement). | ☐ | |
| 2.3 | Wait for completion. | A **50-track** playlist arrives (real Spotify URIs); no empty playlist; no "10-track fallback collapse". | ☐ | |
| 2.4 | Regenerate with a different mood/activity. | Materially different set (variance engine); no immediate repeats. | ☐ | |

## 3. Spotify App Remote playback (#77)

| # | Steps | Expected | Result | Note |
| :-- | :--- | :--- | :-- | :-- |
| 3.1 | With Spotify foreground (P2), press play on a track. | Audio starts within ~a few seconds. logcat `SpotifyRemote`: connect succeeds on the **main thread** (no "Result was not delivered on time"; 20s watchdog does NOT fire). | ☐ | |
| 3.2 | Pause / resume / skip next / skip previous. | Now-Playing reflects each transition; player status observable (not stuck). | ☐ | |
| 3.3 | Background the app during playback, return. | Playback continues; status re-syncs. | ☐ | |
| 3.4 | Play through to end of a track. | Auto-advances to the next queued track. | ☐ | |

## 4. Live mode — band recalibration + shadow buffer (#76/#77)

| # | Steps | Expected | Result | Note |
| :-- | :--- | :--- | :-- | :-- |
| 4.1 | Flip the switch to **Live**. Re-launch to confirm it persisted. | Live persists (liveModeStore, COLD lane); Generate CTA yields to a **"live-tuned"** state (manual + live can't both drive the queue). | ☐ | |
| 4.2 | With HR flowing (P4), induce a **confirmed band change** (e.g. raise HR by moving). | On the band transition the app serves music **without a manual Generate** — a biometric auto-push. | ☐ | |
| 4.3 | If a **warm buffer** exists for the new band. | Plays **instantly** (shadow-buffer serve; no full loader). | ☐ | |
| 4.4 | If the band is **cold** (no buffer). | Shows the loader captioned **"assembling your live biometric soundscape"**, does one live gen, then plays. | ☐ | |
| 4.5 | Confirm serve accounting. | A serve is recorded **only when a buffer is actually played** (§3.5), not on precompile. (Verify via History count / not double-counting.) | ☐ | |

## 5. Intelligence surfaces (A11 — the original unverified set)

| # | Steps | Expected | Result | Note |
| :-- | :--- | :--- | :-- | :-- |
| 5.1 | Open **History**. | Server feed (`GET /api/sessions`) lists recent sessions; no client-fabricated rows. | ☐ | |
| 5.2 | Open **Pulse**. | State-vector gauges render (`GET /api/pulse/state`); no NaN/∞, no Skia aura crash. | ☐ | |

## 6. Profile — logout & GDPR delete

| # | Steps | Expected | Result | Note |
| :-- | :--- | :--- | :-- | :-- |
| 6.1 | Profile → **Log out**. | Returns to login; re-launch requires re-login (**zero bytes after logout** — legacy Keychain JWT purged too). | ☐ | |
| 6.2 | Log back in → Profile → **Delete account** (first press). | Opens a **confirmation** panel; **no server call yet**. | ☐ | |
| 6.3 | Press the explicit **confirm**. | Server-first GDPR delete runs; account gone; erasure is complete (incl. `UnclassifiedTrack` cascade from #78). | ☐ | |

## 7. Regression sweep (quick)

| # | Check | Expected | Result | Note |
| :-- | :--- | :--- | :-- | :-- |
| 7.1 | No crash anywhere from NaN aura phase / 0/0 translate. | Stable. | ☐ | |
| 7.2 | Screen churn (navigate in/out repeatedly). | No runaway re-renders / leaks (store unsubscribe parity). | ☐ | |

---

## Defect capture template (one per FAIL)
```
Title:        <screen> — <one-line symptom>
Row:          <e.g. 3.1>
Device/build: Galaxy <model>, installDebug <git sha>
Repro:        1) … 2) … 3) …
Expected:     …
Actual:       …
logcat:       <SpotifyRemote / koko lines>
Severity:     blocker | major | minor
```

**Result summary:** ___ / 24 PASS · ___ FAIL · ___ BLOCKED → (each FAIL → a Wave-1 defect task before A12).

---

## RE-PASS R1 (2026-07-08) — Wave 1 close-out

First pass filed D-1…D-6; fixes shipped in #93–#102. This re-pass is the **closing evidence
for Wave 1**. Preconditions P1–P5 unchanged — P1 (full `installDebug` rebuild off current
`main`) is mandatory: #100/#101 changed native auth flow and icon bundling.

**Already device-verified (2026-07-08, skip unless regressed):** row 3.1 audio starts
(App Remote authorize fix, #100/#101) and tab-bar icons render (vector-icon bundling, #101).

Run the full §1–§7 sweep, plus these fix-verification rows:

| # | Verifies | Steps | Expected | Result | Note |
| :-- | :--- | :--- | :--- | :-- | :-- |
| R1.1 | D-2 (#93) | Start playback, then Profile → Log out. | Music **pauses before** disconnect — no orphaned audio after logout. | ☐ | |
| R1.2 | D-3 (#96) | Open History after a Manual gen and (if available) a Live serve. | **Friendly titles** (no raw `moodKey`), each row shows **Manual/Live** source, chosen activity chip persisted. | ☐ | |
| R1.3 | D-4b (#95) | Open Pulse with watch connected; also with a metric the watch doesn't share. | Friendly status labels; unshared metrics say **"Not shared by your watch"** (honest empty state), never bare dashes/errors. Body Battery/Readiness presented as Garmin-only. | ☐ | |
| R1.4 | D-4 ingestion ([#90](https://github.com/DanielMalede/Kokonada/issues/90)) | With Health Connect granted, wait one sync cycle, re-open Pulse. | Advanced biometrics populate from HC medical-profile ingestion (#99) — no longer blank. | ☐ | |
| R1.5 | D-6 (#98/#99, [#92](https://github.com/DanielMalede/Kokonada/issues/92)) | Fresh signup (or post-GDPR-delete account) → first Generate immediately. | `playlist_building` loader with bounded auto-retry — **no** "Still setting up your library" hard error; playlist eventually arrives. | ☐ | |
| R1.6 | #100 Reconnect | Integrations → **Reconnect Spotify**. | Re-grant flow completes and returns to the app; badge stays Connected throughout. | ☐ | |
| R1.7 | #102 first-gen bound | First generation right after a backend deploy (or Spotify 429 storm). | Library fallback serves within the bound — no minutes-long hang, no hard timeout error. | ☐ | |

**Close-out rule:** all §1–§7 rows + R1.1–R1.7 PASS → Wave 1 CLOSED; close issues
[#90](https://github.com/DanielMalede/Kokonada/issues/90) and
[#92](https://github.com/DanielMalede/Kokonada/issues/92) with the evidence. Any FAIL → file
via the defect template; it blocks Wave 2.8's Vision-Frame rollout only if it touches the
Generate/playback path.

**R1 result:** ___ PASS · ___ FAIL · ___ BLOCKED
