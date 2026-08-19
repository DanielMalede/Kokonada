# WAVE4_STATE â€” machine-updated run state

> The SINGLE resume source for the Wave-4 run. Every session reads this first and updates it before exiting.
> Rules: update via small, surgical edits; never delete history sections; keep the task table authoritative.

## Run header

- phase: execute           <!-- review | execute | closeout | halted â€” H2 closed 2026-08-19 (see HITL queue) -->
- branch: feat/intelligence-wave   <!-- created from origin/main (== local main, in sync) in session 1 -->
- lastMainSha: 1a1657ea4bae1f48a6de4e2dd29b3f2a14d02010
- testBaseline: - testBaseline: **192 suites / 2749 tests GREEN** after W4-006's SEAM half (+4 suites - `affectCache.test.js` 25 pins, `wave4.affectSeam.test.js` 33, `wave4.stateSeam.test.js` 15 and `wave4.explainReceipt.test.js` 14 = **87** - plus **6** appended (`wearableErasure` 16 -> 18, `stateVector.worker` 5 -> 9), so 2656 + 87 + 6 = **2749** exactly and no pre-existing test was lost in the two deliberate re-pins). Established by repetition per S0.4 S1a, and the sequence is recorded rather than summarised because the three runs are not interchangeable: run 1 was solo and green at **2748** (192 suites, exit 0, 222.2 s) - a genuinely different count, because this session added one more pin (the DTO-containment test) AFTER starting it, which is why it is not one of the two consecutive greens; run 2 was deliberately backgrounded and therefore executed CONCURRENTLY with seven per-suite jest invocations plus git work, and was **green anyway** at 192 suites / 2748 passed + 1 todo, exit 0, 222.9 s; run 3 was solo on the final tree, identical at 192 / 2748 + 1 todo, exit 0, 213.8 s. **Runs 2 and 3 are the two consecutive greens at the final count of 2749**, and both were verified `checkmark-free` by `grep -c` over the COMPLETE captured log rather than by reading a summary line or a tail (the W4-D15 lesson). One honest footnote on process: run 2 was reported by the harness as FAILED with exit code 1, and it was not - the wrapper's last command was `grep -c` for the failure marker, which returns 1 when it finds ZERO matches, so the green result produced the non-zero exit. `npm test` itself printed `exit=0` inside that same log. Recorded because a future session running the same wrapper will see the same misleading signal. **Zero pre-existing behaviour changed for anyone without an affect state**: the seam is pinned field-for-field against the kill switch, and the one user-visible addition (`receipt.why`) is an additive DTO field withheld unless every axis its sentence claims carries real evidence. Lint **0 errors, 22 warnings** - the identical count for the ninth consecutive session; ~1900 new lines added none. Secret scan of the diff: clean. Attribution scan: clean. Zero-knowledge: the two new log lines carry an error TYPE only, the decorated `targets` object never reaches a socket emit (checked at the emit site), and a pin hands the receipt builder the whole decorated target and asserts only the vetted line leaves. Prior: **188 suites / 2656 tests GREEN** after W4-006's pure core (+3 suites - `stateTaxonomy.test.js` 34 pins, `stateTaxonomy.reachability.test.js` 9 and `wellbeingRegulator.test.js` 24 = **67** - and **ZERO re-pins**: all three files are new, and the one pre-existing file the task touches (`moodDescriptors.js`) gains only an additive export, so 2589 + 67 = 2656 exactly and nothing existing could change behaviour). Established by repetition per S0.4 S1a and recorded from the FULL captured log rather than a summary line (the lesson the W4-D15 entry below paid for): two consecutive runs, both **188 suites / 2655 passed + 1 todo**, exit 0, and both verified `checkmark-free` by `grep -c` over the complete log rather than by reading the tail. Lint **0 errors, 22 warnings** - the identical count for the eighth consecutive session; ~1500 new lines added none (one new warning, an unused `blob` destructure of this session's own, was removed rather than banked). **Three runs, and the middle one is recorded with its failure rather than without it:** runs 1 and 3 were solo on the box and are the two consecutive greens above; run 2 was deliberately backgrounded and therefore executed CONCURRENTLY with run 3 plus this session's git/python work, and it failed one test - `anomalyFilter.test.js > costs far less than the live cadence it runs at`, `anomalyFilter-10k min=204ms > budget=200ms (p50=210 p90=212 max=212 n=5)`. Unlike the equivalent blemish recorded under W4-D15, this one is NAMED, because the full output went to a file rather than through `tail` - which is the whole point of that lesson. It is not this task's regression, established two ways rather than asserted: (a) `anomalyFilter.js` imports exactly one module, `services/wearable/hrRange`, and this session's diff touches none of its six files; (b) the identical diff is green in both solo runs. What it DOES surface is a residual in W4-D09's fix - see the evidence line appended to that row. Secret scan of the diff: clean. Attribution scan: clean. Zero-knowledge: the one new log line (`[regulator]`) carries a state token, a band, a one-decimal demand ratio and two booleans, and is asserted against a vitals blacklist in the suite. Prior: **185 suites / 2589 tests GREEN** after W4-D15 (+1 suite - `wave4.nullBaseline.test.js` 38 pins - plus 2 appended to `wave4.baselineWiring.test.js` (26 -> 28): 2549 + 38 + 2 = 2589 exactly, so no pre-existing test was lost in the one deliberate re-pin). **One deliberate re-pin** (`wave4.baselineWiring`'s *D1 (no data)* test, which asserted that the legacy `hrvMedian` key hands translate the population prior; it now asserts the abstention, with the prior verified still reachable on the superset keys) and **three strengthened test bodies** in `shadow.qa4.biometric.test.js` with no count change - all three were `assertTargetsSane`-only tests whose titles claimed behaviour their bodies never checked, and two of the three turned RED the moment they were made to check it (see the W4-D15 row). Established by repetition per S0.4 S1a, and recorded with its one blemish rather than without it: **five** full runs, **four green** - 185 suites / 2588 passed + 1 todo at 208.5 s, 209.7 s, 206.7 s and 209.4 s, the last two consecutive and verified `✕`-free by grep over the complete captured log, not by reading a summary line. **The fifth run (chronologically the second) reported 1 failed test and I cannot say which**, because that run's command was piped through `tail -8` and the diagnostics were discarded - a self-inflicted loss of evidence, recorded so the next session pipes full output to a file instead. What can be said: it is the only run of the five during which this session was doing concurrent work on the box (a python STATE edit, a `state-guard.js` node process, several greps), which is precisely the ordinary-memory-pressure condition W4-D09 documents as tipping a wall-clock latency assertion from 29x ms to 30x ms; and the one mechanism by which THIS task's diff could plausibly cause a cross-suite failure - the new suite is the only place in the tree that switches translate's behaviour through an env var, in a single `--runInBand` process - was eliminated by construction afterwards (`afterEach` + `afterAll` restore) and then disproved by probe: the new suite followed by the four most translate-sensitive suites in ONE process is 125/125 green. Lint **0 errors, 22 warnings** - the identical count for the seventh consecutive session; ~250 new lines added none. Secret scan of the diff: clean. Attribution scan: clean. Zero-knowledge: the diff adds no log line and no DTO field at all. Prior: **184 suites / 2549 tests GREEN** after W4-005 (+2 suites â€” `affectEngine.test.js` 78 pins and `affectHmm.test.js` 55 = **133** â€” and **ZERO re-pins**: both files are new and the only existing file the task touches is `translate.js`, which gains a one-line additive export of `ACTIVITY_EXERTION_FLOOR` so the affect engine reuses that table rather than copying it, so 2416 + 133 = 2549 exactly). Established by repetition per Â§0.4 S1a: two consecutive full runs, both **184 suites / 2548 passed + 1 todo**, exit 0, at 236.0 s and 196.8 s. Lint **0 errors, 22 warnings** â€” the identical count for the sixth consecutive session (one new warning, an unused `round3` of this session's own, was removed when the axes half landed rather than banked, then reintroduced with a real caller in the temporal half). Secret scan of the diff: clean. Attribution scan of the diff: clean. Prior: **182 suites / 2416 tests GREEN** after W4-004's WIRING half (+3 suites â€” `wave4.retentionDocs.test.js` 7 pins, `wave4.vitalIngest.test.js` 25, `wave4.baselineWiring.test.js` 26 = **58** â€” plus 1 pin appended to `stateVector.worker.test.js`: 2357 + 58 + 1 = 2416 exactly, so no pre-existing test was lost in the six deliberate re-pins). Established by repetition per Â§0.4 S1a: two consecutive full runs, both **182 suites / 2415 passed + 1 todo**, exit 0. Lint **0 errors, 22 warnings** â€” the identical count for the fifth consecutive session (one new warning, an unnecessary `eslint-disable global-require` of this session's own, was removed rather than banked). Secret scan of the diff: clean. **Six deliberate re-pins, none of them a weakening** â€” see the W4-004 wiring evidence section. Prior: **179 suites / 2357 tests GREEN** after W4-004's pure core (+3 suites â€” `vitalSample.integration.test.js` 29 pins, `baselineEngine.test.js` 63, `chronobiology.test.js` 44 = 136 â€” plus 7 pins appended to three existing suites, and **1 deliberate re-pin** (`userDataExport` completeness list gains `vitalsamples`). **Correction to the number below, carried forward honestly:** the W4-003 baseline was **2214**, not 2213 â€” session 17's evidence describes "+14 pins ... +1 pin appended" and then computes "2199 + 14", dropping the +1 its own session-log line reports as "15 new pins". 2214 + 143 = 2357 exactly. Lint 0 errors / 22 warnings, unchanged for the fourth consecutive session. Established by repetition per Â§0.4 S1a. Prior: **176 suites / 2213 tests GREEN** after W4-003's WIRING half (+1 suite `wave4.liveWiring.test.js` with 14 pins, +1 pin appended to `biometricHandler.pipeline.test.js` (W4-D07), 2199 + 14 = 2213 exactly). Established by repetition per Â§0.4 S1a: two consecutive full-suite runs, both 176 suites / 2213 passed + 1 todo, exit 0, at 132.5 s and 149.6 s. Lint: **0 errors, 22 warnings** â€” the identical count session 16 recorded; the wiring diff (~465 lines across 8 files) added none. **Two W4-002 "this is what it does TODAY" pins deliberately re-pinned in `sim.replay.integration.test.js`** (D10 live persistence, S6 future-timestamp gate â€” both now assert the FIXED behaviour, see the W4-003 wiring evidence section) **+ one deliberate tolerance widening** (`the served-band latch holds through a resting oscillation across the 90 cut`: `<=4` â†’ `<=5` â€” the filtered/Kalman trajectory is not bit-identical to the raw one near a boundary-hugging signal, see evidence). Prior: **175 suites / 2199 tests GREEN** after W4-003's pure core (+1 suite `anomalyFilter.test.js` with 82 pins, **zero re-pins** â€” the two new modules are not wired into any serving path yet, so nothing existing could change behaviour: 2117 + 82 = 2199 exactly). Established by repetition per Â§0.4 S1a, not by one lucky run: two consecutive runs, both 175 suites / 2198 passed + 1 todo, exit 0, at 138.1 s and 137.0 s. Lint: **0 errors, 22 warnings** â€” the identical count session 15 recorded, i.e. the ~1000 new lines added none. Prior: **174 suites / 2117 tests GREEN** after W4-D08's reopen + W4-D11 (+2 suites â€” `wave4.ingestLanes.test.js` with 16 pins and `wave4.lintGuard.test.js` with 10 â€” **zero re-pins**: both files are new and nothing existing changed behaviour, so 2091 + 26 = 2117 exactly). Established by repetition per Â§0.4 S1a rather than by one run: two consecutive runs, **174 suites / 2116 passed + 1 todo**, exit 0, at 128.2 s and 124.1 s. Prior: **172 suites / 2091 tests GREEN** after W4-D08 (+1 suite `wave4.ingestAccounting.test.js` with 17 pins, +1 test appended to `sim.replay.integration.test.js`, **1 deliberate re-pin** â€” the W4-002 pin that ENCODED the defect, flipped by design). Two consecutive runs, exit 0: **172 suites / 2090 passed + 1 todo** at 120.2 s and 120.9 s. W4-D09's budgets held with room (`burst-20` 5718 vs an 11000 budget; `generateV2` min 264; `selection-500` min 268), which is the second wave-4 baseline established by repetition rather than by one run. Prior: **171 suites / 2073 tests GREEN** after W4-D09 (+1 suite `wave4.perfBudget.test.js` with 45 pins; **3 deliberate re-pins** â€” the two per-call latency assertions and the 20-user burst assertion â€” with no test-count change in the two edited files). **This is the first baseline since W4-002 that Â§0.4 S1a permits banking as green, and it is established by repetition, not by one lucky run:** runs D, E and F, all `171 suites / 2072 passed + 1 todo`, exit 0, at 121.1 s / 121.9 s / 117.7 s. Their perf records are deliberately NOT identical â€” `generateV2` min 260 / 255 / 231, `selection-500` min 225 / 291 / 261 â€” and that is the point: this spread is the noise the old single-shot budgets were actually measuring, and all three runs are green regardless. Every one of them was also achieved with **ten stale `worker.test.js` node processes** still resident on the box from the 2026-08-19 00:22/00:29 H2 collision (see HITL H3), i.e. under a standing background load rather than on a clean machine. The three runs BEFORE the burst fix are kept in the W4-D09 evidence section as the failure record: A clean/green, B under deliberate 2x overload (2 failures â€” the burst constant and a real-socket auth timeout), C clean (1 failure â€” the burst constant at 6236 ms). The two per-call budgets held in **all six** runs, including the overloaded one. Prior: **170 suites / 2028 tests** after W4-002 (+2 suites `sim.generator.test.js` 62 pins and `sim.replay.integration.test.js` 22 pins, **zero re-pins** â€” W4-002 adds only new files). **NOT recorded as green, deliberately (Â§0.4 S1a forbids banking a non-deterministic baseline):** the run ends 2026 passed / 1 todo / 1 FAILED, and the failure is a PRE-EXISTING wall-clock latency budget, not this task. Established by control, not by assertion: with both new suites REMOVED the suite still fails â€” run A `shadow.flip.test.js`, run B `shadow.selection.test.js` (319 ms vs a `Date.now() - started < 300` budget) â€” and with them restored it fails the same way (307 / 315 ms). Both files pass in ISOLATION. Machine state during measurement: CPU 8%, free RAM 3.1 GB of 14.2 GB, 12 unrelated node processes; full run 100 s without the new suites, 115 s with. Tracked as W4-D09. New suites cost 17 s combined and are open-handle clean (`--detectOpenHandles` silent, exit 0), so the W4-D06 guard still holds. Prior: **168 suites / 1944 tests** green after W4-D06 (was 167/1891 after W4-D05; +1 suite `wave4.openHandleGuard.test.js` with 53 pins, **no re-pins** â€” nothing existing changed behaviour). ~83s, exit 0. **W4-D06 re-record (session 10) â€” the sentence reflection #1 retracted is true again, and this time it is MEASURED in all three modes, not inferred:** (a) `npm test` (`--runInBand --forceExit`) 168/1944 green, exit 0, 83.3s; (b) the same run WITHOUT `--forceExit` 168/1944 green, exit 0, 79.4s, and jest prints NO "did not exit" warning; (c) `npm run test:handles` (`--detectOpenHandles`) **silent â€” no open-handle section at all** â€” 168/1944 green, exit 0, on two consecutive runs (89.3s, 83.5s). `--forceExit` is deliberately KEPT: it no longer masks anything, because the new `globalTeardown` guard fails the run independently of it. Prior: 167 suites / 1891 tests after W4-D05 (was 166/1865 after W4-D02; +1 suite `wave4.bandHysteresis.test.js` with 23 pins, +3 pins appended to `biometricHandler.pipeline.test.js`, **no re-pins**). ~85s, exit 0. Prior: 166 suites / 1865 tests after W4-D02 (was 165/1829 after W4-D01; +1 suite `wave4.stateGuard.test.js` with 36 pins, no re-pins). ~81s, exit 0. Prior: 165 suites / 1829 tests after W4-D01 (was 164/1802 after W4-001; +1 suite `wave4.reflectMarker.test.js` with 27 pins, no re-pins). ~81s, exit 0. Prior: 164 suites / 1802 tests after W4-001 (was 163/1767 after W4-000; +1 suite `wave4.bugfix.test.js` with 34 pins, +1 re-pin in `biometricHandler.pipeline.test.js`), ~80s, exit 0. Prior baseline text: 163 suites / 1767 tests green (162 product suites: 1759 passed + 1 todo, plus adr0012.tripwire.test.js), ~60s, exit 0. **Correction (reflection #1, session 8), now CLOSED by W4-D06 (session 10): the wording claiming "exit 0 without --forceExit, --detectOpenHandles silent" was retracted as untrue at the time â€” without `--forceExit` jest reported it did not exit, and `--detectOpenHandles` named 2 leaked 60 s debounce timers.** Both are fixed and re-measured above; the retraction stands as history, the claim no longer does. Established 2026-08-19 after the worker.test.js real-connection-leak fix (injected queue seam). Real root cause was more specific than S1a guessed: backend/.env sets GLOBAL_SEED_INGEST_ENABLED=true and worker.js loads it with override:true, so the success-path tests reached a real ioredis dial against the fake host â€” not merely "no local Redis".
- missionVersion: 2026-08-18 (as approved by Daniel; amended by W4-000 review deltas, same date)
- runStartedAt: 2026-08-18T22:56 local (session 1)
- day4CutoffAt: 2026-08-22T22:56 local (runStartedAt + 96h; after this, only W4-015 may run)
- reflectIntervalHours: 4   <!-- Â§2.5 recurring reflection pass; trigger state in logs/wave4/last-reflect.txt -->

## Task table

| id | title | tier | size | deps | status | owner-session | notes |
|----|-------|------|------|------|--------|---------------|-------|
| W4-000 | Bootstrap, review pass, ADR-0012 | MUST | S | â€” | done | 1,3 | review pass + S1 preflight + worker.test.js leak fix + green baseline (163/1767, see testBaseline above) + ADR-0012 + tripwire all landed in `d1db088`. ADR filed as `docs/adr/0012-learning-compliance.md` matching the repo's existing `000N-kebab-title.md` convention (not the mission text's `ADR-0012-â€¦` â€” intentional call, ADR README index refreshed). Docker is NOT installed on this machine â€” S1a's `docker-compose up` path is not viable here (moot: the injected-queue-seam fix superseded it). |
| W4-001 | Surgical bug backlog (D3,D4,D5,D7,D8,D9,D11i,D14,D17,W8/W9) | MUST | M | 000 | done | 5 | all 10 sub-fixes landed (`f2add0e`â†’`b92aee3`). Suite **164 suites / 1802 tests** green (baseline 163/1767: +1 suite `wave4.bugfix.test.js`, +34 new pins, +1 re-pin). 3 deliberate re-pins, see below. Shared HR predicate extracted to `app/services/wearable/hrRange.js`; `WATCH_HR_DELTA_THRESHOLD` retired (subsumed by the band trigger). |
| W4-002 | Synthetic-human simulator + replay | MUST | L | 000 | done | 11 | `sim/{rng,personas,generator,replay,soak}.js` + 2 suites, **+84 pins, zero re-pins**. Suite **170 suites / 2028 tests**, 2026 passed / 1 todo / **1 pre-existing wall-clock flake** (see testBaseline + W4-D09) â€” the flake reproduces with these suites REMOVED, twice. Found two defects in passing: W4-D08, W4-D09. |
| W4-003 | A0 signal integrity + live persistence | MUST | L | 001,002 | done | 16,17 | L task, split across sessions by design. Session 16 landed the PURE CORE (telemetry DTO + `anomalyFilter.js`, 82 pins). **Session 17 landed the WIRING half:** `handleBiometricReading` now consumes the filtered `{level,trend,confidence}` for every debounce/trigger decision (D6); accepted readings persist to `BiometricLog` throttled â‰¤1/min/socket with `source@recordedAt` dedupe (D10); S6 (future/stale timestamp) gates the live seam via the filter's own gate; `WAVE4_ANOMALY_FILTER_DISABLED` kill-switch restores W4-001 behaviour byte-for-byte; W4-D07's mock divergence closed. `+1` suite `wave4.liveWiring.test.js` (14 pins, 7 stub-out verified load-bearing against the filter wiring) `+1` pin in `biometricHandler.pipeline.test.js`. Suite **176/2213 green twice**. See the W4-003 wiring evidence section below. |
| W4-004 | A1+A2 baselines & chronobiology v2 | MUST | L | 003 | done | 18,20 | L task, split by design (the W4-003 precedent). **Session 18 landed the PURE CORE + storage:** `models/VitalSample.js` (encrypted, metric-typed, TTL 90d, metric-aware range hook) with FULL S5 registration in all five erasure/export surfaces **plus an extended completeness guard** (export coverage + source-scoped per-provider erasure are now mechanically checked, not remembered); `agents/runtime/physiology/baselineEngine.js` (D1/D2/D14/D15) and `chronobiology.js` (D13), both pure and clock-free. 136 new pins across 3 suites + 7 appended. Suite **179/2357 green**. **Owed next session (the WIRING half):** `baselines.js` delegation + superset blob + stale-while-revalidate (this is where D1 actually reaches the serving path â€” it does NOT yet), `metricStore.persistMetrics` VitalSample writes, `adapter.js` dormant stressLevel/steps (D16), `tzOffsetMinutes` on both ingest lanes, `MedicalProfile.hrZones`/`maxHeartRate` via `doc.save()`, cache-compat tests. **Session 20 landed the WIRING half and the task is COMPLETE.** `baselines.computeBaselines` now delegates to `baselineEngine` and returns the SUPERSET blob â€” **D1 reaches the serving path** (`translate()` unchanged, as designed); `peekBaselines` gained stale-while-revalidate (D15's second half); `metricStore` writes VitalSample rows for the two consent-v1 metrics behind a `VITAL_METRICS_PERSISTED` allowlist; `tzOffsetMinutes` is plumbed through BOTH batch lanes AND all three live normalizers, with a new optional `BiometricLog.tzOffsetMinutes` field; `adapter.js` gained the D16 stressLevel lane and steps behind `WAVE4_CONSENT_V2_METRICS` (empty by default â€” collection NOT widened, Â§0.2.3); Karvonen zones + HRmax are written to the dormant `MedicalProfile` fields via `doc.save()` from the stateVector worker. S11 kill-switch: `WAVE4_BASELINE_ENGINE_DISABLED`. **W4-D13 discharged in the same PR** per its scoping note. 58 new pins across 3 suites + 1 appended; suite **182/2416 green twice**. Six deliberate re-pins, all listed in the W4-004 wiring evidence section below. See the W4-004 evidence section. **Two additions from reflection #3, both for the wiring half:** (1) Â§0.4 **S11 owes a kill-switch here** â€” the `baselines.js` delegation is what actually puts D1 on the serving path (`translate()` stops scoring everyone against the `{45, 8}` population constant), i.e. a real behaviour change for every user with HRV history, and S11's named flag inventory in the mission does not list one, so it is easy to miss; ship an env hatch restoring the pre-delegation blob without a revert. (2) **W4-D13** (S5's retention-documentation surface, missed by the pure-core PR) is cleanest to discharge inside this task's wiring commit â€” same open PR #179, which is literally what S5's "same PR" wording asks. |
| W4-005 | A3 affect engine core (axes+HMM) | MUST | L | 004 | done | 21 | L task landed in ONE session (both halves), unlike W4-003/004 â€” W4-005 has no wiring at all (W4-006 owns the `targetsBuilder`/`translate` seam), so the whole task is one pure module plus tests plus an ADR. `agents/runtime/physiology/affectEngine.js` (1173 lines): six evidence axes each carrying an explicit `{value, mass}` so an axis can say **I do not know**; Â§M.8 Karvonen exertion replacing `(HR-60)/100`; arousal against the personal 24-bin hour table (D1 reaches a second consumer); a SOFT rest gate that kills D3 structurally; declared-mood fusion over ALL taps (centroid + dispersion, not just the last); Â§M.5 HMM forward with mass-tempered emissions; four-gate hysteresis label projection; the `AffectState` DTO. **The taxonomy state set is an INJECTED PORT** â€” `validateStateSet` enforces the contract W4-006 must meet, and the engine degrades to axes-only (`topState: null`) when given none, so the two tasks never fight over one source of truth. `docs/adr/0013-state-model.md` records the 4-layer stack, both Â§M deviations and the CUT BorbÃ©ly two-process formula. **133 new pins across 2 suites, ZERO re-pins** (the only existing file touched is a one-line additive export from `translate.js`, so nothing could change behaviour): suite **184/2549 green twice**. Six defects found by this session's own tests in its own code, three of them real product bugs â€” see the W4-005 evidence section. |
| W4-006 | A4 taxonomy + A5 regulator + seam | MUST | L | 005 | done | 22,25,26 | reachability = hard DoD. **Session 22's commit `ae3937a` says `start W4-006 pure core - taxonomy + regulator` but contains only `scripts/wave4-doctor.ps1` and a STATE edit** - neither module existed, nor did the `knowledge/` or `translation/` directories. Recorded rather than quietly absorbed: the message over-claims and the pure core was still owed in full. **Session 25 landed the PURE-CORE half complete:** `knowledge/stateTaxonomy.js` (34 states / 6 domains) + `translation/wellbeingRegulator.js` + three suites, **67 new pins across 3 suites, ZERO re-pins** (the only pre-existing file touched is `moodDescriptors.js`, which gains a one-line additive export of `_STATE_TO_BAND` so the superset guarantee is pinned against the real table rather than a copy - the `ACTIVITY_EXERTION_FLOOR` precedent). Suite **188/2656**. Two design decisions worth Daniel's eye and one measured finding that changed the module: widths are SOLVED from per-axis roles against a fixed precision budget rather than authored (so peak emissions are identical across the table and no state can win by claiming harder); every state constrains all seven axes (an unconstrained axis is a free pass a rival pays nothing for); and the regions are authored in NORMALISED units over a MEASURED attainable envelope, because eight states were literally unreachable in raw units. See the W4-006 evidence section. **Owed next session (the SEAM half):** `targetsBuilder.buildTargets` gains `affectPeek` (AAD-bound encrypted Redis blob, `peekBaselines` pattern) and wraps with `wellbeingRegulator.apply`; `medicalProfileService.upsertStateVector` writes taxonomy labels with an explicit `encrypt(status)`; `moodDescriptors._STATE_TO_BAND` extended from `stateTaxonomy.stateBandTable()`; `stateVector.worker` persists the daily affect refresh; S13 `buildReceipt` explain lines; and the S11 kill-switches `WAVE4_AFFECT_DISABLED` / `WAVE4_TRAJECTORY_DISABLED`, which the two pure modules NAME but deliberately do not read. **Session 26 landed the SEAM half and the task is COMPLETE.** The affect layer now reaches the serving path: `affectCache.js` (AAD-bound encrypted HMM posterior, 2 h carry window), `affectService.js` (the ONE peek->update->save composition both lanes use), `knowledge/explain.js` (S13's claim-gated why-line), `buildTargets` wiring with `taps` threaded from both real call sites, `_STATE_TO_BAND` derived from `stateBandTable()`, an ADDITIVE encrypted `stateId` on `upsertStateVector`, the nightly worker refresh, and both S11 kill-switches (`WAVE4_AFFECT_DISABLED` skips the layer; `WAVE4_TRAJECTORY_DISABLED` stops the decoration while the posterior keeps advancing for W4-009). D13's serving-path half landed with it - hour-of-day now comes from the user's habitual timezone. S5 registration for the new `bio:affect:` key family in the same PR. **87 new pins across 4 suites + 6 appended, TWO deliberate re-pins** (both documented, neither a weakening); suite **192/2749**. The seam design was chosen by measurement: a pure worker-written peek would have been a no-op reporting success. One mechanism proved unfalsifiable under stub-out and was deleted rather than banked, and one of this session's own tests was found passing for the wrong reason on a UTC+3 box. See the W4-006 seam evidence section. |
| W4-007 | B2 scoring & similarity rebuild | MUST | L | 001 | pending | â€” | eligible early if bio track stalls |
| W4-008 | B4 trajectory planner | MUST | L | 007 | pending | â€” | |
| W4-009 | A7 live analysis + state-triggered recalibration | SHOULD | M | 006 | pending | â€” | |
| W4-010 | B1 taste profile v2 | SHOULD | M | 001 | pending | â€” | |
| W4-011 | B6 feedback loop + RewardEvent | SHOULD | L | 003,006 | pending | â€” | mbid:-only guard |
| W4-012 | A6 daily analysis + MorningState | SHOULD | M | 004 | pending | â€” | |
| W4-013 | B5+B7 bandit + PersonalWeights | STRETCH | M | 011 | pending | â€” | ships dark |
| W4-014 | B3 embedding v2 dual-write | STRETCH | L | 007,W16 | pending | â€” | cutover HITL-blocked |
| W4-016 | LLM candidate-generation band from the real state source | MUST | M | 004 | pending | â€” | **Added by Daniel 2026-08-19, outside the original queue.** Full spec: `docs/plans/WAVE4_TASK_W4-016.md` (read it before starting). `geminiEngine.js:235` (`_buildBiometricPrompt`) calls `bandFromHeartRate` directly and `geminiEngine.js:326` passes only `{heartRate}` to `applyBiometricBands`, so both fall through `biometricBand`'s preference chain to the hardcoded 90/120 ladder â€” the LLM that GENERATES the candidate pool never sees personal baselines or taxonomy state. Fix = populate the context (`stateLabel`, `hrRatio`), not rewrite `biometricBand`. Kill-switch `WAVE4_LLM_BAND_FROM_STATE_DISABLED`. Prompt must still carry the band string ONLY â€” no vitals, no labels (Â§0.2.2). |
| W4-015 | Soak, closeout & package | MUST | M | any | pending | â€” | ALWAYS runs last |

## Review deltas (filled by W4-000)

Session 1 (2026-08-18, plan tier) â€” full-repo validation of the mission. All six flagged unknowns resolved; spot-checked defect refs D1â€“D5, D7â€“D9, D11, D13â€“D15 verified byte-accurate against source.

- (a) **W16 / embedding.worker.js:** stored vectors ALREADY genre-free (`buildVector(doc, [])`, PR #139 dilution fix; only `mbid:` keys reach the index). D19 is latent in `buildVector`, not live in the index â†’ W4-014 spec amended in the mission (genre block = deliberate re-introduction; corpus ~98% genre-less â†’ IDF must handle dfâ‰ˆ0; `docs/plans/mbid-representation-recalibration-vs-genre-seam.md` (tracked draft, 2026-07-15, measured prod evidence) is required reading).
- (b) **discoveryFetch.js:** adapter confirmed â€” `extractTargetFeatures(aiParams)` â†’ `{bpm, energy, valence, acousticness, danceability}`; `biasToBand` re-centers the query on `{bpmCenter, energyFloor/Ceiling, valenceTarget, acousticnessBias}`; `DISCOVERY_FEATURE_ONLY_TARGET` default ON; dormant genre-Jaccard scoring seam behind `DISCOVERY_GENRE_RELEVANCE`.
- (c) **audioFeatureRepo.js:** upsert precedence api > acousticbrainz > llm (filter excludes higher sources + swallowed E11000; measured sources write through to Redis, llm invalidates) â€” W4-007's source-tier confidences (1.0/0.85/0.7) align with the real enum.
- (d) **queues/definitions.js:** frozen QUEUES map + QUEUE_NAMES set â€” feature-hydration, embedding-build, state-vector-recompute, biometric-buffer, reclassify-unclassified, global-seed-ingest, session-trim, youtube-retention. New W4 queues extend this map.
- (e) **watchHrIngest:** Art.9 consent hard gate confirmed inline (fail-fast, before body validation, same consent service). Route validates HR 30â€“230 â€” a THIRD range; W4-001 D9 fix amended in the mission to align it with the shared 30â€“220 predicate. Delivers immediate-mode to every socket in the user's room.
- (f) **biometric-mock.js:** socket-lane driver, payload `socket.emit('biometric_push', { source: 'garmin', raw })`, fixed-constant scenarios; `mock-biometrics.js` is a near-duplicate. W4-002 spec amended: reuse the payload shape, don't extend the scripts.
- **Seam paths pinned:** `app/services/selection/biosonicBand.js` (withinBand at :33), `app/services/generation/targetsBuilder.js`, `app/services/features/featureProvider.js`, selection dir = {biosonicBand, candidatePool, hardFilters, mmr, pipeline, score}.
- **Repo hygiene:** `.claude/settings.json` `includeCoAuthoredBy: false` âœ“; `.gitignore` had NO `logs/` entry (ccusage JSON + session logs were unignored) â†’ `logs/` added this session; `docker-compose.yml` present at repo root (S1a cheap green-baseline path viable); `worker.test.js` structure matches S1a exactly (success-path tests at lines 31/63/120 set `REDIS_URL='redis://example:6379'`).
- **CI ground truth re-confirmed via gh:** push CI on main green; scheduled "Secret scan (full history)" failing weekly since â‰¥2026-07-27 (~10â€“13s runs â€” pre-existing, unrelated) â†’ HITL H1.
- **S2 dirty-tree decisions (session 1):** `backend/package-lock.json` â€” optional-peer-dep churn (gcp-metadata removal, bare `npm install` artifact) â†’ restored to HEAD (stash-and-drop equivalent). `mobile/src/health/config.ts` â€” Daniel's intentional local deployment config (public client IDs over tracked placeholders) â†’ LEFT IN PLACE uncommitted; mobile out of scope; do not commit, do not drop.

## HITL queue (for Daniel â€” numbered tutorials, decisions, portal actions)

- **H4 â€” PORTAL / PROD ACTION: index builds for the new `vitalsamples` collection (W4-004).** The
  `VitalSample` model declares two indexes that Mongoose creates automatically in dev and test but that must
  be built deliberately in production, because a background index build on a live collection is a Pause &
  Guide action an agent must never perform: (a) the query index `{ userId: 1, metric: 1, recordedAt: -1 }`,
  which every baseline read depends on â€” without it the first user with a year of vitals turns a baseline
  refresh into a collection scan; and (b) the TTL index `{ recordedAt: 1 }` with
  `expireAfterSeconds = 7776000` (90 days, env-tunable via `VITAL_SAMPLE_RETENTION_DAYS`), which is what makes
  the retention promise in the privacy documentation true rather than aspirational. Steps for Daniel, once the
  wiring half has actually started writing rows: (1) Atlas â†’ Collections â†’ `vitalsamples`, or a `mongosh`
  session against `MONGO_URI`; (2) `db.vitalsamples.createIndex({ userId: 1, metric: 1, recordedAt: -1 },
  { background: true })`; (3) `db.vitalsamples.createIndex({ recordedAt: 1 }, { expireAfterSeconds: 7776000,
  background: true })`; (4) `db.vitalsamples.getIndexes()` to confirm both, and check that the TTL monitor has
  begun expiring rows older than 90 days on the next daily pass. Nothing is blocked on this today â€” the
  collection is empty until the wiring half lands, and correctness does not depend on the indexes, only
  performance and the retention guarantee do. Worth doing BEFORE the collection grows: building a TTL index on
  a large collection is far more expensive than building it on an empty one.

  **STILL OPEN - 2026-08-19 (manual maintenance session). No index was created, deliberately, and the reason matters.** This session was asked to build both indexes through the MongoDB MCP server after first proving the MCP target IS production. It could do neither, because **there is no MongoDB MCP server connected to this session at all** - a tool search for MongoDB/Atlas database tools returns nothing; the `mongodb:*` entries visible in the environment are documentation SKILLS, not a live server. So there was no connection to enumerate databases from, no server host to report, and nothing to compare against `MONGO_URI`. **What was verified locally instead (credentials never printed):** `backend/.env` sets `MONGO_URI` to an Atlas SRV target, user `Kokonada_Data`, host `cluster0.aowqhlx.mongodb.net` - and, importantly, **with no database path and no `MONGO_DB_NAME`**, which per `backend/app/config/db.js` resolves to the DEFAULT database `test`. `NODE_ENV=development`. `VITAL_SAMPLE_RETENTION_DAYS` is unset, so the model default of 90 days gives `expireAfterSeconds = 7776000` exactly. **Stated plainly: this session could NOT determine what production uses.** The deployed service supplies its own `MONGO_URI`/`MONGO_DB_NAME`, which is not readable from the dev box, so whether `cluster0.aowqhlx` is the production deployment - and if so under which database name - is unknown here. Building indexes on that guess is precisely the failure mode the HITL exists to prevent: it would close H4 on a false premise and leave production silently unindexed. **What was produced instead:** `scripts/atlas/h4-vitalsamples-indexes.js` - both `createIndex` calls with `background: true` and the TTL carrying `expireAfterSeconds: 7776000`, preceded by a `db.getName()` / `connectionStatus` pre-flight so the target is confirmed before anything is built, and followed by a read-back that asserts the TTL actually carries `expireAfterSeconds` (a TTL index created without that option is a plain index that silently expires nothing) plus the `collMod` recovery if it does not. Paste it into the Atlas UI or a `mongosh` session against a target confirmed to be production. **H4 stays OPEN until Daniel runs it and the read-back shows both indexes.**

- **H5 â€” DISCOVERED (session 21): a SECOND session was running on this working tree while W4-005 was in flight, i.e. H2 recurring.** Measured, not inferred, at 2026-08-19 17:04 local: this session own `claude` process started 16:10:47; two further `claude` processes started **17:00:11/17:00:12**; and `docs/plans/WAVE4_INTELLIGENCE_MISSION.md` acquired an **uncommitted** edit at **17:03:19** that this session did not make. The edit content identifies it: four additions to Â§2.5 (R1 gains a `gh pr checks` CI check, a new R1.5 STATE-size housekeeping rule, an R6 duplicate-row check, a new R6.5 pace check against `day4CutoffAt`) â€” that is a REFLECTION session writing. Note `reflect-marker.js check` reports `NOT-DUE fresh (1.77h old)`, so the loop should not have launched a reflection; either the `run-mission.ps1` single-instance mutex added when H2 was closed is not holding, or that session was started outside the loop (a manual/Cowork run). **No damage to this session work:** W4-005 is committed and pushed (`8ce8098`), and its three commits touch only `backend/**` and `docs/adr/**` plus STATE, none of which the other session had modified. **This session deliberately did NOT commit, revert or stage that mission-file edit** â€” it is another session in-flight work and Â§2.5 R2/S2 both say never build on leftovers you do not understand. **What Daniel needs to decide:** whether the mutex needs fixing again (H2 was closed on the assumption it was), because the failure mode is not lost code but silently interleaved STATE/mission writes â€” exactly W4-D02, which the `state-guard.js` backstop catches for the task table but NOT for the mission file or the prose sections. Cheapest mitigation if concurrency is intentional: have `run-mission.ps1` refuse to launch when another session `claude` process is alive, and treat the mission file as append-only during a run.

  **VERDICT 2026-08-19 18:00 (manual out-of-band maintenance session; H5 CLOSED, no code change).** **(1) The mutex HOLDS - tested end-to-end, not read.** With the live loop (PID 13256, `run-mission.ps1` started 09:23:39) genuinely holding `Global\KokonadaWave4Loop`, a second `powershell -ExecutionPolicy Bypass -File scripts\run-mission.ps1 -MaxIterations 0` printed `[wave4] another run-mission.ps1 is already running on this machine - exiting.` and returned **exit code 1**. That is the real script against the real holder, not a stub (`-MaxIterations 0` guaranteed no session could launch even had the gate failed). A direct `Mutex.WaitOne(0)` probe on the same name returned `false` - held, not abandoned - and `Global\` creation succeeds **unelevated** on this box, so the privilege failure mode that would have silently voided the guard does not exist here. **(2) The two 17:00 processes were never Claude Code sessions.** `Win32_Process` shows PID 30736 (17:00:11) and PID 27424 (17:00:12) are both `--type=renderer` CHILDREN of PID 31104 = `C:\Program Files\WindowsApps\Claude_1.32885.1.0_x64__pzs8sxrjxfjjc\app\claude.exe`, alive since 03:24:14, whose other children are the ordinary Electron set (crashpad-handler, gpu-process, network/audio/video utility). They are two renderer windows of the Claude **desktop app** - exactly the Cowork device bridge Daniel used to make the 17:03:19 mission-file edit. Corroborated independently by the loop own ledger: `run-mission.ps1` writes a `session N/40` line for every launch (line 294), and `logs/wave4/usage.log` has **no entry at all** between `16:10:47  session 10/40` and `17:05:33  WAVE4_SESSION_RESULT`. The loop launched nothing at 17:00. **H2 did not recur; there was no rogue loop, and no second writer besides the Cowork bridge Daniel was driving himself.** **(3) What actually failed is the DETECTOR, not the guard.** `scripts/wave4-doctor.ps1` matches `Name=node.exe` with "claude" in the command line, but `claude` on this box resolves to `C:\Users\danie\.local\bin\claude.exe` - a **native binary**. So it reports "none running" even while a loop session is live, and it reported "none running" during this very session while a live `run-mission.ps1` (PID 13256) was sleeping between sessions. Every claude-process count taken with a node-only filter is unreliable, and that false negative is what made H5 look like a mutex failure. **(4) The mitigation this row proposes is deliberately NOT implemented, because it would now do harm.** Refusing to launch when "any `claude` process is alive" would count the desktop app idle Electron renderers and Daniel own editor session, and would therefore block the loop permanently on this machine while fixing a collision that never happened. The honest fix is to repair the doctor process match first; any launch guard should key on `claude.exe` processes descended from the loop own `cmd.exe`, not on the bare image name. Left for Daniel to decide rather than changed unilaterally, since it alters launch behaviour.

- **H7 - RUN HALTED MID-SESSION by an EMPTY `docs/plans/WAVE4_HALT`, and the reason is unknown to
  this session.** Measured, not inferred. At session start (2026-08-19 18:47 UTC) the first thing
  this session did was check for the halt file: **it did not exist**. It exists now, created
  **19:12:17 UTC** (22:12:17 local), and it is **0 bytes** - so it carries no reason, which the
  mission's own S-section says a halt should. Seven minutes earlier, at **19:05:10 UTC**,
  `scripts/wave4-doctor.ps1` acquired an **uncommitted** 34-insertion/11-deletion edit that this
  session did not make. Neither timestamp is this session's work.

  **The most likely explanation, stated as a hypothesis rather than a finding:** this is the H5
  pattern recurring benignly - a human at the machine via the Cowork bridge, editing the doctor
  script (which H5's verdict identified as genuinely broken: it matches `Name=node.exe` while
  `claude` on this box is a native `claude.exe`, so it reports "none running" even with a live
  loop) and then stopping the loop deliberately. That would make this halt intentional and
  correct. It is a hypothesis because an empty file cannot say.

  **What this session did about it, and why.**
  - **Respected it.** W4-006 was already complete, committed and pushed when the halt was noticed;
    no new task was started, and none should be until Daniel clears this.
  - **Did NOT delete it.** Removing a stop signal is Daniel's call (the H2 precedent assigns
    exactly that step to him), and deleting a tracked stop file on a guess is the one action that
    could restart a run somebody deliberately stopped.
  - **Did NOT commit or revert the `wave4-doctor.ps1` edit.** It is another writer's in-flight
    work; S2 and Section 2.5 R2 both say never build on leftovers you do not understand. Left in place.
  - **Did NOT update PR #179's body**, which Section 1 would otherwise ask for now that the W4-006
    cluster is complete. The diff is already public (the branch is pushed), so nothing is lost -
    but posting a large summary outward while a stop signal is up, with no way to know what the
    stop is about, is the wrong side of "when in doubt, halt is the safe move". **This is the one
    piece of W4-006's reporting that is owed**, and it is a single action for whoever resumes:
    prepend the session-26 cluster note recorded in the PR queue section below to #179's body.

  **Steps for Daniel:** (1) if you created this halt deliberately, nothing is wrong - finish
  whatever prompted it, then delete `docs/plans/WAVE4_HALT` and relaunch exactly one loop; (2) if
  you did NOT create it, treat it as a genuine incident: check `logs/wave4/usage.log` for a session
  launch between 19:00 and 19:15 UTC, since `run-mission.ps1` writes a `session N/40` line for
  every launch and H5's investigation used exactly that ledger to prove the loop had launched
  nothing; (3) either way, consider writing a REASON into any future halt - an empty halt stops
  the run without telling the next session what it is stopping for, which is the one thing a halt
  file exists to communicate; (4) decide the `wave4-doctor.ps1` edit's fate (commit or discard).
  **Blocked on this: the entire remaining queue** (W4-007 onward). Nothing is wrong with the
  product code - W4-006 landed green at 192/2749 and is pushed.

- **H1 â€” DISCOVERED (not in roadmap): scheduled Secret-scan workflow failing on main.** The weekly "Secret scan (full history)" GitHub Action has failed every scheduled run since at least 2026-07-27 (runs last ~10â€“13s â†’ likely a setup/config error, not a found secret; push CI is green). Steps: (1) GitHub â†’ Actions â†’ "Secret scan (full history)" â†’ open the latest failed run; (2) read the failing step's log â€” if it's a tooling/setup error (e.g. action version, token perms), fix the workflow file; (3) if it actually reports a secret hit, treat as an incident. Nothing in Wave-4 is blocked on this; the wave was instructed not to chase it.

- **H3 â€” DISCOVERED (session 12): ten stale `worker.test.js` node processes have been running on this box
  since the H2 collision, ~9.5 hours.** H2's own step 1 said "kill any leftover `jest` node processes" and
  that half was never completed â€” H2 was closed on the git-history check alone. Measured directly from
  `Win32_Process` at 09:55 on 2026-08-19: two hung `jest tests/worker.test.js` process trees created at
  **00:22:22** and **00:29:55** (one of them the `--detectOpenHandles` variant), five processes each, ten
  in total. Those timestamps sit exactly inside the H2 window (the three colliding launches at 00:20/00:28/
  00:29), and the hang is the very defect session 3 root-caused: `worker.test.js` dialled a real ioredis
  connection at a fake host, so the run never exited. Nothing is blocked on this and no product code is
  implicated, but it is a standing background load on the machine every timing measurement in this wave is
  taken on â€” including W4-002's recorded "12 unrelated node processes" and every W4-D09 run. Steps for
  Daniel: (1) `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*worker.test.js*' } |
  Select-Object ProcessId, CreationDate, CommandLine` to confirm they are still the 00:22/00:29 pair;
  (2) `... | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`; (3) re-run `npm test` in `backend/`
  and expect the same 171/2073 green, only faster. Deliberately NOT killed by this session: H2 assigned
  local stray-process cleanup to Daniel, and killing processes is a destructive machine-level action nobody
  asked for mid-task. Worth stating plainly the other way round, though â€” the W4-D09 baseline was
  established **with** this load present, so cleaning it up can only improve the margins, never erode them.

  **RESOLVED 2026-08-19 (manual maintenance session).** **Four** stranded processes cleared, not ten - each of the two five-process trees had already decayed to two by cleanup time. Identity re-verified BEFORE killing rather than trusting the stale PID list: PIDs 27340/17640 created 00:22:22-23 and 24496/3244 created 00:29:55-56, ages 17.4-17.5 h, command lines `jest tests/worker.test.js --runInBand` and the `--detectOpenHandles` variant - i.e. exactly the 00:22/00:29 pair this row describes, with no PID recycling. Killed BY PID (`Stop-Process -Id 27340,17640,24496,3244 -Force`), never `-Name node`, which would have taken this session with it. Confirmed gone: node.exe count 14 -> 10 and a `wave4-doctor.ps1` re-run reports "no stale test processes found". Full backend suite re-run on the cleaned box: **184 suites / 2548 passed + 1 todo = 2549, exit 0, 184.7 s** - the recorded baseline exactly, so the cleanup changed no test outcome and the W4-D09 margins stand. The run still prints jest "Force exiting", i.e. the open-handle pressure W4-D06 addressed is the mechanism that stranded these in the first place.

- **H2 â€” RUN HALTED: three concurrent sessions on one working tree (BLOCKS THE WHOLE RUN).**
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
  3. Inspect the tree for half-written sibling work: `git status` â€” at halt time
     `docs/adr/0012-learning-compliance.md` was untracked-in-progress and
     `scripts/run-mission.ps1` + `docs/adr/README.md` were modified by a sibling session.
     Decide per file: keep (commit it) or discard. Note the ADR filename differs from the
     mission's specified `docs/adr/ADR-0012-learning-compliance.md` â€” pick ONE and delete the other.
  4. Add a single-instance guard to `scripts/run-mission.ps1` before relaunching, e.g. near the
     top: `$mtx = New-Object System.Threading.Mutex($false,'Global\KokonadaWave4'); if (-not $mtx.WaitOne(0)) { Write-Host '[wave4] another loop is already running - exiting'; exit 0 }`
     (a lockfile with the PID works too). Also give each launch its own prompt file
     (`session-prompt-<stamp>.txt`) instead of the shared `session-prompt.txt`.
  5. Delete `docs/plans/WAVE4_HALT`, set `phase: execute` in this file, and start **exactly one** loop.
  Blocked on this: the entire remaining queue. Nothing else is wrong â€” no product-code defect
  is implied by this halt.

  **RESOLVED 2026-08-19 (H2 closeout).** Verified directly against the live tree before
  reopening: `git log --oneline` on the branch shows a clean, non-conflicting history
  (`deed3c4` â†’ `2b3deec` â†’ `1a0e58b` â†’ `8d3e53e` â†’ `d1db088`, all five wave4 commits distinct,
  no merge conflicts, no force-pushes); `git status` shows only the known intentional item
  (`mobile/src/health/config.ts`, leave in place per S2) plus the in-flight `run-mission.ps1`
  fix below â€” no leftover untracked files from the collision. `d1db088` (the ADR + tripwire
  commit) only touched 3 new/append-only files and never touched `WAVE4_STATE.md` or
  `run-mission.ps1`, confirming the three sessions did not actually corrupt each other's work â€”
  the halt worked exactly as designed, it just needed a human-reviewed close. Fix landed:
  `run-mission.ps1` now takes a named mutex (`Global\KokonadaWave4Loop`) before touching the
  tree and refuses to run a second instance (self-heals from an abandoned mutex if a prior loop
  was killed without releasing it), closing the root cause. `docs/plans/WAVE4_HALT` removal and
  the Task-Manager stray-process check are Daniel's â€” bridge tooling can't safely delete a
  tracked file or touch Windows processes from here. Once both are done: resume with exactly
  one loop.

- **H6 - DECISION + COMPLIANCE REVIEW: the user-facing vocabulary for the ~34 taxonomy states (W4-006).**
  The taxonomy now carries an `explainTemplate` per state - the honest "why this mix" line behind
  S13's receipts. Those strings are INTERNAL: the suite pins that they contain no digit and none of
  a blacklist of clinical words (heart, hrv, panic, anxiety, diagnos, symptom, ...), and the state
  ids themselves are encrypted at rest and never reach a prompt or a log (mission R10). What is NOT
  settled is what a USER is shown. Three things need your call, and none of them is an agent's to
  make:
  1. **Whether to surface state names at all.** "Deep rest" is harmless; "acute stress",
     "overload needs downshift" and "mental fatigue" read as assessments of a person, and an app
     that tells somebody it thinks they are in acute stress is making a claim in a regulated
     neighbourhood even when the underlying maths is only ever steering a playlist.
  2. **If yes, the wording**, which needs a compliance-auditor pass against store health-claim
     policy before it ships (Apple and Google both treat wellness-adjacent copy differently from
     wellness-adjacent maths).
  3. **The safe default in the meantime**, which is what is implemented: show the explain line's
     TONE ("Slow and spacious, to stay out of the way of a body that has settled") and never the
     state id. Nothing is blocked on this - the seam half can ship with ids internal-only - but the
     decision wants making before any screen renders it.

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

## Discovered backlog (filled by reflection passes â€” Â§2.5)

> Work found DURING the run that was not in the original Â§3 queue. Same rigor as Â§3: every row needs class, tier, size,
> deps, a concrete DoD and a justification. Rules: `class: repair` outranks everything; original MUST-tier Â§3 tasks
> outrank `improve`/`extend` rows; max 5 new rows per reflection; an empty table is a good result, not a failure.

| id | class | title | tier | size | deps | status | found | DoD / justification |
|----|-------|-------|------|------|------|--------|-------|---------------------|
| W4-D01 | repair | Reflection close-out marker had no mechanical writer | MUST | S | â€” | **done** | session 5 | Fixed session 6 â€” see the W4-D01 evidence section below. **Premise corrected:** `ccecca3` was NOT a reflection run, it is the commit that AUTHORED Â§2.5 (its own STATE text says "no reflection has run yet"), so no R7 was ever skipped. The run-stopping defect is real but different: the marker was written by nothing except a session's voluntary compliance with R7, and `logs/` is gitignored, so any reflection that is killed/times out/forgets latches the trigger ON permanently. Now: one tested implementation (`scripts/wave4/reflect-marker.js`) + a loop backstop that stamps it after any REFLECT session. |
| W4-D02 | repair | Reflection pass clobbered the executing session's STATE row | SHOULD | S | â€” | **done** | session 5 | Fixed session 7 â€” see the W4-D02 evidence section below. `scripts/wave4/state-guard.js` + 36 pins + a `run-mission.ps1` backstop that re-checks STATE after EVERY session.  `ccecca3` reset W4-001 from `in_progress` (written by this session at `bd4a6bc`) back to `pending`, because it composed STATE from a read taken before that commit. No code was lost â€” but a concurrent reflection can silently erase queue truth. DoD: reflection sessions re-read STATE immediately before writing and never downgrade a row they did not set. |
| W4-D03 | improve | DEBUG log line carries a numeric heart rate | SHOULD | S | â€” | pending | session 5 | `biometricHandler` `log('[handleBiometric] immediate hr=${...}')` prints a raw vital. It is DEBUG-gated (`if (DEBUG) console.log`) so it is not a production leak, but Â§0.2.2 says no numeric vitals in logs at all. Pre-existing, untouched by W4-001 beyond one adjacent field. DoD: coarse band instead of the number. |
| W4-D04 | improve | Cold-start reflection semantics contradict the "first reflection due in 4h" note | SHOULD | S | â€” | **done** | session 6 | **Decided by reflection #1 (session 8), which its own DoD nominated as the decider.** Ruling: **Â§2 step 4 stands â€” a missing marker means DUE.** That is the fail-safe direction and the property W4-D01 was built to guarantee (`logs/` is gitignored and machine-local, so a marker that can vanish must never silently suppress reflections forever); seeding at run start would trade a permanent safety property for one short session per fresh run. The contradicting text needed no edit: it was the placeholder row `(none yet â€” first reflection due ~4h after 2026-08-19 01:00)` in `ccecca3`'s Discovered-backlog table, which no longer exists â€” the real W4-D01..D04 rows replaced it. Verified by grep: no "first reflection due" string survives anywhere in `docs/plans/` or `scripts/` outside this row's own quotation. Â§2 step 4, `reflect-marker.js` and STATE now agree. This reflection is itself the evidence that "missing â‡’ DUE" pays for itself on a resumed run â€” it caught W4-D05 and W4-D06. |
| W4-D05 | repair | D11's interim band trigger flaps at band boundaries â€” no dwell, no cooldown, no kill-switch | MUST | S | â€” | **done** | session 8 | Fixed session 9 â€” see the W4-D05 evidence section below. **Verified empirically this reflection, not inferred.** Bands cut at `resting <90 / active 90â€“119 / peak â‰¥120`; calling the REAL exported `biometricHandler._shouldRecalibrate`: `88â†’93` **true**, `93â†’88` **true**, `87â†’92` **true**, `92â†’87` **true**, `119â†’122` **true**, `122â†’119` **true**. The watch/immediate lane has NO debounce and `recalibrateForBand` has NO cooldown or dwell (only the `liveMode` gate), so an ordinary resting oscillation across the 90 cut re-serves the buffer on **every** 5-minute ping â€” where the retired Â±25 bpm gate produced **zero**. `HR_NOISE_FLOOR = 3` only suppresses â‰¤2 bpm jitter (the `119â†”121` case W4-001's evidence cites); real resting HR routinely varies 5â€“10 bpm, so the mitigation as sized does not cover the actual signal, and W4-001's evidence line overstates it. DoD: give the interim trigger a min-dwell/cooldown or asymmetric enter/exit band cuts so a sub-band oscillation yields â‰¤1 serve per dwell window; ship it behind the S11-reserved `WAVE4_RECAL_STATE_TRIGGER_DISABLED` restoring W4-001 behaviour without a revert; pin (a) 88â†”93 over N immediate-lane pings â‡’ â‰¤1 recalibration, (b) the existing 115â†’121 genuine crossing still fires, (c) flag set â‡’ W4-001 behaviour byte-for-byte. Justification: W4-009 specs the real fix ("min-dwell honored", "sub-band wiggle â†’ zero churn") but is SHOULD-tier behind the entire bio track (006â†005â†004â†003â†002), while PR #179 is open and mergeable **now** â€” so the interim is what reaches users. High likelihood (88â€“93 bpm is a commonplace range), and every flip changes the listener's music and burns a shadow-buffer serve. |
| W4-D06 | repair | Suite leaks 60 s debounce timers; `--forceExit` masks it and the W4-000 baseline claim no longer holds | MUST | S | â€” | **done** | session 8 | **Found by running the baseline claim rather than trusting it.** `npx jest --runInBand` (no `--forceExit`) prints *"Jest did not exit one second after the test run has completed"*, and `--detectOpenHandles` names exactly **2** leaked `setTimeout`s, both from `biometricHandler.js:1203`, armed at `wave4.bugfix.test.js:122` and `biometricHandler.pipeline.test.js:1841`. `npm test` is `jest --runInBand --forceExit` (pre-existing on main, untouched by this wave), which hides them â€” the suite is green and exits 0 either way, which is why nothing noticed. Consequence: **STATE's W4-000 baseline sentence "exit 0 without `--forceExit`, `--detectOpenHandles` silent" is no longer true** and must be re-recorded honestly. Real risk, not just hygiene: the leaked callback closes over a torn-down socket and fires `recalibrateForBand` against the module-global `debounceMap` up to 60 s later â€” i.e. *inside a later suite* of the 75 s `--runInBand` run â€” which is a cross-suite flake vector, and Â§0.4 S1a explicitly forbids a non-deterministic baseline. DoD: clear the timers in teardown (or drive them with fake timers) until `npx jest --runInBand --detectOpenHandles` is silent; add a standing guard so the rest of the wave â€” which adds workers, Redis blobs and BullMQ repeatables (W4-003/004/011/012) â€” cannot re-introduce a leak invisibly behind `--forceExit`; correct the baseline sentence. Justification: a flaky baseline during a 4-day autonomous run burns error budget on phantom failures and can trip `WAVE4_HALT`; this is the same bug class S1a required W4-000 to close, re-opened. Fixed session 10 â€” see the W4-D06 evidence section below. **Premise held and then some:** the two named timers were real, and the guard built to catch them found a THIRD handle `--detectOpenHandles` had filtered out. |
| W4-D07 | improve | The socket lane's adapter mock has different semantics from the real adapter | SHOULD | S | â€” | pending | session 9 | **Noticed in passing while building W4-D05's watch-lane pins â€” one line per Â§2, for the next reflection to triage.** `biometricHandler.pipeline.test.js:125` mocks `wearable/adapter.normalize` to return `{heartRate, activity, source}`, with NO `recordedAt`. The real `fromGarmin` returns `recordedAt: new Date(raw.startTimeLocal)`, and `isValidReading` REJECTS the reading when that date is unparseable â€” so a payload the suite happily accepts is refused by production. Verified directly: the real `normalize('garmin', {heartRate: 88})` â†’ Invalid Date â†’ `connection_error: Invalid biometric reading` (the rejection itself is correct and intended; the divergence is the point). Consequence: the normalizeâ†’isValidReading seam on the socket lane is never exercised, which is the "green mock for an integration boundary" Â§1 forbids. DoD: give the mock the real shape (or drop the mock and feed real payloads) and pin one case proving an unparseable provider timestamp is rejected end-to-end. Justification: low cost, and W4-003 is about to wire the anomaly filter into this exact seam and persist `recordedAt` to `BiometricLog`, where the divergence stops being cosmetic. |
| W4-D08 | repair | Batch ingest reports `inserted` rows that were silently dropped | SHOULD | S | â€” | **done** | session 11,13,15 | **REOPENED by reflection #2 (session 14): the fix crashes the lane it claims to have fixed.** `suunto.js:50` calls `insertManyAccounted(BiometricLog, docs)` and the file never requires it â€” `bfc5a85` added the call site and not the import (`git log -L 50,50` names that commit; the pre-`bfc5a85` version at `bfc5a85^` did `BiometricLog.insertMany(docs, {ordered:false})` and worked). Proven by EXECUTING the real production function, not by reading it: `handleWebhook('u1', '[{"hr":72,...}]', '')` â†’ **`ReferenceError: insertManyAccounted is not defined`**. Identifier resolution is unconditional, so a payload with **zero** HR samples throws too â€” every Suunto webhook now 500s where it previously succeeded. So W4-D08 turned a cosmetic over-count into a hard outage on that lane, and it is sitting in open PR #179. Why the green suite missed it: the only two files mentioning suunto (`integrations.test.js:72`, `integrationsController.test.js:39`) `jest.mock` the whole module, and `wave4.ingestAccounting.test.js` covers `insertManyAccounted`/`mergeRejected`/`persistMetrics` only â€” **zero** mentions of suunto or appleHealth. Both lanes W4-D08 edited beyond metricStore are unexecuted by any test. Blast radius bounded by measurement, not assumption: a scope analysis over all **147** files in `backend/app` + `backend/sim` (babel `ReferencedIdentifier` with no binding) reports **exactly one** undefined identifier repo-wide â€” this one. **Re-DoD:** (1) add the missing require; (2) pin `suunto.handleWebhook` AND `appleHealth.ingestBatch` with tests that execute the REAL function (not the module mock) â€” including the reject-accounting path, so the lanes stop being edited blind; (3) ship the standing regression guard per this run's precedent (W4-D01 marker, W4-D02 state-guard, W4-D06 open-handle guard) â€” see W4-D11, which is the guard for this class and should land in the same session. Original entry follows. **Noticed in passing while building W4-002 â€” one line per Â§2, for the next reflection to triage.** `metricStore.persistMetrics` returns `inserted: hrDocs.length` (the ATTEMPTED count) while `BiometricLog.insertMany({ ordered: false })` silently drops rows the schema rejects (heartRate capped at 300 â€” a x2 PPG artifact on a workout reading clears it easily) and does NOT reject the promise. Measured, not inferred: 10 samples submitted with one at 340 â†’ `persistMetrics` resolves `{inserted: 10}`, 9 rows in the collection, nothing logged. So `healthStore.ingestBatch` reports full success on a lossy write, and a backfill client reconciling on `inserted` believes data landed that did not. Pinned as CURRENT behaviour in `sim.replay.integration.test.js` ("MEASURED: one out-of-range sample is dropped silently") so the fix flips it loudly. DoD: count what Mongo actually inserted, and surface the rejects (count + reason) rather than dropping them. Fixed session 13 â€” see the W4-D08 evidence section below. **Premise held exactly as measured, and the scope was two lanes wider than the row knew:** `appleHealth.ingestBatch` and `suunto.handleWebhook` returned `ingested: docs.length` with the same hand-copied `insertMany(docs, { ordered:false })`, i.e. three copies of one defect, so the accounting became a single shared helper rather than a third hand-copy (the D11 one-definition rule). |
| W4-D09 | repair | Absolute wall-clock latency budgets make the suite baseline non-deterministic | MUST | S | â€” | **done** | session 11,12 | Fixed session 12 â€” see the W4-D09 evidence section below. **Premise held; two of its inferences did not, and the scope was one assertion wider than the row knew.** **Noticed in passing while gating W4-002 â€” one line per Â§2.** `shadow.flip.test.js:192` and `shadow.selection.test.js:196` assert `Date.now() - started < 300` inside the shared `--runInBand` process. Under ordinary memory pressure they land at 307â€“319 ms and fail; both pass in isolation. **Established by control, not by assumption:** with W4-002 suites removed the failure still occurs on two consecutive runs, in two different files. Â§0.4 S1a forbids a non-deterministic baseline outright, and this is the same bug CLASS as W4-D06 (suite hygiene that makes the baseline untrustworthy) on a new axis â€” it will burn error budget on phantom failures and can trip `WAVE4_HALT` via the 3-failed-session rule. DoD: make the budget robust (measure CPU work not wall clock, or assert a generous ceiling plus a recorded p50, or gate the strict budget behind an opt-in env like the soak) so a loaded machine cannot turn a correct build red; re-establish a genuinely green baseline afterwards.  **Evidence appended session 25 (not a reopen - the closure holds for what it claimed):** the min-of-N helper is robust to TRANSIENT scheduler jitter, which is what W4-D09 was about, but it is by construction NOT robust to SUSTAINED load, because under sustained load every sample is slow and the minimum is slow with them. Measured: with a second full jest suite running concurrently, `anomalyFilter-10k` reported min=204ms against a 200ms budget (p50=210, max=212, n=5) and the helper's own message asserted "this is a real regression, not scheduler noise" - which was false. It matters beyond a stray red: W4-015's soak is a deliberately long run, and the box will be under exactly this condition. A reflection should decide whether this warrants reopening W4-D09 or a new row; an execute session does not make that call. |
| W4-D10 | improve | The `healthBatch` SUCCESS log serialises numeric vitals | SHOULD | S | â€” | pending | session 13 | **Noticed in passing while adding `rejected=` to that very line â€” one line per Â§2, for the next reflection to triage.** `integrationsController` logs `[healthBatch] ok accepted=.. inserted=.. profileMetrics=${JSON.stringify(result.profileMetrics)}` on EVERY successful batch, and `profileMetrics` is the aggregated scalars â€” `restingHeartRate`, `hrv`, sleep-stage minutes. So a production success path writes special-category numbers to stdout unconditionally. This is a strictly wider hole than W4-D03, which is the same class but DEBUG-gated (`if (DEBUG)`), and Â§0.2.2 admits no numeric vital in any log. Pre-existing and untouched by this task: the field added here (`rejected=<count>`) is a count, pinned value-free. DoD: log the KEYS present and their count (or coarse bands), never the values, and pin it the way `wave4.ingestAccounting.test.js` pins the `[insertAccounted]` line. |
| W4-D12 | improve | Â§M.4's k constants assume `n` = samples; the baseline engine counts days | SHOULD | S | 004 | **done** | session 18 | **CLOSED BY RULING â€” reflection #3 (session 19), the reviewer this row's own DoD nominated. The deviation is CORRECT and stays.** Checked algebraically, not read: `fuse()` gives source *s* precision `w_s = n_sÂ·reliability/Ïƒ_sÂ²` and the prior `wâ‚€ = k/Ïƒ_bÂ²`, so the posterior mean is `(nÂ·xÌ„ + kÂ·(Ïƒ_wÂ²/Ïƒ_bÂ²)Â·Î¼â‚€)/(n + kÂ·Ïƒ_wÂ²/Ïƒ_bÂ²)` â€” which equals the exact normal-normal shrinkage weight `n/(n + Ïƒ_wÂ²/Ïƒ_bÂ²)` **iff k = 1**. `PRIOR_OBSERVATIONS = 1` is therefore the derivation, not a taste. The unit hazard the row worried about was checked too and is clean: `_sourceScale()` multiplies BOTH the observed MAD and `POPULATION[m].spread` by `MAD_SCALE`, so Ïƒ_w reaches `fuse()` as an SD matching `scale`'s SD â€” no 1.4826Â² error in the variance ratio. Numerically, the athlete case the row cited: Ïƒ_w=8Â·1.4826=11.86, Ïƒ_b=25 â‡’ Ïƒ_wÂ²/Ïƒ_bÂ²=0.225 â‡’ after 30 days the estimate is 84.7 ms (vs 85 truth), where literal k=15 gives 71.7 ms. **One honest caveat recorded rather than smoothed over:** the code comment says Â§M.4's k values are used verbatim "where the count unit is the one Â§M.4 assumes", but `estimateRestingHeartRate`'s SPREAD `shrink()` also passes `n` in DAYS (k=20). The consequence is conservative in the safe direction â€” it holds the reported MAD slightly WIDE, which under-detects stress rather than saturating it (D3's failure mode is the opposite and far worse), and `MIN_SPREAD` floors the other end â€” so it is a comment nit, not a defect, and is deliberately NOT queued. Â§M.4 in the mission now carries the one-line unit note this DoD required. Original entry follows. **Noticed while implementing W4-004 â€” one line per Â§2, for the next reflection to triage.** `baselineEngine` collapses each local day to one observation (samples inside a day are ~perfectly correlated), so `n` means DAYS. Â§M.4's k = 20/15/10 were written for a sample count, and at day scale they shrink a real 85 ms athlete HRV to 71.7 after a full month. The central estimates therefore use a variance-derived prior weight (k = 1 in `fuse()`, from `n/(n + Ïƒ_wÂ²/Ïƒ_bÂ²)`), while Â§M.4's k values remain verbatim in `shrink()` where the unit matches. DoD: a reviewer confirms the derivation and the two POPULATION spreads (`scale` between-person, `spread` within-person) against the numbers, or rules the deviation back out; either way the mission's Â§M.4 gets a one-line note so W4-005/012 do not re-litigate it. Justification: every later engine (affect axes, CUSUM, fatigue) reads these baselines, so a wrong shrinkage constant is wrong everywhere downstream. |
| W4-D11 | improve | No linter exists, so `lint clean` in the DoD has never been a control | SHOULD | S | â€” | **done** | session 14,15 | **Found by reflection #2 while root-causing W4-D08's reopen.** Â§2 step 7 requires "lint clean" for every task, and there is **no linter in this repo at all**: no eslint config at root or in `backend/`, no `eslint` in `backend/node_modules/.bin`, no `lint` script in `backend/package.json` (scripts are `start`/`worker`/`dev`/`test`/`test:handles`), and no root `package.json`. W4-002's evidence already recorded the line as "vacuous â€” recorded, not claimed"; this reflection upgrades that from a footnote to a task, because the interval produced the exact defect the missing rule catches. A single `no-undef` run over `backend/app` found `suunto.js:50` in **one second** â€” a live production crash that a green 172-suite run, a resilience-minded author and an open PR all missed. The remaining queue (W4-003â€¦W4-015) adds thousands of lines of new engine code across new directories, so the marginal value is highest now and falls every session. DoD: add `eslint` as a devDep with a minimal flat config for CommonJS/node; enable at least `no-undef` and `no-unused-vars` (unused vars as `warn` to avoid a mass-rewrite of pre-existing code); add `npm run lint`; get `backend/app` + `backend/sim` clean; record the pre-existing-violation count honestly in STATE rather than mass-fixing unrelated files in this task. Justification: turns a DoD line every session has been reporting as satisfied into a real gate, at S cost. Pairs with the W4-D08 repair â€” same session, same theme (the guard belongs with the bug that proved it was needed). |
| W4-D13 | repair | S5's fifth surface was never written: `VitalSample` is absent from the retention-windows documentation | MUST | S | â€” | **done** | session 19,20 | **Found by reflection #3 by checking S5's list surface-by-surface instead of accepting the model's own header.** Â§0.4 S5 names FIVE registration surfaces and requires them "in the SAME PR that introduces it". W4-004 landed four of them correctly and verifiably â€” `erasure.js:39`, `gdpr-delete.js:120`, `userDataExport.js:29`, `wearableErasure.js:31` (`userRedisPurge` is legitimately N/A: this is a Mongo collection, not a Redis key family) â€” and the guard behind them is genuinely load-bearing (stub-out this pass: deleting `{ model: VitalSample }` from the export list turned **4 pins RED across 2 suites**, then restored). The FIFTH, "the retention-windows documentation", was counted as satisfied by an in-code comment at `models/VitalSample.js:125-132`; the repo's actual retention-windows document is `docs/PRIVACY_DECLARATIONS.md`, and `VitalSample` appears nowhere in it. Two concrete staleness points, both measured: (1) the `## Retention` table (line ~85) lists `BiometricLog` 90 d / `ServeEvent` 90 d / `ConsentRecord` but has no row for the new 90-day TTL (`VITAL_SAMPLE_RETENTION_DAYS`, `expireAfterSeconds` on `recordedAt`); (2) the **Play data-safety** deletion answer (line ~122) enumerates the cascade as nine collections â€” BiometricLog, MedicalProfile, MusicProfile, PlaylistSession, ServeEvent, Identity, RefreshToken, UnclassifiedTrack, ConsentRecord â€” while `eraseUserChildData` now deletes **ten**, and its `<!-- verified: ... erasure.js:33-49 -->` provenance comment points at shifted lines. **DoD:** (a) add the `VitalSample` row to the Retention table with its env var and mechanism; (b) add it to the line-122 cascade list and refresh that verification comment; (c) state explicitly that the metric vocabulary is a consent-v2-ready SUPERSET and that `spO2`/`respirationRate` have **no writer** today, so the standing "SpOâ‚‚ and respiratory rate are NOT collected" declaration at line ~44 stays true and a future reader grepping the schema is not misled; (d) ship the standing guard this run keeps proving is the right move (W4-D01 marker, W4-D02 state-guard, W4-D06 open-handle, W4-D11 lint): a test asserting every TTL-indexed user-scoped model is named in the retention table, so the DOC surface stops being the one nobody can fail. **Scoping note so the next session is not torn between two rules:** the cleanest discharge is INSIDE W4-004's wiring commit on the still-open PR #179 â€” that is literally what S5's "same PR" asks, and it avoids interrupting an `in_progress` L task for a docs edit. Taking it standalone first is also fine; it is S-sized. **Fixed session 20** (commit `143632d`, inside W4-004's wiring PR exactly as this row's scoping note asked). All four DoD items discharged: (a) the `VitalSample` row is in the Retention table with `recordedAt` and `VITAL_SAMPLE_RETENTION_DAYS`; (b) the Play cascade list now names ten collections and the provenance comment points at `erasure.js:34-53`; (c) a blockquote states the metric enum is a consent-v2-ready SUPERSET with no writer for `spO2`/`respirationRate`, so the line-44 declaration stays true; (d) the standing guard is `tests/wave4.retentionDocs.test.js` (7 pins). **Load-bearing, verified by stub-out, not asserted:** deleting the VitalSample retention row turns **3 pins RED**, and adding `spO2` to `VITAL_METRICS_PERSISTED` turns **4 pins RED** across 2 suites â€” both restored. The guard discovers TTL-indexed user-scoped models from the filesystem (4 today) and parses the real `eraseUserChildData` body, so it cannot go vacuous by omission. **Severity, stated honestly:** no live data leak and no erasure gap â€” the CODE is complete and correct, the collection is still empty, and nothing writes `spO2`/`respirationRate`. What is wrong is a store-facing compliance declaration that no longer matches the code, which is exactly the bug class S5 exists to prevent and exactly the kind of surface `compliance-auditor` gates before submission. |
| W4-D14 | repair | Flaky digit-substring oracle: a 2-digit needle asserted against random ciphertext | MUST | S | - | **done** | manual maintenance session | Fixed 2026-08-19 (commit `954a230`) in an out-of-band manual session, not a queue task. `wave4.baselineWiring.test.js:326` asserted ``expect(blob).not.toMatch(/52/)`` where `blob` is the base64 AES-GCM ciphertext `cacheBaselines` writes to Redis - 112 chars over a 64-char alphabet with a fresh random IV per call, so "52" occurs by chance across its ~111 adjacent pairs. **Measured on the real encrypt path, not inferred: 5389 / 200000 encryptions of the exact payload contain "52" = 2.695%, ~1 run in 37** - which is what turned PR #179 Backend lint & test red on blob `...tPSOBk529juuP1IaO/TzMdHh`. The encryption was correct; the ORACLE was unsound. The fix preserves the intent and strengthens it: assert the plaintext FIELD NAME is absent (``not.toContain("rhrMedian")`` - 0 / 200000 collisions, p ~ 6e-15), leaving the round-trip ``decrypt(blob, true, "u1").rhrMedian === 52`` untouched as the half that proves the blob really is encrypted and does round-trip. **Same bug CLASS as W4-D09 - non-deterministic assertions making the baseline untrustworthy - on a new axis:** W4-D09 was wall-clock non-determinism, this is cryptographic-randomness non-determinism; both burn error budget on phantom failures and can trip `WAVE4_HALT` via the 3-failed-session rule, which is exactly why S1a forbids banking a non-deterministic baseline. **Repo-wide sibling sweep found NO other instance**, checked by HAYSTACK rather than by pattern: every other ``not.toMatch(/<digits>/)`` / ``not.toContain("<digits>")`` in the tree asserts against a DETERMINISTIC string (plaintext DTOs, reject reports, warn lines, telemetry) or is already defended - `baselines.test.js:181` documents this identical flake and replaced it with an opaque-base64 regex, `biometricAudit.test.js` freezes the clock precisely because "millis could otherwise collide with 72/58", `shadow.mobile.test.ts` uses a deterministic `"e:"+base64` test cipher, and the `vitalSample.integration.test.js` needle `"62.5"` cannot occur in base64 at all because `.` is outside the alphabet. Full backend suite green after the change (**184 suites / 2548 passed + 1 todo = 2549, exit 0, 184.7 s**) and PR #179 all checks green including Backend lint & test (1m34s). |
| W4-D15 | repair | `translate._robustZ` anchors an explicitly-null baseline median at ZERO, saturating stress for every no-baseline user | MUST | S | - | **done** | session 23 | **Found by executing the serving path, not by reading it.** `translate.js:59` defines `finite = (x) => Number.isFinite(Number(x)) ? Number(x) : null`, and `Number(null) === 0`, so `finite(null)` returns **0, not null**. `_robustZ` (`:62`) therefore computes `m = finite(median) ?? fallback?.median` as **0** whenever the median is an explicit `null` - the `??` fallback can never fire - and `restingElevation` (`:114`) passes `fallback = null`, so a null `rhrMedian` scores the user against a resting heart rate of **zero bpm**. Measured on the real `translate()`: `{rhrMedian: null, rhrMAD: null}` + `{heartRate: 70, activity: "resting"}` -> **stress = 1.0**, bpmWidth 20 -> **8**, acousticnessBias 0 -> **0.3**, instrumentalBias 0 -> **0.2**, valenceTarget **0.6**; the SAME input with the key merely ABSENT -> stress **0.2**. At `heartRate: 55` it is still **1.0**: any HR above ~18 bpm saturates, because z = (HR - 0)/(1.4826*3). That is D3's exact target profile (narrow, acoustic, instrumental, forced-cheerful) delivered to a calm user, i.e. the regulator-not-mirror violation D4 was fixed to stop. **Why it matters NOW even though the coercion is pre-existing:** W4-004's wiring makes `computeBaselines` return `rhrMedian: null` DELIBERATELY and routinely, and its own comment (`baselines.js:207-217`) states the premise that "a null baseline makes the resting-elevation stress term ABSTAIN rather than score the user against a stranger's physiology". **That premise is false** - it does not abstain, and scoring against 0 bpm is far worse than scoring against a stranger. The affected population also CHANGED direction: legacy nulled only below MIN_SAMPLES=10 rows (counting `unknown`, so almost nobody), while the engine nulls whenever it finds zero non-exercise observations - e.g. a user whose 30-day history is all workouts. **The pin that should have caught it is vacuous:** `shadow.qa4.biometric.test.js:123` is literally named *"median = null with a MAD present (the Number(null)===0 gotcha) yields no score, not a 0-anchored one"*, but its whole body is `assertTargetsSane(...)`, which only checks finiteness and range - never that the term abstained. Executed: that test's own case yields **stress = 0.584** vs **0.169** with the key absent, so the score IS 0-anchored and the test passes anyway. **DoD:** (a) make `finite()` reject `null`/`""` (`x == null || x === "" -> null`) or have `_robustZ` test `median == null` explicitly, so the fallback fires; (b) decide and encode what a null median MUST mean for `restingElevation` - abstain (return null) is the behaviour `baselines.js` already documents and D3 wants; (c) replace the vacuous assertion with one that pins the abstention (`state.stress` equals the key-absent value), and sweep `assertTargetsSane`-only tests whose NAME claims a behaviour their body does not check; (d) repair the false comment in `baselines.js`; (e) decide the same question for `hrvMedian`/`hrvMAD`, which the wrapper does NOT null even though it nulls the RHR pair - today the engine's zero-evidence HRV prior happens to equal `HRV_FALLBACK` {45,8} exactly, so it is numerically a no-op, but nothing pins that coincidence and a change to `POPULATION.hrv` would silently move everyone's scoring. **Justification:** this is a live serving-path defect on the branch, it fires for the cold-start user forming a first impression, it re-creates the exact stress saturation this wave exists to kill, and the guard that was written for it does not guard. **Fixed session 24 (commit below). All five DoD items discharged, and the (c) sweep uncovered a SIBLING defect that was folded in rather than queued.** The root cause was one line, and it was never only about `restingElevation`: `finite()` is `translate`'s single numeric guard, so `Number(null)===0` corrupted SIX inputs, every one of them in the alarming direction. Measured on the real `translate()` before the fix, each against the same call with the key merely ABSENT: `rhrMedian:null` -> stress **1.0** vs 0.2; `state.hrv:null` -> recovery **0** and stress **1.0** vs 0.6/0.2; `bodyBattery:null` -> recovery **0**; `dailyReadiness:null` -> recovery **0**; `sleep.lastNight` all-null stages -> recovery **0** (a sleepless night claimed from no data); `heartRate:null` -> a pulse of 0 bpm that still produced a *measured* resting-elevation score of zero. `bodyBattery:''` behaves identically, so the same hole existed for empty-string payload fields. Confidence was corrupted too: the D14 group test read `finite(rhrMedian) != null`, so a null baseline counted as a KNOWN one - conf **0.65 / bpmWidth 8** for a user we know nothing about, against 0.48 / 20 for the same user with the keys absent. **(a)** `finite()` now accepts a value only if it is a finite number or a non-blank numeric string - null, undefined, '', whitespace, booleans, arrays and objects all abstain; adopted VERBATIM from `baselineEngine.js` and `chronobiology.js`, which have carried this exact guard (and a comment naming this exact trap) since W4-004 - translate was the one copy on the serving path that never got it. **(b)** Encoded as an explicit contract on `_robustZ`: `fallback` IS the abstention decision - pass a population prior to score a stranger against the population (the HRV term), pass null to produce no score at all (the resting-elevation term). **(c)** The vacuous pin is replaced by the differential claim its own title made (`stress` equals the key-absent value), and the `assertTargetsSane`-only sweep found **two more** over-claiming titles in the same file, both of which turned RED the moment they were made to check what they said: (i) *'negative and sub-epsilon MAD are treated as fallback spread'* - **false**, and this is the sibling defect: `rhrMAD: 1e-12` gave **recovery 0, stress 1.0**, because the guard asked only whether the spread was `> 0`. Same saturation as the null median, one argument over. `baselineEngine` has floored its own output at `MIN_SPREAD = 1.5` since W4-004 *for this exact reason* (its comment names D3), and floors it on EVERY metric (:478, :550, :626) - so importing that constant rather than copying it means the new floor can never reject an engine-produced baseline; it only catches degenerate values from pre-W4-004 cache blobs, hand-built callers and the legacy path. Folded in rather than queued because it is the same theme (a degenerate baseline must abstain, never saturate), in the same function, in a `class: repair` task. (ii) the wind-down `it.each` carried an EXPECTED-fold column its body ignored entirely, and two of its nine rows were fiction: `-1` and `24` were declared fold 1 and measure 0.8 (`-1 < 5` and `24 >= 21`). The code's behaviour is defensible (-1 reads as 23:00, 24 as midnight, both night) so the TABLE was corrected to measured reality rather than the serving path changed to match a column nobody had ever verified; the binary step itself is D13, which W4-004's cosinor replaces. **(d)** The false comment in `baselines.js:203-206` now says plainly that its own premise was untrue when written and is true now. **(e)** Ruled: the HRV pair is nulled on ZERO HRV evidence, exactly as the RHR pair is, gated on `coverage.hrvDays` and NOT on the RHR `sampleCount` - the two are independent (a user can have months of heart rate and no HRV, and a shared gate would have discarded real data; pinned, and proven load-bearing by stubbing the gate to `hasPersonalEvidence`, which turns 2 pins RED). It is numerically free today because `HRV_FALLBACK {45,8}` equals `POPULATION.hrv {value:45, spread:8}` exactly - an unpinned coincidence until now, so a change to `POPULATION.hrv` would silently have moved every user's HRV scoring while every test stayed green. What DOES change is honesty: the confidence ladder stops counting a stranger as a known user, and W4-005's affect engine HRV axis abstains (`robustZ` returns null on a null centre) instead of scoring against a laundered prior. **S11:** the whole repair ships behind `WAVE4_BASELINE_ABSTENTION_DISABLED` (both halves - coercion and floor - since they are one behaviour to an operator), read per call so no restart is needed. **Load-bearing, verified by stub-out, not asserted:** flag ON turns **24 pins RED across 2 suites** (which simultaneously proves the hatch is real and not decorative); the MIN_SPREAD floor alone turns **6** RED; the HRV gate turns **1** RED, and **2** when stubbed to the shared flag. **+40 pins** (new suite `wave4.nullBaseline.test.js` 38, `wave4.baselineWiring.test.js` 26 -> 28), **one deliberate re-pin** (the D1-no-data test, see the baselineWiring re-pin note in that file) and three strengthened bodies in `shadow.qa4.biometric.test.js` with no count change. Suite **185/2589 green twice**. Zero-knowledge: the diff adds no log line and no DTO field at all. **Protocol deviation, recorded rather than glossed:** this session executed before writing the S2 step-6 `in_progress` checkpoint, so a crash mid-task would have left no STATE trace; the task was S-sized and finished in one session, but the deviation is real. |
| W4-D16 | improve | `state-guard.js` cannot tell an R1.5 archival from a stale rewrite, so R1.5 is unexecutable as written | SHOULD | S | - | pending | session 23 | **Found by doing the R1.5 housekeeping this reflection owed and watching the guard refuse it.** S2.5 R1.5 instructs a reflection past 150KB to move `Discovered backlog` rows with status `done`/`closed` verbatim into `WAVE4_ARCHIVE.md` and DELETE them from STATE. S2 step 6 requires every STATE write to end with `node scripts/wave4/state-guard.js check`, which "exits non-zero if the edit regressed a task row down the status ladder or dropped one entirely". Executed both: archiving the 11 closed rows produced `FAILED 11 STATE row regression(s)` naming W4-D01/D02/D04/D05/D06/D08/D09/D11/D12/D13/D14 as "removed - a stale rewrite dropped the row". The two rules are in direct contradiction, and the guard is the one that is right to be strict, so **this reflection archived only the 12 evidence sections and reflection entries #1-#2 (204,535 -> 104,115 bytes, comfortably under the threshold) and left every backlog row in place**, recording the conflict here rather than working around a guard built precisely to stop STATE from being silently rewritten. **DoD:** teach `state-guard.js` an archival-aware mode - a row that is absent from STATE but present verbatim under a dated heading in `docs/plans/WAVE4_ARCHIVE.md` counts as present, not dropped (the `REOPENED`-token precedent: let the edit declare itself) - and pin it with a test that a genuine drop still fails while an archival passes; then correct R1.5 in the mission if the ruling goes the other way. **Justification:** cheap, and it removes a standing contradiction that will make every future reflection choose between two binding rules; the file will cross 150KB again as W4-006..015 land. |
| W4-D17 | improve | The discovery lane carries the same `Number(null)===0` coercion translate just shed | SHOULD | S | - | pending | session 24 | **Noticed in passing while fixing W4-D15 - one line per S2, for the next reflection to triage; deliberately NOT fixed here, because W4-D15 is scoped to the vitals path and this is a different subsystem.** `discoveryFetch.js:6` `const num = (v) => Number.isFinite(Number(v)) ? Number(v) : undefined` and `discoveryVectorService.js:13-14` (`num`, `fin`) are the same guard translate.js had. Measured, not inferred: `num(null) === 0` and `fin(null) === true`. The plausible bite is at `discoveryFetch.js:31`, `bpm: num(aiParams.target_bpm) ?? num(aiParams.bpmCenter)` - an LLM emitting `"target_bpm": null` yields 0, and `0 ?? x` is 0, so the `bpmCenter` fallback can never fire and the discovery query centres on 0 bpm. Not yet traced end-to-end to a live null producer, which is exactly what triage is for. DoD: establish whether nulls actually reach these helpers; if so adopt the same guard (the one-definition question is worth asking - there are now four copies of the fixed version and at least three of the broken one). |
| W4-D18 | improve | The affect engine drops the cosinor's PHASE, so morning and evening are the same number | SHOULD | M | 005 | pending | session 25 | `chronobiology.circadianAlertness` already returns `{alertness, windDown, phase, swing}`; `affectEngine.alertnessAxis` keeps only `alertness`. A cosinor is symmetric about its acrophase, so the RISING limb of the morning and the FALLING limb of the evening produce an identical axis value, and the taxonomy cannot express "late AND alert" or "early AND flat" at all. Measured consequence in W4-006: `morning-sluggish` vs `pre-sleep` and `morning-activation` vs `night-owl-alert` are separable only through fatigue and arousal, and **`morning-sluggish` had to give up its `gentle-lift` archetype for a flat one** - lifting somebody at bedtime because the model mistook it for morning is a real harm, so the taxonomy declines to push what it cannot locate. DoD: carry a signed phase term (or a `rising`/`falling` flag) as an eighth axis or as a modifier on the existing one; re-separate the four states above; `morning-sluggish` gets its lift back with the confusability guard still green. Justification: it is the difference between a clock the engine can read and one it can only measure the brightness of, and two of the six taxonomy domains lean on it. |
| W4-D19 | improve | Every affect axis is confined to a strict sub-interval of [0,1], and `fatigue` tops out at 0.482 | SHOULD | S | 005 | pending | session 25 | Measured over 5,843,675 evidence vectors through the real `computeAxes` (table in the W4-006 evidence section): `blend()` fuses each axis with NEUTRAL at `AXIS_PRIOR_MASS`, so an axis whose mass tops out at m cannot leave `[(1-m)*neutral, m + (1-m)*neutral]`. `fatigue` is the extreme case - **fourteen consecutive nights at 5% of need still only reach 0.482**, because `FATIGUE_WEIGHTS.debt` caps its mass - so the axis can never say "severely fatigued" in absolute terms, only "as fatigued as this axis gets". W4-006 works around it by authoring in normalised units over the measured envelope, which is correct for the taxonomy but does NOT help any other consumer: anything that compares an axis to an absolute threshold (a future rule, a dashboard, a W4-012 readiness cut) will systematically under-read, and fatigue worst of all. DoD: decide deliberately whether the axes are meant to be calibrated (mass-corrected so 1.0 is attainable) or deliberately shrunk, document the ruling next to `blend`, and either rescale or publish the envelope as an engine constant so consumers read it rather than rediscover it. Justification: cheap, and it prevents the same finding being re-derived by every later consumer of the axes. |


## Reflection log (one entry per Â§2.5 pass)

| # | at | interval covered | suite | verified / reopened / queued | headline |
|---|----|------------------|-------|------------------------------|----------|
| 3 | 2026-08-19 (session 19, `exec`) | `962acb2` â†’ `9ba207e` â€” 19 commits; tasks W4-D08 (reopen), W4-D11, W4-003 (wiring), W4-004 (pure core) | **179 suites / 2357 tests (2356 passed + 1 todo), exit 0, 191.7 s** â€” exactly the recorded baseline; lint 0 errors / 22 warnings | **4 verified / 0 reopened / 1 queued** (+ W4-D12 closed by ruling) | The code is in good shape â€” the interval's four claims all held under execution and stub-out, including the reopened Suunto lane, which now runs and reports truthfully. The one thing that did not hold is a *paper* surface: S5 names five registration places for a new collection and W4-004 wrote four, counting an in-code comment as "the retention-windows documentation" while the real one (`docs/PRIVACY_DECLARATIONS.md`) still describes a nine-collection erasure cascade the code outgrew (W4-D13) |
| 4 | 2026-08-19 (session 23, `exec`) | `60b8a4d` -> `ae3937a` - 16 commits; tasks W4-004 (wiring), W4-D13, W4-005, W4-D14, W4-016 added, W4-006 started | **184 suites / 2549 tests (2548 passed + 1 todo), exit 0, 209.5 s** - exactly the recorded baseline; PR #179 all GitHub checks green | **4 verified / 0 reopened / 2 queued** | The interval's claims all held, and the defect is in code none of them touched: `translate._robustZ` anchors an explicitly-null baseline median at ZERO, so W4-004's deliberate cold-start `rhrMedian: null` saturates stress to 1.0 for every resting reading - and the test named for that exact gotcha only asserts structural sanity |

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


## PR queue

| PR | cluster(s) | url | status |
|----|-----------|-----|--------|
| #179 | W4-000, W4-001, W4-D01/D02/D05/D06, W4-002, W4-D09, W4-D08 (+reopen), W4-D11, W4-003, W4-004, W4-D13, W4-005, W4-D15, W4-006 (pure core) | https://github.com/DanielMalede/Kokonada/pull/179 | open â€” RUNNING PR for the whole branch. **Session 26: W4-006 is now COMPLETE (both halves) and this is the first cluster on the branch that a listener could actually hear.** The affect engine, the 34-state taxonomy and the wellbeing regulator had no caller until this commit; `buildTargets` now peeks the carried HMM posterior, advances it against the live reading, and wraps `translate()`'s output with the regulator, so a strained listener's target is measurably tightened and carries an iso-principle arc. +87 pins across 4 new suites +6 appended, two deliberate re-pins (both documented), suite **192/2749** green twice. **Four things worth your eye at review time.** (1) The seam is READ-UPDATE-WRITE rather than the pure peek the mission's wording also permits - chosen by measurement: the nightly worker has no live heart rate, so its axes abstain and its confidence lands under the regulator's own floor, which would have made the whole seam a no-op that reported success. (2) The taxonomy id is stored ALONGSIDE the legacy `status`, never instead of it, because `pulseController` serves that field to you and switching its vocabulary would have settled HITL **H6** by accident. (3) D13's serving-path half landed: hour-of-day is now the user's own, and the unknown-offset fallback is the SERVER's offset rather than UTC zero - the difference is a silent shift of every existing user's wind-down window, and a stub-out pins it. (4) S13's why-lines are gated on the axes each sentence CLAIMS, so the app stays silent rather than telling somebody something it had no way to know. Also of note: one guard proved unfalsifiable under stub-out and was deleted rather than banked, and one of this session's own tests was caught passing for the wrong reason on a UTC+3 box. **Session 25: W4-006's PURE CORE landed** - the ~34-state taxonomy and the wellbeing regulator, +67 pins across 3 new suites with ZERO re-pins, suite 188/2656 green twice. Nothing reaches a serving path yet (the seam is the follow-up session), so the `targets` object is byte-identical for every existing consumer and this cluster is not user-visible. Two things are worth your eye at review time: the taxonomy's widths are SOLVED from per-axis roles against a fixed precision budget rather than authored, so no state can out-score another by claiming harder; and the regions are authored in normalised units over an envelope MEASURED across 5.8M evidence vectors, because eight states were unreachable in raw units and would have shipped silent. Also of note: the stub-out battery caught one of this session's own tests passing for the wrong reason, and it has been rewritten. **Session 21: W4-005 landed COMPLETE in one session (no wiring half exists â€” W4-006 owns the seam).** The affect engine + ADR-0013; 133 new pins across 2 suites, ZERO re-pins; suite 184/2549 green twice; 20 mechanisms verified load-bearing by stub-out, two of which were unfalsifiable until fixed. Nothing reaches the serving path yet, so the `targets` object is byte-identical and no kill-switch is owed here (W4-006 owes one). **Session 20: W4-004 is now COMPLETE (both halves) and W4-D13 is discharged in the same PR, which is exactly what S5's "same PR" wording asks.** D1 reaches the serving path; suite 182/2416 green twice; six deliberate re-pins listed in the W4-004 wiring evidence section and appended to the PR body. Branch pushed. **Session 18: W4-004's pure core (VitalSample + S5 + both engines) appended to the PR body; the task stays in_progress until its wiring half lands.** Session 17: W4-003 is now COMPLETE (both halves) and its cluster summary is appended to the PR body â€” filter wiring + D10 persistence + S6 gate + S11 kill-switch, suite 176/2213 green twice, deliberate re-pins listed in the body and in this file's W4-003 wiring evidence section. Branch pushed (`80db9ed`). Merging remains Daniel's click alone. **Session 24: W4-D15 (`class: repair`) closed** - the `Number(null)===0` coercion in `translate`'s numeric guard, which turned every no-baseline user into a maximally stressed one on the live serving path. Root fix is one helper, adopted verbatim from the two W4-004 engines that already carried it; the blast radius was six inputs plus the confidence ladder, all measured before and after. Ships behind `WAVE4_BASELINE_ABSTENTION_DISABLED`. +40 pins, one deliberate re-pin (documented in the file and in STATE), suite 185/2589. This one is worth Daniel's eye at review time because it is a genuine user-visible behaviour change on the branch, in the good direction: cold-start and workout-only users stop being served the narrow/acoustic/instrumental/forced-cheerful D3 profile while calm. |

> Choice recorded per Â§1: ONE running PR for `feat/intelligence-wave`, updated per cluster, rather than a PR per
> cluster off a single branch (which would stack noisy, overlapping diffs). Later clusters append to #179's body.
> Never merged by an agent â€” Daniel's click only.

## Error budget

- consecutiveFailedSessions: 0
- perTaskFailures: (none)

## Session log (append one line per session)

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
| 18 | 2026-08-19 (exec) | WAVE4_SESSION_RESULT: W4-004 in_progress â€” pure core + storage landed (VitalSample with full S5 registration and an EXTENDED completeness guard, baselineEngine, chronobiology), 136 new pins + 7 appended, suite 179/2357 green twice; four defects found in this session's own code by its own tests (Mongoose-9 pre-hook signature, `Number(null)===0` in both engines, non-robust cosinor LSQ, an unfalsifiable shift-worker test); Â§M.4 k-constant deviation derived and flagged as W4-D12; wiring half owed |
| 19 | 2026-08-19 (exec) | WAVE4_SESSION_RESULT: REFLECT done 4 verified, 0 reopened, 1 queued â€” suite 179/2357 green (exact baseline), lint 0 errors; W4-D08's reopened Suunto lane verified by executing the real webhook (resolves with truthful reject accounting), W4-D11's linter verified load-bearing by probe (1 eslint error + 3 guard pins RED), W4-004's export registration verified load-bearing by stub-out (4 pins RED across 2 suites); W4-D13 queued â€” S5 names five registration surfaces and W4-004 wrote four, leaving `VitalSample` out of `docs/PRIVACY_DECLARATIONS.md` while the Play data-safety answer still lists a nine-collection cascade the code outgrew; W4-D12 closed by ruling (k=1 is the variance decomposition, MADâ†’SD conversion verified consistent), mission Â§M.4 amended with the unit note |
| 20 | 2026-08-19 (exec) | WAVE4_SESSION_RESULT: W4-004 done â€” wiring half landed (baselines delegate to the engine so D1 finally reaches the serving path, superset blob, stale-while-revalidate, VitalSample writes, tzOffsetMinutes on all five ingest paths, D16 + steps dormant behind a consent-v2 flag, Karvonen zones via doc.save(), WAVE4_BASELINE_ENGINE_DISABLED kill-switch); W4-D13 discharged in the same PR with a standing retention-doc guard; 58 new pins + 1, suite 182/2416 green twice; six deliberate re-pins, all documented; two defects found in this session's own code by its own tests (a suite silently exercising the swallowed-failure path, and a "best-effort" worker call that was not); ATTACK-2 caught a real regression â€” the engine's population prior would have replaced translate's abstain-when-unknown, so the legacy keys now stay null on zero evidence |
| 21 | 2026-08-19 (exec) | WAVE4_SESSION_RESULT: W4-005 done â€” affect engine complete in one session (six {value,mass} evidence axes with real abstention, Karvonen exertion, personal hour-bin arousal, a SOFT rest gate that kills D3 structurally, all-taps declared fusion, the M.5 HMM and four-gate hysteresis, the AffectState DTO, ADR-0013 with the cut Borbely formula); the taxonomy is an INJECTED PORT so W4-006 stays the single source of truth for the state table; 133 new pins + ZERO re-pins, suite 184/2549 green twice; 20 mechanisms verified load-bearing by stub-out; six defects found by this session tests in its own code â€” three real (a rest gate that shut on the signal it was weighing, M.5 strong clause defeating the dwell at 20 transitions/hour == memoryless, a wall-clock field breaking replay determinism), one dead-code pair, two test defects including an anti-flap control that was measuring nothing |
| 17 | 2026-08-19 (exec) | WAVE4_SESSION_RESULT: W4-003 done â€” wiring half landed (filter drives debounce/trigger, D10 live persistence throttled+deduped, S6 gate real at the seam, WAVE4_ANOMALY_FILTER_DISABLED kill-switch, W4-D07 closed), 15 new pins (14 in wave4.liveWiring.test.js + 1 in biometricHandler.pipeline.test.js), suite 176/2213 green twice; 3 deliberate re-pins + 1 tolerance widening, all documented; PR #179 body updated, branch pushed |
| 23 | 2026-08-19 (exec) | WAVE4_SESSION_RESULT: REFLECT done 4 verified, 0 reopened, 2 queued - suite 184/2549 green (exact baseline), PR #179 CI green; W4-D15 found by execution: a null `rhrMedian` is scored as 0 bpm so stress saturates to 1.0 for any no-baseline user at rest (still 1.0 at HR 55), the profile D3/D4 exist to prevent, and `shadow.qa4`'s pin for that exact gotcha asserts only `assertTargetsSane`; W4-D16 queued after R1.5 archival collided with `state-guard`; STATE archived 204,535 -> 104,115 bytes |
| 24 | 2026-08-19 (exec) | WAVE4_SESSION_RESULT: W4-D15 done - the null-baseline stress saturation is closed at its root: `translate`'s single numeric guard coerced `null`/`''`/`false`/`[]` to 0, so SIX inputs read "no data" as "zero" and every one of them in the alarming direction (a calm resting user at a null baseline scored stress 1.0, still 1.0 at 40 bpm; null HRV, battery, readiness and sleep each collapsed recovery to 0; a null pulse produced a *measured* score of zero; and the D14 confidence ladder counted a stranger as a known user at conf 0.65 / bpmWidth 8 against 0.48 / 20). All five DoD items discharged, HRV pair nulled on its own evidence with the HRV_FALLBACK == POPULATION.hrv coincidence finally pinned, whole repair behind `WAVE4_BASELINE_ABSTENTION_DISABLED`; the (c) vacuous-pin sweep found two MORE over-claiming titles and one of them was a real sibling defect (`rhrMAD: 1e-12` -> recovery 0, stress 1.0), folded in with the engine's own MIN_SPREAD constant imported rather than copied; +40 pins, 1 deliberate re-pin, suite 185/2589 green in four of five runs with the fifth blemish recorded rather than hidden; 24 pins proven load-bearing by stub-out; W4-D17 queued (the discovery lane carries the same coercion, measured) |
| 25 | 2026-08-19 (exec) | WAVE4_SESSION_RESULT: W4-006 in_progress - pure core landed (34-state taxonomy over the affectEngine port + wellbeing regulator), 67 new pins across 3 suites, ZERO re-pins, suite 188/2656 green twice; widths are solved from per-axis roles so every state spends an identical precision budget; every state constrains all seven axes after `creative-flow` lost to `deep-focus` at its own centre through a free pass; regions re-anchored into an envelope measured over 5.8M evidence vectors after EIGHT states proved unreachable in raw units; all 34 reachable by coherent persona scripts through the real generator, baseline engine and HMM; two defects found in this session's own code by its own tests (a `degraded` flag derived from the wrong axis set, a rounding order that broke monotonicity at 1e-9) and one test found passing for the wrong reason by the stub-out battery; W4-D18/D19 queued, HITL H6 raised; prior session's `ae3937a` recorded as having landed none of the pure core its message claims |
| 26 | 2026-08-19 (exec) | WAVE4_SESSION_RESULT: W4-006 done - seam half landed and the task is COMPLETE (affect posterior store with a carry-age ruling, the ONE peek->update->save composition both lanes share, buildTargets wiring so the affect layer finally reaches the serving path, taps threaded from both real call sites, _STATE_TO_BAND derived from the taxonomy, an ADDITIVE encrypted stateId that leaves HITL H6 to Daniel, the nightly worker refresh, S13 claim-gated why-lines, both S11 kill-switches, D13's local hour with a server-offset fallback, and S5 registration for the new bio:affect: key family); 87 new pins across 4 suites + 6 appended, 2 deliberate re-pins, suite 192/2749 green twice and checkmark-free over the full log; 14 mechanisms proven load-bearing by stub-out and one found unfalsifiable and deleted rather than banked; a require cycle (moodDescriptors -> stateTaxonomy) found by a suite that would not load, and one of this session's own tests found passing for the wrong reason on a UTC+3 box |
