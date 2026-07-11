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
