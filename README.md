# Kokonada — the map of the documentation

Kokonada turns live biometrics and emotion into music: a Node.js backend (`backend/`) and a React Native app (`mobile/KokonadaHealth/`). This file says where every kind of document lives, who approves a change there, and where a new file goes. `CLAUDE.md` is the binding rule book (its jurisdiction table and its rule on where a markdown file is born); this page is the map, and where the two differ `CLAUDE.md` wins.

## Where things live

| Folder or file | What it holds | Who approves a change (`CLAUDE.md` jurisdiction table) |
|---|---|---|
| `CLAUDE.md`, `AGENTS.md`, `.claude/`, `.agents/` | How work is done: the rules, the agents, the commands | J16 (architect + custodian, then the owner, class a) and J8 (security-auditor + resilience-auditor) |
| `TASKS.md` | Every open task, one row each; the only task list | J19 (merge-guard + coordinator); a line of its `## How this file is maintained` or `## Next up` section is the owner's (T10) |
| `WORK_LEDGER.md` | Who holds which files right now (written only by `scripts/coord/coord.js`) | J19; its top section is owner-only (T10) |
| `WEAKNESSES_AND_FAILURES.md` | The sentinel's risk ledger; written only by the `sentinel` agent | J19 |
| `HANDOFF_2026-10-08_BEDRACK.md` | The partner handoff, kept as history under `DEC-185` | J19; it leaves only on the owner's own words |
| `docs/ARCHIVE.md` | Every markdown file that moved, merged or died since 2026-10-18, with the commit that still holds it | J19 |
| `docs/orchestrator-fable.md` | The detail behind `CLAUDE.md`: TDD, the resilience audit, ready and done, the error budget | J16 |
| `docs/vision.md` | What we are building | J16 |
| `docs/privacy-declarations.md` | The privacy inventory and retention table that four tests read | J12, J18 (regulatory-researcher, compliance-auditor, owner class c) |
| `docs/architecture/` | The architecture of record (`architecture-master.md`), the runtime-agent specification, the embedding design note ADR-0014 cites | J19; `runtime-agent-architecture.md` is J13 (architect) |
| `docs/adr/` | Architecture decision records, numbered | J13 (architect) |
| `docs/design-v2/` | Design v2: the owner's rulings (`decisions/`, indexed in `DECISIONS.md`), the registry of obligations (`registry/`), the counsel files (`counsel/`), the external-dates calendar | J18 for a DEC entry on law, privacy, consent or counsel that is added or changes status, owner class (a) under T10 for one that is or refines DEC-142, DEC-143 or DEC-155 or names `CLAUDE.md`, `AGENTS.md`, `.claude/`, the merge rule or the jurisdiction table (J19 for the others), J2q/J11/J12 (registry by prefix), J12 (counsel), J19 (the calendar) |
| `docs/design-v1/` | `ui-ux-overhaul-spec.md`, the v1 design language, history where it conflicts with design v2; `screens.md`, the v1 screen catalog, the reference for a page's data and states until that page's G4 spec pack replaces it (`UI-110`) | J9 (designer) for `screens.md`; J19 for `ui-ux-overhaul-spec.md` |
| `docs/plans/` | Plans in flight: `design-v2-plan.md` (J16), `halts.md` (the open compliance HALTs, one section each), `dev-items.md` (small development items, one section each), `healthkit/` (the one large plan in flight), and the frozen Wave-4 state files `WAVE4_STATE.md` and `WAVE4_ARCHIVE.md` that `scripts/wave4/state-guard.js` reads | J19 |
| `docs/runbooks/` | Operating procedures (Atlas indexes, seed ingestion, HealthSample rollout, Android release signing) | J17 (security-auditor + resilience-auditor, owner class b) |
| `docs/store/` | The store declarations and provider applications | J11 (compliance-auditor) and J18 (regulatory-researcher, compliance-auditor, owner class c) |
| `backend/`, `mobile/`, `scripts/` README files | Notes that must sit next to the code they describe (the Design Lab, the brand assets, the fonts, the HealthKit spike) | J19 for four of the six that exist; the two under `mobile/KokonadaHealth/assets/` (the brand assets, the fonts) are J9 (designer) and J11 (compliance-auditor). Only J2 excludes `*.md`, so a new README in a folder that a J3–J18 row names takes that row's approvers |

## Where a new file goes

