---
description: Kick off the Wave 2.8 continuous screen rollout.
---
Execute Wave 2.8.2 screen rollout per docs/MASTER_BLUEPRINT_2026-07-07.md (rollout protocol) and docs/SCREENS.md. ultrathink. Precondition: the Vision Frame (2.8.1) is approved and D1 tooling merged — if not, stop and tell me. Work through the screens ONE BY ONE in build-queue order, each its own PR: designer direction → developer builds under TDD (tokens, light+dark, reduced-motion, WCAG AA, 60fps, on-device screenshots) → designer SHIP/REVISE + resilience-auditor + compliance-auditor. After I approve+merge each, AUTO-ADVANCE to the next with no re-prompt. HOLD Now Playing + Pulse until D-7/D-8/#90 are fixed. Never self-merge; stop at each merge gate, a designer REVISE, a compliance HALT, or any Pause & Guide.
