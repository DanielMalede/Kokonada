# AGENTS.md

**Read `CLAUDE.md` at the repository root first, in full. It binds you too.** Codex reads this file; the owner's tools read `CLAUDE.md`; both follow the same rules. Where this file and `CLAUDE.md` disagree, `CLAUDE.md` wins (`docs/design-v2/decisions/DEC-155.md`). This file only maps what `CLAUDE.md` names on the owner's side to what you use in Codex.

| In `CLAUDE.md` | In Codex |
|---|---|
| `/claim` and the `coordinator` agent | `$coordinate` (`.agents/skills/coordinate/SKILL.md`), the same engine: `node scripts/coord/coord.js` |
| `resilience-auditor` after every implementation, and `/ship`'s audit | `$resilience-audit` (`.agents/skills/resilience-audit/SKILL.md`): the same protocol, word for word, and `backend/tests/resilienceAuditor.contract.test.js` keeps the two copies identical. Run it in a fresh thread on the task worktree, after the suite is green and before `gh pr ready`; it posts its report on your PR and ends with `VERDICT: APPROVE @ <H>` or `VERDICT: BLOCK @ <H>`. On BLOCK, fix, push and audit again; `gh pr ready` only on APPROVE at the current head |
| The build agents and `/review-pr` (the approvals a merge needs) | Your PR's gate is your own audit, not the owner's side. Merge your own PR yourself when all of these hold: CI is green on its current head H; `node scripts/coord/coord.js check --merge <n>` exits 0, or 3 with each warning reported; your latest `Resilience audit for #<n> at <H>` comment ends with `VERDICT: APPROVE @ <H>`; it is outside 02:58–05:10 UTC. Then `gh pr merge <n> --squash --delete-branch --match-head-commit <H>`. A push, or a new head, means auditing again. The owner's side may run `/review-pr` or its own auditor on your PR as a second opinion; its records there are advice, never a condition of your merge |
| The `merge-guard` hook, and session start step 6 | After your merge, tell the owner's side, which runs `merge-guard` post-merge and posts its verdict on the PR; report any merged PR you see without that verdict to the owner's side |
| Session start, step 2 (the owner's main checkout) and step 3 (the sentinel's worktree) | Skip them |
| The deny list in `.claude/settings.json` | Codex does not load it: read its `permissions.deny` and never run a command it lists (force pushes, any push to `main`, `git reset --hard`, `git clean`, `git stash drop` and `clear`, `--mirror`, `gh pr merge --admin`, and the rest). Run `git config core.hooksPath .githooks` once in every fresh clone (the pre-push guard against pushes to `main`) |
| The models and `effort` lines | A file cannot set them for Codex, so you do, once per machine: every agent on the owner's side runs on the strongest model at maximum reasoning effort, and so does your work in this repository. Set your Codex model to the strongest one available and its reasoning effort to the highest it offers, for every thread here. Every audit report's `RUN:` line states the model and effort it ran on, so the depth is on the PR for both partners to see |

When you hand work back, report the PR URL, the latest Actions run URL and the final check results.

Your new TASKS IDs come only from your own block, `900`–`999` in every prefix. `DAN-` rows, the owner-only paths listed in `WORK_LEDGER.md` and every production step are the owner's.
