# WAVE4_STATE — machine-updated run state

> The SINGLE resume source for the Wave-4 run. Every session reads this first and updates it before exiting.
> Rules: update via small, surgical edits; never delete history sections; keep the task table authoritative.

## Run header

- phase: execute           <!-- review | execute | closeout | halted — H2 closed 2026-08-19 (see HITL queue) -->
- branch: feat/intelligence-wave   <!-- created from origin/main (== local main, in sync) in session 1 -->
- lastMainSha: 1a1657ea4bae1f48a6de4e2dd29b3f2a14d02010
- testBaseline: **182 suites / 2416 tests GREEN** after W4-004's WIRING half (+3 suites — `wave4.retentionDocs.test.js` 7 pins, `wave4.vitalIngest.test.js` 25, `wave4.baselineWiring.test.js` 26 = **58** — plus 1 pin appended to `stateVector.worker.test.js`: 2357 + 58 + 1 = 2416 exactly, so no pre-existing test was lost in the six deliberate re-pins). Established by repetition per §0.4 S1a: two consecutive full runs, both **182 suites / 2415 passed + 1 todo**, exit 0. Lint **0 errors, 22 warnings** — the identical count for the fifth consecutive session (one new warning, an unnecessary `eslint-disable global-require` of this session's own, was removed rather than banked). Secret scan of the diff: clean. **Six deliberate re-pins, none of them a weakening** — see the W4-004 wiring evidence section. Prior: **179 suites / 2357 tests GREEN** after W4-004's pure core (+3 suites — `vitalSample.integration.test.js` 29 pins, `baselineEngine.test.js` 63, `chronobiology.test.js` 44 = 136 — plus 7 pins appended to three existing suites, and **1 deliberate re-pin** (`userDataExport` completeness list gains `vitalsamples`). **Correction to the number below, carried forward honestly:** the W4-003 baseline was **2214**, not 2213 — session 17's evidence describes "+14 pins ... +1 pin appended" and then computes "2199 + 14", dropping the +1 its own session-log line reports as "15 new pins". 2214 + 143 = 2357 exactly. Lint 0 errors / 22 warnings, unchanged for the fourth consecutive session. Established by repetition per §0.4 S1a. Prior: **176 suites / 2213 tests GREEN** after W4-003's WIRING half (+1 suite `wave4.liveWiring.test.js` with 14 pins, +1 pin appended to `biometricHandler.pipeline.test.js` (W4-D07), 2199 + 14 = 2213 exactly). Established by repetition per §0.4 S1a: two consecutive full-suite runs, both 176 suites / 2213 passed + 1 todo, exit 0, at 132.5 s and 149.6 s. Lint: **0 errors, 22 warnings** — the identical count session 16 recorded; the wiring diff (~465 lines across 8 files) added none. **Two W4-002 "this is what it does TODAY" pins deliberately re-pinned in `sim.replay.integration.test.js`** (D10 live persistence, S6 future-timestamp gate — both now assert the FIXED behaviour, see the W4-003 wiring evidence section) **+ one deliberate tolerance widening** (`the served-band latch holds through a resting oscillation across the 90 cut`: `<=4` → `<=5` — the filtered/Kalman trajectory is not bit-identical to the raw one near a boundary-hugging signal, see evidence). Prior: **175 suites / 2199 tests GREEN** after W4-003's pure core (+1 suite `anomalyFilter.test.js` with 82 pins, **zero re-pins** — the two new modules are not wired into any serving path yet, so nothing existing could change behaviour: 2117 + 82 = 2199 exactly). Established by repetition per §0.4 S1a, not by one lucky run: two consecutive runs, both 175 suites / 2198 passed + 1 todo, exit 0, at 138.1 s and 137.0 s. Lint: **0 errors, 22 warnings** — the identical count session 15 recorded, i.e. the ~1000 new lines added none. Prior: **174 suites / 2117 tests GREEN** after W4-D08's reopen + W4-D11 (+2 suites — `wave4.ingestLanes.test.js` with 16 pins and `wave4.lintGuard.test.js` with 10 — **zero re-pins**: both files are new and nothing existing changed behaviour, so 2091 + 26 = 2117 exactly). Established by repetition per §0.4 S1a rather than by one run: two consecutive runs, **174 suites / 2116 passed + 1 todo**, exit 0, at 128.2 s and 124.1 s. Prior: **172 suites / 2091 tests GREEN** after W4-D08 (+1 suite `wave4.ingestAccounting.test.js` with 17 pins, +1 test appended to `sim.replay.integration.test.js`, **1 deliberate re-pin** — the W4-002 pin that ENCODED the defect, flipped by design). Two consecutive runs, exit 0: **172 suites / 2090 passed + 1 todo** at 120.2 s and 120.9 s. W4-D09's budgets held with room (`burst-20` 5718 vs an 11000 budget; `generateV2` min 264; `selection-500` min 268), which is the second wave-4 baseline established by repetition rather than by one run. Prior: **171 suites / 2073 tests GREEN** after W4-D09 (+1 suite `wave4.perfBudget.test.js` with 45 pins; **3 deliberate re-pins** — the two per-call latency assertions and the 20-user burst assertion — with no test-count change in the two edited files). **This is the first baseline since W4-002 that §0.4 S1a permits banking as green, and it is established by repetition, not by one lucky run:** runs D, E and F, all `171 suites / 2072 passed + 1 todo`, exit 0, at 121.1 s / 121.9 s / 117.7 s. Their perf records are deliberately NOT identical — `generateV2` min 260 / 255 / 231, `selection-500` min 225 / 291 / 261 — and that is the point: this spread is the noise the old single-shot budgets were actually measuring, and all three runs are green regardless. Every one of them was also achieved with **ten stale `worker.test.js` node processes** still resident on the box from the 2026-08-19 00:22/00:29 H2 collision (see HITL H3), i.e. under a standing background load rather than on a clean machine. The three runs BEFORE the burst fix are kept in the W4-D09 evidence section as the failure record: A clean/green, B under deliberate 2x overload (2 failures — the burst constant and a real-socket auth timeout), C clean (1 failure — the burst constant at 6236 ms). The two per-call budgets held in **all six** runs, including the overloaded one. Prior: **170 suites / 2028 tests** after W4-002 (+2 suites `sim.generator.test.js` 62 pins and `sim.replay.integration.test.js` 22 pins, **zero re-pins** — W4-002 adds only new files). **NOT recorded as green, deliberately (§0.4 S1a forbids banking a non-deterministic baseline):** the run ends 2026 passed / 1 todo / 1 FAILED, and the failure is a PRE-EXISTING wall-clock latency budget, not this task. Established by control, not by assertion: with both new suites REMOVED the suite still fails — run A `shadow.flip.test.js`, run B `shadow.selection.test.js` (319 ms vs a `Date.now() - started < 300` budget) — and with them restored it fails the same way (307 / 315 ms). Both files pass in ISOLATION. Machine state during measurement: CPU 8%, free RAM 3.1 GB of 14.2 GB, 12 unrelated node processes; full run 100 s without the new suites, 115 s with. Tracked as W4-D09. New suites cost 17 s combined and are open-handle clean (`--detectOpenHandles` silent, exit 0), so the W4-D06 guard still holds. Prior: **168 suites / 1944 tests** green after W4-D06 (was 167/1891 after W4-D05; +1 suite `wave4.openHandleGuard.test.js` with 53 pins, **no re-pins** — nothing existing changed behaviour). ~83s, exit 0. **W4-D06 re-record (session 10) — the sentence reflection #1 retracted is true again, and this time it is MEASURED in all three modes, not inferred:** (a) `npm test` (`--runInBand --forceExit`) 168/1944 green, exit 0, 83.3s; (b) the same run WITHOUT `--forceExit` 168/1944 green, exit 0, 79.4s, and jest prints NO "did not exit" warning; (c) `npm run test:handles` (`--detectOpenHandles`) **silent — no open-handle section at all** — 168/1944 green, exit 0, on two consecutive runs (89.3s, 83.5s). `--forceExit` is deliberately KEPT: it no longer masks anything, because the new `globalTeardown` guard fails the run independently of it. Prior: 167 suites / 1891 tests after W4-D05 (was 166/1865 after W4-D02; +1 suite `wave4.bandHysteresis.test.js` with 23 pins, +3 pins appended to `biometricHandler.pipeline.test.js`, **no re-pins**). ~85s, exit 0. Prior: 166 suites / 1865 tests after W4-D02 (was 165/1829 after W4-D01; +1 suite `wave4.stateGuard.test.js` with 36 pins, no re-pins). ~81s, exit 0. Prior: 165 suites / 1829 tests after W4-D01 (was 164/1802 after W4-001; +1 suite `wave4.reflectMarker.test.js` with 27 pins, no re-pins). ~81s, exit 0. Prior: 164 suites / 1802 tests after W4-001 (was 163/1767 after W4-000; +1 suite `wave4.bugfix.test.js` with 34 pins, +1 re-pin in `biometricHandler.pipeline.test.js`), ~80s, exit 0. Prior baseline text: 163 suites / 1767 tests green (162 product suites: 1759 passed + 1 todo, plus adr0012.tripwire.test.js), ~60s, exit 0. **Correction (reflection #1, session 8), now CLOSED by W4-D06 (session 10): the wording claiming "exit 0 without --forceExit, --detectOpenHandles silent" was retracted as untrue at the time — without `--forceExit` jest reported it did not exit, and `--detectOpenHandles` named 2 leaked 60 s debounce timers.** Both are fixed and re-measured above; the retraction stands as history, the claim no longer does. Established 2026-08-19 after the worker.test.js real-connection-leak fix (injected queue seam). Real root cause was more specific than S1a guessed: backend/.env sets GLOBAL_SEED_INGEST_ENABLED=true and worker.js loads it with override:true, so the success-path tests reached a real ioredis dial against the fake host — not merely "no local Redis".
- missionVersion: 2026-08-18 (as approved by Daniel; amended by W4-000 review deltas, same date)
- runStartedAt: 2026-08-18T22:56 local (session 1)
- day4CutoffAt: 2026-08-22T22:56 local (runStartedAt + 96h; after this, only W4-015 may run)
- reflectIntervalHours: 4   <!-- §2.5 recurring reflection pass; trigger state in logs/wave4/last-reflect.txt -->

## Task table

