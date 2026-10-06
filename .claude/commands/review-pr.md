---
description: Review a PR under the merge rule — dispatch every approver its diff requires and merge-guard, then post the approvals comment. Never merges.
argument-hint: [PR number]
---
Review PR #$ARGUMENTS under the merge rule in `CLAUDE.md`. ultrathink. You never merge, push, edit the PR's branch, or approve anything yourself; the session that wrote the code never counts as a reviewer. This is also how Bedrack's PRs are reviewed. Run it from the owner's side (`gh` signed in as `DanielMalede`): `merge-guard` accepts no other author for the approvals comment.
1. `git fetch origin`. Read the head H (`gh pr view $ARGUMENTS --json headRefOid --jq .headRefOid`), M (`git rev-parse origin/main`), the author and the body. A draft: say so and stop. A design-v2 page PR is judged by /page G13: say so and stop.
2. The changed files: `git diff --name-only --no-renames "$(git merge-base "$M" "$H")" "$H"` (both sides of a rename count). Map each through the `jurisdiction` block of `CLAUDE.md` as it stands at M (`git show "$M:CLAUDE.md"`, never the PR's own copy), and grep the added lines for the content triggers T1–T12. That gives the required approvers and any owner-approval class.
3. Read the latest comment from `DanielMalede` whose first line starts `Approvals for #$ARGUMENTS`. Keep each line whose SHA A still holds: `git diff --quiet A H -- <the changed files that match that approver's rows>` exits 0, leaving `WORK_LEDGER.md` and `TASKS.md` out unless T10 fires. Every other required approver runs again. A `security-auditor` BLOCK stays until it approves on re-review or the owner accepts the named risk.
4. Make a read-only review tree at H (`git worktree add --detach .claude/worktrees/review-$ARGUMENTS H`) and dispatch each approver that must run, in parallel, with that tree's absolute path, H, the diff and the PR body as the acceptance criteria — never the author's reasoning. Each ends with its verdict line: `VERDICT: APPROVE @ <sha>` or `VERDICT: BLOCK @ <sha>` (`regulatory-researcher`: `VERDICT: BRIEFED @ <sha>`). A verdict with no such line, or on another SHA, counts as BLOCK and is re-requested once.
5. Run `merge-guard` pre-merge on the PR at H.
6. Post a new comment from a file (`gh pr comment $ARGUMENTS --body-file <file>`); the latest one is the record:
   ```
   Approvals for #<n> at <H>
   <agent>: <APPROVE | BLOCK | BRIEFED> @ <sha> — rows <J…, T…>
   merge-guard (pre-merge): <GREEN | RED (<tags>)> @ <H>
   owner: <not required | REQUIRED — class (a|b|c) | "<his approval, verbatim>" @ <sha>>
   ```
   then one line per BLOCK finding. Only the owner's own message is his approval; an agent's message never is. No attribution of any kind.
7. Every finding becomes a `TASKS.md` row (`CLAUDE.md`). Remove the review tree (`git worktree remove .claude/worktrees/review-$ARGUMENTS`). Report the required approvers, each verdict, merge-guard, any owner class, and whether the PR now meets the merge rule; for Bedrack's PR, say that he may merge it once it does.
