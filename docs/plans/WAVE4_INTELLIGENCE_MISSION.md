# WAVE 4 — RUNTIME INTELLIGENCE: MISSION DIRECTIVE

**Status:** APPROVED by Daniel, 2026-08-18. This is the standing directive for the Wave-4 autonomous run.
**Authority:** This mission is an approved Blueprint in the sense of `docs/ORCHESTRATOR_FABLE.md` §execution_phases — Daniel's approval of this document IS the `EXECUTE BLUEPRINT` gate for the queue below. For the duration of this run, the per-session protocol in §2 of this document replaces the generic `<session_start_protocol>`. Everything else in `ORCHESTRATOR_FABLE.md` and `CLAUDE.md` still binds (TDD iron law, DoD, attribution policy, Pause & Guide, error budget, secret scan).
**Companion files:** `docs/plans/WAVE4_STATE.md` (the ONLY resume source — machine-updated), `docs/plans/WAVE4_KICKOFF.md` (how Daniel starts the run), `scripts/run-mission.ps1` (the session loop).

---

## 0. WHY (context for every session)

Daniel ordered a maximal upgrade of both intelligence engines, executed autonomously over ~4 days while he is away:

- **Person engine** (medical/emotional profile): per-person baselines, daily analysis, live analysis, and a state model that can distinguish *tired* vs *resting-but-content*, *stressed-needs-calm*, *no-energy-wants-calm*, *mid-activity*, *going-to-train-energized* vs *obligated-but-drained* — and ~30 more states, with real math instead of magic constants.
- **Music engine**: taste profile v2, rebuilt scoring/similarity math, playlist trajectory planning (iso-principle arcs), discovery bandit, compliant personal learning.

Quality bar (Daniel, verbatim intent): not "just a programmer's work" — senior-level, mathematically deep, sophisticated, brilliant. Every formula deliberate, every constant sourced or derived, pure cores, exhaustive simulation-backed verification.

### 0.1 Confirmed ground-truth defects this wave kills (verified against source, 2026-08-18)