- **A task** is a row in `TASKS.md`, never a file. A large piece of work earns a plan under `docs/plans/<area>/` or `docs/plans/<name>.md`, and the row links to it. The custodian's ledger is `docs/plans/custodian-ledger.md` (future).
- **A compliance HALT** is a section of `docs/plans/halts.md`; **a small development item** is a section of `docs/plans/dev-items.md`.
- **A ruling** is a `DEC-` entry under `docs/design-v2/decisions/`, indexed in `DECISIONS.md`. **An obligation** is a registry entry (`QA-`, `CMP-`, `REG-`); **a design rule** is a `DSN-` registry entry, which ADR-0017 mints. **A question for counsel** is a section of `docs/design-v2/counsel/questions-annex.md`.
- **An operating procedure** is a runbook under `docs/runbooks/`. **An architecture decision** is an ADR under `docs/adr/` (`/adr`); **the architecture of record** is under `docs/architecture/`.
- **A store declaration or a provider application** is a file under `docs/store/`. **Material prepared for counsel** is under `docs/design-v2/counsel/` until the owner settles `DAN-100`. **A measured ground-truth brief** is part of the architecture of record, under `docs/architecture/`.
- **A /page record** (charter, brief, spec, row, verdicts) is under `docs/design-v2/pages/<page>/`, named as `.claude/commands/page.md` names it.
- **Not documents:** an agent, a command or a skill is born under `.claude/` or `.agents/` (J16); a note that must sit beside the code it describes is that folder's `README.md`; a generated file lands where the step that generates it writes it, and the design file the design-v2 token build generates is `design-tokens/DESIGN.md` (future).
- **History** is deleted, with one row in `docs/ARCHIVE.md` naming the last commit that holds it. No banners, no archive folder, no stub at the old path. From 2026-10-21 on, a file that dies first carries each open item it holds into `TASKS.md`.
- **Nothing new lands at the repository root.** The root holds the six files above plus the partner handoff, and `backend/tests/docsMap.test.js` fails on any other `.md` there.

## When a file moves or dies

Its row goes into `docs/ARCHIVE.md` in the same commit (Moved: old path → new path or `#anchor`; Deleted: path, what it was (from 2026-10-21 on, with the `TASKS.md` rows that carry its open items, or that nothing was open), the last commit holding it), and every live reference to it is rewritten in that commit. Frozen records are not edited and resolve through the ledger: `docs/design-v2/decisions/**`, `docs/design-v2/registry/**`, `docs/plans/WAVE4_STATE.md`, `docs/plans/WAVE4_ARCHIVE.md`, `WEAKNESSES_AND_FAILURES.md`, `HANDOFF_2026-10-08_BEDRACK.md`. A reference checker never rewrites a command span or the rows a PR itself adds. A reference to a path that is planned but does not exist yet carries `(future)` directly after the path.

## Names and front matter

- Ledgers and indexes are upper case: `README.md`, `CLAUDE.md`, `AGENTS.md`, `TASKS.md`, `WORK_LEDGER.md`, `WEAKNESSES_AND_FAILURES.md`, `docs/ARCHIVE.md`, `docs/design-v2/DECISIONS.md`, `docs/design-v2/registry/INDEX.md`.
- Numbered records keep their identifier: `DEC-001.md`, `QA-001.md`, `CMP-001.md`, `REG-001.md`, `DSN-001.md` (future; docs/ARCHIVE.md § Missing) (the registry and the rulings, prefixes as `CLAUDE.md` names them), `0012-learning-compliance.md`.
- Every other content file is lower-case kebab-case, with a date in the name only when it is a dated record (`gating-five-2026-10-04.md`). The two Wave-4 state files are the exception, pinned by code, and so are the /page verdict files, which keep the name `/page` gives them.
- Every living document under `docs/` (the top level, `architecture/`, `design-v1/`, `plans/`) opens with front matter: `status:` (`living`, `reference` or `frozen`) and `verified:` (the date someone last checked it against the code). `/status` lists the ones older than 90 days.

`backend/tests/docsMap.test.js` enforces this page: no dangling markdown reference outside the ledger, no old path in the strict layer (`CLAUDE.md` lists it) unless it sits in a `(was …)` parenthetical or its line names the ledger, no untracked bare file name there, the root allow-list, the naming rule under `docs/`, the front matter of the living folders, and that every ledger row still points at something real. What it does not catch yet is `OPS-309`.
