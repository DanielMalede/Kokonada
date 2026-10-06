# AGENTS.md

**Read `CLAUDE.md` at the repository root first, in full. It binds you too.** Codex reads this file; the owner's tools read `CLAUDE.md`; both follow the same rules. Where this file and `CLAUDE.md` disagree, `CLAUDE.md` wins (`docs/design-v2/decisions/DEC-155.md`). This file only maps what `CLAUDE.md` names on the owner's side to what you use in Codex.

| In `CLAUDE.md` | In Codex |
|---|---|
| `/claim` and the `coordinator` agent | `$coordinate` (`.agents/skills/coordinate/SKILL.md`), the same engine: `node scripts/coord/coord.js` |
| The build agents and `/review-pr` (the approvals a merge needs) | Ask the owner's side to run `/review-pr <n>` on your PR. Merge it yourself only when its latest approvals comment from `DanielMalede` shows every required approver at a SHA that still holds at your head, `merge-guard` GREEN, and no owner-approval class left open; a `security-auditor` BLOCK lifts only on its re-review or the owner's acceptance |
| The `merge-guard` hook | Read `merge-guard`'s line in the approvals comment. After your merge, tell the owner's side, which runs `merge-guard` post-merge and posts its verdict on the PR |
| Session start, step 2 (the owner's main checkout) and step 3 (the sentinel's worktree) | Skip them |
| The deny list in `.claude/settings.json` | Codex does not load it; obey it yourself: never push to `main`, never force-push, never `git reset --hard`, `git clean`, `git stash drop` or `gh pr merge --admin`. Run `git config core.hooksPath .githooks` once in every fresh clone (the pre-push guard against pushes to `main`) |
| The models and `effort` lines | Not applicable |

When you hand work back, report the PR URL, the latest Actions run URL and the final check results.

Your new TASKS IDs come only from your own block, `900`–`999` in every prefix. `DAN-` rows, the owner-only paths (`.claude/**`, `docs/design-v2/pages/**`, `docs/plans/WAVE4_STATE.md`) and every production step are the owner's.
