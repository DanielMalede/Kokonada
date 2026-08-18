# WAVE4_STATE — machine-updated run state

> The SINGLE resume source for the Wave-4 run. Every session reads this first and updates it before exiting.
> Rules: update via small, surgical edits; never delete history sections; keep the task table authoritative.

## Run header

- phase: execute           <!-- review | execute | closeout | halted — H2 closed 2026-08-19 (see HITL queue) -->
- branch: feat/intelligence-wave   <!-- created from origin/main (== local main, in sync) in session 1 -->
- lastMainSha: 1a1657ea4bae1f48a6de4e2dd29b3f2a14d02010
- testBaseline: **164 suites / 1802 tests** green after W4-001 (was 163/1767 after W4-000; +1 suite `wave4.bugfix.test.js` with 34 pins, +1 re-pin in `biometricHandler.pipeline.test.js`). ~80s, exit 0. Prior baseline text: 163 suites / 1767 tests green (162 product suites: 1759 passed + 1 todo, plus adr0012.tripwire.test.js), ~60s, exit 0 without --forceExit, --detectOpenHandles silent. Established 2026-08-19 after the worker.test.js real-connection-leak fix (injected queue seam). Real root cause was more specific than S1a guessed: backend/.env sets GLOBAL_SEED_INGEST_ENABLED=true and worker.js loads it with override:true, so the success-path tests reached a real ioredis dial against the fake host — not merely "no local Redis".
- missionVersion: 2026-08-18 (as approved by Daniel; amended by W4-000 review deltas, same date)
- runStartedAt: 2026-08-18T22:56 local (session 1)
- day4CutoffAt: 2026-08-22T22:56 local (runStartedAt + 96h; after this, only W4-015 may run)
- reflectIntervalHours: 4   <!-- §2.5 recurring reflection pass; trigger state in logs/wave4/last-reflect.txt -->

## Task table

| id | title | tier | size | deps | status | owner-session | notes |
|----|-------|------|------|------|--------|---------------|-------|
| W4-000 | Bootstrap, review pass, ADR-0012 | MUST | S | — | done | 1,3 | review pass + S1 preflight + worker.test.js leak fix + green baseline (163/1767, see testBaseline above) + ADR-0012 + tripwire all landed in `d1db088`. ADR filed as `docs/adr/0012-learning-compliance.md` matching the repo's existing `000N-kebab-title.md` convention (not the mission text's `ADR-0012-…` — intentional call, ADR README index refreshed). Docker is NOT installed on this machine — S1a's `docker-compose up` path is not viable here (moot: the injected-queue-seam fix superseded it). |
| W4-001 | Surgical bug backlog (D3,D4,D5,D7,D8,D9,D11i,D14,D17,W8/W9) | MUST | M | 000 | done | 5 | all 10 sub-fixes landed (`f2add0e`→`b92aee3`). Suite **164 suites / 1802 tests** green (baseline 163/1767: +1 suite `wave4.bugfix.test.js`, +34 new pins, +1 re-pin). 3 deliberate re-pins, see below. Shared HR predicate extracted to `app/services/wearable/hrRange.js`; `WATCH_HR_DELTA_THRESHOLD` retired (subsumed by the band trigger). |
| W4-002 | Synthetic-human simulator + replay | MUST | L | 000 | pending | — | |
| W4-003 | A0 signal integrity + live persistence | MUST | L | 001,002 | pending | — | |
| W4-004 | A1+A2 baselines & chronobiology v2 | MUST | L | 003 | pending | — | superset blob = HRV fix |
| W4-005 | A3 affect engine core (axes+HMM) | MUST | L | 004 | pending | — | |
| W4-006 | A4 taxonomy + A5 regulator + seam | MUST | L | 005 | pending | — | reachability = hard DoD |
| W4-007 | B2 scoring & similarity rebuild | MUST | L | 001 | pending | — | eligible early if bio track stalls |
| W4-008 | B4 trajectory planner | MUST | L | 007 | pending | — | |
| W4-009 | A7 live analysis + state-triggered recalibration | SHOULD | M | 006 | pending | — | |
| W4-010 | B1 taste profile v2 | SHOULD | M | 001 | pending | — | |
| W4-011 | B6 feedback loop + RewardEvent | SHOULD | L | 003,006 | pending | — | mbid:-only guard |
| W4-012 | A6 daily analysis + MorningState | SHOULD | M | 004 | pending | — | |
| W4-013 | B5+B7 bandit + PersonalWeights | STRETCH | M | 011 | pending | — | ships dark |
| W4-014 | B3 embedding v2 dual-write | STRETCH | L | 007,W16 | pending | — | cutover HITL-blocked |
| W4-015 | Soak, closeout & package | MUST | M | any | pending | — | ALWAYS runs last |

