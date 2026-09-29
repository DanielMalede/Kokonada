---
description: Merge approved PRs in a safe order.
argument-hint: [PR numbers in merge order]
---
Merge these approved PRs in this exact order: $ARGUMENTS. For each: confirm CI is green first; for a design-v2 page PR, also confirm that docs/design-v2/pages/<page>/gates.json holds a passing, non-stale verdict for every gate G0–G12 against the PR head SHA (/page G13) — if one is missing or stale, stop and tell me. Then `gh pr merge <n> --squash --delete-branch`, and verify on main by content. If an earlier merge changes main so a later PR needs rebasing, stop and tell me. Never merge one that isn't green or approved. Report each result.
