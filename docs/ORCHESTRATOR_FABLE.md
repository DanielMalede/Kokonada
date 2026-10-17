# ORCHESTRATOR-FABLE — the detail behind CLAUDE.md

> **This file holds detail only.** `CLAUDE.md` is binding: the session start, the agents, the task lifecycle, the merge rule and the working rules (attribution included) live there and nowhere else. Where this file and `CLAUDE.md` disagree, `CLAUDE.md` wins and this file is the defect to fix.
>
> Never add attribution of any kind, anywhere — the full rule is `CLAUDE.md` § Working rules.

Repository: `C:\Users\danie\Videos\Kokonada` on the owner's machine, `DanielMalede/Kokonada` on GitHub. A merge to `main` deploys the backend to Railway.

---

<role_and_authority>
The orchestrator — the main session — plans, sequences, adjudicates and dispatches. Production code, tests and migrations are written by `developer`; the orchestrator does not write them itself.

- `KOKONADA_ARCHITECTURE_MASTER.md` §0 describes the architecture as of 2026-09-02. Read it for the system's shape, and verify any claim in it against the code before acting on it. `PLAN.md`, `UI_UX_MASTER_PLAN.md`, `KOKONADA_SECURITY_DATA_AUDIT.md` and `claude_handoff.md` are historical snapshots.
</role_and_authority>

<model_economy>
Fable is scarce (`CLAUDE.md` § Models says who does what): an Opus session escalates only a genuine architectural conflict back to Fable.
- Persist every plan and every ground-truth brief under `docs/` (or as a TASKS row that links it), so no later session pays to regenerate it.
- Batch the owner's decisions into one question round; avoid back-and-forth that re-reads the whole context.
- Do not re-read large documents every turn: read once per session, then work from what you persisted.
</model_economy>

<the_agent_squad>
Every task is executed by a squad: one `developer` paired with the reviewers its jurisdiction requires (the table in `CLAUDE.md`). Independent tasks on disjoint claims run as parallel squads.
- A reviewer receives the diff and the acceptance criteria only, never the developer's reasoning trace, so its judgement stays independent.
- Sub-agents run in isolation; only their final message returns. Report a parallel dispatch as it really is — e.g. `SQUADS DISPATCHED: [dev+auditor: hx5-privacy-link] | [dev+auditor: j1-reward-ingest] → awaiting returns` — never invented live telemetry.
</the_agent_squad>

<iron_law_tdd>
**The iron law. No exceptions.**
- No production code is written without a **failing test watched first**. RED → GREEN → REFACTOR.
- Code written before its test is deleted and rewritten test-first.
- Backend and mobile logic is **pure behind ports**; native modules (Skia, Reanimated, gesture-handler, socket.io, Spotify Remote, MMKV, Keychain, BLE, Health Connect) are thin adapters verified **on-device**, never fake-snapshotted.
- Resilience tests use **stateful fakes with real semantics** (in-memory MMKV, real ZSET/Mongo/vector behaviour, EventEmitter sockets, flaky Spotify remotes) — **never stub theater**.
- **Top-down for end-to-end features:** backend and DTOs/contracts first, then the mobile UI against the *real* contract — never mocked data on the mobile side.
</iron_law_tdd>

<resilience_audit>
The QA gate is the **Resilience Audit** — Stability Engineering, not a generic review. (On-disk guard tests keep their historical `shadow.*.test.js` / `src/__tests__/shadow.*.test.ts` names; the practice is resilience and boundary validation.)
1. After the build is green, `resilience-auditor` (`.claude/agents/resilience-auditor.md`) audits by its Method and reports in its Report format: findings by calibrated severity (S0–S3) and origin (INTRODUCED, EXPOSED, PRE-EXISTING), each with its regression guard, and the full source of every RED stress or boundary test it proposes. It has no shell: the session hands it the raw output of the full suite run in the task worktree, and CI on the head.
2. The developer adds every PROPOSED TEST, RED first, in `backend/tests/shadow.*.test.js` or mobile `src/__tests__/shadow.*.test.ts`; the full suite is the regression gate across the new code **and every prior phase**.
3. Fix every INTRODUCED or EXPOSED blocking finding in the same PR; **pin every hardened boundary as a permanent regression test**. A PRE-EXISTING finding becomes a `TASKS.md` row.
4. `/ship` posts the report as a PR comment and makes the PR ready only on its `VERDICT: APPROVE`.
5. Respect the permanent purge-scan guards (`backend/tests/shadow.flip.test.js` bans reintroduced legacy identifiers across `app/`).
</resilience_audit>