| id | title | tier | size | deps | status | owner-session | notes |
|----|-------|------|------|------|--------|---------------|-------|
| W4-000 | Bootstrap, review pass, ADR-0012 | MUST | S | — | done | 1,3 | review pass + S1 preflight + worker.test.js leak fix + green baseline (163/1767, see testBaseline above) + ADR-0012 + tripwire all landed in `d1db088`. ADR filed as `docs/adr/0012-learning-compliance.md` matching the repo's existing `000N-kebab-title.md` convention (not the mission text's `ADR-0012-…` — intentional call, ADR README index refreshed). Docker is NOT installed on this machine — S1a's `docker-compose up` path is not viable here (moot: the injected-queue-seam fix superseded it). |
| W4-001 | Surgical bug backlog (D3,D4,D5,D7,D8,D9,D11i,D14,D17,W8/W9) | MUST | M | 000 | done | 5 | all 10 sub-fixes landed (`f2add0e`→`b92aee3`). Suite **164 suites / 1802 tests** green (baseline 163/1767: +1 suite `wave4.bugfix.test.js`, +34 new pins, +1 re-pin). 3 deliberate re-pins, see below. Shared HR predicate extracted to `app/services/wearable/hrRange.js`; `WATCH_HR_DELTA_THRESHOLD` retired (subsumed by the band trigger). |
| W4-002 | Synthetic-human simulator + replay | MUST | L | 000 | done | 11 | `sim/{rng,personas,generator,replay,soak}.js` + 2 suites, **+84 pins, zero re-pins**. Suite **170 suites / 2028 tests**, 2026 passed / 1 todo / **1 pre-existing wall-clock flake** (see testBaseline + W4-D09) — the flake reproduces with these suites REMOVED, twice. Found two defects in passing: W4-D08, W4-D09. |
| W4-003 | A0 signal integrity + live persistence | MUST | L | 001,002 | done | 16,17 | L task, split across sessions by design. Session 16 landed the PURE CORE (telemetry DTO + `anomalyFilter.js`, 82 pins). **Session 17 landed the WIRING half:** `handleBiometricReading` now consumes the filtered `{level,trend,confidence}` for every debounce/trigger decision (D6); accepted readings persist to `BiometricLog` throttled ≤1/min/socket with `source@recordedAt` dedupe (D10); S6 (future/stale timestamp) gates the live seam via the filter's own gate; `WAVE4_ANOMALY_FILTER_DISABLED` kill-switch restores W4-001 behaviour byte-for-byte; W4-D07's mock divergence closed. `+1` suite `wave4.liveWiring.test.js` (14 pins, 7 stub-out verified load-bearing against the filter wiring) `+1` pin in `biometricHandler.pipeline.test.js`. Suite **176/2213 green twice**. See the W4-003 wiring evidence section below. |
| W4-004 | A1+A2 baselines & chronobiology v2 | MUST | L | 003 | done | 18,20 | L task, split by design (the W4-003 precedent). **Session 18 landed the PURE CORE + storage:** `models/VitalSample.js` (encrypted, metric-typed, TTL 90d, metric-aware range hook) with FULL S5 registration in all five erasure/export surfaces **plus an extended completeness guard** (export coverage + source-scoped per-provider erasure are now mechanically checked, not remembered); `agents/runtime/physiology/baselineEngine.js` (D1/D2/D14/D15) and `chronobiology.js` (D13), both pure and clock-free. 136 new pins across 3 suites + 7 appended. Suite **179/2357 green**. **Owed next session (the WIRING half):** `baselines.js` delegation + superset blob + stale-while-revalidate (this is where D1 actually reaches the serving path — it does NOT yet), `metricStore.persistMetrics` VitalSample writes, `adapter.js` dormant stressLevel/steps (D16), `tzOffsetMinutes` on both ingest lanes, `MedicalProfile.hrZones`/`maxHeartRate` via `doc.save()`, cache-compat tests. **Session 20 landed the WIRING half and the task is COMPLETE.** `baselines.computeBaselines` now delegates to `baselineEngine` and returns the SUPERSET blob — **D1 reaches the serving path** (`translate()` unchanged, as designed); `peekBaselines` gained stale-while-revalidate (D15's second half); `metricStore` writes VitalSample rows for the two consent-v1 metrics behind a `VITAL_METRICS_PERSISTED` allowlist; `tzOffsetMinutes` is plumbed through BOTH batch lanes AND all three live normalizers, with a new optional `BiometricLog.tzOffsetMinutes` field; `adapter.js` gained the D16 stressLevel lane and steps behind `WAVE4_CONSENT_V2_METRICS` (empty by default — collection NOT widened, §0.2.3); Karvonen zones + HRmax are written to the dormant `MedicalProfile` fields via `doc.save()` from the stateVector worker. S11 kill-switch: `WAVE4_BASELINE_ENGINE_DISABLED`. **W4-D13 discharged in the same PR** per its scoping note. 58 new pins across 3 suites + 1 appended; suite **182/2416 green twice**. Six deliberate re-pins, all listed in the W4-004 wiring evidence section below. See the W4-004 evidence section. **Two additions from reflection #3, both for the wiring half:** (1) §0.4 **S11 owes a kill-switch here** — the `baselines.js` delegation is what actually puts D1 on the serving path (`translate()` stops scoring everyone against the `{45, 8}` population constant), i.e. a real behaviour change for every user with HRV history, and S11's named flag inventory in the mission does not list one, so it is easy to miss; ship an env hatch restoring the pre-delegation blob without a revert. (2) **W4-D13** (S5's retention-documentation surface, missed by the pure-core PR) is cleanest to discharge inside this task's wiring commit — same open PR #179, which is literally what S5's "same PR" wording asks. |
| W4-005 | A3 affect engine core (axes+HMM) | MUST | L | 004 | in_progress | 21 | Session 21 (exec tier). PURE engine only — W4-005 has no wiring at all (W4-006 owns the `targetsBuilder`/`translate` seam), so the whole task is `agents/runtime/physiology/affectEngine.js` + tests + ADR-0013. **The taxonomy state set is an INJECTED PORT**, not a hardcoded table: W4-006 supplies the real ~32-state `stateTaxonomy.js`, this engine takes `states` as a parameter and degrades to axes-only (`topState: null`) when none is given — so the two tasks cannot fight over one source of truth. Planned commit split so the tree is green at every boundary: (1) evidence axes + declared-mood fusion, (2) HMM temporal layer + hysteresis label projection + AffectState DTO, (3) ADR-0013. |
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

- **H4 — PORTAL / PROD ACTION: index builds for the new `vitalsamples` collection (W4-004).** The
  `VitalSample` model declares two indexes that Mongoose creates automatically in dev and test but that must
  be built deliberately in production, because a background index build on a live collection is a Pause &
  Guide action an agent must never perform: (a) the query index `{ userId: 1, metric: 1, recordedAt: -1 }`,
  which every baseline read depends on — without it the first user with a year of vitals turns a baseline
  refresh into a collection scan; and (b) the TTL index `{ recordedAt: 1 }` with
  `expireAfterSeconds = 7776000` (90 days, env-tunable via `VITAL_SAMPLE_RETENTION_DAYS`), which is what makes
  the retention promise in the privacy documentation true rather than aspirational. Steps for Daniel, once the
  wiring half has actually started writing rows: (1) Atlas → Collections → `vitalsamples`, or a `mongosh`
  session against `MONGO_URI`; (2) `db.vitalsamples.createIndex({ userId: 1, metric: 1, recordedAt: -1 },
  { background: true })`; (3) `db.vitalsamples.createIndex({ recordedAt: 1 }, { expireAfterSeconds: 7776000,
  background: true })`; (4) `db.vitalsamples.getIndexes()` to confirm both, and check that the TTL monitor has
  begun expiring rows older than 90 days on the next daily pass. Nothing is blocked on this today — the
  collection is empty until the wiring half lands, and correctness does not depend on the indexes, only
  performance and the retention guarantee do. Worth doing BEFORE the collection grows: building a TTL index on
  a large collection is far more expensive than building it on an empty one.

- **H1 — DISCOVERED (not in roadmap): scheduled Secret-scan workflow failing on main.** The weekly "Secret scan (full history)" GitHub Action has failed every scheduled run since at least 2026-07-27 (runs last ~10–13s → likely a setup/config error, not a found secret; push CI is green). Steps: (1) GitHub → Actions → "Secret scan (full history)" → open the latest failed run; (2) read the failing step's log — if it's a tooling/setup error (e.g. action version, token perms), fix the workflow file; (3) if it actually reports a secret hit, treat as an incident. Nothing in Wave-4 is blocked on this; the wave was instructed not to chase it.

- **H3 — DISCOVERED (session 12): ten stale `worker.test.js` node processes have been running on this box
  since the H2 collision, ~9.5 hours.** H2's own step 1 said "kill any leftover `jest` node processes" and
  that half was never completed — H2 was closed on the git-history check alone. Measured directly from
  `Win32_Process` at 09:55 on 2026-08-19: two hung `jest tests/worker.test.js` process trees created at
  **00:22:22** and **00:29:55** (one of them the `--detectOpenHandles` variant), five processes each, ten
  in total. Those timestamps sit exactly inside the H2 window (the three colliding launches at 00:20/00:28/
  00:29), and the hang is the very defect session 3 root-caused: `worker.test.js` dialled a real ioredis
  connection at a fake host, so the run never exited. Nothing is blocked on this and no product code is
  implicated, but it is a standing background load on the machine every timing measurement in this wave is
  taken on — including W4-002's recorded "12 unrelated node processes" and every W4-D09 run. Steps for
  Daniel: (1) `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*worker.test.js*' } |
  Select-Object ProcessId, CreationDate, CommandLine` to confirm they are still the 00:22/00:29 pair;
  (2) `... | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`; (3) re-run `npm test` in `backend/`
  and expect the same 171/2073 green, only faster. Deliberately NOT killed by this session: H2 assigned
  local stray-process cleanup to Daniel, and killing processes is a destructive machine-level action nobody
  asked for mid-task. Worth stating plainly the other way round, though — the W4-D09 baseline was
  established **with** this load present, so cleaning it up can only improve the margins, never erode them.

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

## W4-D06 evidence — the masked open-handle leak (session 10)

Commit `0e2228a`. Suite **168 / 1944** green, exit 0 (from 167/1891: +1 suite `wave4.openHandleGuard.test.js`
with 53 pins, **zero re-pins**). TDD evidence: the new suite ran RED with **0 tests executed**
(`Cannot find module '../jest/openHandleGuard'`) before any implementation existed, then 53/53. The leak fix
has its own red→green, and it is the better one: with the guard installed and the tests unfixed, the two
biometric suites reported **163/163 tests passed and exit 1** — which is the whole point of the task.

**What was actually wrong, and where the premise was finer than stated.** The two leaked 60 s debounce timers
were real and exactly where W4-D06 said (`biometricHandler.js:1248`, armed from `wave4.bugfix.test.js` and
`biometricHandler.pipeline.test.js`). The *cause* was one line finer than "the tests forget to clean up":
`_debounceMap.clear()` and `.delete()` LOOK like cleanup and are not — they drop the state object while the
timer stays armed on the shared event loop, then fire against `debounceMap` up to a minute later. Production
never had this bug; `registerBiometricHandler`'s disconnect handler already does `clearTimer` THEN `delete`.
Every test that reached for the map directly re-derived that order and got it wrong.

**The cross-suite flake was demonstrated, not argued.** Before the fix, the full suite under
`--detectOpenHandles` (which slowed the run to ~92–98 s, long enough for a 60 s timer to come due mid-run)
failed **non-deterministically in a different suite each time** — `shadow.auth.test.js` on one run,
`socket.auth.test.js` on the next, both real-socket auth suites, both timing out on a 10 s budget. After the
fix the same command is green twice at 83–89 s. That also **corrects an intermediate conclusion of this
session**: the first working hypothesis was that `--detectOpenHandles` itself destabilises the auth suites.
It does not — it merely made the run slow enough for the leaked timers to land. The flag costs ~0 s here.

**Two halves, both load-bearing:**

1. **`_resetDebounceState()` in `biometricHandler.js`** — release every armed timer, then clear, as ONE
   operation built on the same `clearTimer` the disconnect path uses. Not two calls a caller must remember in
   the right order: that is W4-D02's lesson applied (a rule nobody can fail loudly is not a control). All 11
   `_debounceMap.clear()`/`.delete()` sites across 4 suites now call it, plus a top-level `afterEach` in the
   two files that arm the streaming lane.
2. **`jest/globalTeardown.js` — the standing guard.** `globalSetup` snapshots
   `process.getActiveResourcesInfo()`, `globalTeardown` re-samples and throws on any GROWTH. That hook is the
   last thing that can still influence the exit code — it runs after every suite and after the reporters, but
   BEFORE `--forceExit` takes the process out (`runJest.js` → `runGlobalHook`, then `readResultsAndExit`) —
   verified against jest 29 on a scratch project before being relied on. Wired via a new `jest` key in
   `package.json`, so it is on for CI (`npm test`) as well as locally.

**Why the resource delta and not `--detectOpenHandles` on every run.** Jest's detector FILTERS handles to
those whose stack points at user code. Measured during this task: it reported **2** handles where the delta
reported **3**, having dropped one raised inside `node_modules`. That filter is wrong in exactly the direction
this wave is heading — a leaked ioredis dial, BullMQ worker or repeatable (W4-003/004/011/012) is constructed
inside a dependency, so the detector is weakest precisely where the risk is highest. The delta cannot be
filtered and costs one array per run. `--detectOpenHandles` keeps its real job as the localizer: it alone
names the file and line, so it ships as `npm run test:handles`, with a `testResultsProcessor` that turns its
findings into exit 1 (jest otherwise prints them and exits 0). That seam is the ONLY one that works:
`collectHandles()` populates `results.openHandles` after the reporters have run and after `success` is already
computed, so a custom reporter physically cannot do it — checked in `@jest/core` source, not assumed.

**Constant derivation (`DRAIN_MS = 250`).** A clean run is not empty at teardown: jest's own progress reporter
arms a 100 ms debounce on every `testFinished` (`@jest/reporters/build/Status.js` `_debouncedEmit`), and the
last one is still pending. Identified with an async_hooks probe rather than guessed — the first reading of
"1 residual Timeout on a pure suite" looked like a product leak and was not, and the guard would have been
built around a phantom. Without a settle window it would report that phantom `Timeout` every run, and the only
way to green it would be to ignore `Timeout` wholesale — gutting the exact class W4-D06 exists for. 250 ms is
2.5× the known debounce, once per run. The trade is explicit and documented in the module: a leaked timer
under 250 ms is missed, which is the right side of it — 60 s debounces, intervals, sockets, Redis dials and
BullMQ workers all survive it trivially.

**`IGNORED_TYPES` is empty, by measurement.** The full 168-suite run was sampled with nothing excused and
reported no growth of any type. Every future entry must carry the measurement that justified it; the module
says so, and pins assert `Timeout` is not on the list and that the list is frozen, so a suite cannot widen it
at runtime to go green.

**The footgun is pinned shut.** A tripwire scans every `tests/*.test.js` for `_debounceMap.clear()`/`.delete()`
and fails naming the file. Its detector self-test builds the offending strings by concatenation on purpose —
a literal would make the tripwire's own file an offender and force the scan to skip itself, which is how a
tripwire quietly stops covering everything.

**Known limits, deliberately recorded.** (a) The guard reports a resource TYPE, not a location — that is what
`npm run test:handles` is for, and the failure message says so. (b) It is a whole-run delta, so a handle armed
and released inside the run is invisible to it; the tripwire and the per-file `afterEach` cover that class for
the debounce timers specifically. (c) Unlike W4-D01's marker, this guard keeps no machine-local state in the
gitignored `logs/`, so there is nothing that can silently disappear and switch it off.

## W4-002 evidence — the synthetic-human simulator (session 11)

Commits `7782310` (rng + personas + generator) and `79efc81` (replay + soak). Two TDD cycles, each RED first:
cycle A ran with **0 tests executed** (`Cannot find module '../sim/rng'`) before any implementation existed, then
55/55; cycle B likewise (`Cannot find module '../sim/replay'`, 0 executed) — `sim/replay.js` was written, then
**moved out of the tree** so the red was genuine rather than narrated, then restored. The soak block ran RED the same
way (`Cannot find module '../sim/soak'`). Final: **84 new pins, zero re-pins** — W4-002 is additive, it changes no
existing behaviour, which is why nothing existing needed re-pinning.

**What shipped.** `sim/rng.js` (sfc32 seeded through splitmix32; gaussian, standardised Student-t, labelled
`fork()`), `sim/personas.js` (the mission's five + **two holdouts**), `sim/generator.js` (cosinor + noise +
episodes, artifact injector, both lanes), `sim/replay.js` (drives the real handler + real `healthStore.ingestBatch`
against `mongodb-memory-server`), `sim/soak.js` (24h-equivalent, RUN_SOAK-gated CLI). `fast-check` added as the
S15 property-testing devDep — the lockfile diff is **purely additive** (41 insertions, 0 deletions): npm dropped the
hoisted optional-peer `gcp-metadata` entry as it did in session 1, and it was restored so the diff is only the dep.

**Design decisions, and why the alternative lost:**

- **RHR is DERIVED, not declared.** `restingHeartRate === mesor − amplitude`, enforced in `definePersona` and
  pinned. Carrying it as a free third field is the obvious shape and is wrong: two numbers describing one fact
  eventually disagree, and an answer key that quietly contradicts itself is the worst failure a fixture has, because
  every estimator graded against it inherits the error silently.
- **No extra sleep dip.** Real cosinor fits run over all 24 h INCLUDING sleep, so the measured amplitude already
  contains the nocturnal drop; adding a second dip would inflate the amplitude the generator CLAIMS above the one it
  CONTAINS, and W4-004's "recovers {M, A, φ}" would then be measuring that discrepancy. Sleep instead narrows the
  noise (`sleepNoiseFactor`), which is the real autonomic effect and leaves the rhythm honest.
- **Noise is Ornstein–Uhlenbeck (AR(1) in continuous time), scaled at USE from a unit-variance state.** The two lanes
  sample at different rates (60 s live, 300 s batch), and a plain fixed-rho AR(1) would mean a different spread and a
  different memory at each — so every persona would silently be a different body per lane. Pinned by asserting the
  stationary spread at 15 s and at 300 s agree.
- **Ground truth is exposed TWICE.** `restingHeartRate` (parametric) and `empiricalRestingHeartRate` (P10 over the
  realised sleep samples) differ by 1–2 bpm from finite-sample effects. A later test tightening onto the wrong one
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
  second near-duplicate path — and a soak harness CI never executes is one that rots. The gate reads `process.env`
  at CALL time (a module-level constant would freeze the answer at `require()` and be untestable); pinned both ways.
- **The soak report is O(personas), not O(samples), and that is pinned** (a 4-day report is < 1.5x a 1-day one, and
  contains no `samples`/`events` arrays). It is the only anti-leak property a soak can actually assert about
  itself; a byte-threshold on heap would have been flaky theatre.
- **The replay harness tears down through the handler's OWN `disconnect` listener**, never `_debounceMap.delete()` —
  the footgun W4-D06 pinned shut. `--detectOpenHandles` over both new suites is silent, exit 0.
- **`lanes: false` was considered and REJECTED on measurement, not taste.** The suspicion was that building both
  lanes on truth-only tests was the suite's cost; timing said the heaviest generator call (4 personas x 14 days) is
  **424 ms**. The real cost was ~13 s of per-iteration `expect()` overhead in two loops, fixed by collecting
  violations and asserting once (generator suite 20.6 s → 7.2 s). Adding API surface for a 0.5 s saving would have
  been gold-plating with a plausible-sounding justification.

**One implementation defect the pins caught before it shipped.** A sample inside an episode whose start jitter dipped
into the sleep window carried `asleep: true` at 168 bpm — breaking the "asleep implies resting" invariant AND
feeding workout HR into the P10-over-sleep resting estimate, i.e. re-creating the exact D2 contamination the fixture
exists to EXPOSE. `asleep` now means asleep (`!episode && inSleepWindow`): an early workout means the body got up
early, which is also what it means in life.

**Two tests were measuring the wrong axis, and the fix is the finding.** The Live-mode serve-count pins read 33–37
serves per simulated day and looked like a W4-D05 regression. They were not: the immediate lane triggers on a band
crossing **OR** an activity change, and `syntheticBioMoodKey` is `bio:<band>:<activity>` — so a `resting`/`unknown`
relabel genuinely changes the buffer key and is NOT the identical-key waste D11 was about. What the numbers actually
showed is that the ACTIVITY axis has **none** of the three protections W4-D05 gave the HR axis (noise floor,
asymmetric release, served-band latch), so its churn is exactly as fast as the classifier's. The band-axis pins now
hold the label still so they measure what they claim, and a separate pin MEASURES the activity axis without judging
it — the flip rate is the fixture's, not a sourced claim about any real watch, and W4-009 owns the real fix
(state transitions with min-dwell across both axes). Recorded here rather than queued: it is W4-009's committed scope.

**Deliberate "this is what it does TODAY" pins.** Three assertions encode current behaviour so the scheduled fix is
visible as a decision instead of a drift: the live socket lane persists **nothing** (D10 → W4-003), a future-dated
reading is **accepted** (S6 → W4-003), and one out-of-range batch sample is dropped while `inserted` reports success
(W4-D08). Each names the task that will flip it.

**Suite.** See `testBaseline` above for the full control evidence. Short version: **170 suites / 2028 tests**, the
only failure is a pre-existing wall-clock latency budget that reproduces with these suites REMOVED (twice, in two
different files), and both offending files pass in isolation. Not banked as a green baseline — §0.4 S1a — and queued
as W4-D09. Secret scan of the branch diff: clean. No numeric vitals in any new log line: the generator's telemetry
carries counts and timings only and a pin asserts it never matches `(hr|bpm|hrv|rhr)=`. No attribution. Still no
`lint` script in `backend/package.json`, so that DoD line stays vacuous — recorded, not claimed.

## W4-D09 evidence — the non-deterministic latency budgets (session 12)

Commits `f0085a9` (helper + pins), `e8ed646` (the two per-call call sites), `de45866` (the burst budget).
Suite **171 suites / 2073 tests** green, exit 0, twice back to back (see `testBaseline`). From 170/2028:
+1 suite `wave4.perfBudget.test.js` with 45 pins, **3 deliberate re-pins**, no test-count change in the
two edited files. TDD evidence: the suite ran RED with **0 tests executed**
(`Cannot find module '../jest/perfBudget'`) before any implementation existed; with the helper landed but
the call sites untouched it ran **34 passed / 4 failed**, the four being exactly the tripwires that assert
the call sites were rewritten — the red MOVED to the remaining work instead of vanishing. Then 64/64.

**S2 — this session adopted a leftover instead of stashing it.** The prior session was killed at its
session limit (`12b9859`) having written `tests/wave4.perfBudget.test.js` and nothing else. The file was
re-verified genuinely red, read in full, and adopted as this task's RED phase — the case §0.4 S2 permits,
because the leftover was understood completely rather than built on blindly. Its header comment was then
REWRITTEN, because its measurements did not reproduce (below). `mobile/src/health/config.ts` stays
uncommitted per session 1.

**The premise held. Two of its inferences did not, and one of its justifications did not reproduce.**
Measured here with a 20-sample probe substituted for the two assertions:

| operation | full 170-suite run | two-suite isolated run |
|---|---|---|
| `generateV2` stageMs.total | 188..194 ms | 231..307 ms |
| selection pipeline, 500-track pool, k=50 | 190..204 ms | 241..292 ms |

- **The SLOW condition is the ISOLATED run, not the loaded one** — the opposite of what the row assumed.
  170 suites of warm JIT make the full run the FAST case. "Both pass in isolation" was a snapshot, not a
  property.
- **No memory pressure is needed.** Two of twelve isolated `generateV2` samples (304, 307 ms) clear the
  300 ms budget with the box idle — an observed over-budget rate of 2/12, so the five-sample loop passed
  roughly `0.83^5 ≈ 40%` of the time under that condition.
- **The prior session's stated justification for min-of-N did not reproduce.** It claimed single-shot
  wall-clock inflates to 2.8x true cost under 8-way contention while min-of-5 holds to 1.78x. Re-run on
  this box against a CPU-bound workload of known cost with **24 hogs on 16 cores**, single-shot max
  inflated **1.05x** and min-of-5 **1.04x** — contention is simply not the mechanism here. The comment was
  replaced with the mechanism that IS measurable: the operation's own ~60% cost swing (188 -> 307 ms).
  min-of-N survives for a reason that holds regardless: wall-clock noise is **one-sided** — an operation
  cannot run faster than its true cost, while GC, deopt and descheduling only add — so the minimum
  estimates the floor, and every sample must be inflated for the result to be.

**What shipped.** `backend/jest/perfBudget.js`: `summarize` (min/p50/p90/max/n, nearest-rank so n=1 is
defined), `measure` (warmup + samples, injected clock/cpu/reset, S9-pure), `fromDurations` (for call sites
that already own their samples), `expectWithinBudget` (collapse ceiling on min, opt-in SLO on p50). All
three options the DoD offered are delivered together rather than one of them: a generous ceiling
(`COLLAPSE_BUDGET_MS = 600`), a recorded distribution (a one-line `[perf]` record on EVERY run), and the
strict SLO behind `PERF_STRICT` — plus CPU time sampled alongside wall time as a fourth signal.

**Constant derivation.** 600 ms is 2.6x the worst min-of-N observed for either operation (231 ms, cold and
isolated) and ~2x the worst single sample ever seen (307 ms) — clear of the operation's entire observed
range, so only a real algorithmic regression trips it. `SLO_MS = 300` is the §0.4 S10 product number,
checked on p50 and only under `PERF_STRICT`, because a shared runner should not be able to turn a correct
build red on the SLO. Both constants live in the helper, not at the call sites: hand-copying a threshold
into each consumer is exactly the trigger/key divergence D11 was about.

**Why a loose ceiling is not a quiet weakening.** On its own it would be — 600 hides a 2x drift. The record
line is what makes it honest: `[perf] selection-500 min=191 p50=192 p90=194 max=194 n=5 budget=600
cpuMin=187` prints on every run, so a 190 -> 390 drift is visible in the log even though it does not fail.
Ceiling = collapse guard; record = drift visibility; strict mode = the SLO on demand. The old assertion had
none of the three: it had one sample and a coin flip.

**Both directions proven, not argued.**
- Stub-out: `COLLAPSE_BUDGET_MS` temporarily set to 50 → both call sites RED with
  `generateV2 exceeded its performance budget: min=254ms > budget=50ms (p50=289 p90=327 max=327 n=5)`.
- Strict path: `SLO_MS` temporarily set to 1 with `PERF_STRICT=1` → both call sites RED with
  `missed its strict SLO`. At the real 300 with `PERF_STRICT=1` the suites pass (p50 277 / 263).
  Constants restored to 600 / 300 and re-verified in the file after each experiment.

**The task was one assertion wider than the row knew, and the verification run is what found it.**
`shadow.flip.test.js:212` also bounded the 20-user burst with an absolute constant (`wall < 6000`). It is
the same defect one timescale up, it was NOT in the row's named scope, and it failed **on a clean
full-suite run (C) at 6236 ms** — so the DoD's "re-establish a genuinely green baseline" could not be met
without it. It was fixed rather than queued: leaving a known-flaky wall-clock budget in a file this task
was already editing, while claiming the baseline is now deterministic, would have been false.

The replacement is **relative, not a bigger constant**. The work is CPU-bound with mocked I/O, so 20
concurrent generations can never beat 20 sequential ones — measured overhead ratio **0.996 / 1.022 /
1.052** over three isolated runs and **1.222 / 1.139** over two full-suite runs. The budget is now
`2.0 x 20 x (min-of-3 calibration measured on the same box in the same run)`, which is precisely "queueing,
not collapse" and does not age with the hardware: it read 6990, 7650 and 10000 across runs instead of a
fixed 6000. The calibration is min-of-3 for the same one-sided-noise reason the helper exists — a
calibration landing on a fast slice would tighten the budget into a flake.

**A first cut of 1.5 was rejected, and the rejection is itself the finding.** Against the worst observed
pairing (1.222, run D) it left only 23% headroom — the same thin margin that made the ORIGINAL constant
flake, reproduced at a different number. It was caught only by computing the ratio from the two FULL-SUITE
runs instead of trusting the three isolated ones, where it looked like a comfortable 1.00-1.05: the
full-suite figures are the high ones because a loaded heap makes GC rather than concurrency the marginal
cost, and because the min-of-3 calibration can itself land low there (233 ms in the run that produced
1.222), inflating the ratio from the denominator. 2.0 leaves ~64% headroom and still trips what the test
guards — a real collapse runs 2.5-5x serial, not 1.2x.

**Six full runs, and what each one proves.** (D/E ran at ratio 1.5, F at the final 2.0.)

| run | condition | result | `generateV2` | `selection-500` | burst / budget |
|---|---|---|---|---|---|
| A | clean, pre-burst-fix | 171/2070 green, 118.3 s | min 257 p50 299 max 311 | min 242 p50 279 max 301 | passed vs 6000 |
| B | **deliberate 2x overload** (a second full suite running concurrently), pre-burst-fix | **2 failed** | min 304 p50 320 max 330 | min 315 p50 320 max 334 | **failed** vs 6000 |
| C | clean, pre-burst-fix | **1 failed** | min 292 p50 308 max 337 | min 305 p50 316 max 336 | **failed, 6236** vs 6000 |
| D | clean, post-burst-fix | **171/2073 green, 121.1 s** | min 260 p50 272 max 298 | min 225 p50 258 max 307 | 5695 / 6990 (ratio 1.222) |
| E | clean, post-burst-fix | **171/2073 green, 121.9 s** | min 255 p50 273 max 352 | min 291 p50 304 max 332 | 5809 / 7650 (ratio 1.139) |
| F | clean, final ratio 2.0 | **171/2073 green, 117.7 s** | min 231 p50 263 max 312 | min 261 p50 266 max 286 | 5596 / 9280 (ratio 1.206) |

The two per-call budgets held in **all six** runs, including the overloaded one — that is the fix working.
Under the OLD per-call assertions, runs A, B and C would ALL have been red: A's `generateV2` loop required
every one of 5 samples < 300 and its worst was 311, and in B and C every sample of both operations exceeded
300. The exposure did not go away afterwards either — E's worst `generateV2` sample was **352 ms** and F's
312 ms, both on green runs — which is the clearest statement of the defect: the old assertion would have
failed builds that are, by every other measure, correct. B was contended by accident (launched before A had
fully exited) and is kept deliberately: it is the loaded-machine case the DoD names, and the fix holds there
with ~2x headroom.

**A note on how these numbers were obtained, because it changed one conclusion.** The background-task
notification stream in this session repeatedly reported figures that did not match the files on disk — it
reported run B as green when `npm test` had exited 1 with two failures, and reported run D twice with
different timings. Every number in this section was therefore re-read directly from the `npm test` output
files with a fresh command, and the process table was checked to confirm a run had actually exited before
its output was trusted. The first read of run F was taken while jest was still writing, which is exactly how
a half-finished run can be mistaken for a finished one. Recorded because R2's rule generalises: trust
nothing that reports its own success, including the harness reporting the test run.

**Recorded, deliberately not chased.** (a) `captionService.test.js:144` also asserts wall clock
(`elapsed < 1000`) and was checked: it bounds a 60 ms *timeout* firing — a 16x margin on a control-flow
assertion, not a performance budget on computation. Different bug class, left alone, noted here so a later
reflection does not re-raise it as a miss. (b) Run B's second failure was `socket.auth.test.js` timing out
on its 10 s budget — the real-socket class W4-D06 already documented. It failed ONLY under the artificial
2x overload this session created, which no real workflow produces, so it is recorded rather than queued
(R6: do not manufacture busywork).

**Seam left for W4-007.** §0.4 S10 asks that task's golden harness to assert end-to-end selection wall-time
within +10% of a pre-wave baseline. That baseline is now measured rather than notional: on a warm
full-suite run both operations sit at **min ≈ 190 ms, p50 ≈ 192 ms** (runs D and E agree to 1 ms), and
`perf.measure` / `expectWithinBudget` are the instrument to compare against it.

Secret scan of the branch diff: clean (the only hits are the mission's own DoD line quoting the grep
pattern and a `Task-` substring). Zero-knowledge: the record line carries timings and counts only, and a
pin asserts it never emits an identifier or a vital. No attribution. Still no `lint` script in
`backend/package.json`, so that DoD line stays vacuous — recorded, not claimed. W4-D06's standing
open-handle guard is unaffected: `npm test` runs `globalTeardown`'s resource-delta check and both green
runs exited 0.

## W4-D08 evidence — the over-reported insert count (session 13)

Commits `b768acd` (helper), `1a1dc94` (mocks), `bfc5a85` (lanes + pins). Suite **172 suites / 2091 tests**
green, exit 0, twice back to back (120.2 s / 120.9 s). From 171/2073: +1 suite `wave4.ingestAccounting.test.js`
with 17 pins, +1 test appended to `sim.replay.integration.test.js`, **1 deliberate re-pin**. TDD evidence: the new
suite ran RED with **0 tests executed** (`Cannot find module '../app/services/wearable/insertAccounted'`) before any
implementation existed, then 13/13, then 17/17 once `mergeRejected` was pinned.

**The premise held exactly, and it was measured before it was fixed.** A throwaway probe against
mongodb-memory-server + Mongoose 9.7.1 — not documentation, not memory — established the real contract:

| call | returns | on one invalid row of three |
|---|---|---|
| `insertMany(docs, {ordered:false})` | an ARRAY of the inserted docs | resolves, length 2, no error, nothing logged |
| `insertMany(docs, {ordered:false, rawResult:true})` | `{acknowledged, insertedCount, insertedIds, mongoose:{validationErrors, results}}` | `insertedCount: 2`, one `ValidationError` carrying `.index` and `.errors[path].kind` |
| either, on a server-side E11000 | THROWS `MongoBulkWriteError` | unchanged by the flag |

So the driver always knew; no caller ever asked. `persistMetrics` returned `inserted: hrDocs.length`.

**The scope was two lanes wider than the row knew.** The row named `metricStore.persistMetrics`. Grep found the
same pair — `insertMany(docs, { ordered: false })` next to `count = docs.length` — hand-copied into
`appleHealth.ingestBatch` and `suunto.handleWebhook`, both returning `ingested: docs.length`. Fixing one and
queuing two would have left two live ingest paths with a known silent-data-loss bug and produced a third
hand-copy of the accounting, which is precisely the trigger/key divergence D11 was about. The accounting is
therefore ONE module (`app/services/wearable/insertAccounted.js`) that all three lanes call.

**Design decisions, and why the alternative lost:**

- **The reject vocabulary is closed, and that is a security decision, not a style one.** Mongoose's validator
  messages QUOTE the submitted value — measured, for a bad `source`: "*`fitbit` is not a valid enum value for path
  `source`*". Passing a message through would have put user-submitted data into a DTO, an HTTP response and a log
  line in one move. Only `path` and the validator `kind` ever leave the module. Worth recording the near-miss: for
  `heartRate` the message happens to be value-free ("encrypted numeric value out of range") because the validator
  runs AFTER the encrypting setter and so names ciphertext, not bpm — relying on that would have been relying on an
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
  reject and two reasons — pinned, because the two numbers legitimately differ and a reader will assume they cannot.
- **The recompute enqueue deliberately still fires on the ATTEMPTED count.** It is a "new data arrived" signal, it
  is debounced and idempotent, and re-gating it on `inserted` would have been an unrelated behaviour change riding
  along on a reporting fix. Stated in a comment at the site so it reads as a decision.
- **`mergeRejected` lives in the helper, not in the replay harness.** A backfill is many batches and one answer;
  putting the fold at the call site would have been the same one-definition mistake at a smaller scale.

**The mocks were the reason this survived, so the mocks were fixed — not the assertions.** Four unit suites mocked
`BiometricLog.insertMany` to resolve `[]`, a shape that cannot express "one of these did not land".
`healthStore.test.js` duly went red at `expect(result.inserted).toBe(1)` the moment the count became truthful. That
assertion is CORRECT and was kept byte-for-byte; the mock now returns the real `rawResult` accounting object. That
is the open W4-D07 theme (a mock whose semantics diverge from the real adapter) closed for this seam. The new suite
is a REAL mongodb-memory-server integration on top, because §1 forbids a green mock for an integration boundary and
this bug lived exactly at that boundary.

**The one deliberate re-pin is the point of the exercise.** W4-002 pinned the defect on purpose ("MEASURED: one
out-of-range sample is dropped silently and `inserted` over-reports") so the fix would flip it loudly. It flipped:
same fixture, `report.inserted` now equals the row count instead of exceeding it, plus new assertions that the
reject is surfaced and that the serialized report contains no `340`.

**Both directions proven.** Stub-out: `inserted` forced back to `list.length` (the old lie) turned **6 tests RED
across both suites**; restored and re-verified green. The pins are load-bearing, not decorative.

Secret scan of the branch diff: clean (the only hits remain the mission's own DoD line quoting the grep pattern and
a `Task-` substring). Zero-knowledge: the new `[insertAccounted]` warn carries model name, counts and
(path, validator-kind) pairs only, pinned by two tests — one asserting it never contains the offending value, one
asserting it is SILENT on a clean batch; the new `rejected=` field on the `[healthBatch]` line is a count. **That
same log line was found to serialise numeric vitals already** (`profileMetrics=`) — pre-existing, untouched, queued
as W4-D10. No attribution. Still no `lint` script in `backend/package.json`, so that DoD line stays vacuous —
recorded, not claimed. W4-D06's open-handle guard and W4-D09's perf budgets both passed on each run.

## W4-D08 reopen + W4-D11 evidence — the unimported call and the missing linter (session 15)

Two rows, one session, deliberately: W4-D08's re-DoD point 3 asks for "the standing regression guard per this run's
precedent … see W4-D11, which is the guard for this class and should land in the same session". The bug and the control
that would have caught it ship together.

**Test-first, and the RED was the production defect itself.** `tests/wave4.ingestLanes.test.js` (16 pins) was written and
run BEFORE the one-line fix: **9 failed / 7 passed**, and 8 of the 9 failures are
`ReferenceError: insertManyAccounted is not defined` thrown from `app/services/wearable/suunto.js:50` by the REAL
production function. The 9th was a test-authoring error of mine, corrected before the production change ever landed:
`.lean({ getters: true })` does not run the decrypting getter, so the assertion compared 72 against ciphertext. After
adding `const { insertManyAccounted } = require('./insertAccounted');` — the entire product fix — **16/16 green**.

**The pins execute the real modules; nothing is mocked.** That is the whole point of the row. The only two suites
mentioning suunto `jest.mock` the entire module, so a stub answered for it and the lane itself was never run. Both
regression faces are now pinned: a webhook with valid samples, and one carrying **no heart-rate samples at all** — that
batch never reaches the database and it threw anyway, which is what proves the failure was unconditional rather than a
lossy-write edge case. The reject-accounting path the row demands is pinned on BOTH lanes (`hr: 340` → `ingested: 2`,
`rejected.count: 1`, reasons `[{path:'heartRate', reason:'user-defined', count:1}]`), alongside the signature branch
(correct HMAC accepted; forged signature still 403 with nothing written), the adapter mapping (GYM→strength, unmapped
sport→unknown), the appleHealth 500/501 batch boundary, and a zero-knowledge pin per lane asserting no submitted vital
appears in the response.

**W4-D11 — the linter, and the honest count.** `eslint@10.8.1` + `globals` as devDeps, flat CommonJS config
(`backend/eslint.config.js`), `npm run lint`. `no-undef` is an **error**; `no-unused-vars` is a **warning** with an `^_`
ignore pattern, precisely so pre-existing debt in untouched files cannot fail a build and this task does not become a
repo-wide rewrite. Measured across the whole backend, 334 files: **0 errors, 22 warnings** — `app` 142 files (0/6),
`sim` 5 (0/0), `tests` 174 (0/16), `jest` 5 (0/0), `scripts` 8 (0/0). The 22 are 20 `no-unused-vars` plus 2 unused
`eslint-disable` directives (one at `integrationsController.js:760` for `no-await-in-loop` — evidence somebody once
intended a linter here). Nothing was mass-fixed; the count is recorded, exactly as the row's DoD asks. Repo-root
`scripts/wave4/` sits outside the backend package and is not covered — noted, not silently implied.

**The guard runs inside the suite, and it is load-bearing — proven by stub-out, twice.**
`tests/wave4.lintGuard.test.js` (10 pins) drives the real eslint CLI as a child process rather than the ESLint API: the
API resolves config and globs through dynamic `import()` and throws under jest's CJS VM ("A dynamic import callback was
invoked without --experimental-vm-modules"), and driving the CLI additionally means the gate and `npm run lint` cannot
drift apart. Stub-out check, run with the require deleted and the file restored afterwards (`git diff --quiet` verified):
the CLI reports `error 'insertManyAccounted' is not defined  no-undef` at exactly `suunto.js:50`, and the jest guard
turns **3 of its 10 pins RED** carrying that same `file:line [rule] message` as its failure output — so a future session
gets the finding, not a bare count. Guarding the guard: pins assert `no-undef` really is enabled at error level (via
`--print-config`, on both `app` and `sim`) and that the glob matched >100 files, so a config edit that disarmed the rule —
or a glob that silently matched nothing — fails loudly instead of going quietly green.

**Lock hygiene.** `npm install --include=dev --save-dev eslint globals` also pruned the optional/peer `gcp-metadata`
entry — the same unrelated bare-`npm install` artifact session 1 identified and restored. It was restored here too, so
the committed `package-lock.json` diff is **715 insertions, 0 deletions**: purely the eslint tree, nothing else.

**DoD.** Full suite **174 suites / 2117 tests (2116 passed + 1 todo), exit 0**, twice — 128.2 s and 124.1 s. Secret scan of
the branch diff: clean (the only hits remain the mission's own DoD line quoting the grep pattern and a `Task-` substring).
Zero-knowledge: no new log line, DTO or prompt carries a numeric vital, and the two new ZK pins assert it for both lanes'
responses. No attribution anywhere. And "lint clean" is, for the first time in this run, a claim backed by a control
rather than a footnote.

## W4-003 evidence — the pure core: telemetry DTO + anomaly filter (session 16)

Half an L task, split on purpose and declared up front in the row rather than discovered at the end: this
session is the PURE CORE (§M.1/M.2 math + contract + tests), session 17 is the WIRING (handler seam, live
persistence, D10). Nothing here touches a serving path yet, which is why the suite gained 82 pins and zero
re-pins.

**Test-first, and the RED moved three times.** The first RED is the honest one for new modules —
`Cannot find module '../app/agents/runtime/_shared/dto/telemetry'`, the whole suite failing to load. After the
implementation the second RED was **5 failed / 70 passed**, and the interesting part is what those five were:
four were MY FIXTURES being wrong, not the product. `flatSeries` built a bit-identical series and called it
"clean" — but forty identical integers at a 5 s cadence is a stuck sensor, which is precisely what the filter is
supposed to notice, so the fixture now dithers +/-0.5 bpm and a separate `heldSeries` exists for when a frozen
sensor IS the subject.

**The one genuine product defect the fixtures caught: the flatline span was too aggressive.** A first cut flagged
any identical run spanning > 30 s, which fired on quiet persona NIGHTS — devices report 1 bpm resolution and a
sleeping heart genuinely sits on one integer for a minute. Fixed by deriving the threshold instead of choosing
it: a value held past the wander process's own autocorrelation time `tau` (165 s) has outlived the thing that is
supposed to be moving it. Same envelope that gives `q`, one fewer magic number, and `does not flag degraded mode
anywhere on a clean stream` went green.

**Constants are DERIVED from a single physical envelope, and the derivation is pinned rather than the values.**
§M.2 specifies `R = 9` and "q tuned for ~30 s trend response". Taken literally that is a white-noise-acceleration
Q, whose level variance grows as `dt^3` — the wrong SHAPE for heart rate, whose short-term wander is a
mean-reverting process (sigma ~= 4 bpm, tau ~= 165 s) with variance growing linearly in `dt`. Tuned at 30 s it is
~37x too stiff at a 5 s cadence (steady-state gain 0.05 against 0.28). So Q carries two channels, both from that
one envelope: `q_level = 2*sigma^2/tau` and `q_accel = 3*q_level/T*^2` — the second IS the "~30 s response"
requirement stated exactly (at T* the trend channel contributes the same level uncertainty as the wander
channel). `trendVar0 = (sigma_z/T*)^2` and `flatlineSpanMs = tau` come from the same place. The tests assert the
RELATIONS, not the numbers, so a future tuning of sigma or tau cannot leave a stale derived constant behind.

**What that second term is actually worth — measured, after the first version of this note overclaimed it.** The
module header originally said the single-term filter "starts rejecting real physiology as outliers". It does not:
measured across all five personas the ACCEPTANCE rate is identical to two decimal places. What the term actually
buys is a consistent **~15% reduction in median tracking error** — athlete 0.33 -> 0.29 bpm, sedentary 0.49 ->
0.42, older-adult 0.38 -> 0.33, shift-worker 0.46 -> 0.39, stressed-professional 0.55 -> 0.48, with p90 improving
by the same fraction. The comment now says that instead. A good trade for one extra term; not the dramatic thing
it was first written as.

**THE FINDING OF THIS SESSION: a green suite did not mean the mechanisms were tested.** The stub-out battery this
run has used since session 9 was applied to all twelve mechanisms, and **four of them turned nothing red**:

- `q_level` — the wander-diffusion term above, i.e. the module's central mathematical claim, deletable with 76/76 still green.
- the **maturity** confidence factor on the accepted path — deletable, because the only pin that touched it was satisfied by the seed path's separate copy.
- the **slew gate** — fully shadowed by Hampel and the innovation gate, because my assertions said `expect(['slew','hampel','innovation']).toContain(reason)` rather than naming the gate.
- the **Hampel gate** itself, and separately its min-samples abstention.

None of these were fixed by writing a contrived test. Each was fixed by finding the region where the mechanism is
genuinely the only thing acting, by scanning rather than by assumption:

- `q_level` → an **ablation control**. `createFilterState(metric, {qLevel: 0})` IS the single-term filter, and the test asserts the shipped config beats it on median error for every persona, by > 8%. This is why config overrides exist at all (W4-004's per-user envelopes are the second consumer); a constant nothing can falsify is a constant nobody is checking.
- **maturity** → a reading arriving after 45 min of silence must be accepted but LESS confident than a mid-stream one, though both have near-zero innovation. That difference is the maturity term and nothing else.
- **slew** → the first readings after a gap, where Hampel has aged out and abstained and the covariance has grown so the innovation gate is wide: +10 bpm in 1 s is rejected `slew`, the same +10 bpm over 5 s is accepted. The permissive `toContain` assertions were tightened to name the gate.
- **Hampel** → scanned the (cadence, jump) grid for its unique region and found it: at an 8-12 s cadence a **+12 bpm** outlier is too slow for the slew gate (1.2 bpm/s) and inside 3 sigma of the innovation gate, but four times its neighbours' MAD. That is the real point of a model-free median test — it is TIGHTER than the model-based gate for moderate outliers, not a backup for it.
- **abstention** → at a 20-25 s cadence the window holds three samples, and three samples put the scale floor at 3 bpm, so an un-abstaining Hampel would reject any move over 9 bpm. A +10 bpm rise over 20 s is 0.5 bpm/s: standing up. Accepted with the abstention, `hampel` without it.

After that work **all twelve mechanisms turn at least one pin RED when stubbed out**, verified individually with
the file restored and `git diff --stat` empty after each: slew (2 red), q_level (1), maturity (1), Hampel gate (1),
Hampel MAD scale floor (3), Hampel min-samples abstention (1), reseed hatch (1), innovation gate (2),
monotonic-time gate (2), future-timestamp gate (5), stale-timestamp gate (1), physiological range gate (5),
reject confidence decay (3), raw-window-fed-on-rejection (2).

**Cadence honesty, pinned as a measurement rather than hidden.** Two artifact fixtures, because the classes are
not all detectable at one cadence and pretending otherwise would have meant fudging a threshold. At a live 10 s
cadence spikes and double-counts are caught **100%** (64/64 and 41/41). At a 60 s cadence spikes are caught
**77.8%** — and that is pinned as `> 0.7 and < 1` with the reason: a body genuinely CAN climb 35 bpm in a minute
(0.58 bpm/s, inside the slew ceiling), so a gate tight enough to catch it there would reject real activations on
the watch lane. W4-009's dwell work is what closes that, not a tighter threshold. The mirror image is pinned too:
the generator's 3-7 sample flatline runs span only 20-60 s at the live cadence, shorter than tau, and are
deliberately NOT flagged there.

**Convergence, on personas AND on holdouts (§R.10).** Median absolute error against ground truth, 5 s cadence,
artifacts ON, startup transient excluded: athlete 0.29, sedentary 0.42, older-adult 0.33, shift-worker 0.39,
stressed-professional 0.48 bpm — all inside the +/-2 bpm DoD with an order of magnitude to spare, p90 <= 1.3.
Re-run against the two HOLDOUT personas, whose noise family is student-t rather than the OU the constants were
derived from, so the filter cannot pass by having been tuned to its own fixture. Clean-stream pass-through >= 99%
on every persona (the DoD figure), and degraded mode fires nowhere on a clean stream.

**Numerical hygiene (S8) and determinism (S9).** `now` is a REQUIRED parameter and the module throws without it;
there is no `Date.now()` or `Math.random()` anywhere in it. 300-round `fast-check` fuzz over
null/NaN/+-Infinity/strings/objects/extremes asserts the output is always finite, the level always inside the
physiological range, confidence always in [0,1], the reason always from the closed vocabulary, and that it never
throws. Every division is guarded (the only `dt` divisor is protected by the monotonic-time gate, and `S >= R > 0`
by construction), the predict horizon is clamped at 1 h so `dt^3` cannot lose precision, and the state is
JSON-round-trippable — pinned by feeding a revived state and the original the same reading and comparing results,
so it can live in Redis or a socket map in the wiring half.

**Zero-knowledge (§0.2.2).** The two new modules contain **no `console.` call at all** — they are pure. The single
telemetry string is counts and flags only: `[anomalyFilter] metric=heartRate v=1 samples=40 accepted=40
rejected=0 reseeds=0 flatlines=0 degraded=none`, with a pin asserting it never matches
`(hr|bpm|hrv|rhr|level|value)=`. The clean DTO is `z.strictObject` precisely because the field most likely to
appear by accident is a raw vital; the raw ingest shape is `z.object` (unknown keys dropped) because the socket
payload is attacker-controlled and every shipped client predates the contract. `tzOffsetMinutes` is bounded to
[-840, 720] (S6) in the schema. No mongoose import in the DTO, and the activity/source vocabularies are pinned
equal to BiometricLog's enums by a drift-guard test rather than by hope (the W4-D11 rule).

**Dependency hygiene.** `zod@4.4.3` added as a PROD dependency (the DTO runs in the serving path). `npm install`
pruned the optional/peer `gcp-metadata` lock entry again — the same artifact sessions 1 and 15 identified — so it
was restored and the committed `package-lock.json` diff is **11 insertions, 1 deletion**: purely the zod entry.

**DoD status.** Failing-test-first ✓. Full suite **175 suites / 2199 tests (2198 passed + 1 todo), exit 0**, 138.1 s ✓.
Lint **0 errors, 22 warnings** — the same 22 session 15 recorded, none from the new files ✓. Secret scan of the
diff clean ✓. Zero-knowledge ✓. No attribution ✓. **NOT done, and owed by session 17:** the handler wiring, live
`BiometricLog` persistence (D10), the S6 gates at the ingest seam, the S11 kill-switch env flag for the new
serving-path behaviour, and W4-D07's mock divergence, which lands in exactly the seam being wired.

## W4-003 evidence — the wiring half (session 17)

The second half of the L task: plug session 16's pure `anomalyFilter` into `handleBiometricReading`. Commit
`80db9ed`. Suite **176 suites / 2213 tests (2213 passed + 1 todo), exit 0**, twice — 132.5 s and 149.6 s. Lint
**0 errors, 22 warnings**, unchanged. Secret scan of the diff: clean. No attribution.

**What shipped, mapped to the row's four remaining items:**

1. **The debounce/trigger machinery consumes the filtered estimate (D6).** `_filterHeartRate(state, normalized,
   now)` runs every reading through `createFilterState('heartRate')`/`filterReading` (per-socket state, lazily
   created) and returns `{level, trend, confidence, accepted, degraded}`. `effectiveHR = filtered.level` replaces
   every use of `normalized.heartRate` in both lanes (immediate/watch and the 60 s debounce) — `state.stableHR`,
   `state.pendingHR`, the band-crossing comparison, all of it. `state.hrEwma`/`_updateEwma`/`HR_EWMA_ALPHA` are
   RETIRED (the module comment said W4-003 would replace them, and it does: the Kalman `level`/`trend` is now the
   D7 observation trace, and it is REAL evidence rather than a heuristic smoothing constant).
2. **D10 live persistence.** `_maybePersistLiveReading` writes an ACCEPTED, genuinely-timestamped reading to
   `BiometricLog` — the RAW device value (not the filtered estimate: this table is the ground-truth record, and
   baseline engines are the ones entitled to smooth it), real `activity` + `source` (not metricStore's hardcoded
   `'unknown'`). Throttled to `LIVE_PERSIST_MIN_INTERVAL_MS = 60_000` per socket (tracked on `state.lastPersistedAtMs`,
   keyed on wall-clock `now`, not the reading's own `recordedAt`) and deduped via a `BiometricLog.exists({userId,
   source, recordedAt})` pre-check reusing the batch lane's `source@recordedAt` convention, so a reconnect replaying
   the same reading cannot double-write. Reuses `insertManyAccounted` (W4-D08's helper) rather than a fourth
   hand-rolled `insertMany` call — the one-definition rule (D11) applied to a fourth lane. Fire-and-forget:
   `.catch(() => {})` at the call site, `try/catch` + `console.error` inside, matching every other side effect in
   this file (`recordServeSideEffects`'s own comment: "a failed side effect is reported but never fails generation").
3. **S6 at the live seam.** No new gate was written — `filterReading` ALREADY rejects `future-timestamp` and
   `stale-timestamp` (session 16's own module). Wiring it in is what makes S6 real at this seam: a rejected reading
   never becomes `state.stableHR`, is never persisted, and (on the very first reading for a fresh socket, the only
   case where nothing has been seeded yet) `filtered.level` is `null` — the handler acks the well-formed payload and
   returns before touching any HR-dependent state, rather than fabricating a baseline from bad data.
   `tzOffsetMinutes` plumbing (accepting it on the socket event itself) is explicitly W4-004 scope per the mission
   text and was not pulled forward; the DTO already validates the bound and is pinned by `anomalyFilter.test.js`.
4. **S11 kill-switch.** `WAVE4_ANOMALY_FILTER_DISABLED`, same forgiving parse as `WAVE4_RECAL_STATE_TRIGGER_DISABLED`
   (`=1`/mixed case/etc. all count as ON). Set → `_filterHeartRate` short-circuits to a passthrough result (raw value,
   confidence 1, no filter state created) AND `_maybePersistLiveReading` no-ops (`filtered.passthrough` gates it) —
   one flag restores BOTH halves of W4-001-era behaviour, not just the trigger half.
5. **W4-D07 closed.** `biometricHandler.pipeline.test.js`'s mocked adapter now derives `recordedAt` from
   `raw.startTimeLocal` exactly the way the real `fromGarmin` does (`new Date(raw.startTimeLocal)`), instead of
   omitting the field outright. Every existing fixture that does not set `startTimeLocal` still gets
   `recordedAt: undefined` — byte-identical to before, which is why this file's other ~129 pins needed zero changes —
   and a NEW pin (`rejects an unparseable provider timestamp end-to-end`) proves a garbage `startTimeLocal` is
   rejected by the REAL `isValidReading` Date check through this suite for the first time.

**The pass-through path is deliberate, and it is why the blast radius stayed small.** `_filterHeartRate` falls back
to the raw value (unfiltered, confidence 1, no persistence) when `normalized.recordedAt` is not a usable `Date` —
which is UNREACHABLE through any of the three real adapters (they always construct `new Date(raw.something)`, so the
result is either a valid Date or an Invalid one, and an Invalid Date is already rejected by `isValidReading` before
the filter ever runs). It exists purely for a caller whose adapter output omits the `recordedAt` key entirely — which
is exactly what `biometricHandler.pipeline.test.js`'s pre-existing mock did for ~130 tests, none of which name
timestamps in their premise. Discovered by RUNNING the wiring, not by design up front: the first pass wired the
filter unconditionally and broke every multi-reading test in that file (a `dt` of "however many microtasks between
two `await`s" is not a sampling interval), which is what exposed that the mock's *entire* premise was "the device
timestamp doesn't exist for these tests" — matching W4-D07's own diagnosis one layer deeper than its DoD asked for.

**The OTHER real blast radius: five test files carried FIXED historical `recordedAt` fixtures (`2026-01-01`),
genuinely >90 days stale against a real clock now that S6 is wired.** Found by running the suite, not by
inspection — `wave4.bugfix.test.js`, `websocket.test.js`, `wave4.openHandleGuard.test.js` all failed identically
(`stableHR` stuck `null`, no debounce armed) until fixed. `wave4.bandHysteresis.test.js` and
`sim.replay.integration.test.js` already used clock-relative dates from earlier sessions and needed no fixture
change. The fix in all three broken files is the SAME pattern, applied consistently rather than hand-tuned per
file: `RAW_BASE_MS = Date.now() - 3*3600_000` (anchored once at module load, safely inside every S6 window for
the whole file's call volume) plus a per-call monotonic step. **The step size (6 minutes) is not arbitrary — it is
the anomalyFilter module's OWN documented claim, exploited rather than fought:** at watch cadence the module's
header says the Kalman gain is "essentially pass-through" (K ≈ 0.998), so spacing these legacy fixtures at that
cadence keeps them testing the debounce/trigger mechanics they were written for, not the filter's math. Measured,
not assumed: three assertions across `wave4.bugfix.test.js`/`websocket.test.js` needed `toBeCloseTo`/`toBeCloseTo`-
style tolerance instead of exact equality (e.g. `pendingHR` after a 70→85 jump lands at `84.99`, not bit-exact `85`)
— recorded as deliberate re-pins, not silently loosened.

**Two W4-002 "TODAY" pins flipped, exactly as the row from session 16 forecast — both re-verified as REAL flips,
not renamed no-ops.** `sim.replay.integration.test.js`, `FIXED: a future-dated reading still ACKS ... but never
confirms a heart rate (S6)`: the ack assertion is UNCHANGED (a well-formed payload still acks — that was always
correct and stays correct), but a new assertion — `state.filterState.rejectedCount > 0` — proves the reading was
actually rejected downstream, which is the part W4-003 was scoped to close. `FIXED: the live socket lane now
persists accepted readings (D10)`: was `toBe(0)`, is now `rows.length > 0` AND `<= events.length` (the throttle),
with real (non-`'unknown'`) activities and the real source — verifying the persistence contract, not just its
existence.

**One test needed a genuine tolerance widening, not just a numeric-format change, and it is recorded as a finding
rather than a fudge.** `the served-band latch holds through a resting oscillation across the 90 cut` (a persona
whose HR sits right on the 90 bpm cut for a full simulated day) went from `<=4` to `<=5` serves — MEASURED,
deterministic (seeded), reproduced on request. Root cause: the trigger now compares the FILTERED trajectory, which
carries its own level/trend memory and is not bit-identical to the raw series: for a signal hugging a decision
boundary, that memory can move exactly one crossing to a different 5-minute sample than the raw values alone would
have produced. The property the test actually guards — "bounded, nowhere near the dozens of serves an unlatched
trigger would produce" — still holds at 5; only the exact boundary count shifted, which is the honest cost of
introducing real signal processing at a boundary this task was told to leave semantically unchanged elsewhere.

**Verification, not narration.** `wave4.liveWiring.test.js`'s 14 pins were stub-out checked as a batch: temporarily
replacing `_filterHeartRate`'s call with a hardcoded passthrough result turned 7 of the 14 RED (the ones that assert
S6 rejection, filtered-value seeding, and persistence — i.e. everything that depends on the filter actually running),
while the other 7 (kill-switch behaviour, which is SUPPOSED to look like passthrough) stayed green — confirming the
green 7 are correctly independent of the stub rather than accidentally always-passing. File restored and re-verified
green after.

**Design decisions, and why the alternative lost:**

- **Persisted value is RAW, not filtered.** The table is the ground-truth device record; a future baseline engine
  (W4-004) is the one entitled to decide how to smooth it, and persisting an already-smoothed number would silently
  bias every downstream consumer of "what did the device actually say" with no way to recover the original.
- **Throttle keys on wall-clock `now`, not the reading's own `recordedAt`.** A backfill/reconnect burst could carry
  readings whose `recordedAt` values span minutes while all arriving in the same instant; throttling by arrival time
  bounds write RATE (the stated goal — protecting BiometricLog from a live firehose), while throttling by sample time
  would not.
- **Dedupe is a pre-check (`exists` then `insertMany`), not an atomic upsert.** `heartRate` is `encryptedNumber` (a
  setter-driven field), and Mongoose setters do not run on `findOneAndUpdate($set)` (§0.2 hard constraint #2) — an
  upsert would need to hand-encrypt, which is a second definition of "how BiometricLog.heartRate gets encrypted" the
  codebase does not otherwise have. The race window (check-then-insert on a throttled, ≤1/min-per-socket path) is
  accepted rather than engineered away: a duplicate row here is an extra encrypted history point, not a correctness
  or security defect, and engineering it out would have meant a second encryption path for a live-only edge case.
- **`ANOMALY_FILTER_FLAG` is one switch for both the filter AND persistence**, not two independent flags. S11 asks
  for "restoring prior behaviour" — prior behaviour had neither, so a caller reaching for the escape hatch during an
  incident should get the WHOLE pre-W4-003 lane back, not a half-disabled state nobody tested.

Secret scan of the branch diff: clean. Zero-knowledge: the one new log line (`live persistence failed:`) carries
only `e.message` (a Mongoose/driver error), never a vital — pinned. No attribution.

## W4-004 evidence — the pure core: VitalSample, baselines & chronobiology (session 18)

First half of an L task, split the way W4-003 was: this session landed the STORAGE + the two PURE ENGINES,
and the next session lands the wiring (`baselines.js` superset blob + stale-while-revalidate, `metricStore`
VitalSample writes, `adapter.js` dormant lanes, `tzOffsetMinutes` plumbing, `MedicalProfile.hrZones` via
`doc.save()`, cache-compat tests). Commits `9f042b8` (VitalSample + S5), `6ad277d` (engines), `f394e3e`
(erasure attack test).

Suite **179 suites / 2357 tests (2356 passed + 1 todo), exit 0** — established by repetition per §0.4 S1a,
not by one lucky run: two consecutive full runs, both 179/2357, exit 0, at 190.9 s and 198.4 s.
Lint **0 errors, 22 warnings** — the
identical count sessions 15–17 recorded, i.e. ~2000 new lines added none. Secret scan of the diff: clean.
No attribution. Zero-knowledge: neither engine logs at all (pinned by a `console.` grep guard in
`chronobiology.test.js`), and the emitted blob is pinned to carry no sample, no timestamp, and < 6 KB.

**Test-count arithmetic, and a correction to session 17's.** New pins: `vitalSample.integration.test.js` 29
+ `baselineEngine.test.js` 63 + `chronobiology.test.js` 44 = 136, plus 7 appended to existing suites
(`shadow.qa4.crypto` 9→11, `wearableErasure` 14→16, `wearableErasure.integration` 2→5 — counted by
`it(`-block diff against `54f868d`, not estimated) = **+143**. That lands on 2357 only if the prior total was
2214, not the 2213 recorded in `testBaseline`. It was: session 17's own evidence text says "+1 suite
`wave4.liveWiring.test.js` with 14 pins, +1 pin appended to `biometricHandler.pipeline.test.js`" and then
computes "2199 + 14 = 2213", dropping the +1 it had just described — and its session-log line says "15 new
pins" outright. So **the real W4-003 baseline was 2214**; 2214 + 143 = 2357 exactly. An arithmetic slip in a
recorded number, not a behaviour change, corrected here rather than left looking like an unexplained test.

**RED first, every time.** The VitalSample model was written FIRST specifically so the pre-existing
`shadow.qa4.crypto` completeness guard would fail on it — it did, naming the model in two assertions, before
a single line of erasure code was written. Both engines were `Cannot find module` before they existed.

### What landed

1. **`app/models/VitalSample.js`** — encrypted, metric-typed time series (hrv, restingHeartRate,
   respirationRate, spO2, bodyBattery, stressLevel), AAD-bound `encryptedNumber` value, TTL 90 d, compound
   index `{userId, metric, recordedAt}`, optional `tzOffsetMinutes` (D13), `v` version field (S15). Range
   validation is METRIC-AWARE (one field-level min/max cannot say "25–150 bpm but 0–100 %"), so it runs in a
   `pre('validate')` hook reading through the decrypting getter. Garmin's −1/−2 "unmeasurable" stress
   sentinels are rejected as data rather than stored (D16). The metric vocabulary is pinned equal to the
   telemetry DTO's `METRICS` minus `heartRate`, so the two cannot drift apart silently.
2. **S5 registration, in the same commit that created the collection** — `services/privacy/erasure.js`,
   `scripts/gdpr-delete.js` (both the dry-run count and the delete path), `services/privacy/userDataExport.js`
   (Art.15), `services/privacy/wearableErasure.js` (source-scoped, per-provider), and the retention note in
   the model. **The completeness guard was EXTENDED**, per S5: it previously covered only `erasure.js` and
   `gdpr-delete.js`; it now also asserts every `userId`-carrying model is serialized by the GDPR export, and
   that every WEARABLE-derived model (auto-discovered as "has userId AND carries `'garmin'`") is deleted
   source-scoped by per-provider erasure — with the `{userId, source: provider}` filter pinned by regex, so a
   blanket `deleteMany({userId})` in that file fails the guard. `purgeWearableData` also now counts VitalSample
   rows when deciding whether the aggregated MedicalProfile is orphaned; counting only BiometricLog would have
   deleted a profile still backed by another wearable's vitals.
3. **`agents/runtime/physiology/baselineEngine.js`** (A1) — pure, clock-free. Kills D1/D2/D14/D15.
4. **`agents/runtime/physiology/chronobiology.js`** (A2) — pure, clock-free. Kills D13.

### The three design decisions worth reviewing

**(a) `n` counts DAYS, not samples.** A night of 1-minute samples is 360 numbers and nowhere near 360
independent observations (the anomaly filter measured the wander's autocorrelation time at ~165 s). Every
estimator collapses each LOCAL day to one value first, then does statistics across days. Without this, any
confidence expression overstates precision in the one direction that matters — overconfidence.

**(b) DELIBERATE, DERIVED DEVIATION FROM §M.4's LITERAL k VALUES — flagged for review.** §M.4 lists
pseudo-counts k = 20 (RHR) / 15 (HRV) / 10 (hour bins). Those are right for `n` = SAMPLES. With `n` = DAYS
(decision a) they are far more aggressive than intended: an athlete with a REAL 85 ms HRV and a full month of
data would still be dragged to 71.7 ms — a third of the way back to the population constant D1 exists to
escape. Rather than pick a different round number, `fuse()` (the multi-source generalisation that `shrink()`
is the one-source special case of — pinned as reducing to §M.4 exactly) takes its weight from the variance
decomposition that empirical-Bayes shrinkage IS: the optimal weight on n observations is
`n / (n + σ_within² / σ_between²)`, and since a source already enters as `n/σ_w²` and the prior as `k/σ_b²`,
those two agree exactly at **k = 1** — the population mean carries the information of ONE observation drawn
from the between-person distribution, which is precisely what it is. §M.4's k values are still used VERBATIM
by `shrink()`, for the spread estimates and the hourly table, where the count unit and the prior are the ones
§M.4 assumes. Every POPULATION entry therefore carries two spreads (`scale` = between-person SD, `spread` =
within-person daily MAD) and the code refuses to conflate them.

**(c) The resting rate is the TROUGH, wherever it falls.** §A1 specifies a nocturnal 00:00–06:00 window. That
window is a proxy for "asleep" and only works for a day-active person — the shiftWorker persona peaks at
23:00, so its nocturnal window is its most ACTIVE period. Each day therefore contributes
`min(P10 over the nocturnal window, P10 over the day's non-exercise samples)`. Measured, not asserted (30
simulated days per persona, every row forced to `activity: 'unknown'` — i.e. exactly what the batch lane
actually writes today):

| persona | truth RHR | min-based err | nocturnal-window-only err |
|---|---|---|---|
| athlete | 48.0 | **1.28** | 1.28 |
| sedentary | 72.0 | **1.82** | 1.82 |
| olderAdult | 65.0 | **1.90** | 1.90 |
| stressedProfessional | 70.0 | **2.11** | 2.11 |
| shiftWorker | 68.0 | **1.01** | 1.89 |

It costs a day-active user *nothing* (identical to 9 decimal places — their whole-day trough IS their
nocturnal trough) and is strictly better for the one persona whose clock is shifted. That table is now the
test: an A/B run through the SAME function (feeding only 00:00–06:00 samples makes each day's whole-day pool
identical to its nocturnal pool, so `min()` collapses to the window estimator exactly).

Also worth recording, because the mission's §A1 wording says "∪ live `activity==='resting'` rows": all three
specified input streams DO feed the estimate, but they are organised as TWO estimators, not three. The
resting-labelled rows are a strict subset of the non-exercise pool the trough estimator already consumes, and
entering them twice would manufacture confidence rather than add information.

### Four defects the tests found in this session's OWN code

1. **`pre('validate', function (next) { … next(); })` throws on every write.** Mongoose 9 invokes document
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
   reweighting pass over the residuals (drop > 3 robust sigmas, refit once — capped at one pass so cost and
   determinism stay bounded).
4. **The first shiftWorker test was not falsifiable.** With the daily trough stubbed out, it still passed:
   persona noise makes the window's P10 forgiving enough to land inside the ±3 bpm tolerance. It was rewritten
   as the A/B above only after the stub-out battery proved the original claim was untestable as written.

### Stub-out battery (mechanisms proven load-bearing, not decorative)

| mechanism | stubbed to | result |
|---|---|---|
| VitalSample in `userDataExport.COLLECTIONS` | removed | Art.15 guard RED |
| VitalSample in `wearableErasure.purgeWearableData` | `{deletedCount: 0}` | T3.2 guard RED |
| `min(nocturnal, dayTrough)` | nocturnal window only | shiftWorker A/B RED |
| cosinor robust reweighting | `kept = points` | contaminated-bin pin RED |
| `finite()` null guard | pre-fix code | 2 primitive pins RED |
| §M.4 k = 15 for the HRV central estimate | pre-fix code | HRV personal-baseline pin RED, off by 14.3 ms |

### Deliberate re-pins

One assertion changed meaning: `tests/userDataExport.test.js` "reuses the full account-erasure collection
list (completeness)" gains `'vitalsamples'`. The export list is ten collections now, not nine — by design,
and the guard extension above is what makes that impossible to forget next time.

Two mocked suites gained the new model without any assertion changing meaning (`accountDeletion.test.js`,
`shadow.auth.test.js`'s ATTACK-6 model lists). The `shadow.auth` one was a genuine RED surfaced by the full
suite rather than a precaution: that attack test drives the REAL `eraseUserChildData` with string userIds, so
the unmocked VitalSample threw a `CastError` and the "leaves ZERO trace" attack aborted before asserting
anything. It now pushes and asserts VitalSample rows like every other child collection, so the attack
genuinely covers the new collection instead of stepping around it.

### What is NOT done (owed by the wiring half)

`baselines.computeBaselines` still returns the old `{rhrMedian, rhrMAD}` shape — **D1 is not yet fixed in the
serving path**, only in the engine that will feed it. Nothing writes VitalSample rows yet. `adapter.js`
dormant lanes (D16 stressLevel, steps) untouched. `tzOffsetMinutes` is accepted by the model and by both
engines, but nothing on the ingest path emits it yet. `MedicalProfile.hrZones`/`maxHeartRate` still dormant.
Prod index builds for VitalSample are a Pause & Guide action — HITL H4.


## W4-004 evidence — the wiring half: D1 reaches the serving path (session 20)

Second half of the L task, split the way W4-003 was. Commits `143632d` (W4-D13), `ea447a2` (ingest),
`b6118a3` (baselines). Suite **182 suites / 2416 tests (2415 passed + 1 todo), exit 0** — two consecutive
full runs at that exact count, per §0.4 S1a. Lint 0 errors / 22 warnings. Secret scan clean. No attribution.

**The headline, stated precisely.** After session 18 the engine existed and nothing called it:
`computeBaselines` still returned `{rhrMedian, rhrMAD}` and `translate()` still z-scored every user's HRV
against the population constant `{45, 8}`. It now returns the SUPERSET blob, so **D1 is fixed on the serving
path with zero `translate()` edits**, exactly as the mission designed. Pinned by the kill shot
`D1: a user with real HRV history is scored against THEIR median, not the {45, 8} constant`.

### What landed

1. **`baselines.computeBaselines` delegates to `baselineEngine.computeBaselineBlob`** — pages BiometricLog
   (now carrying `recordedAt`/`activity`/`tzOffsetMinutes`, not just the value) AND VitalSample through the
   decrypting getters, reads `MedicalProfile.maxHeartRate`, resolves the user's habitual timezone as the
   MODAL non-null offset, and returns the superset. ONE ADR-0005 audit line still covers the whole bulk
   decryption, count-only.
2. **Stale-while-revalidate (`peekBaselines`)** — `FRESH_TTL_S` (6 h) and `CACHE_TTL_S` (24 h) are now two
   different ideas. Previously the key simply EXPIRED at 6 h, so the first generation in every 6-hour window
   ran with no personal baseline at all; a stale blob is now served and refreshed behind the request.
3. **`metricStore` writes VitalSample rows** — the fuel D1 needs. Allowlist `VITAL_METRICS_PERSISTED`
   (`hrv`, `restingHeartRate`), `metric@source@recordedAt` dedupe (S6), truthful `insertManyAccounted`
   reporting (W4-D08), and best-effort isolation so a vitals failure never costs the heart-rate ingest.
4. **`tzOffsetMinutes` end to end** — both batch lanes (health-store passthrough, Garmin's
   `startTimeOffsetInSeconds`) and all three LIVE normalizers, plus a new optional
   `BiometricLog.tzOffsetMinutes`. Absent stays **null, never 0** — 0 is a real timezone, and coercing would
   silently place every legacy client in UTC. Out-of-band offsets are dropped, not clamped (S6).
5. **D16 + steps, dormant** — `stressDetails` no longer discards `timeOffsetStressLevelValues`, and `dailies`
   can emit `steps`, both behind `WAVE4_CONSENT_V2_METRICS` which is **empty by default**. Garmin's -1/-2
   "unmeasurable" sentinels are rejected as data. §0.2.3 holds: collection is NOT widened.
6. **Karvonen zones + HRmax written back** via `doc.save()` (never `findOneAndUpdate($set)` — R9's encryption
   trap), from the stateVector worker, on the same blob it just cached. A user-provided max is never
   overwritten by an estimate.
7. **S11 kill-switch `WAVE4_BASELINE_ENGINE_DISABLED`** restores the pre-delegation blob — legacy keys only,
   MIN_SAMPLES cliff back, VitalSample never touched.

### The judgement call worth reviewing: zero evidence still returns null

The engine always returns a NUMBER — with no data that number is the population prior, tagged `confidence: 0`.
Handing that straight to `translate()` through the legacy `rhrMedian` key would have been a real regression,
and the full suite caught it: **ATTACK 2** (`shadow.fullSystem`) asserts an all-workout history "yields null
baselines, never a fabricated resting HR". Checked at the consumer rather than argued about:
`translate()`'s `restingElevation` passes `fallback = null`, so a null baseline makes the resting-elevation
stress term ABSTAIN, while `62` would have scored the user against a stranger's physiology.

So the legacy keys keep their exact MEANING, not merely their names: **no non-exercise observation at all →
`rhrMedian`/`rhrMAD` stay null**, and the superset keys still carry the prior plus `coverage.rhrDays: 0` for
engines that want one. This is NOT the cliff D15 killed — that cliff discarded nine perfectly good readings
for not being ten. One resting day now yields a shrunk, low-confidence estimate; only genuine zero yields null.

### Stub-out battery (mechanisms proven load-bearing, not decorative)

| mechanism | stubbed to | result |
|---|---|---|
| the whole engine delegation | forced `_computeBaselinesLegacy` | **7 pins RED** incl. the D1 kill shot |
| `VitalSample` row in the retention table | removed | 3 pins RED (W4-D13 guard) |
| `VITAL_METRICS_PERSISTED` | `+ 'spO2'` | 4 pins RED across 2 suites |
| D2/D3 persona (first draft) | — | pin passed against the OLD estimator → persona rewritten so the nocturnal trough is the MINORITY of the day; the old estimator now returns 73 where < 60 is required |

### Two defects this session's tests found in this session's own code

1. **`metricStore.test.js` was silently exercising the FAILURE path.** The new VitalSample write ran against
   an unmocked model, the best-effort catch swallowed the CastError, and the suite stayed green — the exact
   false-green class this run keeps finding. The model is now mocked there and the vital write is asserted.
2. **A "best-effort" call that was not.** `stateVector.worker` called `persistDerivedProfile` with a comment
   promising a failure could never cost the refresh; a rejection propagated and failed the job. Caught by the
   pin written for that claim, then made true with a `.catch(() => {})` at the call site as well as inside —
   "the callee catches" is a property that quietly stops being true.

Also fixed on review: two NEW failure logs interpolated `e.message`, which on a validation error quotes the
rejected VALUE — on the vitals path that value IS the vital. Both now log the error TYPE and a count (§0.2.2),
pinned by a zero-knowledge test.

### Six deliberate re-pins (no test lost: 2357 + 58 + 1 = 2416)

| file | what changed | why it is not a weakening |
|---|---|---|
| `healthStoreAdapter.test.js` | `+ tzOffsetMinutes: null` in one exact record | still `toEqual`, so an unexpected field still fails |
| `garminAdapter.test.js` | 8 expectations via new `rec()`/`recs()` helpers | helper declares the additive default ONCE; strictness kept (deliberately NOT `toMatchObject`) |
| `integrations.test.js` | 3 live-normalize shapes | same, exact match retained |
| `baselines.test.js` | 3 legacy-arithmetic pins moved behind the kill-switch, arithmetic UNCHANGED | the legacy estimator still exists and is what the flag restores — a kill-switch nobody executes is one that does not work |
| `baselines.test.js` | cache TTL literal `6*3600` → the RELATIONSHIP `CACHE_TTL_S > FRESH_TTL_S`; corrupt-cache pin asserts the fall-through rather than the legacy median | pins the guarantee instead of a number that SWR deliberately changed |
| `shadow.fullSystem.test.js` | ATTACK-3 fixture timestamped; exact 70 → a range on userB's side of the prior | without timestamps the recompute could only return the prior — the attack would have passed for the wrong reason |

`metricStore.test.js` and `shadow.fullSystem.test.js` also gained VitalSample mocks with no assertion changing
meaning (the W4-004 pure-core precedent).

### What is NOT done (carried forward, honestly)

`chronobiology` is wired only as far as `computeBaselineBlob`'s cosinor fit — the personal alertness curve does
NOT yet replace translate's binary `windDown` (that is W4-006's serving-path seam, and doing it here would
break the "no unrelated serving-path change" discipline). Sleep-debt accumulation still has no persistent
nightly store (W4-012's `MorningState`). Mobile emission of `tzOffsetMinutes` is an on-device checklist item —
the backend accepts and stores it, but every shipped client sends null today, so the hour-of-day table falls
back to server hour for real users until that ships. HITL **H4** (prod index builds for `vitalsamples`) is now
ACTIONABLE rather than theoretical: this commit is the one that starts writing rows.


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
| W4-D06 | repair | Suite leaks 60 s debounce timers; `--forceExit` masks it and the W4-000 baseline claim no longer holds | MUST | S | — | **done** | session 8 | **Found by running the baseline claim rather than trusting it.** `npx jest --runInBand` (no `--forceExit`) prints *"Jest did not exit one second after the test run has completed"*, and `--detectOpenHandles` names exactly **2** leaked `setTimeout`s, both from `biometricHandler.js:1203`, armed at `wave4.bugfix.test.js:122` and `biometricHandler.pipeline.test.js:1841`. `npm test` is `jest --runInBand --forceExit` (pre-existing on main, untouched by this wave), which hides them — the suite is green and exits 0 either way, which is why nothing noticed. Consequence: **STATE's W4-000 baseline sentence "exit 0 without `--forceExit`, `--detectOpenHandles` silent" is no longer true** and must be re-recorded honestly. Real risk, not just hygiene: the leaked callback closes over a torn-down socket and fires `recalibrateForBand` against the module-global `debounceMap` up to 60 s later — i.e. *inside a later suite* of the 75 s `--runInBand` run — which is a cross-suite flake vector, and §0.4 S1a explicitly forbids a non-deterministic baseline. DoD: clear the timers in teardown (or drive them with fake timers) until `npx jest --runInBand --detectOpenHandles` is silent; add a standing guard so the rest of the wave — which adds workers, Redis blobs and BullMQ repeatables (W4-003/004/011/012) — cannot re-introduce a leak invisibly behind `--forceExit`; correct the baseline sentence. Justification: a flaky baseline during a 4-day autonomous run burns error budget on phantom failures and can trip `WAVE4_HALT`; this is the same bug class S1a required W4-000 to close, re-opened. Fixed session 10 — see the W4-D06 evidence section below. **Premise held and then some:** the two named timers were real, and the guard built to catch them found a THIRD handle `--detectOpenHandles` had filtered out. |
| W4-D07 | improve | The socket lane's adapter mock has different semantics from the real adapter | SHOULD | S | — | pending | session 9 | **Noticed in passing while building W4-D05's watch-lane pins — one line per §2, for the next reflection to triage.** `biometricHandler.pipeline.test.js:125` mocks `wearable/adapter.normalize` to return `{heartRate, activity, source}`, with NO `recordedAt`. The real `fromGarmin` returns `recordedAt: new Date(raw.startTimeLocal)`, and `isValidReading` REJECTS the reading when that date is unparseable — so a payload the suite happily accepts is refused by production. Verified directly: the real `normalize('garmin', {heartRate: 88})` → Invalid Date → `connection_error: Invalid biometric reading` (the rejection itself is correct and intended; the divergence is the point). Consequence: the normalize→isValidReading seam on the socket lane is never exercised, which is the "green mock for an integration boundary" §1 forbids. DoD: give the mock the real shape (or drop the mock and feed real payloads) and pin one case proving an unparseable provider timestamp is rejected end-to-end. Justification: low cost, and W4-003 is about to wire the anomaly filter into this exact seam and persist `recordedAt` to `BiometricLog`, where the divergence stops being cosmetic. |
| W4-D08 | repair | Batch ingest reports `inserted` rows that were silently dropped | SHOULD | S | — | **done** | session 11,13,15 | **REOPENED by reflection #2 (session 14): the fix crashes the lane it claims to have fixed.** `suunto.js:50` calls `insertManyAccounted(BiometricLog, docs)` and the file never requires it — `bfc5a85` added the call site and not the import (`git log -L 50,50` names that commit; the pre-`bfc5a85` version at `bfc5a85^` did `BiometricLog.insertMany(docs, {ordered:false})` and worked). Proven by EXECUTING the real production function, not by reading it: `handleWebhook('u1', '[{"hr":72,...}]', '')` → **`ReferenceError: insertManyAccounted is not defined`**. Identifier resolution is unconditional, so a payload with **zero** HR samples throws too — every Suunto webhook now 500s where it previously succeeded. So W4-D08 turned a cosmetic over-count into a hard outage on that lane, and it is sitting in open PR #179. Why the green suite missed it: the only two files mentioning suunto (`integrations.test.js:72`, `integrationsController.test.js:39`) `jest.mock` the whole module, and `wave4.ingestAccounting.test.js` covers `insertManyAccounted`/`mergeRejected`/`persistMetrics` only — **zero** mentions of suunto or appleHealth. Both lanes W4-D08 edited beyond metricStore are unexecuted by any test. Blast radius bounded by measurement, not assumption: a scope analysis over all **147** files in `backend/app` + `backend/sim` (babel `ReferencedIdentifier` with no binding) reports **exactly one** undefined identifier repo-wide — this one. **Re-DoD:** (1) add the missing require; (2) pin `suunto.handleWebhook` AND `appleHealth.ingestBatch` with tests that execute the REAL function (not the module mock) — including the reject-accounting path, so the lanes stop being edited blind; (3) ship the standing regression guard per this run's precedent (W4-D01 marker, W4-D02 state-guard, W4-D06 open-handle guard) — see W4-D11, which is the guard for this class and should land in the same session. Original entry follows. **Noticed in passing while building W4-002 — one line per §2, for the next reflection to triage.** `metricStore.persistMetrics` returns `inserted: hrDocs.length` (the ATTEMPTED count) while `BiometricLog.insertMany({ ordered: false })` silently drops rows the schema rejects (heartRate capped at 300 — a x2 PPG artifact on a workout reading clears it easily) and does NOT reject the promise. Measured, not inferred: 10 samples submitted with one at 340 → `persistMetrics` resolves `{inserted: 10}`, 9 rows in the collection, nothing logged. So `healthStore.ingestBatch` reports full success on a lossy write, and a backfill client reconciling on `inserted` believes data landed that did not. Pinned as CURRENT behaviour in `sim.replay.integration.test.js` ("MEASURED: one out-of-range sample is dropped silently") so the fix flips it loudly. DoD: count what Mongo actually inserted, and surface the rejects (count + reason) rather than dropping them. Fixed session 13 — see the W4-D08 evidence section below. **Premise held exactly as measured, and the scope was two lanes wider than the row knew:** `appleHealth.ingestBatch` and `suunto.handleWebhook` returned `ingested: docs.length` with the same hand-copied `insertMany(docs, { ordered:false })`, i.e. three copies of one defect, so the accounting became a single shared helper rather than a third hand-copy (the D11 one-definition rule). |
| W4-D09 | repair | Absolute wall-clock latency budgets make the suite baseline non-deterministic | MUST | S | — | **done** | session 11,12 | Fixed session 12 — see the W4-D09 evidence section below. **Premise held; two of its inferences did not, and the scope was one assertion wider than the row knew.** **Noticed in passing while gating W4-002 — one line per §2.** `shadow.flip.test.js:192` and `shadow.selection.test.js:196` assert `Date.now() - started < 300` inside the shared `--runInBand` process. Under ordinary memory pressure they land at 307–319 ms and fail; both pass in isolation. **Established by control, not by assumption:** with W4-002 suites removed the failure still occurs on two consecutive runs, in two different files. §0.4 S1a forbids a non-deterministic baseline outright, and this is the same bug CLASS as W4-D06 (suite hygiene that makes the baseline untrustworthy) on a new axis — it will burn error budget on phantom failures and can trip `WAVE4_HALT` via the 3-failed-session rule. DoD: make the budget robust (measure CPU work not wall clock, or assert a generous ceiling plus a recorded p50, or gate the strict budget behind an opt-in env like the soak) so a loaded machine cannot turn a correct build red; re-establish a genuinely green baseline afterwards. |
| W4-D10 | improve | The `healthBatch` SUCCESS log serialises numeric vitals | SHOULD | S | — | pending | session 13 | **Noticed in passing while adding `rejected=` to that very line — one line per §2, for the next reflection to triage.** `integrationsController` logs `[healthBatch] ok accepted=.. inserted=.. profileMetrics=${JSON.stringify(result.profileMetrics)}` on EVERY successful batch, and `profileMetrics` is the aggregated scalars — `restingHeartRate`, `hrv`, sleep-stage minutes. So a production success path writes special-category numbers to stdout unconditionally. This is a strictly wider hole than W4-D03, which is the same class but DEBUG-gated (`if (DEBUG)`), and §0.2.2 admits no numeric vital in any log. Pre-existing and untouched by this task: the field added here (`rejected=<count>`) is a count, pinned value-free. DoD: log the KEYS present and their count (or coarse bands), never the values, and pin it the way `wave4.ingestAccounting.test.js` pins the `[insertAccounted]` line. |
| W4-D12 | improve | §M.4's k constants assume `n` = samples; the baseline engine counts days | SHOULD | S | 004 | **done** | session 18 | **CLOSED BY RULING — reflection #3 (session 19), the reviewer this row's own DoD nominated. The deviation is CORRECT and stays.** Checked algebraically, not read: `fuse()` gives source *s* precision `w_s = n_s·reliability/σ_s²` and the prior `w₀ = k/σ_b²`, so the posterior mean is `(n·x̄ + k·(σ_w²/σ_b²)·μ₀)/(n + k·σ_w²/σ_b²)` — which equals the exact normal-normal shrinkage weight `n/(n + σ_w²/σ_b²)` **iff k = 1**. `PRIOR_OBSERVATIONS = 1` is therefore the derivation, not a taste. The unit hazard the row worried about was checked too and is clean: `_sourceScale()` multiplies BOTH the observed MAD and `POPULATION[m].spread` by `MAD_SCALE`, so σ_w reaches `fuse()` as an SD matching `scale`'s SD — no 1.4826² error in the variance ratio. Numerically, the athlete case the row cited: σ_w=8·1.4826=11.86, σ_b=25 ⇒ σ_w²/σ_b²=0.225 ⇒ after 30 days the estimate is 84.7 ms (vs 85 truth), where literal k=15 gives 71.7 ms. **One honest caveat recorded rather than smoothed over:** the code comment says §M.4's k values are used verbatim "where the count unit is the one §M.4 assumes", but `estimateRestingHeartRate`'s SPREAD `shrink()` also passes `n` in DAYS (k=20). The consequence is conservative in the safe direction — it holds the reported MAD slightly WIDE, which under-detects stress rather than saturating it (D3's failure mode is the opposite and far worse), and `MIN_SPREAD` floors the other end — so it is a comment nit, not a defect, and is deliberately NOT queued. §M.4 in the mission now carries the one-line unit note this DoD required. Original entry follows. **Noticed while implementing W4-004 — one line per §2, for the next reflection to triage.** `baselineEngine` collapses each local day to one observation (samples inside a day are ~perfectly correlated), so `n` means DAYS. §M.4's k = 20/15/10 were written for a sample count, and at day scale they shrink a real 85 ms athlete HRV to 71.7 after a full month. The central estimates therefore use a variance-derived prior weight (k = 1 in `fuse()`, from `n/(n + σ_w²/σ_b²)`), while §M.4's k values remain verbatim in `shrink()` where the unit matches. DoD: a reviewer confirms the derivation and the two POPULATION spreads (`scale` between-person, `spread` within-person) against the numbers, or rules the deviation back out; either way the mission's §M.4 gets a one-line note so W4-005/012 do not re-litigate it. Justification: every later engine (affect axes, CUSUM, fatigue) reads these baselines, so a wrong shrinkage constant is wrong everywhere downstream. |
| W4-D11 | improve | No linter exists, so `lint clean` in the DoD has never been a control | SHOULD | S | — | **done** | session 14,15 | **Found by reflection #2 while root-causing W4-D08's reopen.** §2 step 7 requires "lint clean" for every task, and there is **no linter in this repo at all**: no eslint config at root or in `backend/`, no `eslint` in `backend/node_modules/.bin`, no `lint` script in `backend/package.json` (scripts are `start`/`worker`/`dev`/`test`/`test:handles`), and no root `package.json`. W4-002's evidence already recorded the line as "vacuous — recorded, not claimed"; this reflection upgrades that from a footnote to a task, because the interval produced the exact defect the missing rule catches. A single `no-undef` run over `backend/app` found `suunto.js:50` in **one second** — a live production crash that a green 172-suite run, a resilience-minded author and an open PR all missed. The remaining queue (W4-003…W4-015) adds thousands of lines of new engine code across new directories, so the marginal value is highest now and falls every session. DoD: add `eslint` as a devDep with a minimal flat config for CommonJS/node; enable at least `no-undef` and `no-unused-vars` (unused vars as `warn` to avoid a mass-rewrite of pre-existing code); add `npm run lint`; get `backend/app` + `backend/sim` clean; record the pre-existing-violation count honestly in STATE rather than mass-fixing unrelated files in this task. Justification: turns a DoD line every session has been reporting as satisfied into a real gate, at S cost. Pairs with the W4-D08 repair — same session, same theme (the guard belongs with the bug that proved it was needed). |
| W4-D13 | repair | S5's fifth surface was never written: `VitalSample` is absent from the retention-windows documentation | MUST | S | — | **done** | session 19,20 | **Found by reflection #3 by checking S5's list surface-by-surface instead of accepting the model's own header.** §0.4 S5 names FIVE registration surfaces and requires them "in the SAME PR that introduces it". W4-004 landed four of them correctly and verifiably — `erasure.js:39`, `gdpr-delete.js:120`, `userDataExport.js:29`, `wearableErasure.js:31` (`userRedisPurge` is legitimately N/A: this is a Mongo collection, not a Redis key family) — and the guard behind them is genuinely load-bearing (stub-out this pass: deleting `{ model: VitalSample }` from the export list turned **4 pins RED across 2 suites**, then restored). The FIFTH, "the retention-windows documentation", was counted as satisfied by an in-code comment at `models/VitalSample.js:125-132`; the repo's actual retention-windows document is `docs/PRIVACY_DECLARATIONS.md`, and `VitalSample` appears nowhere in it. Two concrete staleness points, both measured: (1) the `## Retention` table (line ~85) lists `BiometricLog` 90 d / `ServeEvent` 90 d / `ConsentRecord` but has no row for the new 90-day TTL (`VITAL_SAMPLE_RETENTION_DAYS`, `expireAfterSeconds` on `recordedAt`); (2) the **Play data-safety** deletion answer (line ~122) enumerates the cascade as nine collections — BiometricLog, MedicalProfile, MusicProfile, PlaylistSession, ServeEvent, Identity, RefreshToken, UnclassifiedTrack, ConsentRecord — while `eraseUserChildData` now deletes **ten**, and its `<!-- verified: ... erasure.js:33-49 -->` provenance comment points at shifted lines. **DoD:** (a) add the `VitalSample` row to the Retention table with its env var and mechanism; (b) add it to the line-122 cascade list and refresh that verification comment; (c) state explicitly that the metric vocabulary is a consent-v2-ready SUPERSET and that `spO2`/`respirationRate` have **no writer** today, so the standing "SpO₂ and respiratory rate are NOT collected" declaration at line ~44 stays true and a future reader grepping the schema is not misled; (d) ship the standing guard this run keeps proving is the right move (W4-D01 marker, W4-D02 state-guard, W4-D06 open-handle, W4-D11 lint): a test asserting every TTL-indexed user-scoped model is named in the retention table, so the DOC surface stops being the one nobody can fail. **Scoping note so the next session is not torn between two rules:** the cleanest discharge is INSIDE W4-004's wiring commit on the still-open PR #179 — that is literally what S5's "same PR" asks, and it avoids interrupting an `in_progress` L task for a docs edit. Taking it standalone first is also fine; it is S-sized. **Fixed session 20** (commit `143632d`, inside W4-004's wiring PR exactly as this row's scoping note asked). All four DoD items discharged: (a) the `VitalSample` row is in the Retention table with `recordedAt` and `VITAL_SAMPLE_RETENTION_DAYS`; (b) the Play cascade list now names ten collections and the provenance comment points at `erasure.js:34-53`; (c) a blockquote states the metric enum is a consent-v2-ready SUPERSET with no writer for `spO2`/`respirationRate`, so the line-44 declaration stays true; (d) the standing guard is `tests/wave4.retentionDocs.test.js` (7 pins). **Load-bearing, verified by stub-out, not asserted:** deleting the VitalSample retention row turns **3 pins RED**, and adding `spO2` to `VITAL_METRICS_PERSISTED` turns **4 pins RED** across 2 suites — both restored. The guard discovers TTL-indexed user-scoped models from the filesystem (4 today) and parses the real `eraseUserChildData` body, so it cannot go vacuous by omission. **Severity, stated honestly:** no live data leak and no erasure gap — the CODE is complete and correct, the collection is still empty, and nothing writes `spO2`/`respirationRate`. What is wrong is a store-facing compliance declaration that no longer matches the code, which is exactly the bug class S5 exists to prevent and exactly the kind of surface `compliance-auditor` gates before submission. |


## Reflection log (one entry per §2.5 pass)

| # | at | interval covered | suite | verified / reopened / queued | headline |
|---|----|------------------|-------|------------------------------|----------|
| 1 | 2026-08-19 (session 8, `exec`) | run start → `d0b94d9` — all 24 branch commits; tasks W4-000, W4-001, W4-D01, W4-D02 | **166 suites / 1865 tests green, 75.8 s, exit 0** — exactly the recorded baseline | **4 verified / 0 reopened / 2 queued** (+ W4-D04 closed by ruling) | Product code is sound and the DoD claims hold; the two things that did NOT hold were both about *guarding* the work — an unguarded band-boundary flap (W4-D05) and a re-opened open-handle leak that `--forceExit` hides (W4-D06) |
| 2 | 2026-08-19 (session 14, `exec`) | `23c652b` → `962acb2` — 25 commits; tasks W4-D05, W4-D06, W4-002, W4-D09, W4-D08 | **172 suites / 2091 tests (2090 passed + 1 todo), exit 0, 122.2 s** — exactly the recorded baseline | **5 verified / 1 reopened / 1 queued** | The suite is green and one production lane is dead: W4-D08 added a call to `insertManyAccounted` in `suunto.js` without the import, and every test that touches suunto mocks the module — so a `ReferenceError` on every Suunto webhook shipped into open PR #179 unnoticed |
| 3 | 2026-08-19 (session 19, `exec`) | `962acb2` → `9ba207e` — 19 commits; tasks W4-D08 (reopen), W4-D11, W4-003 (wiring), W4-004 (pure core) | **179 suites / 2357 tests (2356 passed + 1 todo), exit 0, 191.7 s** — exactly the recorded baseline; lint 0 errors / 22 warnings | **4 verified / 0 reopened / 1 queued** (+ W4-D12 closed by ruling) | The code is in good shape — the interval's four claims all held under execution and stub-out, including the reopened Suunto lane, which now runs and reports truthfully. The one thing that did not hold is a *paper* surface: S5 names five registration places for a new collection and W4-004 wrote four, counting an in-code comment as "the retention-windows documentation" while the real one (`docs/PRIVACY_DECLARATIONS.md`) still describes a nine-collection erasure cascade the code outgrew (W4-D13) |

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

### Reflection #2 (session 14) — evidence

**R1 · Health check.** Full suite `cd backend && npm test`: **172 suites / 2091 tests, 2090 passed + 1 todo, exit 0, 122.2 s** —
matches the recorded `testBaseline` exactly, zero failing assertions. Tree clean apart from the standing intentional
`mobile/src/health/config.ts` (S2, session 1). `origin/main` still `1a1657e` = STATE's `lastMainSha` (no drift), and
`feat/intelligence-wave` is 0 ahead / 0 behind `origin` — S3's offsite backup is real, not assumed. **Lint: there is no linter**
(no config, no dep, no script) — the DoD line is vacuous, which is now queued as W4-D11 rather than left as a footnote.

**R2 · Verifying the interval's claims — one of the five did not hold.** Four verified against source and by execution:
W4-D05's `HR_BAND_RELEASE_MARGIN = 6`, `BAND_LOWER_CUT` one-definition export, `state.servedHR` latch and
`WAVE4_RECAL_STATE_TRIGGER_DISABLED` all present — and **stub-out checked**: setting the margin to 0 turned **8 of the 23**
`wave4.bandHysteresis.test.js` pins RED, then the file was restored (`= 6` re-verified), so those pins are load-bearing rather
than decorative. W4-D06's `_resetDebounceState`, `jest/globalSetup|globalTeardown|openHandleGuard|openHandleResultsProcessor`,
frozen-empty `IGNORED_TYPES`, `DRAIN_MS = 250` and the `jest` key in `package.json` all present. W4-002's five `sim/` modules,
two holdout personas and the `fast-check` devDep (`^4.9.0`) all present. W4-D09's `perfBudget.js` min-of-N helper present and
numerically clean (empty/non-finite samples throw explicitly; nearest-rank percentile with clamped indices — no NaN at n=1).
`adr0012.tripwire.test.js` green, 7 pins.

**W4-D08 is REOPENED — its own fix crashes the third lane.** The row claimed all three ingest lanes now "report what the
database took". `suunto.js:50` calls `insertManyAccounted` and the file has no `require` for it. Not inferred — the real
production function was executed: `ReferenceError: insertManyAccounted is not defined`, and because identifier resolution is
unconditional, a webhook carrying **zero** HR samples throws just the same. `git log -L 50,50` pins the introduction to
`bfc5a85` (W4-D08's own implementation commit); the version at `bfc5a85^` worked. **Why 2091 green tests said nothing:** the
only two suites mentioning suunto `jest.mock` the entire module, and `wave4.ingestAccounting.test.js` exercises
`insertManyAccounted`/`mergeRejected`/`persistMetrics` with zero mentions of suunto or appleHealth. Both lanes W4-D08 touched
outside metricStore are executed by no test at all — the appleHealth import happens to be correct, which is luck, not coverage.
This is R2's thesis in one artifact: a green suite is not evidence, and the run's main failure mode is a task that *reports*
success.

**R3 · Constraint audit: clean.** No attribution in any of the 25 commits or in the diff. Secret scan of `23c652b..HEAD`: the
only two hits are STATE prose quoting the mission's own grep pattern. Art.9 consent gate untouched — the sole
`integrationsController` change this interval is the added `rejected=<count>`, a count with no values. Zero-knowledge holds for
the new code: the `[insertAccounted]` warn carries model name, counts and (path, validator-kind) pairs, never a submitted
value; the pre-existing numeric-vital log lines remain tracked as W4-D03 (DEBUG-gated) and W4-D10 (the wider, ungated
`profileMetrics=` serialisation on the same `[healthBatch]` line, re-confirmed accurate this pass). Targets contract untouched
this interval — no `translate`/`targetsBuilder` edits; `moodDescriptors` only gained the `BAND_LOWER_CUT` export. S11
kill-switch present for the one serving-path change that warranted one (W4-D05).

**R4/R5 · The bug class was measured, not guessed.** Rather than stop at one finding, the question "is this a class?" was
answered with a scope analysis (`@babel/parser` + `@babel/traverse`, `ReferencedIdentifier` with no binding, Node globals
excluded) over **all 147** production files in `backend/app` + `backend/sim`: **exactly one** undefined identifier exists
repo-wide — `suunto.js:50`. So the defect is live but isolated, and no sibling hunt is owed. What the exercise did expose is the
missing control: the check that found it in one second is `no-undef`, and this repo has no linter, so §2 step 7's "lint clean"
has never gated anything. Queued as W4-D11 (one row, not five — this is one theme).

### Reflection #3 (session 19) — evidence

**R1 · Health check.** Full suite `cd backend && npm test`: **179 suites / 2357 tests, 2356 passed + 1 todo, exit 0,
191.7 s** — matches the recorded `testBaseline` exactly, zero failing assertions. (The 191.7 s vs session 18's ~150 s is
machine load, not regression: HITL H3's ten stale `worker.test.js` processes are still resident and this pass ran lint and
two isolated jest invocations alongside it.) `npm run lint`: **0 errors, 22 warnings** — the same count for the fifth
consecutive session. Tree clean apart from the standing intentional `mobile/src/health/config.ts` (S2, session 1).
`origin/main` still `1a1657e` = STATE's `lastMainSha` (no drift); `feat/intelligence-wave` is level with `origin` at
`9ba207e`, so S3's offsite backup is real rather than assumed. Secret scan of `962acb2..HEAD`: one hit, and it is the same
self-referential false positive reflection #2 recorded — STATE prose containing "`Task-`", which matches the `sk-` pattern.
No attribution anywhere in the 19 commits or the diff.

**R2 · Verifying the interval's claims — all four held, and three were checked by EXECUTION rather than by reading.**

1. **W4-D08's reopen is genuinely closed.** The defect was a `ReferenceError` from an unimported helper, so the only
   honest check is to run the real function. `suunto.handleWebhook('u1', '[{"hr":72,...}]', '')` executed directly against
   the production module: **resolves**, `{"ingested":0,"rejected":{"count":1,"reasons":[{"path":"userId","reason":"objectid"},{"path":"heartRate","reason":"string"}]}}`.
   That is not merely "no longer throws" — it is W4-D08's actual promise (report what the database took, surface the
   rejects) demonstrated on a real payload. `insertManyAccounted` is imported in all three lanes (`suunto.js:5`,
   `appleHealth.js:20`, `metricStore.js:13`). The `[insertAccounted]` line carries model, counts and (path, validator-kind)
   pairs — no submitted values, so zero-knowledge holds.
2. **W4-D11's linter is a real gate, proven by stub-out.** A throwaway `app/__reflect_probe.js` containing one undefined
   identifier was created and both controls were run against it: `npx eslint` → **1 error, `no-undef`**, and
   `wave4.lintGuard.test.js` → **3 pins RED**. Probe deleted, tree re-verified clean. So the control that would have caught
   W4-D08 in one second now genuinely fires — the DoD line "lint clean" has stopped being vacuous.
3. **W4-003's wiring does what it claims (D6).** Read at source: `effectiveHR = filtered.level` is what reaches *every*
   downstream decision — the immediate/watch lane, the first-reading seed, the `delta` computation, `bandCrossed`, and both
   `pendingHR` writes. The raw value survives in exactly two places, both correct by design: the `biometric_ack` echo and
   the `BiometricLog` row (the device record, deliberately unsmoothed). D7's EWMA was removed rather than orphaned —
   `hrEwma`/`_updateEwma`/`HR_EWMA_ALPHA` have **zero** occurrences left anywhere under `backend/`. Contract audited for a
   trap that would have been easy to miss: a hard-gated FIRST reading returns `accepted:false, level:null`, and
   `_maybePersistLiveReading` tests `!filtered.accepted` **before** consuming the throttle slot, so a rejected reading
   neither persists nor burns the ≤1/min budget.
4. **W4-004's S5 registration is load-bearing where it exists.** Stub-out: deleting `{ model: VitalSample }` from
   `userDataExport.COLLECTIONS` turned **4 pins RED across 2 suites** (`userDataExport.test.js`,
   `shadow.qa4.crypto.test.js`); file restored and re-verified. This is the claim that matters most for a
   special-category collection, and it is real. What is NOT complete is the documentation surface — see R3.

**R3 · Constraint audit — one violation, queued as W4-D13.** Clean: `adr0012.tripwire.test.js` PASS; targets contract
untouched this interval (no `translate`/`targetsBuilder` edits in the diff, so the 13-key superset is trivially intact);
Art.9 consent gates untouched; S9 holds — `grep` for `Date.now|Math.random|new Date()` across `anomalyFilter`,
`baselineEngine` and `chronobiology` returns **only a comment**, every engine takes `now` as a parameter; zero-knowledge
holds for the new code — the three new modules contain no `console`/`log` call at all (the sole `log` match is
`Math.log`), and the pre-existing numeric-vital lines remain tracked as W4-D03/W4-D10; S11 kill-switch present for the
interval's one serving-path change (`WAVE4_ANOMALY_FILTER_DISABLED`, with a forgiving `=1`/`=true` parse).
**The violation:** §0.4 S5's fifth surface, "the retention-windows documentation", was never written — full detail and
DoD in W4-D13 above. Recorded as `class: repair` because S5 is binding and names that surface explicitly; recorded with
its true severity because inflating it would be its own kind of dishonesty — the erasure CODE is complete and correct,
the collection is empty, and no writer for `spO2`/`respirationRate` exists, so nothing leaks today. What is stale is a
**store-facing** declaration (the Play data-safety deletion answer) that now under-reports the cascade by one collection.

**R4 · Quality sweep — the math was re-derived, not re-read.** The interval's headline risk was W4-004's deliberate
departure from §M.4, which session 18 flagged against itself as W4-D12. That row nominated "a reviewer" as its decider;
this pass was that reviewer and **confirmed the deviation is correct** — the algebra, the MAD→SD unit check that could
have hidden a 1.4826² error, and the athlete numbers are all in the W4-D12 row, which is now closed by ruling with the
mission's §M.4 amended by one clarifying line. Other engine checks, all passing: §M.3's cosinor matches the spec
(`A=√(β²+γ²)`, `φ=atan2(γ,β)/ω`, count-weighted LSQ) and encodes "≥6 bins ≥2 h apart" as `MIN_SPREAD_BINS = 6` against a
circular-spread measure, which is stricter than the literal wording; `_solve3` returns null on a singular design rather
than NaN; `r2` is guarded by `sst > 0`; the EWMA's `Math.log(2)/Math.max(halfLifeDays, 1e-9)` guards both the log domain
and the division; and **S8's specifically-named Karvonen hazard is guarded** — `hrr = Math.max(1, hrMax - rhr)`, so the
degenerate `HRmax ≈ RHR` body yields ordered finite zone bounds instead of poisoning every downstream exertion figure.
D2's decontamination was checked for the obvious hole and does not have it: unlabelled workout rows are not excluded by
`isExercise`, but the P10 trough plus `MIN_DAY_SAMPLES` is what handles them, and the persona test asserting RHR within
±3 bpm *despite* workout episodes passes.

**R5 · Opportunity sweep — nothing new, and that is the finding.** One forward-looking note was worth recording and is
attached to the W4-004 row rather than queued, because it belongs to that task's own remaining DoD: the wiring half is
what finally puts D1 on the serving path (`translate()` stops reading the `{45, 8}` population constant and starts
reading real personal HRV), which makes it a serving-path behaviour change and therefore owes an §0.4 S11 escape hatch —
and S11's named inventory in the mission has no baselines flag, so it is easy to miss. Beyond that: W4-D03 and W4-D10
(the two numeric-vital log lines) remain correctly parked behind MUST-tier work per R6's ordering, and no new defect
class surfaced. Per §2.5, an interval this clean gets said in one line rather than padded — **one row queued, not five.**

## PR queue

| PR | cluster(s) | url | status |
|----|-----------|-----|--------|
| #179 | W4-000, W4-001, W4-D01/D02/D05/D06, W4-002, W4-D09, W4-D08 (+reopen), W4-D11, W4-003, W4-004, W4-D13 | https://github.com/DanielMalede/Kokonada/pull/179 | open — RUNNING PR for the whole branch. **Session 20: W4-004 is now COMPLETE (both halves) and W4-D13 is discharged in the same PR, which is exactly what S5's "same PR" wording asks.** D1 reaches the serving path; suite 182/2416 green twice; six deliberate re-pins listed in the W4-004 wiring evidence section and appended to the PR body. Branch pushed. **Session 18: W4-004's pure core (VitalSample + S5 + both engines) appended to the PR body; the task stays in_progress until its wiring half lands.** Session 17: W4-003 is now COMPLETE (both halves) and its cluster summary is appended to the PR body — filter wiring + D10 persistence + S6 gate + S11 kill-switch, suite 176/2213 green twice, deliberate re-pins listed in the body and in this file's W4-003 wiring evidence section. Branch pushed (`80db9ed`). Merging remains Daniel's click alone. |

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
| 10 | 2026-08-19 (exec) | WAVE4_SESSION_RESULT: W4-D06 done — standing open-handle guard + one-step debounce reset, 53 new pins, suite 168/1944 green |
| 12 | 2026-08-19 (exec) | WAVE4_SESSION_RESULT: W4-D09 done — min-of-N perf-budget helper + relative burst budget, 45 new pins, suite 171/2073 green twice (first bankable green baseline since W4-002). Reflection SKIPPED per §2 step 4 (marker DUE 7.25h, but `class: repair` rows were pending — fix the tree first). S2: adopted the prior session's untracked RED test after verifying it red. |
| 11 | 2026-08-19 (exec) | WAVE4_SESSION_RESULT: W4-002 done — seeded simulator (rng, 5 personas + 2 holdouts, generator, replay harness, soak), 84 new pins, suite 170/2028 with 1 pre-existing wall-clock flake (W4-D09); found W4-D08 |
| 13 | 2026-08-19 (exec) | WAVE4_SESSION_RESULT: W4-D08 done — truthful bulk-insert accounting across all three wearable ingest lanes, 17 new pins + 1, suite 172/2091 green twice. Reflection SKIPPED per §2 step 4 (marker DUE 7.86h, but `class: repair` W4-D08 was pending — fix the tree first). Found W4-D10. |
| 14 | 2026-08-19 (exec) | WAVE4_SESSION_RESULT: REFLECT done 5 verified, 1 reopened, 1 queued — suite 172/2091 green (exact baseline); W4-D08 REOPENED: `suunto.js:50` calls an unimported `insertManyAccounted`, proven by executing the real function (`ReferenceError`), invisible because every suunto test mocks the module; scope analysis over all 147 production files shows it is the only one; W4-D11 queued (no linter exists, so `lint clean` has never gated anything) |
| 15 | 2026-08-19 (exec) | WAVE4_SESSION_RESULT: W4-D08 done — suunto lane requires the helper it calls; both untested ingest lanes pinned against the real modules (16 pins); W4-D11 landed with it: eslint `no-undef` gate + in-suite guard (10 pins), stub-out verified; suite 174/2117 green twice |
| 16 | 2026-08-19 (exec) | WAVE4_SESSION_RESULT: W4-003 in_progress — pure core landed (telemetry DTO + anomaly filter, 82 pins, suite 175/2199 green); constants derived from one wander envelope; stub-out battery found 4 of 12 mechanisms initially unfalsifiable and pinned all of them; wiring + D10 persistence owed next session |
| — | 2026-08-19 (Cowork) | H2 closed after direct git verification (clean, non-conflicting history) + run-mission.ps1 single-instance mutex fix; phase→execute; W4-000→done; rows 2-4 are the three colliding launches (00:20/00:28/00:29), numbered in write-order not start-order |
| 18 | 2026-08-19 (exec) | WAVE4_SESSION_RESULT: W4-004 in_progress — pure core + storage landed (VitalSample with full S5 registration and an EXTENDED completeness guard, baselineEngine, chronobiology), 136 new pins + 7 appended, suite 179/2357 green twice; four defects found in this session's own code by its own tests (Mongoose-9 pre-hook signature, `Number(null)===0` in both engines, non-robust cosinor LSQ, an unfalsifiable shift-worker test); §M.4 k-constant deviation derived and flagged as W4-D12; wiring half owed |
| 19 | 2026-08-19 (exec) | WAVE4_SESSION_RESULT: REFLECT done 4 verified, 0 reopened, 1 queued — suite 179/2357 green (exact baseline), lint 0 errors; W4-D08's reopened Suunto lane verified by executing the real webhook (resolves with truthful reject accounting), W4-D11's linter verified load-bearing by probe (1 eslint error + 3 guard pins RED), W4-004's export registration verified load-bearing by stub-out (4 pins RED across 2 suites); W4-D13 queued — S5 names five registration surfaces and W4-004 wrote four, leaving `VitalSample` out of `docs/PRIVACY_DECLARATIONS.md` while the Play data-safety answer still lists a nine-collection cascade the code outgrew; W4-D12 closed by ruling (k=1 is the variance decomposition, MAD→SD conversion verified consistent), mission §M.4 amended with the unit note |
| 20 | 2026-08-19 (exec) | WAVE4_SESSION_RESULT: W4-004 done — wiring half landed (baselines delegate to the engine so D1 finally reaches the serving path, superset blob, stale-while-revalidate, VitalSample writes, tzOffsetMinutes on all five ingest paths, D16 + steps dormant behind a consent-v2 flag, Karvonen zones via doc.save(), WAVE4_BASELINE_ENGINE_DISABLED kill-switch); W4-D13 discharged in the same PR with a standing retention-doc guard; 58 new pins + 1, suite 182/2416 green twice; six deliberate re-pins, all documented; two defects found in this session's own code by its own tests (a suite silently exercising the swallowed-failure path, and a "best-effort" worker call that was not); ATTACK-2 caught a real regression — the engine's population prior would have replaced translate's abstain-when-unknown, so the legacy keys now stay null on zero evidence |
| 17 | 2026-08-19 (exec) | WAVE4_SESSION_RESULT: W4-003 done — wiring half landed (filter drives debounce/trigger, D10 live persistence throttled+deduped, S6 gate real at the seam, WAVE4_ANOMALY_FILTER_DISABLED kill-switch, W4-D07 closed), 15 new pins (14 in wave4.liveWiring.test.js + 1 in biometricHandler.pipeline.test.js), suite 176/2213 green twice; 3 deliberate re-pins + 1 tolerance widening, all documented; PR #179 body updated, branch pushed |
