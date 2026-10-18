# Kokonada — the map of the documentation

Kokonada turns live biometrics and emotion into music: a Node.js backend (`backend/`) and a React Native app (`mobile/KokonadaHealth/`). This file says where every kind of document lives, who approves a change there, and where a new file goes. `CLAUDE.md` is the binding rule book; this page is the map.

## Where things live

| Folder or file | What it holds | Who approves a change (`CLAUDE.md` jurisdiction table) |
|---|---|---|
| `CLAUDE.md`, `AGENTS.md`, `.claude/`, `.agents/` | How work is done: the rules, the agents, the commands | J16 (architect + custodian, then the owner, class a) and J8 (security-auditor + resilience-auditor) |
| `TASKS.md` | Every open task, one row each; the only task list | J19 (merge-guard + coordinator) |
| `WORK_LEDGER.md` | Who holds which files right now (written only by `scripts/coord/coord.js`) | J19; its top section is owner-only (T10) |
| `WEAKNESSES_AND_FAILURES.md` | The sentinel's risk ledger; written only by the `sentinel` agent | J19 |
| `HANDOFF_2026-10-08_BEDRACK.md` | The partner handoff, kept as history under `DEC-185` | J19; it leaves only on the owner's own words |
| `docs/ARCHIVE.md` | Every markdown file that moved, merged or died since 2026-10-18, with the commit that still holds it | J19 |
| `docs/orchestrator-fable.md` | The detail behind `CLAUDE.md`: TDD, the resilience audit, ready and done, the error budget | J16 |
| `docs/vision.md` | What we are building | J16 |
| `docs/privacy-declarations.md` | The privacy inventory and retention table that five tests read | J4, J12, J18 (security-auditor, regulatory-researcher, compliance-auditor, owner class c) |
| `docs/architecture/` | The architecture of record (`architecture-master.md`), the runtime-agent specification, the embedding design note ADR-0014 cites | J19; `runtime-agent-architecture.md` is J13 (architect) |
| `docs/adr/` | Architecture decision records, numbered | J13 (architect) |
| `docs/design-v2/` | Design v2: the owner's rulings (`decisions/`, indexed in `DECISIONS.md`), the registry of obligations (`registry/`), the counsel files (`counsel/`), the external-dates calendar | J18 (decisions), J2q/J11/J12 (registry by prefix), J12 (counsel) |
| `docs/design-v1/` | The v1 design language (`screens.md`, `ui-ux-overhaul-spec.md`); history where it conflicts with design v2; deleted when ADR-0017 lands (`UI-110`) | J9 (designer) |
| `docs/plans/` | Plans in flight: `design-v2-plan.md` (J16), `halts.md` (the open compliance HALTs, one section each), `dev-items.md` (small development items, one section each), `healthkit/` (the one large plan in flight), and the frozen Wave-4 state files `WAVE4_STATE.md` and `WAVE4_ARCHIVE.md` that `scripts/wave4/state-guard.js` reads | J19 |
| `docs/runbooks/` | Operating procedures (Atlas indexes, seed ingestion, HealthSample rollout, Android release signing) | J17 (security-auditor + resilience-auditor, owner class b) |
| `docs/store/` | The store declarations and provider applications | J11 (compliance-auditor); J18 for the declarations |
| `backend/`, `mobile/`, `scripts/` README files | Notes that must sit next to the code they describe (the Design Lab, the brand assets, the fonts, the HealthKit spike) | the folder's own row |

## Where a new file goes

- **A task** is a row in `TASKS.md`, never a file. A large piece of work earns a plan under `docs/plans/<area>/` and the row links to it.
- **A compliance HALT** is a section of `docs/plans/halts.md`; **a small development item** is a section of `docs/plans/dev-items.md`.
- **A ruling** is a `DEC-` entry under `docs/design-v2/decisions/`, indexed in `DECISIONS.md`. **An obligation** is a registry entry (`QA-`, `CMP-`, `REG-`). **A question for counsel** is a section of `docs/design-v2/counsel/questions-annex.md`.
- **An operating procedure** is a runbook under `docs/runbooks/`. **An architecture decision** is an ADR under `docs/adr/` (`/adr`).
- **History** is deleted, with one row in `docs/ARCHIVE.md` naming the last commit that holds it. No banners, no archive folder, no stub at the old path.
- **Nothing new lands at the repository root.** The root holds the six files above plus the partner handoff, and `backend/tests/docsMap.test.js` fails on any other `.md` there.

## When a file moves or dies

Its row goes into `docs/ARCHIVE.md` in the same commit (Moved: old path → new path or `#anchor`; Deleted: path, what it was, the last commit holding it), and every live reference to it is rewritten in that commit. Frozen records are not edited and resolve through the ledger: `docs/design-v2/decisions/**`, `docs/design-v2/registry/**`, `docs/plans/WAVE4_STATE.md`, `docs/plans/WAVE4_ARCHIVE.md`, `WEAKNESSES_AND_FAILURES.md`, `HANDOFF_2026-10-08_BEDRACK.md`. A reference checker never rewrites a command span or the rows a PR itself adds. A reference to a path that is planned but does not exist yet carries `(future)` on its line.

## Names and front matter

- Ledgers and indexes are upper case: `README.md`, `CLAUDE.md`, `AGENTS.md`, `TASKS.md`, `WORK_LEDGER.md`, `WEAKNESSES_AND_FAILURES.md`, `docs/ARCHIVE.md`, `docs/design-v2/DECISIONS.md`, `docs/design-v2/registry/INDEX.md`.
- Numbered records keep their identifier: `DEC-001.md`, `QA-001.md`, `0012-learning-compliance.md`.
- Every other content file is lower-case kebab-case, with a date in the name only when it is a dated record (`gating-five-2026-10-04.md`). The two Wave-4 state files are the exception, pinned by code.
- Every living document under `docs/` (the top level, `architecture/`, `design-v1/`, `plans/`) opens with front matter: `status:` (`living`, `reference` or `frozen`) and `verified:` (the date someone last checked it against the code). `/status` lists the ones older than 90 days.

`backend/tests/docsMap.test.js` enforces this page: no dangling markdown reference outside the ledger, the root allow-list, the naming rule under `docs/`, the front matter of the living folders, and that every ledger row still points at something real.
