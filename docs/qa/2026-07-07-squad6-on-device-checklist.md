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
| P1 | **Full native rebuild**, not a Metro reload: `cd mobile/KokonadaHealth/android && ./gradlew :app:installDebug`. The Spotify App Remote is a native module — a JS reload will NOT pick it up. | app installs fresh |PASS
| P2 | **Spotify app** installed, logged in with a **Premium** account, and opened to **foreground** at least once before the playback rows. | Spotify foreground OK |PASS
| P3 | Backend prod (Railway) reachable; you can log into Kokonada. | login screen loads |PASS
| P4 | For the **Live-mode** rows: a biometric HR source is pushing — Garmin watch app sending HR, or a Health Connect source. | HR flowing |PASS
| P5 | `adb logcat` attached with tags `SpotifyRemote` and `koko` visible (for evidence on the playback/socket rows). | logcat streaming |PASS

## 1. Auth & bootstrap

| # | Steps | Expected | Result | Note |
| :-- | :--- | :--- | :-- | :-- |
| 1.1 | Cold-launch the app, log in. | Reaches the home/Generate screen; no crash. | ☐ | |PASS
| 1.2 | Watch logcat `koko` on launch. | `socket opening (connecting)…` → `socket CONNECTED` (the prod socket-never-connected bug from QA4 must stay fixed). | ☐ | |PASS
| 1.3 | Kill + relaunch (warm start). | Session persists (COLD lane rehydrated); no re-login; no persisted biometrics leaked. | ☐ | |PASS

## 2. Generate — Manual mode (the default)

| # | Steps | Expected | Result | Note |
| :-- | :--- | :--- | :-- | :-- |
| 2.1 | Confirm the **Live/Manual switch** (above the Activity chips, label `live-mode-toggle`) reads **Manual**. | Manual is the default; Generate CTA is the active driver. | ☐ | |PASS
| 2.2 | Pick a mood on the Skia wheel and/or an Activity chip + optional emotion text; press Generate. | The **Neural-Analysis "Genesis" loader** appears (translucent pearl, reticulated neural net, heats cyan→coral→red with engagement). | ☐ | |PASS
| 2.3 | Wait for completion. | A **50-track** playlist arrives (real Spotify URIs); no empty playlist; no "10-track fallback collapse". | ☐ | |PASS
| 2.4 | Regenerate with a different mood/activity. | Materially different set (variance engine); no immediate repeats. | ☐ | |PASS

## 3. Spotify App Remote playback (#77)

| # | Steps | Expected | Result | Note |
| :-- | :--- | :--- | :-- | :-- |
| 3.1 | With Spotify foreground (P2), press play on a track. | Audio starts within ~a few seconds. logcat `SpotifyRemote`: connect succeeds on the **main thread** (no "Result was not delivered on time"; 20s watchdog does NOT fire). | ☐ | |PASS
| 3.2 | Pause / resume / skip next / skip previous. | Now-Playing reflects each transition; player status observable (not stuck). | ☐ | |PASS
| 3.3 | Background the app during playback, return. | Playback continues; status re-syncs. | ☐ | |PASS
| 3.4 | Play through to end of a track. | Auto-advances to the next queued track. | ☐ | | FAIL

## 4. Live mode — band recalibration + shadow buffer (#76/#77)

