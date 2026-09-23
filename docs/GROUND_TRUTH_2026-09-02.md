# GROUND TRUTH BRIEF — 2026-09-02 (Wave 4 closeout, W4-015)

> Persisted per the rule `docs/GROUND_TRUTH_2026-07-07.md` established: every claim below cites a real
> tool run on this machine, so a later session does not re-spend budget re-deriving it. The narrative
> lives in `docs/plans/WAVE4_REPORT.md` (the closeout package) and `docs/plans/WAVE4_STATE.md` (the run's
> live task table, HITL queue and per-session evidence). This brief is the measured-facts snapshot the
> other two summarise.
>
> **Supersedes `docs/GROUND_TRUTH_2026-08-22.md`**, which is an untracked draft from a killed session
> (W4-D67). That draft is written in the past tense about work that had not happened — it claims the
> `KOKONADA_ARCHITECTURE_MASTER.md` §0 refresh and `WAVE4_REPORT.md` as done when neither existed — and
> its baseline (222/3523) is five re-baselines stale. **It is safe to delete.** Its §1 table was
> independently reproduced at the time and nothing in it is lost: everything still true has been carried
> forward here, re-measured.

## 0. Where this was measured

Isolated git worktree at `C:/tmp/kokonada-wave4`, branch `feat/intelligence-wave`, code HEAD `6ede4f8`,
**clean tree** (`git status --porcelain` empty apart from this session's own deliverables). The shared
working tree at `C:/Users/danie/Videos/Kokonada` was checked out on an unrelated branch with 11 live
`claude` processes and a concurrent session's uncommitted work in it, so it was not touched.

## 1. Test baseline (real runs, 2026-09-02)

| Surface | Result | 2026-07-07 baseline | Delta |
| :--- | :--- | :--- | :--- |
| Backend, `cd backend && RUN_SOAK=1 npm test` | **232 suites / 3866 tests** (3865 passed + 1 todo), `exit 0`, **0** `^FAIL` lines over the complete 869 KB log, 475.357 s | 91 suites / 1126 tests | +141 suites / +2740 tests |
| Lint, `npm run lint` | **0 errors / 22 warnings** — unchanged from every prior Wave-4 session's figure | no linter existed pre-wave (W4-D11) | linter added this wave |
| Mobile, `./node_modules/.bin/jest` | **out of scope this wave** (backend-only per the mission's §0.3) | 48 suites / 416 tests | untouched |
| Secret scan of the wave diff | `git diff 44fd951..HEAD` against `AIza\|ghp_\|sk-\|-----BEGIN\|eyJ[A-Za-z0-9_-]{30,}` — **29 matches, all of them the substring `sk-` inside ordinary words** (`risk-register`, `task-`). No credential material. | n/a | n/a |
| Attribution scan of the wave commits | `git log 44fd951..HEAD --format=%B` against `claude\|anthropic\|generated with\|co-authored-by` — **1 match, and it is a filename** (`docs/CLAUDE_DESIGN_PROMPT.md` in a commit subject), not attribution. | n/a | n/a |

> **On 232/3866 vs STATE's recorded 232/3868.** The difference is exactly two tests and it is explained,
> not unexplained: STATE's session-77 figure was measured in the shared tree, where a concurrent
> workstream's uncommitted `measureDiscoveryComposition.test.js` additions contribute +2. A clean
> checkout does not carry them. Suite count, pass count and exit code are otherwise identical, so the
> baseline is met, not regressed.

`RUN_SOAK=1` widens the two soak lanes from their strided defaults to the full population; it adds no
test cases, so the counts are directly comparable to a plain `npm test`.

## 2. The wave is merged into `main` — verified by content, not by PR status

- `origin/main` is at **`06af5d6`**. STATE's `lastMainSha` was `44fd951`; main has advanced by three
  commits since, and one of them is **`0e19ad8` — "Wave4 W4-007+W4-008" (PR #180)**.
- `git diff --stat origin/main feat/intelligence-wave -- backend/app/agents/runtime backend/sim
  backend/app/models` is **empty**. Every Wave-4 runtime module, the whole simulator and all four new
  collections are byte-identical on `main`.
- `docs/plans/WAVE4_STATE.md` differs from `main`'s copy by **one line** (this session's own edit), so
  the run's state files are on `main` too — which settles H8's question (1) by event.
- The only backend differences between `origin/main` and the wave branch run the *other* way: `main`
  carries the cookie-auth retirement (PR #184) and the Garmin Connect IQ watch-app retirement (PR #181),
  which the wave branch does not.

## 3. What exists now that did not exist on 2026-07-07

**New runtime subsystem, `backend/app/agents/runtime/`** — 16 modules. These are *not* Claude Code
sub-agents; see `docs/RUNTIME_AGENT_ARCHITECTURE.md` and `CLAUDE.md`'s disambiguation note.

- `ingestion/anomalyFilter.js` — Hampel → slew gate → irregular-Δt Kalman, per-reading confidence.
- `physiology/{baselineEngine,chronobiology,affectEngine,dailyAnalysis,liveStateAdapter}.js` — personal
  baselines (D1/D2/D14/D15), the cosinor circadian model (D13), the four-layer affect stack, nightly
  consolidation with CUSUM, and the live lane's O(1) per-reading posterior update (D11).
- `knowledge/{stateTaxonomy,noveltyController,explain}.js` — **34 states across 6 domains**, verified at
  source this session (`STATES.length === 34`, `DOMAINS` = 6), replacing the 9-rule classifier (D12).
- `translation/wellbeingRegulator.js` — the iso-principle `meet-then-lower` mechanism.
- `delivery/trajectoryPlanner.js` — 7 playlist arc archetypes.
- `learning/{feedbackLoop,personalization,playbackEvent,playWindow}.js` — the two-track ADR-0012 loop.
- `_shared/dto/telemetry.js` — zod schemas at the ingestion boundary.

**New collections** — `VitalSample`, `RewardEvent`, `MorningState`, `PersonalWeights`. All four are
registered in the account-erasure cascade, `userRedisPurge`, wearable-scoped erasure and
`userDataExport`, in the same PR that introduced them (S5), and the completeness guard discovers models
mechanically off the models directory rather than from a hand-maintained list.

**New simulator**, `backend/sim/` — `rng`, `personas`, `generator`, `replay`, `soak`, `stateScripts`,
`stateCoverage`. Seeded and deterministic, with holdout personas on a different noise family so
validation is not circular.

**New ADRs** — `docs/adr/0012-learning-compliance.md`, `0013-state-model.md`, `0014-embedding-v2.md`.

**Kill switches** (grepped fresh: `grep -rohE "WAVE4_[A-Z_0-9]+" backend/app backend/sim | sort -u`) —
`WAVE4_AFFECT_DISABLED`, `WAVE4_AFFINITY_DECAY_DISABLED`, `WAVE4_ANOMALY_FILTER_DISABLED`,
`WAVE4_BASELINE_ABSTENTION_DISABLED`, `WAVE4_BASELINE_ENGINE_DISABLED`, `WAVE4_CONSENT_V2_METRICS`,
`WAVE4_FEEDBACK_DISABLED`, `WAVE4_GENRE_FAMILIES_DISABLED`, `WAVE4_LLM_BAND_FROM_STATE_DISABLED`,
`WAVE4_NOVELTY_BANDIT`, `WAVE4_PERSONAL_WEIGHTS`, `WAVE4_PULSE_SUPERSET_DISABLED`,
`WAVE4_RECAL_STATE_TRIGGER_DISABLED`, `WAVE4_SCORING_V2_DISABLED`, `WAVE4_SERVE_LATCH_DISABLED`,
`WAVE4_TRAJECTORY_DISABLED`. Plus `EMBEDDING_V2_WRITE` / `_READ` / `_BACKFILL` and `SCORING_V2_SHADOW`.
(A seventeenth grep hit, `WAVE4_X_DISABLED`, is a literal inside a comment in `app/utils/envFlag.js`, not
a flag.) All parsing goes through one function and is pinned by `tests/wave4.killSwitchSpelling.test.js`.
You audited Railway's Variables on 2026-08-23 (H14): **no `WAVE4_` variable is set in production**, so
every flag is at its default.

## 4. Defect closure — spot-verified at source this session, not taken on trust

| Defect | Check run | Result |
| :--- | :--- | :--- |
| D4 (high stress forced happier music) | `grep "Math.max(moodValence" app/services/biosonic/translate.js` | 1 hit, and it is the **comment** explaining the removal. The live line is `valenceTarget = round3(clamp01(moodValence + Math.min(COMFORT_BIAS_MAX, COMFORT_BIAS_SLOPE * S)))`. |
| D5 (LLM prompt axis swap) | `grep -o "x = [a-z]*, y = [a-z]*" app/services/geminiEngine.js` | `x = valence, y = arousal` — matches the code's own definition. |
| D1 (personal HRV baseline never computed) | `grep -B2 -A2 hrvMedian app/services/biosonic/baselines.js` | present, and gated on `hasHrvEvidence` rather than a population constant. |
| D10 (live samples never persisted) | `grep -c _maybePersistLiveReading app/sockets/biometricHandler.js` | 4 |
| D12 (9-rule classifier) | `require('.../stateTaxonomy')` at runtime | `STATES.length = 34`, `DOMAINS` = 6 |
| D17 (cross-provider affinity scale collision) | `grep SOURCE_WEIGHTS.saved app/services/musicProfileService.js` | YouTube path now scores on the same `SOURCE_WEIGHTS` scale as Spotify. |

## 5. Taxonomy state coverage — the measured floors

Reproduced this session under `RUN_SOAK=1` (`tests/sim.stateCoverage.soak.test.js`, 25.1 s, 10/10 green),
exactly matching W4-D63's cited numbers:

| Lane | Real seam driven | Reached | Coverage | Structural blind spots |
| :--- | :--- | :--- | :--- | :--- |
| serving | `buildTargets` | **21 / 34** | 0.618 | **0** — every miss is `outcompeted`, `absent=none` |
| live | `liveStateAdapter.onlineUpdate` | **13 / 34** | 0.382 | **7** — 4 on `valence`, 3 on `recovery`/`stress` |

Both are pinned as floors. The serving lane's 13 misses are a geometry question, not a data question:
more simulated days cannot move them. The live lane's 7 need a client signal that does not exist yet.
Full per-state reasons: `docs/plans/WAVE4_SOAK_2026-09-02.md` §3.

## 6. Repo reality

- 336 commits on `feat/intelligence-wave` since `44fd951`; 79 sessions; 15 reflection passes.
- **`feat/intelligence-wave` is no longer a Wave-4-only branch.** It locally carries 12 design commits
  from a concurrent workstream, and `origin/feat/intelligence-wave` carries 2 commits the local branch
  lacks, so it cannot be fast-forward pushed. The Wave-4 code is unaffected — it is already on `main`.
- `docs/plans/WAVE4_STATE.md` is **336 KB** and `docs/plans/WAVE4_ARCHIVE.md` is **471 KB** — 807 KB of
  run state, now in `main`'s permanent history. STATE is 124 % over the mission's own 150 KB archival
  threshold; archival is a reflection-only action and the run's cutoff has passed, so it is recorded here
  as known debt (W4-D64) rather than actioned.
- Untracked in the shared tree and **deliberately not touched**: a concurrent design workstream's files
  (`design_handoff_quiet_instrument/`, several `docs/*_PROMPT.md`, `WEAKNESSES_AND_FAILURES.md`), the
  `mobile/src/health/config.ts` credential fill-in, and the path-mangled Android keystore duplicate that
  H15 / W4-D83 is about.

## 7. Open, and where it is tracked

- **6 open HITL items**, one of which (H16) this closeout answers with its own documented default. Full
  matrix: `WAVE4_REPORT.md` §8.
- **46 open discovered-backlog rows**, all `class: improve`. **Zero `repair`-class rows are open.**
  Exactly one is MUST-tier: W4-D83, the keystore ignore glob.
- **Error budget: 0 consecutive failed sessions.** No task ever hit the rule-of-2.