<definition_of_ready>
A task is not dispatched to a squad until its acceptance criteria are explicit and testable, the failing-test plan is stated, the target package and files are identified (they become the claim's path set), the blast radius is computed, and its dependencies are satisfied. Half-specified work is refined or sent back, never dispatched.
</definition_of_ready>

<definition_of_done>
A task is done only when ALL of these hold — judgement does not override a red gate:
1. **Backend:** `npm test` from `<worktree>/backend` fully green, with no regression against the last green `Backend — lint & test` run on `main`; backend lint clean.
2. **Mobile:** from `<worktree>/mobile/KokonadaHealth`, `./node_modules/.bin/jest` green and `npm run lint:design-system` clean. CI also runs `Mobile — jest`, the Android compile check and, when iOS-affecting files change, the iOS build. The sprint's own files are `tsc`-clean.
3. **Secrets:** the PR passes gitleaks (CI) and GitGuardian; the diff carries no token shapes (`AIza|ghp_|sk-|-----BEGIN|eyJ…`, 40+ character blobs) and no token-shaped fixtures.
4. **Resilience Audit** posted, every CONFIRMED finding fixed and every hardened boundary pinned.
5. **CI green on the PR's head commit.** Never add a `railway up` job: Railway deploys natively from `main` with root `/backend`, and a CLI deploy fights the service's Root Directory.
6. **Approvals:** the merge rule in `CLAUDE.md` holds.
Any red gate means the task FAILED. No partial credit.
</definition_of_done>

<pause_and_guide>
**A step that needs a cloud portal stops the task.** No agent can log into Atlas, Railway, Apple Developer, Google Play Console / Google Cloud or Garmin. When a task needs one (an Atlas index, a Railway variable, a signing certificate, a store listing), halt, hand the owner a numbered step-by-step tutorial, and wait for an explicit "DONE".
- A production write the owner approved inside a plan is run by the session (DEC-143).
- Anything else that writes to production is owner-approval class (b) in `CLAUDE.md`.
- Local development database changes may be dry-run via `docker-compose`.
</pause_and_guide>

<locked_decisions>
Do not relitigate:
- **100% free app** — no paywalls, no paid tiers, no subscription UI. Entitlements scaffold a fully free tier only.
- **React Native only** — `mobile/KokonadaHealth` (bare React Native) is the app. The React/Vite web and the Garmin watch app were removed (#187, #180).
- **Design-for-both infrastructure** — Railway + Atlas (Vector Search) + Redis + BullMQ behind strict Repository/Adapter ports, so Qdrant/Neo4j/Redis Cloud can be swapped with no core rewrite. In-process workers (`RUN_WORKERS_IN_PROCESS=true`) are deliberate, not debt.
- **Never pure-LLM audio features** — measured API, Mongo/Redis cache, and a confidence-capped LLM fallback only.
- **Zero-knowledge biometrics** — raw HR/HRV/sleep are AES-256-GCM field-encrypted and decrypted only in worker scope; the ledger stores coarse bands; vitals are never logged or shipped to clients or to an external AI (ADR-0005).
- **No analytics or crash SDK in the mobile app** (owner, 2026-09-29) — only a small declared server-side failure report.
</locked_decisions>

<standards>
The review checklist, per surface:
- **Mobile (React Native):** the **three-lane state architecture** is sacred — HOT (Reanimated worklets, 120 Hz, a single `runOnJS` on gesture end) / WARM (zustand, ephemeral, never persisted; server-socket status independent of biometric transport, S12-1) / COLD (Redux Toolkit, the only persisted lane, hard allowlist serialisation). Presentation separated from logic; no avoidable re-renders (parity-tested cleanup, S10-1); virtualised lists; encrypted-only, biometric-denying persistence (`secureStore`). Screens are built against `docs/SCREENS.md` and, for design v2, only through `/page`.
- **Backend and integrations:** every Spotify/Garmin/YouTube/LLM call handles 429/5xx with backoff and jitter, `Retry-After` and bounded retries; webhooks are idempotent, signature-verified, body-bounded and dead-lettered; OAuth tokens are AES-256-GCM at rest, refreshed single-flight, never logged. Runtime services are built against `docs/RUNTIME_AGENT_ARCHITECTURE.md`.
- **MongoDB:** no N+1; indexes match the real query and sort patterns; cursor-paginated reads; aggregations reviewed for index use and `$lookup`/`$vectorSearch` cost; `$jsonSchema`-validated writes; cache-aside with staleness defences.
- **Files:** respect the `backend` / `mobile` / `scripts` / `docs` split. Removals follow `custodian`'s evidence standard.
</standards>

<engineering_excellence>
Production-grade at the level of a top-tier platform team, sized to a lean team — rigour without ceremony:
- **Observability & SLOs.** Sentry on the backend with request scrubbing, structured JSON logs with correlation ids. SLOs: playlist selection p95 < 300 ms (pinned), socket connect-success rate, worker queue lag, LLM-fallback rate, Spotify/Garmin 4xx/5xx rate. No silent failures — every catch path emits a metric, never a swallowed error.
- **Performance budgets.** Mobile: cold start, JS-thread frame drops on the 120 Hz wheel, bundle size, BLE/socket battery draw, each regression-gated. Backend: per-endpoint p95 and queue-lag budgets.
- **Test depth.** Contract tests for the Spotify/Garmin/LLM adapters, `docker-compose` integration tests, one E2E for the critical mobile flow (login → generate → play → logout), and a soak test for sustained biometric streams.
- **Privacy & compliance (health data is GDPR Art. 9).** Documented retention windows, a user data-export path, least-privilege OAuth scopes, and an audit trail for any decrypt of biometric fields. Privacy-by-design is a review criterion, not an afterthought.
- **Supply chain.** `npm audit` clean; Dependabot/Renovate; pinned lockfiles; every new dependency vetted for licence and maintenance health.
- **Release safety.** Feature-flag risky changes; staged store rollouts; a documented rollback runbook per deploy surface (Railway, the stores); releases gated on crash-free rate.
- **Cost guardrails** (existential for a free app). Track LLM token spend, Atlas/Railway/Redis usage and cache hit-rate; alarm on anomalies.
- **Decision records.** Every non-trivial architectural decision is an ADR in `docs/adr/` (context → decision → consequences); every owner ruling is a DEC entry in `docs/design-v2/decisions/`.
</engineering_excellence>

<how_a_wave_runs>
1. **Ground truth.** Before planning, scan the real source of the packages the wave touches, not only the docs: dead or orphaned code, under-tested paths, unresolved `TODO`/`FIXME`, drift between what a document claims and what the code shows. Every gap becomes a TASKS row marked as discovered; nothing is folded in silently.
2. **Plan.** `architect` produces a dependency-ordered plan with decision tables for every fork; the owner approves it.
3. **Squads.** Ready tasks are claimed and dispatched as parallel squads on disjoint claims. A task with unmet dependencies is never dispatched.
4. **Merge.** Each PR merges under the merge rule in `CLAUDE.md`.
5. **Integration.** After a wave merges, re-run the full backend and mobile suites on `main` (and the on-device checklist where relevant) to catch cross-package interactions.
</how_a_wave_runs>

<error_budget>
- **Rule of 2 — before a merge.** A task that fails verification twice is reverted by its developer (`git restore` the files, or discard the branch), who hands back a failure summary instead of a third attempt. The orchestrator escalates to the owner with the failing diffs, the logs and the options.
- **After a merge** — two consecutive post-merge RED verdicts for the same merge: the session opens a revert PR of the squash commit, as `merge-guard` specifies (never a push to `main`, never force).
- **Global stop.** If failures pile up across a run or the budget is breached, halt the whole run and escalate. A thrashing run stops; it does not keep spending.
- Recovery targets a committed known-good state, re-verified by re-running the affected gates.
</error_budget>

<hitl_matrix>
For a conflict between documents, a cloud authorisation, a blast radius over threshold or an irreversible operation, present this and wait for an explicit answer:

| Field | Content |
| :--- | :--- |
| **Decision** | The conflict or authorisation needed, stated plainly |
| **Option A** | Blast radius (packages + modules) · reversibility · gate and product impact · risk |
| **Option B** | Same axes as A |
| **Recommendation** | One option and the specific evidence (document section, test deltas, security findings) behind it |
| **Reversibility** | Cheaply reversible? If not, say so explicitly |
</hitl_matrix>

<environment_gotchas>
Windows development machine — carry these or waste a session:
- Run backend npm/jest from `<worktree>/backend` (the shell's working directory drifts; a root `npm install` once created a stray root `package.json`).
- **PowerShell 5.1 mangles jest stderr** — run tests through Git Bash: `npm test 2>&1 | grep -aE "Test Suites:|Tests:"`.
- Mobile jest: from `mobile/KokonadaHealth`, use `./node_modules/.bin/jest` (a bare `npx jest` resolves a stale global that does nothing).
- `npm install` may prune devDependencies (`NODE_ENV=production`) — restore with `npm install --include=dev`.
- The backend reads **`MONGO_URI`** (not `DATABASE_URL`); production Mongo is Atlas; in-process workers inherit the web service's environment.
- Git Bash rewrites an argument shaped like `origin/main:path` into a Windows path: put a full SHA before the colon, or prefix `MSYS_NO_PATHCONV=1`.
</environment_gotchas>

<rules_of_engagement>
0. **Stay true to the vision** (`docs/VISION.md`). Kokonada is a calm, premium **body + mind** sanctuary that senses the *whole* body — heart rate, HRV, sleep, movement and activity, stress and recovery — and fuses it with emotional intent into music. Its magic moment (frictionless, no spinners, no errors) is protected above all. If a task conflicts with the vision, flag it.
1. **Evidence over assertion.** Every claim about the repository cites a tool run, a test result or a document.
2. **Halt on ambiguity.** A missing dependency, an unresolved conflict between documents, or a portal step: stop and ask, or Pause & Guide. Never invent architecture or relitigate a locked decision.
3. **Git and the test suite are the safety net.** Small commits, real reverts, the full suite as the regression gate.
4. **Fail loud, recover clean.** Every failure yields a rollback and a plain summary of what failed and the options.
</rules_of_engagement>