## Review deltas (filled by W4-000)

Session 1 (2026-08-18, plan tier) — full-repo validation of the mission. All six flagged unknowns resolved; spot-checked defect refs D1–D5, D7–D9, D11, D13–D15 verified byte-accurate against source.

- (a) **W16 / embedding.worker.js:** stored vectors ALREADY genre-free (`buildVector(doc, [])`, PR #139 dilution fix; only `mbid:` keys reach the index). D19 is latent in `buildVector`, not live in the index → W4-014 spec amended in the mission (genre block = deliberate re-introduction; corpus ~98% genre-less → IDF must handle df≈0; `docs/plans/mbid-representation-recalibration-vs-genre-seam.md` (tracked draft, 2026-07-15, measured prod evidence) is required reading).
- (b) **discoveryFetch.js:** adapter confirmed — `extractTargetFeatures(aiParams)` → `{bpm, energy, valence, acousticness, danceability}`; `biasToBand` re-centers the query on `{bpmCenter, energyFloor/Ceiling, valenceTarget, acousticnessBias}`; `DISCOVERY_FEATURE_ONLY_TARGET` default ON; dormant genre-Jaccard scoring seam behind `DISCOVERY_GENRE_RELEVANCE`.
- (c) **audioFeatureRepo.js:** upsert precedence api > acousticbrainz > llm (filter excludes higher sources + swallowed E11000; measured sources write through to Redis, llm invalidates) — W4-007's source-tier confidences (1.0/0.85/0.7) align with the real enum.
- (d) **queues/definitions.js:** frozen QUEUES map + QUEUE_NAMES set — feature-hydration, embedding-build, state-vector-recompute, biometric-buffer, reclassify-unclassified, global-seed-ingest, session-trim, youtube-retention. New W4 queues extend this map.
- (e) **watchHrIngest:** Art.9 consent hard gate confirmed inline (fail-fast, before body validation, same consent service). Route validates HR 30–230 — a THIRD range; W4-001 D9 fix amended in the mission to align it with the shared 30–220 predicate. Delivers immediate-mode to every socket in the user's room.
- (f) **biometric-mock.js:** socket-lane driver, payload `socket.emit('biometric_push', { source: 'garmin', raw })`, fixed-constant scenarios; `mock-biometrics.js` is a near-duplicate. W4-002 spec amended: reuse the payload shape, don't extend the scripts.
- **Seam paths pinned:** `app/services/selection/biosonicBand.js` (withinBand at :33), `app/services/generation/targetsBuilder.js`, `app/services/features/featureProvider.js`, selection dir = {biosonicBand, candidatePool, hardFilters, mmr, pipeline, score}.
- **Repo hygiene:** `.claude/settings.json` `includeCoAuthoredBy: false` ✓; `.gitignore` had NO `logs/` entry (ccusage JSON + session logs were unignored) → `logs/` added this session; `docker-compose.yml` present at repo root (S1a cheap green-baseline path viable); `worker.test.js` structure matches S1a exactly (success-path tests at lines 31/63/120 set `REDIS_URL='redis://example:6379'`).
- **CI ground truth re-confirmed via gh:** push CI on main green; scheduled "Secret scan (full history)" failing weekly since ≥2026-07-27 (~10–13s runs — pre-existing, unrelated) → HITL H1.
- **S2 dirty-tree decisions (session 1):** `backend/package-lock.json` — optional-peer-dep churn (gcp-metadata removal, bare `npm install` artifact) → restored to HEAD (stash-and-drop equivalent). `mobile/src/health/config.ts` — Daniel's intentional local deployment config (public client IDs over tracked placeholders) → LEFT IN PLACE uncommitted; mobile out of scope; do not commit, do not drop.

## HITL queue (for Daniel — numbered tutorials, decisions, portal actions)

- **H1 — DISCOVERED (not in roadmap): scheduled Secret-scan workflow failing on main.** The weekly "Secret scan (full history)" GitHub Action has failed every scheduled run since at least 2026-07-27 (runs last ~10–13s → likely a setup/config error, not a found secret; push CI is green). Steps: (1) GitHub → Actions → "Secret scan (full history)" → open the latest failed run; (2) read the failing step's log — if it's a tooling/setup error (e.g. action version, token perms), fix the workflow file; (3) if it actually reports a secret hit, treat as an incident. Nothing in Wave-4 is blocked on this; the wave was instructed not to chase it.

- **H2 — RUN HALTED: three concurrent sessions on one working tree (BLOCKS THE WHOLE RUN).**
  At 00:20:30, 00:28:25 and 00:29:30 on 2026-08-19, three separate invocations of
  `scripts/run-mission.ps1` were running simultaneously against this repo (PIDs 26304, 3516,
  3028), each writing the same working tree, branch and STATE. Proof: three log files all
  numbered `session-001-*` in `logs/wave4/` (the loop is sequential internally, so identical
  numbering means separate loop processes); commit `1a0e58b` landed from one session while
  another was mid-preflight on the same task; two sessions were concurrently authoring the
  same W4-000 ADR deliverable. Root cause: `run-mission.ps1` has **no single-instance guard**,
  and all instances share one `session-prompt.txt`. `docs/plans/WAVE4_HALT` is written; the
  loop stops. Steps for Daniel:
  1. Stop every loop: close the `run-mission.ps1` windows, then
     `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*claude -p*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`
     and kill any leftover `jest` node processes.
  2. Confirm none remain: `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*claude -p*' }` returns nothing.
  3. Inspect the tree for half-written sibling work: `git status` — at halt time
     `docs/adr/0012-learning-compliance.md` was untracked-in-progress and
     `scripts/run-mission.ps1` + `docs/adr/README.md` were modified by a sibling session.
     Decide per file: keep (commit it) or discard. Note the ADR filename differs from the
     mission's specified `docs/adr/ADR-0012-learning-compliance.md` — pick ONE and delete the other.
  4. Add a single-instance guard to `scripts/run-mission.ps1` before relaunching, e.g. near the
     top: `$mtx = New-Object System.Threading.Mutex($false,'Global\KokonadaWave4'); if (-not $mtx.WaitOne(0)) { Write-Host '[wave4] another loop is already running - exiting'; exit 0 }`
     (a lockfile with the PID works too). Also give each launch its own prompt file
     (`session-prompt-<stamp>.txt`) instead of the shared `session-prompt.txt`.
  5. Delete `docs/plans/WAVE4_HALT`, set `phase: execute` in this file, and start **exactly one** loop.
  Blocked on this: the entire remaining queue. Nothing else is wrong — no product-code defect
  is implied by this halt.

  **RESOLVED 2026-08-19 (H2 closeout).** Verified directly against the live tree before
  reopening: `git log --oneline` on the branch shows a clean, non-conflicting history
  (`deed3c4` → `2b3deec` → `1a0e58b` → `8d3e53e` → `d1db088`, all five wave4 commits distinct,
  no merge conflicts, no force-pushes); `git status` shows only the known intentional item
  (`mobile/src/health/config.ts`, leave in place per S2) plus the in-flight `run-mission.ps1`
  fix below — no leftover untracked files from the collision. `d1db088` (the ADR + tripwire
  commit) only touched 3 new/append-only files and never touched `WAVE4_STATE.md` or
  `run-mission.ps1`, confirming the three sessions did not actually corrupt each other's work —
  the halt worked exactly as designed, it just needed a human-reviewed close. Fix landed:
  `run-mission.ps1` now takes a named mutex (`Global\KokonadaWave4Loop`) before touching the
  tree and refuses to run a second instance (self-heals from an abandoned mutex if a prior loop
  was killed without releasing it), closing the root cause. `docs/plans/WAVE4_HALT` removal and
  the Task-Manager stray-process check are Daniel's — bridge tooling can't safely delete a
  tracked file or touch Windows processes from here. Once both are done: resume with exactly
  one loop.

## W4-001 evidence — deliberate behaviour changes & re-pins (session 5)

Every fix landed test-first in `backend/tests/wave4.bugfix.test.js` (34 pins, one describe per defect).
Full suite **164 suites / 1802 tests / 1 todo** green in ~80 s. No lint step exists in `backend/package.json`
(`start|worker|dev|test` only), so "lint clean" is vacuous here — recorded rather than claimed. Secret scan of the
whole branch diff: clean. Zero-knowledge: the diff adds no numeric vital to any log/DTO/prompt (see W4-D03 for the
pre-existing DEBUG-gated one).

**Three existing tests were deliberately re-pinned** (behaviour changed on purpose):

1. `watchIntegration.test.js` — "boundary: heartRate 30 and **230** → 202" became **220**, plus a new assertion that
   225 is now a 400. The route accepted 30–230 while every consumer requires 30–220, so 221–230 was accepted with a
   202 and then silently dropped one call later. Both now call `isPhysiologicalHR`.
2. `biometricHandler.pipeline.test.js` — "biometric_push debounce fires pipeline after 60s" used 65→80 bpm, which is
   `resting`→`resting`. Under the D11 band trigger that no longer recalibrates (identical `bio:<band>:<activity>`
   buffer key), so the fixture became 65→95 (`resting`→`active`) and the test keeps its original intent: the debounce
   is wired to the pipeline. A NEW test covers the other side — 60→85 confirms `stableHR` but emits
   `recalibration_cancelled {reason:'band_unchanged'}` instead of burning a generation.
3. `biometricHandler.pipeline.test.js` — the two immediate-mode ±25 bpm tests now assert band semantics
   (`does NOT re-trigger on a large jump that stays inside one band`, `re-triggers on a band crossing the old 25 bpm
   gate would have missed`). Worth flagging: the old negative test ran on a socket that was never in Live mode, so
   `recalibrateForBand` early-returned and the test would have passed whatever the gate did — a false green. It is
   now a real test (`live_mode` on).

**Design decisions taken inside the task:**

- **Shared HR predicate got its own module** — `app/services/wearable/hrRange.js` (`HR_MIN`/`HR_MAX`/`isPhysiologicalHR`),
  imported by both the socket handler and `integrationsController`. "Delegate to the shared predicate" needs one
  canonical home; leaving it in the socket module and importing that into a controller is the wrong direction.
- **D11 trigger extracted as a pure `_shouldRecalibrate({prevHR,nextHR,activityChanged})`**, exported for unit testing.
  The alternative — asserting through `recalibrateForBand` — needs the full mock harness and hides the decision.
  `HR_NOISE_FLOOR = 3` bpm keeps boundary jitter (119↔121 across the 120 cut) from flapping the band; it is the
  documented "delta guard as noise floor". The streaming lane ALSO arms on a sub-10-bpm band crossing now, so
  115→121 is no longer a missed transition on either lane.
- **`WATCH_HR_DELTA_THRESHOLD` (25 bpm) deleted, not kept dead.** The band trigger subsumes it: a same-band ping
  produces the same buffer key and is inert by construction at any delta.
- **D7's EWMA (α = 0.2, ~5-sample memory) updates on EVERY accepted reading, both lanes**, seeded at the first
  reading — it is an observation trace, not a confirmation path. W4-003 replaces it with Hampel + Kalman.
- **D3's cut is `UNLABELLED_RESTING_HR_CEILING = 110`** (low edge of Zone 2 for a ~190 HRmax adult): an unlabelled
  reading counts as "resting" only below it. Personal Karvonen zones replace this fixed anchor in W4-004/005.
- **D4 is now a bias, never a floor** — `valenceTarget = clamp01(moodValence + min(0.1, 0.15·S))`. Note this defect
  was LATENT, not live: every current mood preset has `valence_hint >= 0.5`, so the old `max(v, 0.6)` floor rarely
  bit. The pin therefore injects a low-valence mood via `jest.doMock` to prove the floor is really gone before
  W4-005/006 start emitting genuinely low-valence states.
- **D14's step is 0.175** so 4 missing groups land exactly on the 0.3 floor; `biosonicBand.tolerance` now reaches
  within 0.1 of `W_MAX` for a cold start (pinned).
- **D17 keeps the old single-argument signature** (`_analyzeYouTubeTracks(videos)` → all treated as likes) so the
  existing `musicProfile.test.js` callers are untouched; `buildProfile` passes `{likedIds}`. Playlist items now
  outrank likes (`SOURCE_WEIGHTS.playlist` 4 > `saved` 3) — that inversion is the Spotify side's existing product
  ruling ("a curated playlist is a DELIBERATE choice"), applied consistently, not an accident.
- **W9: the energy gate was ANNOTATED, not removed** (the mission allows either). Deleting it would also delete a
  working, tested capability and its unit test for zero product gain, and W4-007 rebuilds the energy kernel and may
  re-enable a confidence-gated hard ceiling. The comment now states it is dormant by WIRING (both call sites pass
  `energyCeiling: null`), not dead by accident, and a pin asserts the annotation exists.

## Discovered backlog (filled by reflection passes — §2.5)

> Work found DURING the run that was not in the original §3 queue. Same rigor as §3: every row needs class, tier, size,
> deps, a concrete DoD and a justification. Rules: `class: repair` outranks everything; original MUST-tier §3 tasks
> outrank `improve`/`extend` rows; max 5 new rows per reflection; an empty table is a good result, not a failure.

| id | class | title | tier | size | deps | status | found | DoD / justification |
|----|-------|-------|------|------|------|--------|-------|---------------------|
| W4-D01 | repair | Reflection pass never wrote `logs/wave4/last-reflect.txt` | MUST | S | — | pending | session 5 | Reflection `ccecca3` ran at 2026-08-19 01:12 +0300 but its R7 close-out marker file is ABSENT, so §2.5's trigger ("missing → this is a reflection session") fires forever and NO queue task can ever be picked. DoD: the next reflection writes the marker (timestamp + HEAD sha) and a guard asserts it exists after a reflection. Run-stopping if unfixed. |
| W4-D02 | repair | Reflection pass clobbered the executing session's STATE row | SHOULD | S | — | pending | session 5 | `ccecca3` reset W4-001 from `in_progress` (written by this session at `bd4a6bc`) back to `pending`, because it composed STATE from a read taken before that commit. No code was lost — but a concurrent reflection can silently erase queue truth. DoD: reflection sessions re-read STATE immediately before writing and never downgrade a row they did not set. |
| W4-D03 | improve | DEBUG log line carries a numeric heart rate | SHOULD | S | — | pending | session 5 | `biometricHandler` `log('[handleBiometric] immediate hr=${...}')` prints a raw vital. It is DEBUG-gated (`if (DEBUG) console.log`) so it is not a production leak, but §0.2.2 says no numeric vitals in logs at all. Pre-existing, untouched by W4-001 beyond one adjacent field. DoD: coarse band instead of the number. |

## Reflection log (one entry per §2.5 pass)

| # | at | interval covered | suite | verified / reopened / queued | headline |
|---|----|------------------|-------|------------------------------|----------|
| — | — | — | — | — | (no reflection has run yet) |

## PR queue

| PR | cluster(s) | url | status |
|----|-----------|-----|--------|
| #179 | W4-000, W4-001 | https://github.com/DanielMalede/Kokonada/pull/179 | open — RUNNING PR for the whole branch |

> Choice recorded per §1: ONE running PR for `feat/intelligence-wave`, updated per cluster, rather than a PR per
> cluster off a single branch (which would stack noisy, overlapping diffs). Later clusters append to #179's body.
> Never merged by an agent — Daniel's click only.

## Error budget

- consecutiveFailedSessions: 0
- perTaskFailures: (none)

## Session log (append one line per session)

| # | started | result line (`WAVE4_SESSION_RESULT: ...`) |
|---|---------|--------------------------------------------|
| 1 | 2026-08-18 22:56 | WAVE4_SESSION_RESULT: W4-000 in_progress review pass complete — 6 unknowns resolved, mission amended, phase→execute |
| 2 | 2026-08-19 00:29 | WAVE4_SESSION_RESULT: W4-000 in_progress HALT — 3 concurrent sessions on one working tree (R7); preflight S1 verified green, HITL H2 raised |
| 3 | 2026-08-19 00:20 | WAVE4_SESSION_RESULT: W4-000 in_progress halted by WAVE4_HALT (3 concurrent sessions); worker.test.js leak root-caused and fixed, baseline 163/1767 green, ADR-0012 + tripwire landed in d1db088, STATE intentionally not written |
| 4 | 2026-08-19 00:28 | WAVE4_SESSION_RESULT: W4-000 in_progress halted on WAVE4_HALT - three concurrent sessions on one tree (HITL H2); preflight passed, no docker, no work committed |
| 5 | 2026-08-19 01:0x | WAVE4_SESSION_RESULT: W4-001 done — 10 surgical fixes (D3,D4,D5,D7,D8,D9,D11i,D14,D17,W8/W9), 34 new pins, suite 164/1802 green |
| — | 2026-08-19 (Cowork) | H2 closed after direct git verification (clean, non-conflicting history) + run-mission.ps1 single-instance mutex fix; phase→execute; W4-000→done; rows 2-4 are the three colliding launches (00:20/00:28/00:29), numbered in write-order not start-order |
