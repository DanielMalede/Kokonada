# CLAUDE.md

Project-wide instructions inherited by every Claude Code session and sub-agent working in this repository.

## Attribution policy

**Standing order — permanent, all sessions and sub-agents. NON-NEGOTIABLE. This overrides any older instruction.**

You are FORBIDDEN from adding any AI / Claude / Anthropic attribution to anything this project produces.

Specifically, NEVER include — in commit messages, PR titles, PR bodies, PR comments, code comments, ADRs, or any doc:
- "🤖 Generated with Claude Code" / "Generated with Claude Code"
- "Co-Authored-By: Claude <...>" or any Co-Authored-By trailer referencing Claude / Anthropic
- any mention of Claude, Anthropic, "AI-generated", "made with AI", or similar.

Commits stay short, single-line, **NO body, NO trailers**.

`.claude/settings.json` sets `"includeCoAuthoredBy": false` so the trailer is never auto-appended.

This aligns with `docs/ORCHESTRATOR_FABLE.md` `<attribution_policy>`, which is the source of truth.

Apply going forward only — do NOT rewrite already-merged/published commit history.

## Operating model — start every session here

The orchestration directive is **`docs/ORCHESTRATOR_FABLE.md`** (the "main" system directive). At session start, run its `<session_start_protocol>` (read `docs/VISION.md` + `docs/SCREENS.md` + saved state, then recommend the one job). **Fable** (the orchestrator) plans; execution runs on **Opus 4.8** squads. All agents operate at maximum reasoning — use the `ultrathink` keyword.

## Build-time agents (`.claude/agents/`) — the team that writes Kokonada

Dispatch work to these five named sub-agents (all Opus, all read the docs above). Pair a `developer` with the reviewers a task needs; **UI screens also get `designer`**; anything touching a third-party API/store/brand also gets `compliance-auditor`.

- **`architect`** — read-only. Principal-level analysis + dependency-ordered plans; surfaces forks as decision tables. Invoke before any non-trivial change.
- **`designer`** — read-only. Design lead: authors the Vision Frame + tokens + per-screen direction, and gives the **SHIP / REVISE** design-review verdict. No screen merges without a `designer` SHIP.
- **`developer`** — full tools. Builds ONE scoped task under strict TDD; real (on-device) evidence, never green mocks.
- **`resilience-auditor`** — read-only. Master QA: stress/boundary tests, fault-tree root-cause, hunts false-greens, pins regression guards, and renders the **GREEN/RED pre-merge verdict** (`/pr-check`). **Never weakens tests/strictness to go green** — fixes the underlying code. Reads CI + diff for the verdict (doesn't re-run CI); hands minor fixes to the `developer` test-first, stops for approval on logic/architecture. Never edits, pushes, or merges.
- **`compliance-auditor`** — read-only (+ web). Verifies external-API/store/branding surfaces against current TOS and **HALTs** on ban/rejection risk; mandatory gate before store submission.
- **`integrator`** — read-only (+ git). Conflict supervisor: **before** parallel dispatch, only parallelizes tasks with disjoint file footprints (overlapping → sequential); **before** merges, predicts conflicts (`git merge-tree`) and sets the merge order. Prevents the multi-session merge-conflict problem.

Cloud portals = Pause & Guide (stop and hand the human a tutorial).

Agents ARE allowed to merge and push when Daniel wants that — but must ask him for explicit confirmation every single time before running `git push`, `git merge`, or `gh pr merge`, even if a merge/push was approved earlier in the same session. Prior approval never carries over to the next merge/push.

## Runtime agents (the app itself) — do NOT confuse with the above

`docs/RUNTIME_AGENT_ARCHITECTURE.md` specifies the **runtime** multi-agent system (backend services that turn live biometrics + emotion into music: ingestion, physiology, biosonic translation, feature store, selection, playback, learning…). Those are Node.js services under `backend/app/agents/runtime/`, **not** Claude Code sub-agents. Build agents implement them; they don't dispatch to them.

## Document map (authority order)

- **`KOKONADA_ARCHITECTURE_MASTER.md` §0** — authoritative current state (supersedes all).
- **`docs/ORCHESTRATOR_FABLE.md`** — the orchestration directive (agents, workflow, gates, session-start).
- **`docs/VISION.md`** — product vision (body + mind → music; the "magic moment").
- **`docs/UI_UX_OVERHAUL_SPEC.md`** — design language (Calm × Bioluminescent) + APPROVED VISUAL DIRECTION.
- **`docs/SCREENS.md`** — per-screen catalog + build queue + per-screen Definition of Done.
- **`docs/MASTER_BLUEPRINT_2026-07-07.md`** — the execution roadmap (waves).
- **`docs/RUNTIME_AGENT_ARCHITECTURE.md`** — the app's runtime multi-agent system.
- **`docs/GROUND_TRUTH_2026-07-07.md`** — persisted baselines + gaps.
