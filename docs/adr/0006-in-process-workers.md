# ADR 0006 — In-Process BullMQ Workers on the Railway Free Plan

- **Status:** Accepted
- **Date:** recorded 2026-07-07 (decision from Squad 1, PRs #49–#50)

## Context
The variance engine needs BullMQ consumers (feature hydration, embedding, reclassification).
Railway's free plan blocks creating a second (worker) service; a separate project would
force public-Redis egress plus manual `ENCRYPTION_KEY`/`MONGO_URI` parity between services —
extra attack surface and a drift risk for a zero-budget app.

## Decision
Workers run **inside the web service** via `RUN_WORKERS_IN_PROCESS=true` —
`startInProcessWorkers()` launches the BullMQ consumers in `app/index.js` with graceful
SIGTERM shutdown. The standalone `app/worker.js` (`npm run worker`) is kept intact for a
future dedicated worker service (zero rework once on a paid tier).

## Consequences
- In-process workers **inherit the web service env** → automatic key/URI parity (a benefit).
- This is a **deliberate, documented coupling**, not tech debt; moving to a dedicated worker
  is a config flip, not a rewrite (consistent with ADR 0003 ports).
- Never add a `railway up` CI job — Railway deploys natively from `main` (root `/backend`); a
  CLI deploy fights the service Root Directory and fails in ~2s.
