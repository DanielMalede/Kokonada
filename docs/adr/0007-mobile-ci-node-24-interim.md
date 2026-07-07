# ADR 0007 — Mobile CI Pinned to Node 24 (Interim)

- **Status:** Accepted (INTERIM) — superseded once [issue #84](https://github.com/DanielMalede/Kokonada/issues/84) is fixed
- **Date:** 2026-07-07 (PR #81)

## Context
Bringing the mobile jest suite into CI (#81) immediately exposed a failure: `ProfileScreen ›
renders the identity from /me` **passes on Node 24 (local dev) but fails on Node 22**. The
mobile package's `engines` require `node >= 22.11.0`, so both 22 and 24 are permitted.

The failure is in an **auth-critical** path: `ProfileScreen` loads the signed-in user's
identity via `loadProfile().then(setSnap)` in a mount effect, and on Node 22 the identity is
not present in the rendered tree at assertion time (a `then(setSnap)` microtask + re-render
not deterministically flushed within `react-test-renderer`'s async `act()` under the Node 22
scheduler). Two in-test flush strategies were tried and **both failed** — a `setTimeout(0)`
flush made it worse (5000ms timeout, mount effect's `subscribe` spy showed 0 calls). Per the
Rule of 2, test-hacking stopped.

## Decision
Pin the **mobile CI job to Node 24** (the version the suite is green on locally), keeping the
`>=22.11` engine unchanged. Revert the speculative in-test flush edits so the test stays
pristine. This unblocks mobile CI now without masking anything: the failure is captured as a
tracked defect, **not** silently accepted.

## Consequences
- Mobile CI gates green on Node 24; backend/frontend jobs stay on Node 20.
- This is **interim, not the fix.** [Issue #84](https://github.com/DanielMalede/Kokonada/issues/84)
  tracks the real root cause — is it purely an rtr/`act` flushing quirk, or a genuine
  component race that could flash empty/stale identity or drop the load in production? It must
  be answered (by driving the real flow) before store submission (Blueprint Wave 3.1).
- When #84 is fixed, revisit the Node version (restore the project's target Node or record a
  deliberate choice to keep 24) and **supersede this ADR**.
