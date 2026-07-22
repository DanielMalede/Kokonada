---
description: Pre-merge verdict — GREEN/RED from CI + the diff (no re-running CI). Root-cause on RED.
argument-hint: [PR number or branch — optional, defaults to current]
---
Give a pre-merge verdict for: $ARGUMENTS (default: current branch/PR). ultrathink.
Do NOT re-run what CI already runs — READ the CI result (`gh pr checks` / `gh run view`) + the diff.
1. Read: CI status (backend lint+test, frontend tsc+lint+build), the diff, and the resilience-auditor's posted audit if present.
2. GREEN (all pass) -> output: "✅ PR IS GREEN — CI passed (backend + frontend), audit clean, ready to merge." List the key components checked.
3. RED -> root-cause precisely (which check, file:line, WHY). Classify:
   - Minor (formatting/lint/missing import/simple type): hand it to the `developer` to fix TEST-FIRST and re-run — do NOT edit or push yourself.
   - Major (a real test fails, or the fix touches business logic/architecture): STOP, present the root cause + best fix options, wait for my approval.
NEVER comment out/skip tests, lower strictness, loosen types, or weaken lint rules to go green — fix the underlying code; flag any such attempt as a BLOCKER. Never merge, never self-approve, never push.
