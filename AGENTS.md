# Kokonada contribution rules

These instructions apply to the entire repository.

## CI is a merge gate

- Work in a dedicated feature branch and worktree. Do not push changes directly to `main`.
- Before committing, run the tests and static checks that cover the changed surface.
- Push changes through a Pull Request so GitHub Actions evaluates them.
- Do not describe a change as complete or ready to merge until the CI run for the Pull Request's current head commit has completed successfully.
- A successful run for an older commit does not count after a newer commit is pushed.
- Do not merge while any required job is failing, pending, cancelled, or missing. A path-gated job may be skipped only when its workflow intentionally marks the changed surface as unaffected.
- When CI fails, read the failing job and step logs, reproduce the failure when possible, fix the root cause, push the fix, and wait for the new head commit's CI run. Do not dismiss a failure as unrelated or flaky without evidence.
- Re-running the same commit is appropriate only for a demonstrated transient infrastructure failure. A code or test failure requires a new fixing commit.
- Report the Pull Request URL, the latest Actions run URL, and the final check results when handing work back.

Repository privacy is independent of CI. Do not add GitHub Pages or another public deployment path unless the repository owners explicitly approve it.
