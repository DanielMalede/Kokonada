# MASTER EXECUTION BLUEPRINT — 2026-07-07 (Orchestrator-Fable, Phase 2 — APPROVED)

> Companion to `GROUND_TRUTH_2026-07-07.md`. Approved by Daniel 2026-07-07 with the gate
> decisions recorded below. **Phase 3+ (squad dispatch) starts only on an explicit
> `EXECUTE BLUEPRINT`, on an Opus 4.8 session** per `docs/ORCHESTRATOR_FABLE.md`
> `<model_economy>`. Every task: branch-per-task, strict TDD (RED→GREEN→REFACTOR),
> Resilience Audit posted on the PR, `<definition_of_done>` gates, short single-line commits.

## GATE DECISIONS (Daniel, 2026-07-07)

| Decision | Ruling |
| :--- | :--- |
| HITL-1 (stale master §0) | **A — refresh §0 now** (Wave 0.3 docs-only PR) |
| D1 frontend-tooling resume | **ACCEPT** (Wave 2) |
| D2 music-classification-purge | ~~SHELVE~~ → **RESOLVED Option A (2026-07-07): accept PR #78 as shipped** (implementation merged by a parallel session). Prod `classifyAndHydrate` purge remains a separate Pause & Guide item (Wave 2.7) |
| D3 ADR bootstrap | **ACCEPT** |
| D4 Railway hydration verify | **ACCEPT** (read-only check) |
| D5 frontend/watch gap-scan | **ACCEPT** (on Opus, pre-Wave-2.5) |

## Wave 0 — Baseline Integrity & Hygiene (first in queue; 0.1 is non-blocking since baseline is green)

| # | Task | Package | Model | Acceptance (TDD) | Blast radius |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 0.1 | ~~Hunt & pin the flaky backend test~~ → **CLOSED (2026-07-07): no flake on `main`.** The Phase-1 transient failure was on the pre-#78 branch (now deleted); `main` (91 suites / 1126 tests) ran **green 5 consecutive times**. Nothing to pin. Re-open only if it recurs in CI | backend | — | 5 green runs on main (done) | none |
| 0.2 | **Repo hygiene:** switch checkout to `main`; delete merged branches (`feat/spotify-playback-turbomodule`, `feat/biometric-buffer`, merged `fix/*` — grep-proof each); commit `docs/ORCHESTRATOR_FABLE.md`; fold `claude_handoff.md` into docs or mark-for-deletion; merge the D2 spec commits into `docs/` (shelved, post-launch) | repo | Sonnet | `git branch` lists only live work; tree clean | none (git only) |
| 0.3 | **Master §0 refresh** — docs-only PR updating §0 to post-#77 reality + new baselines (HITL-1 = A) | docs | Opus | §0 accurately lists PRs #52–#77, baselines, new roadmap | authority-chain root — Daniel reviews the PR |
| 0.4 | **D3: ADR bootstrap** — create `docs/adr/`, seed with the locked decisions (100%-free, RN migration, design-for-both infra, no pure-LLM features, zero-knowledge biometrics) + Squad-1 in-process-workers decision | docs | Sonnet | ADRs exist, master stays lean | docs only |
| 0.5 | **D4: Railway hydration verify** — read-only CLI check that account `6a4b992f0e82ab8ed85e8d9a` has `missing=0` featureless tracks; if incomplete, HITL on recreating the driver | ops (read-only) | Sonnet | verified count reported | none |

## Wave 1 — Squad 6: On-Device Verification (immediate next per master §0) + CI on-ramp

| # | Task | Package | Model | Acceptance | Blast radius |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1.1 | **On-device QA checklist** — strict manual script for the physical Galaxy, run via **Pause & Guide**. Scope has GROWN past A11: login → generate → **Spotify App Remote playback (#77)** → **Live-mode band-drive + shadow-buffer serve (#76/#77)** → history → profile → logout → GDPR delete → pulse gauges | mobile (no code) | Opus writes checklist; Daniel executes | every item PASS or a filed defect task | none (manual QA) |
| 1.2 | **Mobile into CI** (from A13, pulled forward — cheap, protects every later wave) — add mobile jest job to `ci.yml` | .github | Sonnet | PR CI runs mobile suite green (48/416) | CI only |

## Wave 2 — Parallel squads (dispatch together after Wave 1)

