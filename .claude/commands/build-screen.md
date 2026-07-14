---
description: Build one screen per SCREENS.md with the full design→dev→review gate.
argument-hint: [screen name]
---
Build the "$ARGUMENTS" screen per docs/SCREENS.md and the locked design language (docs/UI_UX_OVERHAUL_SPEC.md APPROVED VISUAL DIRECTION). ultrathink.
- designer: author/confirm the visual direction for this screen; after build, give a SHIP/REVISE verdict.
- developer: build under strict TDD (tokens only, light+dark, reduced-motion, WCAG AA, 60fps); on-device before/after screenshots as closing evidence.
- resilience-auditor: stress/boundary test.
- compliance-auditor: if the screen shows any Spotify/YouTube/Apple mark, OAuth, or permission — verify branding/guidelines, HALT on risk.
Honor the sacred contracts (≤3-tap payload, three-lane state, screenToCircumplex). One PR; present for my approval; never self-merge.
