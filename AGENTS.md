# Kokonada contribution rules

These instructions apply to the whole repository.

## Two partners, one repository

Two people change this repository in parallel: Daniel Malede (GitHub `DanielMalede`, the owner) and Daniel Bedrack (GitHub `DanielBedrack`). Elsewhere in this repository, "Daniel" means Malede. The repository has no branch protection, and a merge to `main` deploys the backend to production.

- **Start every task with `$coordinate`** (`.agents/skills/coordinate/SKILL.md`). It checks the other partner's live work on `origin`, and only when nothing collides it claims a slot in `WORK_LEDGER.md`, marks the `TASKS.md` row as taken and opens a draft PR. On HALT, stop and report; never work around it.
- **Before touching a file the task did not declare**, run `node scripts/coord/coord.js rescope --paths <full new set>` in the task worktree.
- **Never push to `main`.** Turn on the pre-push guard once per clone: `git config core.hooksPath .githooks`.
- **Merge only your own PRs,** one at a time, after `node scripts/coord/coord.js check --merge <PR>` is clear. Never push to, merge, close or rebase the other partner's branch or PR.
- **New `TASKS.md` IDs:** Bedrack takes them only from his block, `900` to `999` in every prefix; Malede from the file's "Next free IDs" header.
- **Owner-only:** `.claude/**`, `docs/design-v2/pages/**`, `docs/plans/WAVE4_STATE.md`, `DAN-` rows, and every production step (Atlas, Railway variables, store consoles, secrets).

## Working rules

- Work in a dedicated branch and worktree cut from `origin/main` (the claim creates both). Read files as `git show origin/main:<path>`, never from a stale local `main`.
- Stage by explicit path (`git add -- <path>`). Never `git add -A` or `git add .`.
- Commits are one short line, with no body and no trailers. Never add AI or assistant attribution anywhere: commits, PRs, code, comments or docs.

## CI is a merge gate

- Before committing, run the tests and static checks that cover the changed surface.
- Do not describe a change as complete or ready to merge until CI on the PR's current head commit has passed; a green run on an older commit does not count.
- Do not merge while any required job is failing, pending, cancelled or missing. A path-gated job may be skipped only when its workflow marks the changed surface as unaffected.
- When CI fails, read the failing job's logs, reproduce it when possible, fix the root cause and push the fix. Do not dismiss a failure as flaky without evidence; re-run the same commit only for a demonstrated infrastructure failure.
- Report the PR URL, the latest Actions run URL and the final check results when handing work back.
- Do not add GitHub Pages or any other public deployment path unless the owner approves it.