| # | Task | Package | Model | Acceptance | Blast radius |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 2.1 | **A12: Apple Sign-In** (App-Store-mandatory; Apple Developer portal steps = Pause & Guide) | mobile + backend | Opus | native flow + backend verify, tests green | auth plane — cross-package |
| 2.2 | **A12: free-tier Entitlements scaffold** — RevenueCat fully-free tier, **NO paywall/subscription UI** (locked) | mobile | Sonnet | scaffold present, zero UI, tests pinned | mobile only |
| 2.3 | **A12: privacy declarations + a11y/i18n/RTL completion** | mobile + docs | Sonnet | App Store nutrition / Play Data Safety drafted; a11y labels audited | mobile only |
| 2.4 | **A13: release pipeline** (fastlane or EAS) + **crash/telemetry** (Sentry + structured logs + SLOs per `<engineering_excellence>`) | mobile + backend | Opus | build pipeline produces signed artifact; Sentry events visible | CI + runtime |
| 2.5 | **Web Sunset** — remove `DiscoverPage` stub, `ActivityPanel`, `PlaylistDetailPage`, Garmin credentials form, offline-buffer player (all confirmed still present); keep Vercel domain for AASA/assetlinks + OG. **Pre-work: D5 gap-scan of `frontend/` + `watch/`** | frontend | Sonnet | web `tsc`+lint+build green; grep proves zero refs to removed surfaces; deep links intact | frontend only |
| 2.6 | **D1: resume frontend-tooling foundation** — rebase `worktree-frontend-tooling-foundation` (8 commits: Tamagui/Moti/Lottie/haptics/vector-icons/bootsplash) onto post-#77 main; on-device smoke; PR. Check file overlap vs 2.2/2.3 before parallel dispatch | mobile | Sonnet | mobile suite green; bootsplash + tamagui verified on device | mobile build config |
| 2.7 | **D2-followup: `classifyAndHydrate` prod run** (destructive non-music purge shipped in #78) — **Pause & Guide, not yet authorized.** Do NOT run without Daniel's explicit go-ahead; verify UnclassifiedTrack GDPR cascade + backup posture first | ops (destructive) | Opus | Daniel authorizes; purge count reported; reversible-by-rehydrate confirmed | **prod library data** |

## Wave 3 — Store submission (depends on 2.1–2.4) + engineering-excellence closure

| # | Task | Notes |
| :--- | :--- | :--- |
| 3.1 | Store submission (A13) | needs 2.1–2.4 + Daniel portal actions (Pause & Guide) |
| 3.2 | Test-depth outer loop | contract tests (Spotify/Groq adapters), one Detox/Maestro E2E (login→generate→play→logout), biometric soak test |
| 3.3 | Cost guardrails + cache hit-rate metrics | Groq TPM tracking (free 6000 TPM ceiling), alarm on anomaly |

## D2 CONFLICT — RESOLVED (Daniel, 2026-07-07 = Option A)

The D2 "SHELVE" ruling was overtaken by events: **PR #78 (full music-classification-purge implementation) merged to `main` 2026-07-07 07:58 UTC** from a parallel session in the `kokonada-wt-ws1` worktree — classifier + ingest gate + purge + unclassified pool + periodic reclassify worker + GDPR cascade. **Daniel chose Option A: accept #78 as shipped.** D2 is therefore moot; the earlier SHELVE ruling is void. Consequences:
- Wave 0.2's "merge the D2 spec into docs/" item is **superseded** (the spec merged with #78) — drop it.
- **Remaining open decision (NOT yet authorized):** the pending **`classifyAndHydrate` run against prod** — a destructive purge of non-music library entries. Treat as **Pause & Guide**; needs Daniel's explicit go-ahead before any run. Tracked as Wave-2 candidate below.

## Standing rules for the executing (Opus) session

- Read this file + `GROUND_TRUTH_2026-07-07.md` first; do NOT re-read the 647-line master except §0 (post-refresh).
- Dispatch = Developer Agent + Resilience Auditor per task; independent tasks in one turn; never with unmet dependencies.
- Rule of 2 (`<error_budget>`): two failed verifications → revert + escalate, never a third attempt.
- Cloud portals = Pause & Guide, always. Never add a `railway up` CI job.
- Re-invoke Fable ONLY to re-adjudicate a conflict this Blueprint explicitly flags (HITL-1 execution disputes, D2 un-shelving).
