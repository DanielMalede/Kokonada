---
description: Merge approved PRs in a safe order.
argument-hint: [PR numbers in merge order]
---
Merge these approved PRs in this exact order: $ARGUMENTS. For each: confirm CI is green first, then `gh pr merge <n> --squash --delete-branch`. If an earlier merge changes main so a later PR needs rebasing, stop and tell me. Never merge one that isn't green or approved. Report each result.
