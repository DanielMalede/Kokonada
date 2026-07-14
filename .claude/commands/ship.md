---
description: The ship flow — full-suite gate, PR, resilience audit, await merge.
---
Ship the current task per docs/ORCHESTRATOR_FABLE.md <pr_workflow>. ultrathink.
Full-suite gate (backend `npm test`; frontend tsc+lint+build; mobile jest local) → commit (short single-line, no body/trailers, NO AI attribution) → push branch → `gh pr create --body-file` → run the resilience-auditor and post the audit as a PR comment → confirm CI green → STOP and await my explicit merge approval. Never self-merge. Any red gate = task FAILED; report and stop.
