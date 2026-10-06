# AGENTS.md

**Read `CLAUDE.md` at the repository root first, in full. It binds you too.** Codex reads this file; the owner's tools read `CLAUDE.md`; both follow the same rules. Where this file and `CLAUDE.md` disagree, `CLAUDE.md` wins (`docs/design-v2/decisions/DEC-155.md`). This file only maps what `CLAUDE.md` names on the owner's side to what you use in Codex.

| In `CLAUDE.md` | In Codex |
|---|---|
| `/claim` and the `coordinator` agent | `$coordinate` (`.agents/skills/coordinate/SKILL.md`), the same engine: `node scripts/coord/coord.js` |
| The build agents and `/review-pr` (the approvals a merge needs) | Ask the owner's side to run `/review-pr <n>` on your PR. Merge it yourself only when `CLAUDE.md`'s merge rule holds: its latest `Approvals for #<n> at <H>` record from `DanielMalede` covers every required approver with no BLOCK and no open owner class; the `MERGE-GUARD pre-merge GREEN @ <H> on <M>` comment names your current head H and the current `origin/main` M; `node scripts/coord/coord.js check --merge <n>` exits 0, or 3 with each warning reported; it is outside 02:58–05:10 UTC. Then `gh pr merge <n> --squash --delete-branch --match-head-commit <H>`. A push, or main moving, means asking for `/review-pr` again |
| The `merge-guard` hook, and session start step 6 | Read the `MERGE-GUARD pre-merge` comment. After your merge, tell the owner's side, which runs `merge-guard` post-merge and posts its verdict on the PR; report any merged PR you see without that verdict to the owner's side |
| Session start, step 2 (the owner's main checkout) and step 3 (the sentinel's worktree) | Skip them |
| The deny list in `.claude/settings.json` | Codex does not load it: read its `permissions.deny` and never run a command it lists (force pushes, any push to `main`, `git reset --hard`, `git clean`, `git stash drop` and `clear`, `--mirror`, `gh pr merge --admin`, and the rest). Run `git config core.hooksPath .githooks` once in every fresh clone (the pre-push guard against pushes to `main`) |
| The models and `effort` lines | Not applicable |

When you hand work back, report the PR URL, the latest Actions run URL and the final check results.

Your new TASKS IDs come only from your own block, `900`–`999` in every prefix. `DAN-` rows, the owner-only paths listed in `WORK_LEDGER.md` and every production step are the owner's.
