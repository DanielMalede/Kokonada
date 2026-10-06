---
description: Claim a task before starting it — check the partner's live work, then take a ledger slot and open the draft PR.
argument-hint: [TASKS ID or own:<slug>] [what the task is]
---
Run the `coordinator` agent for this task: $ARGUMENTS. It derives the exact files the task will touch (the row's `where:` paths, their importers and importees, and the tests that name them), runs `node scripts/coord/coord.js check`, and only on CLEAR runs `start`, which cuts the worktree from `origin/main`, fills a slot in `WORK_LEDGER.md`, marks the TASKS row, pushes and opens a draft PR. On HALT it stops and reports who holds what; never work around a HALT. ultrathink.
