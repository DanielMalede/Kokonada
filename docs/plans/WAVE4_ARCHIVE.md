# WAVE4_ARCHIVE - history moved out of WAVE4_STATE.md

> Verbatim and append-only. Sections are moved here by the S2.5 R1.5 housekeeping rule once
> WAVE4_STATE.md passes 150KB. Nothing is summarised or rewritten - provenance matters.
> STATE keeps the run header, the full task table, the backlog, open HITL items, the PR queue,
> the last 2 reflection entries and the last 24h of session log.

## Archived 2026-08-19 (reflection #4, session 23)

Moved: the 12 per-task evidence sections for sessions 5-18 (every one already verified by
reflections #1, #2 and #3), plus reflection log entries #1 and #2 with their evidence sections.
STATE was 204,535 bytes before this pass and is ~104KB after it.

NOT moved, deliberately: the 11 closed Discovered-backlog rows R1.5 also nominates. Removing
them makes "node scripts/wave4/state-guard.js check" report 11 row regressions - the W4-D02
guard cannot tell an archival from a stale rewrite. Queued as W4-D16 rather than worked around.

## W4-001 evidence â€” deliberate behaviour changes & re-pins (session 5)

Every fix landed test-first in `backend/tests/wave4.bugfix.test.js` (34 pins, one describe per defect).
Full suite **164 suites / 1802 tests / 1 todo** green in ~80 s. No lint step exists in `backend/package.json`
(`start|worker|dev|test` only), so "lint clean" is vacuous here â€” recorded rather than claimed. Secret scan of the
whole branch diff: clean. Zero-knowledge: the diff adds no numeric vital to any log/DTO/prompt (see W4-D03 for the
pre-existing DEBUG-gated one).

**Three existing tests were deliberately re-pinned** (behaviour changed on purpose):

1. `watchIntegration.test.js` â€” "boundary: heartRate 30 and **230** â†’ 202" became **220**, plus a new assertion that
   225 is now a 400. The route accepted 30â€“230 while every consumer requires 30â€“220, so 221â€“230 was accepted with a
   202 and then silently dropped one call later. Both now call `isPhysiologicalHR`.
2. `biometricHandler.pipeline.test.js` â€” "biometric_push debounce fires pipeline after 60s" used 65â†’80 bpm, which is
   `resting`â†’`resting`. Under the D11 band trigger that no longer recalibrates (identical `bio:<band>:<activity>`
   buffer key), so the fixture became 65â†’95 (`resting`â†’`active`) and the test keeps its original intent: the debounce
   is wired to the pipeline. A NEW test covers the other side â€” 60â†’85 confirms `stableHR` but emits
   `recalibration_cancelled {reason:'band_unchanged'}` instead of burning a generation.
3. `biometricHandler.pipeline.test.js` â€” the two immediate-mode Â±25 bpm tests now assert band semantics
   (`does NOT re-trigger on a large jump that stays inside one band`, `re-triggers on a band crossing the old 25 bpm
   gate would have missed`). Worth flagging: the old negative test ran on a socket that was never in Live mode, so
   `recalibrateForBand` early-returned and the test would have passed whatever the gate did â€” a false green. It is
   now a real test (`live_mode` on).

**Design decisions taken inside the task:**

- **Shared HR predicate got its own module** â€” `app/services/wearable/hrRange.js` (`HR_MIN`/`HR_MAX`/`isPhysiologicalHR`),
  imported by both the socket handler and `integrationsController`. "Delegate to the shared predicate" needs one
  canonical home; leaving it in the socket module and importing that into a controller is the wrong direction.
- **D11 trigger extracted as a pure `_shouldRecalibrate({prevHR,nextHR,activityChanged})`**, exported for unit testing.
  The alternative â€” asserting through `recalibrateForBand` â€” needs the full mock harness and hides the decision.
  `HR_NOISE_FLOOR = 3` bpm keeps boundary jitter (119â†”121 across the 120 cut) from flapping the band; it is the
  documented "delta guard as noise floor". The streaming lane ALSO arms on a sub-10-bpm band crossing now, so
  115â†’121 is no longer a missed transition on either lane.
- **`WATCH_HR_DELTA_THRESHOLD` (25 bpm) deleted, not kept dead.** The band trigger subsumes it: a same-band ping
  produces the same buffer key and is inert by construction at any delta.
- **D7's EWMA (Î± = 0.2, ~5-sample memory) updates on EVERY accepted reading, both lanes**, seeded at the first
  reading â€” it is an observation trace, not a confirmation path. W4-003 replaces it with Hampel + Kalman.
- **D3's cut is `UNLABELLED_RESTING_HR_CEILING = 110`** (low edge of Zone 2 for a ~190 HRmax adult): an unlabelled
  reading counts as "resting" only below it. Personal Karvonen zones replace this fixed anchor in W4-004/005.
- **D4 is now a bias, never a floor** â€” `valenceTarget = clamp01(moodValence + min(0.1, 0.15Â·S))`. Note this defect
  was LATENT, not live: every current mood preset has `valence_hint >= 0.5`, so the old `max(v, 0.6)` floor rarely
  bit. The pin therefore injects a low-valence mood via `jest.doMock` to prove the floor is really gone before
  W4-005/006 start emitting genuinely low-valence states.
- **D14's step is 0.175** so 4 missing groups land exactly on the 0.3 floor; `biosonicBand.tolerance` now reaches
  within 0.1 of `W_MAX` for a cold start (pinned).
- **D17 keeps the old single-argument signature** (`_analyzeYouTubeTracks(videos)` â†’ all treated as likes) so the
  existing `musicProfile.test.js` callers are untouched; `buildProfile` passes `{likedIds}`. Playlist items now
  outrank likes (`SOURCE_WEIGHTS.playlist` 4 > `saved` 3) â€” that inversion is the Spotify side's existing product
  ruling ("a curated playlist is a DELIBERATE choice"), applied consistently, not an accident.
- **W9: the energy gate was ANNOTATED, not removed** (the mission allows either). Deleting it would also delete a
  working, tested capability and its unit test for zero product gain, and W4-007 rebuilds the energy kernel and may
  re-enable a confidence-gated hard ceiling. The comment now states it is dormant by WIRING (both call sites pass
  `energyCeiling: null`), not dead by accident, and a pin asserts the annotation exists.

## W4-D01 evidence â€” the reflection close-out marker (session 6)

Test-first: `backend/tests/wave4.reflectMarker.test.js` (27 pins) was written and run RED before any
implementation existed (`Cannot find module .../scripts/wave4/reflect-marker.js`), then 25/27 green after the
module landed with only the two loop-backstop guards still red, then 27/27 after the loop change. Full suite
**165 suites / 1829 tests / 1 todo** green, ~81 s, exit 0. Secret scan of the branch diff: clean (the single
regex hit is the mission's own DoD line quoting the grep pattern). No numeric vitals anywhere in the diff; no
attribution. No `lint` script exists in `backend/package.json`, so that DoD line stays vacuous â€” recorded, not claimed.

**What was actually wrong** (the backlog row's premise was off, corrected above): Â§2 step 4 latches the
reflection trigger on `logs/wave4/last-reflect.txt`, Â§2.5 R7 is the only thing that clears it, and R7 was
pure convention â€” no code wrote that file. `logs/` is gitignored, so it is machine-local and invisible to CI.
A reflection killed by the 100-minute session timeout, or one that simply ended without doing R7, leaves the
trigger ON forever: every later session becomes another reflection and the queue can never advance.

**The fix, in two halves:**

1. `scripts/wave4/reflect-marker.js` â€” the ONE implementation of the marker's format and staleness rule,
   used by both the loop and the session, so "is a reflection due?" stops being re-derived by hand each
   session. Pure (`now` is a parameter, Â§0.4 S9), zero dependencies. Line 1 is a bare ISO-8601 UTC timestamp
   (Â§2 step 4 calls the file "a single ISO-8601 UTC timestamp"), line 2 the HEAD sha (Â§2.5 R7's "next to it").
   CLI: `check` â†’ `DUE <reason>` / `NOT-DUE <reason>`; `stamp` â†’ writes it.
2. `run-mission.ps1` `Assert-ReflectMarkerStamped` â€” after any session whose result line is `REFLECT`, the
   loop verifies the marker was touched during that session and stamps it if not. The session still owns R7;
   the loop guarantees the invariant. A crashed/timed-out session takes the failure branch and is NOT stamped,
   so a reflection that never happened still re-runs.

**Design decisions taken inside the task:**

- **Parsing fails toward reflecting, never toward silence.** Missing, unparseable and future-dated markers all
  report DUE. The future check (5-minute skew tolerance) is deliberate: a clock skew or a bad hand-edit could
  otherwise park the timestamp years ahead and suppress every future reflection â€” the same trap Â§0.4 S6 pins
  for biometric `recordedAt`. Timestamps are matched by a strict ISO-8601 regex, not free-form `Date` parsing,
  so prose like "no reflection has run yet" can never be coerced into a valid date.
- **The guard is NOT a file-existence assertion.** `logs/` is gitignored, so on a fresh clone or in CI the
  marker legitimately does not exist and such a test would be permanently red. What is pinned instead is the
  invariant's *mechanism*: the loop defines the backstop, invokes it on a REFLECT result, and touches the real
  marker path â€” with a detector self-test (the `adr0012.tripwire.test.js` pattern) proving all three checks can
  still fail.
- **A jest tripwire over a PowerShell file can only read text, which is a false-green risk**, so the loop change
  was also verified for real: `Parser::ParseFile` reports no syntax errors, and the function was extracted from
  the file via its AST and executed against a scratch root over four cases â€” session forgot to stamp (stamps),
  marker already fresh (no-op, mtime unchanged), stale marker from a previous session (re-stamps), and node
  removed entirely (inline PowerShell fallback still clears the trigger).
- **The inline fallback is not gold-plating.** This function exists precisely because the primary path can fail;
  a backstop that silently no-ops when `node` is missing would re-open the hole it was written to close.

## W4-D02 evidence â€” the STATE row-clobber guard (session 7)

Test-first: `backend/tests/wave4.stateGuard.test.js` (36 pins) was written and run RED before any
implementation existed (`Cannot find module .../scripts/wave4/state-guard.js`, 0 tests executed), then
27/36 green once the engine landed, then 34/36 after one real parser bug the pins caught (see below),
then 36/36 after the loop backstop. Full suite **166 suites / 1865 tests / 1 todo** green, ~81 s, exit 0
(baseline 165/1829: +1 suite, +36 pins, **zero re-pins** â€” nothing existing changed behaviour). Secret
scan of the branch diff: clean (the one regex hit is the mission's own DoD line quoting the grep
pattern). No numeric vitals â€” this task touches no biometric surface at all. No attribution. Still no
`lint` script in `backend/package.json`, so that DoD line stays vacuous â€” recorded, not claimed.

**What was actually wrong.** The backlog row's premise held up: `ccecca3` reset W4-001 from `in_progress`
back to `pending` because it composed the whole of `WAVE4_STATE.md` from a read taken before that commit
and wrote it back wholesale. The row's DoD was phrased as a rule ("reflection sessions re-read STATE
immediately before writing and never downgrade a row they did not set") â€” but that rule already existed
in spirit and did not help, which is precisely the W4-D01 lesson: a rule nobody can *fail loudly* is not
a control. STATE is declared the SINGLE resume source, so a stale rewrite can re-run finished work or
strand an owned task, and nothing anywhere was looking.

**The fix, in two halves (mirroring W4-D01):**

1. `scripts/wave4/state-guard.js` â€” the ONE implementation of "did this STATE edit illegally regress a
   row?". Pure engine (two strings in, violations out; no clock, no randomness, no git â€” Â§0.4 S9), git
   and fs confined to the CLI. Flags three kinds: `regressed` (down the status ladder), `removed` (a row
   that simply vanished â€” the other half of a stale rewrite), `unknown-status` (a garbled cell). CLI
   `check --base <ref>` exits non-zero and names the row.
2. `run-mission.ps1` `Assert-StateRowsNotClobbered` â€” the loop captures `$sessionStartSha` before
   launching a session and re-runs the same check afterwards. Mission Â§2 step 6 / Â§2.5 R2 + R7 now
   require the session to run it before every STATE commit; the loop guarantees the invariant either way.

**Design decisions taken inside the task:**

- **Deliberate reopening stays possible, and has to say so.** Â§2.5 R2 legitimately sends a task from
  `done` back to `pending`. A rank decrease is therefore allowed when the row carries the literal
  uppercase token `REOPENED` â€” the difference between the two cases is exactly that a reopen is a
  decision someone made and wrote down, while a clobber is a decision nobody made. The token is
  **uppercase on purpose**: STATE already contains the word "reopened" in ordinary prose (H2's narrative,
  the reflection-log header), and STATE's house style already uses uppercase tokens (`DISCOVERED`,
  `RESOLVED`) for deliberate annotations, so a case-insensitive match would have switched the guard off
  by accident rather than by choice. Pinned both ways.
- **A vanished row is never suppressible**, not even by `REOPENED`. There is no legitimate reason to
  delete a task row â€” STATE's own header says to keep the task table authoritative and never drop history.
- **Tables are identified by header, not by position.** The task table puts `status` in column 6, the
  discovered backlog in column 7 (it has an extra `class`). A table counts as a task table iff its header
  has BOTH an `id` and a `status` column â€” which cleanly admits exactly those two and excludes the PR
  queue (status, no id) and the reflection log (neither). Without that, every PR status change would read
  as a task regression.
- **`failed` ranks level with `done`**, so only a STRICT decrease trips. `in_progress â†’ failed` (rule of 2,
  S4) stays legal, and reviving a `failed` row needs the same `REOPENED` a `done` row does.
- **The pins caught a real bug in this module before it shipped**: stripping markdown emphasis with a
  global `[*_`]` strip turned `in_progress` into `inprogress`, silently breaking the very ladder the guard
  rests on. Emphasis is now trimmed at the edges only. This is the whole argument for writing the
  status-ladder assertions before the parser.
- **One pin reads the REAL `WAVE4_STATE.md`** and asserts every parsed status is one of the four known
  values and that the file is self-consistent. It is a live tripwire: a future session that garbles a
  status cell or breaks a table's shape turns the suite red instead of silently becoming unparseable â€”
  a guard that stops parsing the file it guards is worse than no guard.
- **The jest pins over `run-mission.ps1` can only read text, which is a false-green risk**, so the loop
  change was verified for real, exactly as W4-D01's was: `Parser::ParseFile` reports no syntax errors, and
  the function was extracted from the file via its AST and executed against a scratch git repo over six
  cases â€” legal forward edit (silent), the ccecca3 clobber (flagged, names the row), row deleted
  (flagged), `REOPENED` reopen (allowed), no base sha (silent no-op), tool absent (degrades silently
  instead of wedging the loop). The CLI was also run against the real repo: `OK 20 rows` clean, exit 1 on
  an injected regression of W4-001.
- **The backstop runs on EVERY outcome, before the loop classifies the session.** A crashed or timed-out
  session can commit a clobbered STATE just as easily as a clean one â€” gating the check behind the success
  branch would skip exactly the sessions most likely to have made a mess. Pinned by asserting the call
  site precedes `# 5. classify the outcome`.
- **It is a detector, not a repair.** It cannot un-commit. Its whole job is to turn a silent erasure into
  a loud line in `logs/wave4/usage.log`, attributed to the session that caused it.

## W4-D05 evidence â€” the band-trigger flap (session 9)

Commit `95b85db`. Suite **167 / 1891** green, exit 0 (from 166/1865: +1 suite `wave4.bandHysteresis.test.js`
with 23 pins, +3 pins appended to `biometricHandler.pipeline.test.js`, **zero re-pins** â€” the whole fix is
additive to the existing contract). TDD evidence: the new suite ran **15 failed / 8 passed** against unmodified
source before implementation, then 23/23. `biometricHandler.pipeline.test.js` + `wave4.bugfix.test.js` re-run in
isolation after the handler edit (Risk Register #1): 160/160 green.

**The design decision, and why the other option was rejected.** The DoD offered "min-dwell/cooldown **or**
asymmetric enter/exit band cuts". A wall-clock cooldown was rejected on evidence: the watch lane pings every
5 minutes, so any cooldown short enough not to delay a real activation is also shorter than the ping interval and
suppresses nothing, while a cooldown long enough to work would delay genuine crossings by more than it saves â€”
and it would have broken every existing pin that fires two recalibrations in quick wall-clock succession.
Asymmetric cuts have neither problem. Note also that no single `(prev, next)` pair can distinguish the flap from a
real crossing â€” `88â†’93` and `115â†’121` are the same event in the small â€” which is why the fix had to add *state*
(the latch), not just a wider threshold.

**Two halves, both load-bearing:**
1. **Asymmetric release in `_shouldRecalibrate` (pure).** Attack (entering a higher band) is unchanged from W4-001 â€”
   the 3 bpm noise floor is still the only gate, so a real activation is never delayed and the DoD's `115â†’121` case
   still fires. Release (falling back) now requires the reading to clear the band's own cut by
   `HR_BAND_RELEASE_MARGIN = 6`. Measured from the CUT, not from `prevHR`: the threshold is a property of the band,
   which is what the buffer is keyed by â€” a delta from the last reading is precisely what flapped.
2. **`state.servedHR` latch on the immediate lane.** The margin alone fixes nothing here, because `stableHR` tracks
   every ping, so each half-oscillation reads as a fresh crossing. The trigger now compares against the band being
   SERVED. This is what bounds the wide oscillation (`114â†”121`) that spans both thresholds and that the margin alone
   cannot catch. Latched on the trigger decision rather than on the serve, so the Manualâ†’Live switch cannot flap.

**Constant derivation (6 bpm).** `HR_NOISE_FLOOR = 3` is sized for *sensor* error (PPG vs ECG). The flap is not sensor
error â€” resting HR varies 5â€“10 bpm minute-to-minute from respiratory sinus arrhythmia and ordinary autonomic drift,
which is real signal at the wrong scale to act on. Reflection #1 measured the actual flap amplitudes at 3â€“5 bpm
(`88â†”93`, `87â†”92`, `119â†”122`); 6 covers all three with headroom and reads as "twice the sensor's own error must
separate the reading from the cut before we abandon the mix". Pinned to stay `> HR_NOISE_FLOOR` â€” at or below it the
trigger is symmetric again and the defect is back.

**One-definition fix (D11's own lesson).** The release margin has to measure from a cut, and hand-copying `90/120`
into the handler would have re-created exactly the trigger/key divergence D11 was about. `moodDescriptors` now exports
`BAND_LOWER_CUT = {resting: null, active: 90, peak: 120}` and `bandFromHeartRate` reads it â€” behaviour byte-identical,
pinned by a property test sweeping every HR from 30 to 220.

**S11 kill-switch.** `WAVE4_RECAL_STATE_TRIGGER_DISABLED` restores W4-001 behaviour with no revert and no deploy:
symmetric noise-floor release AND the old `prev`-reading comparison. Deliberately forgiving about its value
(`true|1|yes|on`, case-insensitive; empty/`false`/`0` = off) â€” a kill-switch that ignores `=1` because it demanded
`=true` fails at the moment it is needed. The integration pin asserts 4 serves for 4 flapping pings with the flag set
versus â‰¤1 without, so the flag test doubles as proof the fix is what is doing the work.

**Known residue, deliberately not chased.** An oscillation wide enough to clear the release threshold *and* re-enter
from a band the socket is not latched to can still serve more than once; that is a genuine multi-band swing, and
W4-009 owns the real mechanism (taxonomy-state transitions with min-dwell), which supersedes all of this. The
streaming lane needs no latch â€” its 60 s debounce is already a dwell â€” but inherits the release margin.

## W4-D06 evidence â€” the masked open-handle leak (session 10)

Commit `0e2228a`. Suite **168 / 1944** green, exit 0 (from 167/1891: +1 suite `wave4.openHandleGuard.test.js`
with 53 pins, **zero re-pins**). TDD evidence: the new suite ran RED with **0 tests executed**
(`Cannot find module '../jest/openHandleGuard'`) before any implementation existed, then 53/53. The leak fix
has its own redâ†’green, and it is the better one: with the guard installed and the tests unfixed, the two
biometric suites reported **163/163 tests passed and exit 1** â€” which is the whole point of the task.

**What was actually wrong, and where the premise was finer than stated.** The two leaked 60 s debounce timers
were real and exactly where W4-D06 said (`biometricHandler.js:1248`, armed from `wave4.bugfix.test.js` and
`biometricHandler.pipeline.test.js`). The *cause* was one line finer than "the tests forget to clean up":
`_debounceMap.clear()` and `.delete()` LOOK like cleanup and are not â€” they drop the state object while the
timer stays armed on the shared event loop, then fire against `debounceMap` up to a minute later. Production
never had this bug; `registerBiometricHandler`'s disconnect handler already does `clearTimer` THEN `delete`.
Every test that reached for the map directly re-derived that order and got it wrong.

**The cross-suite flake was demonstrated, not argued.** Before the fix, the full suite under
`--detectOpenHandles` (which slowed the run to ~92â€“98 s, long enough for a 60 s timer to come due mid-run)
failed **non-deterministically in a different suite each time** â€” `shadow.auth.test.js` on one run,
`socket.auth.test.js` on the next, both real-socket auth suites, both timing out on a 10 s budget. After the
fix the same command is green twice at 83â€“89 s. That also **corrects an intermediate conclusion of this
session**: the first working hypothesis was that `--detectOpenHandles` itself destabilises the auth suites.
It does not â€” it merely made the run slow enough for the leaked timers to land. The flag costs ~0 s here.

**Two halves, both load-bearing:**

1. **`_resetDebounceState()` in `biometricHandler.js`** â€” release every armed timer, then clear, as ONE
   operation built on the same `clearTimer` the disconnect path uses. Not two calls a caller must remember in
   the right order: that is W4-D02's lesson applied (a rule nobody can fail loudly is not a control). All 11
   `_debounceMap.clear()`/`.delete()` sites across 4 suites now call it, plus a top-level `afterEach` in the
   two files that arm the streaming lane.
2. **`jest/globalTeardown.js` â€” the standing guard.** `globalSetup` snapshots
   `process.getActiveResourcesInfo()`, `globalTeardown` re-samples and throws on any GROWTH. That hook is the
   last thing that can still influence the exit code â€” it runs after every suite and after the reporters, but
   BEFORE `--forceExit` takes the process out (`runJest.js` â†’ `runGlobalHook`, then `readResultsAndExit`) â€”
   verified against jest 29 on a scratch project before being relied on. Wired via a new `jest` key in
   `package.json`, so it is on for CI (`npm test`) as well as locally.

**Why the resource delta and not `--detectOpenHandles` on every run.** Jest's detector FILTERS handles to
those whose stack points at user code. Measured during this task: it reported **2** handles where the delta
reported **3**, having dropped one raised inside `node_modules`. That filter is wrong in exactly the direction
this wave is heading â€” a leaked ioredis dial, BullMQ worker or repeatable (W4-003/004/011/012) is constructed
inside a dependency, so the detector is weakest precisely where the risk is highest. The delta cannot be
filtered and costs one array per run. `--detectOpenHandles` keeps its real job as the localizer: it alone
names the file and line, so it ships as `npm run test:handles`, with a `testResultsProcessor` that turns its
findings into exit 1 (jest otherwise prints them and exits 0). That seam is the ONLY one that works:
`collectHandles()` populates `results.openHandles` after the reporters have run and after `success` is already
computed, so a custom reporter physically cannot do it â€” checked in `@jest/core` source, not assumed.

**Constant derivation (`DRAIN_MS = 250`).** A clean run is not empty at teardown: jest's own progress reporter
arms a 100 ms debounce on every `testFinished` (`@jest/reporters/build/Status.js` `_debouncedEmit`), and the
last one is still pending. Identified with an async_hooks probe rather than guessed â€” the first reading of
"1 residual Timeout on a pure suite" looked like a product leak and was not, and the guard would have been
built around a phantom. Without a settle window it would report that phantom `Timeout` every run, and the only
way to green it would be to ignore `Timeout` wholesale â€” gutting the exact class W4-D06 exists for. 250 ms is
2.5Ã— the known debounce, once per run. The trade is explicit and documented in the module: a leaked timer
under 250 ms is missed, which is the right side of it â€” 60 s debounces, intervals, sockets, Redis dials and
BullMQ workers all survive it trivially.

**`IGNORED_TYPES` is empty, by measurement.** The full 168-suite run was sampled with nothing excused and
reported no growth of any type. Every future entry must carry the measurement that justified it; the module
says so, and pins assert `Timeout` is not on the list and that the list is frozen, so a suite cannot widen it
at runtime to go green.

**The footgun is pinned shut.** A tripwire scans every `tests/*.test.js` for `_debounceMap.clear()`/`.delete()`
and fails naming the file. Its detector self-test builds the offending strings by concatenation on purpose â€”
a literal would make the tripwire's own file an offender and force the scan to skip itself, which is how a
tripwire quietly stops covering everything.

**Known limits, deliberately recorded.** (a) The guard reports a resource TYPE, not a location â€” that is what
`npm run test:handles` is for, and the failure message says so. (b) It is a whole-run delta, so a handle armed
and released inside the run is invisible to it; the tripwire and the per-file `afterEach` cover that class for
the debounce timers specifically. (c) Unlike W4-D01's marker, this guard keeps no machine-local state in the
gitignored `logs/`, so there is nothing that can silently disappear and switch it off.

## W4-002 evidence â€” the synthetic-human simulator (session 11)

Commits `7782310` (rng + personas + generator) and `79efc81` (replay + soak). Two TDD cycles, each RED first:
cycle A ran with **0 tests executed** (`Cannot find module '../sim/rng'`) before any implementation existed, then
55/55; cycle B likewise (`Cannot find module '../sim/replay'`, 0 executed) â€” `sim/replay.js` was written, then
**moved out of the tree** so the red was genuine rather than narrated, then restored. The soak block ran RED the same
way (`Cannot find module '../sim/soak'`). Final: **84 new pins, zero re-pins** â€” W4-002 is additive, it changes no
existing behaviour, which is why nothing existing needed re-pinning.

**What shipped.** `sim/rng.js` (sfc32 seeded through splitmix32; gaussian, standardised Student-t, labelled
`fork()`), `sim/personas.js` (the mission's five + **two holdouts**), `sim/generator.js` (cosinor + noise +
episodes, artifact injector, both lanes), `sim/replay.js` (drives the real handler + real `healthStore.ingestBatch`
against `mongodb-memory-server`), `sim/soak.js` (24h-equivalent, RUN_SOAK-gated CLI). `fast-check` added as the
S15 property-testing devDep â€” the lockfile diff is **purely additive** (41 insertions, 0 deletions): npm dropped the
hoisted optional-peer `gcp-metadata` entry as it did in session 1, and it was restored so the diff is only the dep.

**Design decisions, and why the alternative lost:**

- **RHR is DERIVED, not declared.** `restingHeartRate === mesor âˆ’ amplitude`, enforced in `definePersona` and
  pinned. Carrying it as a free third field is the obvious shape and is wrong: two numbers describing one fact
  eventually disagree, and an answer key that quietly contradicts itself is the worst failure a fixture has, because
  every estimator graded against it inherits the error silently.
- **No extra sleep dip.** Real cosinor fits run over all 24 h INCLUDING sleep, so the measured amplitude already
  contains the nocturnal drop; adding a second dip would inflate the amplitude the generator CLAIMS above the one it
  CONTAINS, and W4-004's "recovers {M, A, Ï†}" would then be measuring that discrepancy. Sleep instead narrows the
  noise (`sleepNoiseFactor`), which is the real autonomic effect and leaves the rhythm honest.
- **Noise is Ornsteinâ€“Uhlenbeck (AR(1) in continuous time), scaled at USE from a unit-variance state.** The two lanes
  sample at different rates (60 s live, 300 s batch), and a plain fixed-rho AR(1) would mean a different spread and a
  different memory at each â€” so every persona would silently be a different body per lane. Pinned by asserting the
  stationary spread at 15 s and at 300 s agree.
- **Ground truth is exposed TWICE.** `restingHeartRate` (parametric) and `empiricalRestingHeartRate` (P10 over the
  realised sleep samples) differ by 1â€“2 bpm from finite-sample effects. A later test tightening onto the wrong one
  would be chasing sampling error and calling it estimator error. Swept over 10 seeds x 7 personas: worst gap **2.40
  bpm** against the pin's tolerance of 4.
- **The activity map is a local copy, and that is only acceptable because drift fails loudly.** Every entry is
  round-tripped through the REAL `normalize()`. The one-definition rule (D11, W4-D05) says do not hand-copy; the
  alternative was exporting `ACTIVITY_MAP` from production code purely for a fixture, which is the wrong direction.
- **The artifact RNG is a FORKED substream, and `artifacts: false` is implemented as all-zero rates on the same code
  path.** If artifacts shared the signal's stream, turning them off would produce a different BODY and every
  comparison against the control would be meaningless. Pinned: `fork()` does not advance the parent, and the clean
  and dirty runs' truth arrays are identical.
- **Holdouts are a different generating process, not a re-parameterised core persona** (R10). Heavy-tailed, i.i.d.
  Verified across 6 seeds: core lag-1 autocorrelation **0.643** (pin > 0.4), holdout |lag-1| **0.035** (pin < 0.2),
  holdout excess kurtosis **2.18** (pin > 0.8).
- **The soak's RUN_SOAK gate is on the CLI, not the engine.** What is expensive is the full-stack run; a one-day dry
  soak is cheap and belongs in CI. Gating the engine would have meant either no soak coverage in CI at all or a
  second near-duplicate path â€” and a soak harness CI never executes is one that rots. The gate reads `process.env`
  at CALL time (a module-level constant would freeze the answer at `require()` and be untestable); pinned both ways.
- **The soak report is O(personas), not O(samples), and that is pinned** (a 4-day report is < 1.5x a 1-day one, and
  contains no `samples`/`events` arrays). It is the only anti-leak property a soak can actually assert about
  itself; a byte-threshold on heap would have been flaky theatre.
- **The replay harness tears down through the handler's OWN `disconnect` listener**, never `_debounceMap.delete()` â€”
  the footgun W4-D06 pinned shut. `--detectOpenHandles` over both new suites is silent, exit 0.
- **`lanes: false` was considered and REJECTED on measurement, not taste.** The suspicion was that building both
  lanes on truth-only tests was the suite's cost; timing said the heaviest generator call (4 personas x 14 days) is
  **424 ms**. The real cost was ~13 s of per-iteration `expect()` overhead in two loops, fixed by collecting
  violations and asserting once (generator suite 20.6 s â†’ 7.2 s). Adding API surface for a 0.5 s saving would have
  been gold-plating with a plausible-sounding justification.

**One implementation defect the pins caught before it shipped.** A sample inside an episode whose start jitter dipped
into the sleep window carried `asleep: true` at 168 bpm â€” breaking the "asleep implies resting" invariant AND
feeding workout HR into the P10-over-sleep resting estimate, i.e. re-creating the exact D2 contamination the fixture
exists to EXPOSE. `asleep` now means asleep (`!episode && inSleepWindow`): an early workout means the body got up
early, which is also what it means in life.

**Two tests were measuring the wrong axis, and the fix is the finding.** The Live-mode serve-count pins read 33â€“37
serves per simulated day and looked like a W4-D05 regression. They were not: the immediate lane triggers on a band
crossing **OR** an activity change, and `syntheticBioMoodKey` is `bio:<band>:<activity>` â€” so a `resting`/`unknown`
relabel genuinely changes the buffer key and is NOT the identical-key waste D11 was about. What the numbers actually
showed is that the ACTIVITY axis has **none** of the three protections W4-D05 gave the HR axis (noise floor,
asymmetric release, served-band latch), so its churn is exactly as fast as the classifier's. The band-axis pins now
hold the label still so they measure what they claim, and a separate pin MEASURES the activity axis without judging
it â€” the flip rate is the fixture's, not a sourced claim about any real watch, and W4-009 owns the real fix
(state transitions with min-dwell across both axes). Recorded here rather than queued: it is W4-009's committed scope.

**Deliberate "this is what it does TODAY" pins.** Three assertions encode current behaviour so the scheduled fix is
visible as a decision instead of a drift: the live socket lane persists **nothing** (D10 â†’ W4-003), a future-dated
reading is **accepted** (S6 â†’ W4-003), and one out-of-range batch sample is dropped while `inserted` reports success
(W4-D08). Each names the task that will flip it.

**Suite.** See `testBaseline` above for the full control evidence. Short version: **170 suites / 2028 tests**, the
only failure is a pre-existing wall-clock latency budget that reproduces with these suites REMOVED (twice, in two
different files), and both offending files pass in isolation. Not banked as a green baseline â€” Â§0.4 S1a â€” and queued
as W4-D09. Secret scan of the branch diff: clean. No numeric vitals in any new log line: the generator's telemetry
carries counts and timings only and a pin asserts it never matches `(hr|bpm|hrv|rhr)=`. No attribution. Still no
`lint` script in `backend/package.json`, so that DoD line stays vacuous â€” recorded, not claimed.

## W4-D09 evidence â€” the non-deterministic latency budgets (session 12)

Commits `f0085a9` (helper + pins), `e8ed646` (the two per-call call sites), `de45866` (the burst budget).
Suite **171 suites / 2073 tests** green, exit 0, twice back to back (see `testBaseline`). From 170/2028:
+1 suite `wave4.perfBudget.test.js` with 45 pins, **3 deliberate re-pins**, no test-count change in the
two edited files. TDD evidence: the suite ran RED with **0 tests executed**
(`Cannot find module '../jest/perfBudget'`) before any implementation existed; with the helper landed but
the call sites untouched it ran **34 passed / 4 failed**, the four being exactly the tripwires that assert
the call sites were rewritten â€” the red MOVED to the remaining work instead of vanishing. Then 64/64.

**S2 â€” this session adopted a leftover instead of stashing it.** The prior session was killed at its
session limit (`12b9859`) having written `tests/wave4.perfBudget.test.js` and nothing else. The file was
re-verified genuinely red, read in full, and adopted as this task's RED phase â€” the case Â§0.4 S2 permits,
because the leftover was understood completely rather than built on blindly. Its header comment was then
REWRITTEN, because its measurements did not reproduce (below). `mobile/src/health/config.ts` stays
uncommitted per session 1.

**The premise held. Two of its inferences did not, and one of its justifications did not reproduce.**
Measured here with a 20-sample probe substituted for the two assertions:

| operation | full 170-suite run | two-suite isolated run |
|---|---|---|
| `generateV2` stageMs.total | 188..194 ms | 231..307 ms |
| selection pipeline, 500-track pool, k=50 | 190..204 ms | 241..292 ms |

- **The SLOW condition is the ISOLATED run, not the loaded one** â€” the opposite of what the row assumed.
  170 suites of warm JIT make the full run the FAST case. "Both pass in isolation" was a snapshot, not a
  property.
- **No memory pressure is needed.** Two of twelve isolated `generateV2` samples (304, 307 ms) clear the
  300 ms budget with the box idle â€” an observed over-budget rate of 2/12, so the five-sample loop passed
  roughly `0.83^5 â‰ˆ 40%` of the time under that condition.
- **The prior session's stated justification for min-of-N did not reproduce.** It claimed single-shot
  wall-clock inflates to 2.8x true cost under 8-way contention while min-of-5 holds to 1.78x. Re-run on
  this box against a CPU-bound workload of known cost with **24 hogs on 16 cores**, single-shot max
  inflated **1.05x** and min-of-5 **1.04x** â€” contention is simply not the mechanism here. The comment was
  replaced with the mechanism that IS measurable: the operation's own ~60% cost swing (188 -> 307 ms).
  min-of-N survives for a reason that holds regardless: wall-clock noise is **one-sided** â€” an operation
  cannot run faster than its true cost, while GC, deopt and descheduling only add â€” so the minimum
  estimates the floor, and every sample must be inflated for the result to be.

**What shipped.** `backend/jest/perfBudget.js`: `summarize` (min/p50/p90/max/n, nearest-rank so n=1 is
defined), `measure` (warmup + samples, injected clock/cpu/reset, S9-pure), `fromDurations` (for call sites
that already own their samples), `expectWithinBudget` (collapse ceiling on min, opt-in SLO on p50). All
three options the DoD offered are delivered together rather than one of them: a generous ceiling
(`COLLAPSE_BUDGET_MS = 600`), a recorded distribution (a one-line `[perf]` record on EVERY run), and the
strict SLO behind `PERF_STRICT` â€” plus CPU time sampled alongside wall time as a fourth signal.

**Constant derivation.** 600 ms is 2.6x the worst min-of-N observed for either operation (231 ms, cold and
isolated) and ~2x the worst single sample ever seen (307 ms) â€” clear of the operation's entire observed
range, so only a real algorithmic regression trips it. `SLO_MS = 300` is the Â§0.4 S10 product number,
checked on p50 and only under `PERF_STRICT`, because a shared runner should not be able to turn a correct
build red on the SLO. Both constants live in the helper, not at the call sites: hand-copying a threshold
into each consumer is exactly the trigger/key divergence D11 was about.

**Why a loose ceiling is not a quiet weakening.** On its own it would be â€” 600 hides a 2x drift. The record
line is what makes it honest: `[perf] selection-500 min=191 p50=192 p90=194 max=194 n=5 budget=600
cpuMin=187` prints on every run, so a 190 -> 390 drift is visible in the log even though it does not fail.
Ceiling = collapse guard; record = drift visibility; strict mode = the SLO on demand. The old assertion had
none of the three: it had one sample and a coin flip.

**Both directions proven, not argued.**
- Stub-out: `COLLAPSE_BUDGET_MS` temporarily set to 50 â†’ both call sites RED with
  `generateV2 exceeded its performance budget: min=254ms > budget=50ms (p50=289 p90=327 max=327 n=5)`.
- Strict path: `SLO_MS` temporarily set to 1 with `PERF_STRICT=1` â†’ both call sites RED with
  `missed its strict SLO`. At the real 300 with `PERF_STRICT=1` the suites pass (p50 277 / 263).
  Constants restored to 600 / 300 and re-verified in the file after each experiment.

**The task was one assertion wider than the row knew, and the verification run is what found it.**
`shadow.flip.test.js:212` also bounded the 20-user burst with an absolute constant (`wall < 6000`). It is
the same defect one timescale up, it was NOT in the row's named scope, and it failed **on a clean
full-suite run (C) at 6236 ms** â€” so the DoD's "re-establish a genuinely green baseline" could not be met
without it. It was fixed rather than queued: leaving a known-flaky wall-clock budget in a file this task
was already editing, while claiming the baseline is now deterministic, would have been false.

The replacement is **relative, not a bigger constant**. The work is CPU-bound with mocked I/O, so 20
concurrent generations can never beat 20 sequential ones â€” measured overhead ratio **0.996 / 1.022 /
1.052** over three isolated runs and **1.222 / 1.139** over two full-suite runs. The budget is now
`2.0 x 20 x (min-of-3 calibration measured on the same box in the same run)`, which is precisely "queueing,
not collapse" and does not age with the hardware: it read 6990, 7650 and 10000 across runs instead of a
fixed 6000. The calibration is min-of-3 for the same one-sided-noise reason the helper exists â€” a
calibration landing on a fast slice would tighten the budget into a flake.

**A first cut of 1.5 was rejected, and the rejection is itself the finding.** Against the worst observed
pairing (1.222, run D) it left only 23% headroom â€” the same thin margin that made the ORIGINAL constant
flake, reproduced at a different number. It was caught only by computing the ratio from the two FULL-SUITE
runs instead of trusting the three isolated ones, where it looked like a comfortable 1.00-1.05: the
full-suite figures are the high ones because a loaded heap makes GC rather than concurrency the marginal
cost, and because the min-of-3 calibration can itself land low there (233 ms in the run that produced
1.222), inflating the ratio from the denominator. 2.0 leaves ~64% headroom and still trips what the test
guards â€” a real collapse runs 2.5-5x serial, not 1.2x.

**Six full runs, and what each one proves.** (D/E ran at ratio 1.5, F at the final 2.0.)

| run | condition | result | `generateV2` | `selection-500` | burst / budget |
|---|---|---|---|---|---|
| A | clean, pre-burst-fix | 171/2070 green, 118.3 s | min 257 p50 299 max 311 | min 242 p50 279 max 301 | passed vs 6000 |
| B | **deliberate 2x overload** (a second full suite running concurrently), pre-burst-fix | **2 failed** | min 304 p50 320 max 330 | min 315 p50 320 max 334 | **failed** vs 6000 |
| C | clean, pre-burst-fix | **1 failed** | min 292 p50 308 max 337 | min 305 p50 316 max 336 | **failed, 6236** vs 6000 |
| D | clean, post-burst-fix | **171/2073 green, 121.1 s** | min 260 p50 272 max 298 | min 225 p50 258 max 307 | 5695 / 6990 (ratio 1.222) |
| E | clean, post-burst-fix | **171/2073 green, 121.9 s** | min 255 p50 273 max 352 | min 291 p50 304 max 332 | 5809 / 7650 (ratio 1.139) |
| F | clean, final ratio 2.0 | **171/2073 green, 117.7 s** | min 231 p50 263 max 312 | min 261 p50 266 max 286 | 5596 / 9280 (ratio 1.206) |

The two per-call budgets held in **all six** runs, including the overloaded one â€” that is the fix working.
Under the OLD per-call assertions, runs A, B and C would ALL have been red: A's `generateV2` loop required
every one of 5 samples < 300 and its worst was 311, and in B and C every sample of both operations exceeded
300. The exposure did not go away afterwards either â€” E's worst `generateV2` sample was **352 ms** and F's
312 ms, both on green runs â€” which is the clearest statement of the defect: the old assertion would have
failed builds that are, by every other measure, correct. B was contended by accident (launched before A had
fully exited) and is kept deliberately: it is the loaded-machine case the DoD names, and the fix holds there
with ~2x headroom.

**A note on how these numbers were obtained, because it changed one conclusion.** The background-task
notification stream in this session repeatedly reported figures that did not match the files on disk â€” it
reported run B as green when `npm test` had exited 1 with two failures, and reported run D twice with
different timings. Every number in this section was therefore re-read directly from the `npm test` output
files with a fresh command, and the process table was checked to confirm a run had actually exited before
its output was trusted. The first read of run F was taken while jest was still writing, which is exactly how
a half-finished run can be mistaken for a finished one. Recorded because R2's rule generalises: trust
nothing that reports its own success, including the harness reporting the test run.

**Recorded, deliberately not chased.** (a) `captionService.test.js:144` also asserts wall clock
(`elapsed < 1000`) and was checked: it bounds a 60 ms *timeout* firing â€” a 16x margin on a control-flow
assertion, not a performance budget on computation. Different bug class, left alone, noted here so a later
reflection does not re-raise it as a miss. (b) Run B's second failure was `socket.auth.test.js` timing out
on its 10 s budget â€” the real-socket class W4-D06 already documented. It failed ONLY under the artificial
2x overload this session created, which no real workflow produces, so it is recorded rather than queued
(R6: do not manufacture busywork).

**Seam left for W4-007.** Â§0.4 S10 asks that task's golden harness to assert end-to-end selection wall-time
within +10% of a pre-wave baseline. That baseline is now measured rather than notional: on a warm
full-suite run both operations sit at **min â‰ˆ 190 ms, p50 â‰ˆ 192 ms** (runs D and E agree to 1 ms), and
`perf.measure` / `expectWithinBudget` are the instrument to compare against it.

Secret scan of the branch diff: clean (the only hits are the mission's own DoD line quoting the grep
pattern and a `Task-` substring). Zero-knowledge: the record line carries timings and counts only, and a
pin asserts it never emits an identifier or a vital. No attribution. Still no `lint` script in
`backend/package.json`, so that DoD line stays vacuous â€” recorded, not claimed. W4-D06's standing
open-handle guard is unaffected: `npm test` runs `globalTeardown`'s resource-delta check and both green
runs exited 0.

## W4-D08 evidence â€” the over-reported insert count (session 13)

Commits `b768acd` (helper), `1a1dc94` (mocks), `bfc5a85` (lanes + pins). Suite **172 suites / 2091 tests**
green, exit 0, twice back to back (120.2 s / 120.9 s). From 171/2073: +1 suite `wave4.ingestAccounting.test.js`
with 17 pins, +1 test appended to `sim.replay.integration.test.js`, **1 deliberate re-pin**. TDD evidence: the new
suite ran RED with **0 tests executed** (`Cannot find module '../app/services/wearable/insertAccounted'`) before any
implementation existed, then 13/13, then 17/17 once `mergeRejected` was pinned.

**The premise held exactly, and it was measured before it was fixed.** A throwaway probe against
mongodb-memory-server + Mongoose 9.7.1 â€” not documentation, not memory â€” established the real contract:

| call | returns | on one invalid row of three |
|---|---|---|
| `insertMany(docs, {ordered:false})` | an ARRAY of the inserted docs | resolves, length 2, no error, nothing logged |
| `insertMany(docs, {ordered:false, rawResult:true})` | `{acknowledged, insertedCount, insertedIds, mongoose:{validationErrors, results}}` | `insertedCount: 2`, one `ValidationError` carrying `.index` and `.errors[path].kind` |
| either, on a server-side E11000 | THROWS `MongoBulkWriteError` | unchanged by the flag |

So the driver always knew; no caller ever asked. `persistMetrics` returned `inserted: hrDocs.length`.

**The scope was two lanes wider than the row knew.** The row named `metricStore.persistMetrics`. Grep found the
same pair â€” `insertMany(docs, { ordered: false })` next to `count = docs.length` â€” hand-copied into
`appleHealth.ingestBatch` and `suunto.handleWebhook`, both returning `ingested: docs.length`. Fixing one and
queuing two would have left two live ingest paths with a known silent-data-loss bug and produced a third
hand-copy of the accounting, which is precisely the trigger/key divergence D11 was about. The accounting is
therefore ONE module (`app/services/wearable/insertAccounted.js`) that all three lanes call.

**Design decisions, and why the alternative lost:**

- **The reject vocabulary is closed, and that is a security decision, not a style one.** Mongoose's validator
  messages QUOTE the submitted value â€” measured, for a bad `source`: "*`fitbit` is not a valid enum value for path
  `source`*". Passing a message through would have put user-submitted data into a DTO, an HTTP response and a log
  line in one move. Only `path` and the validator `kind` ever leave the module. Worth recording the near-miss: for
  `heartRate` the message happens to be value-free ("encrypted numeric value out of range") because the validator
  runs AFTER the encrypting setter and so names ciphertext, not bpm â€” relying on that would have been relying on an
  accident of ordering in one validator, and it would break the moment a plain numeric field is added.
- **`kind` passes through verbatim (normalized to one token), rather than being mapped.** `required`, `enum`,
  `user defined` are already a closed, value-free vocabulary; a mapping table would be one more thing that
  silently falls out of date with the schema.
- **An unrecognised driver return counts as ZERO, never as `docs.length`.** The direction is the whole task: an
  over-report is silent data loss, an under-report is at worst a re-send, and the existing `source@recordedAt`
  dedupe makes a re-send idempotent. Pinned in both directions.
- **A server-side `MongoBulkWriteError` still throws.** W4-D08 is about SILENT loss; swallowing an infrastructure
  failure would trade one silent failure for another. Pinned as deliberate rather than left to inference.
- **`rejected.count` counts DOCUMENTS, `reasons` counts (path, reason) pairs.** A row failing two paths is one
  reject and two reasons â€” pinned, because the two numbers legitimately differ and a reader will assume they cannot.
- **The recompute enqueue deliberately still fires on the ATTEMPTED count.** It is a "new data arrived" signal, it
  is debounced and idempotent, and re-gating it on `inserted` would have been an unrelated behaviour change riding
  along on a reporting fix. Stated in a comment at the site so it reads as a decision.
- **`mergeRejected` lives in the helper, not in the replay harness.** A backfill is many batches and one answer;
  putting the fold at the call site would have been the same one-definition mistake at a smaller scale.

**The mocks were the reason this survived, so the mocks were fixed â€” not the assertions.** Four unit suites mocked
`BiometricLog.insertMany` to resolve `[]`, a shape that cannot express "one of these did not land".
`healthStore.test.js` duly went red at `expect(result.inserted).toBe(1)` the moment the count became truthful. That
assertion is CORRECT and was kept byte-for-byte; the mock now returns the real `rawResult` accounting object. That
is the open W4-D07 theme (a mock whose semantics diverge from the real adapter) closed for this seam. The new suite
is a REAL mongodb-memory-server integration on top, because Â§1 forbids a green mock for an integration boundary and
this bug lived exactly at that boundary.

**The one deliberate re-pin is the point of the exercise.** W4-002 pinned the defect on purpose ("MEASURED: one
out-of-range sample is dropped silently and `inserted` over-reports") so the fix would flip it loudly. It flipped:
same fixture, `report.inserted` now equals the row count instead of exceeding it, plus new assertions that the
reject is surfaced and that the serialized report contains no `340`.

**Both directions proven.** Stub-out: `inserted` forced back to `list.length` (the old lie) turned **6 tests RED
across both suites**; restored and re-verified green. The pins are load-bearing, not decorative.

Secret scan of the branch diff: clean (the only hits remain the mission's own DoD line quoting the grep pattern and
a `Task-` substring). Zero-knowledge: the new `[insertAccounted]` warn carries model name, counts and
(path, validator-kind) pairs only, pinned by two tests â€” one asserting it never contains the offending value, one
asserting it is SILENT on a clean batch; the new `rejected=` field on the `[healthBatch]` line is a count. **That
same log line was found to serialise numeric vitals already** (`profileMetrics=`) â€” pre-existing, untouched, queued
as W4-D10. No attribution. Still no `lint` script in `backend/package.json`, so that DoD line stays vacuous â€”
recorded, not claimed. W4-D06's open-handle guard and W4-D09's perf budgets both passed on each run.

## W4-D08 reopen + W4-D11 evidence â€” the unimported call and the missing linter (session 15)

Two rows, one session, deliberately: W4-D08's re-DoD point 3 asks for "the standing regression guard per this run's
precedent â€¦ see W4-D11, which is the guard for this class and should land in the same session". The bug and the control
that would have caught it ship together.

**Test-first, and the RED was the production defect itself.** `tests/wave4.ingestLanes.test.js` (16 pins) was written and
run BEFORE the one-line fix: **9 failed / 7 passed**, and 8 of the 9 failures are
`ReferenceError: insertManyAccounted is not defined` thrown from `app/services/wearable/suunto.js:50` by the REAL
production function. The 9th was a test-authoring error of mine, corrected before the production change ever landed:
`.lean({ getters: true })` does not run the decrypting getter, so the assertion compared 72 against ciphertext. After
adding `const { insertManyAccounted } = require('./insertAccounted');` â€” the entire product fix â€” **16/16 green**.

**The pins execute the real modules; nothing is mocked.** That is the whole point of the row. The only two suites
mentioning suunto `jest.mock` the entire module, so a stub answered for it and the lane itself was never run. Both
regression faces are now pinned: a webhook with valid samples, and one carrying **no heart-rate samples at all** â€” that
batch never reaches the database and it threw anyway, which is what proves the failure was unconditional rather than a
lossy-write edge case. The reject-accounting path the row demands is pinned on BOTH lanes (`hr: 340` â†’ `ingested: 2`,
`rejected.count: 1`, reasons `[{path:'heartRate', reason:'user-defined', count:1}]`), alongside the signature branch
(correct HMAC accepted; forged signature still 403 with nothing written), the adapter mapping (GYMâ†’strength, unmapped
sportâ†’unknown), the appleHealth 500/501 batch boundary, and a zero-knowledge pin per lane asserting no submitted vital
appears in the response.

**W4-D11 â€” the linter, and the honest count.** `eslint@10.8.1` + `globals` as devDeps, flat CommonJS config
(`backend/eslint.config.js`), `npm run lint`. `no-undef` is an **error**; `no-unused-vars` is a **warning** with an `^_`
ignore pattern, precisely so pre-existing debt in untouched files cannot fail a build and this task does not become a
repo-wide rewrite. Measured across the whole backend, 334 files: **0 errors, 22 warnings** â€” `app` 142 files (0/6),
`sim` 5 (0/0), `tests` 174 (0/16), `jest` 5 (0/0), `scripts` 8 (0/0). The 22 are 20 `no-unused-vars` plus 2 unused
`eslint-disable` directives (one at `integrationsController.js:760` for `no-await-in-loop` â€” evidence somebody once
intended a linter here). Nothing was mass-fixed; the count is recorded, exactly as the row's DoD asks. Repo-root
`scripts/wave4/` sits outside the backend package and is not covered â€” noted, not silently implied.

**The guard runs inside the suite, and it is load-bearing â€” proven by stub-out, twice.**
`tests/wave4.lintGuard.test.js` (10 pins) drives the real eslint CLI as a child process rather than the ESLint API: the
API resolves config and globs through dynamic `import()` and throws under jest's CJS VM ("A dynamic import callback was
invoked without --experimental-vm-modules"), and driving the CLI additionally means the gate and `npm run lint` cannot
drift apart. Stub-out check, run with the require deleted and the file restored afterwards (`git diff --quiet` verified):
the CLI reports `error 'insertManyAccounted' is not defined  no-undef` at exactly `suunto.js:50`, and the jest guard
turns **3 of its 10 pins RED** carrying that same `file:line [rule] message` as its failure output â€” so a future session
gets the finding, not a bare count. Guarding the guard: pins assert `no-undef` really is enabled at error level (via
`--print-config`, on both `app` and `sim`) and that the glob matched >100 files, so a config edit that disarmed the rule â€”
or a glob that silently matched nothing â€” fails loudly instead of going quietly green.

**Lock hygiene.** `npm install --include=dev --save-dev eslint globals` also pruned the optional/peer `gcp-metadata`
entry â€” the same unrelated bare-`npm install` artifact session 1 identified and restored. It was restored here too, so
the committed `package-lock.json` diff is **715 insertions, 0 deletions**: purely the eslint tree, nothing else.

**DoD.** Full suite **174 suites / 2117 tests (2116 passed + 1 todo), exit 0**, twice â€” 128.2 s and 124.1 s. Secret scan of
the branch diff: clean (the only hits remain the mission's own DoD line quoting the grep pattern and a `Task-` substring).
Zero-knowledge: no new log line, DTO or prompt carries a numeric vital, and the two new ZK pins assert it for both lanes'
responses. No attribution anywhere. And "lint clean" is, for the first time in this run, a claim backed by a control
rather than a footnote.

## W4-003 evidence â€” the pure core: telemetry DTO + anomaly filter (session 16)

Half an L task, split on purpose and declared up front in the row rather than discovered at the end: this
session is the PURE CORE (Â§M.1/M.2 math + contract + tests), session 17 is the WIRING (handler seam, live
persistence, D10). Nothing here touches a serving path yet, which is why the suite gained 82 pins and zero
re-pins.

**Test-first, and the RED moved three times.** The first RED is the honest one for new modules â€”
`Cannot find module '../app/agents/runtime/_shared/dto/telemetry'`, the whole suite failing to load. After the
implementation the second RED was **5 failed / 70 passed**, and the interesting part is what those five were:
four were MY FIXTURES being wrong, not the product. `flatSeries` built a bit-identical series and called it
"clean" â€” but forty identical integers at a 5 s cadence is a stuck sensor, which is precisely what the filter is
supposed to notice, so the fixture now dithers +/-0.5 bpm and a separate `heldSeries` exists for when a frozen
sensor IS the subject.

**The one genuine product defect the fixtures caught: the flatline span was too aggressive.** A first cut flagged
any identical run spanning > 30 s, which fired on quiet persona NIGHTS â€” devices report 1 bpm resolution and a
sleeping heart genuinely sits on one integer for a minute. Fixed by deriving the threshold instead of choosing
it: a value held past the wander process's own autocorrelation time `tau` (165 s) has outlived the thing that is
supposed to be moving it. Same envelope that gives `q`, one fewer magic number, and `does not flag degraded mode
anywhere on a clean stream` went green.

**Constants are DERIVED from a single physical envelope, and the derivation is pinned rather than the values.**
Â§M.2 specifies `R = 9` and "q tuned for ~30 s trend response". Taken literally that is a white-noise-acceleration
Q, whose level variance grows as `dt^3` â€” the wrong SHAPE for heart rate, whose short-term wander is a
mean-reverting process (sigma ~= 4 bpm, tau ~= 165 s) with variance growing linearly in `dt`. Tuned at 30 s it is
~37x too stiff at a 5 s cadence (steady-state gain 0.05 against 0.28). So Q carries two channels, both from that
one envelope: `q_level = 2*sigma^2/tau` and `q_accel = 3*q_level/T*^2` â€” the second IS the "~30 s response"
requirement stated exactly (at T* the trend channel contributes the same level uncertainty as the wander
channel). `trendVar0 = (sigma_z/T*)^2` and `flatlineSpanMs = tau` come from the same place. The tests assert the
RELATIONS, not the numbers, so a future tuning of sigma or tau cannot leave a stale derived constant behind.

**What that second term is actually worth â€” measured, after the first version of this note overclaimed it.** The
module header originally said the single-term filter "starts rejecting real physiology as outliers". It does not:
measured across all five personas the ACCEPTANCE rate is identical to two decimal places. What the term actually
buys is a consistent **~15% reduction in median tracking error** â€” athlete 0.33 -> 0.29 bpm, sedentary 0.49 ->
0.42, older-adult 0.38 -> 0.33, shift-worker 0.46 -> 0.39, stressed-professional 0.55 -> 0.48, with p90 improving
by the same fraction. The comment now says that instead. A good trade for one extra term; not the dramatic thing
it was first written as.

**THE FINDING OF THIS SESSION: a green suite did not mean the mechanisms were tested.** The stub-out battery this
run has used since session 9 was applied to all twelve mechanisms, and **four of them turned nothing red**:

- `q_level` â€” the wander-diffusion term above, i.e. the module's central mathematical claim, deletable with 76/76 still green.
- the **maturity** confidence factor on the accepted path â€” deletable, because the only pin that touched it was satisfied by the seed path's separate copy.
- the **slew gate** â€” fully shadowed by Hampel and the innovation gate, because my assertions said `expect(['slew','hampel','innovation']).toContain(reason)` rather than naming the gate.
- the **Hampel gate** itself, and separately its min-samples abstention.

None of these were fixed by writing a contrived test. Each was fixed by finding the region where the mechanism is
genuinely the only thing acting, by scanning rather than by assumption:

- `q_level` â†’ an **ablation control**. `createFilterState(metric, {qLevel: 0})` IS the single-term filter, and the test asserts the shipped config beats it on median error for every persona, by > 8%. This is why config overrides exist at all (W4-004's per-user envelopes are the second consumer); a constant nothing can falsify is a constant nobody is checking.
- **maturity** â†’ a reading arriving after 45 min of silence must be accepted but LESS confident than a mid-stream one, though both have near-zero innovation. That difference is the maturity term and nothing else.
- **slew** â†’ the first readings after a gap, where Hampel has aged out and abstained and the covariance has grown so the innovation gate is wide: +10 bpm in 1 s is rejected `slew`, the same +10 bpm over 5 s is accepted. The permissive `toContain` assertions were tightened to name the gate.
- **Hampel** â†’ scanned the (cadence, jump) grid for its unique region and found it: at an 8-12 s cadence a **+12 bpm** outlier is too slow for the slew gate (1.2 bpm/s) and inside 3 sigma of the innovation gate, but four times its neighbours' MAD. That is the real point of a model-free median test â€” it is TIGHTER than the model-based gate for moderate outliers, not a backup for it.
- **abstention** â†’ at a 20-25 s cadence the window holds three samples, and three samples put the scale floor at 3 bpm, so an un-abstaining Hampel would reject any move over 9 bpm. A +10 bpm rise over 20 s is 0.5 bpm/s: standing up. Accepted with the abstention, `hampel` without it.

After that work **all twelve mechanisms turn at least one pin RED when stubbed out**, verified individually with
the file restored and `git diff --stat` empty after each: slew (2 red), q_level (1), maturity (1), Hampel gate (1),
Hampel MAD scale floor (3), Hampel min-samples abstention (1), reseed hatch (1), innovation gate (2),
monotonic-time gate (2), future-timestamp gate (5), stale-timestamp gate (1), physiological range gate (5),
reject confidence decay (3), raw-window-fed-on-rejection (2).

**Cadence honesty, pinned as a measurement rather than hidden.** Two artifact fixtures, because the classes are
not all detectable at one cadence and pretending otherwise would have meant fudging a threshold. At a live 10 s
cadence spikes and double-counts are caught **100%** (64/64 and 41/41). At a 60 s cadence spikes are caught
**77.8%** â€” and that is pinned as `> 0.7 and < 1` with the reason: a body genuinely CAN climb 35 bpm in a minute
(0.58 bpm/s, inside the slew ceiling), so a gate tight enough to catch it there would reject real activations on
the watch lane. W4-009's dwell work is what closes that, not a tighter threshold. The mirror image is pinned too:
the generator's 3-7 sample flatline runs span only 20-60 s at the live cadence, shorter than tau, and are
deliberately NOT flagged there.

**Convergence, on personas AND on holdouts (Â§R.10).** Median absolute error against ground truth, 5 s cadence,
artifacts ON, startup transient excluded: athlete 0.29, sedentary 0.42, older-adult 0.33, shift-worker 0.39,
stressed-professional 0.48 bpm â€” all inside the +/-2 bpm DoD with an order of magnitude to spare, p90 <= 1.3.
Re-run against the two HOLDOUT personas, whose noise family is student-t rather than the OU the constants were
derived from, so the filter cannot pass by having been tuned to its own fixture. Clean-stream pass-through >= 99%
on every persona (the DoD figure), and degraded mode fires nowhere on a clean stream.

**Numerical hygiene (S8) and determinism (S9).** `now` is a REQUIRED parameter and the module throws without it;
there is no `Date.now()` or `Math.random()` anywhere in it. 300-round `fast-check` fuzz over
null/NaN/+-Infinity/strings/objects/extremes asserts the output is always finite, the level always inside the
physiological range, confidence always in [0,1], the reason always from the closed vocabulary, and that it never
throws. Every division is guarded (the only `dt` divisor is protected by the monotonic-time gate, and `S >= R > 0`
by construction), the predict horizon is clamped at 1 h so `dt^3` cannot lose precision, and the state is
JSON-round-trippable â€” pinned by feeding a revived state and the original the same reading and comparing results,
so it can live in Redis or a socket map in the wiring half.

**Zero-knowledge (Â§0.2.2).** The two new modules contain **no `console.` call at all** â€” they are pure. The single
telemetry string is counts and flags only: `[anomalyFilter] metric=heartRate v=1 samples=40 accepted=40
rejected=0 reseeds=0 flatlines=0 degraded=none`, with a pin asserting it never matches
`(hr|bpm|hrv|rhr|level|value)=`. The clean DTO is `z.strictObject` precisely because the field most likely to
appear by accident is a raw vital; the raw ingest shape is `z.object` (unknown keys dropped) because the socket
payload is attacker-controlled and every shipped client predates the contract. `tzOffsetMinutes` is bounded to
[-840, 720] (S6) in the schema. No mongoose import in the DTO, and the activity/source vocabularies are pinned
equal to BiometricLog's enums by a drift-guard test rather than by hope (the W4-D11 rule).

**Dependency hygiene.** `zod@4.4.3` added as a PROD dependency (the DTO runs in the serving path). `npm install`
pruned the optional/peer `gcp-metadata` lock entry again â€” the same artifact sessions 1 and 15 identified â€” so it
was restored and the committed `package-lock.json` diff is **11 insertions, 1 deletion**: purely the zod entry.

**DoD status.** Failing-test-first âœ“. Full suite **175 suites / 2199 tests (2198 passed + 1 todo), exit 0**, 138.1 s âœ“.
Lint **0 errors, 22 warnings** â€” the same 22 session 15 recorded, none from the new files âœ“. Secret scan of the
diff clean âœ“. Zero-knowledge âœ“. No attribution âœ“. **NOT done, and owed by session 17:** the handler wiring, live
`BiometricLog` persistence (D10), the S6 gates at the ingest seam, the S11 kill-switch env flag for the new
serving-path behaviour, and W4-D07's mock divergence, which lands in exactly the seam being wired.

## W4-003 evidence â€” the wiring half (session 17)

The second half of the L task: plug session 16's pure `anomalyFilter` into `handleBiometricReading`. Commit
`80db9ed`. Suite **176 suites / 2213 tests (2213 passed + 1 todo), exit 0**, twice â€” 132.5 s and 149.6 s. Lint
**0 errors, 22 warnings**, unchanged. Secret scan of the diff: clean. No attribution.

**What shipped, mapped to the row's four remaining items:**

1. **The debounce/trigger machinery consumes the filtered estimate (D6).** `_filterHeartRate(state, normalized,
   now)` runs every reading through `createFilterState('heartRate')`/`filterReading` (per-socket state, lazily
   created) and returns `{level, trend, confidence, accepted, degraded}`. `effectiveHR = filtered.level` replaces
   every use of `normalized.heartRate` in both lanes (immediate/watch and the 60 s debounce) â€” `state.stableHR`,
   `state.pendingHR`, the band-crossing comparison, all of it. `state.hrEwma`/`_updateEwma`/`HR_EWMA_ALPHA` are
   RETIRED (the module comment said W4-003 would replace them, and it does: the Kalman `level`/`trend` is now the
   D7 observation trace, and it is REAL evidence rather than a heuristic smoothing constant).
2. **D10 live persistence.** `_maybePersistLiveReading` writes an ACCEPTED, genuinely-timestamped reading to
   `BiometricLog` â€” the RAW device value (not the filtered estimate: this table is the ground-truth record, and
   baseline engines are the ones entitled to smooth it), real `activity` + `source` (not metricStore's hardcoded
   `'unknown'`). Throttled to `LIVE_PERSIST_MIN_INTERVAL_MS = 60_000` per socket (tracked on `state.lastPersistedAtMs`,
   keyed on wall-clock `now`, not the reading's own `recordedAt`) and deduped via a `BiometricLog.exists({userId,
   source, recordedAt})` pre-check reusing the batch lane's `source@recordedAt` convention, so a reconnect replaying
   the same reading cannot double-write. Reuses `insertManyAccounted` (W4-D08's helper) rather than a fourth
   hand-rolled `insertMany` call â€” the one-definition rule (D11) applied to a fourth lane. Fire-and-forget:
   `.catch(() => {})` at the call site, `try/catch` + `console.error` inside, matching every other side effect in
   this file (`recordServeSideEffects`'s own comment: "a failed side effect is reported but never fails generation").
3. **S6 at the live seam.** No new gate was written â€” `filterReading` ALREADY rejects `future-timestamp` and
   `stale-timestamp` (session 16's own module). Wiring it in is what makes S6 real at this seam: a rejected reading
   never becomes `state.stableHR`, is never persisted, and (on the very first reading for a fresh socket, the only
   case where nothing has been seeded yet) `filtered.level` is `null` â€” the handler acks the well-formed payload and
   returns before touching any HR-dependent state, rather than fabricating a baseline from bad data.
   `tzOffsetMinutes` plumbing (accepting it on the socket event itself) is explicitly W4-004 scope per the mission
   text and was not pulled forward; the DTO already validates the bound and is pinned by `anomalyFilter.test.js`.
4. **S11 kill-switch.** `WAVE4_ANOMALY_FILTER_DISABLED`, same forgiving parse as `WAVE4_RECAL_STATE_TRIGGER_DISABLED`
   (`=1`/mixed case/etc. all count as ON). Set â†’ `_filterHeartRate` short-circuits to a passthrough result (raw value,
   confidence 1, no filter state created) AND `_maybePersistLiveReading` no-ops (`filtered.passthrough` gates it) â€”
   one flag restores BOTH halves of W4-001-era behaviour, not just the trigger half.
5. **W4-D07 closed.** `biometricHandler.pipeline.test.js`'s mocked adapter now derives `recordedAt` from
   `raw.startTimeLocal` exactly the way the real `fromGarmin` does (`new Date(raw.startTimeLocal)`), instead of
   omitting the field outright. Every existing fixture that does not set `startTimeLocal` still gets
   `recordedAt: undefined` â€” byte-identical to before, which is why this file's other ~129 pins needed zero changes â€”
   and a NEW pin (`rejects an unparseable provider timestamp end-to-end`) proves a garbage `startTimeLocal` is
   rejected by the REAL `isValidReading` Date check through this suite for the first time.

**The pass-through path is deliberate, and it is why the blast radius stayed small.** `_filterHeartRate` falls back
to the raw value (unfiltered, confidence 1, no persistence) when `normalized.recordedAt` is not a usable `Date` â€”
which is UNREACHABLE through any of the three real adapters (they always construct `new Date(raw.something)`, so the
result is either a valid Date or an Invalid one, and an Invalid Date is already rejected by `isValidReading` before
the filter ever runs). It exists purely for a caller whose adapter output omits the `recordedAt` key entirely â€” which
is exactly what `biometricHandler.pipeline.test.js`'s pre-existing mock did for ~130 tests, none of which name
timestamps in their premise. Discovered by RUNNING the wiring, not by design up front: the first pass wired the
filter unconditionally and broke every multi-reading test in that file (a `dt` of "however many microtasks between
two `await`s" is not a sampling interval), which is what exposed that the mock's *entire* premise was "the device
timestamp doesn't exist for these tests" â€” matching W4-D07's own diagnosis one layer deeper than its DoD asked for.

**The OTHER real blast radius: five test files carried FIXED historical `recordedAt` fixtures (`2026-01-01`),
genuinely >90 days stale against a real clock now that S6 is wired.** Found by running the suite, not by
inspection â€” `wave4.bugfix.test.js`, `websocket.test.js`, `wave4.openHandleGuard.test.js` all failed identically
(`stableHR` stuck `null`, no debounce armed) until fixed. `wave4.bandHysteresis.test.js` and
`sim.replay.integration.test.js` already used clock-relative dates from earlier sessions and needed no fixture
change. The fix in all three broken files is the SAME pattern, applied consistently rather than hand-tuned per
file: `RAW_BASE_MS = Date.now() - 3*3600_000` (anchored once at module load, safely inside every S6 window for
the whole file's call volume) plus a per-call monotonic step. **The step size (6 minutes) is not arbitrary â€” it is
the anomalyFilter module's OWN documented claim, exploited rather than fought:** at watch cadence the module's
header says the Kalman gain is "essentially pass-through" (K â‰ˆ 0.998), so spacing these legacy fixtures at that
cadence keeps them testing the debounce/trigger mechanics they were written for, not the filter's math. Measured,
not assumed: three assertions across `wave4.bugfix.test.js`/`websocket.test.js` needed `toBeCloseTo`/`toBeCloseTo`-
style tolerance instead of exact equality (e.g. `pendingHR` after a 70â†’85 jump lands at `84.99`, not bit-exact `85`)
â€” recorded as deliberate re-pins, not silently loosened.

**Two W4-002 "TODAY" pins flipped, exactly as the row from session 16 forecast â€” both re-verified as REAL flips,
not renamed no-ops.** `sim.replay.integration.test.js`, `FIXED: a future-dated reading still ACKS ... but never
confirms a heart rate (S6)`: the ack assertion is UNCHANGED (a well-formed payload still acks â€” that was always
correct and stays correct), but a new assertion â€” `state.filterState.rejectedCount > 0` â€” proves the reading was
actually rejected downstream, which is the part W4-003 was scoped to close. `FIXED: the live socket lane now
persists accepted readings (D10)`: was `toBe(0)`, is now `rows.length > 0` AND `<= events.length` (the throttle),
with real (non-`'unknown'`) activities and the real source â€” verifying the persistence contract, not just its
existence.

**One test needed a genuine tolerance widening, not just a numeric-format change, and it is recorded as a finding
rather than a fudge.** `the served-band latch holds through a resting oscillation across the 90 cut` (a persona
whose HR sits right on the 90 bpm cut for a full simulated day) went from `<=4` to `<=5` serves â€” MEASURED,
deterministic (seeded), reproduced on request. Root cause: the trigger now compares the FILTERED trajectory, which
carries its own level/trend memory and is not bit-identical to the raw series: for a signal hugging a decision
boundary, that memory can move exactly one crossing to a different 5-minute sample than the raw values alone would
have produced. The property the test actually guards â€” "bounded, nowhere near the dozens of serves an unlatched
trigger would produce" â€” still holds at 5; only the exact boundary count shifted, which is the honest cost of
introducing real signal processing at a boundary this task was told to leave semantically unchanged elsewhere.

**Verification, not narration.** `wave4.liveWiring.test.js`'s 14 pins were stub-out checked as a batch: temporarily
replacing `_filterHeartRate`'s call with a hardcoded passthrough result turned 7 of the 14 RED (the ones that assert
S6 rejection, filtered-value seeding, and persistence â€” i.e. everything that depends on the filter actually running),
while the other 7 (kill-switch behaviour, which is SUPPOSED to look like passthrough) stayed green â€” confirming the
green 7 are correctly independent of the stub rather than accidentally always-passing. File restored and re-verified
green after.

**Design decisions, and why the alternative lost:**

- **Persisted value is RAW, not filtered.** The table is the ground-truth device record; a future baseline engine
  (W4-004) is the one entitled to decide how to smooth it, and persisting an already-smoothed number would silently
  bias every downstream consumer of "what did the device actually say" with no way to recover the original.
- **Throttle keys on wall-clock `now`, not the reading's own `recordedAt`.** A backfill/reconnect burst could carry
  readings whose `recordedAt` values span minutes while all arriving in the same instant; throttling by arrival time
  bounds write RATE (the stated goal â€” protecting BiometricLog from a live firehose), while throttling by sample time
  would not.
- **Dedupe is a pre-check (`exists` then `insertMany`), not an atomic upsert.** `heartRate` is `encryptedNumber` (a
  setter-driven field), and Mongoose setters do not run on `findOneAndUpdate($set)` (Â§0.2 hard constraint #2) â€” an
  upsert would need to hand-encrypt, which is a second definition of "how BiometricLog.heartRate gets encrypted" the
  codebase does not otherwise have. The race window (check-then-insert on a throttled, â‰¤1/min-per-socket path) is
  accepted rather than engineered away: a duplicate row here is an extra encrypted history point, not a correctness
  or security defect, and engineering it out would have meant a second encryption path for a live-only edge case.
- **`ANOMALY_FILTER_FLAG` is one switch for both the filter AND persistence**, not two independent flags. S11 asks
  for "restoring prior behaviour" â€” prior behaviour had neither, so a caller reaching for the escape hatch during an
  incident should get the WHOLE pre-W4-003 lane back, not a half-disabled state nobody tested.

Secret scan of the branch diff: clean. Zero-knowledge: the one new log line (`live persistence failed:`) carries
only `e.message` (a Mongoose/driver error), never a vital â€” pinned. No attribution.

## W4-004 evidence â€” the pure core: VitalSample, baselines & chronobiology (session 18)

First half of an L task, split the way W4-003 was: this session landed the STORAGE + the two PURE ENGINES,
and the next session lands the wiring (`baselines.js` superset blob + stale-while-revalidate, `metricStore`
VitalSample writes, `adapter.js` dormant lanes, `tzOffsetMinutes` plumbing, `MedicalProfile.hrZones` via
`doc.save()`, cache-compat tests). Commits `9f042b8` (VitalSample + S5), `6ad277d` (engines), `f394e3e`
(erasure attack test).

Suite **179 suites / 2357 tests (2356 passed + 1 todo), exit 0** â€” established by repetition per Â§0.4 S1a,
not by one lucky run: two consecutive full runs, both 179/2357, exit 0, at 190.9 s and 198.4 s.
Lint **0 errors, 22 warnings** â€” the
identical count sessions 15â€“17 recorded, i.e. ~2000 new lines added none. Secret scan of the diff: clean.
No attribution. Zero-knowledge: neither engine logs at all (pinned by a `console.` grep guard in
`chronobiology.test.js`), and the emitted blob is pinned to carry no sample, no timestamp, and < 6 KB.

**Test-count arithmetic, and a correction to session 17's.** New pins: `vitalSample.integration.test.js` 29
+ `baselineEngine.test.js` 63 + `chronobiology.test.js` 44 = 136, plus 7 appended to existing suites
(`shadow.qa4.crypto` 9â†’11, `wearableErasure` 14â†’16, `wearableErasure.integration` 2â†’5 â€” counted by
`it(`-block diff against `54f868d`, not estimated) = **+143**. That lands on 2357 only if the prior total was
2214, not the 2213 recorded in `testBaseline`. It was: session 17's own evidence text says "+1 suite
`wave4.liveWiring.test.js` with 14 pins, +1 pin appended to `biometricHandler.pipeline.test.js`" and then
computes "2199 + 14 = 2213", dropping the +1 it had just described â€” and its session-log line says "15 new
pins" outright. So **the real W4-003 baseline was 2214**; 2214 + 143 = 2357 exactly. An arithmetic slip in a
recorded number, not a behaviour change, corrected here rather than left looking like an unexplained test.

**RED first, every time.** The VitalSample model was written FIRST specifically so the pre-existing
`shadow.qa4.crypto` completeness guard would fail on it â€” it did, naming the model in two assertions, before
a single line of erasure code was written. Both engines were `Cannot find module` before they existed.

### What landed

1. **`app/models/VitalSample.js`** â€” encrypted, metric-typed time series (hrv, restingHeartRate,
   respirationRate, spO2, bodyBattery, stressLevel), AAD-bound `encryptedNumber` value, TTL 90 d, compound
   index `{userId, metric, recordedAt}`, optional `tzOffsetMinutes` (D13), `v` version field (S15). Range
   validation is METRIC-AWARE (one field-level min/max cannot say "25â€“150 bpm but 0â€“100 %"), so it runs in a
   `pre('validate')` hook reading through the decrypting getter. Garmin's âˆ’1/âˆ’2 "unmeasurable" stress
   sentinels are rejected as data rather than stored (D16). The metric vocabulary is pinned equal to the
   telemetry DTO's `METRICS` minus `heartRate`, so the two cannot drift apart silently.
2. **S5 registration, in the same commit that created the collection** â€” `services/privacy/erasure.js`,
   `scripts/gdpr-delete.js` (both the dry-run count and the delete path), `services/privacy/userDataExport.js`
   (Art.15), `services/privacy/wearableErasure.js` (source-scoped, per-provider), and the retention note in
   the model. **The completeness guard was EXTENDED**, per S5: it previously covered only `erasure.js` and
   `gdpr-delete.js`; it now also asserts every `userId`-carrying model is serialized by the GDPR export, and
   that every WEARABLE-derived model (auto-discovered as "has userId AND carries `'garmin'`") is deleted
   source-scoped by per-provider erasure â€” with the `{userId, source: provider}` filter pinned by regex, so a
   blanket `deleteMany({userId})` in that file fails the guard. `purgeWearableData` also now counts VitalSample
   rows when deciding whether the aggregated MedicalProfile is orphaned; counting only BiometricLog would have
   deleted a profile still backed by another wearable's vitals.
3. **`agents/runtime/physiology/baselineEngine.js`** (A1) â€” pure, clock-free. Kills D1/D2/D14/D15.
4. **`agents/runtime/physiology/chronobiology.js`** (A2) â€” pure, clock-free. Kills D13.

### The three design decisions worth reviewing

**(a) `n` counts DAYS, not samples.** A night of 1-minute samples is 360 numbers and nowhere near 360
independent observations (the anomaly filter measured the wander's autocorrelation time at ~165 s). Every
estimator collapses each LOCAL day to one value first, then does statistics across days. Without this, any
confidence expression overstates precision in the one direction that matters â€” overconfidence.

**(b) DELIBERATE, DERIVED DEVIATION FROM Â§M.4's LITERAL k VALUES â€” flagged for review.** Â§M.4 lists
pseudo-counts k = 20 (RHR) / 15 (HRV) / 10 (hour bins). Those are right for `n` = SAMPLES. With `n` = DAYS
(decision a) they are far more aggressive than intended: an athlete with a REAL 85 ms HRV and a full month of
data would still be dragged to 71.7 ms â€” a third of the way back to the population constant D1 exists to
escape. Rather than pick a different round number, `fuse()` (the multi-source generalisation that `shrink()`
is the one-source special case of â€” pinned as reducing to Â§M.4 exactly) takes its weight from the variance
decomposition that empirical-Bayes shrinkage IS: the optimal weight on n observations is
`n / (n + Ïƒ_withinÂ² / Ïƒ_betweenÂ²)`, and since a source already enters as `n/Ïƒ_wÂ²` and the prior as `k/Ïƒ_bÂ²`,
those two agree exactly at **k = 1** â€” the population mean carries the information of ONE observation drawn
from the between-person distribution, which is precisely what it is. Â§M.4's k values are still used VERBATIM
by `shrink()`, for the spread estimates and the hourly table, where the count unit and the prior are the ones
Â§M.4 assumes. Every POPULATION entry therefore carries two spreads (`scale` = between-person SD, `spread` =
within-person daily MAD) and the code refuses to conflate them.

**(c) The resting rate is the TROUGH, wherever it falls.** Â§A1 specifies a nocturnal 00:00â€“06:00 window. That
window is a proxy for "asleep" and only works for a day-active person â€” the shiftWorker persona peaks at
23:00, so its nocturnal window is its most ACTIVE period. Each day therefore contributes
`min(P10 over the nocturnal window, P10 over the day's non-exercise samples)`. Measured, not asserted (30
simulated days per persona, every row forced to `activity: 'unknown'` â€” i.e. exactly what the batch lane
actually writes today):

| persona | truth RHR | min-based err | nocturnal-window-only err |
|---|---|---|---|
| athlete | 48.0 | **1.28** | 1.28 |
| sedentary | 72.0 | **1.82** | 1.82 |
| olderAdult | 65.0 | **1.90** | 1.90 |
| stressedProfessional | 70.0 | **2.11** | 2.11 |
| shiftWorker | 68.0 | **1.01** | 1.89 |

It costs a day-active user *nothing* (identical to 9 decimal places â€” their whole-day trough IS their
nocturnal trough) and is strictly better for the one persona whose clock is shifted. That table is now the
test: an A/B run through the SAME function (feeding only 00:00â€“06:00 samples makes each day's whole-day pool
identical to its nocturnal pool, so `min()` collapses to the window estimator exactly).

Also worth recording, because the mission's Â§A1 wording says "âˆª live `activity==='resting'` rows": all three
specified input streams DO feed the estimate, but they are organised as TWO estimators, not three. The
resting-labelled rows are a strict subset of the non-exercise pool the trough estimator already consumes, and
entering them twice would manufacture confidence rather than add information.

### Four defects the tests found in this session's OWN code

1. **`pre('validate', function (next) { â€¦ next(); })` throws on every write.** Mongoose 9 invokes document
   pre-hooks with NO callback argument, so `next is not a function` fired on all 21 write-path pins. Caught by
   the R9-mandated round-trip suite on its first run; the hook is now synchronous.
2. **`Number(null) === 0`, twice.** Both engines' `finite()` helpers coerced `null`/`false`/`''` to a real 0,
   so a missing sleep stage became "0 minutes of deep sleep", a missing hour became 00:00 (silently putting
   every unknown-hour user in the middle of the night, at alertness 0.146 instead of the neutral 0.5), and
   `median([NaN, Infinity, null, 'x'])` returned 0 rather than null. This is the exact trap
   `services/biosonic/baselines.js` documents in a comment; both copies now reject those shapes before coercing.
3. **Least squares is not robust, and this data has a predictable contaminant.** A 45-minute workout most
   evenings can be the MAJORITY of an 18:00 bin's samples, so even that bin's median is the workout rather
   than the rhythm, and one such bin visibly drags a 3-parameter cosinor. `fitCosinor` now runs ONE Hampel
   reweighting pass over the residuals (drop > 3 robust sigmas, refit once â€” capped at one pass so cost and
   determinism stay bounded).
4. **The first shiftWorker test was not falsifiable.** With the daily trough stubbed out, it still passed:
   persona noise makes the window's P10 forgiving enough to land inside the Â±3 bpm tolerance. It was rewritten
   as the A/B above only after the stub-out battery proved the original claim was untestable as written.

### Stub-out battery (mechanisms proven load-bearing, not decorative)

| mechanism | stubbed to | result |
|---|---|---|
| VitalSample in `userDataExport.COLLECTIONS` | removed | Art.15 guard RED |
| VitalSample in `wearableErasure.purgeWearableData` | `{deletedCount: 0}` | T3.2 guard RED |
| `min(nocturnal, dayTrough)` | nocturnal window only | shiftWorker A/B RED |
| cosinor robust reweighting | `kept = points` | contaminated-bin pin RED |
| `finite()` null guard | pre-fix code | 2 primitive pins RED |
| Â§M.4 k = 15 for the HRV central estimate | pre-fix code | HRV personal-baseline pin RED, off by 14.3 ms |

### Deliberate re-pins

One assertion changed meaning: `tests/userDataExport.test.js` "reuses the full account-erasure collection
list (completeness)" gains `'vitalsamples'`. The export list is ten collections now, not nine â€” by design,
and the guard extension above is what makes that impossible to forget next time.

Two mocked suites gained the new model without any assertion changing meaning (`accountDeletion.test.js`,
`shadow.auth.test.js`'s ATTACK-6 model lists). The `shadow.auth` one was a genuine RED surfaced by the full
suite rather than a precaution: that attack test drives the REAL `eraseUserChildData` with string userIds, so
the unmocked VitalSample threw a `CastError` and the "leaves ZERO trace" attack aborted before asserting
anything. It now pushes and asserts VitalSample rows like every other child collection, so the attack
genuinely covers the new collection instead of stepping around it.

### What is NOT done (owed by the wiring half)

`baselines.computeBaselines` still returns the old `{rhrMedian, rhrMAD}` shape â€” **D1 is not yet fixed in the
serving path**, only in the engine that will feed it. Nothing writes VitalSample rows yet. `adapter.js`
dormant lanes (D16 stressLevel, steps) untouched. `tzOffsetMinutes` is accepted by the model and by both
engines, but nothing on the ingest path emits it yet. `MedicalProfile.hrZones`/`maxHeartRate` still dormant.
Prod index builds for VitalSample are a Pause & Guide action â€” HITL H4.


| 1 | 2026-08-19 (session 8, `exec`) | run start â†’ `d0b94d9` â€” all 24 branch commits; tasks W4-000, W4-001, W4-D01, W4-D02 | **166 suites / 1865 tests green, 75.8 s, exit 0** â€” exactly the recorded baseline | **4 verified / 0 reopened / 2 queued** (+ W4-D04 closed by ruling) | Product code is sound and the DoD claims hold; the two things that did NOT hold were both about *guarding* the work â€” an unguarded band-boundary flap (W4-D05) and a re-opened open-handle leak that `--forceExit` hides (W4-D06) |
| 2 | 2026-08-19 (session 14, `exec`) | `23c652b` â†’ `962acb2` â€” 25 commits; tasks W4-D05, W4-D06, W4-002, W4-D09, W4-D08 | **172 suites / 2091 tests (2090 passed + 1 todo), exit 0, 122.2 s** â€” exactly the recorded baseline | **5 verified / 1 reopened / 1 queued** | The suite is green and one production lane is dead: W4-D08 added a call to `insertManyAccounted` in `suunto.js` without the import, and every test that touches suunto mocks the module â€” so a `ReferenceError` on every Suunto webhook shipped into open PR #179 unnoticed |
**R2 â€” how the four `done` tasks were verified (not taken on trust).** All ten W4-001 fixes were confirmed present in
source, not just in prose: D5 axis order at `geminiEngine.js:206`; D9's shared `hrRange.isPhysiologicalHR` imported by both
the socket handler and `integrationsController`; D3's `UNLABELLED_RESTING_HR_CEILING = 110`; D4 as `clamp01(moodValence +
min(0.1, 0.15Â·S))` â€” a bias, floor genuinely gone; D14's `CONFIDENCE_STEP = 0.175` landing 4 missing groups exactly on the
0.3 floor; D7's EWMA + the deleted `stableHR` write on the sub-threshold path; D8's in-window `pendingHR` refresh; D11's
`_shouldRecalibrate`; D17's per-source bounded affinity. **Stub-out check:** reverting D5's axis order turned 2 pins RED
(`Tests: 2 failed, 32 skipped, 34 total`), then the file was restored â€” the pins are real, not decorative. `state-guard.js`
CLI on the live repo: `OK 20 rows, no regressions`. `reflect-marker.js check`: `DUE missing`, correct. PR #179 verified OPEN,
head `feat/intelligence-wave` â†’ base `main`, 24 commits matching the branch, no attribution in the body. W4-D03's premise
re-checked against the diff and **confirmed accurate** â€” the numeric HR in that DEBUG line is pre-existing; W4-001 only
swapped the adjacent `hrJumped=` field for `bandChanged=`.

**R3 â€” constraint audit: clean.** `adr0012.tripwire.test.js` green (7 pins); targets remain a strict superset â€” all 13
contract keys still emitted by `translate()`; regulator-not-mirror satisfied (D4 verified as a bias); Art.9 consent gate
intact in `integrationsController`; zero-knowledge holds â€” the only numeric vital in any new log line is the pre-existing
DEBUG-gated one already tracked as W4-D03; secret scan of the branch diff clean (the sole hits are the mission's own DoD
line quoting the grep pattern and a `Task-` substring); no attribution in any commit, the PR body, or product code.
Numerical hygiene spot-checks passed: `_robustZ`'s divisor can never be 0 (`finite(mad) > 0 ? mad : fallback ?? 3`), and
D17's position bonus is `total > 0`-guarded.

**One judgement call recorded for W4-015's REPORT (deliberately NOT queued as a task).** Â§0.4 S11 reads "every serving-path
change ships an env escape hatch", yet Â§3's W4-001 spec asks for no flags and S11's named inventory maps its four flags to
the *later* engine tasks (005/006, 007, 008, 009). W4-001 shipped D3/D4/D11/D17 â€” real serving-path behaviour changes â€” with
no hatch. Only the D11 one is worth a flag (it governs recalibration frequency, i.e. serve churn and Spotify API cost), and
it is folded into W4-D05 rather than duplicated. A hatch for D3/D4/D17 would exist only to restore *known-defective*
behaviour ("workouts read as maximal stress"), which nobody would switch on; padding the queue with it would dilute real
signal per R6. S11's "full inventory in WAVE4_REPORT" stays W4-015's job.

### Reflection #2 (session 14) â€” evidence

**R1 Â· Health check.** Full suite `cd backend && npm test`: **172 suites / 2091 tests, 2090 passed + 1 todo, exit 0, 122.2 s** â€”
matches the recorded `testBaseline` exactly, zero failing assertions. Tree clean apart from the standing intentional
`mobile/src/health/config.ts` (S2, session 1). `origin/main` still `1a1657e` = STATE's `lastMainSha` (no drift), and
`feat/intelligence-wave` is 0 ahead / 0 behind `origin` â€” S3's offsite backup is real, not assumed. **Lint: there is no linter**
(no config, no dep, no script) â€” the DoD line is vacuous, which is now queued as W4-D11 rather than left as a footnote.

**R2 Â· Verifying the interval's claims â€” one of the five did not hold.** Four verified against source and by execution:
W4-D05's `HR_BAND_RELEASE_MARGIN = 6`, `BAND_LOWER_CUT` one-definition export, `state.servedHR` latch and
`WAVE4_RECAL_STATE_TRIGGER_DISABLED` all present â€” and **stub-out checked**: setting the margin to 0 turned **8 of the 23**
`wave4.bandHysteresis.test.js` pins RED, then the file was restored (`= 6` re-verified), so those pins are load-bearing rather
than decorative. W4-D06's `_resetDebounceState`, `jest/globalSetup|globalTeardown|openHandleGuard|openHandleResultsProcessor`,
frozen-empty `IGNORED_TYPES`, `DRAIN_MS = 250` and the `jest` key in `package.json` all present. W4-002's five `sim/` modules,
two holdout personas and the `fast-check` devDep (`^4.9.0`) all present. W4-D09's `perfBudget.js` min-of-N helper present and
numerically clean (empty/non-finite samples throw explicitly; nearest-rank percentile with clamped indices â€” no NaN at n=1).
`adr0012.tripwire.test.js` green, 7 pins.

**W4-D08 is REOPENED â€” its own fix crashes the third lane.** The row claimed all three ingest lanes now "report what the
database took". `suunto.js:50` calls `insertManyAccounted` and the file has no `require` for it. Not inferred â€” the real
production function was executed: `ReferenceError: insertManyAccounted is not defined`, and because identifier resolution is
unconditional, a webhook carrying **zero** HR samples throws just the same. `git log -L 50,50` pins the introduction to
`bfc5a85` (W4-D08's own implementation commit); the version at `bfc5a85^` worked. **Why 2091 green tests said nothing:** the
only two suites mentioning suunto `jest.mock` the entire module, and `wave4.ingestAccounting.test.js` exercises
`insertManyAccounted`/`mergeRejected`/`persistMetrics` with zero mentions of suunto or appleHealth. Both lanes W4-D08 touched
outside metricStore are executed by no test at all â€” the appleHealth import happens to be correct, which is luck, not coverage.
This is R2's thesis in one artifact: a green suite is not evidence, and the run's main failure mode is a task that *reports*
success.

**R3 Â· Constraint audit: clean.** No attribution in any of the 25 commits or in the diff. Secret scan of `23c652b..HEAD`: the
only two hits are STATE prose quoting the mission's own grep pattern. Art.9 consent gate untouched â€” the sole
`integrationsController` change this interval is the added `rejected=<count>`, a count with no values. Zero-knowledge holds for
the new code: the `[insertAccounted]` warn carries model name, counts and (path, validator-kind) pairs, never a submitted
value; the pre-existing numeric-vital log lines remain tracked as W4-D03 (DEBUG-gated) and W4-D10 (the wider, ungated
`profileMetrics=` serialisation on the same `[healthBatch]` line, re-confirmed accurate this pass). Targets contract untouched
this interval â€” no `translate`/`targetsBuilder` edits; `moodDescriptors` only gained the `BAND_LOWER_CUT` export. S11
kill-switch present for the one serving-path change that warranted one (W4-D05).

**R4/R5 Â· The bug class was measured, not guessed.** Rather than stop at one finding, the question "is this a class?" was
answered with a scope analysis (`@babel/parser` + `@babel/traverse`, `ReferencedIdentifier` with no binding, Node globals
excluded) over **all 147** production files in `backend/app` + `backend/sim`: **exactly one** undefined identifier exists
repo-wide â€” `suunto.js:50`. So the defect is live but isolated, and no sibling hunt is owed. What the exercise did expose is the
missing control: the check that found it in one second is `no-undef`, and this repo has no linter, so Â§2 step 7's "lint clean"
has never gated anything. Queued as W4-D11 (one row, not five â€” this is one theme).


## Archived 2026-08-20 (reflection #5, session 28)

> Four completed-task evidence sections moved verbatim out of STATE (W4-004 wiring, W4-005,
> W4-006 pure core, W4-006 seam). All four tasks are `done`; their cluster notes also live in PR #179.
> Backlog rows were again NOT archived - `state-guard.js` still refuses them (W4-D16, still open).

## W4-004 evidence â€” the wiring half: D1 reaches the serving path (session 20)

Second half of the L task, split the way W4-003 was. Commits `143632d` (W4-D13), `ea447a2` (ingest),
`b6118a3` (baselines). Suite **182 suites / 2416 tests (2415 passed + 1 todo), exit 0** â€” two consecutive
full runs at that exact count, per Â§0.4 S1a. Lint 0 errors / 22 warnings. Secret scan clean. No attribution.

**The headline, stated precisely.** After session 18 the engine existed and nothing called it:
`computeBaselines` still returned `{rhrMedian, rhrMAD}` and `translate()` still z-scored every user's HRV
against the population constant `{45, 8}`. It now returns the SUPERSET blob, so **D1 is fixed on the serving
path with zero `translate()` edits**, exactly as the mission designed. Pinned by the kill shot
`D1: a user with real HRV history is scored against THEIR median, not the {45, 8} constant`.

### What landed

1. **`baselines.computeBaselines` delegates to `baselineEngine.computeBaselineBlob`** â€” pages BiometricLog
   (now carrying `recordedAt`/`activity`/`tzOffsetMinutes`, not just the value) AND VitalSample through the
   decrypting getters, reads `MedicalProfile.maxHeartRate`, resolves the user's habitual timezone as the
   MODAL non-null offset, and returns the superset. ONE ADR-0005 audit line still covers the whole bulk
   decryption, count-only.
2. **Stale-while-revalidate (`peekBaselines`)** â€” `FRESH_TTL_S` (6 h) and `CACHE_TTL_S` (24 h) are now two
   different ideas. Previously the key simply EXPIRED at 6 h, so the first generation in every 6-hour window
   ran with no personal baseline at all; a stale blob is now served and refreshed behind the request.
3. **`metricStore` writes VitalSample rows** â€” the fuel D1 needs. Allowlist `VITAL_METRICS_PERSISTED`
   (`hrv`, `restingHeartRate`), `metric@source@recordedAt` dedupe (S6), truthful `insertManyAccounted`
   reporting (W4-D08), and best-effort isolation so a vitals failure never costs the heart-rate ingest.
4. **`tzOffsetMinutes` end to end** â€” both batch lanes (health-store passthrough, Garmin's
   `startTimeOffsetInSeconds`) and all three LIVE normalizers, plus a new optional
   `BiometricLog.tzOffsetMinutes`. Absent stays **null, never 0** â€” 0 is a real timezone, and coercing would
   silently place every legacy client in UTC. Out-of-band offsets are dropped, not clamped (S6).
5. **D16 + steps, dormant** â€” `stressDetails` no longer discards `timeOffsetStressLevelValues`, and `dailies`
   can emit `steps`, both behind `WAVE4_CONSENT_V2_METRICS` which is **empty by default**. Garmin's -1/-2
   "unmeasurable" sentinels are rejected as data. Â§0.2.3 holds: collection is NOT widened.
6. **Karvonen zones + HRmax written back** via `doc.save()` (never `findOneAndUpdate($set)` â€” R9's encryption
   trap), from the stateVector worker, on the same blob it just cached. A user-provided max is never
   overwritten by an estimate.
7. **S11 kill-switch `WAVE4_BASELINE_ENGINE_DISABLED`** restores the pre-delegation blob â€” legacy keys only,
   MIN_SAMPLES cliff back, VitalSample never touched.

### The judgement call worth reviewing: zero evidence still returns null

The engine always returns a NUMBER â€” with no data that number is the population prior, tagged `confidence: 0`.
Handing that straight to `translate()` through the legacy `rhrMedian` key would have been a real regression,
and the full suite caught it: **ATTACK 2** (`shadow.fullSystem`) asserts an all-workout history "yields null
baselines, never a fabricated resting HR". Checked at the consumer rather than argued about:
`translate()`'s `restingElevation` passes `fallback = null`, so a null baseline makes the resting-elevation
stress term ABSTAIN, while `62` would have scored the user against a stranger's physiology.

So the legacy keys keep their exact MEANING, not merely their names: **no non-exercise observation at all â†’
`rhrMedian`/`rhrMAD` stay null**, and the superset keys still carry the prior plus `coverage.rhrDays: 0` for
engines that want one. This is NOT the cliff D15 killed â€” that cliff discarded nine perfectly good readings
for not being ten. One resting day now yields a shrunk, low-confidence estimate; only genuine zero yields null.

### Stub-out battery (mechanisms proven load-bearing, not decorative)

| mechanism | stubbed to | result |
|---|---|---|
| the whole engine delegation | forced `_computeBaselinesLegacy` | **7 pins RED** incl. the D1 kill shot |
| `VitalSample` row in the retention table | removed | 3 pins RED (W4-D13 guard) |
| `VITAL_METRICS_PERSISTED` | `+ 'spO2'` | 4 pins RED across 2 suites |
| D2/D3 persona (first draft) | â€” | pin passed against the OLD estimator â†’ persona rewritten so the nocturnal trough is the MINORITY of the day; the old estimator now returns 73 where < 60 is required |

### Two defects this session's tests found in this session's own code

1. **`metricStore.test.js` was silently exercising the FAILURE path.** The new VitalSample write ran against
   an unmocked model, the best-effort catch swallowed the CastError, and the suite stayed green â€” the exact
   false-green class this run keeps finding. The model is now mocked there and the vital write is asserted.
2. **A "best-effort" call that was not.** `stateVector.worker` called `persistDerivedProfile` with a comment
   promising a failure could never cost the refresh; a rejection propagated and failed the job. Caught by the
   pin written for that claim, then made true with a `.catch(() => {})` at the call site as well as inside â€”
   "the callee catches" is a property that quietly stops being true.

Also fixed on review: two NEW failure logs interpolated `e.message`, which on a validation error quotes the
rejected VALUE â€” on the vitals path that value IS the vital. Both now log the error TYPE and a count (Â§0.2.2),
pinned by a zero-knowledge test.

### Six deliberate re-pins (no test lost: 2357 + 58 + 1 = 2416)

| file | what changed | why it is not a weakening |
|---|---|---|
| `healthStoreAdapter.test.js` | `+ tzOffsetMinutes: null` in one exact record | still `toEqual`, so an unexpected field still fails |
| `garminAdapter.test.js` | 8 expectations via new `rec()`/`recs()` helpers | helper declares the additive default ONCE; strictness kept (deliberately NOT `toMatchObject`) |
| `integrations.test.js` | 3 live-normalize shapes | same, exact match retained |
| `baselines.test.js` | 3 legacy-arithmetic pins moved behind the kill-switch, arithmetic UNCHANGED | the legacy estimator still exists and is what the flag restores â€” a kill-switch nobody executes is one that does not work |
| `baselines.test.js` | cache TTL literal `6*3600` â†’ the RELATIONSHIP `CACHE_TTL_S > FRESH_TTL_S`; corrupt-cache pin asserts the fall-through rather than the legacy median | pins the guarantee instead of a number that SWR deliberately changed |
| `shadow.fullSystem.test.js` | ATTACK-3 fixture timestamped; exact 70 â†’ a range on userB's side of the prior | without timestamps the recompute could only return the prior â€” the attack would have passed for the wrong reason |

`metricStore.test.js` and `shadow.fullSystem.test.js` also gained VitalSample mocks with no assertion changing
meaning (the W4-004 pure-core precedent).

### What is NOT done (carried forward, honestly)

`chronobiology` is wired only as far as `computeBaselineBlob`'s cosinor fit â€” the personal alertness curve does
NOT yet replace translate's binary `windDown` (that is W4-006's serving-path seam, and doing it here would
break the "no unrelated serving-path change" discipline). Sleep-debt accumulation still has no persistent
nightly store (W4-012's `MorningState`). Mobile emission of `tzOffsetMinutes` is an on-device checklist item â€”
the backend accepts and stores it, but every shipped client sends null today, so the hour-of-day table falls
back to server hour for real users until that ships. HITL **H4** (prod index builds for `vitalsamples`) is now
ACTIONABLE rather than theoretical: this commit is the one that starts writing rows.


## W4-005 evidence â€” the affect engine: axes, HMM and the state-set port (session 21)

An L task that landed in one session because, unlike W4-003 and W4-004, **W4-005 has no wiring half**:
`translate()` and `targetsBuilder` are untouched, by design â€” W4-006 owns that seam. What shipped is one
pure module (1173 lines), two suites (133 pins), and ADR-0013.

### What landed

- **`app/agents/runtime/physiology/affectEngine.js`** â€” PURE, clock-free, randomness-free (asserted
  mechanically: the suite greps the source for `Date.now()`, `Math.random()` and `new Date()`).
  - **Six evidence axes**, each a `{value, mass}` pair rather than a number. `mass` is
    `evidence/(evidence + 0.35)` â€” the fraction of the answer that is DATA â€” and it is the mechanism by
    which an axis says *I do not know*. No evidence returns the neutral prior at mass 0, and every layer
    above reads mass 0 as "this axis constrains nothing", never as "this axis says 0.5".
  - **Â§M.8 Karvonen exertion** `(HRâˆ’RHR)/(HRmaxâˆ’RHR)` against the user's own zones, replacing
    `translate()`'s `(HRâˆ’60)/100`. Pinned as measurably wrong for the simulator's athlete.
  - **Arousal against the personal 24-bin hour table** â€” 78 bpm at 03:00 and 78 bpm at 18:00 are
    different statements, and only one is remarkable.
  - **Declared-mood fusion over ALL taps**: centroid plus RMS dispersion, confidence
    `n/(n+1)Â·exp(âˆ’dÂ²/2ÏƒÂ²)`. Scattered taps fall toward zero confidence rather than averaging into a
    confident-looking neutral. Replaces every fixed 50/50 blend at the numeric level.
  - **Â§M.5 HMM** â€” sticky `A(s,s)=exp(âˆ’Î”t/Ï„)`, 70/30 within/cross split, emissions tempered by axis mass
    so Â§M.5's "missing axis â†’ factor 1" is reached continuously rather than by special case.
  - **Four-gate hysteresis** (enter / dwell / margin / exit) and the `AffectState` DTO.
- **`docs/adr/0013-state-model.md`** + README index â€” the 4-layer stack, both Â§M deviations, the
  regulator-not-mirror rule, and the **CUT BorbÃ©ly two-process formula** written out with its time
  constants and the reason it was cut, so W4-012's implementer does not re-derive it from a search.
- **`app/services/biosonic/translate.js`** â€” ONE line: `ACTIVITY_EXERTION_FLOOR` is now exported. The
  affect engine reads that exact table as a Bayesian PRIOR instead of copying it. No behaviour change
  (verified: the three translate-consumer suites pass untouched).

### The two decisions worth reviewing

**1. The taxonomy state set is an injected PORT, not a table in this engine.** W4-006 owns
`stateTaxonomy.js` and its ~32 states. `affectEngine` takes `states` as a parameter, validates it
mechanically (`validateStateSet` â€” 11 rejection cases pinned, including the subtle one: a state with an
EMPTY region constrains nothing, so its emission is 1 everywhere and it silently wins every tie), and
degrades to axes-only with `topState: null` when given none. The suite therefore drives a deliberately
small 6-state / 3-domain FIXTURE: a change to this engine that only passes against the real taxonomy is
a change in the wrong file. A `stateSetSignature` (FNV-1a, ~12 chars â€” this blob goes into an encrypted
Redis value in W4-009) detects a changed taxonomy and RESETS the forward vector rather than replaying it
against indices that now mean something else.

One consequence W4-006 needs to know, recorded in the ADR: **a region's `width` is not only a tolerance,
it is a prior.** The `âˆ’log Ïƒ` term means a narrow state claims more and is rewarded more when it is
right â€” correct Bayesian behaviour, and also a lever an implausibly tight width will pull.

**2. Both Â§M deviations were forced by measurement, not preference.** Documented in code and in the ADR:

- **Â§M.5's strong-switch clause is narrowed.** Â§M.5 permits an immediate switch on `Î±(s*) > 0.5` alone.
  Measured, that is not merely imperfect â€” it makes the dwell contribute *nothing*: a signal oscillating
  between two adjacent states every 6 minutes produced **20 reported transitions an hour, exactly equal
  to the memoryless control**. The bypass now also requires the switch margin AND that the change be a
  genuine regime change (different domain or different musical band). Adjacent states inside one band are
  the same music, so waiting is free; crossing into a peak band is someone starting to run, and making
  them wait five minutes is the failure the clause exists to prevent. After the fix the same stream
  reports 9. The exit-threshold bypass is gated identically, for the same reason.
- **The affect DTO carries no elapsed-time field.** It is a value object â€” persisted, replayed and
  compared byte-for-byte â€” so a wall-clock duration inside it makes identical inputs produce different
  results. Timing belongs to the caller, which owns the clock.

### Six defects this session's tests found in this session's own code

Three are real product bugs, one is dead code, two are test defects â€” all found by a test failing, none
by reading.

1. **The rest gate was self-defeating (product).** The first cut placed D3's gate at 0.30 HRR. Measured
   on the `stressedProfessional` persona, a genuine 2.4Ïƒ resting elevation kept only **11% of a possible
   53% mass** â€” because stress raises heart rate, heart rate raises Karvonen exertion, and the gate then
   shut on exactly the elevation it existed to weigh. **Any gate that is a monotone function of heart
   rate has this defect, W4-001's flat 110 bpm ceiling included.** The bounds are now read off tables
   that already exist: fully open below `ACTIVITY_EXERTION_FLOOR.walking` (0.35 HRR), fully shut at
   `ZONE_FRACTIONS[0]` (0.5 HRR, the bottom of Karvonen zone 1, above which an elevated heart rate is
   aerobic work by definition). Pinned as a boundary case in its own right.
2. **Â§M.5's strong clause defeated the dwell (product).** See above â€” found by the anti-flap test
   measuring `reported == memoryless`.
3. **The DTO broke replay determinism (product).** Found by the determinism pin: two identical calls
   differed only in `ms`.
4. **Two redundant `degraded` guards (dead code).** `heartRate = degraded ? null` and
   `readingConfidence = degraded ? 0` each independently killed every HR-derived part, so **neither was
   falsifiable** â€” the stub-out battery removed one and the suite stayed green. Collapsed to one, with
   the comment explaining why a second guard would be unfalsifiable by construction. This is the R4
   "dead/duplicated logic" class, caught by the battery rather than by review.
5. **The anti-flap control was not a control (test).** The first version compared reported transitions
   against the argmax of the FORWARD posterior â€” but the forward recursion has already done the
   smoothing, so the "control" measured 0 flips and the test was silently asserting nothing. The honest
   baseline is a MEMORYLESS labeller (match current evidence to the nearest region, no temporal state),
   which is what an implementation without this layer does. It flips **24 times an hour** on the same
   stream where the engine reports **0**.
6. **The transition-matrix pin was measuring two mechanisms (test).** `A(s,s) = exp(âˆ’Î”t/Ï„)` came out
   0.7484 against an expected 0.7165; the difference was exactly the share of two states excluded by
   `requiredSignals` under zero-mass evidence. Isolating the transition matrix means stripping every
   other mechanism, so the pin now uses a `requiredSignals`-free copy of the fixture.

### Stub-out battery â€” 20 mechanisms, all verified load-bearing

Every mechanism was removed one at a time and the suite re-run. Two were initially NOT falsifiable and
both were fixed rather than banked:

| Mechanism removed | pins RED |
| :-- | :-- |
| soft rest gate (D3) | 2 |
| activity floor back to an OVERRIDE | 1 |
| Karvonen replaced by `(HRâˆ’60)/100` | 2 |
| physiology allowed to write valence | 12 |
| degraded no longer withholds the heart rate | 1 *(0 before the redundant guard was collapsed)* |
| `finite()` coerces `null` to 0 (the W4-004 trap) | 5 |
| hour-bin RHR fallback deleted (old cached blob) | 1 |
| dispersion ignored in declared confidence | 1 |
| abstention removed (empty blend claims at full mass) | 6 |
| mass tempering removed (missing axis no longer factor 1) | 1 |
| stickiness removed (`A(s,s)=0`) | 6 |
| within/cross split flattened to uniform | 1 |
| dwell gate removed | 3 |
| switch margin removed | 1 |
| enterThreshold gate removed | 2 |
| regime-change gate removed (Â§M.5 literal) | 3 |
| `requiredSignals` exclusion removed | 2 |
| taxonomy-change reset removed (stale indices) | 1 |
| state-set validation removed | 1 |
| log-space max shift removed | 1 *(0 until a genuinely underflowing case was added)* |

The log-space shift is the numerical guard for the REAL 32-state taxonomy, where tight regions produce
likelihoods around `exp(âˆ’1200)` â€” zero in float64, so an implementation that exponentiates before
shifting gets an all-zero posterior, silently falls back to the transition prior, and loses every
distinction the emissions carried. The 6-state fixture never underflows, so the mechanism was invisible
until a sharp-region case was written for it.

### A finding worth recording, not a defect

`stressedProfessional` has a stress episode every weekday and, over a 30-day run, **zero** unstressed
days â€” so its measured HRV median IS the suppressed value (23.6 vs the persona's nominal 32), and asked
"is this unusual for you?" the engine correctly answers *no*. That is the designed meaning of a personal
baseline, and it is now pinned as an invariant with a comment, so nobody later "fixes" it. Detecting that
a person's NORMAL has drifted somewhere unhealthy is a different question on a different timescale â€”
W4-012's CUSUM over chronic-vs-acute residuals (Â§M.13). The absolute stress claim is therefore tested
non-circularly, against an HRV constructed at 2Ïƒ below that person's OWN measured baseline.

### What is NOT done (carried forward, honestly)

- **Nothing reaches the serving path yet.** `translate()`, `targetsBuilder`, `biosonicBand`, `score` and
  the shadow buffer are untouched; `targets` is byte-identical to what it was before this task. That is
  W4-006's job (`affectPeek` + `wellbeingRegulator` + the taxonomy table), and it is why W4-005 needs no
  S11 kill-switch: there is no behaviour to switch off. **W4-006's seam DOES owe one.**
- **No `stateTaxonomy.js`.** Deliberate â€” W4-006 owns it. Until then `topState` is null in production
  and the engine is an axes calculator with a validated port waiting for a table.
- **`requiredSignals` semantics are this engine's reading of the mission's one-word field.** A state
  naming a signal whose axis has mass 0 is excluded outright (unless every state would be, in which case
  exclusion is lifted rather than returning NaN). W4-006 may want the `degraded` flag to mean
  "reachable anyway"; the contract is enforced in `validateStateSet` and easy to extend.
- Mobile emission of anything new: out of scope this wave (backend-only).

## W4-006 evidence - the pure core: taxonomy + regulator (session 25)

`knowledge/stateTaxonomy.js` (~640 lines) and `translation/wellbeingRegulator.js` (~300 lines), plus
`tests/stateTaxonomy.test.js` (34 pins), `tests/stateTaxonomy.reachability.test.js` (9) and
`tests/wellbeingRegulator.test.js` (24). Suite 188/2656 green twice. Nothing is wired to a serving
path yet - the seam is the follow-up session - so the `targets` object every existing consumer sees
is byte-identical today and no kill-switch is owed here (the W4-005 precedent); both modules NAME
their future flag and neither reads `process.env`, which a test asserts by reading their source.

### The three design decisions worth reviewing

**1. Widths are SOLVED, not authored.** §M.5's emission carries a `-log sigma` term, so a state
written with tighter widths beats an equally-well-fitting state on precision alone - the affect
engine's own header flags this as a lever ("a state authored with an implausibly tight width will
dominate whenever it happens to fit"). Across 34 states, hand-tuned widths drift into that within a
few edits, silently, because the symptom never points at the cause. So the author declares a
per-axis ROLE (`defining` / `supporting` / `contextual` / `agnostic`) and the module solves
`sigma_a = exp(-k*w_a)` with `k` fixed so every state spends an IDENTICAL precision budget. Peak
emissions are then equal by construction, a state can only win by being closer, and a second
property falls out free: a state that claims more axes must claim each of them more loosely.
Specificity is conserved structurally rather than by the author's restraint. The budget is one
honest number - the geometric mean of a state's seven widths is a quarter of each axis's range.

**2. Every state constrains every axis ("no free passes").** The engine skips axes a region omits,
so an omitted axis is a FREE PASS: a state silent about valence pays nothing when valence
contradicts it, and can out-score a state that models valence and is right. This was not
theoretical - the first draft lost `creative-flow` to `deep-focus` AT CREATIVE-FLOW'S OWN CENTRE,
because the only axis separating them was the one `deep-focus` had declined to have an opinion
about. Every state now constrains all seven; an axis it has no opinion about is `agnostic`, which
comes out wider than `1/sqrt(2*pi)` - the point where the precision term turns NEGATIVE. Saying
"I do not know" costs a little. It should.

**3. Confusable states must be musically harmless, not far apart.** 34 states over 7 axes cannot all
be well separated, and pretending otherwise ships a confusion a listener hears. So the suite
measures every pair's separation in nats and requires that any pair close enough to be confused
agrees on band, on arc DIRECTION and on energy bias to within 0.25. The direction check is about
OPPOSING arcs, not merely different ones: flat-instead-of-falling is a difference nobody can name,
while rising-instead-of-falling hands the listener the opposite of what the state asked for - the
mirror failure VISION §6 exists to prevent. `morning-sluggish` gave up its `gentle-lift` for a flat
arc to satisfy this, and that is the right trade rather than a concession: see W4-D18.

### The measured finding that changed the module (and would have shipped silently)

The first draft authored regions in RAW axis units. Eight states were consequently **unreachable** -
not wrong, SILENT. `blend()` fuses every axis with the engine's NEUTRAL prior at `AXIS_PRIOR_MASS`,
so an axis whose evidence mass tops out at `m` can only reach `m*1 + (1-m)*neutral`; exertion is
dragged further toward the stated activity's prior, and fatigue carries `FATIGUE_WEIGHTS.debt`.
`peak-effort` asked for exertion 0.94 from an engine whose ceiling is 0.78. Every heavily-fatigued
state sat above a fatigue ceiling of 0.48. `low-mood-low-energy` asked for valence 0.14 against a
floor of 0.14.

The envelope is now MEASURED, not assumed: min/max over **5,843,675 evidence vectors** - five
personas x a coherent grid of heart rate (-0.15 to 1.05 of reserve), activity label, HRV ratio,
sleep, multi-week debt, battery, readiness, hour and saturated mood taps - through the real
`computeAxes` against real `computeBaselineBlob` baselines.

| axis | min | max | span |
|------|-----|-----|------|
| arousal | 0.102 | 0.899 | 0.798 |
| stress | 0.038 | 0.846 | 0.808 |
| recovery | 0.189 | 0.896 | 0.707 |
| exertion | 0.031 | 0.780 | 0.749 |
| fatigue | 0.059 | 0.482 | **0.424** |
| circadianAlertness | 0.137 | 0.837 | 0.700 |
| valence | 0.141 | 0.859 | 0.717 |

Regions are now authored in NORMALISED units and mapped through an affine transform per axis.
Because both centres AND widths go through the same map, every geometric property the suite pins -
peak equality, separation in units of sigma, argmax-at-centre - is invariant under it, so the table
can be reasoned about in normalised space and still speak the engine's units. **Verified
load-bearing by stub-out:** reverting `AXIS_RANGE` to the identity map turns 3 of the 9 reachability
tests RED and restoring it turns them green again.

### Reachability: the hard DoD, and how the scripts were obtained

All **34/34** states are reached. Nothing is mocked: each script drives `sim/generator` for 21 days
of that persona, folds it through the real `computeBaselineBlob`, and runs `updateAffect` over the
real taxonomy, asserting the REPORTED label (which also has to clear the state's own
`enterThreshold` - reachability is not "the argmax happened to be this"). The only authored part is
the moment: heart rate as a fraction of THAT PERSONA'S own reserve, activity label, HRV relative to
their own median, sleep, debt, battery, readiness, local hour, mood taps.

The scripts were found by search rather than guessed, and then constrained: a first randomised sweep
reached 27/34 but produced physiologically incoherent moments (a 186 bpm workout paired with a
declared low-arousal tap), so the grid was tied to coherence bands and re-run, and the eight
clock-named states were re-searched under their OWN hours and body-clock-appropriate personas
(the shift worker's acrophase is +8h, so their "morning" is not 07:00). A suite test now pins that
coherence - activity plausible for the heart-rate band - so a future edit cannot restore
reachability by pairing a sprinting heart rate with the label "resting".

### A defect this session's tests found in this session's own code

`degraded` was derived from the wrong axis set. It was defined as "requires no HR-derived axis",
listing `arousal` and `exertion` - and the reachability suite falsified it immediately: under a
degraded (mood-only) run, `arousal` still carries mass from the user's own mood taps and `exertion`
still carries the activity prior, so states requiring them were NOT excluded and the flag was
asserting something untrue. What actually separates the two classes is the SOURCE: arousal, exertion
and stress are statements about the live wrist signal; recovery, fatigue, circadian alertness and
valence come from sleep, the clock and the person's own word and survive a dead sensor. The flag is
now derived from that set, and the guarantee it buys is pinned: given ONLY passive evidence - no
heart rate, no HRV, no taps, no activity chip - every label the engine reports is degraded-safe. It
never names a bodily state on the strength of a clock. The companion pin is the interesting half:
a user who taps "Running" HAS made a true statement about their exertion, so an exertion-requiring
state stays a live candidate with a dead sensor. That is why the passive test has to strip the chip
to mean what it says.

### A defect the fuzz found, at 1e-9

`round3` moves a value by up to 5e-4 in either direction, and it was being applied AFTER the
monotonicity clamp - so on an input `acousticnessBias` of `1.0000000000000003e-9` the regulator
raised nothing and rounded to 0, violating "never lowers acousticness" by a hair. A near-invisible
breach of the one property the module exists to guarantee is still a breach. Rounding now happens
inside `tightenDown`/`tightenUp`, which re-clamp against the original in both directions.

### Stub-out battery - six mechanisms, one initially unfalsifiable

| # | mechanism removed | result |
|---|-------------------|--------|
| S1 | the `activityDriven` product gate | **23/23 STILL GREEN - the test was passing for the wrong reason** |
| S2 | `tightenDown` monotonicity | 1 RED (the fuzz) |
| S3 | `tightenUp` monotonicity | 1 RED (the fuzz) |
| S4 | the `MIN_REGULATION_CONFIDENCE` floor | 1 RED |
| S5 | the idempotence guard | 1 RED |
| S6 | clamping the arc's start into the hard band | 1 RED |
| - | `AXIS_RANGE` reverted to the identity map | 3 RED in the reachability suite |

**S1 is the one worth reading.** The test asserting §0.2.6's "user intent wins" used
`obligated-workout-low-recovery`, which is ALREADY exempt from the energy cap through its own
activating direction and positive energy bias - so deleting the product gate entirely left the suite
green. The test has been rewritten around `cooldown` (down-regulating, negative energy bias), which
genuinely reaches the gate, and now asserts both halves: the chip wins on an activity-driven target,
and the SAME state against a passive target IS capped, which is what proves the gate is the
discriminator rather than some other exemption. Deleting the gate now turns it RED.

### What is NOT done (carried forward, honestly)

- **The whole seam half.** Nothing in this session reaches a serving path. `targetsBuilder` does not
  call `affectPeek`, `upsertStateVector` does not write taxonomy labels, `_STATE_TO_BAND` is not yet
  extended from `stateBandTable()`, `stateVector.worker` does not refresh affect, `buildReceipt`
  (S13) has no explain lines, and the two S11 kill-switches are named but unread. The task stays
  `in_progress` for exactly this reason.
- **The display-copy compliance item.** `explainTemplate.text` is INTERNAL vocabulary, pinned
  digit-free and clinical-vocabulary-free, but the user-facing wording is a separate
  compliance-reviewed layer (mission R10 / S13). Raised as HITL H6 below.
- **The affect engine's axis set is untouched**, deliberately: this task owns the taxonomy, not the
  engine. The two limitations it ran into are queued as W4-D18 and W4-D19 rather than patched here.


## W4-006 evidence - the seam half: the affect layer reaches the serving path (session 26)

The half W4-006 was `in_progress` for. Before this session `affectEngine` was a 1200-line module
with **no caller**, and the taxonomy and regulator were a table and a decorator nothing invoked;
the whole W4-005/006 stack computed nothing anybody could hear. Three new modules and seven wired
files later, it does. Suite **192 suites / 2749 tests**, lint 0 errors / 22 warnings.

### The shape of the seam, and the measurement that chose it

    peek carried posterior -> updateAffect(live evidence) -> translate() -> regulator.apply -> save

The mission's wording (`const affect = await affectPeek(userId)`) also permits a PURE peek of a
blob the nightly worker writes. That reading was rejected on measurement rather than taste: the
worker holds no live heart rate, so arousal, stress and exertion all abstain, overall confidence
lands under the regulator's own `MIN_REGULATION_CONFIDENCE` floor of 0.25, and the entire seam
would have been a decorative no-op **that reported success** - the exact false-green class this
run keeps finding. Read-update-write makes the state a statement about NOW, and it is precisely
the `(state, input, opts) -> {state, result}` contract `updateAffect` was written against.

What is cached is therefore only the HMM posterior - the one quantity a single reading cannot
reconstruct. The axes are recomputed every call because they are cheap and they are about now.

### What landed

1. **`services/biosonic/affectCache.js`** - the posterior at rest: AES-256-GCM, AAD-bound to the
   userId, read through `auditedDecrypt`, 2 h TTL, best-effort throughout.
2. **`services/biosonic/affectService.js`** - the ONE composition both lanes use. The serving path
   and the nightly worker arrive from opposite directions (live reading vs none) and giving each
   its own peek/update/save would let the stored state and the served state disagree about the
   same person within a minute - the drift the pure core's injected-state-set port was designed to
   prevent, undone at the wiring layer where nobody would look for it. `WAVE4_AFFECT_DISABLED` is
   honoured here rather than per call site, so the switch cannot be half-wired.
3. **`agents/runtime/knowledge/explain.js`** (S13) - the claim-gated "why this mix" line.
4. **`targetsBuilder.buildTargets`** - the seam itself, plus `taps` threaded from both real call
   sites (the socket handler and the fallback ladder). Without that thread the valence axis
   abstains forever and every state separated from a rival only by valence is unreachable at serve
   time - the failure mode the pure core hit between `creative-flow` and `deep-focus`.
5. **`moodDescriptors._STATE_TO_BAND`** - now DERIVED from `stateTaxonomy.stateBandTable()`.
6. **`medicalProfileService.upsertStateVector`** - an additive encrypted `stateId`/`stateConfidence`.
7. **`stateVector.worker`** - the nightly affect refresh, on the blob it just cached.
8. **S5 registration** for the new `bio:affect:<userId>` key family, which §0.4 S5 names explicitly:
   the `userRedisPurge` registry (which the account-erasure cascade iterates) and per-wearable
   erasure, since the posterior is derived from heart rate and HRV even though it stores neither.

### Four decisions worth Daniel's eye

**1. A carried posterior EXPIRES; a baseline does not.** The baseline cache serves stale blobs on
purpose (D15's stale-while-revalidate) because a 30-day median is not wrong at six hours and one
second. A STATE is the opposite kind of quantity, and it does not fail quietly: the hysteresis
gate holds an incumbent label against fresh evidence unless it clears `SWITCH_MARGIN`, so a stale
label actively RESISTS the reading that would correct it. Past `MAX_CARRY_AGE_S` (2 h, matching the
TTL W4-009 specifies for the same blob) the posterior is dropped and the engine starts clean.

**2. `stateId` is stored ALONGSIDE `status`, not instead of it - and that is a compliance call, not
a schema preference.** `pulseController` decrypts `stateVector.status` and serves it to the owner.
Changing that field's vocabulary would have started rendering `acute-stress` on the Pulse screen,
which is **HITL H6** - Daniel's open decision, pending a compliance pass. So the legacy pair keeps
its exact vocabulary and its exact meaning, the taxonomy pair is additive and internal, and the
Pulse DTO's explicit whitelist is pinned to prove the new field cannot appear by accident.

**3. D13's serving-path half landed, and its fallback is the bug that nearly shipped.**
`buildTargets` now takes hour-of-day from the user's habitual `tzOffsetMinutes` (W4-004 put it on
the blob) instead of the server's clock. The interesting half is the UNKNOWN case - every shipped
client today, since mobile does not emit the offset. The obvious default of `0` is **UTC**, which
is a different hour from the server's for most of the world, so it would have silently moved every
existing user's wind-down window while looking like a no-op. The fallback is the SERVER's own
offset, which makes `localHour` reproduce `new Date(now).getHours()` exactly. Stubbing it back to
zero turns a pin RED.

**4. S13 lines are gated on the axes they CLAIM, not on confidence.** Each `explainTemplate` names
the axes its sentence leans on. "Coming down from effort" is a statement about a person's exertion,
and the HMM will report `post-exertion-recovery` on thin evidence because most-probable is not the
same as well-evidenced - so if that axis abstained, the sentence is a fabrication that happens to
fit. A line is emitted only when every claimed axis carries real mass; otherwise silence. The
receipt already says "Tuned to your heart rate"; a missing line costs a nicety, a fabricated one
costs the user's reason to believe any of it. Per H6's recorded safe default the line carries the
state's TONE and never its NAME, and it arrives as an ADDITIVE `receipt.why` so no existing receipt
string changes. A pin hands the receipt builder the WHOLE decorated target - state id, arc,
telemetry - and asserts that only the vetted line reaches the wire.

### A defect the module graph found

`moodDescriptors` requiring `stateTaxonomy` closes a **cycle**: taxonomy -> affectEngine ->
translate -> moodDescriptors -> back. An eager top-level require resolves to a half-initialised
taxonomy and `stateBandTable` is `undefined` at load time - the suite failed to run at all, which
is the good version of this bug. Fixed with a lazily-required, memoized build (the precedent
`baselines._scheduleRefresh` and `affectEngine`'s chronobiology import already set in this tree),
and the export became a getter returning a COPY, so a caller cannot mutate a closed-vocabulary
lookup through it.

### A test that passed for the wrong reason, on this box specifically

The equivalence pin (`the decoration matches applying the regulator directly to the same inputs`)
reconstructed the affect with a hardcoded `tzOffsetMinutes: 0`, while the seam resolves the server
offset - **180** on this machine. It passed anyway: 14:00 UTC and 17:00 local happened to land in
hour bins that produced the same posterior. Caught by asking why a 27-test suite went green on the
first implementation pass rather than by a failure. It now calls the builder's own
`resolveHourContext`, so the equivalence is exact by construction and honest on any machine.

### Stub-out battery - 14 mechanisms, one initially unfalsifiable

| # | mechanism removed | result |
|---|---|---|
| 1 | the posterior staleness guard | 1 RED |
| 2 | the AAD binding on the cache blob | 4 RED |
| 3 | the future-date (S6) guard | 1 RED |
| 4 | the `bio-affect` purge-registry entry | 3 RED |
| 5 | the affect key in per-wearable erasure | 2 RED |
| 6 | the `WAVE4_AFFECT_DISABLED` gate | 3 RED |
| 7 | `WAVE4_TRAJECTORY_DISABLED` not passed to the regulator | 1 RED |
| 8 | the server-offset fallback -> UTC zero | 1 RED |
| 9 | the posterior write-back | 4 RED |
| 10 | the posterior read-back (cold start every call) | 2 RED |
| 11 | the affect label ignored in `upsertStateVector` | 1 RED |
| 12 | `stateId` stored in PLAINTEXT | 5 RED |
| 13 | the S13 claim gate | 4 RED |
| 14 | `explain` attached to an UNdecorated target | 1 RED |
| - | the `if (!affect) return targets` guard | **0 RED - unfalsifiable** |

The last row is the one worth reading. `wellbeingRegulator.apply` already returns the SAME object
for a null affect, an unknown label or a sub-threshold confidence, as a documented contract with
its own pins behind it - so a second guard at the seam could never fire. It was DELETED rather than
kept as decoration, and the guarantee it was supposed to provide is now pinned at the seam instead
(`a failed affect layer returns targets untouched`, asserted field-for-field against the kill
switch). A line nobody can test is not defence in depth.

### Test accounting (exact)

+4 suites - `affectCache.test.js` 25, `wave4.affectSeam.test.js` 33, `wave4.stateSeam.test.js` 15,
`wave4.explainReceipt.test.js` 14 = **87** - plus **6** appended (`wearableErasure` 16 -> 18,
`stateVector.worker` 5 -> 9). 2656 + 87 + 6 = **2749** exactly, so no pre-existing test was lost.

**Two deliberate re-pins, neither a weakening, both with no count change:**

| file | what changed | why it is not a weakening |
|---|---|---|
| `stateTaxonomy.test.js` (3 tests) | read `moodDescriptors._STATE_TO_BAND` -> a written-out `LEGACY_BAND_RECORD` | that table is now DERIVED from `stateBandTable()`, so reading it would compare the taxonomy against itself and pass unconditionally. The record is a source the code can no longer move. |
| `stateVector.worker.test.js` (1 assertion) | `upsertStateVector('u1', anyObject)` -> the exact 3-arg call | kept EXACT rather than relaxed to `expect.anything()` - a loosened matcher would stop noticing if the worker silently stopped passing the affect at all |

### What is NOT done (carried forward, honestly)

- **`translate`'s binary `windDown` still exists.** W4-004's evidence assigned the personal
  alertness curve to this seam. It is reached differently than that note assumed: the cosinor now
  drives the affect engine's `circadianAlertness` axis, which selects clock-named taxonomy states
  (`evening-unwind`, `afternoon-dip`, `pre-sleep`, `night-owl-alert`) whose policies shape the
  target through the regulator. That is the architecturally right place for it, and `windDown`
  stays as the degraded path for users with no affect. Replacing the constant INSIDE `translate`
  was deliberately not done - it is a heavily-pinned file and the behaviour is already personal
  through the taxonomy. Worth a reflection's eye rather than silent closure.
- **Mobile still sends no `tzOffsetMinutes`**, so real users are on the server-hour fallback until
  the on-device checklist item ships. The backend accepts and uses it today.
- **W4-009 owns the live socket lane.** The posterior advances on generation and on the nightly
  refresh; per-reading `onlineUpdate` and the state-triggered recalibration are that task's, and it
  shares this same Redis blob by design (one user, one posterior).
- **The display-copy compliance item stands** - `receipt.why` ships the tone under H6's safe
  default, but the vocabulary question is still Daniel's.


### Archived 2026-08-20 (reflection #5, session 28) - reflection #3 evidence

### Reflection #3 (session 19) â€” evidence

**R1 Â· Health check.** Full suite `cd backend && npm test`: **179 suites / 2357 tests, 2356 passed + 1 todo, exit 0,
191.7 s** â€” matches the recorded `testBaseline` exactly, zero failing assertions. (The 191.7 s vs session 18's ~150 s is
machine load, not regression: HITL H3's ten stale `worker.test.js` processes are still resident and this pass ran lint and
two isolated jest invocations alongside it.) `npm run lint`: **0 errors, 22 warnings** â€” the same count for the fifth
consecutive session. Tree clean apart from the standing intentional `mobile/src/health/config.ts` (S2, session 1).
`origin/main` still `1a1657e` = STATE's `lastMainSha` (no drift); `feat/intelligence-wave` is level with `origin` at
`9ba207e`, so S3's offsite backup is real rather than assumed. Secret scan of `962acb2..HEAD`: one hit, and it is the same
self-referential false positive reflection #2 recorded â€” STATE prose containing "`Task-`", which matches the `sk-` pattern.
No attribution anywhere in the 19 commits or the diff.

**R2 Â· Verifying the interval's claims â€” all four held, and three were checked by EXECUTION rather than by reading.**

1. **W4-D08's reopen is genuinely closed.** The defect was a `ReferenceError` from an unimported helper, so the only
   honest check is to run the real function. `suunto.handleWebhook('u1', '[{"hr":72,...}]', '')` executed directly against
   the production module: **resolves**, `{"ingested":0,"rejected":{"count":1,"reasons":[{"path":"userId","reason":"objectid"},{"path":"heartRate","reason":"string"}]}}`.
   That is not merely "no longer throws" â€” it is W4-D08's actual promise (report what the database took, surface the
   rejects) demonstrated on a real payload. `insertManyAccounted` is imported in all three lanes (`suunto.js:5`,
   `appleHealth.js:20`, `metricStore.js:13`). The `[insertAccounted]` line carries model, counts and (path, validator-kind)
   pairs â€” no submitted values, so zero-knowledge holds.
2. **W4-D11's linter is a real gate, proven by stub-out.** A throwaway `app/__reflect_probe.js` containing one undefined
   identifier was created and both controls were run against it: `npx eslint` â†’ **1 error, `no-undef`**, and
   `wave4.lintGuard.test.js` â†’ **3 pins RED**. Probe deleted, tree re-verified clean. So the control that would have caught
   W4-D08 in one second now genuinely fires â€” the DoD line "lint clean" has stopped being vacuous.
3. **W4-003's wiring does what it claims (D6).** Read at source: `effectiveHR = filtered.level` is what reaches *every*
   downstream decision â€” the immediate/watch lane, the first-reading seed, the `delta` computation, `bandCrossed`, and both
   `pendingHR` writes. The raw value survives in exactly two places, both correct by design: the `biometric_ack` echo and
   the `BiometricLog` row (the device record, deliberately unsmoothed). D7's EWMA was removed rather than orphaned â€”
   `hrEwma`/`_updateEwma`/`HR_EWMA_ALPHA` have **zero** occurrences left anywhere under `backend/`. Contract audited for a
   trap that would have been easy to miss: a hard-gated FIRST reading returns `accepted:false, level:null`, and
   `_maybePersistLiveReading` tests `!filtered.accepted` **before** consuming the throttle slot, so a rejected reading
   neither persists nor burns the â‰¤1/min budget.
4. **W4-004's S5 registration is load-bearing where it exists.** Stub-out: deleting `{ model: VitalSample }` from
   `userDataExport.COLLECTIONS` turned **4 pins RED across 2 suites** (`userDataExport.test.js`,
   `shadow.qa4.crypto.test.js`); file restored and re-verified. This is the claim that matters most for a
   special-category collection, and it is real. What is NOT complete is the documentation surface â€” see R3.

**R3 Â· Constraint audit â€” one violation, queued as W4-D13.** Clean: `adr0012.tripwire.test.js` PASS; targets contract
untouched this interval (no `translate`/`targetsBuilder` edits in the diff, so the 13-key superset is trivially intact);
Art.9 consent gates untouched; S9 holds â€” `grep` for `Date.now|Math.random|new Date()` across `anomalyFilter`,
`baselineEngine` and `chronobiology` returns **only a comment**, every engine takes `now` as a parameter; zero-knowledge
holds for the new code â€” the three new modules contain no `console`/`log` call at all (the sole `log` match is
`Math.log`), and the pre-existing numeric-vital lines remain tracked as W4-D03/W4-D10; S11 kill-switch present for the
interval's one serving-path change (`WAVE4_ANOMALY_FILTER_DISABLED`, with a forgiving `=1`/`=true` parse).
**The violation:** Â§0.4 S5's fifth surface, "the retention-windows documentation", was never written â€” full detail and
DoD in W4-D13 above. Recorded as `class: repair` because S5 is binding and names that surface explicitly; recorded with
its true severity because inflating it would be its own kind of dishonesty â€” the erasure CODE is complete and correct,
the collection is empty, and no writer for `spO2`/`respirationRate` exists, so nothing leaks today. What is stale is a
**store-facing** declaration (the Play data-safety deletion answer) that now under-reports the cascade by one collection.

**R4 Â· Quality sweep â€” the math was re-derived, not re-read.** The interval's headline risk was W4-004's deliberate
departure from Â§M.4, which session 18 flagged against itself as W4-D12. That row nominated "a reviewer" as its decider;
this pass was that reviewer and **confirmed the deviation is correct** â€” the algebra, the MADâ†’SD unit check that could
have hidden a 1.4826Â² error, and the athlete numbers are all in the W4-D12 row, which is now closed by ruling with the
mission's Â§M.4 amended by one clarifying line. Other engine checks, all passing: Â§M.3's cosinor matches the spec
(`A=âˆš(Î²Â²+Î³Â²)`, `Ï†=atan2(Î³,Î²)/Ï‰`, count-weighted LSQ) and encodes "â‰¥6 bins â‰¥2 h apart" as `MIN_SPREAD_BINS = 6` against a
circular-spread measure, which is stricter than the literal wording; `_solve3` returns null on a singular design rather
than NaN; `r2` is guarded by `sst > 0`; the EWMA's `Math.log(2)/Math.max(halfLifeDays, 1e-9)` guards both the log domain
and the division; and **S8's specifically-named Karvonen hazard is guarded** â€” `hrr = Math.max(1, hrMax - rhr)`, so the
degenerate `HRmax â‰ˆ RHR` body yields ordered finite zone bounds instead of poisoning every downstream exertion figure.
D2's decontamination was checked for the obvious hole and does not have it: unlabelled workout rows are not excluded by
`isExercise`, but the P10 trough plus `MIN_DAY_SAMPLES` is what handles them, and the persona test asserting RHR within
Â±3 bpm *despite* workout episodes passes.

**R5 Â· Opportunity sweep â€” nothing new, and that is the finding.** One forward-looking note was worth recording and is
attached to the W4-004 row rather than queued, because it belongs to that task's own remaining DoD: the wiring half is
what finally puts D1 on the serving path (`translate()` stops reading the `{45, 8}` population constant and starts
reading real personal HRV), which makes it a serving-path behaviour change and therefore owes an Â§0.4 S11 escape hatch â€”
and S11's named inventory in the mission has no baselines flag, so it is easy to miss. Beyond that: W4-D03 and W4-D10
(the two numeric-vital log lines) remain correctly parked behind MUST-tier work per R6's ordering, and no new defect
class surfaced. Per Â§2.5, an interval this clean gets said in one line rather than padded â€” **one row queued, not five.**


## 2026-08-20 - archived by reflection #6 (R1.5; STATE had reached 176KB)

> Moved verbatim from `docs/plans/WAVE4_STATE.md`, in append order, per S2.5 R1.5. Backlog rows are
> deliberately NOT archived: `state-guard.js` reads their removal as a stale rewrite (W4-D16, still open).

### Reflection log entries #3 and #4

| # | at | interval covered | suite | verified / reopened / queued | headline |
|---|----|------------------|-------|------------------------------|----------|
| 3 | 2026-08-19 (session 19, `exec`) | `962acb2` â†’ `9ba207e` â€” 19 commits; tasks W4-D08 (reopen), W4-D11, W4-003 (wiring), W4-004 (pure core) | **179 suites / 2357 tests (2356 passed + 1 todo), exit 0, 191.7 s** â€” exactly the recorded baseline; lint 0 errors / 22 warnings | **4 verified / 0 reopened / 1 queued** (+ W4-D12 closed by ruling) | The code is in good shape â€” the interval's four claims all held under execution and stub-out, including the reopened Suunto lane, which now runs and reports truthfully. The one thing that did not hold is a *paper* surface: S5 names five registration places for a new collection and W4-004 wrote four, counting an in-code comment as "the retention-windows documentation" while the real one (`docs/PRIVACY_DECLARATIONS.md`) still describes a nine-collection erasure cascade the code outgrew (W4-D13) |
| 4 | 2026-08-19 (session 23, `exec`) | `60b8a4d` -> `ae3937a` - 16 commits; tasks W4-004 (wiring), W4-D13, W4-005, W4-D14, W4-016 added, W4-006 started | **184 suites / 2549 tests (2548 passed + 1 todo), exit 0, 209.5 s** - exactly the recorded baseline; PR #179 all GitHub checks green | **4 verified / 0 reopened / 2 queued** | The interval's claims all held, and the defect is in code none of them touched: `translate._robustZ` anchors an explicitly-null baseline median at ZERO, so W4-004's deliberate cold-start `rhrMedian: null` saturates stress to 1.0 for every resting reading - and the test named for that exact gotcha only asserts structural sanity |

### Session log rows for sessions more than 24h old (1-17 and the Cowork row)

| # | started | result line (`WAVE4_SESSION_RESULT: ...`) |
|---|---------|--------------------------------------------|
| 1 | 2026-08-18 22:56 | WAVE4_SESSION_RESULT: W4-000 in_progress review pass complete â€” 6 unknowns resolved, mission amended, phaseâ†’execute |
| 2 | 2026-08-19 00:29 | WAVE4_SESSION_RESULT: W4-000 in_progress HALT â€” 3 concurrent sessions on one working tree (R7); preflight S1 verified green, HITL H2 raised |
| 3 | 2026-08-19 00:20 | WAVE4_SESSION_RESULT: W4-000 in_progress halted by WAVE4_HALT (3 concurrent sessions); worker.test.js leak root-caused and fixed, baseline 163/1767 green, ADR-0012 + tripwire landed in d1db088, STATE intentionally not written |
| 4 | 2026-08-19 00:28 | WAVE4_SESSION_RESULT: W4-000 in_progress halted on WAVE4_HALT - three concurrent sessions on one tree (HITL H2); preflight passed, no docker, no work committed |
| 5 | 2026-08-19 01:0x | WAVE4_SESSION_RESULT: W4-001 done â€” 10 surgical fixes (D3,D4,D5,D7,D8,D9,D11i,D14,D17,W8/W9), 34 new pins, suite 164/1802 green |
| 6 | 2026-08-19 01:27 | WAVE4_SESSION_RESULT: W4-D01 done â€” reflect-marker module + loop backstop, 27 new pins, suite 165/1829 green |
| 7 | 2026-08-19 (exec) | WAVE4_SESSION_RESULT: W4-D02 done â€” STATE row-clobber guard + loop backstop, 36 new pins, suite 166/1865 green |
| 8 | 2026-08-19 (exec) | WAVE4_SESSION_RESULT: REFLECT done 4 verified, 0 reopened, 2 queued â€” suite 166/1865 green; W4-D05 band-flap + W4-D06 open-handle leak found, W4-D04 closed by ruling |
| 9 | 2026-08-19 (exec) | WAVE4_SESSION_RESULT: W4-D05 done â€” asymmetric band release margin + served-band latch, 26 new pins, suite 167/1891 green |
| 10 | 2026-08-19 (exec) | WAVE4_SESSION_RESULT: W4-D06 done â€” standing open-handle guard + one-step debounce reset, 53 new pins, suite 168/1944 green |
| 12 | 2026-08-19 (exec) | WAVE4_SESSION_RESULT: W4-D09 done â€” min-of-N perf-budget helper + relative burst budget, 45 new pins, suite 171/2073 green twice (first bankable green baseline since W4-002). Reflection SKIPPED per Â§2 step 4 (marker DUE 7.25h, but `class: repair` rows were pending â€” fix the tree first). S2: adopted the prior session's untracked RED test after verifying it red. |
| 11 | 2026-08-19 (exec) | WAVE4_SESSION_RESULT: W4-002 done â€” seeded simulator (rng, 5 personas + 2 holdouts, generator, replay harness, soak), 84 new pins, suite 170/2028 with 1 pre-existing wall-clock flake (W4-D09); found W4-D08 |
| 13 | 2026-08-19 (exec) | WAVE4_SESSION_RESULT: W4-D08 done â€” truthful bulk-insert accounting across all three wearable ingest lanes, 17 new pins + 1, suite 172/2091 green twice. Reflection SKIPPED per Â§2 step 4 (marker DUE 7.86h, but `class: repair` W4-D08 was pending â€” fix the tree first). Found W4-D10. |
| 14 | 2026-08-19 (exec) | WAVE4_SESSION_RESULT: REFLECT done 5 verified, 1 reopened, 1 queued â€” suite 172/2091 green (exact baseline); W4-D08 REOPENED: `suunto.js:50` calls an unimported `insertManyAccounted`, proven by executing the real function (`ReferenceError`), invisible because every suunto test mocks the module; scope analysis over all 147 production files shows it is the only one; W4-D11 queued (no linter exists, so `lint clean` has never gated anything) |
| 15 | 2026-08-19 (exec) | WAVE4_SESSION_RESULT: W4-D08 done â€” suunto lane requires the helper it calls; both untested ingest lanes pinned against the real modules (16 pins); W4-D11 landed with it: eslint `no-undef` gate + in-suite guard (10 pins), stub-out verified; suite 174/2117 green twice |
| 16 | 2026-08-19 (exec) | WAVE4_SESSION_RESULT: W4-003 in_progress â€” pure core landed (telemetry DTO + anomaly filter, 82 pins, suite 175/2199 green); constants derived from one wander envelope; stub-out battery found 4 of 12 mechanisms initially unfalsifiable and pinned all of them; wiring + D10 persistence owed next session |
| â€” | 2026-08-19 (Cowork) | H2 closed after direct git verification (clean, non-conflicting history) + run-mission.ps1 single-instance mutex fix; phaseâ†’execute; W4-000â†’done; rows 2-4 are the three colliding launches (00:20/00:28/00:29), numbered in write-order not start-order |
| 17 | 2026-08-19 (exec) | WAVE4_SESSION_RESULT: W4-003 done â€” wiring half landed (filter drives debounce/trigger, D10 live persistence throttled+deduped, S6 gate real at the seam, WAVE4_ANOMALY_FILTER_DISABLED kill-switch, W4-D07 closed), 15 new pins (14 in wave4.liveWiring.test.js + 1 in biometricHandler.pipeline.test.js), suite 176/2213 green twice; 3 deliberate re-pins + 1 tolerance widening, all documented; PR #179 body updated, branch pushed |

## 2026-08-20 - archived by reflection #7 (R1.5; STATE had reached 231KB)

Moved verbatim, in append order, per S2.5 R1.5. STATE keeps the Run header, the full Task table, all open
backlog/HITL rows, the PR queue, and the two most recent reflection entries (#6 and #7).

### Reflection log entry #5

| # | at | interval covered | suite | verified / reopened / queued | headline |
|---|----|------------------|-------|------------------------------|----------|
| 5 | 2026-08-20 (session 28, `exec`) | `832bcdc` -> `6ffe47c` - 13 commits; tasks W4-D15, W4-006 (pure core + seam) | **192 / 2749 green, exit 0** (exact baseline) | 3 verified / 0 reopened / 1 queued (+1 HITL) | Every claim in the interval held under stub-out; the one finding is that the personal circadian curve can only ever tighten the wind-down constant, never lift it (W4-D20). PR #179's owed seam-half note posted; STATE 170KB -> 121KB. |

### Reflection #4 and #5 evidence sections

### Reflection #4 (session 23) - evidence

**R1 - Health check.** Full suite `cd backend && npm test`: **184 suites / 2549 tests, 2548 passed + 1 todo,
exit 0, 209.5 s** - exactly the banked baseline, no drift. Attribution scan of `60b8a4d..HEAD`: clean (the only
hits are STATE prose quoting the policy itself and the H5 discussion of process names). Secret scan of the same
range: clean (the standing `Task-` substring and the mission's own quoted grep pattern). **CI checked, not just
the local run:** `gh pr checks 179` is GREEN on every check - Backend lint & test 1m34s, Frontend typecheck,
Mobile compile + jest, gitleaks, GitGuardian; PR #179 OPEN and MERGEABLE. **One S3 gap:** `ae3937a` (session 22)
was never pushed - `origin/feat/intelligence-wave` sat at `8351d3b`. Pushed by this reflection. Session 22 also
left no Session-log row; its work is one commit and the W4-006 row records it, so nothing was lost.

**R1.5 - STATE housekeeping.** STATE was **204,535 bytes**, past the 150KB trigger. Archived verbatim into the new
`docs/plans/WAVE4_ARCHIVE.md`: the 12 per-task evidence sections for sessions 5-18 (every one already verified by
reflections #1-#3) and reflection entries #1 and #2 with their evidence sections. **204,535 -> 104,115 bytes.**
The closed backlog rows R1.5 also nominates were deliberately NOT archived - see W4-D16, the guard refuses them.

**R2 - Verifying the interval's claims: all four held.** Checked by execution and stub-out, not by reading prose.
(1) **W4-004 wiring** - `computeBaselines` really does delegate to `computeBaselineBlob` and return the superset;
executed it on a zero-evidence user and got `hrvMedian: 45, hrvMAD: 8, rhrMedian: null, confidence: 0`, so D1's
key genuinely reaches `translate()` (`translate.js:95` reads it) with zero translate edits, as claimed. The
`WAVE4_BASELINE_ENGINE_DISABLED` kill-switch S11 owed exists (`baselines.js:41`) and gates the legacy path at
`:149`. Stale-while-revalidate is real (FRESH_TTL_S vs the longer cache TTL). (2) **W4-D13** - the retention
guard `wave4.retentionDocs.test.js` exists with 7 pins and passes. (3) **W4-005** - `affectEngine.js` exists with
78 pins in `affectEngine.test.js`; the arithmetic in the baseline sentence reconciles exactly (2416 + 133 = 2549)
and the full green run at 2549 is itself the check. (4) **W4-D14** - the flaky oracle is genuinely replaced:
`wave4.baselineWiring.test.js` now asserts `not.toContain('rhrMedian')` on the ciphertext, with the round-trip
decrypt left intact. **Nothing reopened.**

**R3 - Constraint audit: clean.** Zero-knowledge: the interval adds exactly three log statements to
`backend/app`, and all three are value-free - `logBiometricAccess(userId, 'baseline-aggregation', {count})`,
`[baselines] derived-profile write failed: <ErrorName>`, `[metricStore] vital persist failed for N row(s):
<ErrorName>` (type only, deliberately, because a validation message would quote the rejected heart rate).
ADR-0011/0012 tripwire green in the full run. Targets remain a strict superset - W4-005 wired nothing into the
serving path, so the `targets` object is untouched this interval. Attribution and secrets clean (R1). The
`Number(null) === 0` hazard session 18 fixed in its own engines was re-probed in the NEW code and is genuinely
guarded there (`baselineEngine.median([null,null])` returns `null`) - it survives only in `translate.js`, which
is W4-D15.

**R4 - Quality sweep: the finding, and how it was reached.** The interval's headline risk was W4-004's decision to
return `rhrMedian: null` for a user with no non-exercise evidence, on the stated ground that null makes the
resting-elevation term ABSTAIN. Rather than accept the comment, the claim was executed. It is false: `finite()`
in `translate.js` is `Number.isFinite(Number(x)) ? Number(x) : null` and `Number(null) === 0`, so `finite(null)`
is **0**, the `?? fallback` in `_robustZ` never fires, and the user is scored against a resting heart rate of
**zero**. A calm user at HR 70 gets `stress = 1.0`; at HR 55 he still gets `1.0`; with the key merely absent he
gets `0.2`. Then the natural next question - "surely something pins this?" - found the pin, named for this exact
gotcha, asserting only `assertTargetsSane`, which checks finiteness and ranges and nothing about abstention. So
the guard for the bug is green while the bug fires. Queued as **W4-D15** (repair, MUST).

**R5 - Opportunity sweep: nothing new, and that is the honest result.** The interval's own code is in good shape;
the one real defect found is in code it did not touch, and the second row (W4-D16) came out of doing R1.5 rather
than from a sweep. W4-006 is `in_progress` on session 22 with the row claimed and no product code yet (the
commit lands only `scripts/wave4-doctor.ps1`); that is 1 of the 3 sessions S4 allows, so it is noted, not
actioned. Per S2.5 this is written as one line rather than padded to five rows.

**R6.5 - Pace check: comfortable, no HITL needed.** `day4CutoffAt` is 2026-08-22 22:56 local, ~75h out. Remaining
MUST-tier work is W4-006 (L, in_progress), W4-007 (L), W4-008 (L), W4-016 (M) and W4-015 (M) - at the observed
2-sessions-per-L pace that is ~8 owner-sessions. 22 sessions have run in ~20.7h of wall clock (~56 min each), so
~80 sessions fit in the remaining window; even subtracting ~18 reflections at the 4h cadence, the MUST queue
finishes with a wide margin and SHOULD/STRETCH are reachable. Trending correct; nothing for Daniel to decide.


### Reflection #5 (session 28) - evidence

**R1 · Health check.** Full suite `cd backend && npm test`: **192 suites / 2749 tests, 2748 passed
+ 1 todo, exit 0, 243.5 s** - the exact `testBaseline`. Verified the W4-D15 way: `grep -c "^FAIL"`
over the COMPLETE captured log returned **0**, rather than reading a summary line or a tail. Lint
`npx eslint .`: **0 errors**, 22 pre-existing warnings. Secret scan of `832bcdc..HEAD` and of the
working tree: clean. **Real CI, not only the local run:** `gh pr checks 179` - all ten checks pass
at `6ffe47c` (backend lint & test, frontend, both mobile jobs, gitleaks, GitGuardian, Vercel).
H1's scheduled secret-scan failure on `main` is unchanged and still out of scope, named here so it
does not silently drift out of view.

**S2 · Dirty tree.** Two modified files at session start. `scripts/wave4-doctor.ps1` carried the
34-insertion edit H7 recorded as another writer's in-flight work; it is coherent and finished (a
complete fix for the H5 false-POSITIVE - the widened WMI filter was catching the desktop app's own
main process, so it now matches on `ExecutablePath` and lists non-matching candidates separately),
it had not moved in 13h and it survived a stop/restart boundary, so per S2 it was **committed**
(`1cc1200`) rather than discarded. That discharges H7 step (4). `mobile/src/health/config.ts` stays
uncommitted per the session-1 ruling (Daniel's local deployment config; mobile out of scope).

**R1.5 · Housekeeping.** STATE was **170,642 bytes**, past the 150KB threshold. Archived verbatim
into `WAVE4_ARCHIVE.md` under a dated heading: the four completed-task evidence sections (W4-004
wiring, W4-005, W4-006 pure core, W4-006 seam - 41,218 bytes) and reflection #3's evidence section
(7,742 bytes), keeping the last two reflections (#4, #5). **STATE 170,642 -> ~126KB.** Backlog rows
were again NOT archived: **W4-D16 is still open and `state-guard.js` still refuses them**, so the
same ruling as reflection #4 applies rather than a workaround. The session log was left intact this
pass too - it is the input to R6.5's pace math and is 27 single lines, and the evidence archival
alone cleared the threshold with room. `state-guard.js check`: **OK 36 rows, no regressions.**

**R2 · Verify the interval's claims.** Three `done` claims since `832bcdc`: W4-D15 (session 24) and
W4-006's two halves (sessions 25, 26). All three **hold**, and each was tested by removing the fix
rather than by reading it:

| claim | how it was falsified | result |
|---|---|---|
| W4-D15: null/degenerate baselines abstain instead of saturating stress | `WAVE4_BASELINE_ABSTENTION_DISABLED=1` restores the pre-fix coercion | **22 of 38 pins go red** |
| W4-006 seam: the regulator actually shapes the served target | stubbed `const decorated = wellbeingRegulator.apply(...)` to `= targets` in `targetsBuilder`, then restored | **8 pins go red** in `wave4.affectSeam` |
| W4-006 reachability (the hard DoD) | read the assertion rather than the count: `expect(new Set(SCRIPTS.map(s => s.target)).size).toBe(STATES.length)` plus exact set equality on the sorted ids | **no escape hatch** - a 35th state without a script fails the suite |

Two notes on method. Flipping `WAVE4_AFFECT_DISABLED` / `WAVE4_TRAJECTORY_DISABLED` from the shell
did **not** turn the seam suite red - that is correct hermetic design, not a false green: the suite
saves and `delete`s both flags in `beforeEach` and pins their behaviour explicitly, so ambient env
cannot reach it. The code stub-out above was needed instead. And one claim I expected to fail did
not: `explainTemplate.claims` naming `valence` looked like a claim on a non-existent axis (the
engine's axes read as six), which would have made those why-lines permanently dead and silent.
Executed against the real `AXIS_NAMES`: there are **seven**, `valence` is real, and **0 templates
claim a missing axis**. Inference said defect; execution said no.

**R3 · Constraint audit.** No violations. ADR-0011/0012 tripwire green in-suite; nothing in the
interval is learned, fitted or persisted from Content. Zero-knowledge: both new error paths log the
error **type** only (`e?.name`) precisely because a validation message can quote the reading that
failed it; `stateId` is written with an explicit `encrypt()`, is absent from the client DTO (pinned),
and the `[gen.targets]` log line enumerates fields individually so no new key can reach it. Superset
§0.2.5 holds (the regulator returns `{...targets, ...}`; new keys additive). Regulator-not-mirror is
**structural** - there is no path in `wellbeingRegulator` that writes `valenceTarget`. Consent gates
untouched (no consent file in the diff). Kill-switches present for the new serving-path behaviour
(`WAVE4_AFFECT_DISABLED`, `WAVE4_TRAJECTORY_DISABLED`), and their split is deliberate. **S5 checked
surface-by-surface** (the W4-D13 lesson, not by trusting the claim): `bio:affect:<userId>` is
registered explicitly in `userRedisPurge` and `wearableErasure`, and transitively in the account
cascade (`erasure.js` requires `purgeUserKeys`). It is absent from `gdprExportController` and from
the per-row retention table - and so is every other Redis family including `bio:baseline:`, all of
them covered by the cascade's generic "user-scoped Redis state". The new key follows the established
convention consistently, so this is a **no-finding**, recorded because the same check produced a
genuine defect two reflections ago.

**R4/R5 · Quality + opportunity sweep. One finding, queued as W4-D20.** W4-006's own carry-forward
note flagged `translate`'s binary `windDown` as "worth a reflection's eye rather than silent
closure"; taking it up produced a sharper result than the note assumed. The note argues the
behaviour is now personal through the taxonomy. It is not, and structurally cannot be:
`wellbeingRegulator` is monotone-tightening by construction, so a taxonomy state can wind a listener
down further but can never restore what the 21:00 constant already took. Measured, not argued -
through the real `translate` at one fixed resting reading, `energyCeiling` drops 0.71 -> 0.568 and
`acousticnessBias` rises 0 -> 0.1 the moment the *local* hour hits 21, identically for every
listener, and `night-owl-alert` can move neither number. Full row and DoD in the backlog.

**R6 · Triage.** One new row (W4-D20), well inside the max-5 cap; checked against every existing
`W4-D<nn>` by file:line rather than by title - W4-D18 is the adjacent one (the affect engine drops
the cosinor's *phase*) and is genuinely a different defect in a different module, so this is a new
row rather than a line appended to it. No `class: repair` was found, so nothing outranks the MUST
queue and **W4-007 is the next task**. One HITL raised (**H8**): whether ~272KB of wave scaffolding
merges into `main` with #179, and whether the attribution policy covers the doctor script's
`claude.exe` process-name match - a decision, not work, and nothing is blocked on it.

**R6.5 · Pace check: comfortable, no HITL needed.** `day4CutoffAt` is 2026-08-22 22:56 local; now is
2026-08-20 09:00, so **~62h remain**. Remaining MUST-tier §3 work: W4-007 (L), W4-008 (L, serial
after 007), W4-016 (M) and W4-015 (M) - about **6 owner-sessions** at the observed split (L tasks
have run 2-3 owner-sessions each: 003 = 16,17; 004 = 18,20; 006 = 22,25,26). Observed pace is ~34h
elapsed over 27 sessions = **~1.26h/session**, so ~7.6h of task work, and even at a pessimistic
2h/session it is ~12h. Reflections at the 4h cadence add roughly 15 more sessions; priced generously
at 1.5h each that is ~22h. **~34h of work against ~62h available** - the MUST tier finishes with
margin and part of the SHOULD tier is reachable. Trending correct; nothing for Daniel.

**Also done this session (R6's inline exception - reporting, not implementation).** PR #179's body
was genuinely stale: its last section was W4-006's *pure core*, with zero mentions of the seam half.
That is the single action H7 recorded as owed and deferred only because a stop signal was up; the
halt is gone and §1 authorises appending cluster notes to #179, so the seam-half section was
appended (scope table, 188/2656 -> 192/2749, both re-pins, the four reviewer notes, both
kill-switches, compliance, and what is carried forward). Body scanned for attribution before
posting: clean.

### Session log rows for sessions more than 24h old (18-21, 23)

| # | started | result line (`WAVE4_SESSION_RESULT: ...`) |
|---|---------|--------------------------------------------|
| 18 | 2026-08-19 (exec) | WAVE4_SESSION_RESULT: W4-004 in_progress â€” pure core + storage landed (VitalSample with full S5 registration and an EXTENDED completeness guard, baselineEngine, chronobiology), 136 new pins + 7 appended, suite 179/2357 green twice; four defects found in this session's own code by its own tests (Mongoose-9 pre-hook signature, `Number(null)===0` in both engines, non-robust cosinor LSQ, an unfalsifiable shift-worker test); Â§M.4 k-constant deviation derived and flagged as W4-D12; wiring half owed |
| 19 | 2026-08-19 (exec) | WAVE4_SESSION_RESULT: REFLECT done 4 verified, 0 reopened, 1 queued â€” suite 179/2357 green (exact baseline), lint 0 errors; W4-D08's reopened Suunto lane verified by executing the real webhook (resolves with truthful reject accounting), W4-D11's linter verified load-bearing by probe (1 eslint error + 3 guard pins RED), W4-004's export registration verified load-bearing by stub-out (4 pins RED across 2 suites); W4-D13 queued â€” S5 names five registration surfaces and W4-004 wrote four, leaving `VitalSample` out of `docs/PRIVACY_DECLARATIONS.md` while the Play data-safety answer still lists a nine-collection cascade the code outgrew; W4-D12 closed by ruling (k=1 is the variance decomposition, MADâ†’SD conversion verified consistent), mission Â§M.4 amended with the unit note |
| 20 | 2026-08-19 (exec) | WAVE4_SESSION_RESULT: W4-004 done â€” wiring half landed (baselines delegate to the engine so D1 finally reaches the serving path, superset blob, stale-while-revalidate, VitalSample writes, tzOffsetMinutes on all five ingest paths, D16 + steps dormant behind a consent-v2 flag, Karvonen zones via doc.save(), WAVE4_BASELINE_ENGINE_DISABLED kill-switch); W4-D13 discharged in the same PR with a standing retention-doc guard; 58 new pins + 1, suite 182/2416 green twice; six deliberate re-pins, all documented; two defects found in this session's own code by its own tests (a suite silently exercising the swallowed-failure path, and a "best-effort" worker call that was not); ATTACK-2 caught a real regression â€” the engine's population prior would have replaced translate's abstain-when-unknown, so the legacy keys now stay null on zero evidence |
| 21 | 2026-08-19 (exec) | WAVE4_SESSION_RESULT: W4-005 done â€” affect engine complete in one session (six {value,mass} evidence axes with real abstention, Karvonen exertion, personal hour-bin arousal, a SOFT rest gate that kills D3 structurally, all-taps declared fusion, the M.5 HMM and four-gate hysteresis, the AffectState DTO, ADR-0013 with the cut Borbely formula); the taxonomy is an INJECTED PORT so W4-006 stays the single source of truth for the state table; 133 new pins + ZERO re-pins, suite 184/2549 green twice; 20 mechanisms verified load-bearing by stub-out; six defects found by this session tests in its own code â€” three real (a rest gate that shut on the signal it was weighing, M.5 strong clause defeating the dwell at 20 transitions/hour == memoryless, a wall-clock field breaking replay determinism), one dead-code pair, two test defects including an anti-flap control that was measuring nothing |
| 23 | 2026-08-19 (exec) | WAVE4_SESSION_RESULT: REFLECT done 4 verified, 0 reopened, 2 queued - suite 184/2549 green (exact baseline), PR #179 CI green; W4-D15 found by execution: a null `rhrMedian` is scored as 0 bpm so stress saturates to 1.0 for any no-baseline user at rest (still 1.0 at HR 55), the profile D3/D4 exist to prevent, and `shadow.qa4`'s pin for that exact gotcha asserts only `assertTargetsSane`; W4-D16 queued after R1.5 archival collided with `state-guard`; STATE archived 204,535 -> 104,115 bytes |

## 2026-08-20 - archived by reflection #8 (R1.5; STATE had reached 247KB)

> Moved verbatim from `docs/plans/WAVE4_STATE.md`. The `Discovered backlog` `done` rows (77,953 bytes, the bulk of the
> overage) are NOT here: `state-guard.js` refuses their removal and the refusal is explicitly not suppressible (W4-D16).

### Reflection log entry #6

| # | at | interval covered | suite | verified / reopened / queued | headline |
|---|----|------------------|-------|------------------------------|----------|
| 6 | 2026-08-20 (session 33, `exec`) | `4de9a00` -> `81e1c0f` - 23 commits; tasks W4-007 (both halves), W4-016, W4-D21 | **LOCAL 196 suites / 2874 tests green, exit 0, 0 failure markers over the complete log** (exactly the recorded baseline); lint 0 errors / 22 warnings; secret + attribution scans of the interval diff clean. **CI RED:** `Backend - lint & test` fails on PR #180 and has failed on all six runs since the PR was cut | 3 verified / 0 reopened / 3 queued (1 `repair`) | **Every task claim in the interval held under stub-out - and the branch is red in CI anyway, which is the finding.** W4-D21 (2 pins red), W4-007's band abstention (10 pins red across 2 suites) and W4-016 (4 pins red) are each load-bearing; ADR-0012 tripwire 7/7; targets still a strict superset (13 legacy keys + `cadenceLocked`); all three S11 flags wired. But `tests/wave4.openHandleGuard.test.js` has been failing in CI with a byte-identical signature since W4-007 landed, invisible to three sessions because the DoD's definition of green is local (W4-D24 `repair`, W4-D25 process gap). R4 also measured a silent env-misconfiguration hazard in `tempo.js` (W4-D26). R5 found nothing new to queue and W4-008's two stated seams verified present. STATE 175,870 -> 169,736 by R1.5, still 13% over threshold - measured and appended to W4-D16 |

### Session log rows for sessions more than 24h old (24-26)

| # | started | result line (`WAVE4_SESSION_RESULT: ...`) |
|---|---------|--------------------------------------------|
| 24 | 2026-08-19 (exec) | WAVE4_SESSION_RESULT: W4-D15 done - the null-baseline stress saturation is closed at its root: `translate`'s single numeric guard coerced `null`/`''`/`false`/`[]` to 0, so SIX inputs read "no data" as "zero" and every one of them in the alarming direction (a calm resting user at a null baseline scored stress 1.0, still 1.0 at 40 bpm; null HRV, battery, readiness and sleep each collapsed recovery to 0; a null pulse produced a *measured* score of zero; and the D14 confidence ladder counted a stranger as a known user at conf 0.65 / bpmWidth 8 against 0.48 / 20). All five DoD items discharged, HRV pair nulled on its own evidence with the HRV_FALLBACK == POPULATION.hrv coincidence finally pinned, whole repair behind `WAVE4_BASELINE_ABSTENTION_DISABLED`; the (c) vacuous-pin sweep found two MORE over-claiming titles and one of them was a real sibling defect (`rhrMAD: 1e-12` -> recovery 0, stress 1.0), folded in with the engine's own MIN_SPREAD constant imported rather than copied; +40 pins, 1 deliberate re-pin, suite 185/2589 green in four of five runs with the fifth blemish recorded rather than hidden; 24 pins proven load-bearing by stub-out; W4-D17 queued (the discovery lane carries the same coercion, measured) |
| 25 | 2026-08-19 (exec) | WAVE4_SESSION_RESULT: W4-006 in_progress - pure core landed (34-state taxonomy over the affectEngine port + wellbeing regulator), 67 new pins across 3 suites, ZERO re-pins, suite 188/2656 green twice; widths are solved from per-axis roles so every state spends an identical precision budget; every state constrains all seven axes after `creative-flow` lost to `deep-focus` at its own centre through a free pass; regions re-anchored into an envelope measured over 5.8M evidence vectors after EIGHT states proved unreachable in raw units; all 34 reachable by coherent persona scripts through the real generator, baseline engine and HMM; two defects found in this session's own code by its own tests (a `degraded` flag derived from the wrong axis set, a rounding order that broke monotonicity at 1e-9) and one test found passing for the wrong reason by the stub-out battery; W4-D18/D19 queued, HITL H6 raised; prior session's `ae3937a` recorded as having landed none of the pure core its message claims |
| 26 | 2026-08-19 (exec) | WAVE4_SESSION_RESULT: W4-006 done - seam half landed and the task is COMPLETE (affect posterior store with a carry-age ruling, the ONE peek->update->save composition both lanes share, buildTargets wiring so the affect layer finally reaches the serving path, taps threaded from both real call sites, _STATE_TO_BAND derived from the taxonomy, an ADDITIVE encrypted stateId that leaves HITL H6 to Daniel, the nightly worker refresh, S13 claim-gated why-lines, both S11 kill-switches, D13's local hour with a server-offset fallback, and S5 registration for the new bio:affect: key family); 87 new pins across 4 suites + 6 appended, 2 deliberate re-pins, suite 192/2749 green twice and checkmark-free over the full log; 14 mechanisms proven load-bearing by stub-out and one found unfalsifiable and deleted rather than banked; a require cycle (moodDescriptors -> stateTaxonomy) found by a suite that would not load, and one of this session's own tests found passing for the wrong reason on a UTC+3 box |

## 2026-08-21 - archived by reflection #9 (session 47), R1.5

STATE was 249,394 bytes (66% over the 150KB threshold). Moved verbatim from the `Session log`: every row whose recorded start time is unambiguously more than 24h old. Rows 31 and 32 record a date but no time, so >24h could not be asserted for them and they stayed in STATE. The `Discovered backlog` - 120,586 bytes, 48% of the file - is still NOT archivable: `state-guard.js` reads a removed row as a dropped row (W4-D16), and the guard is right to be strict.

| # | started | result line (`WAVE4_SESSION_RESULT: ...`) |
|---|---------|--------------------------------------------|
| 28 | 2026-08-20 09:00 | WAVE4_SESSION_RESULT: REFLECT done 3 verified, 0 reopened, 1 queued - suite 192/2749 green (exact baseline), lint 0 errors, PR #179 CI all-green; W4-D15 and both W4-006 halves verified by stub-out (22/38 and 8 pins go red when the fixes are removed); W4-D20 queued: the regulator is monotone-tightening, so the personal cosinor can never lift translate's 21:00 wind-down constant; PR body seam note posted (H7 discharged), doctor script committed (S2), STATE 170KB -> 121KB |
| 29 | 2026-08-20 09:1x | WAVE4_SESSION_RESULT: W4-007 in_progress - scoring core half landed (D18): normalised weights so a maxed track scores exactly 1.0 in both modes instead of 0.95/1.20, all-Gaussian kernels with the energy sigma finally taken from the band half-width, a confidence-mass mixture that kills one-measured-dim-scores-1.0 and subsumes the flat unknown penalty, the shared octave-folded tempo metric with a cadence-anchor exception, and MMR similarity over all five dims. The M.9 formula was implemented literally first and REJECTED by two red tests: a per-doc confidence cancels out of a weighted mean, so source tiers would have been decorative. Found and fixed a live un-relaxable-band defect on the way (a track with energy measured but tempo null was hard-dropped while a fully featureless track passed - W4-D15 coercion, third copy); queued W4-D21 (fourth copy, in buildVector) and W4-D22. +69 pins across 2 new suites, 3 deliberate re-pins, kill-switch verified load-bearing by stub-out. Suite 194/2818 green twice. |
| 30 | 2026-08-20 10:2x (exec) | WAVE4_SESSION_RESULT: W4-007 done - evidence half landed and the task is COMPLETE. The golden harness (5 personas x a seeded 240-track corpus, 8 feature classes, both scorings end to end, committed JSON) paid for itself on its first run by finding a THIRD `Number(null) === 0` instance, this time on the TARGET side: an unconstrained request read as a 0-bpm/[0,0]-energy phantom, so v1's un-relaxable band kept 38 of 240 tracks and served ONLY the tracks it knew nothing about. v1's other two defects are now quantified in playlists rather than argued (9 of 20 calm slots to single-dim tracks; ZERO null-tempo tracks servable in any constrained persona). One planned invariant was DROPPED after measurement contradicted it - mean feature mass has no lawful direction once v2's pool contains the tracks v1 hard-dropped - and the reason is pinned in the file so it is not restored blind. S12 shadow-compare shipped behind SCORING_V2_SHADOW with zero-user-impact, load-bearing and never-fatal each PINNED rather than assumed. S10 caught a REAL regression on its first run (v2 at 620 ms broke the 600 ms collapse ceiling at 2.18x v1), root-caused by stage timings to `Math.log2` recomputed twice per MMR pair, fixed by publishing the log-domain entry point from `tempo.js` and memoizing per track, landing at 1.28-1.35x - and the hoist was verified behaviour-preserving by re-running the PRE-hoist modules against the POST-hoist golden. +42 pins, ZERO re-pins, suite 196/2860 green twice with 0 failure markers over both complete logs. Session also: PR #179 found MERGED by Daniel and origin/main integrated into the branch as a verified code no-op; PR #180 cut as the new running PR; a `git add -A` sweep of Daniel's local `config.ts` caught and repaired in-branch without a force-push; W4-D23 queued. |
| 34 | 2026-08-20 11:0x (exec) | WAVE4_SESSION_RESULT: W4-D24 done - the open-handle guard's "nothing leaked" self-test now measures an INJECTED snapshot instead of live ambient process state. Picked ahead of the S3 queue because `class: repair` outranks everything (S2.5 R6) and S2 step 4 forbids reflecting while a repair is pending. **The row's premise was corrected before it was fixed:** the failure is FLAKY, not deterministic - CI is GREEN on `2ae5e59`, a docs-only commit with ZERO files under `backend/`, so identical backend bytes passed once and failed six times. Seam: an optional THIRD param on `globalTeardown`, safe because jest 29.7.0 calls it with exactly two arguments (`@jest/core/build/runGlobalHook.js:109`), now pinned by its own arity tripwire. 6 new pins, 4 of them verified RED first with exact signatures; the `unrelated timer armed during the drain` pin is the DETERMINISTIC LOCAL reproduction W4-D24 said was unreachable. `IGNORED_TYPES` untouched (still frozen empty - `Timeout` never excused) and the sibling real-sampler leak test untouched, per DoD (b)/(d). Guard proven still red END-TO-END: a probe suite that passes but leaks one 60 s timer exits 1 through the real `npm test` wiring. Suite 196/2874 -> 196/2879 green twice (exit 0, 0 failure markers over the complete log both times), lint 0 errors / 22 warnings unchanged, secret + attribution + zero-knowledge scans clean, diff is 2 test-infra files. Run 1 went red on an unrelated intermittent `socket.auth.test.js` 10s timeout - control run with the diff stashed was green, attribution left honestly OPEN and queued as W4-D27; W4-D28 queued for the CI job named `lint & test` that never runs lint. |
| 35 | 2026-08-20 11:1x (exec) | WAVE4_SESSION_RESULT: W4-D27 done - the mid-session token-expiry test no longer races its own JWT. Picked ahead of W4-008 per the R6 rule that a pending `class: repair` row outranks everything (the session-32 precedent); reflection NOT-DUE (0.62h). The row's premise was corrected by measurement: the test was not slow, it HUNG - `expiresIn: '1s'` is really worth `1000 - Date.now()%1000` ms (measured exactly across 7 offsets, median 500), so under a loaded run the handshake finished after its own token died, the server rejected it, and `once(socket,'connect')` - which has no failure path - waited forever. Both remedies the row proposed would therefore have failed, since a ceiling on a hang is still a hang. Fixed by freezing the clock across the handshake (Date-only fake timers, all timer APIs left real so socket.io keeps doing real IO) and stepping it past `exp` to expire on demand - no wall-clock budget left, ceiling LOWERED 10000 -> default 5000, test 1250ms -> 11ms. Second defect closed in the same row: all 5 success-path connect awaits now fail loudly via `connected()` instead of hanging, which immediately caught the client's 2000ms connect timeout as a separate constraint. Deterministic repro captured before the fix; both guards mutation-verified. Suite 196/2883 green twice locally, lint unchanged. CI checked at close-out (the W4-D25 gap): `Backend - lint & test` on #180 is RED, but on `consentRecord.test.js`, NOT this diff - the 4 new socket.auth pins passed on the CI runner. Root-caused to a millisecond tie in `latestFor` and queued as W4-D29 (repair, MUST), not fixed here: one task per session.|
| 36 | 2026-08-20 11:4x (exec) | WAVE4_SESSION_RESULT: W4-D29 done - a consent re-grant written in the same millisecond as its withdrawal is no longer read as a withdrawal. Picked ahead of W4-008 per the R6 rule that a pending `class: repair` row outranks everything (the session-32/34/35 precedent); reflection NOT-DUE (1.20h). Premise reproduced first try against a FORCED tie; the race independently proven by two CI runs of byte-identical backend code going red then green 5 minutes apart. The row's own option (a) would NOT have fixed it - an `_id` sort is discarded by the fail-closed branch that fires first - so the fix instead reads the discriminator the `_id` already carries: same 5-byte per-process field means one writer and a counter that genuinely encodes insertion order (use it), different means two replicas and noise (fail closed to `withdrawn`, unchanged). Second defect closed in the same row: the new sort makes the old 2-row tie window fail OPEN, because it can put two grants ahead of a withdrawal sharing their millisecond - so the scan now covers the whole tied millisecond and a full window re-asks the database instead of concluding from a partial view. All three guards mutation-verified; one deliberate re-pin (the old cross-writer test simulated another replica with a locally generated ObjectId, i.e. it was not cross-writer at all). Suite 196/2887 green twice locally, 0 failure markers over both complete logs, lint unchanged. No S11 flag and no new index - both argued, not skipped. |
| 37 | 2026-08-20 12:0x-14:0x (exec) | WAVE4_SESSION_RESULT: W4-008 done - both halves in one session. MMR picked WHICH tracks; the pipeline now decides WHAT ORDER, laying the playlist along the arc W4-006's regulator has been publishing to nobody. Seven archetype curves, cost per SM.11 with the neighbour term on W4-007's folded tempo metric, dominant-axis rank-match or beam-8 seed then <=3 swap sweeps. The unmeasured-dim charge is DERIVED rather than tuned - under a uniform prior over the band, `E[(X-g)^2] = Var + (g-m)^2` and Var is permutation-invariant, so what is left is `(g(i)-m)^2` and featureless tracks drift to mid-arc with no penalty constant in the file. Wired behind the regulator's own `WAVE4_TRAJECTORY_DISABLED` (one flag, one feature), proved a byte-level no-op across all 5 golden personas x both scorers. Suite 198/2938 green twice (+2 suites, +51 pins, zero test-count re-pins); golden re-baselined and PROVED order-only - every selection statistic byte-identical, only `picks` order moved. The session's real work was adversarial: 8 implementation mutants run against the new suite, and 3 of them SURVIVED first time - the octave-fold test asserted a property true with or without folding, the seed-vs-identity guard was unpinned (a 4000-corpus sweep found the 1-in-1000 case where it matters), and the beam-8 fallback was unpinned (a 600-scenario sweep showed it wins 444, mean cost 3.673 vs 3.865). All three tests were replaced with discriminating ones before the task was called done. Perf: SO.4 S10's 30 ms is measured in a child node process at 0.82 ms/plan, because jest's sandbox is 21x slower on numeric work and asserting 30 ms against ~34 in-jest ms would police the sandbox, not the engine (W4-D30). Queued W4-D30..D33. |

### Reflection log entry #7 (archived by reflection #9, R1.5 - keep the 2 most recent)

| # | at | interval covered | suite | verified / reopened / queued | headline |
|---|----|------------------|-------|------------------------------|----------|
| 7 | 2026-08-20 18:0x (session 39, `exec`) | `2ae5e59` -> `41b8edb` - 22 commits; tasks W4-D24, W4-D27, W4-D29, W4-008 (both halves), W4-009 | **199 suites / 2959 tests green, exit 0, 1 todo, 0 failure markers over the complete 250s log** (exactly the recorded baseline); secret + attribution scans of the interval diff clean; **CI GREEN** - all 10 checks pass on the branch head `4df4ac1`, W4-009 included | 3 verified / 0 reopened / 3 queued (1 `repair`) | **W4-008's golden rebaseline claim held under measurement, and W4-009 shipped a re-serve loop nobody tested for.** The rebaseline was verified mechanically rather than read: all 10 scenario x version pick SETS are byte-identical old vs new, only the ORDER moved, and the two 1e-4 `meanFeatureMass` drifts are float summation order, which corroborates order-only rather than contradicting it. W4-D29's `sameWriter` ObjectId split is real and reasoned. The finding is W4-009: 20 of the 34 taxonomy states share `band: resting`, so the dominant regime change is policy-only, and `recalibrateForBand` is keyed `bio:<hrBand>:<activity>` - unchanged in exactly those cases, so it re-emits the identical buffer and re-records every track in the append-only serve ledger (W4-D34, `repair`). Two smaller S11/concurrency gaps behind it (W4-D35, W4-D36). R1.5 archived 18KB; STATE 230,860 -> 212,879, still 42% over, appended to W4-D16 **R6.5 pace check: healthy, no HITL raised.** `day4CutoffAt` is 2026-08-22 22:56 local, i.e. **52.7h left** at close-out. Remaining MUST-tier S3 work is **W4-015 alone** (M, always-last) - 000-008 and 016 are all `done` - so the committed scope is not at risk and R6.5's escalation condition is not met. The tail is the SHOULD/STRETCH queue (W4-010 M, W4-011 L, W4-012 M, W4-013 M, W4-014 L ~ 7 owner-sessions) plus 20 open discovered rows; at the observed ~1.1h/session over 38 sessions and ~13 reflections' worth of the remaining window, that tail is roughly at capacity rather than comfortably inside it. Recorded as a projection only - which SHOULD/STRETCH work lands is Daniel's call, not a reflection's, and nothing is being cut here. |

## 2026-08-21 - archived by reflection #10 (session 52), R1.5

STATE was 304,083 bytes - 103% over the 150KB threshold and the largest it has ever been. Moved verbatim (no summarisation; provenance matters) from the `Session log`: every row whose recorded session END time is unambiguously more than 24h before this pass opened (2026-08-21 ~20:4x local). Session 43 is deliberately KEPT despite the gap it leaves between 42 and 44 - it ran 20:4x-21:5x, which is inside the window, and the rule is the clock, not the row number. Also moved: `Reflection log` entry #8, leaving the two most recent (#9 and this pass's #10) in STATE as R1.5 requires.

**The dominant cost was NOT archivable and that is the finding, not an excuse.** The `Discovered backlog` is 134,861 bytes - 44% of the whole file, more than the Task table - and R1.5 asks for its `done`/`closed` rows. `state-guard.js` classifies that table as a TASK table (its header carries both `id` and `status`), and a removed row is a `removed` violation that the guard explicitly documents as NOT suppressible by `REOPENED`. So the single biggest lever R1.5 has is unexecutable as written - W4-D16, still open, with this pass's measurement appended to it.

| # | started | result line (`WAVE4_SESSION_RESULT: ...`) |
|---|---------|--------------------------------------------|
| 31 | 2026-08-20 (saver) | WAVE4_SESSION_RESULT: W4-016 done - LLM candidate-generation band now routed through `biometricBand`'s real preference chain instead of raw HR alone. Picked under `WAVE4_MODEL_TIER=saver`: W4-008 (next in queue order) is an L design task, so per the model-economy rule the first unblocked MUST-tier S/M task was taken instead - W4-016 (M), eligible since W4-004 and now able to deliver its FULL value since W4-006 (stateLabel) is also done. `biometricBand` itself untouched (per spec); only its two callers in `geminiEngine.js` (`_buildBiometricPrompt`, `adjustBiometricPlaylist`) and the one real call site in `biometricHandler.js`'s HR branch now feed it a populated context - `stateLabel` reused from `bandTargets.stateId` (already computed earlier in the same request when `DISCOVERY_BAND_AWARE` is on, not recomputed) and `hrRatio` from `peekBaselines(userId).rhrMedian` against the live HR. Both additive/best-effort: cold start degrades to byte-identical `{heartRate, activity}` (pinned). Kill-switch `WAVE4_LLM_BAND_FROM_STATE_DISABLED` honoured at both geminiEngine call sites AND in biometricHandler.js (skips the peekBaselines read entirely, mirroring the WAVE4_AFFECT_DISABLED convention) - pinned byte-for-byte AND that peekBaselines is never called while set. Prompt egress re-verified clean via the existing SENTINEL_BIO fixture. +12 new pins across 3 existing suites, ZERO re-pins, suite 196/2860 -> 196/2872 green twice, 0 failure markers both full runs. Lint 0 errors/22 warnings unchanged. Secret + attribution scans of the diff: clean. Landed in `9e9284d`; PR #180 (the open running PR) owed this cluster's body note next session. |
| 32 | 2026-08-20 (saver) | WAVE4_SESSION_RESULT: W4-D21 done - discovered-backlog repair, picked ahead of the reflection trigger and ahead of W4-008 per Â§2 step 4 (a pending `class: repair` row means fix the tree first). `embedding.buildVector`'s `fin()` now delegates to `featureProvider.measured()` instead of `Number.isFinite(Number(x))`, so a null AudioFeature dim (the schema default for anything unmeasured) abstains to the neutral fill instead of coercing to a measured zero - an all-null doc no longer embeds as `[0,0,0,0,0,1]` (maximum loudness). TDD: 2 new pins in the existing `vectorLayer.test.js` suite, confirmed RED against the pre-fix code before the edit, both GREEN after. Blast-radius check found the live discovery serving path (`buildTargetVector`) never actually hits this bug today - `discoveryFetch.js`'s own `num()` helper (W4-D17, queued separately) converts a null to `0` upstream before it ever reaches `buildVector` - so this fix is presently scoped to `embedding.worker.js`'s corpus writes only; judged no S11 kill-switch needed (pure bug fix, byte-identical for every fully-measured doc, no new mechanism). Existing stored vectors stay uncorrected until a corpus re-embed; the lever already exists (`reembedCorpus.js`) and running it against prod is Daniel's call, raised as HITL H9. Full consumer sweep (targetVector, discoveryVectorService, discoveryBandAware/Pipeline/Integration, measureDiscoveryComposition, both embeddingWorker gate suites, featureProvider - 105/105) green. Suite 196/2872 -> 196/2874 green twice, 0 failure markers both full runs (239.5s, 221.7s). Lint 0 errors/22 warnings unchanged. Secret + attribution scans of the diff: clean. Landed in `201289a`. |
| 33 | 2026-08-20 13:1x (exec) | WAVE4_SESSION_RESULT: REFLECT done 3 verified, 0 reopened, 3 queued - local suite 196/2874 green (exact baseline), lint 0 errors, secret + attribution scans clean, ADR-0012 tripwire 7/7, targets superset intact; all three interval tasks verified LOAD-BEARING by stub-out (W4-D21 2 pins red, W4-007's band abstention 10 pins red, W4-016 4 pins red). **The finding is that CI is RED and has been for six consecutive runs / ~3 hours / three sessions**: `wave4.openHandleGuard.test.js`'s own "nothing leaked" self-test calls the real end-of-run teardown MID-run and asserts that no unrelated suite armed a Timeout during its 250 ms drain - deterministic on CI (identical `2 before, 3 after` at test counts 2860/2872/2874), green locally, and not reproducible here even replaying the full 28-suite CI prefix in CI order. Queued W4-D24 (`repair`, top of queue), W4-D25 (close-out never checks CI - 14 W4-007 commits landed with no PR open at all) and W4-D26 (`tempo.js` reads two constants from env unvalidated; `SCORE_SIGMA_BPM_OCT=abc` makes every tempoKernel NaN and silently drops the 0.35-weight bpm dim from every track's fit - measured). R5 clean; W4-008's seams verified present. R1.5 archived 18 session rows + reflections #3/#4 (175,870 -> 169,736 bytes) and MEASURED that R1.5 cannot reach its own 150KB threshold - appended to W4-D16 rather than opening a fourth row. |
| 38 | 2026-08-20 (saver) | WAVE4_SESSION_RESULT: W4-009 done - taxonomy-state-triggered recalibration lands, replacing D11's interim HR-band gate as the primary trigger for live users while keeping that gate as the fail-soft fallback. `liveStateAdapter.onlineUpdate` reuses `affectService.resolveAffect` end to end (same `bio:affect:` Redis key as W4-006, one posterior per user) and adds only the regime-change decision (band or musicPolicy differs on a CONFIRMED transition); min-dwell is free, already enforced inside affectEngine's existing hysteresis. Fail-soft is structural, not a degradation path: `getRedis()` is checked before any engine work runs, so a down Redis never turns into a noisy per-reading reclassification. Wired fire-and-forget into `handleBiometricReading` ahead of the immediate/debounce split, gated by the SAME `WAVE4_RECAL_STATE_TRIGGER_DISABLED` flag W4-D05 reserved for this task. +1 suite (`liveStateAdapter.test.js`, 15 pins: Redis-down short-circuit, full regime-change matrix against a mocked resolveAffect, policyDiffers unit cases, two real-engine end-to-end round-trips through a fake Redis) +6 pins appended to `biometricHandler.pipeline.test.js` (zero re-pins to its ~150 existing pins — the module mock defaults to a no-op). One wiring line mutation-verified. Suite 198/2938 -> 199/2959 green twice, 0 failure markers both complete logs; one unrelated pre-existing flaky wall-clock perf assertion (`score.v2.golden.test.js` S10) recorded honestly on the first of three runs. Lint/secret/attribution/zero-knowledge all clean. |
| 39 | 2026-08-20 17:0x-18:2x (exec) | WAVE4_SESSION_RESULT: REFLECT done 3 verified, 0 reopened, 3 queued - suite 199/2959 green (exact baseline), CI green on `4df4ac1`; W4-008 golden rebaseline proved order-only by set comparison; W4-009 re-serves the same buffer on policy-only regime changes (W4-D34 `repair`) |
| 40 | 2026-08-20 15:1x-16:0x (exec) | WAVE4_SESSION_RESULT: W4-D34 done - a policy-only taxonomy regime change no longer re-serves the buffer it is already serving. Picked ahead of W4-010 (the first pending S3 row) per the R6 rule that a `class: repair` row outranks everything - the session-32/34/35/36 precedent; reflection NOT-DUE (0.05h old). The row's premise held byte-for-byte. Beyond it, the fix had to decide three things the row left open, each now pinned: a null key CLEARS rather than matches the latch (or the unkeyed legacy path goes silent forever), a non-bio `playlist_ready` clears it too (or a mood request strands the socket) - which also closes the unnamed second half, a `heart` generation followed by a policy-only transition at the same key - and a thrown serve releases the claim. Kill-switch `WAVE4_SERVE_LATCH_DISABLED` deliberately separate from `WAVE4_RECAL_STATE_TRIGGER_DISABLED` so W4-D35's complaint does not get worse. +9 pins (4 red pre-fix, 5 guard rails), suite 199/2968 green twice, handler suite 149/149 in isolation, lint/secret/attribution/zero-knowledge all clean. Pushed; PR #180 body appended. Close-out CI check found three jobs red on a 403 `Resource not accessible by integration` (gitleaks + both mobile jobs) - pre-existing from `9ff137d`, not this diff; queued as W4-D37 + HITL H10 rather than guessed at inline. |
| 41 | 2026-08-20 16:0x-17:1x (exec) | WAVE4_SESSION_RESULT: W4-D37 done - the CI secret scan is executing again, and the scopes that let it are now in the repo instead of in a settings page. Picked ahead of W4-010 (still the first pending S3 row) per the R6 rule that a `class: repair` row outranks everything - the session-32/34/35/36/40 precedent; reflection NOT-DUE (0.76h old). Took the in-repo route H10 step 3 already nominated, so no portal action was needed: `permissions: {contents: read}` at workflow level in both workflows, `{contents: read, pull-requests: write}` on `secret-scan` (write because gitleaks calls `pulls.createReviewComment` to annotate a finding - verified in its own `src/gitleaks.js:263`, so read-only would turn a real leak into an opaque 403) and `{contents: read, pull-requests: read}` on `mobile-android-compile`. Guard `ciWorkflowPermissions.test.js` derives the requirement from the actions a job actually runs and pins that the parser still finds all six real jobs, so it cannot pass vacuously - 3 of 6 pins red before the fix, all green after. Suite 200/2975, green twice, exit 0 both, zero re-pins. On the fresh push gitleaks went fail-at-8s -> PASS-at-9s and Android compile passed a FULL Gradle run. **The row's premise was wrong about its third job and the session says so rather than closing over it:** `Mobile - jest` never was the 403 - its 1304 tests pass and jest then exits 1 - and it stayed red after the fix, so it is split out as W4-D38 with the tree/env/output-identical evidence and the five hypotheses already ruled out. Noticed in passing, for the next reflection: STATE has TWO entries numbered H10 (this portal check and a W4-008 on-device item), so the HITL ids are no longer unique. |
| 42 | 2026-08-20 17:2x-18:5x (exec) | WAVE4_SESSION_RESULT: W4-D38 done - a jest run where every test passes and the process still exits 1 is explained and closed, and CI is fully green for the first time since 13:41. Picked ahead of W4-010 (still the first pending S3 row) per the R6 rule that a `class: repair` row outranks everything; reflection NOT-DUE (1.28h old). Root cause is a test, not the toolchain: `UpNextSheet.render.test.tsx` leaves a 50-row `FlatList` mounted, and `VirtualizedList`'s 50 ms cell-batching timer outlives the suite's 20 ms settle, fires during the NEXT file, and `jest-runner`'s `freezeConsole` latches `process.exitCode = 1`. **Why it read as impossible:** that latch is swallowed in a worker and fatal in band, so the verdict depended on the runner's vCPU count - measured both ways locally (parallel EXIT=0 / `--runInBand` EXIT=1 on identical passing tests), and the CI logs show every red is a serial-shaped run in a different Azure region while the last green was parallel-shaped, with a set-diff of the two complete job logs returning nothing but run-identity noise. Red-first pin: a `beforeEach` cleanup invariant reading `1` before the fix and `0` after. The green CI run is in the SAME region and the SAME in-band shape as the reds, so it is the fix and not a lucky machine. Backend 200/2975 exit 0 (exact baseline), mobile eslint clean, secret + attribution scans clean. Two one-line notes left for the next reflection: W4-D39 (nothing runs mobile jest in band, so this leak class stays latent) and W4-D40 (the mobile suite is not green on Windows, so there is no local mobile gate). |
| 44 | 2026-08-20 17:5x-19:0x (exec) | WAVE4_SESSION_RESULT: W4-D41 done - a recalibration whose generation exits without serving now hands the key back, so a Live-mode listener who reconnects Spotify gets music again instead of silence for the life of the socket. Picked ahead of W4-010 (still the first pending S3 row) per the R6 rule that a `class: repair` row outranks everything - the session-32/34/35/36/40/41/42 precedent. Reflection NOT due (`reflect-marker.js check` = `NOT-DUE fresh (0.05h old)`, stamped by session 43 three minutes earlier), so this was an execute session. S2: `mobile/src/health/config.ts` dirty as always - left in place uncommitted per the standing session-30 ruling, and every `git add` in this session named its paths explicitly rather than `-A`. Suite 200/2980 exit 0; the one red run in between was two in-jest perf budgets on untouched modules under self-inflicted machine contention, reproduced green in isolation and green again on a clean foreground rerun - recorded in testBaseline rather than waved off. |

| # | at | interval covered | suite | verified / reopened / queued | headline |
|---|----|------------------|-------|------------------------------|----------|
| 8 | 2026-08-20 20:5x (session 43, `exec`) | `41b8edb` -> `184fa0d` - 12 commits; tasks W4-D34, W4-D37, W4-D38 | **200 suites / 2975 tests green, exit 0, 1 todo, 0 failure markers over the complete 14,324-line log** (exactly the recorded baseline); lint 0 errors / 22 warnings (unchanged); secret + attribution scans of the interval diff clean; ADR-0012 tripwire, `ciWorkflowPermissions` and `openHandleGuard` all PASS; **CI GREEN** - all 10 checks pass on the exact branch head `184fa0d`, which is also PR #180's head | 3 verified / 0 reopened / 1 queued (1 `repair`) | **All three interval claims hold - and the W4-D34 fix that closed a duplicate serve opened a silent MISSING serve, which is the finding.** W4-D37 and W4-D38 are verified externally rather than by assertion: `Security - gitleaks secret scan` passes in 10s and `Mobile - jest` passes in 2m17s on the very commit under review, which is the thing both rows existed to restore. W4-D34's latch is present and its ten pins are real. But it claims the key BEFORE the serve and releases it on only two of six exits, and the release it added is gated on `bioServeKey`, which is assigned too late to witness the four early exits (`!user`, `!provider`, `!musicProfile`, wall-clock timeout) - `generateAndEmitPlaylist` is try/finally with no catch, so those neither throw nor clear. Reproduced by measurement rather than by reading: 0 buffered serves after recovery where 1 is owed, and 1 with `WAVE4_SERVE_LATCH_DISABLED=true`, isolating the latch as the cause; scratch reverted, tree clean. Queued as W4-D41 (`repair`). R5 found nothing else worth a row and none was manufactured. **R1.5: 246,981 bytes, 65% over threshold** - archived reflection #6 and session rows 24-26, which is all the rule permits - and that is only **4,635 bytes**, while this entry and W4-D41 add ~7.3KB, so STATE went 246,981 -> **249,676** and R1.5 now loses ground every pass; the 77,953 bytes of `done` backlog rows remain undeletable under `state-guard`; re-measured and appended to W4-D16 rather than opening a fourth row for it. **R6.5 pace check: healthy, no HITL raised.** ~50h to `day4CutoffAt`; remaining MUST-tier S3 work is still **W4-015 alone**, so the committed scope is not at risk and R6.5's escalation condition is not met. The SHOULD/STRETCH tail (W4-010/011/012/013/014 ~ 7 owner-sessions) plus W4-015 fits; the 22 open discovered rows will not all drain, which is the same read as #7 and still Daniel's call, not this session's. |

## 2026-08-22 - archived by reflection #11 (session 58), R1.5

STATE was 358,461 bytes on entry, 139% over the 150KB line and its all-time high. Moved here verbatim:
the 7 session-log rows unambiguously older than 24h (43, 45, 46, 47, 48, 49, 50) and reflection entry #9.
The Discovered backlog - 155,388 bytes, 43% of the file - stays in STATE, still blocked by W4-D16.

### Session log rows (verbatim)

| # | started | result line (`WAVE4_SESSION_RESULT: ...`) |
|---|---------|--------------------------------------------|
| 43 | 2026-08-20 20:4x-21:5x (exec) | WAVE4_SESSION_RESULT: REFLECT done 3 verified, 0 reopened, 1 queued - suite 200/2975 green at the exact baseline, lint unchanged, CI all-10-green on the reviewed head `184fa0d`; W4-D37/W4-D38 verified by the real jobs passing rather than by assertion; W4-D34's latch is claimed before the serve and released on only two of six exits, so a failed cold-key generation strands the dominant `bio:resting:resting` key for the life of the socket (W4-D41 `repair`, reproduced 0-vs-1 against the kill-switch); R1.5 could legally archive only 4,635 bytes against ~7.3KB written, so STATE GREW 246,981 -> 249,676 and the 78KB that matters stays blocked on W4-D16 |
| 45 | 2026-08-20 21:5x-23:1x (exec) | WAVE4_SESSION_RESULT: W4-010 done - the taste profile stops being a frozen snapshot ranked by row count. Picked as the first pending S3 row: the MUST tier is complete, W4-015 always runs last, and for the first time since session 31 no `class: repair` row was pending, so the R6 precedence that put W4-D34/D37/D38/D41 ahead of it had finally lapsed; reflection NOT-DUE (0.75h old). Four defects, one commit: affinity now decays at read time against a real `lastSeenAt` recovered from the `played_at`/`added_at` the Spotify fetchers were throwing away with the wrapper item; provider influence saturates with log1p so a 2000-row import no longer out-votes a curated 50-track history 40:1; `recomputeFootprint` stopped being a second, disagreeing algorithm; and the genre term gained a same-family rung from a new static 15-family taxonomy, in v2 only, pinned never to lower a track's fit below v1. The session's own regression is on the record: the first full run went RED on `playlistMixer.fallback.test.js` because the decay projection manufactured `affinity: 0` on legacy `listenCount`-only rows and broke the mixer's `??` chain - the Number(null)===0 trap again, found by the suite, fixed, and pinned. Every fix stub-out-verified load-bearing (3 / 2 / 5 pins red without it). 201 suites / 3015 tests green (+1 suite, +35 pins, zero re-pins), lint unchanged, secret + attribution scans clean. Queued W4-D42 (the backfill branch is the last path still ranking taste a third way). |
| 46 | 2026-08-20 23:2x-2026-08-21 0x:xx (saver, interactive) | *(no result line was ever recorded - reconstructed by reflection #9 from the task row and HITL H11.)* W4-012 done - daily analysis + MorningState landed (`8b5f632`, `6a4e6da`), DoD fully met and re-verified this pass at 204/3042. An EMPTY `docs/plans/WAVE4_HALT` appeared mid-session (H11, the H7 pattern), so the session committed locally and deliberately did NOT push or cut a PR. The halt file is GONE as of session 47's preflight; the deferred push was completed by reflection #9 per H11's own step (1). |
| 47 | 2026-08-21 12:5x-1x:xx (exec) | WAVE4_SESSION_RESULT: REFLECT done 3 verified, 0 reopened, 3 queued - suite 204/3042 green at the exact W4-012 baseline (header was still showing session 45's 201/3015 and is corrected), lint 0/22, secret + attribution scans clean, PR #180 all-10-green; W4-012's schema-keys guard verified load-bearing by stub-out; MorningState found to be WRITE-ONLY and the nightly job to consolidate only the first 500 users forever; H12 raised for its unguarded prod indexes. |
| 48 | 2026-08-21 10:2x-1x:xx (exec) | WAVE4_SESSION_RESULT: W4-011 in_progress - half 1 of an L task landed: the feedback loop pure core, both ADR-0012 collections and the complete S5 registration. Picked as the first pending S3 row with deps done (MUST tier complete, no `class: repair` row pending, reflection NOT-DUE at 0.05h). The judgement is two instruments that fail in opposite directions - biometric (honest, blind to taste) and behavioural (honest about taste, easily confounded) - combined 0.6/0.4, and a NO-OP rather than a zero when neither exists. Two things worth Daniel eye: M.12 own operand order is transposed and produces the WRONG SIGN for this task own DoD scenario, so the code implements the corrected form and pins that the two disagree (W4-D47 raised for the mission text); and ADR-0012 "schema-level validator" had to become a query PRE-HOOK, because Mongoose validators do not run on the upsert verbs a feedback loop actually writes with - five pins drive real non-CC0 writes through every verb without `runValidators` and each is refused. 206/3106 green twice, +64 pins, zero re-pins, lint clean, 8 of 8 mutants caught. The wiring half (`playback_event` + S7 boundary, the play-window tracker, the worker lane, the S11 kill-switch) is owed next session and is spelled out in the task row. |
| 49 | 2026-08-21 14:1x-1x:xx (exec) | WAVE4_SESSION_RESULT: W4-011 done - the wiring half lands, so the feedback loop is complete and a listener verdict finally reaches the two learned artifacts. Continued the in_progress L task rather than starting a new one; reflection NOT-DUE (0.96h), origin/main unmoved, no pending `class: repair` row. The decision the rest hangs off: the judgement runs on the SOCKET side and only its RESULT crosses the queue, because a BullMQ payload is an unencrypted Redis blob and 0.2.2 bars numeric vitals from Redis - so a bucket address, one bounded scalar and a CC0-only Beta delta travel, and the payload key set is pinned closed against ever carrying a sample again. Three things are argued rather than assumed and each is pinned: `save` is NOT terminal (a saved track keeps playing, and if it closed the window the engine own "completed AND saved" case could never occur); the samples are RAW device values, not the Kalman level, because the reward sigma is an OLS standard error that only means anything for independent observations; and `positionMs` anchors the sample window, which self-corrects the client that never reported the previous track at all. S5 has nothing new to register and that was VERIFIED against `userRedisPurge` namespaces rather than assumed - the play window is process memory precisely so no vital reaches Redis. 209 suites / 3214 tests green, exit 0, 0 failure markers over the complete log; +3 suites, +108 pins, ZERO test-count re-pins (one deliberate assertion re-pin inside an existing `it()`, argued in the task row and strictly stronger than what it replaced). Handler suite 169/169 in isolation per R1. Lint/secret/attribution/zero-knowledge clean. Five mutants, all caught. Queued W4-D48 (a pending queue job is user data no erasure path reaches - pre-existing, noticed in passing). |
| 50 | 2026-08-21 14:0x-1x:xx (exec) | WAVE4_SESSION_RESULT: W4-013 in_progress - half 1 of the row (B5, the novelty bandit) landed as a complete vertical: engine, storage, write lane and read lane. Picked as the first pending S3 row with deps done (MUST tier complete, no pending `class: repair` row, reflection NOT-DUE at 1.71h, origin/main unmoved at 44fd951). S2: `mobile/src/health/config.ts` dirty as always - left in place uncommitted per the standing session-30 ruling, and every `git add` this session named its paths explicitly rather than `-A`. The decision the rest hangs off is an argued DEVIATION from M.14: the bandit abstains rather than sampling its Beta(2,2) prior, because a draw off an untouched prior carries no information and would cap a real listener's playlist at a share that rerolls every generation - so the dormancy invariant is a property of the maths and not of the flag, pinned both flag-off and flag-on-with-a-prior. Storage went onto the existing W4-011 bucket row rather than into a new collection (same address, same TTL, same S5 registration; W4-011's closed-key pin passes untouched because the field is absent until earned). Two things the mutation pass found and this session acted on rather than banked: a guard in `rewardDispatch` that was provably dead (equivalent mutant - deleted, containment re-verified where it actually lives) and a test fixture whose 40-track library meant discovery never reached the playlist, so four quota assertions had been passing vacuously at zero - fixture cut to 15 and a CONTROL test added. 213/3290 green twice, +76 pins, one additive re-pin, lint clean, 10 of 10 mutants caught, handler suite 169/169 in isolation. B7 (PersonalWeights + the M.15 trust region + its own five S5 surfaces) is owed next session. **S2 footnote for whoever picks this up:** an UNTRACKED `docs/CLAUDE_DESIGN_PROMPT.md` (18KB, a ground-up UI/UX design brief) appeared in the tree at 15:43, mid-session, written by something other than this session - the H2/H5 concurrent-session pattern again, benign this time. It was inspected (no secrets) and deliberately NOT committed, staged or deleted: it is someone else's in-flight work and S2/R2 both say never build on leftovers you do not understand. It touches nothing in this wave's scope. |

### Reflection log entry #9 (verbatim)

| # | at | interval covered | suite | verified / reopened / queued | headline |
|---|----|------------------|-------|------------------------------|----------|
| 9 | 2026-08-21 12:5x-1x:xx (session 47, `exec`) | `7a46468` -> `6a4e6da` - 10 commits; tasks W4-D41, W4-010, W4-012 | **204 suites / 3042 tests green, exit 0, 1 todo, 0 failure markers over the complete 14,595-line log** (418s, `--runInBand`); lint 0 errors / 22 warnings unchanged; secret + attribution scans of the whole interval diff clean (the only two hits are prose - `sk-` inside "risk-register" and a `claude.exe` process name in H11's diagnostic steps, which is tooling, not attribution, and matches §0.4 S1's own `claude --version`); PR #180 all 10 checks green on `4633ea4`. | **3 verified, 0 reopened, 3 queued - W4-012 is real but write-only, and the run's biggest tax is now its own STATE file.** **R2:** W4-D41 and W4-010 were already CI-green on the exact pushed HEADs; W4-012 was the unverified one (unpushed, no CI) and it holds - its claimed suite figure reproduced EXACTLY on an independent run, and its sleepDebt schema-keys guard was confirmed load-bearing by stub-out (renaming `debt` -> `value` in `MorningState.js` turns it red, reverted). W4-010's "both real read seams" claim also checked out by following the third candidate: `deterministicFallback`'s T2 tier delegates to `generateFallbackPlaylist`, which is already wired, and T0/T1 go through the pipeline's `_partitionLibrary`. One W4-012 WORRY was dismissed rather than queued: its row warns that the hardcoded erasure/export model lists in five pre-existing tests "are not mechanically guarded" - but `shadow.qa4.crypto.test.js`'s Q3 block auto-discovers every model with a `userId` field off the models directory and fails the build if erasure, `gdpr-delete.js`, the Art.15 export or the wearable-scoped erasure misses it, so the mechanical guard does exist and those lists are duplicates that fail loudly, not a gap. **R3:** clean - S5 registration verified on all five surfaces for MorningState, and the Redis-purge registry checked family-by-family against every `prefix:${...}` in `backend/app` (the S14/W4-009 "live HMM forward vector" shares `bio:affect:<userId>`, already registered; `user:` is a socket.io room and `spotify:playlist:` is a context URI, neither a Redis key). One Pause & Guide bookkeeping gap: W4-012 shipped two prod indexes with no HITL entry -> **H12** raised, and unlike H4 it is not purely performance, because the unique `{userId,date}` index is the only thing stopping a retried nightly run from double-writing a night into the sleep-debt accumulator. **R4/R5 -> R6, 3 rows:** **W4-D43** (MorningState is write-only - §0.4 S14's Pulse surfacing was never built, and a grep for readers outside the model/worker/privacy surfaces returns three comments and zero reads; carries W4-012's own honest deferral so binding §0.4 scope does not evaporate); **W4-D44** (the nightly job takes the first 500 MedicalProfiles by `_id` from a population that never shrinks, so the same oldest 500 win every night forever while the newest users are silently starved - the three sibling repeatable jobs all batch a self-advancing due-set, which is the pattern this one copied without); **W4-D45** (the CUSUM drift flag never reaches `fatigueAxis`, whose only trend input is the acute-vs-chronic snapshot the detector's own header explains is a weaker instrument). **R1.5:** STATE is 249KB, 66% over the line. Archived the 7 session-log rows unambiguously older than 24h into `WAVE4_ARCHIVE.md`; the `Discovered backlog` is now **120,586 bytes, 48% of the file** and still blocked by W4-D16's guard contradiction, so a third measurement was appended to that row instead of a new one - archiving it alone would take STATE ~249KB -> ~129KB, which makes the guard fix SUFFICIENT on its own for the first time (reflection #6 could only say necessary). **R6.5:** no pressure - Daniel extended `day4CutoffAt` to 2026-08-31 mid-session via a new `scripts/extend-cutoff.ps1`, ~10 days out, and the only MUST-tier §3 row left is W4-015, which always runs last. That extension is also what promotes W4-D16 from tidiness to economics: ~245KB of read tax now compounds over ten more days of sessions. **Housekeeping:** session 46 never wrote its session-log row (the halt interrupted it) - reconstructed and labelled as such; the `testBaseline` header still read session 45's 201/3015 and now reads the verified 204/3042; W4-012's deferred push was completed per H11 step (1) now that the halt file is gone. One inline fix under the R6 exception (`e0afbae`): the `WAVE4_AFFINITY_DECAY_DISABLED` comment promised "no revert and no restart" while the flag is memoized at first read - it is the only one of the 12 S11 kill-switches that is, so the comment was corrected rather than the behaviour changed. |
