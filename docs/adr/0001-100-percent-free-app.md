# ADR 0001 — 100% Free App

- **Status:** Accepted (locked decision — do not relitigate)
- **Date:** recorded 2026-07-07 (decision predates this record)

## Context
Kokonada is a personal/portfolio-grade product whose owner has committed to keeping it
free. Groq (LLM) runs on the free 6000-TPM tier; Railway/Atlas/Redis on free/low plans.
Introducing paid tiers would add App Store/Play billing surface, subscription UI, and
compliance overhead for zero product benefit at this stage.

## Decision
The app is **100% free**. No paywalls, no paid tiers, no subscription UI. A12's
Entitlements/RevenueCat work scaffolds a **fully free tier only** — the billing SDK may be
wired for future optionality, but it exposes **no purchase or subscription UI**.

## Consequences
- Cost is an existential constraint, not a P&L line: Groq token spend, Atlas/Railway/Redis
  usage, and cache hit-rate are first-class tracked metrics (see `<engineering_excellence>`).
- The free-tier entitlement scaffold must be verifiably UI-less (pinned regression test).
- Any future move to paid tiers requires a new ADR superseding this one.