| # | Defect | Where |
|---|--------|-------|
| D1 | Personal HRV baseline NEVER computed — `translate()` reads `baselines.hrvMedian/hrvMAD`, `computeBaselines()` returns only `{rhrMedian, rhrMAD}` → all users scored against population constant `{45, 8}` | `backend/app/services/biosonic/translate.js:78`, `baselines.js:79-84` |
| D2 | Every batch HR row hardcoded `activity:'unknown'` → "resting" baseline pooled with workouts and sleep | `backend/app/services/wearable/metricStore.js:33`, `baselines.js:66` |
| D3 | A workout reads as maximal stress: `restingElevation` fires on `activity==='unknown'` (z≈14 → S=1.0 → narrow/acoustic/instrumental/forced-cheerful target) | `translate.js:87` |
| D4 | High stress FORCES happier music (`max(moodValence, 0.6)`) — violates VISION §6 "regulator, not mirror" / iso-principle | `translate.js:141` |
| D5 | LLM prompt axis swap: prompt says "(x = arousal, y = valence)"; code defines x=valence, y=arousal; inverted numeric targets survive (applyMoodFallback doesn't touch them) | `backend/app/services/geminiEngine.js:206` vs `moodDescriptors.js:14-15` |
| D6 | Live path has ZERO filtering (no EWMA/Kalman/median/artifact rejection — grep: zero hits); raw last-sample latch | `backend/app/sockets/biometricHandler.js` |
| D7 | Silent drift: sub-threshold readings overwrite confirmed `stableHR` without ever triggering (9 bpm steps walk 60→150 silently) | `biometricHandler.js:1132` |
| D8 | Debounce confirms a STALE snapshot: `pendingHR` captured once, never refreshed; single-shot timer discards larger mid-window changes | `biometricHandler.js:1136-1156` |
| D9 | Two inconsistent validity gates: ingest accepts 0–300, consumption requires 30–220 | `biometricHandler.js:1062` vs `:33` |
| D10 | Live socket samples NEVER persisted (BiometricLog written only by the batch lane) → live data feeds no baseline, no history | `metricStore.js:54` is the only `insertMany` |
| D11 | Trigger/key mismatch: recalibration triggers on HR delta (±10/±25) but buffer key is band (90/120 cuts) → false recalibrations + missed band crossings | `biometricHandler.js` + `moodDescriptors.bandFromHeartRate` |
| D12 | 9-rule state classifier: ~4 rules structurally unreachable (their inputs are never written: stepsPerMinute, gpsVelocityKmh, accelerometerVariance, screenOn, bluetoothAudioConnected, timeOfDay, dailyReadiness); confidence is enum {0.5, 0.7, 1.0}; label system orphaned from the continuous {recovery, stress, exertion} | `backend/app/services/medicalProfileService.js:16-161` |
| D13 | Circadian model = one binary step (`hour>=21 || hour<5 → 0.8`) on SERVER-local hour, no user timezone | `translate.js:96`, `targetsBuilder.js:45` |
| D14 | Fixed anchors for everyone: exertion `(HR−60)/100`; bands 90/120 bpm; unreachable 0.3 confidence floor (min is 0.4) | `translate.js:93,156-162`, `moodDescriptors.js:214` |
| D15 | Baseline cache: 6h TTL, no stale-while-revalidate → first generation each 6h window runs unpersonalized; MIN_SAMPLES=10 all-or-nothing cliff | `baselines.js` |
| D16 | Garmin stress ignored even on the dormant lane: `stressDetails` reads only `timeOffsetBodyBatteryValues`, discards `timeOffsetStressLevelValues` | `backend/app/services/wearable/adapter.js:253-254` |
| D17 | Music: cross-provider affinity scale collision — Spotify affinity ≈≤30, YouTube `n − i` ≈≤500+ in the SAME array; one global maxAffinity → Spotify taste collapses toward 0 | `musicProfileService.js` (`_analyzeYouTubeTracks`) vs `_accumulateTracks`; consumed in `selection/pipeline.js:156`, `score.js` |
| D18 | Scoring: unnormalized totals (mood weights sum 0.95, intent 1.20), mixed kernels, energy kernel ignores band width, one measured dim can score 1.0, source confidence stored but discarded, no octave equivalence anywhere | `selection/score.js`, `mmr.js`, `featureProvider.featuresOf` |
| D19 | Embedding: joint L2 norm lets genre tag-count crush audio dims; unweighted FNV-64 genre bag; linear bpm dim | `services/vector/embedding.js` |
| D20 | No recency decay, no per-user feature centroid (hardcoded nulls), no learning of any kind, no playlist sequencing/arc | `musicProfileService.js`, whole selection path |

### 0.2 Hard constraints (violating any of these fails the task)

1. **ADR-0011 + new ADR-0012 (learning compliance):** never fit/persist any model on Spotify-derived signals — not Spotify Content, not its audio features, not engagement measured against Spotify recordings. Learning = (a) state-space rewards for everyone (buckets of stateDomain × targetBand × hourBin — never track identity), (b) track-level posteriors ONLY for CC0 `mbid:` keys, schema-enforced. ReccoBeats features of Spotify tracks stay serve-time-only (in-memory scoring), never persisted into learned artifacts. YouTube Content equally excluded from cross-user stores (existing `featureService._dropRestricted` containment).
2. **Zero-knowledge biometrics:** raw vitals decrypt only in worker scope; no numeric vitals in LLM prompts, logs, job summaries, DTOs, or Redis keys — coarse bands/derived targets only. `decrypt(blob, parseJson, aad)` — **AAD is the THIRD argument**. Mongoose setters do NOT run on `findOneAndUpdate($set)` — encrypt explicitly (see `upsertStateVector`) or write via `doc.save()`. Redis state blobs are AES-256-GCM, AAD-bound to userId (pattern: `baselines.cacheBaselines`).
3. **GDPR Art.9 consent:** ingestion stays at consent v1 scope. Engine is built ready-for-everything behind per-metric capability flags; dormant lanes (Garmin S2S: respiration, SpO2, bodyBattery, stressLevel, steps) light up only when consent v2 ships. Never widen actual data collection in this wave.
4. **Regulator, not mirror (VISION §6):** inferred agitation must never amplify agitation. Down-regulation is achieved by trajectory (meet current arousal, then guide), never by forcing valence.
5. **Superset-only contract:** the `targets` object emitted by `targetsBuilder`/`translate` keeps ALL 13 existing keys (`bpmCenter, bpmWidth, energyFloor, energyCeiling, valenceTarget, acousticnessBias, instrumentalBias, tempoBand, confidence, activityDriven, activityIntensity, state{recovery,stress,exertion}`) with unchanged semantics; new keys are additive (`trajectory`, `stateId`). Consumers that pin it: `biosonicBand.withinBand`, `score._featureFit`, shadow buffer persistence, deterministicFallback, the `[gen.targets]` log line.
6. **Product gates preserved:** `liveMode` defaults false (Manual users never auto-driven) — re-pin with a tripwire after any handler edit. Serve-on-play ledger semantics in `recalibrateForBand`. Shadow-buffer keys stay coarse `bio:<band>:<activity>` (exposure-ledger comparability). Consent gate upstream of `biometric_push` untouched.
7. **Attribution policy (CLAUDE.md, non-negotiable):** commits are short, single-line, NO body, NO trailers, and NEVER any Claude/Anthropic/AI attribution — in commits, PR titles/bodies/comments, code comments, ADRs, docs.
8. **No self-merge:** `gh pr merge` is blocked for agents. Cut PRs, report them in STATE, and move on. Nothing merges without Daniel's click.
9. **Pause & Guide:** any cloud-portal action (Atlas index, Railway, Google Cloud, …) and any prod Mongo schema/index change is NOT performed. Ship the code dark/flagged, write a numbered tutorial into the HITL queue in STATE, continue with the next task.
10. **Test baseline:** the full backend suite must stay ≥ the baseline recorded in STATE (established in W4-000). Deliberate re-baselines (golden-set updates) are allowed only with a before/after diff in the PR body and a STATE note.

### 0.3 Environment gotchas (Windows dev box — pinned)

- Always `cd <repo>/backend` before npm/jest (bash cwd drifts). Backend tests: `npm test 2>&1 | grep -aE "Test Suites:|Tests:"` run through Git-Bash-style shell — PowerShell 5.1 mangles jest stderr.
- `npm install` may prune devDeps → use `npm install --include=dev`.
- Prod reads `MONGO_URI` (not DATABASE_URL). Never add a `railway up` CI job.
- Parallel sessions exist in this repo historically: `git fetch origin` before starting; compare `origin/main` SHA to STATE's `lastMainSha`; if main moved, record it in STATE, rebase `feat/intelligence-wave` only if clean, otherwise HITL-queue it. Never trust the currently-checked-out branch.
- Mobile jest via `./node_modules/.bin/jest` (bare `npx jest` can no-op). Mobile is OUT OF SCOPE this wave (backend-only; mobile follow-ups go to the on-device checklist).
- New top-level dirs this wave: `backend/sim/`, `backend/app/agents/runtime/`, `logs/wave4/` (ensure `logs/` is gitignored — add in W4-000 if missing).

---

### 0.4 Pre-launch safeguards (BINDING — added after the final gap review, 2026-08-18)

**Run integrity:**
- **S1 Preflight (first thing in W4-000, before any code):** verify `git config user.name` + `user.email` are set; `gh auth status` succeeds (if not → PR cutting is deferred, HITL note, work continues on the branch); `node --version` satisfies backend `package.json` engines; `npm install --include=dev` completes in `backend/`; `claude --version` works; boot `mongodb-memory-server` once NOW (it downloads a MongoDB binary on first use — do it in preflight, not mid-task on a flaky network); run the full suite and record the baseline. A preflight failure that truly blocks execution → HITL entry + `WAVE4_HALT`; anything degradable → note and continue.
- **S1a Baseline must be DETERMINISTIC — confirmed pre-existing test-infra defect in `tests/worker.test.js`:** on a fresh clone WITHOUT a live Redis, the 3 success-path tests (it lines ~31, ~63, ~120 — the ones that set `REDIS_URL='redis://example:6379'` and reach `await connect()`) fail DETERMINISTICALLY (verified isolated, `--runInBand`, 2026-08-18). Root cause is visible in the trace: a REAL BullMQ Queue is instantiated on the success path and its ioredis connection does `getaddrinfo ENOTFOUND example` against the fake host, leaving an open handle and blowing the 5000 ms timeout (`bullmq/dist/cjs/classes/queue-base.js`; Jest then force-exits). This is a UNIT-TEST-HYGIENE bug (a unit test opening a real network connection), NOT product logic — the 4 logic-path tests pass. **W4-000 fixes it properly as part of establishing a clean baseline** (do NOT just quarantine): make the test not open a real connection — inject/stub the queue factory the success path uses (preferred, matches the file's own dependency-injection style — `connectDB`/`startWorkers` are already injected; the leaking Queue creation should be injected too), or as a fallback point `REDIS_URL` at a fast-failing loopback (`redis://127.0.0.1:1`) AND raise these 3 tests' timeout to 20000 AND add teardown that closes the queue/quits ioredis so no handle leaks. Commit `wave4: fix worker.test.js real-connection leak`. THEN record the now-all-green baseline. **CONFIRMED 2026-08-18:** main's `CI` workflow is GREEN on every recent `push` (last push ~28 days ago — no parallel-session drift, stable base), so CI is the trusted source of truth and this is purely a no-local-Redis artifact. The repo ships `docker-compose.yml` (Mongo + Redis) — the CHEAPEST correct path is often just to start local infra for the run (`docker-compose up -d`) so the full suite goes green locally the way it does in CI; the test-injection fix above is the more permanent option if Docker isn't available on the box. Only `WAVE4_HALT` + HITL if main's CI is ever found RED for an unrelated reason (do not build on a broken main). Never record a red or non-deterministic suite as the raw baseline. (Separately: the scheduled `Secret scan` workflow is failing on main — UNRELATED to this wave; log it as a DISCOVERED HITL item for Daniel, do not chase it.)
- **S2 Dirty-tree recovery (every session, before picking a task):** if the working tree is dirty (previous session killed mid-work), inspect `git status` + `git diff`: commit coherent finished work with a normal message, otherwise stash-and-drop it. Record the decision in STATE. Never build on top of leftovers you don't understand.
- **S3 Offsite backup:** push `feat/intelligence-wave` to `origin` after EVERY completed task — four days of work must never exist only on one machine, and PRs need the branch remote anyway. Push failure (offline/auth) → STATE note, continue locally, retry next session.
- **S4 Stuck-task guard:** a task left `in_progress` across 3 sessions with no status change → mark `failed` with a summary and move on (complements the rule-of-2).

**Data-protection completeness (bug class: silent GDPR leak):**
- **S5** Every NEW collection (`VitalSample`, `RewardEvent`, `MorningState`, `PersonalWeights`) and every NEW Redis key family (affect peek blob, live HMM forward vector) MUST be registered — in the SAME PR that introduces it — in: the account-erasure cascade, `userRedisPurge`, wearable-erasure (for wearable-derived data), `userDataExport` (right of access), and the retention-windows documentation; extend the existing erasure-completeness CI guard to cover them. W4-015 re-verifies the complete inventory.

**Input hygiene (bug class: poisoned state):**
- **S6** The anomaly filter includes a timestamp sanity gate: reject/flag readings with `recordedAt` in the future (> now + 5 min) or beyond the retention window (classic Garmin-backfill trap); validate `tzOffsetMinutes` ∈ [−840, 720]; live persistence reuses the existing `source@recordedAt` dedupe convention so reconnects can't double-write.
- **S7** `playback_event` (W4-011) gets the full boundary treatment: strict schema (closed type enum, bounded `positionMs`, capped payload size), unknown fields dropped, per-socket rate limit — the same rigor as the existing tap-buffer hard allowlist.

**Numerical & runtime discipline (bug class: NaN in prod, slow math):**
- **S8** Numerical hygiene is part of DoD for every engine: every division zero-guarded (including Karvonen when `HRmax ≈ RHR`), every `log` domain-guarded, all outputs clamped; fuzz suites include `null`/`NaN`/`±Infinity`/zero-variance/empty-window inputs.
- **S9** Every new engine takes `now` (and `rng` where randomness is used) as PARAMETERS — no direct `Date.now()`/`Math.random()` inside engine math (replay determinism; the `translate()`/`buildTargets` precedent).
- **S10** Perf budgets as tests: affect forward update < 5 ms; trajectory planning < 30 ms at k=50; the golden harness asserts end-to-end selection wall-time within +10% of the pre-wave baseline; the soak asserts flat memory. SLO context: selection p95 < 300 ms.
- **S11** Runtime kill-switches: every serving-path change ships an env escape hatch restoring prior behavior WITHOUT a revert — `WAVE4_AFFECT_DISABLED`, `WAVE4_TRAJECTORY_DISABLED`, `WAVE4_SCORING_V2_DISABLED`, `WAVE4_RECAL_STATE_TRIGGER_DISABLED` (flags default unset = new behavior ON; setting the flag = instant old behavior). **"Setting the flag" means an ON spelling, as parsed by `app/utils/envFlag.disabled()` — `1`, `true`, `yes`, `on`, or any other non-empty value engage it; `''`, `0`, `false`, `no`, `off` (any case, trimmed) do NOT.** Amended by reflection #12 at W4-D58's explicit request: the original wording predates a single parser and read as though ANY assignment engaged the switch, which is what let three incompatible readings of the same flag name coexist. One parse, two directional names (`enabled`/`disabled`), pinned by the `tests/wave4.killSwitchSpelling.test.js` tripwire. Full inventory in WAVE4_REPORT. New workers/jobs register through the existing `RUN_WORKERS_IN_PROCESS` index and stay inert under test unless explicitly started.

**Sophistication upgrades (cheap, high value):**
- **S12 Scoring shadow-compare (W4-007):** behind `SCORING_V2_SHADOW`, compute v1 and v2 side by side and log divergence stats (rank correlation, top-k overlap) per generation — telemetry only, zero user impact; soak + REPORT summarize the distribution. Evidence for the cutover decision.
- **S13 Explainability receipts (W4-006):** extend the existing `buildReceipt` to consume `stateId`/`trajectory` via the taxonomy `explainTemplate` — honest, closed-vocabulary "why this mix" lines (never claims a signal it lacks); the display-copy list goes to the compliance HITL item.
- **S14 Pulse surfacing (W4-012):** `/api/pulse/state` response becomes a superset exposing MorningState + coarse affect (domain, band, readiness bucket, confidence — never numeric vitals), so the mobile app has something real to render in a later wave.
- **S15 Standards:** `fast-check` is the property-testing standard (devDep, W4-002); every new engine emits the house single-line telemetry (R11 style) with stage timings; every persisted blob/DTO carries a `v` version field for future migrations.

---

## 1. OPERATING MODEL

- **Branch:** ALL work happens on `feat/intelligence-wave` (single integration branch — Daniel's explicit ruling, supersedes ORCHESTRATOR_FABLE's branch-per-task for this wave). Create it from current `origin/main` in W4-000 if absent.
- **Commits:** one commit per completed unit of work, single-line message, e.g. `wave4: anomaly filter kalman core + tests`. No attribution, no body.
- **PR clusters:** when a cluster (see queue) is green, cut a PR from a stable point: `gh pr create --title "Wave4 <id>: <name>" --body-file <tmpfile>` — body lists scope, test evidence (suite counts before/after), any golden diffs, compliance checklist. Record the PR URL in STATE. Do NOT wait for merge; continue on the integration branch. (If cutting per-cluster PRs from one branch proves noisy, fall back to ONE running PR for the whole branch, updated per cluster — note the choice in STATE.)
- **TDD:** failing test first, always. Pure engines get fuzz/property pins (the `translate()` 300-round precedent). Never a green mock for an integration boundary; resilience tests use stateful fakes with real semantics.
- **Error budget (rule of 2):** a task failing verification twice → revert (`git restore` / reset to last green commit), mark task `failed` in STATE with a failure summary, move to the next unblocked task. 3 consecutive FAILED SESSIONS → create `docs/plans/WAVE4_HALT` with the reason (the loop stops).
- **Subagents:** per `CLAUDE.md`, dispatching `architect`/`developer`/`resilience-auditor` subagents is at the session's discretion for L-sized tasks; for S/M tasks direct execution is fine. `compliance-auditor` review is MANDATORY (as a checklist, or subagent if available) for W4-000 (ADR-0012), W4-006 (state-label vocabulary), W4-011 (RewardEvent), W4-014 (embedding migration).
- **Model & token economy (Daniel's ruling, enforced by `scripts/run-mission.ps1`):** the LOOP selects the model per session via `--model`; sessions NEVER attempt to switch models themselves. Policy: `phase: review` → Fable at max reasoning ("plan"); execution → Opus at max reasoning ("exec"); when estimated session-window usage ≥ 70% (or weekly ≥ soft threshold) → Sonnet ("saver") until the ~5h window resets, then automatically back to Opus; ≥ 95% of the window (or weekly hard threshold) → the loop WAITS for the reset instead of launching. Usage is estimated locally from Claude Code's own transcript logs via `ccusage` (Anthropic exposes no exact quota API) and logged every iteration to `logs/wave4/usage.log`. The env var `WAVE4_MODEL_TIER` (`plan|exec|saver`) tells the session how it was launched: on `saver`, prefer an S/M task or continuing an `in_progress` task over STARTING a new L design task — the math appendix (§M) exists precisely so mechanical implementation survives a lighter model. `ultrathink` stays in every prompt regardless of tier; include it in subagent prompts too.
- **Token-thrift rules (all tiers):** read only the files the current task names (plus its seams) — no repo-wide re-exploration after W4-000; trust STATE instead of re-deriving history; keep PR bodies tight (evidence, not narrative); dispatch subagents only for L tasks; never re-run the full suite more than needed to satisfy DoD (targeted suite while iterating, full suite at the end).

## 2. PER-SESSION PROTOCOL (the resume loop)

Each session (headless or interactive) does this, exactly:

1. `git fetch origin` → divergence check vs STATE `lastMainSha` (see §0.3). Check out / fast-forward `feat/intelligence-wave`. If the working tree is dirty (a prior session was killed mid-work), apply safeguard **S2** (§0.4) before anything else.
2. Read `docs/plans/WAVE4_STATE.md`. If a `WAVE4_HALT` file exists → print the halt reason and exit.
3. **If STATE says `phase: review` (first session only):** run the PLAN-MODE REVIEW PASS (§3, W4-000) — a read-only validation of this mission against the FULL repo — then update this mission file + STATE with deltas, set `phase: execute`, commit, exit.
4. **Reflection trigger (check BEFORE picking a task):** run `node scripts/wave4/reflect-marker.js check` — it reads `logs/wave4/last-reflect.txt` (ISO-8601 UTC timestamp on line 1, HEAD sha on line 2) and prints `DUE <reason>` / `NOT-DUE <reason>`. Do NOT hand-parse the file: missing, unreadable and future-dated markers all count as DUE, which is the safe direction. If it is missing, or ≥ `REFLECT_INTERVAL_HOURS` (default **4**) have passed since it, **this session is a REFLECTION session** — run §2.5 instead of a queue task, then exit. Skip the reflection if `day4CutoffAt` has passed (only W4-015 runs then), or if a `class: repair` task is currently `pending`/`in_progress` (fix the tree first, reflect after).
5. Otherwise pick the FIRST task with status `pending` whose `deps` are all `done` (or `in_progress` tasks you own — continue them). Respect the tier fallback rule: if a bio-track task is blocked/failed, W4-007/008 are eligible early (they depend only on the frozen targets shape from W4-006 — or on today's shape if 006 hasn't landed, coded superset-tolerant). Model economy: if `WAVE4_MODEL_TIER` is `saver`, prefer an S/M task or an `in_progress` continuation over starting a new L design task, when one is unblocked. Stuck-task guard **S4** (§0.4): a task `in_progress` across 3 sessions with no status change → mark it `failed` with a summary and move on.
6. Set the task `in_progress` in STATE (with a one-line progress note), commit STATE. **Every STATE write (here, at step 8, and in R7) starts by re-reading `WAVE4_STATE.md` from disk and applying a surgical edit to THAT text — never compose the file from a copy read earlier in the session — and ends by running `node scripts/wave4/state-guard.js check`, which exits non-zero if the edit regressed a task row down the status ladder or dropped one entirely (W4-D02). A deliberate reopen (§2.5 R2) is allowed and declares itself by putting the literal token `REOPENED` in that row. `run-mission.ps1` re-runs the same check after every session as a backstop, so a skipped check surfaces in `logs/wave4/usage.log` rather than silently rewriting queue truth.**
7. Execute the task under TDD. Definition of Done, ALL required: failing-test-first evidence; full backend suite green and ≥ baseline (`cd backend && npm test`); lint clean; secret scan of the diff (`grep -E "AIza|ghp_|sk-|-----BEGIN|eyJ[A-Za-z0-9_-]{30,}"`); zero-knowledge check (no numeric vitals in new logs/DTOs/prompts); no attribution anywhere; STATE updated.
8. Mark task `done` in STATE (with test counts + key evidence), commit everything (single-line messages), **push `feat/intelligence-wave` to origin (S3 — offsite backup, every task)**, cut a PR if the cluster is complete.
9. If the task hits a Pause & Guide wall or a decision only Daniel can make: write a numbered HITL entry in STATE (what, why, exact steps for Daniel, what's blocked on it), ship what can ship dark/flagged, and continue.
10. Print a final line: `WAVE4_SESSION_RESULT: <taskId> <done|in_progress|failed> <one-line summary>` and exit. One task per session (an L task may span sessions via `in_progress` + progress notes). Special case: when the entire queue including W4-015 is `done`, print `WAVE4_SESSION_RESULT: DONE-ALL complete` — the loop stops on it.

**Outside a reflection session:** never re-plan the mission, re-order tiers, or start work outside the queue — stay on the one task you picked. Work you notice in passing goes to the **Discovered backlog** in STATE (a one-line note is enough; the next reflection triages it), and anything needing Daniel goes to the HITL queue. Re-planning is a privilege of reflection sessions only (§2.5) — that separation is what keeps a 4-day autonomous run from drifting into an endless redesign.

## 2.5 RECURRING REFLECTION PASS (every 4 hours — Daniel's standing order)

> Daniel's instruction, verbatim intent: *"every 4 hours it should look again and see where things can be improved,
> fixed, and what else can be done — it must always be thinking of more tasks."* This section is how that happens
> **without** the run drifting into endless redesign. A reflection session VERIFIES, AUDITS and QUEUES.
> It does not implement (one narrow exception in step R6).

**Trigger:** §2 step 4 — `logs/wave4/last-reflect.txt` is missing or older than `REFLECT_INTERVAL_HOURS` (default **4**).
**Model:** whatever tier the loop launched (`WAVE4_MODEL_TIER`). On `saver`, still do R1–R3 (verification is never skipped) but
limit R4–R5 to the diff since the last reflection rather than a broad sweep, and say so in the STATE entry.
**Budget:** a reflection is a SHORT session. If it is running long, finish R1–R3 + write findings and exit; depth is R4's job next time.

### What a reflection session does, in order

- **R1 · Health check (never skipped).** `cd backend && npm test` (full suite) + lint + secret scan of everything since the last
  reflection. Compare against STATE `testBaseline`. Also: `git log --oneline <lastReflectSha>..HEAD` and
  `git status` — the tree must be clean and the branch pushed. **Also check the real CI, not only the local run:** if STATE's PR
  queue has an open PR, `gh pr checks <PR>` — a red or missing GitHub Actions check is a genuine gap the local suite cannot see
  (H1 is a standing example: a scheduled workflow has been failing on `main` for weeks without tripping anything local). Treat a
  red required check the same as a red local suite for R2/R3 purposes; a red non-required or pre-existing-red check (H1 itself)
  just gets named in the reflection log so it does not silently drift out of view.
- **R1.5 · STATE housekeeping.** Every session reads all of `WAVE4_STATE.md` as step 1 of §2 — a growing file is a growing tax
  on every future session, reflection or not (it started ~7KB; by the first reflection after the concurrent-session incident it
  had already reached 175KB). Check the file's size. Past **150KB**, archive what is no longer active: `Discovered backlog` rows
  with status `done`/`closed`, `Reflection log` entries older than the 2 most recent, and `Session log` rows for sessions more
  than 24h old — move them verbatim (do not summarize/lossy-compress a row; provenance matters) into `docs/plans/WAVE4_ARCHIVE.md`
  under a dated heading, in append order, and delete them from STATE. STATE keeps: the Run header, the full Task table (never
  archived — it is the live truth), open/pending backlog rows, open HITL items, the PR queue, and the last 2 reflection entries +
  last 24h of session log. Note the archival itself as one line in the Reflection log so the row count discontinuity is explained.
- **R2 · Verify the last interval's claims.** For every task marked `done` since the last reflection, spot-check that its DoD is
  *actually* satisfied — the tests it claims exist do exist and genuinely fail without the fix (re-run one with the fix stubbed out
  if cheap), the STATE evidence matches reality, the PR (if cut) reflects the real diff. **A task whose claim does not hold gets
  reopened**: status → `pending`, note why, and put the literal token `REOPENED` in that row so the step-6 guard reads the
  downgrade as the decision it is (W4-D02). This is the single highest-value thing a reflection does; an autonomous run's main
  failure mode is a task that *reports* success.
- **R3 · Constraint audit of the new code.** Against §0.2: ADR-0011/0012 (no Spotify-derived learned artifact — run the tripwire),
  zero-knowledge (no numeric vitals in any new DTO/log/prompt), targets superset-only, regulator-not-mirror, consent gates intact,
  no attribution anywhere, kill-switch env flag present for every new serving-path behavior (§0.4 S-series).
  **Any violation → a `class: repair` task at the TOP of the queue, ahead of all MUST work.**
- **R4 · Quality sweep (the "what can be better" pass).** Read the code landed since the last reflection with fresh eyes and ask:
  does the implementation actually match the §M formula it claims (coefficients, clamps, units, edge cases at n=0/1)?
  Numerical hazards — division by zero, NaN propagation, unbounded growth, silent `undefined` coercion?
  Missing tests for a branch that matters? A seam that got hardcoded where the architecture wanted a port?
  Dead/duplicated logic? A degraded-mode path that was never exercised? Performance cliffs (O(n²) over a candidate pool, an
  unbounded Redis blob, a missing index for a new query)?
- **R5 · Opportunity sweep (the "what else" pass).** Deliberately look OUTSIDE the current queue for work that would raise the
  ceiling of the two engines: a defect not in the D1–D20 list; a math upgrade with real payoff (better estimator, principled prior,
  a smarter distance); a taxonomy state that reality needs and §3's ~32 don't cover; an evaluation the wave can't currently do
  (a metric, a golden set, a persona); an integration seam that would unlock a later wave cheaply.
- **R6 · Triage into the queue.** Everything found in R2–R5 becomes a row in STATE's **Discovered backlog** — id `W4-D<nn>`, with
  (if the `## Discovered backlog` or `## Reflection log` sections are missing from STATE — e.g. a session rewrote the file — recreate them from the shape described here before writing; they are self-healing by design, never a reason to skip the pass)
  the SAME rigor as §3 tasks: `class` (`repair` | `improve` | `extend`), tier, size, deps, a concrete DoD, and one line of
  justification (why it is worth spending part of a 4-day budget on). **Before adding a row, check for a duplicate** — read
  every existing `W4-D<nn>` (open AND closed/done) and ask whether it already names this finding, not just a similarly-worded
  one; if it does, do not add a new row — append one line to the existing row's evidence instead (or, if it was closed and this
  interval shows the closure did not hold, that IS an R2 reopen, not a new discovery). At the backlog's current size this is a
  real risk, not a formality — cross-check by grepping the finding's file:line, not just its title. **Discipline rules, all binding:**
  - **Max 5 new rows per reflection.** A reflection that finds more has found a theme, not five tasks — write the theme as one task.
  - **`class: repair` outranks everything.** Otherwise, original MUST-tier queue tasks (§3) always outrank discovered work;
    discovered `improve`/`extend` rows are picked up only when the MUST queue is blocked or done. The wave's committed scope ships first.
  - **"Nothing found" is a valid and respected result.** If the interval's work was clean, say so in one line and move on.
    Do NOT manufacture busywork to look productive — a padded backlog is worse than an empty one, because it dilutes the real signal.
    (This is the honest reading of "always be thinking of more": *always look*, not *always find*.)
  - **Never** silently rewrite §3's committed scope, drop a task, or re-order tiers. Proposals to change scope go to STATE as a
    HITL entry for Daniel, not into the queue.
  - The exception to "reflections don't implement": a fix under ~10 minutes with an obvious test (a typo, a stale doc line, a
    missing clamp, a flaky assertion) may be done inline — commit it separately with a `wave4: reflect —` prefix.
- **R6.5 · Pace check.** `day4CutoffAt` is a hard wall — after it, only W4-015 may run. Count remaining `pending`/`in_progress`
  MUST-tier §3 tasks; compute average wall-clock per completed task from the Session log (a rough per-tier median is enough, L
  tasks already show as 2 owner-sessions when split); project whether the remaining MUST-tier work finishes before the cutoff at
  the observed pace. If the projection says no — or came close enough last time that it is trending the wrong way — raise (or
  update) **one standing HITL entry** with the math shown (tasks remaining × observed pace vs. hours left) so Daniel sees it
  forming on day 1–2, not on day 4 when nothing can be done about it. This is a projection, not a panic button — do not let it
  turn into scope-cutting on your own authority; that decision is Daniel's, the HITL entry is how it reaches him early.
- **R7 · Close out.** Write the reflection entry into STATE's **Reflection log** (timestamp, interval covered, suite result,
  what was verified, what was reopened, what was queued, or "clean"). A reflection runs alongside a session that may have
  committed STATE while the reflection was reading it, so this write above all others re-reads the file first and runs the
  step-6 `state-guard.js check` before committing (W4-D02 — a reflection is what clobbered W4-001's row). Then stamp the
  close-out marker with
  `node scripts/wave4/reflect-marker.js stamp` (writes the current UTC timestamp + HEAD sha to
  `logs/wave4/last-reflect.txt`). **That stamp is the only thing that clears the trigger — a reflection that
  skips it latches the trigger ON and no queue task can ever be picked again** (W4-D01). `run-mission.ps1`
  stamps it as a backstop when a session dies before this step, but the session still owns it. Commit, push, and print:
  `WAVE4_SESSION_RESULT: REFLECT done <n verified, m reopened, k queued — one-line headline>`
  A reflection session **never** counts against the error budget or the rule-of-2, and never blocks the queue.

### Why this shape (for any session tempted to "improve" it)

A 4-day autonomous run has two opposite failure modes. One is tunnel vision: mechanically executing a queue written before the code
existed, never noticing the plan was wrong (session 1's review pass already proved the plan had six wrong assumptions). The other is
drift: an agent that re-plans continuously, gold-plates, and lands nothing shippable. The 4-hour cadence with a hard separation —
*execute sessions never re-plan, reflect sessions never implement* — is what buys the first without paying for the second.
R2 is the load-bearing step: **trust nothing that reports its own success.**

## 3. TASK QUEUE

Tiers: **MUST** = 000–008, 015 · **SHOULD** = 009–012 · **STRETCH** = 013–014. Sizes: S < ½ session · M ≈ 1 session · L ≈ 2 sessions. `deps` are hard.
Day-4 guarantee: whatever landed, W4-015 ALWAYS runs last so Daniel returns to a complete package.

### W4-000 · Mission bootstrap, review pass & ADR-0012 — S · MUST · deps: none
Run the **S1 preflight** (§0.4) FIRST — git identity, `gh auth`, node/npm, `claude`, mongodb-memory-server boot, full-suite baseline. Then the **PLAN-MODE REVIEW PASS**: this mission was authored against a partial extract (`backend/app/{models,services,sockets,workers}` + docs). Validate it against the FULL repo before any code:
- Read the real `backend/tests/` landscape; run the suite; record the TRUE baseline (suites/tests counts) in STATE.
- Resolve flagged unknowns and update task specs in THIS file where reality differs: (a) `embedding.worker.js` — are stored vectors genre-free ("dilution fix") or genre-carrying? (changes W4-014's design); (b) `services/discovery/discoveryFetch.js` — the adapter converting `targets {bpmCenter,…}` → `buildTargetVector {bpm, energy,…}` (W17 shape seam for W4-008/014); (c) `repositories/audioFeatureRepo.js` upsert precedence; (d) `queues/definitions.js` queue names; (e) `integrationsController.watchHrIngest` consent gating on the watch lane; (f) existing `backend/scripts/biometric-mock.js` conventions (reuse in W4-002 if compatible).
- Create branch `feat/intelligence-wave` from `origin/main`. Ensure `logs/` gitignored. Verify `.claude/settings.json` `includeCoAuthoredBy: false`.
- Write `docs/adr/ADR-0012-learning-compliance.md`: the two-track learning ruling (state-space buckets for all; track-level Beta posteriors `mbid:`-only; persisted artifacts never encode Spotify/YouTube Content; ReccoBeats features serve-time-only; feedback events store bucket coordinates, never Spotify track identity). Add `backend/tests/adr0012.tripwire.test.js` — a grep-style guard (pattern of the `SPOTIFY_BETA_CONNECT` tripwire) asserting no learned-artifact schema accepts `spotify:`/`youtube:` keys.
- Record all deltas in STATE (`reviewDeltas` section), set `phase: execute`.

### W4-001 · Surgical bug backlog — M · MUST · deps: 000
Fix + pin each with a test (one commit per fix; run `tests/biometricHandler.pipeline.test.js` in isolation after every handler edit):
1. D5 axis swap: `geminiEngine.js:206` → "(x = valence, y = arousal, range -1 to 1)".
2. D9 gates: `isValidReading` delegates HR range to the shared 30–220 predicate. (W4-000 review: `integrationsController.watchHrIngest` carries a THIRD range, 30–230 — align it to the same shared predicate in this fix so 221–230 isn't accepted at the route and then silently dropped by the handler.)
3. D7 drift: sub-threshold readings feed an EWMA observation only; confirmed `stableHR` changes ONLY via the debounce/trigger path.
4. D8 stale snapshot: refresh `pendingHR`/`pendingActivity` on every reading during the window; the timer confirms the LATEST pending value.
5. D11 (interim, full fix in W4-009): watch-lane + streaming trigger becomes `bandFromHeartRate(new) !== bandFromHeartRate(confirmed) || activityChanged` (keeps delta guards as noise floor).
6. D4 regulator: delete the `Math.max(moodValence, 0.6/0.5)` floors → `valenceTarget = round3(clamp01(moodValence + Math.min(0.1, 0.15*S)))` (gentle comfort bias; trajectory-based regulation arrives in W4-006).
7. D14 confidence: step 0.175 per missing group so the 0.3 floor binds and `biosonicBand.W_MAX` becomes reachable.
8. D3 workout≠stress: `restingElevation` computed only when `activity === 'resting'` OR (`activity` null/`'unknown'` AND `heartRate < 110`).
9. D17 affinity: `_analyzeYouTubeTracks` → bounded same-scale scores (liked: `SOURCE_WEIGHTS.saved + (n−i)/n`; playlist items: `SOURCE_WEIGHTS.playlist + (n−i)/n`); pin a test asserting Spotify and YouTube affinities land in comparable ranges.
10. W8/W9 hygiene: `pipeline.js` ladder header matches the real 3 entries; dead `energyCeiling` plumbing in `hardFilters` removed or annotated.
New pins live in `backend/tests/wave4.bugfix.test.js` (+ existing-suite re-pins where behavior deliberately changed — each with a PR-body note).

### W4-002 · Synthetic-human simulator + replay harness — L · MUST · deps: 000
`backend/sim/personas.js` — parameterized personas: athlete (RHR≈48, HRV≈85, cosinor amplitude≈6), sedentary (72/35), older-adult (65/25, flattened amplitude), shift-worker (acrophase +8h), stressed-professional (frequent stress episodes, short sleep). Each = cosinor params + AR(1) noise σ + episode schedule + sleep pattern.
`backend/sim/generator.js` — seeded, deterministic: `HR(t) = cosinor + AR(1) + episodes` (workout trapezoids into zones 3–5 with cadence-appropriate activity labels, stress episodes +15–25 bpm with HRV suppression, nocturnal dips); sleep-stage records; HRV/RHR daily series; artifact injector (dropouts, zero readings, ×2 spikes, flatlines, timestamp dupes/jitter). Emits BOTH lanes: socket-shaped `biometric_push` streams AND health-store batch payloads. (W4-000 review: socket payload convention confirmed as `socket.emit('biometric_push', { source: 'garmin', raw })`; `scripts/biometric-mock.js` and `scripts/mock-biometrics.js` are near-duplicate fixed-constant scenario drivers, not personas — reuse the payload shape, don't extend the scripts.)
`backend/sim/replay.js` — drives the REAL `handleBiometricReading` + `healthStore.ingestBatch` + workers against `mongodb-memory-server` with fake timers (accelerated clock). `backend/sim/soak.js` — 24h-equivalent run, gated `RUN_SOAK=1` (never in default CI budget).
Holdout personas (different noise family — t-distributed, non-AR) exist from day one to avoid circular validation. Tests: `tests/sim.generator.test.js` (seed determinism, plausibility bounds, both-lane round-trip lands rows).

### W4-003 · A0 signal integrity + live persistence + `_shared` bootstrap — L · MUST · deps: 001, 002
`backend/app/agents/runtime/_shared/dto/telemetry.js` (zod schemas — add `zod` via `npm install --include=dev` + prod dep; `TelemetryClean {userId, metric, value, trend, confidence, activity, source, recordedAt}`).
`backend/app/agents/runtime/ingestion/anomalyFilter.js` — PURE, per-metric, state passed in/out (caller owns it): Hampel (window 7, reject `|x−med| > 3·1.4826·MAD`) → slew gate (`|Δx/Δt| > 8 bpm/s` = artifact) → Kalman [level, trend] with irregular Δt (§M.2) → per-reading confidence `c = exp(−y²/2S)` × gate factors; rejected readings propagate the prediction with confidence ×0.7; a low-confidence RUN (c < 0.3 for > 60s) flags `degraded: mood-only` (never fabricate physiology).
Wire in `handleBiometricReading` after `normalize()`: the debounce/trigger machinery consumes filtered `{level, trend, confidence}`. Persist accepted readings to `BiometricLog` (≤1 row/min per socket, real `activity` + `source`, encrypted as today) — closes D10; the live lane finally feeds baselines/history. Re-pin: liveMode tripwire, consent-gate untouched, trigger semantics on clean data unchanged from W4-001.
Tests: `tests/anomalyFilter.test.js` — every injected artifact class rejected/de-weighted, ≥99% clean-stream pass-through, Kalman converges to persona ground-truth ±2 bpm, degraded-mode flag; handler integration + persistence tests.

### W4-004 · A1+A2 baseline & chronobiology engine v2 — L · MUST · deps: 003
`backend/app/models/VitalSample.js` — encrypted metric-typed time series `{userId, metric: hrv|restingHeartRate|respirationRate|spO2|bodyBattery|stressLevel, value: encryptedNumber, recordedAt, source}`, TTL 90d, index `{userId, metric, recordedAt}` (prod index build → HITL tutorial; code ships regardless — mongoose ensures dev indexes).
`backend/app/agents/runtime/physiology/baselineEngine.js` (worker-scope only, decrypt audited): RHR estimate = device-provided RHR series ∪ nocturnal-window (00:00–06:00 local) low-percentile (P10) HR ∪ live `activity==='resting'` rows — decontaminates D2 without touching stored rows; 7d acute vs 30d chronic medians + EWMA trend per metric; REAL HRV median/MAD from VitalSample (closes D1); 24-bin hour-of-day HR baseline table with per-bin shrinkage toward the user's own overall baseline (§M.4); HRmax estimate (user-provided ∨ P99.5 of 90d high-exertion samples if ≥160 ∨ 190 default, confidence-tagged); Karvonen zones (§M.7) written to dormant `MedicalProfile.hrZones`/`maxHeartRate` via `doc.save()` (setter caveat).
`backend/app/agents/runtime/physiology/chronobiology.js`: cosinor fit (§M.3) over the hourly table; multi-night sleep-debt accumulator (§M.6) from `lastNightSleep` history (persist nightly values into VitalSample-adjacent storage or MorningState later); personal circadian alertness curve replacing the binary `windDown`. Timezone: accept `tzOffsetMinutes` on socket events + batch ingest (additive, optional), store per reading, server-hour fallback (mobile emission → on-device checklist).
`baselines.js`: `computeBaselines` delegates to baselineEngine; cache blob becomes a SUPERSET — keeps `{rhrMedian, rhrMAD, sampleCount, computedAt}`, adds `{hrvMedian, hrvMAD, hourly[24], cosinor{M,A,phi,confidence}, zones, acute{rhr,hrv}, trend, confidence}` → **D1 fixed with ZERO `translate()` changes**; `peekBaselines` gains stale-while-revalidate (serve last blob past TTL, keep the `state-vector-<userId>` jobId debounce). `metricStore.persistMetrics` additionally writes VitalSample rows (existing MedicalProfile scalar path KEPT); `adapter.js` gains dormant-lane `stressLevel` (D16) + steps normalizers behind capability flags (consent v2 ready, OFF today).
Tests: `tests/baselineEngine.test.js` (persona replay: RHR within ±3 bpm of persona ground truth DESPITE workout episodes in the batch; HRV baseline exists after N sim-days; shrinkage cold-start monotonicity — no MIN_SAMPLES cliff), `tests/chronobiology.test.js` (cosinor recovers persona {M, A, φ} within tolerance; sleep-debt decay), cache-compat (old-shape blob still translates; superset blob honored).

### W4-005 · A3 affect engine core — L · MUST · deps: 004
`backend/app/agents/runtime/physiology/affectEngine.js` — PURE (I/O stays in callers):
- Evidence axes vs personal hour-of-day baselines: `arousal` (HR robust-z per hour bin), `stress` (HRV-suppression z + resting-elevation z per hour bin, activity-gated), `recovery` (sleep/HRV/battery/readiness composite — generalizes today's R with explicit weights + missing-data mass), `exertion` = `(HR − RHR)/(HRmax − RHR)` (Karvonen; replaces `(HR−60)/100`; activity floors kept as priors, not overrides), `fatigue` (sleep debt + multi-day HRV downtrend), `circadianAlertness` (cosinor phase − debt penalty).
- Declared-mood fusion: use ALL taps (not just last) — centroid + dispersion → declared confidence; fuse declared (valence, arousal) with physiological posterior by confidence weights (replaces every fixed 50/50 blend at the numeric level; `applyBiometricBands` continues to exist for the LLM path but its blend weights become confidence-driven).
- Temporal layer: HMM forward update over the taxonomy state set (§M.5): sticky transitions `A(s,s)=exp(−Δt/τ_s)`, off-diagonal mass 70% within-domain / 30% cross-domain, dwell-time priors; α renormalized; label projection with hysteresis (switch only if `α(s*) > α(current)+0.1` AND minDwell met).
- Output DTO `AffectState {axes{...}, topState, posteriorEntropy, confidence, computedAt}` — coarse only, ZERO raw vitals. `docs/adr/ADR-0013-state-model.md` records the 4-layer stack (+ the cut Borbély two-process formula for later).
Tests: `tests/affectEngine.test.js` — seeded 300-round fuzz (finite/clamped for ANY input); persona kill-shots: workout → exertion high + stress NOT saturated (D3's structural fix); stress episode → stress high, arousal moderate; no-signal → near-uniform posterior + low confidence (never fabricate); anti-flap property (bounded label transitions/hour on noisy input vs raw argmax).

### W4-006 · A4 taxonomy + A5 regulator + serving-path integration — L · MUST · deps: 005
`backend/app/agents/runtime/knowledge/stateTaxonomy.js` — DATA-DRIVEN table (~32 states, 6 domains), each entry `{id, domain, region{center,width per axis}, enterThreshold, exitThreshold, minDwellSec, band: resting|active|peak, musicPolicy{energyBias, valenceApproach, textureBias, trajectoryArchetype}, explainTemplate, requiredSignals, degraded}`:
- **Rest & Recovery:** deep-rest, meditative, resting-content, drowsy-low-battery, post-exertion-recovery, sleep-onset-wind-down.
- **Stress & Regulation:** acute-stress, simmering-tension, anxious-restless, overload-needs-downshift, recovering-from-stress.
- **Focus & Cognitive:** deep-focus, light-focus, creative-flow, mental-fatigue, restless-distracted.
- **Movement & Exertion:** warmup, steady-cardio, peak-effort, intervals, cooldown, obligated-workout-low-recovery, casual-walk, commute-active.
- **Daily Rhythm & Transition:** morning-activation, morning-sluggish, afternoon-dip, evening-unwind, night-owl-alert, pre-sleep.
- **Emotional:** energized-positive, low-mood-low-energy, tense-but-positive, neutral-baseline.
Legacy 9 labels map in (compat table). Labels are INTERNAL vocabulary: encrypted at rest (audit F3), never in prompts/logs (closed `_STATE_TO_BAND`-style projections only), display copy is a separate compliance-reviewed layer (HITL item).
`backend/app/agents/runtime/translation/wellbeingRegulator.js` — PURE decorator over translate output: high stress / low recovery → cap `energyCeiling`, raise `acousticnessBias`, and set `targets.trajectory = {archetype: 'meet-then-lower', start: current-arousal-matched energy/bpm, end: regulation goal}` — the structural iso-principle mechanism (meet, then guide).
Seam wiring: `targetsBuilder.buildTargets` adds `const affect = await affectPeek(userId)` (new Redis-cached peek, AAD-bound encrypted, `peekBaselines` pattern) → passes richer inputs to `translate()` → wraps with `wellbeingRegulator.apply(targets, affect)`. Targets = STRICT SUPERSET (constraint §0.2.5). `medicalProfileService.upsertStateVector` writes taxonomy labels (explicit `encrypt(status)`); `computeStateVector` kept as the degraded fallback; `moodDescriptors._STATE_TO_BAND` extended from `stateTaxonomy.band`. `stateVector.worker` persists the daily affect refresh.
Tests: `tests/stateTaxonomy.reachability.test.js` — **EVERY state reachable by ≥1 persona script (hard DoD)**; hysteresis anti-flap at region boundaries; superset pins (existing suites for biosonicBand/score/pipeline/shadow-buffer untouched targets keys); zero-knowledge shadow test (no numeric vitals or display labels in emitted DTOs/logs).

### W4-007 · B2 scoring & similarity rebuild — L · MUST · deps: 001 (eligible early if bio track stalls; superset-tolerant of pre-006 targets)
`featureProvider.featuresOf` gains `confidence` + `source` (the ONE projection — update ALL consumers in this same PR: score, biosonicBand, mmr, embedding, discovery band filter).
`selection/score.js` v2: normalized log-linear total `Σ w_d·c_d·k_d − w_exp·exposure` with `Σw_d = 1` per mode (mood + intent modes kept); ALL kernels Gaussian with explicit σ (energy kernel finally uses band half-width, not just midpoint); per-dim confidence weighting (source-tiered 1.0 api / 0.85 acousticbrainz / 0.7 llm); missing dim → prior 0.5 at 0.3 mass (kills one-measured-dim-scores-1.0); `unknownFeaturePenalty` subsumed by the mass mechanism; octave-folded log-tempo distance (§M.10) EXCEPT vs cadence anchors (evaluate {c/2, c, 2c}, +0.15·d off-octave penalty — replaces the `ACOUSTIC_CEIL` double-time rationale; the texture gates in biosonicBand stay). `mmr._featureSim`: all 5 dims, folded bpm, coefficients sum to 1; same-artist stays a hard 1.
Golden-set harness `tests/score.v2.golden.test.js`: fixed personas × fixed candidate pools → snapshot playlists; every deliberate re-baseline ships a before/after diff in the PR body. Property pins: monotone in featureFit; total bounded; 87 vs 174 bpm near-equivalent in similarity but NOT vs a 162-cadence anchor; band still un-relaxable.

### W4-008 · B4 trajectory planner — L · MUST · deps: 007 (uses `targets.trajectory` when present, sane defaults otherwise)
`backend/app/agents/runtime/delivery/trajectoryPlanner.js` — PURE: archetype curves `g(i)` over positions 1..k in (energy, valence, log₂bpm): warmup→peak→cooldown (double-sigmoid), monotone wind-down, flat low-variance focus, meet-then-lower stress arc, flat cadence-locked locomotion (cadence anchors NEVER folded). Choose archetype from `targets.trajectory?.archetype` ∨ activity ∨ tempoBand defaults. Assignment minimizes §M.11 cost via dominant-axis greedy + 2-opt sweeps (≤3 passes; beam-8 fallback); featureless tracks placed at low-constraint positions.
Wire in `selection/pipeline.js` between `select(scored,{k})` and the return: `const ordered = planTrajectory(picks, {targets, k})` → `tracks: ordered.map(p => p.track)`; telemetry gains `trajectory: {archetype, cost, folded}`. Skip-triggered regeneration passes a replan-from-position hint when the client provides one (full mid-session replanning deferred — mobile telemetry doesn't exist; checklist item).
Tests: `tests/trajectoryPlanner.test.js` — arc monotonicity per archetype; max octave-folded neighbor tempo jump under threshold (no 70→160); cadence archetype flat; ORDER-ONLY invariant (same track set in = same set out — pinned); determinism under seed.

### W4-009 · A7 live analysis & state-triggered recalibration — M · SHOULD · deps: 006
`backend/app/agents/runtime/physiology/liveStateAdapter.js`: Redis-held HMM forward vector per user (AAD-bound encrypted blob, TTL ~2h), `onlineUpdate(filteredReading) → {transitioned, from, to}` in O(1) via affectEngine's forward step.
`recalibrateForBand` (D11's full fix): fire on CONFIRMED taxonomy-state transitions whose `band`/musicPolicy differs, min-dwell honored — replaces the ±10/±25 delta gates; shadow-buffer keys stay `bio:<band>:<activity>`; serve-on-play semantics preserved; Redis-down degrades to W4-001 band-crossing behavior (fail-soft).
Tests: persona replay — workout onset → exactly ONE recalibration at episode start, none during steady state; sub-band wiggle → zero churn; Redis-down degradation pin; liveMode tripwire re-pinned.

### W4-010 · B1 taste profile v2 — M · SHOULD · deps: 001
`musicProfileService.js`: per-entry `lastSeenAt` (model field) + read-time recency decay `affinity·e^(−Δdays/τ)` (τ ≈ 90d, env-tunable); `_weightedMergeRanked` provider weights log-saturated (`log1p(librarySize)` — kills the 2000-item-playlist 40× dominance); `recomputeFootprint` re-uses the build-time rank-weighted algorithm (kills the dual-algorithm drift).
NEW `backend/app/services/selection/genreFamilies.js`: static curated 2-level map (~150 genres → ~15 families) consumed by score's genre term for partial credit (exact 1.0 / same-family 0.7 / none 0.3 / unknown 0.5) — static data, zero ADR-0012 exposure.
**Compliance line (ADR-0012):** any taste centroid over ReccoBeats features is serve-time-only/in-memory (computed in the pipeline context stage); a PERSISTED centroid may only be built from `mbid:` features. Tests: decay monotonicity; merge saturation; family partial-credit ordering; footprint parity.

### W4-011 · B6 feedback loop + RewardEvent — L · SHOULD · deps: 003 (needs persisted live HR), 006 (state buckets)
`backend/app/models/RewardEvent.js`: (a) context-bucket aggregates `{userId, bucket:{stateDomain, targetBand, hourBin}, rewardSum, count, updatedAt}`; (b) SEPARATE CC0-only track posteriors `{recordingKey, alpha, beta}` with a schema-level validator REJECTING any key not matching `/^mbid:/` (fail-closed, mirrors `_dropRestricted`).
`backend/app/agents/runtime/learning/feedbackLoop.js`: biometric reward = observed-vs-expected HR slope over a play window (≥120s, ≥5 samples; expectation = Kalman trend at track start), signed by the archetype goal (§M.12); behavioral reward (skip<30s −1, later skip −0.3, complete +0.3, save/replay +1); combined 0.6/0.4 when both exist; noisy/insufficient → NO-OP (never over-correct). Socket accepts `playback_event {type: skip|complete|save, positionMs, trackKey?}` — the existing `track_skipped` handler forwards into it (mobile emission of complete/save → on-device checklist). Processing on the existing worker seam (reuse or add a queue per the real `queues/definitions.js`).
Tests: reward sign correctness on persona scripts (HR falls faster than counterfactual on calm target under stress → positive); `mbid:`-guard tripwire; bucket aggregation idempotency; no-op on thin data.

### W4-012 · A6 daily analysis + MorningState — M · SHOULD · deps: 004
`backend/app/models/MorningState.js` (per user/day, encrypted scalars: readiness composite, sleep debt, cosinor snapshot, CUSUM trend flags). `backend/app/agents/runtime/physiology/dailyAnalysis.js`: nightly per-user consolidation — baselines refresh, cosinor refit, sleep-debt update, readiness composite, CUSUM change-point detection (§M.13) on daily RHR/HRV residuals. BullMQ repeatable job registered in the in-process worker index.
Tests: persona month replay — injected 10-day RHR drift flagged within ≤4 days of breach; no flag on stationary noise; job summaries carry zero vitals.

### W4-013 · B5+B7 bandit novelty + PersonalWeights — M · STRETCH (ships dark) · deps: 011
`backend/app/agents/runtime/knowledge/noveltyController.js`: Thompson sampling per context bucket (Beta(2,2) priors) → `noveltyBudget = round(k·min(0.3, θ))` consumed where the pipeline sets its discovery ratio. `backend/app/agents/runtime/learning/personalization.js` + `models/PersonalWeights.js`: bounded trust-region overlay on `score._resolveWeights()` (§M.15) — the seam score.js's own ADR-0011 header reserves; shrink-to-global weekly; cold start = global weights.
Tests: DORMANCY INVARIANT — with no reward data, selection is byte-identical to today (R17 pattern); posterior math; trust-region bounds; `mbid:`-only track posterior gate.

### W4-014 · B3 embedding v2 dual-write — L · STRETCH (cutover HITL-blocked) · deps: 007 + W16 resolved in 000
`buildVectorV2` in `services/vector/embedding.js`: audio block `[energy, valence, acousticness, danceability, loudness_norm, sin(2π·log₂bpm), cos(2π·log₂bpm)]` (7 dims) and genre block (128-dim FNV hash, IDF-weighted §M.16) NORMALIZED SEPARATELY, composed `[0.8·audio ; 0.6·genre]` (tag-count invariant); model tag `v2-deterministic`; `services/vector/idfStats.js` (corpus genre document frequencies, cached). Dual-write behind `EMBEDDING_V2_WRITE` in the real `embedding.worker.js`; backfill job; read cutover behind `EMBEDDING_V2_READ`. **Atlas `numDimensions` is immutable per index → new index name (`track_embedding_index_v2`) is a Daniel portal action → HITL tutorial; everything ships dark.** `docs/adr/ADR-0014-embedding-v2.md`.
Tests: octave-neighbor cosine ≥ same-tempo-different-genre; tag-count invariance; v1 path byte-identical while flags off.
**W16 RESOLVED (W4-000 review, 2026-08-18):** stored v1 vectors are ALREADY genre-free — `embedding.worker.js` always calls `buildVector(doc, [])` (PR #139 dilution fix) and only `mbid:` keys reach the index; the discovery corpus is ~98% genre-less (`discoveryFetch.js` header). So D19's tag-count crush is LATENT in `buildVector`, not live in the stored index, and v2's genre block is a deliberate RE-introduction: IDF stats must handle a mostly-genre-less corpus (df≈0 → capped weights; an empty genre block stays exact-zero so genre-less↔genre-less cosine is unchanged vs audio-only), and the interplay with `DISCOVERY_FEATURE_ONLY_TARGET` (default ON) + the dormant genre-Jaccard scoring seam (`DISCOVERY_GENRE_RELEVANCE`, `discoveryVectorService._scoreTotal`) must be preserved. REQUIRED READING: `docs/plans/mbid-representation-recalibration-vs-genre-seam.md` (tracked draft, 2026-07-15) — measured prod evidence of mbid under-representation + per-dim feature distributions directly relevant to the v2 design.

### W4-015 · Soak, closeout & the package — M · MUST · deps: whatever landed (ALWAYS runs on day 4 or when the queue empties)
1. 24h-simulated soak (`RUN_SOAK=1`) across all personas through the full stack: state dwell histograms plausible per persona; no label flap; recalibrations bounded; every taxonomy state hit; no unbounded memory growth. Soak report saved.
2. `docs/plans/WAVE4_REPORT.md` — the master report for Daniel: what landed per task (with test evidence), what didn't and why, every deliberate behavior change with before/after, the golden-set diffs, the soak results, the full HITL decision matrix, the PR queue with URLs, and a "first 30 minutes back" guide.
3. Docs truth: new `docs/GROUND_TRUTH_<date>.md`; `KOKONADA_ARCHITECTURE_MASTER.md` §0 refresh (the doc is ~100 PRs stale — update the current-state section, supersede honestly); `docs/SCREENS.md` untouched (no UI this wave).
4. HITL decision matrix (in REPORT + STATE): Atlas v2 vector index creation; prod index builds (VitalSample, RewardEvent, MorningState); personal band thresholds behind coarse keys (deferred decision); taxonomy display-label vocabulary → compliance review; embedding read-cutover; consent v2 activation plan; mobile follow-ups.
5. On-device verification checklist for Daniel: real watch data through the new live lane; `tzOffsetMinutes` emission from mobile; `playback_event` emission; Pulse/MorningState surfacing; APK smoke.

---

## M. MATHEMATICAL APPENDIX (implementation-ready)

- **M.1 Hampel + slew:** window 7 (or 60s): reject if `|x − med| > 3·1.4826·MAD`; slew reject if `|Δx/Δt| > 8 bpm/s`; rejected → propagate prediction, confidence ×0.7.
- **M.2 Kalman [level ℓ, trend b], irregular Δt:** predict `ℓ⁻=ℓ+bΔt`, `b⁻=b`, `P⁻=FPFᵀ+Q`, `F=[[1,Δt],[0,1]]`, `Q=q[[Δt³/3,Δt²/2],[Δt²/2,Δt]]` (q tuned for ~30s trend response); update (H=[1,0]): `y=z−ℓ⁻`, `S=P⁻₀₀+R` (R≈9 ≙ 3bpm wrist noise), `K=P⁻Hᵀ/S`, `x=x⁻+Ky`, `P=(I−KH)P⁻`; innovation gate `|y|/√S>3` → skip update; reading confidence `c=exp(−y²/2S)`.
- **M.3 Cosinor (24h):** `y = M + β cos ωt + γ sin ωt`, `ω=2π/24`; weighted LSQ over the 24 hour-bin means (weights = bin counts); `A=√(β²+γ²)`, acrophase `φ=atan2(γ,β)·24/(2π)`; require ≥6 populated bins ≥2h apart, else population prior `{M: rhrMedian, A: 4, φ: 15.0}`.
- **M.4 Shrinkage (empirical Bayes):** `μ̂=(n·x̄+k·μ₀)/(n+k)`; k: RHR 20, HRV 15, hour-bins 10 (toward the user's own overall, which shrinks toward population); `confidence=n/(n+k)`. Replaces MIN_SAMPLES cliffs everywhere. **Unit note (reflection #3, closes W4-D12): those k values are pseudo-SAMPLE counts.** Where an engine counts DAYS (samples within a day are near-perfectly correlated, so `baselineEngine` collapses each local day to one observation), use the variance-derived weight this formula reduces to — `n/(n + σ_w²/σ_b²)` with σ_w the within-person and σ_b the between-person spread, i.e. `k = 1` prior-observation in a precision-weighted fusion. Verified: with σ converted from MAD consistently (×1.4826 on both sides), the two forms are algebraically identical; applying the literal `k = 15` to a day count instead shrinks a genuine 85 ms athlete HRV to 71.7 ms after a full month. W4-005/012 should not re-litigate this.
- **M.5 HMM forward + hysteresis:** emission `b_s(e)=Π_axes N(e_a; μ_{s,a}, σ_{s,a})` over axes the state constrains (missing axis → factor 1); `A(s,s)=exp(−Δt/τ_s)` (τ_s = dwell prior 3–30 min), off-diagonal mass 70% within-domain / 30% cross; `α_t(s) ∝ b_s(e_t)·Σ A(s',s)α_{t−1}(s')`, renormalized (|S|≈32 → ~1k mults, trivially real-time); report-label switch only if `α(s*)>α(cur)+0.1` AND dwell ≥ minDwell, or `α(s*)>0.5` with enter threshold met.
- **M.6 Sleep debt:** `D_t = clamp(0.85·D_{t−1} + (need − actual_t), 0, D_max)`; need = personal weighted-night baseline (existing `STAGE_WEIGHTS {deep:1.5, light:1.0, rem:1.2}`); alertness = circadian phase term − w_D·D/D_max. (Full Borbély two-process: CUT this wave, formula pinned in ADR-0013.)
- **M.7 Karvonen zones:** `HRR = HRmax − RHR`; zone bounds `RHR + [.5,.6,.7,.8,.9,1.0]·HRR`. No DOB stored → never an age formula.
- **M.8 Exertion:** `E = clamp01((HR − RHR)/(HRmax − RHR))`.
- **M.9 Score v2:** `total = Σ_d w_d·c_d·k_d(track) − w_exp·exposure`, `Σ_d w_d = 1` per mode; kernels `k_d = exp(−½((x−μ_d)/σ_d)²)`; σ_energy = band half-width, σ_valence = 0.25; missing dim → prior 0.5 at 0.3 mass; c_d source-tiered 1.0/0.85/0.7.
- **M.10 Octave-folded tempo:** `d(b₁,b₂) = min_{o∈{−1,0,1}} |log₂b₁ − log₂b₂ − o|`; kernel σ ≈ 0.12 octaves; cadence anchors: evaluate {c/2, c, 2c}, best + 0.15·d off-octave penalty; NEVER fold the anchor itself.
- **M.11 Trajectory cost:** positions i=1..k, curve `g(i)` in (energy, valence, log₂bpm): `C = Σ_i ‖f_{π(i)} − g(i)‖²_W + 0.6·Σ_i [d_oct(π(i),π(i+1))² + Δenergy²]`, W = (1.0, 0.5, 0.8); dominant-axis greedy seed → 2-opt sweeps (≤3 passes) → beam-8 fallback if degenerate.
- **M.12 Reward:** over a track play window (≥120s, ≥5 samples): `r_bio = clamp[−1,1](((slope_expected − slope_observed)/σ_slope) · goal)` (goal = −1 for down-regulation archetypes, +1 for activation); `r = 0.6·r_bio + 0.4·r_beh` when both exist, else the one present; aggregate to bucket (stateDomain × targetBand × hourBin); Beta posterior updates ONLY for `mbid:` keys.
- **M.13 CUSUM:** daily residual `z=(x−μ_chronic)/σ`; `C⁺=max(0, C⁺+z−0.5)`, `C⁻=max(0, C⁻−z−0.5)`; flag at 4.
- **M.14 Thompson novelty:** per bucket Beta(α,β), priors (2,2); sample θ; `noveltyBudget = round(k·min(0.3, θ))`; positive discovery reward → α+=1, early skip → β+=1.
- **M.15 PersonalWeights trust region:** `w_user = clamp(w_global·(1+δ), 0.6·w_global, 1.4·w_global)`; `δ ← δ + 0.02·r·∂`; weekly shrink `δ ← 0.98·δ`.
- **M.16 IDF genre block:** `w_g = log(1 + N/df_g)`; `v[FNV(g) mod 128] += w_g`; L2-normalize the block; compose `[0.8·v_audio ; 0.6·v_genre]`.

## R. RISK REGISTER (consult before each risky task)

1. Handler-rewrite cascade vs the 109KB pipeline suite → pin current semantics FIRST (W4-001), change internals behind identical observable triggers, run that suite in isolation after every handler edit, rule-of-2.
2. Cross-session context loss → STATE is the single resume source; one task per session; NO mid-run re-planning.
3. ADR-0011/0012 breach via a careless learned artifact → schema `mbid:` guards, tripwire tests, per-learning-PR compliance checklist.
4. Pause & Guide stalls → never block: ship dark/flagged + HITL tutorial, continue.
6. Invisible selection-quality regression → golden-set snapshots with reviewable diffs in every scoring/trajectory PR body.
7. Windows env traps → §0.3 pinned commands only.
8. Parallel-session collision (PR #78 precedent) → fetch + SHA check each session; divergence → HITL, never auto-rebase mid-task.
9. Encryption mistakes → AAD 3rd arg; `$set` skips setters (encrypt explicitly / use `.save()`); every new encrypted field ships a round-trip test.
10. Circular sim validation → holdout personas with a different noise family; property invariants independent of personas; literature bounds as absolute checks; real-data validation stays on the on-device checklist.
10. Clinical-sounding label leakage → labels encrypted at rest, never in prompts/logs, display vocabulary is a compliance-gated HITL item.

## S. STOP CONDITIONS

- `docs/plans/WAVE4_HALT` exists → stop (the loop checks it; sessions must too).
- 3 consecutive failed sessions → write WAVE4_HALT with the failure summary.
- Any suspected secret exposure, force-push need, prod-data risk, or consent-scope widening → WAVE4_HALT + HITL entry. When in doubt, halt is the safe move — but a red TEST is not a halt, it's the loop working.
