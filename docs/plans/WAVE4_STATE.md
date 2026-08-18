# WAVE4_STATE — machine-updated run state

> The SINGLE resume source for the Wave-4 run. Every session reads this first and updates it before exiting.
> Rules: update via small, surgical edits; never delete history sections; keep the task table authoritative.

## Run header

- phase: execute           <!-- review | execute | closeout | halted — H2 closed 2026-08-19 (see HITL queue) -->
- branch: feat/intelligence-wave   <!-- created from origin/main (== local main, in sync) in session 1 -->
- lastMainSha: 1a1657ea4bae1f48a6de4e2dd29b3f2a14d02010
- testBaseline: **167 suites / 1891 tests** green after W4-D05 (was 166/1865 after W4-D02; +1 suite `wave4.bandHysteresis.test.js` with 23 pins, +3 pins appended to `biometricHandler.pipeline.test.js`, **no re-pins**). ~85s, exit 0. Prior: 166 suites / 1865 tests after W4-D02 (was 165/1829 after W4-D01; +1 suite `wave4.stateGuard.test.js` with 36 pins, no re-pins). ~81s, exit 0. Prior: 165 suites / 1829 tests after W4-D01 (was 164/1802 after W4-001; +1 suite `wave4.reflectMarker.test.js` with 27 pins, no re-pins). ~81s, exit 0. Prior: 164 suites / 1802 tests after W4-001 (was 163/1767 after W4-000; +1 suite `wave4.bugfix.test.js` with 34 pins, +1 re-pin in `biometricHandler.pipeline.test.js`), ~80s, exit 0. Prior baseline text: 163 suites / 1767 tests green (162 product suites: 1759 passed + 1 todo, plus adr0012.tripwire.test.js), ~60s, exit 0. **Correction (reflection #1, session 8): the original wording here claimed "exit 0 without --forceExit, --detectOpenHandles silent" — that is NOT true today and is retracted.** Re-measured: the suite is green and exits 0 either way, but without `--forceExit` jest reports it did not exit, and `--detectOpenHandles` names 2 leaked 60 s debounce timers. Tracked as W4-D06; that task owns the fix and the final re-record. Established 2026-08-19 after the worker.test.js real-connection-leak fix (injected queue seam). Real root cause was more specific than S1a guessed: backend/.env sets GLOBAL_SEED_INGEST_ENABLED=true and worker.js loads it with override:true, so the success-path tests reached a real ioredis dial against the fake host — not merely "no local Redis".
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

## W4-D01 evidence — the reflection close-out marker (session 6)

Test-first: `backend/tests/wave4.reflectMarker.test.js` (27 pins) was written and run RED before any
implementation existed (`Cannot find module .../scripts/wave4/reflect-marker.js`), then 25/27 green after the
module landed with only the two loop-backstop guards still red, then 27/27 after the loop change. Full suite
**165 suites / 1829 tests / 1 todo** green, ~81 s, exit 0. Secret scan of the branch diff: clean (the single
regex hit is the mission's own DoD line quoting the grep pattern). No numeric vitals anywhere in the diff; no
attribution. No `lint` script exists in `backend/package.json`, so that DoD line stays vacuous — recorded, not claimed.

**What was actually wrong** (the backlog row's premise was off, corrected above): §2 step 4 latches the
reflection trigger on `logs/wave4/last-reflect.txt`, §2.5 R7 is the only thing that clears it, and R7 was
pure convention — no code wrote that file. `logs/` is gitignored, so it is machine-local and invisible to CI.
A reflection killed by the 100-minute session timeout, or one that simply ended without doing R7, leaves the
trigger ON forever: every later session becomes another reflection and the queue can never advance.

**The fix, in two halves:**

1. `scripts/wave4/reflect-marker.js` — the ONE implementation of the marker's format and staleness rule,
   used by both the loop and the session, so "is a reflection due?" stops being re-derived by hand each
   session. Pure (`now` is a parameter, §0.4 S9), zero dependencies. Line 1 is a bare ISO-8601 UTC timestamp
   (§2 step 4 calls the file "a single ISO-8601 UTC timestamp"), line 2 the HEAD sha (§2.5 R7's "next to it").
   CLI: `check` → `DUE <reason>` / `NOT-DUE <reason>`; `stamp` → writes it.
2. `run-mission.ps1` `Assert-ReflectMarkerStamped` — after any session whose result line is `REFLECT`, the
   loop verifies the marker was touched during that session and stamps it if not. The session still owns R7;
   the loop guarantees the invariant. A crashed/timed-out session takes the failure branch and is NOT stamped,
   so a reflection that never happened still re-runs.

**Design decisions taken inside the task:**

- **Parsing fails toward reflecting, never toward silence.** Missing, unparseable and future-dated markers all
  report DUE. The future check (5-minute skew tolerance) is deliberate: a clock skew or a bad hand-edit could
  otherwise park the timestamp years ahead and suppress every future reflection — the same trap §0.4 S6 pins
  for biometric `recordedAt`. Timestamps are matched by a strict ISO-8601 regex, not free-form `Date` parsing,
  so prose like "no reflection has run yet" can never be coerced into a valid date.
- **The guard is NOT a file-existence assertion.** `logs/` is gitignored, so on a fresh clone or in CI the
  marker legitimately does not exist and such a test would be permanently red. What is pinned instead is the
  invariant's *mechanism*: the loop defines the backstop, invokes it on a REFLECT result, and touches the real
  marker path — with a detector self-test (the `adr0012.tripwire.test.js` pattern) proving all three checks can
  still fail.
- **A jest tripwire over a PowerShell file can only read text, which is a false-green risk**, so the loop change
  was also verified for real: `Parser::ParseFile` reports no syntax errors, and the function was extracted from
  the file via its AST and executed against a scratch root over four cases — session forgot to stamp (stamps),
  marker already fresh (no-op, mtime unchanged), stale marker from a previous session (re-stamps), and node
  removed entirely (inline PowerShell fallback still clears the trigger).
- **The inline fallback is not gold-plating.** This function exists precisely because the primary path can fail;
  a backstop that silently no-ops when `node` is missing would re-open the hole it was written to close.

## W4-D02 evidence — the STATE row-clobber guard (session 7)

Test-first: `backend/tests/wave4.stateGuard.test.js` (36 pins) was written and run RED before any
implementation existed (`Cannot find module .../scripts/wave4/state-guard.js`, 0 tests executed), then
27/36 green once the engine landed, then 34/36 after one real parser bug the pins caught (see below),
then 36/36 after the loop backstop. Full suite **166 suites / 1865 tests / 1 todo** green, ~81 s, exit 0
(baseline 165/1829: +1 suite, +36 pins, **zero re-pins** — nothing existing changed behaviour). Secret
scan of the branch diff: clean (the one regex hit is the mission's own DoD line quoting the grep
pattern). No numeric vitals — this task touches no biometric surface at all. No attribution. Still no
`lint` script in `backend/package.json`, so that DoD line stays vacuous — recorded, not claimed.

**What was actually wrong.** The backlog row's premise held up: `ccecca3` reset W4-001 from `in_progress`
back to `pending` because it composed the whole of `WAVE4_STATE.md` from a read taken before that commit
and wrote it back wholesale. The row's DoD was phrased as a rule ("reflection sessions re-read STATE
immediately before writing and never downgrade a row they did not set") — but that rule already existed
in spirit and did not help, which is precisely the W4-D01 lesson: a rule nobody can *fail loudly* is not
a control. STATE is declared the SINGLE resume source, so a stale rewrite can re-run finished work or
strand an owned task, and nothing anywhere was looking.

**The fix, in two halves (mirroring W4-D01):**

1. `scripts/wave4/state-guard.js` — the ONE implementation of "did this STATE edit illegally regress a
   row?". Pure engine (two strings in, violations out; no clock, no randomness, no git — §0.4 S9), git
   and fs confined to the CLI. Flags three kinds: `regressed` (down the status ladder), `removed` (a row
   that simply vanished — the other half of a stale rewrite), `unknown-status` (a garbled cell). CLI
   `check --base <ref>` exits non-zero and names the row.
2. `run-mission.ps1` `Assert-StateRowsNotClobbered` — the loop captures `$sessionStartSha` before
   launching a session and re-runs the same check afterwards. Mission §2 step 6 / §2.5 R2 + R7 now
   require the session to run it before every STATE commit; the loop guarantees the invariant either way.

**Design decisions taken inside the task:**

- **Deliberate reopening stays possible, and has to say so.** §2.5 R2 legitimately sends a task from
  `done` back to `pending`. A rank decrease is therefore allowed when the row carries the literal
  uppercase token `REOPENED` — the difference between the two cases is exactly that a reopen is a
  decision someone made and wrote down, while a clobber is a decision nobody made. The token is
  **uppercase on purpose**: STATE already contains the word "reopened" in ordinary prose (H2's narrative,
  the reflection-log header), and STATE's house style already uses uppercase tokens (`DISCOVERED`,
  `RESOLVED`) for deliberate annotations, so a case-insensitive match would have switched the guard off
  by accident rather than by choice. Pinned both ways.
- **A vanished row is never suppressible**, not even by `REOPENED`. There is no legitimate reason to
  delete a task row — STATE's own header says to keep the task table authoritative and never drop history.
- **Tables are identified by header, not by position.** The task table puts `status` in column 6, the
  discovered backlog in column 7 (it has an extra `class`). A table counts as a task table iff its header
  has BOTH an `id` and a `status` column — which cleanly admits exactly those two and excludes the PR
  queue (status, no id) and the reflection log (neither). Without that, every PR status change would read
  as a task regression.
- **`failed` ranks level with `done`**, so only a STRICT decrease trips. `in_progress → failed` (rule of 2,
  S4) stays legal, and reviving a `failed` row needs the same `REOPENED` a `done` row does.
- **The pins caught a real bug in this module before it shipped**: stripping markdown emphasis with a
  global `[*_`]` strip turned `in_progress` into `inprogress`, silently breaking the very ladder the guard
  rests on. Emphasis is now trimmed at the edges only. This is the whole argument for writing the
  status-ladder assertions before the parser.
- **One pin reads the REAL `WAVE4_STATE.md`** and asserts every parsed status is one of the four known
  values and that the file is self-consistent. It is a live tripwire: a future session that garbles a
  status cell or breaks a table's shape turns the suite red instead of silently becoming unparseable —
  a guard that stops parsing the file it guards is worse than no guard.
- **The jest pins over `run-mission.ps1` can only read text, which is a false-green risk**, so the loop
  change was verified for real, exactly as W4-D01's was: `Parser::ParseFile` reports no syntax errors, and
  the function was extracted from the file via its AST and executed against a scratch git repo over six
  cases — legal forward edit (silent), the ccecca3 clobber (flagged, names the row), row deleted
  (flagged), `REOPENED` reopen (allowed), no base sha (silent no-op), tool absent (degrades silently
  instead of wedging the loop). The CLI was also run against the real repo: `OK 20 rows` clean, exit 1 on
  an injected regression of W4-001.
- **The backstop runs on EVERY outcome, before the loop classifies the session.** A crashed or timed-out
  session can commit a clobbered STATE just as easily as a clean one — gating the check behind the success
  branch would skip exactly the sessions most likely to have made a mess. Pinned by asserting the call
  site precedes `# 5. classify the outcome`.
- **It is a detector, not a repair.** It cannot un-commit. Its whole job is to turn a silent erasure into
  a loud line in `logs/wave4/usage.log`, attributed to the session that caused it.

## W4-D05 evidence — the band-trigger flap (session 9)

Commit `95b85db`. Suite **167 / 1891** green, exit 0 (from 166/1865: +1 suite `wave4.bandHysteresis.test.js`
with 23 pins, +3 pins appended to `biometricHandler.pipeline.test.js`, **zero re-pins** — the whole fix is
additive to the existing contract). TDD evidence: the new suite ran **15 failed / 8 passed** against unmodified
source before implementation, then 23/23. `biometricHandler.pipeline.test.js` + `wave4.bugfix.test.js` re-run in
isolation after the handler edit (Risk Register #1): 160/160 green.

**The design decision, and why the other option was rejected.** The DoD offered "min-dwell/cooldown **or**
asymmetric enter/exit band cuts". A wall-clock cooldown was rejected on evidence: the watch lane pings every
5 minutes, so any cooldown short enough not to delay a real activation is also shorter than the ping interval and
suppresses nothing, while a cooldown long enough to work would delay genuine crossings by more than it saves —
and it would have broken every existing pin that fires two recalibrations in quick wall-clock succession.
Asymmetric cuts have neither problem. Note also that no single `(prev, next)` pair can distinguish the flap from a
real crossing — `88→93` and `115→121` are the same event in the small — which is why the fix had to add *state*
(the latch), not just a wider threshold.

**Two halves, both load-bearing:**
1. **Asymmetric release in `_shouldRecalibrate` (pure).** Attack (entering a higher band) is unchanged from W4-001 —
   the 3 bpm noise floor is still the only gate, so a real activation is never delayed and the DoD's `115→121` case
   still fires. Release (falling back) now requires the reading to clear the band's own cut by
   `HR_BAND_RELEASE_MARGIN = 6`. Measured from the CUT, not from `prevHR`: the threshold is a property of the band,
   which is what the buffer is keyed by — a delta from the last reading is precisely what flapped.
2. **`state.servedHR` latch on the immediate lane.** The margin alone fixes nothing here, because `stableHR` tracks
   every ping, so each half-oscillation reads as a fresh crossing. The trigger now compares against the band being
   SERVED. This is what bounds the wide oscillation (`114↔121`) that spans both thresholds and that the margin alone
   cannot catch. Latched on the trigger decision rather than on the serve, so the Manual→Live switch cannot flap.

**Constant derivation (6 bpm).** `HR_NOISE_FLOOR = 3` is sized for *sensor* error (PPG vs ECG). The flap is not sensor
error — resting HR varies 5–10 bpm minute-to-minute from respiratory sinus arrhythmia and ordinary autonomic drift,
which is real signal at the wrong scale to act on. Reflection #1 measured the actual flap amplitudes at 3–5 bpm
(`88↔93`, `87↔92`, `119↔122`); 6 covers all three with headroom and reads as "twice the sensor's own error must
separate the reading from the cut before we abandon the mix". Pinned to stay `> HR_NOISE_FLOOR` — at or below it the
trigger is symmetric again and the defect is back.

**One-definition fix (D11's own lesson).** The release margin has to measure from a cut, and hand-copying `90/120`
into the handler would have re-created exactly the trigger/key divergence D11 was about. `moodDescriptors` now exports
`BAND_LOWER_CUT = {resting: null, active: 90, peak: 120}` and `bandFromHeartRate` reads it — behaviour byte-identical,
pinned by a property test sweeping every HR from 30 to 220.

**S11 kill-switch.** `WAVE4_RECAL_STATE_TRIGGER_DISABLED` restores W4-001 behaviour with no revert and no deploy:
symmetric noise-floor release AND the old `prev`-reading comparison. Deliberately forgiving about its value
(`true|1|yes|on`, case-insensitive; empty/`false`/`0` = off) — a kill-switch that ignores `=1` because it demanded
`=true` fails at the moment it is needed. The integration pin asserts 4 serves for 4 flapping pings with the flag set
versus ≤1 without, so the flag test doubles as proof the fix is what is doing the work.

**Known residue, deliberately not chased.** An oscillation wide enough to clear the release threshold *and* re-enter
from a band the socket is not latched to can still serve more than once; that is a genuine multi-band swing, and
W4-009 owns the real mechanism (taxonomy-state transitions with min-dwell), which supersedes all of this. The
streaming lane needs no latch — its 60 s debounce is already a dwell — but inherits the release margin.

## Discovered backlog (filled by reflection passes — §2.5)

> Work found DURING the run that was not in the original §3 queue. Same rigor as §3: every row needs class, tier, size,
> deps, a concrete DoD and a justification. Rules: `class: repair` outranks everything; original MUST-tier §3 tasks
> outrank `improve`/`extend` rows; max 5 new rows per reflection; an empty table is a good result, not a failure.

| id | class | title | tier | size | deps | status | found | DoD / justification |
|----|-------|-------|------|------|------|--------|-------|---------------------|
| W4-D01 | repair | Reflection close-out marker had no mechanical writer | MUST | S | — | **done** | session 5 | Fixed session 6 — see the W4-D01 evidence section below. **Premise corrected:** `ccecca3` was NOT a reflection run, it is the commit that AUTHORED §2.5 (its own STATE text says "no reflection has run yet"), so no R7 was ever skipped. The run-stopping defect is real but different: the marker was written by nothing except a session's voluntary compliance with R7, and `logs/` is gitignored, so any reflection that is killed/times out/forgets latches the trigger ON permanently. Now: one tested implementation (`scripts/wave4/reflect-marker.js`) + a loop backstop that stamps it after any REFLECT session. |
| W4-D02 | repair | Reflection pass clobbered the executing session's STATE row | SHOULD | S | — | **done** | session 5 | Fixed session 7 — see the W4-D02 evidence section below. `scripts/wave4/state-guard.js` + 36 pins + a `run-mission.ps1` backstop that re-checks STATE after EVERY session.  `ccecca3` reset W4-001 from `in_progress` (written by this session at `bd4a6bc`) back to `pending`, because it composed STATE from a read taken before that commit. No code was lost — but a concurrent reflection can silently erase queue truth. DoD: reflection sessions re-read STATE immediately before writing and never downgrade a row they did not set. |
| W4-D03 | improve | DEBUG log line carries a numeric heart rate | SHOULD | S | — | pending | session 5 | `biometricHandler` `log('[handleBiometric] immediate hr=${...}')` prints a raw vital. It is DEBUG-gated (`if (DEBUG) console.log`) so it is not a production leak, but §0.2.2 says no numeric vitals in logs at all. Pre-existing, untouched by W4-001 beyond one adjacent field. DoD: coarse band instead of the number. |
| W4-D04 | improve | Cold-start reflection semantics contradict the "first reflection due in 4h" note | SHOULD | S | — | **done** | session 6 | **Decided by reflection #1 (session 8), which its own DoD nominated as the decider.** Ruling: **§2 step 4 stands — a missing marker means DUE.** That is the fail-safe direction and the property W4-D01 was built to guarantee (`logs/` is gitignored and machine-local, so a marker that can vanish must never silently suppress reflections forever); seeding at run start would trade a permanent safety property for one short session per fresh run. The contradicting text needed no edit: it was the placeholder row `(none yet — first reflection due ~4h after 2026-08-19 01:00)` in `ccecca3`'s Discovered-backlog table, which no longer exists — the real W4-D01..D04 rows replaced it. Verified by grep: no "first reflection due" string survives anywhere in `docs/plans/` or `scripts/` outside this row's own quotation. §2 step 4, `reflect-marker.js` and STATE now agree. This reflection is itself the evidence that "missing ⇒ DUE" pays for itself on a resumed run — it caught W4-D05 and W4-D06. |
| W4-D05 | repair | D11's interim band trigger flaps at band boundaries — no dwell, no cooldown, no kill-switch | MUST | S | — | **done** | session 8 | Fixed session 9 — see the W4-D05 evidence section below. **Verified empirically this reflection, not inferred.** Bands cut at `resting <90 / active 90–119 / peak ≥120`; calling the REAL exported `biometricHandler._shouldRecalibrate`: `88→93` **true**, `93→88` **true**, `87→92` **true**, `92→87` **true**, `119→122` **true**, `122→119` **true**. The watch/immediate lane has NO debounce and `recalibrateForBand` has NO cooldown or dwell (only the `liveMode` gate), so an ordinary resting oscillation across the 90 cut re-serves the buffer on **every** 5-minute ping — where the retired ±25 bpm gate produced **zero**. `HR_NOISE_FLOOR = 3` only suppresses ≤2 bpm jitter (the `119↔121` case W4-001's evidence cites); real resting HR routinely varies 5–10 bpm, so the mitigation as sized does not cover the actual signal, and W4-001's evidence line overstates it. DoD: give the interim trigger a min-dwell/cooldown or asymmetric enter/exit band cuts so a sub-band oscillation yields ≤1 serve per dwell window; ship it behind the S11-reserved `WAVE4_RECAL_STATE_TRIGGER_DISABLED` restoring W4-001 behaviour without a revert; pin (a) 88↔93 over N immediate-lane pings ⇒ ≤1 recalibration, (b) the existing 115→121 genuine crossing still fires, (c) flag set ⇒ W4-001 behaviour byte-for-byte. Justification: W4-009 specs the real fix ("min-dwell honored", "sub-band wiggle → zero churn") but is SHOULD-tier behind the entire bio track (006←005←004←003←002), while PR #179 is open and mergeable **now** — so the interim is what reaches users. High likelihood (88–93 bpm is a commonplace range), and every flip changes the listener's music and burns a shadow-buffer serve. |
| W4-D06 | repair | Suite leaks 60 s debounce timers; `--forceExit` masks it and the W4-000 baseline claim no longer holds | MUST | S | — | pending | session 8 | **Found by running the baseline claim rather than trusting it.** `npx jest --runInBand` (no `--forceExit`) prints *"Jest did not exit one second after the test run has completed"*, and `--detectOpenHandles` names exactly **2** leaked `setTimeout`s, both from `biometricHandler.js:1203`, armed at `wave4.bugfix.test.js:122` and `biometricHandler.pipeline.test.js:1841`. `npm test` is `jest --runInBand --forceExit` (pre-existing on main, untouched by this wave), which hides them — the suite is green and exits 0 either way, which is why nothing noticed. Consequence: **STATE's W4-000 baseline sentence "exit 0 without `--forceExit`, `--detectOpenHandles` silent" is no longer true** and must be re-recorded honestly. Real risk, not just hygiene: the leaked callback closes over a torn-down socket and fires `recalibrateForBand` against the module-global `debounceMap` up to 60 s later — i.e. *inside a later suite* of the 75 s `--runInBand` run — which is a cross-suite flake vector, and §0.4 S1a explicitly forbids a non-deterministic baseline. DoD: clear the timers in teardown (or drive them with fake timers) until `npx jest --runInBand --detectOpenHandles` is silent; add a standing guard so the rest of the wave — which adds workers, Redis blobs and BullMQ repeatables (W4-003/004/011/012) — cannot re-introduce a leak invisibly behind `--forceExit`; correct the baseline sentence. Justification: a flaky baseline during a 4-day autonomous run burns error budget on phantom failures and can trip `WAVE4_HALT`; this is the same bug class S1a required W4-000 to close, re-opened. |
| W4-D07 | improve | The socket lane's adapter mock has different semantics from the real adapter | SHOULD | S | — | pending | session 9 | **Noticed in passing while building W4-D05's watch-lane pins — one line per §2, for the next reflection to triage.** `biometricHandler.pipeline.test.js:125` mocks `wearable/adapter.normalize` to return `{heartRate, activity, source}`, with NO `recordedAt`. The real `fromGarmin` returns `recordedAt: new Date(raw.startTimeLocal)`, and `isValidReading` REJECTS the reading when that date is unparseable — so a payload the suite happily accepts is refused by production. Verified directly: the real `normalize('garmin', {heartRate: 88})` → Invalid Date → `connection_error: Invalid biometric reading` (the rejection itself is correct and intended; the divergence is the point). Consequence: the normalize→isValidReading seam on the socket lane is never exercised, which is the "green mock for an integration boundary" §1 forbids. DoD: give the mock the real shape (or drop the mock and feed real payloads) and pin one case proving an unparseable provider timestamp is rejected end-to-end. Justification: low cost, and W4-003 is about to wire the anomaly filter into this exact seam and persist `recordedAt` to `BiometricLog`, where the divergence stops being cosmetic. |

## Reflection log (one entry per §2.5 pass)

| # | at | interval covered | suite | verified / reopened / queued | headline |
|---|----|------------------|-------|------------------------------|----------|
| 1 | 2026-08-19 (session 8, `exec`) | run start → `d0b94d9` — all 24 branch commits; tasks W4-000, W4-001, W4-D01, W4-D02 | **166 suites / 1865 tests green, 75.8 s, exit 0** — exactly the recorded baseline | **4 verified / 0 reopened / 2 queued** (+ W4-D04 closed by ruling) | Product code is sound and the DoD claims hold; the two things that did NOT hold were both about *guarding* the work — an unguarded band-boundary flap (W4-D05) and a re-opened open-handle leak that `--forceExit` hides (W4-D06) |

**R2 — how the four `done` tasks were verified (not taken on trust).** All ten W4-001 fixes were confirmed present in
source, not just in prose: D5 axis order at `geminiEngine.js:206`; D9's shared `hrRange.isPhysiologicalHR` imported by both
the socket handler and `integrationsController`; D3's `UNLABELLED_RESTING_HR_CEILING = 110`; D4 as `clamp01(moodValence +
min(0.1, 0.15·S))` — a bias, floor genuinely gone; D14's `CONFIDENCE_STEP = 0.175` landing 4 missing groups exactly on the
0.3 floor; D7's EWMA + the deleted `stableHR` write on the sub-threshold path; D8's in-window `pendingHR` refresh; D11's
`_shouldRecalibrate`; D17's per-source bounded affinity. **Stub-out check:** reverting D5's axis order turned 2 pins RED
(`Tests: 2 failed, 32 skipped, 34 total`), then the file was restored — the pins are real, not decorative. `state-guard.js`
CLI on the live repo: `OK 20 rows, no regressions`. `reflect-marker.js check`: `DUE missing`, correct. PR #179 verified OPEN,
head `feat/intelligence-wave` → base `main`, 24 commits matching the branch, no attribution in the body. W4-D03's premise
re-checked against the diff and **confirmed accurate** — the numeric HR in that DEBUG line is pre-existing; W4-001 only
swapped the adjacent `hrJumped=` field for `bandChanged=`.

**R3 — constraint audit: clean.** `adr0012.tripwire.test.js` green (7 pins); targets remain a strict superset — all 13
contract keys still emitted by `translate()`; regulator-not-mirror satisfied (D4 verified as a bias); Art.9 consent gate
intact in `integrationsController`; zero-knowledge holds — the only numeric vital in any new log line is the pre-existing
DEBUG-gated one already tracked as W4-D03; secret scan of the branch diff clean (the sole hits are the mission's own DoD
line quoting the grep pattern and a `Task-` substring); no attribution in any commit, the PR body, or product code.
Numerical hygiene spot-checks passed: `_robustZ`'s divisor can never be 0 (`finite(mad) > 0 ? mad : fallback ?? 3`), and
D17's position bonus is `total > 0`-guarded.

**One judgement call recorded for W4-015's REPORT (deliberately NOT queued as a task).** §0.4 S11 reads "every serving-path
change ships an env escape hatch", yet §3's W4-001 spec asks for no flags and S11's named inventory maps its four flags to
the *later* engine tasks (005/006, 007, 008, 009). W4-001 shipped D3/D4/D11/D17 — real serving-path behaviour changes — with
no hatch. Only the D11 one is worth a flag (it governs recalibration frequency, i.e. serve churn and Spotify API cost), and
it is folded into W4-D05 rather than duplicated. A hatch for D3/D4/D17 would exist only to restore *known-defective*
behaviour ("workouts read as maximal stress"), which nobody would switch on; padding the queue with it would dilute real
signal per R6. S11's "full inventory in WAVE4_REPORT" stays W4-015's job.

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
| 6 | 2026-08-19 01:27 | WAVE4_SESSION_RESULT: W4-D01 done — reflect-marker module + loop backstop, 27 new pins, suite 165/1829 green |
| 7 | 2026-08-19 (exec) | WAVE4_SESSION_RESULT: W4-D02 done — STATE row-clobber guard + loop backstop, 36 new pins, suite 166/1865 green |
| 8 | 2026-08-19 (exec) | WAVE4_SESSION_RESULT: REFLECT done 4 verified, 0 reopened, 2 queued — suite 166/1865 green; W4-D05 band-flap + W4-D06 open-handle leak found, W4-D04 closed by ruling |
| 9 | 2026-08-19 (exec) | WAVE4_SESSION_RESULT: W4-D05 done — asymmetric band release margin + served-band latch, 26 new pins, suite 167/1891 green |
| — | 2026-08-19 (Cowork) | H2 closed after direct git verification (clean, non-conflicting history) + run-mission.ps1 single-instance mutex fix; phase→execute; W4-000→done; rows 2-4 are the three colliding launches (00:20/00:28/00:29), numbered in write-order not start-order |
