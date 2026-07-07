# GROUND TRUTH BRIEF — 2026-07-07 (Orchestrator-Fable, Phase 1)

> Persisted per `docs/ORCHESTRATOR_FABLE.md` `<model_economy>` so no later session re-spends
> Fable budget re-deriving it. Every claim below cites a real tool run on this machine.
> Downstream (Opus) sessions should read THIS + `MASTER_BLUEPRINT_2026-07-07.md`, not re-scan.

## 1. Test baselines (real runs, 2026-07-07, checkout `feat/spotify-playback-turbomodule` = merged #77 content)

| Surface | Result (measured on checkout `feat/spotify-playback-turbomodule`, = #77, pre-#78) | vs master §0 claim |
| :--- | :--- | :--- |
| Backend (`cd backend && npm test`) | **81 suites / 1007 tests (1006 passed + 1 todo)**; one run of three showed a single transient failure | Master claims 81/1006 → grown |
| Mobile (`./node_modules/.bin/jest` from `mobile/KokonadaHealth`) | **48 suites / 416 tests — all green** | Master claims 42/361 → grown, green |

> **⚠️ CORRECTED AT EXECUTION (2026-07-07, on `main` incl. #78):** the numbers above were
> measured on the pre-#78 branch. **True current-`main` backend baseline = 91 suites / 1126
> tests** (1125 pass + 1 todo) — #78 added ~10 suites / ~119 tests. Verified **green across 5
> consecutive full-suite runs** on main. The single transient failure above was on the now
> merged-and-deleted `feat/spotify-playback-turbomodule` branch and **did NOT reproduce on
> main** (Blueprint Wave 0.1 closes: no flake to pin). Mobile baseline unchanged (48/416).

- Mobile is still **not in CI** (`.github/workflows/ci.yml` only; zero mobile references — confirmed by grep).

## 2. CRITICAL FINDING — master §0 is itself stale

`KOKONADA_ARCHITECTURE_MASTER.md` §0 ("updated 2026-07-04… currently PR #51 merged") is **26 PRs behind reality**. `gh pr list --state merged` + `git log origin/main` show **PRs #52–#77 merged through 2026-07-06**, including: generation OOM fix (#56), generation timeout wedge (#63), empty-playlist/anti-repetition L4 (#64), WS1 feature hydration (#66), texture gates (#72), playlist-read scopes (#73), OAuth deep-link (#74), Groq 429 retry (#75), **biometric shadow buffer (#76)**, and **Spotify App Remote playback + full biosonic Part 2 / live-mode band drive (#77)**. The authority chain's root doc no longer describes the current state.
**GATE DECISION (Daniel, 2026-07-07): HITL-1 = Option A — refresh master §0 via docs-only PR (Blueprint Wave 0.3).**

## 3. Doc conflicts (confirmed by inspection — all three are historical vs master §0)

| Doc | Evidence | Verdict |
| :--- | :--- | :--- |
| `PLAN.md` | still contains Python-backend references (2 hits) | Historical snapshot |
| `UI_UX_MASTER_PLAN.md` | "Status: Implemented", describes the shadcn/Tailwind **web** UI now being sunset | Historical snapshot |
| `KOKONADA_SECURITY_DATA_AUDIT.md` | dated 2026-06-22; remediation table shows **all F1–F18 ✅ Fixed/Mitigated/Documented** | Fully remediated snapshot — **no open security items** |

## 4. Repo/branch reality

- **No open PRs.** Checkout `feat/spotify-playback-turbomodule` is fully pushed and already merged as #77 (squash) — safe to switch to `main` and delete.
- **Live unmerged work:**
  - `worktree-frontend-tooling-foundation` (`.claude/worktrees/frontend-tooling-foundation`, 8 commits): Tamagui/Moti/Lottie/haptics/vector-icons/bootsplash Tasks 1–6, paused because main's Spotify remote lib was dead — **#77 unblocked it**; needs rebase + on-device smoke + PR.
  - `feat/music-classification-purge` (worktree `kokonada-wt-ws1`, 2 **docs-only** commits): design spec for music-vs-non-music classification + hard purge (Groq-at-ingest, music-form allowlist, unclassified pool, periodic reclassifier). **Unimplemented, not in master roadmap.**
- **Stale local branches:** ~12 (`feat/biometric-buffer` = merged #76, `fix/*`, etc.) — janitor cleanup.
- Temp `_hydrateDriver.js`/`_rebuildDriver.js` already deleted from ws1 (verified).
- Untracked in repo root at scan time: `claude_handoff.md`, `docs/ORCHESTRATOR_FABLE.md`, `docs/superpowers/plans/2026-07-04-frontend-tooling-foundation.md`.

## 5. Gap analysis (bottom-up, budget-scoped per directive fallback)

Scanned: `mobile/KokonadaHealth/src` (deep) + `backend/` markers + CI + web sunset targets. **Deferred to a later Opus session:** full `frontend/` and `watch/` source sweeps (accepted as D5).

- **Zero `TODO|FIXME|HACK`** in mobile src and backend (clean).
- **Security audit:** nothing open (all 18 findings closed).
- **Squad 5 targets still live:** `DiscoverPage.tsx`, `PlaylistDetailPage.tsx`, `ActivityPanel`, `OfflineBanner` exist in `frontend/src` — sunset work is real and pending.
- **No `docs/adr/`** — the directive's ADR requirement is unmet (accepted as D3).
- **Open external thread (unverifiable from here):** Railway background hydration pass 2 for account `6a4b992f0e82ab8ed85e8d9a` — handoff says re-fire driver until `missing=0`; needs a read-only Railway check (accepted as D4).

## 6. ADDENDUM (2026-07-07, post-gate) — PR #78 merged by a parallel session

After the sections above were gathered, verification revealed **PR #78 "Music vs non-music classification + hard-purge (with unclassified pool + periodic reclassifier)" MERGED 2026-07-07 07:58 UTC** — the `feat/music-classification-purge` branch described in §4 as "docs-only, unimplemented" was fully implemented in the `kokonada-wt-ws1` worktree by a **parallel session** (commits incl. reclassify worker, classifyAndHydrate runner, GDPR-erasure cascade for `UnclassifiedTrack`). The local `origin/main` ref was stale, which is why §2's PR list tops out at #77. This conflicted with gate decision D2 (SHELVE); **Daniel resolved it 2026-07-07 = Option A: accept #78 as shipped** (SHELVE ruling void). The pending follow-up from that workstream — "run classifyAndHydrate against prod" (destructive purge) — remains **unauthorized** and needs Daniel's explicit go-ahead (Blueprint Wave 2.7, Pause & Guide).