| # | Steps | Expected | Result | Note |
| :-- | :--- | :--- | :-- | :-- |
| 4.1 | Flip the switch to **Live**. Re-launch to confirm it persisted. | Live persists (liveModeStore, COLD lane); Generate CTA yields to a **"live-tuned"** state (manual + live can't both drive the queue). | ☐ | |PASS
| 4.2 | With HR flowing (P4), induce a **confirmed band change** (e.g. raise HR by moving). | On the band transition the app serves music **without a manual Generate** — a biometric auto-push. | ☐ | |FAIL
| 4.3 | If a **warm buffer** exists for the new band. | Plays **instantly** (shadow-buffer serve; no full loader). | ☐ | |FAIL
| 4.4 | If the band is **cold** (no buffer). | Shows the loader captioned **"assembling your live biometric soundscape"**, does one live gen, then plays. | ☐ | |FAIL
| 4.5 | Confirm serve accounting. | A serve is recorded **only when a buffer is actually played** (§3.5), not on precompile. (Verify via History count / not double-counting.) | ☐ | | PASS

## 5. Intelligence surfaces (A11 — the original unverified set)

| # | Steps | Expected | Result | Note |
| :-- | :--- | :--- | :-- | :-- |
| 5.1 | Open **History**. | Server feed (`GET /api/sessions`) lists recent sessions; no client-fabricated rows. | ☐ | |PASS
| 5.2 | Open **Pulse**. | State-vector gauges render (`GET /api/pulse/state`); no NaN/∞, no Skia aura crash. | ☐ | |FAIL - SHOWING ONLY HEARTBEAT

## 6. Profile — logout & GDPR delete

| # | Steps | Expected | Result | Note |
| :-- | :--- | :--- | :-- | :-- |
| 6.1 | Profile → **Log out**. | Returns to login; re-launch requires re-login (**zero bytes after logout** — legacy Keychain JWT purged too). | ☐ | |PASS - BUT OPENNING IN LIVE MODE AND NOT IN MANUAL 
| 6.2 | Log back in → Profile → **Delete account** (first press). | Opens a **confirmation** panel; **no server call yet**. | ☐ | |PASS
| 6.3 | Press the explicit **confirm**. | Server-first GDPR delete runs; account gone; erasure is complete (incl. `UnclassifiedTrack` cascade from #78). | ☐ | |PASS

## 7. Regression sweep (quick)

| # | Check | Expected | Result | Note |
| :-- | :--- | :--- | :-- | :-- |
| 7.1 | No crash anywhere from NaN aura phase / 0/0 translate. | Stable. | ☐ | |PASS
| 7.2 | Screen churn (navigate in/out repeatedly). | No runaway re-renders / leaks (store unsubscribe parity). | ☐ | |PASS

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
| R1.1 | D-2 (#93) | Start playback, then Profile → Log out. | Music **pauses before** disconnect — no orphaned audio after logout. | ☐ | |PASS
| R1.2 | D-3 (#96) | Open History after a Manual gen and (if available) a Live serve. | **Friendly titles** (no raw `moodKey`), each row shows **Manual/Live** source, chosen activity chip persisted. | ☐ | |PASS
| R1.3 | D-4b (#95) | Open Pulse with watch connected; also with a metric the watch doesn't share. | Friendly status labels; unshared metrics say **"Not shared by your watch"** (honest empty state), never bare dashes/errors. Body Battery/Readiness presented as Garmin-only. | ☐ | |FAIL
| R1.4 | D-4 ingestion ([#90](https://github.com/DanielMalede/Kokonada/issues/90)) | With Health Connect granted, wait one sync cycle, re-open Pulse. | Advanced biometrics populate from HC medical-profile ingestion (#99) — no longer blank. | ☐ | |FAIL - ONLY SHOW HEARTBEAT 
| R1.5 | D-6 (#98/#99, [#92](https://github.com/DanielMalede/Kokonada/issues/92)) | Fresh signup (or post-GDPR-delete account) → first Generate immediately. | `playlist_building` loader with bounded auto-retry — **no** "Still setting up your library" hard error; playlist eventually arrives. | ☐ | |PASS
| R1.6 | #100 Reconnect | Integrations → **Reconnect Spotify**. | Re-grant flow completes and returns to the app; badge stays Connected throughout. | ☐ | |PASS
| R1.7 | #102 first-gen bound | First generation right after a backend deploy (or Spotify 429 storm). | Library fallback serves within the bound — no minutes-long hang, no hard timeout error. | ☐ | |PASS

**Close-out rule:** all §1–§7 rows + R1.1–R1.7 PASS → Wave 1 CLOSED; close issues
[#90](https://github.com/DanielMalede/Kokonada/issues/90) and
[#92](https://github.com/DanielMalede/Kokonada/issues/92) with the evidence. Any FAIL → file
via the defect template; it blocks Wave 2.8's Vision-Frame rollout only if it touches the
Generate/playback path.

**R1 result (2026-07-09):** 30 PASS · **7 FAIL** · 0 BLOCKED → **Wave 1 NOT closed.**
Per Daniel's directive the failures **hard-block Wave 2.8** until fixed + re-tested.
#92 (D-6) CLOSED by R1.5 PASS. #90 (D-4 ingestion) STAYS OPEN (R1.4 FAIL).

---

## R1 TRIAGE (2026-07-09) — filed defects

7 FAIL rows collapse to **4 root-cause clusters**. Device build: Galaxy, `installDebug` main@cbf9f5e.

### D-7 — Playback: no auto-advance at end of track
```
Title:        Playback — track does not auto-advance to next at end
Row:          3.4
Device/build: Galaxy, installDebug main@cbf9f5e
Repro:        1) Manual-generate 50 tracks  2) Play a track  3) Let it reach the end
Expected:     Auto-advances to the next queued track
Actual:       Playback stops at end; no advance
logcat:       NEEDED — grep `[sessionPlaylist]` (context attached vs attach failed)
Severity:     major  (breaks continuous listening — touches playback path → BLOCKS 2.8)
```
**Hypothesis:** legacy single-URI playback, not D-1 context mode. Backend attaches a session
`contextUri` only with **playlist-modify-private** scope (`biometricHandler.js:313`); without it,
`writeSessionPlaylist` fails → falls back to track playback (`:322`) → Spotify stops at track end.
Auto-advance then depends on `PlaybackOrchestrator.onTrackEnded` being wired to a native track-end
signal that the remote adapter may not emit.

### D-8 — Live mode: band-recalibration auto-serve never fires (Slice 4 dead on device)
```
Title:        Live mode — confirmed band change does not auto-serve music
Row:          4.2, 4.3, 4.4
Device/build: Galaxy, installDebug main@cbf9f5e
Repro:        1) Flip Live + relaunch (4.1 PASS)  2) HR flowing (P4)  3) Raise HR to cross a band
Expected:     Biometric auto-push serves w/o Generate; warm=instant (4.3); cold=loader+gen (4.4)
Actual:       Nothing serves on the band transition
logcat:       NEEDED — `[live_mode] enabled=?` on the HR-receiving socket; `live_assembling`/biometric `playlist_ready`
Severity:     blocker  (whole Live-biometric value prop — touches Generate/playback → BLOCKS 2.8)
```
**Hypotheses:** (1) per-socket `state.liveMode` mismatch — watch HTTP HR ingest drives a socket
whose `liveMode` is false → `maybeServeLiveBand` early-returns (`biometricHandler.js:761`); (2)
confirmed band transition never detected; (3) client doesn't drive playback on `trigger:'biometric'`
(`socketClient.ts:175`).

### D-9 — liveMode persists across logout (re-login opens in Live)
```
Title:        Auth/state — liveMode preference survives logout
Row:          6.1 (PASS-with-defect note)
Device/build: Galaxy, installDebug main@cbf9f5e
Repro:        1) Set Live  2) Log out  3) Log back in
Expected:     Opens in default Manual
Actual:       Opens in Live
logcat:       n/a
Severity:     minor  (does NOT touch generate/playback rendering — but a stale mode auto-drives a new session)
```
**Root cause (confirmed in code):** logout teardown resets warm/nowPlaying/playbackError/currentUser
(`shadow.authMigration.test.ts:52-55`) but NOT `liveModeStore` (persisted `koko.liveMode`,
`liveModeStore.ts:10`). Fix = add `resetLiveMode` to the teardown, parity-tested with the other planes.

### D-4 (#90) — Pulse advanced biometrics blank + missing honest empty states
```
Title:        Pulse — only heartbeat shows; HRV/sleep/resting blank; no "Not shared" empty states
Row:          5.2, R1.3, R1.4
Device/build: Galaxy, installDebug main@cbf9f5e
Repro:        1) Watch connected, HC granted  2) Wait a sync cycle  3) Open Pulse
Expected:     Advanced gauges populate from HC MedicalProfile ingestion; unshared metrics say "Not shared by your watch"
Actual:       Only heartbeat renders; other metrics blank (no gauge, no honest empty state)
logcat:       NEEDED — Sync Health result counts; `GET /api/pulse/state` payload
Severity:     major  (display surface, NOT generate/playback — but Daniel's directive blocks 2.8 on it)
```
**Hypothesis:** HC→MedicalProfile ingestion orphaned (#90) — `syncMedicalProfile` not run / not
returning advanced metrics, so `/api/pulse/state` carries HR only; AND `PulseScreen` renders nothing
(not the D-4b "Not shared" empty state) for absent metrics. Extends open issue #90.
