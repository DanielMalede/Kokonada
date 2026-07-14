---
description: Root-cause a bug by fault tree (no guessing) and fix it test-first.
argument-hint: [bug description + any logs]
---
Bug to root-cause and fix: $ARGUMENTS
ROOT-CAUSE BY DECOMPOSITION, NOT GUESSING. ultrathink.
1. Draw the fault tree: every hop trigger→result. Mark each EXPECTED vs ACTUAL with cited evidence (log line or code file:line). Isolate the single failing hop before touching code.
2. If evidence is missing for a hop, tell me the exact one-line capture to grab (adb/logcat/DB query) — don't assume.
3. RED test reproducing the failure at that hop (stateful fake, not stub theater). GREEN minimal. resilience-auditor gate.
4. Device/integration-facing = on-device/real evidence is the closing proof, never a green mock.
Present the fault tree + isolated hop + fix plan; do not mark done until re-verified on real behavior.
